(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const editor = $("editor");
  const map = $("campus-map");
  const editMap = $("edit-map");
  const startInput = $("start");
  const endInput = $("end");
  const timeInput = $("time");
  const lightInput = $("light");
  const testButton = $("test-routes");
  const walkButton = $("start-walk");
  const exposureBadge = $("walker-exposure");
  const customControls = $("custom-controls");
  const budgetInput = $("budget-limit");
  const budgetOptions = new Map(CampusBudget.options.map(option => [option.id, option]));
  const placeButtons = Array.from(document.querySelectorAll("[data-place]"));
  const budgetStorageKey = "campus-shade-budget-limit-v1";
  const yuan = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 });
  const routeTitles = { fast: "直达路线", shade: "少晒路线", balanced: "折中路线", custom: "自定路线" };
  const storageKey = "campus-shade-lab-v1";
  const testTimes = [480, 720, 960];
  const validImage = /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/;

  let demo;
  let exampleCampus;
  let campus;
  let savedCampus;
  let draft;
  let routes;
  let activeRoute = "shade";
  let mode = "point";
  let pointPosition;
  let edgeStart;
  let edgeEnd;
  let tested = false;
  let history = [];
  let custom = [];
  let budgetPlan = [];
  let budgetCandidates = [];
  let budgetCampus;
  let budgetAfter = true;
  let placementTool = null;
  let lastPlant = null;
  let showShade = true;
  let coverageSelection = null;
  let routeChoices = [];
  let viewMode = "2d";
  let playbackPath;
  let playbackKey;
  let playbackDistance = 0;
  let playbackState = "idle";
  let playbackFrame = 0;
  let playbackTimestamp;
  let playbackShadows = [];
  let walkAvailable = true;
  let perspectiveIndex = 0;
  const perspectives = [
    { id: "first", label: "第一人称" },
    { id: "behind", label: "第三人称 · 背后" },
    { id: "front", label: "第三人称 · 正面" }
  ];
  const model = window.CampusWalk3D?.create($("campus-model"), {
    onNode(id) {
      if (!placementTool && customControls.open) addCustomPoint(id);
    },
    onPlace: placePlant,
    onStatus(status) {
      if (status?.unavailable) {
        walkAvailable = false;
        $("mode-3d").disabled = true;
        setView("2d");
        return;
      }
      const remaining = status?.remaining;
      const indicator = $("walk-waypoint");
      indicator.hidden = !Number.isFinite(remaining);
      if (!indicator.hidden) {
        const next = remaining < 3 ? "已到终点附近" : "直线距终点 " + Math.round(remaining) + " 米";
        if (indicator.textContent !== next) indicator.textContent = next;
      }
    }
  });

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function timeLabel(minute) {
    return [Math.floor(minute / 60), minute % 60]
      .map(value => String(value).padStart(2, "0")).join(":");
  }

  function duration(seconds) {
    const rounded = Math.round(seconds);
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return (minutes ? minutes + "分" : "") + (remainder || !minutes ? remainder + "秒" : "");
  }

  function routeTitle(id) {
    return routeTitles[id] || "备选路线 " + id.split("-").at(-1);
  }

  function lightLabel(value) {
    return Math.round(value).toLocaleString("zh-CN");
  }

  function message(id, text) {
    const node = $(id);
    node.textContent = text;
    node.hidden = !text;
  }

  function setCampus(next) {
    clearPlayback();
    if (campus !== next) {
      budgetPlan = [];
      coverageSelection = null;
    }
    campus = next;
    placementTool = lastPlant = null;
    budgetAfter = true;
    $("budget-before").setAttribute("aria-pressed", "false");
    $("budget-after").setAttribute("aria-pressed", "true");
    budgetCandidates = CampusBudget.candidates(campus);
    budgetCampus = budgetPlan.length ? CampusBudget.apply(campus, budgetPlan) : campus;
    renderBudget();
    const places = campus.nodes.filter(node => node.name);
    for (const select of [startInput, endInput]) {
      select.replaceChildren(...places.map(node => new Option(node.name, node.id)));
    }
    const pair = firstConnectedPair(campus);
    startInput.value = pair?.[0] ?? places[0].id;
    endInput.value = pair?.[1] ?? places[1].id;
    $("campus-name").textContent = campus.name;
    $("campus-address").textContent = campus.address || "未填写地址";
    $("data-status").textContent = campus.demo ? "模拟校园" : campus === exampleCampus ? "校园布局示意" : "已导入校园";
    $("mode-2d").textContent = campus.image ? "航拍地图" : "平面地图";
    const attribution = $("map-source");
    attribution.replaceChildren();
    if (campus.sourceUrl || campus.sourceLabel || campus.shadeNote || campus.image) {
      if (campus.sourceUrl) {
        const link = element("a", campus.sourceLabel || "底图来源");
        link.href = campus.sourceUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        attribution.append(link);
      } else if (campus.sourceLabel || campus.image) {
        attribution.append(document.createTextNode(campus.sourceLabel || "底图来自导入的校园资料"));
      }
      if (attribution.hasChildNodes()) attribution.append(document.createTextNode(" · "));
      attribution.append(document.createTextNode(campus.shadeNote || "遮阴按录入的路段数据估算"));
    }
    tested = false;
    activeRoute = campus === exampleCampus ? "fast" : "shade";
    custom = [];
    customControls.open = false;
    model?.reset();
    setView("2d");
  }

  function customize(start, end, minute, displayCampus) {
    if (!custom.length || custom[0] !== start) custom = [start];
    const from = custom.at(-1);
    const locations = new Map(campus.nodes.map((node, index) => [node.id, node.name ||
      "路口 " + (index + 1) + (node.detail ? " · " + node.detail : "")]));
    const next = $("custom-next");
    const choices = new Set();
    if (from !== end) {
      for (const edge of campus.edges) {
        if (edge.from === from && !custom.includes(edge.to)) choices.add(edge.to);
        if (edge.to === from && !custom.includes(edge.from)) choices.add(edge.from);
      }
    }
    next.replaceChildren(new Option("选择下一段", ""), ...Array.from(choices, id =>
      new Option(locations.get(id) + (id === end ? "（终点）" : ""), id)));
    next.disabled = !choices.size;
    $("custom-undo").disabled = custom.length < 2;
    $("custom-clear").disabled = custom.length < 2;
    $("custom-path").textContent = custom.map(id => locations.get(id)).join(" → ");
    const complete = from === end && custom.length > 1;
    $("custom-note").textContent = complete ? "路线已连到终点，可以让角色走一遍。"
      : choices.size ? "也可以点地图上与当前路口相连的点。" : "这里没有可选的下一段，可退回上一步。";
    if (custom.length < 2) return null;

    const edges = custom.slice(1).map((to, index) => {
      const from = custom[index];
      return displayCampus.edges.find(edge => edge.from === from && edge.to === to ||
        edge.from === to && edge.to === from);
    });
    const meters = edges.reduce((sum, edge) => sum + edge.meters, 0);
    const shadeMeters = edges.reduce((sum, edge) => sum + edge.meters * CampusRoutes.shadeAt(edge, minute), 0);
    return { nodes: custom, edges, meters, seconds: meters / 1.2, sunSeconds: (meters - shadeMeters) / 1.2,
      shadePercent: shadeMeters / meters * 100, complete };
  }

  function render() {
    const start = startInput.value;
    const end = endInput.value;
    const minute = Number(timeInput.value);
    const lightLux = Number(lightInput.value);
    const displayCampus = budgetAfter ? budgetCampus : campus;
    $("time-output").value = timeLabel(minute);
    $("light-output").value = lightLabel(lightLux) + " lx";
    lightInput.setAttribute("aria-valuetext", lightLabel(lightLux) + " 勒克斯");
    timeInput.setAttribute("aria-valuetext", timeLabel(minute));
    routes = start === end ? { fast: null, shade: null, suggestions: [] } : CampusRoutes.compute(displayCampus, start, end, minute);
    const builtRoute = routes.fast ? customize(start, end, minute, displayCampus) : null;
    routeChoices = [...routes.suggestions];
    if (builtRoute?.complete) routeChoices.push({ id: "custom", route: builtRoute });
    customControls.hidden = !routes.fast;
    $("custom-legend").hidden = !builtRoute;
    $("shade-legend").hidden = !routes.suggestions.some(item => item.id === "shade");
    $("balanced-legend").hidden = !routes.suggestions.some(item => item.id === "balanced" || item.id.startsWith("alternative-"));
    if (!routeChoices.some(item => item.id === activeRoute) && !(activeRoute === "custom" && builtRoute)) {
      activeRoute = routeChoices.find(item => item.id === "shade")?.id || routeChoices[0]?.id || "fast";
    }
    testButton.disabled = !routes.fast;
    message("plan-error", routes.fast ? "" : start === end
      ? "请选择不同的起点和终点。" : "这两个地点之间暂无连通步道。可在校园资料中补充连接。");

    const summary = $("route-results");
    summary.replaceChildren();
    if (routes.fast) {
      for (const { id: kind, route } of routeChoices) {
        const title = routeTitle(kind);
        const card = $("route-card").content.firstElementChild.cloneNode(true);
        card.dataset.kind = kind;
        card.dataset.active = String(activeRoute === kind);
        card.querySelector(".route-type").textContent = title;
        card.querySelector(".distance").textContent = Math.round(route.meters) + " 米";
        card.querySelector(".total").textContent = duration(route.seconds);
        card.querySelector(".sun").textContent = "日晒 " + duration(route.sunSeconds);
        card.querySelector(".percent").textContent = "遮阴 " + Math.round(route.shadePercent) + "%";
        card.querySelector(".light-total").textContent = "直射光照 " + lightLabel(lightLux * route.sunSeconds / 60) + " lx·min";
        card.querySelector(".route-bar i").style.width = route.shadePercent + "%";
        const select = card.querySelector("button");
        select.textContent = activeRoute === kind ? "当前路线" : "查看路线";
        select.setAttribute("aria-label", "查看" + title);
        select.setAttribute("aria-pressed", String(activeRoute === kind));
        card.addEventListener("click", event => {
          if (!event.target.closest("button")) select.click();
        });
        select.addEventListener("click", () => {
          activeRoute = kind;
          render();
          summary.querySelector('[data-active="true"] button').focus();
        });
        summary.append(card);
      }
    }

    const selected = activeRoute === "custom" ? builtRoute : routeChoices.find(item => item.id === activeRoute)?.route;
    walkButton.disabled = !(selected?.nodes?.length > 1 && selected.complete !== false);
    if (playbackPath && playbackKey !== routeKey(selected)) clearPlayback();
    const nextIds = !placementTool && customControls.open && routes.fast
      ? Array.from($("custom-next").options, option => option.value).filter(Boolean) : [];
    const mapOptions = { start, end, selected, suggestions: routeChoices, minute, lightLux, activeRoute, nextIds,
      campusKey: campus, endName: campus.nodes.find(node => node.id === end)?.name,
      planting: Boolean(placementTool), placement: lastPlant, showShade,
      hideExistingScenery: Boolean(displayCampus.image) };
    if (viewMode === "3d") {
      model.draw(displayCampus, mapOptions);
    } else {
      CampusMap.draw(map, displayCampus, mapOptions);
    }
    if (playbackPath) {
      playbackShadows = window.CampusWalk3D?.shadowAreas(displayCampus.scenery ?? displayCampus, minute) ?? [];
      renderPlaybackPose();
    }
    const caption = activeRoute === "custom" && builtRoute && !builtRoute.complete
      ? "自定路线绘制中"
      : selected ? "当前查看" + routeTitle(activeRoute) : "请选择可通过步道到达的地点";
    $("map-caption").textContent = caption + (budgetPlan.length ? (budgetAfter ? " · 改造后" : " · 改造前") : "");
    renderMaterials();
    renderTests();
    renderBudgetImpact(start, end, minute);
    renderCoverage(selected, minute);
  }

  function routeKey(route) {
    return route && JSON.stringify(route.nodes);
  }

  function updatePlaybackControls() {
    const active = playbackState !== "idle";
    const paused = playbackState === "paused";
    const arrived = playbackState === "arrived";
    const has3d = Boolean(model && walkAvailable);
    $("route-playback").hidden = !active;
    exposureBadge.hidden = !active;
    $("map-3d").classList.toggle("is-playing", active);
    $("view-guide").textContent = active
      ? arrived ? "角色已到终点" : paused ? "角色已暂停" : "角色自动行走"
      : "WASD 行走 · 拖动看四周";
    $("pause-walk").textContent = paused ? "继续走" : "暂停";
    $("pause-walk").disabled = arrived;
    $("watch-walker").disabled = $("enter-walker").disabled = !has3d;
    $("watch-walker").setAttribute("aria-pressed", String(viewMode === "3d" && perspectiveIndex !== 0));
    $("enter-walker").setAttribute("aria-pressed", String(viewMode === "3d" && perspectiveIndex === 0));
    if (active) {
      $("playback-state").textContent = arrived ? "已到终点" : paused ? "已暂停" : "沿路线行走中";
    }
  }

  function clearPlayback() {
    if (!playbackPath) return;
    cancelAnimationFrame(playbackFrame);
    playbackFrame = 0;
    playbackTimestamp = undefined;
    playbackDistance = 0;
    playbackPath = playbackKey = undefined;
    playbackState = "idle";
    model?.setRoutePlayback(null);
    CampusMap.moveWalker(map, null);
    updatePlaybackControls();
  }

  function renderPlaybackPose() {
    const pose = CampusRoutePlayback.sample(playbackPath, playbackDistance);
    const walking = playbackState === "walking";
    model?.setRoutePlayback({ ...pose, walking });
    if (viewMode === "2d") CampusMap.moveWalker(map, { ...pose, walking });
    const inShadow = playbackShadows.some(({ x, y, w, h }) =>
      pose.x >= x && pose.x <= x + w && pose.y >= y && pose.y <= y + h);
    const lowLight = Number(lightInput.value) < 5000;
    const exposure = inShadow ? "凉 · 阴影" : lowLight ? "凉 · 光照弱" : "热 · 直晒";
    if (exposureBadge.textContent !== exposure) {
      exposureBadge.textContent = exposure;
      exposureBadge.dataset.hot = String(!inShadow && !lowLight);
    }
    $("playback-progress").value = playbackDistance / playbackPath.meters;
    $("playback-distance").textContent = Math.round(playbackDistance) + " / " + Math.round(playbackPath.meters) + " 米";
  }

  function advancePlayback(timestamp) {
    if (playbackState !== "walking") return;
    const elapsed = playbackTimestamp === undefined ? 0 : Math.min((timestamp - playbackTimestamp) / 1000, 0.1);
    playbackTimestamp = timestamp;
    const speed = Number($("playback-speed").value);
    playbackDistance = Math.min(playbackPath.meters, playbackDistance + elapsed * 1.2 * speed);
    if (playbackDistance >= playbackPath.meters) {
      playbackState = "arrived";
      playbackFrame = 0;
      updatePlaybackControls();
    } else {
      playbackFrame = requestAnimationFrame(advancePlayback);
    }
    renderPlaybackPose();
  }

  function restartPlayback() {
    cancelAnimationFrame(playbackFrame);
    playbackDistance = 0;
    playbackTimestamp = undefined;
    playbackState = "walking";
    updatePlaybackControls();
    renderPlaybackPose();
    playbackFrame = requestAnimationFrame(advancePlayback);
  }

  function startPlayback() {
    const route = routeChoices.find(item => item.id === activeRoute)?.route;
    const path = CampusRoutePlayback.prepare(campus, route);
    if (!path?.meters) return;
    if (placementTool) finishPlacement();
    clearPlayback();
    playbackPath = path;
    playbackKey = routeKey(route);
    setView("3d");
    setPerspective(1);
    restartPlayback();
    $("map-heading").scrollIntoView({ block: "nearest" });
  }

  function pavedCoverage(edges, minute) {
    let length = 0;
    let shaded = 0;
    for (const edge of edges) {
      length += edge.meters;
      shaded += edge.meters * CampusRoutes.shadeAt(edge, minute);
    }
    return { length, shaded, percent: length ? 100 * shaded / length : 0 };
  }

  function distanceLabel(meters) {
    if (meters > 0 && meters < 0.1) return "不足 0.1 米";
    return meters.toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + " 米";
  }

  function renderCoverage(selected, minute) {
    const context = $("coverage-context");
    context.textContent = timeLabel(minute) + " · 按同一条路线或同一组步道比较";
    const display = $("coverage-summary");
    display.replaceChildren();
    const table = element("table", "", "test-table coverage-summary-table");
    const header = table.createTHead().insertRow();
    for (const label of ["评估范围", "改造前遮阴", "改造后遮阴", "新增遮阴"]) {
      const th = element("th", label);
      th.scope = "col";
      header.append(th);
    }
    const rows = table.createTBody();
    const indices = new Map((budgetAfter ? budgetCampus : campus).edges.map((edge, index) => [edge, index]));
    const current = selected?.complete !== false ? selected?.edges.map(edge => indices.get(edge)) : null;
    const scopes = [{ label: "已录入步道", before: campus.edges, after: budgetCampus.edges }];
    if (current?.length && current.every(index => index !== undefined)) {
      scopes.unshift({ label: routeTitle(activeRoute),
        before: current.map(index => campus.edges[index]),
        after: current.map(index => budgetCampus.edges[index]) });
    }
    for (const scope of scopes) {
      const before = pavedCoverage(scope.before, minute);
      const after = pavedCoverage(scope.after, minute);
      const gain = Math.max(0, after.shaded - before.shaded);
      const percentageGain = (after.percent - before.percent).toFixed(1);
      const row = rows.insertRow();
      for (const value of [scope.label + " · " + distanceLabel(before.length),
        distanceLabel(before.shaded) + " · " + before.percent.toFixed(1) + "%",
        distanceLabel(after.shaded) + " · " + after.percent.toFixed(1) + "%",
        "+" + distanceLabel(gain) + " · +" + percentageGain + " 个百分点"]) {
        row.insertCell().textContent = value;
      }
      row.lastElementChild.className = "coverage-gain";
    }
    display.append(table);

    $("coverage-item").hidden = !budgetPlan.length;
    if (!budgetPlan.length) return;
    const selector = $("coverage-placement");
    selector.replaceChildren(...budgetPlan.map((item, index) => {
      const segment = budgetCandidates.find(candidate => candidate.edgeIndex === item.edgeIndex);
      return new Option((index + 1) + " · " + budgetOptions.get(item.optionId).name + " · " + segment.label, index);
    }));
    if (!budgetPlan.includes(coverageSelection)) coverageSelection = budgetPlan.at(-1);
    selector.value = String(budgetPlan.indexOf(coverageSelection));
    const without = CampusBudget.apply(campus, budgetPlan.filter(item => item !== coverageSelection));
    const gainOverall = Math.max(0, pavedCoverage(budgetCampus.edges, minute).shaded - pavedCoverage(without.edges, minute).shaded);
    const gainCurrent = current?.length && current.every(index => index !== undefined)
      ? Math.max(0, pavedCoverage(current.map(index => budgetCampus.edges[index]), minute).shaded -
        pavedCoverage(current.map(index => without.edges[index]), minute).shaded)
      : null;
    const impact = gainOverall > 1e-6
      ? "为已录入步道新增 " + distanceLabel(gainOverall) + " 遮阴。"
      : "没有增加已录入步道的遮阴，可能是离步道较远，或与已有阴影重叠。";
    const routeImpact = gainCurrent === null ? "" : gainCurrent > 1e-6
      ? "其中当前路线新增 " + distanceLabel(gainCurrent) + "。"
      : gainOverall > 1e-6 ? "新增部分位于当前路线以外。" : "";
    $("coverage-placement-result").textContent = impact + routeImpact;
  }

  function routeSunSeconds(edges, minute) {
    return edges.reduce((sum, edge) =>
      sum + edge.meters * (1 - CampusRoutes.shadeAt(edge, minute)) / 1.2, 0);
  }

  function renderBudgetImpact(start, end, minute) {
    const display = $("budget-impact");
    display.replaceChildren();
    if (!budgetPlan.length) return;
    const before = CampusRoutes.compute(campus, start, end, minute);
    if (!before.fast || start === end) {
      display.append(element("p", "选择两个可通行的地点，查看改造前后对比。", "muted"));
      return;
    }
    const after = CampusRoutes.compute(budgetCampus, start, end, minute);
    const sameDirectEdges = before.fast.edges.map(edge => budgetCampus.edges[campus.edges.indexOf(edge)]);
    const table = element("table", "", "test-table");
    const header = table.createTHead().insertRow();
    for (const title of ["路线", "改造前日晒", "改造后日晒"]) {
      const heading = element("th", title);
      heading.scope = "col";
      header.append(heading);
    }
    const body = table.createTBody();
    const scenarios = [["同一条直达路线", before.fast.sunSeconds, routeSunSeconds(sameDirectEdges, minute)],
      ["各自最少晒路线", before.shade.sunSeconds, after.shade.sunSeconds]];
    for (const [name, baseline, improved] of scenarios) {
      const row = body.insertRow();
      for (const value of [name, duration(baseline), duration(improved)]) {
        row.insertCell().textContent = value;
      }
    }
    display.append(element("div", timeLabel(minute) + " 出发 · 预计日晒", "budget-impact-title"), table);
  }

  function budgetLimit() {
    const amount = budgetInput.valueAsNumber;
    return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
  }

  function setBudgetView(after) {
    budgetAfter = after;
    $("budget-before").setAttribute("aria-pressed", String(!after));
    $("budget-after").setAttribute("aria-pressed", String(after));
    if (campus) render();
  }

  function renderBudgetControls() {
    const limit = budgetLimit();
    const { total, remaining, overBudget } = CampusBudget.summarize(budgetPlan, limit ?? 0);
    budgetInput.setAttribute("aria-invalid", String(limit === null));
    $("budget-total").textContent = yuan.format(total);
    $("budget-balance-label").textContent = limit !== null && overBudget ? "超出预算" : "剩余预算";
    $("budget-balance").textContent = limit === null ? "—" : yuan.format(Math.abs(remaining));
    $("budget-balance").dataset.over = String(limit !== null && overBudget);
    $("map-budget").textContent = limit === null ? "设置预算"
      : (overBudget ? "超支 " : "剩余 ") + yuan.format(Math.abs(remaining));
    const selected = budgetOptions.get($("budget-option").value);
    const placeable = CampusBudget.isPlaceable(selected?.id);
    $("budget-edge-label").hidden = placeable;
    $("budget-edge").required = !placeable;
    $("budget-add").disabled = limit === null || !campus?.edges.length || (!placeable && !$("budget-edge").value);
    $("budget-add").textContent = placeable ? "到地图上放置" : "加入方案";
    $("budget-option-detail").textContent = selected?.description || "";
    const toolbar = $("placement-toolbar");
    toolbar.hidden = !placementTool;
    for (const button of placeButtons) {
      button.setAttribute("aria-pressed", String(placementTool === button.dataset.place));
      button.disabled = !campus?.edges.length;
    }
    $("map-2d").classList.toggle("is-planting", Boolean(placementTool));
    $("map-3d").classList.toggle("is-planting", Boolean(placementTool));
    if (placementTool) {
      const option = budgetOptions.get(placementTool);
      $("placement-status").textContent = limit === null || remaining < option.cost
        ? "剩余预算不足，请调整金额或结束放置。"
        : (viewMode === "3d" ? "点地面放置" : "点地图放置") + (placementTool === "tree" ? "遮阴树" : option.name) +
          " · 每次 " + yuan.format(option.cost) + " · 剩余 " + yuan.format(remaining);
    }
    if (limit === null) message("budget-error", "请输入 0 或更大的整数预算。");
    else if (overBudget) message("budget-error", "当前方案超出预算。可移除改造项或提高预算上限。");
    else message("budget-error", "");
  }

  function renderBudget() {
    const edgeSelect = $("budget-edge");
    const previous = edgeSelect.value;
    const used = new Set(budgetPlan.filter(item => !CampusBudget.isPlaceable(item.optionId)).map(item => item.edgeIndex));
    const choices = budgetCandidates.filter(candidate => !used.has(candidate.edgeIndex));
    edgeSelect.replaceChildren(...choices.map(candidate => new Option(candidate.label, candidate.edgeIndex)));
    edgeSelect.disabled = !choices.length;
    if (!choices.length) edgeSelect.add(new Option("没有可选路段", ""));
    if (choices.some(candidate => String(candidate.edgeIndex) === previous)) edgeSelect.value = previous;
    const list = $("budget-plan");
    list.replaceChildren();
    $("budget-count").textContent = budgetPlan.length + " 项";
    $("budget-clear").disabled = !budgetPlan.length;
    if (!budgetPlan.length) list.append(element("p", "加入改造后，可查看预计少晒多久。", "muted"));
    for (const item of budgetPlan) {
      const option = budgetOptions.get(item.optionId);
      const candidate = budgetCandidates.find(entry => entry.edgeIndex === item.edgeIndex);
      const details = element("div");
      details.append(element("strong", option.name + " · " + yuan.format(option.cost)),
        element("small", CampusBudget.isPlaceable(option.id) ? "靠近 " + candidate.label : candidate.label));
      const remove = element("button", "移除", "link-button");
      remove.type = "button";
      remove.setAttribute("aria-label", "移除" + candidate.label + "的" + option.name);
      remove.addEventListener("click", () => {
        updateBudgetPlan(budgetPlan.filter(entry => entry !== item));
        $("budget-option").focus();
      });
      const row = element("div", "", "budget-line");
      row.append(details, remove);
      list.append(row);
    }
    renderBudgetControls();
  }

  function updateBudgetPlan(next) {
    budgetPlan = next;
    budgetCampus = CampusBudget.apply(campus, budgetPlan);
    renderBudget();
    setBudgetView(true);
  }

  function finishPlacement() {
    placementTool = null;
    lastPlant = null;
    renderBudgetControls();
    if (campus) render();
  }

  function startPlacement(optionId) {
    const option = budgetOptions.get(optionId);
    if (!campus?.edges.length || !option) return;
    $("budget-option").value = optionId;
    placementTool = optionId;
    lastPlant = null;
    setBudgetView(true);
    renderBudgetControls();
    $("placement-toolbar").scrollIntoView({ behavior: "smooth", block: "nearest" });
    $("cancel-placement").focus({ preventScroll: true });
  }

  function placePlant(point) {
    if (!placementTool || !Number.isFinite(point?.x) || !Number.isFinite(point?.y) ||
        point.x < 0 || point.x > 800 || point.y < 0 || point.y > 560) return;
    const limit = budgetLimit();
    if (limit === null) return;
    const option = budgetOptions.get(placementTool);
    const { remaining } = CampusBudget.summarize(budgetPlan, limit);
    if (remaining < option.cost) return;
    const insideBuilding = campus.scenery?.buildings.some(building =>
      point.x >= building.x && point.x <= building.x + building.w &&
      point.y >= building.y && point.y <= building.y + building.h);
    if (insideBuilding) {
      $("placement-status").textContent = "这个位置在建筑内，请在室外重新选点。";
      return;
    }
    let closest;
    let nearestDistance = Infinity;
    for (const candidate of budgetCandidates) {
      const { from, to } = candidate;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lengthSquared = dx * dx + dy * dy;
      const progress = lengthSquared
        ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared))
        : 0;
      const distance = Math.hypot(point.x - (from.x + dx * progress), point.y - (from.y + dy * progress));
      if (distance < nearestDistance) {
        closest = candidate;
        nearestDistance = distance;
      }
    }
    if (!closest) return;
    const id = globalThis.crypto?.randomUUID?.() || String(Date.now()) + "-" + Math.random();
    lastPlant = { x: point.x, y: point.y };
    const item = { id, edgeIndex: closest.edgeIndex, optionId: option.id, ...lastPlant };
    coverageSelection = item;
    updateBudgetPlan([...budgetPlan, item]);
  }

  $("budget-option").replaceChildren(...CampusBudget.options.map(option =>
    new Option(option.name + " · " + yuan.format(option.cost), option.id)));
  try {
    const previousLimit = localStorage.getItem(budgetStorageKey);
    if (previousLimit !== null && /^\d+$/.test(previousLimit) && Number.isSafeInteger(Number(previousLimit))) {
      budgetInput.value = previousLimit;
    }
  } catch {
    // The budget input works without persistent browser storage.
  }
  budgetInput.addEventListener("input", () => {
    renderBudgetControls();
    const limit = budgetLimit();
    if (limit !== null) {
      try {
        localStorage.setItem(budgetStorageKey, String(limit));
      } catch {
        // Keep the budget for the current page when storage is unavailable.
      }
    }
  });
  $("budget-option").addEventListener("change", finishPlacement);
  $("budget-edge").addEventListener("change", renderBudgetControls);
  $("budget-clear").addEventListener("click", () => {
    placementTool = null;
    lastPlant = null;
    coverageSelection = null;
    updateBudgetPlan([]);
    $("budget-option").focus({ preventScroll: true });
  });
  $("budget-before").addEventListener("click", () => {
    finishPlacement();
    setBudgetView(false);
  });
  $("budget-after").addEventListener("click", () => setBudgetView(true));
  for (const button of placeButtons) {
    const option = button.dataset.place;
    button.querySelector("small").textContent = yuan.format(budgetOptions.get(option).cost);
    button.addEventListener("click", () => {
      if (placementTool === option) finishPlacement();
      else startPlacement(option);
    });
  }
  $("toggle-shade").addEventListener("click", event => {
    showShade = !showShade;
    event.currentTarget.setAttribute("aria-pressed", String(showShade));
    $("shade-area-legend").hidden = !showShade;
    if (campus) render();
  });
  $("coverage-placement").addEventListener("change", event => {
    coverageSelection = budgetPlan[Number(event.target.value)];
    render();
  });
  $("cancel-placement").addEventListener("click", () => {
    finishPlacement();
    $("budget-add").focus({ preventScroll: true });
  });
  $("budget-form").addEventListener("submit", event => {
    event.preventDefault();
    const edgeId = $("budget-edge").value;
    const limit = budgetLimit();
    const optionId = $("budget-option").value;
    if (limit === null) return;
    if (CampusBudget.isPlaceable(optionId)) {
      startPlacement(optionId);
      return;
    }
    if (!edgeId) return;
    const item = { edgeIndex: Number(edgeId), optionId };
    const next = [...budgetPlan, item];
    const { overBudget, remaining } = CampusBudget.summarize(next, limit);
    if (overBudget) {
      message("budget-error", "加入该项会超出预算 " + yuan.format(Math.abs(remaining)) + "。");
      return;
    }
    updateBudgetPlan(next);
  });

  function renderMaterials() {
    const display = $("materials");
    const destination = campus.nodes.find(node => node.id === endInput.value);
    display.replaceChildren(element("h3", destination.name, "destination-title"));
    display.append(element("p", destination.detail || "暂未录入入口位置。", "muted"));
    if (destination.tips?.length) {
      const list = element("ul", "", "materials-list");
      list.append(...destination.tips.map(tip => element("li", tip)));
      display.append(list);
    }
  }

  function renderTests() {
    const body = $("test-results");
    body.replaceChildren();
    if (!tested || !routes.fast) {
      body.append(element("p", routes.fast ? "点击「测试不同时段」查看对比。" : "生成可通行路线后，即可进行测试。", "muted"));
      return;
    }

    const table = element("table", "", "test-table route-test-table");
    const header = table.createTHead().insertRow();
    const headings = ["预计日晒", ...testTimes.map(timeLabel)];
    for (const title of headings) {
      const heading = element("th", title);
      heading.scope = "col";
      header.append(heading);
    }
    const rows = table.createTBody();
    for (const { id, route } of routeChoices) {
      const row = rows.insertRow();
      if (id === activeRoute) row.dataset.active = "true";
      for (const value of [routeTitle(id), ...testTimes.map(minute => duration(routeSunSeconds(route.edges, minute)))]) {
        row.insertCell().textContent = value;
      }
    }
    body.append(table, element("p", "固定 " + timeLabel(Number(timeInput.value)) + " 生成的路线进行比较。", "muted test-note"));
  }

  function isText(value, max) {
    return typeof value === "string" && value.length <= max;
  }

  function inRange(value, min, max) {
    return Number.isFinite(value) && value >= min && value <= max;
  }

  function prepare(source) {
    if (!source || !isText(source.name, 120) || !source.name.trim() ||
        !isText(source.address || "", 240) || !Array.isArray(source.nodes) ||
        !Array.isArray(source.edges) || source.nodes.length > 800 || source.edges.length > 3000) {
      throw new Error("校园数据需包含学校名称、地点列表和步道列表。");
    }
    const ids = new Set();
    const nodes = source.nodes.map(node => {
      if (!node || !isText(node.id, 100) || !node.id.trim() || node.id.includes("\0") ||
          ids.has(node.id) || !inRange(node.x, 0, 800) || !inRange(node.y, 0, 560)) {
        throw new Error("地点编号需唯一，坐标需位于校园地图范围内。");
      }
      ids.add(node.id);
      const tips = Array.isArray(node.tips) ? node.tips.filter(tip => isText(tip, 500)).slice(0, 15) : [];
      return {
        id: node.id, x: node.x, y: node.y,
        name: isText(node.name, 100) ? node.name.trim() : "",
        detail: isText(node.detail, 200) ? node.detail.trim() : "",
        tips
      };
    });
    const edges = source.edges.map(edge => {
      if (!edge || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to ||
          !inRange(edge.meters, 1, 20000) || !Array.isArray(edge.shade) ||
          edge.shade.length !== 3 || !edge.shade.every(value => inRange(value, 0, 1))) {
        throw new Error("每条步道需连接两个不同地点，并填写米数和三个 0 至 1 之间的遮阴比例。");
      }
      return {
        from: edge.from, to: edge.to, meters: edge.meters, shade: edge.shade,
        kind: ["树荫", "连廊"].includes(edge.kind) ? edge.kind : "开阔"
      };
    });
    const result = { name: source.name.trim(), address: (source.address || "").trim(), nodes, edges };
    if (isText(source.sourceLabel, 150)) result.sourceLabel = source.sourceLabel;
    if (isText(source.shadeNote, 200)) result.shadeNote = source.shadeNote;
    if (isText(source.modelNote, 200)) result.modelNote = source.modelNote;
    if (isText(source.sourceUrl, 600) && /^https:\/\//i.test(source.sourceUrl)) result.sourceUrl = source.sourceUrl;
    if (source.image) {
      if (typeof source.image !== "string" || source.image.length > 3500000 || !validImage.test(source.image)) {
        throw new Error("校园底图格式无效或过大。可重新上传 PNG、JPG 或 WebP。");
      }
      result.image = source.image;
    }
    if (source.scenery && typeof source.scenery === "object") {
      const box = item => item && inRange(item.x, 0, 800) && inRange(item.y, 0, 560) &&
        inRange(item.w, 1, 800) && inRange(item.h, 1, 560);
      const safeBox = item => ({
        x: item.x, y: item.y, w: item.w, h: item.h,
        label: isText(item.label, 80) ? item.label : "",
        ...(inRange(item.height, 1, 250) ? { height: item.height } : {}),
        ...(isText(item.kind, 30) ? { kind: item.kind } : {})
      });
      const { buildings, groves, plazas, field } = source.scenery;
      result.scenery = {
        buildings: Array.isArray(buildings) ? buildings.slice(0, 200).filter(box).map(safeBox) : [],
        groves: Array.isArray(groves) ? groves.slice(0, 300).filter(item => item &&
          inRange(item.x, 0, 800) && inRange(item.y, 0, 560) && inRange(item.r, 1, 100))
          .map(item => ({ x: item.x, y: item.y, r: item.r,
            ...(inRange(item.height, 1, 100) ? { height: item.height } : {}), ...(isText(item.kind, 30) ? { kind: item.kind } : {}) })) : []
      };
      if (Array.isArray(plazas)) result.scenery.plazas = plazas.slice(0, 40).filter(box).map(safeBox);
      if (box(field)) result.scenery.field = safeBox(field);
    }
    return result;
  }

  function readSettings() {
    return {
      ...draft,
      name: $("edit-name").value.trim(),
      address: $("edit-address").value.trim()
    };
  }

  function openEditor() {
    const head = campus.demo || campus === exampleCampus
      ? savedCampus || { name: "", address: "", nodes: [], edges: [] } : campus;
    loadDraft(head);
    editor.showModal();
  }

  function loadDraft(source) {
    draft = structuredClone(source);
    history = [];
    $("edit-name").value = draft.name;
    $("edit-address").value = draft.address;
    $("image-file").value = "";
    $("json-file").value = "";
    setMode("point");
    message("editor-error", "");
  }

  function resetForms() {
    pointPosition = edgeStart = edgeEnd = null;
    $("point-form").hidden = $("edge-form").hidden = true;
  }

  function setMode(next) {
    mode = next;
    resetForms();
    for (const button of editor.querySelectorAll("[data-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    }
    drawDraft();
  }

  function drawDraft() {
    $("edit-content").hidden = false;
    CampusMap.draw(editMap, draft, { start: edgeStart, end: edgeEnd });
    $("editor-count").textContent = draft.nodes.length + " 个地点或路口 · " + draft.edges.length + " 条步道";
    $("undo-edit").disabled = !history.length;
    $("editor-hint").textContent = mode === "point" ? "点击底图，放置一个地点或路口。"
      : edgeEnd ? "填写选中步道的长度和遮阴比例。"
      : edgeStart ? "再点一下步道的另一端。" : "点击要连接的第一个地点或路口。";
  }

  function saveHistory() {
    history.push(draft);
  }

  function addMarker(point) {
    const form = $("point-form");
    form.reset();
    pointPosition = point;
    $("point-location").textContent = "地图位置 " + Math.round(point.x) + "，" + Math.round(point.y);
    form.hidden = false;
    $("point-name").focus();
  }

  editMap.addEventListener("click", event => {
    const point = new DOMPoint(event.clientX, event.clientY)
      .matrixTransform(editMap.getScreenCTM().inverse());
    if (mode === "point") {
      addMarker(point);
      return;
    }

    let hit;
    let distance = 28;
    for (const node of draft.nodes) {
      const nextDistance = Math.hypot(node.x - point.x, node.y - point.y);
      if (nextDistance < distance) {
        distance = nextDistance;
        hit = node;
      }
    }
    if (!hit) {
      message("editor-error", "请点击已有地点或路口。");
      return;
    }
    message("editor-error", "");
    if (!edgeStart || edgeEnd || edgeStart === hit.id) {
      edgeStart = hit.id;
      edgeEnd = null;
      $("edge-form").hidden = true;
    } else {
      edgeEnd = hit.id;
      const from = draft.nodes.find(node => node.id === edgeStart);
      $("edge-form").reset();
      $("edge-endpoints").textContent = (from.name || "路口") + " → " + (hit.name || "路口");
      $("edge-form").hidden = false;
    }
    drawDraft();
    if (edgeEnd) $("edge-length").focus();
  });

  $("point-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!pointPosition) return;
    saveHistory();
    const node = {
      id: "place-" + Date.now().toString(36) + "-" + draft.nodes.length,
      x: Math.round(pointPosition.x), y: Math.round(pointPosition.y),
      name: $("point-name").value.trim(), detail: $("point-detail").value.trim(),
      tips: $("point-tips").value.split("\n").map(line => line.trim()).filter(Boolean)
    };
    draft = { ...draft, nodes: [...draft.nodes, node] };
    resetForms();
    drawDraft();
    message("editor-error", "");
  });

  $("edge-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!edgeStart || !edgeEnd) return;
    const from = edgeStart;
    const to = edgeEnd;
    const edge = {
      from, to, meters: $("edge-length").valueAsNumber, kind: $("edge-kind").value,
      shade: [0, 1, 2].map(index => $("shade-" + index).valueAsNumber / 100)
    };
    const existing = draft.edges.find(item =>
      (item.from === from && item.to === to) || (item.from === to && item.to === from));
    saveHistory();
    draft = { ...draft, edges: [...draft.edges.filter(item => item !== existing), edge] };
    resetForms();
    drawDraft();
    message("editor-error", "");
  });

  function imageAsMap(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 800;
          canvas.height = 560;
          const context = canvas.getContext("2d");
          context.fillStyle = "#f7f5e8";
          context.fillRect(0, 0, 800, 560);
          const scale = Math.min(800 / image.width, 560 / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          context.drawImage(image, (800 - width) / 2, (560 - height) / 2, width, height);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          reject(new Error("无法读取这张校园平面图。"));
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("无法读取这张校园平面图。"));
      };
      image.src = url;
    });
  }

  $("image-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    const original = draft;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 15000000) {
        throw new Error("请选择 15 MB 以内的 PNG、JPG 或 WebP。");
      }
      const image = await imageAsMap(file);
      if (!editor.open || original !== draft) return;
      saveHistory();
      const { sourceLabel, sourceUrl, shadeNote, modelNote, scenery, ...existing } = draft;
      draft = { ...existing, image, nodes: [], edges: [] };
      setMode("point");
      message("editor-error", "");
    } catch (error) {
      message("editor-error", error.message);
    } finally {
      event.target.value = "";
    }
  });

  $("json-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    const original = draft;
    try {
      if (file.size > 5000000) throw new Error("请选择 5 MB 以内的校园数据文件。");
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("文件不是有效的 JSON。可下载示例查看格式。");
      }
      if (!editor.open || original !== draft) return;
      loadDraft(prepare(data));
    } catch (error) {
      message("editor-error", error.message);
    } finally {
      event.target.value = "";
    }
  });

  function download(data, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = element("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $("save-template").addEventListener("click", () => download(demo, "校园资料示例.json"));
  $("download-campus").addEventListener("click", () => {
    try {
      download(prepare(readSettings()), "校园资料.json");
      message("editor-error", "");
    } catch (error) {
      message("editor-error", error.message);
    }
  });

  function firstConnectedPair(data) {
    const network = new Map(data.nodes.map(node => [node.id, []]));
    for (const edge of data.edges) {
      network.get(edge.from).push(edge.to);
      network.get(edge.to).push(edge.from);
    }
    const places = data.nodes.filter(node => node.name).map(node => node.id);
    const assigned = new Map();
    for (const start of places) {
      if (assigned.has(start)) continue;
      const component = [start];
      assigned.set(start, start);
      for (let index = 0; index < component.length; index++) {
        for (const next of network.get(component[index])) {
          if (assigned.has(next)) continue;
          assigned.set(next, start);
          component.push(next);
        }
      }
      const end = places.find(id => id !== start && assigned.get(id) === start);
      if (end) return [start, end];
    }
    return null;
  }

  $("apply-campus").addEventListener("click", () => {
    try {
      const data = prepare(readSettings());
      if (!firstConnectedPair(data)) throw new Error("请用步道连接至少两个有名称的地点。");
      try {
        localStorage.setItem(storageKey, JSON.stringify(data));
      } catch {
        // The current session remains usable, and the campus can be exported as JSON.
      }
      savedCampus = data;
      setCampus(data);
      editor.close();
    } catch (error) {
      message("editor-error", error.message);
    }
  });

  $("undo-edit").addEventListener("click", () => {
    if (!history.length) return;
    draft = history.pop();
    resetForms();
    drawDraft();
    message("editor-error", "");
  });

  $("reset-demo").addEventListener("click", () => {
    editor.close();
    showSimulation();
  });
  $("simulate").addEventListener("click", showSimulation);
  $("open-real").addEventListener("click", () => {
    if (!exampleCampus) return;
    setCampus(exampleCampus);
    tested = true;
    renderTests();
  });
  $("mode-3d").addEventListener("click", () => setView("3d"));
  $("mode-2d").addEventListener("click", () => setView("2d"));
  walkButton.addEventListener("click", startPlayback);
  $("pause-walk").addEventListener("click", () => {
    if (playbackState === "walking") {
      cancelAnimationFrame(playbackFrame);
      playbackFrame = 0;
      playbackState = "paused";
    } else if (playbackState === "paused") {
      playbackTimestamp = undefined;
      playbackState = "walking";
      playbackFrame = requestAnimationFrame(advancePlayback);
    }
    updatePlaybackControls();
    renderPlaybackPose();
  });
  $("restart-walk").addEventListener("click", restartPlayback);
  $("stop-walk").addEventListener("click", () => {
    clearPlayback();
    setView("2d");
    walkButton.focus({ preventScroll: true });
  });
  $("watch-walker").addEventListener("click", () => {
    setView("3d");
    setPerspective(1);
  });
  $("enter-walker").addEventListener("click", () => {
    setView("3d");
    setPerspective(0);
  });
  $("switch-perspective").addEventListener("click", cyclePerspective);
  document.addEventListener("keydown", event => {
    if (event.key !== "F5" || viewMode !== "3d" || !walkAvailable || editor.open ||
        !model?.setPerspective || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (!event.repeat) cyclePerspective();
  }, { capture: true });
  $("turn-left").addEventListener("click", () => model?.turn(-18));
  $("turn-right").addEventListener("click", () => model?.turn(18));
  $("face-goal").addEventListener("click", () => {
    model?.viewDestination?.();
    $("campus-model").focus({ preventScroll: true });
  });
  $("reset-view").addEventListener("click", () => {
    model?.reset();
    $("campus-model").focus({ preventScroll: true });
  });

  function cyclePerspective() {
    setPerspective((perspectiveIndex + 1) % perspectives.length);
  }

  function setPerspective(index) {
    if (!model?.setPerspective || viewMode !== "3d") return;
    perspectiveIndex = index;
    const { id, label } = perspectives[perspectiveIndex];
    model.setPerspective(id);
    $("camera-perspective").textContent = label;
    updatePlaybackControls();
    $("campus-model").focus({ preventScroll: true });
  }

  for (const button of document.querySelectorAll("[data-move]")) {
    const action = button.dataset.move;
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      button.setPointerCapture(event.pointerId);
      model?.move(action, true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) {
      button.addEventListener(type, () => model?.move(action, false));
    }
    button.addEventListener("keydown", event => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      model?.move(action, true);
    });
    button.addEventListener("keyup", event => {
      if (event.key === " " || event.key === "Enter") model?.move(action, false);
    });
  }

  function setView(requested) {
    viewMode = requested === "3d" && model && walkAvailable ? "3d" : "2d";
    $("map-3d").hidden = viewMode !== "3d";
    $("map-2d").hidden = viewMode !== "2d";
    model?.setEnabled(viewMode === "3d");
    $("map-heading").textContent = viewMode === "3d" ? "漫游校园" : campus?.image ? "校园航拍图" : "校园平面图";
    $("model-source").hidden = viewMode !== "3d";
    $("model-source").textContent = campus?.modelNote || (campus?.demo
      ? "模拟校园 · 建筑和树木布局为示意。" : "地点与步道沿导入地图布置。建筑和树木需在校园数据中提供。");
    $("map-source").hidden = viewMode === "3d" || !$("map-source").hasChildNodes();
    $("mode-3d").setAttribute("aria-pressed", String(viewMode === "3d"));
    $("mode-2d").setAttribute("aria-pressed", String(viewMode === "2d"));
    updatePlaybackControls();
    if (campus) {
      renderBudgetControls();
      render();
    }
  }

  function showSimulation() {
    if (!demo) return;
    timeInput.value = "720";
    setCampus(demo);
    tested = true;
    renderTests();
  }
  $("open-editor").addEventListener("click", () => { if (campus) openEditor(); });
  $("close-editor").addEventListener("click", () => editor.close());
  for (const button of editor.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
  $("edge-kind").addEventListener("change", () => {
    if ($("edge-kind").value === "连廊") {
      for (const index of [0, 1, 2]) {
        const input = $("shade-" + index);
        if (!input.value) input.value = "100";
      }
    }
  });
  function resetPlan() {
    clearPlayback();
    custom = [];
    activeRoute = "shade";
    tested = false;
    render();
  }

  function addCustomPoint(id) {
    if (!id || !Array.from($("custom-next").options).some(option => option.value === id)) return;
    clearPlayback();
    custom = [...custom, id];
    activeRoute = "custom";
    render();
  }

  $("custom-next").addEventListener("change", event => addCustomPoint(event.target.value));
  customControls.addEventListener("toggle", () => {
    if (!campus) return;
    if (customControls.open && !playbackPath) setView("2d");
    else render();
  });
  $("custom-undo").addEventListener("click", () => {
    custom = custom.slice(0, -1);
    activeRoute = custom.length > 1 ? "custom" : "shade";
    render();
  });
  $("custom-clear").addEventListener("click", () => {
    custom = [];
    activeRoute = "shade";
    render();
  });
  map.addEventListener("click", event => {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(map.getScreenCTM().inverse());
    if (placementTool) {
      placePlant(point);
      return;
    }
    if (!customControls.open || !routes?.fast || $("custom-next").disabled) return;
    const options = new Set(Array.from($("custom-next").options, option => option.value).filter(Boolean));
    let nearest;
    let distance = 25;
    for (const node of campus.nodes) {
      if (!options.has(node.id)) continue;
      const next = Math.hypot(point.x - node.x, point.y - node.y);
      if (next < distance) {
        distance = next;
        nearest = node.id;
      }
    }
    addCustomPoint(nearest);
  });
  for (const input of [startInput, endInput]) input.addEventListener("change", resetPlan);
  timeInput.addEventListener("input", () => { if (campus) render(); });
  lightInput.addEventListener("input", () => { if (campus) render(); });
  $("swap").addEventListener("click", () => {
    if (!campus) return;
    const start = startInput.value;
    startInput.value = endInput.value;
    endInput.value = start;
    resetPlan();
  });
  testButton.addEventListener("click", () => {
    tested = true;
    renderTests();
    $("testing").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  function readCampusData(id) {
    return prepare(JSON.parse($(id).textContent));
  }

  function init() {
    try {
      demo = { ...readCampusData("campus-demo-data"), demo: true };
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) savedCampus = prepare(JSON.parse(raw));
        if (savedCampus && !firstConnectedPair(savedCampus)) savedCampus = null;
      } catch {
        savedCampus = null;
      }
      try {
        const candidate = readCampusData("campus-real-data");
        if (firstConnectedPair(candidate)) {
          exampleCampus = candidate;
          $("open-real").hidden = false;
        }
      } catch (error) {
        console.warn("Could not load the campus example", error);
      }
      $("mode-3d").disabled = !model;
      setCampus(savedCampus || exampleCampus || demo);
    } catch (error) {
      console.error("Could not initialize the campus", error);
      $("campus-name").textContent = "校园数据加载失败";
      message("plan-error", "刷新页面后重试。");
      testButton.disabled = true;
    }
  }

  init();
})();
