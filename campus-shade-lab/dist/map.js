(() => {
  const ns = "http://www.w3.org/2000/svg";
  const width = 800;
  const height = 560;
  const walkers = new WeakMap();
  const routeStyles = {
    fast: { color: "#aa632d", dash: "12 9", label: "琥珀色虚线为直达路线" },
    shade: { color: "#216851", dash: "", label: "绿色实线为少晒路线" },
    balanced: { color: "#386F9C", dash: "", label: "蓝色实线为折中路线" },
    custom: { color: "#7154a0", dash: "", label: "紫色实线为自选路线" },
  };
  const fallbackStyle = { color: "#386F9C", dash: "", label: "蓝色实线为备选路线" };

  function routeStyle(kind) {
    return Object.hasOwn(routeStyles, kind) ? routeStyles[kind] : fallbackStyle;
  }

  function add(parent, tag, attributes, content) {
    const shape = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) {
      shape.setAttribute(name, value);
    }
    if (content !== undefined) shape.textContent = content;
    parent.append(shape);
    return shape;
  }

  function pointString(points) {
    return points.map(({ x, y }) => [x, y].join(",")).join(" ");
  }

  function drawLine(layer, points, color, weight, dash = "") {
    if (points.length < 2) return;
    add(layer, "polyline", {
      points: pointString(points),
      fill: "none",
      stroke: color,
      "stroke-width": weight,
      "stroke-dasharray": dash,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
  }

  function drawScenery(layer, campus, hideExisting) {
    const { scenery = campus } = campus;
    const { buildings = [], groves = [], shelters = [], field } = scenery;

    if (!hideExisting && field && field.w > 0 && field.h > 0) {
      const { x, y, w, h } = field;
      const fieldLayer = add(layer, "g", { opacity: "0.9" });
      add(fieldLayer, "rect", {
        x, y, width: w, height: h, rx: Math.min(w, h) / 4,
        fill: "#d9e4c6", stroke: "#b4c6a7", "stroke-width": 1.5,
      });
      add(fieldLayer, "rect", {
        x: x + 8, y: y + 8, width: Math.max(0, w - 16), height: Math.max(0, h - 16),
        rx: Math.max(0, Math.min(w, h) / 4 - 5),
        fill: "none", stroke: "#eff4de", "stroke-width": 1.6,
      });
      if (w > 72 && h > 40) {
        add(fieldLayer, "line", {
          x1: x + w / 2, x2: x + w / 2, y1: y + 12, y2: y + h - 12,
          stroke: "#eff4de", "stroke-width": 1.5,
        });
        add(fieldLayer, "circle", {
          cx: x + w / 2, cy: y + h / 2, r: Math.min(w, h) * 0.14,
          fill: "none", stroke: "#eff4de", "stroke-width": 1.5,
        });
      }
      if (field.label) add(fieldLayer, "text", {
        x: x + w / 2, y: y + h / 2 + 5, "text-anchor": "middle",
        fill: "#52694b", "font-size": 13, "font-weight": 600,
      }, field.label);
    }

    for (const { x, y, x2, y2 } of shelters) {
      const length = Math.hypot(x2 - x, y2 - y);
      if (!Number.isFinite(length) || length < 1) continue;
      const offsetX = (y - y2) * 14 / length;
      const offsetY = (x2 - x) * 14 / length;
      const corners = [
        { x: x + offsetX, y: y + offsetY },
        { x: x2 + offsetX, y: y2 + offsetY },
        { x: x2 - offsetX, y: y2 - offsetY },
        { x: x - offsetX, y: y - offsetY },
      ];
      add(layer, "polygon", {
        points: pointString(corners), fill: "#9ec5b7", "fill-opacity": 0.62,
        stroke: "#39796c", "stroke-width": 1.8, "stroke-dasharray": "5 3",
      });
      for (const corner of corners) {
        add(layer, "circle", { cx: corner.x, cy: corner.y, r: 2.5, fill: "#39796c" });
      }
    }

    for (const { x, y, r = 18, planned = false, type } of groves) {
      if (type === "planter" || (hideExisting && !planned)) continue;
      const trees = add(layer, "g", { transform: "translate(" + x + " " + y + ")" });
      add(trees, "circle", {
        cx: 0, cy: 0, r: r * 1.5, fill: planned ? "#d2e7db" : "#dce5cb", opacity: "0.68",
      });
      for (const [cx, cy, scale, fill] of [
        [-0.4, -0.35, 0.64, "#a4bc95"], [0.44, -0.25, 0.59, "#b3c9a7"],
        [0.15, 0.39, 0.73, "#96b58b"], [-0.5, 0.42, 0.51, "#a9c09d"],
        [0.66, 0.45, 0.43, "#becda9"],
      ]) {
        add(trees, "circle", {
          cx: cx * r, cy: cy * r, r: scale * r,
          fill, stroke: planned ? "#39796c" : "#f1f3e4", "stroke-width": 0.8,
        });
      }
    }

    if (hideExisting) return;
    for (const { x, y, w, h, label } of buildings) {
      add(layer, "rect", {
        x: x + 3, y: y + 5, width: w, height: h, rx: 5, fill: "#aeb1a4", opacity: 0.25,
      });
      add(layer, "rect", {
        x, y, width: w, height: h, rx: 4,
        fill: "#dfe1e6", stroke: "#bfc5ce", "stroke-width": 1.3,
      });
      if (w > 26 && h > 20) {
        add(layer, "path", {
          d: "M " + (x + 6) + " " + (y + h - 6) + " V " + (y + 6) + " H " + (x + w - 6),
          stroke: "#f2f2f5", "stroke-width": 1.5, fill: "none",
        });
      }
      if (label) add(layer, "text", {
        x: x + w / 2, y: y + h / 2 + 5,
        "text-anchor": "middle", fill: "#555f6c", "font-size": 13, "font-weight": 650,
      }, label);
    }
  }

  function drawShadeFootprints(layer, campus, minute, lightLux) {
    const { groves = [], pavilions = [] } = campus.scenery ?? campus;
    const strength = Number.isFinite(lightLux) ? Math.max(0, Math.min(1, lightLux / 100000)) : 0.6;
    if (strength < 0.05) return;

    // Use the same simplified sun direction as the walking scene.
    const hour = Number.isFinite(minute) ? minute / 60 : 12;
    const angle = (hour - 12) * Math.PI / 12;
    const altitude = Math.max(0.29, 0.87 * Math.cos(angle));
    const offsetX = 0.78 * Math.sin(angle) / altitude;
    const offsetY = 0.34 / altitude;
    const opacity = 0.19 + strength * 0.26;
    const shade = add(layer, "g", { "data-layer": "shade-footprints", "pointer-events": "none" });
    for (const { x, y, r = 18, type } of groves) {
      const planter = type === "planter";
      const distance = planter ? 5.5 : r * 0.95;
      add(shade, "ellipse", {
        cx: x + offsetX * distance,
        cy: y + offsetY * distance,
        rx: r * (planter ? 0.6 : 0.94),
        ry: r * (planter ? 0.46 : 0.72),
        fill: "#2c615a", "fill-opacity": opacity,
        stroke: "#e9f1e4", "stroke-opacity": 0.60, "stroke-width": 1,
      });
    }
    for (const { x, y, r = 12 } of pavilions) {
      add(shade, "rect", {
        x: x + offsetX * 10.8 - r, y: y + offsetY * 10.8 - r,
        width: r * 2, height: r * 2, rx: Math.min(3, r * 0.3),
        fill: "#265152", "fill-opacity": opacity,
        stroke: "#e9f1e4", "stroke-opacity": 0.65, "stroke-width": 1,
      });
    }
  }

  function drawShadeBands(layer, campus, positions, minute) {
    const bands = add(layer, "g", { "data-layer": "shade-bands", "pointer-events": "none" });
    for (const edge of campus.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      const fraction = window.CampusRoutes?.shadeAt(edge, minute);
      if (!from || !to || !(fraction > 0)) continue;
      add(bands, "polyline", {
        points: pointString([from, to]), fill: "none", stroke: "#2f9b92",
        "stroke-width": 13 + fraction * 19, "stroke-opacity": 0.14 + fraction * 0.34,
        "stroke-linecap": "round",
      });
    }
  }

  function drawMarker(layer, position, label, color, labelPosition) {
    if (!position) return;
    const { x, y } = position;
    const textHeight = 27;
    const textWidth = 44;
    const labelX = Math.min(width - textWidth - 4, Math.max(4, x - textWidth / 2));
    const chooseBelow = labelPosition === "below" || y < 58;
    const labelY = chooseBelow ? Math.min(height - textHeight - 4, y + 17) : y - 54;
    add(layer, "circle", {
      cx: x, cy: y, r: 12, fill: color, stroke: "#fffdf6", "stroke-width": 4,
    });
    add(layer, "circle", { cx: x, cy: y, r: 3, fill: "#fffdf6" });
    add(layer, "rect", {
      x: labelX, y: labelY, width: textWidth, height: textHeight, rx: 6,
      fill: color, stroke: "#fffdf6", "stroke-width": 1.5,
    });
    add(layer, "text", {
      x: labelX + textWidth / 2, y: labelY + 18,
      "text-anchor": "middle", fill: "#fffdf6", "font-size": 12, "font-weight": 700,
    }, label);
  }

  function drawRoute(layer, route, style, positions, selected) {
    const points = route?.nodes?.map(id => positions.get(id)).filter(Boolean) ?? [];
    const weight = selected ? 7.6 : 4.6;
    drawLine(layer, points, "#fffdf6", weight + 3.6, style.dash);
    drawLine(layer, points, style.color, weight, style.dash);
  }

  function drawPlanter(layer, { x, y, r = 8 }) {
    const planter = add(layer, "g", { transform: "translate(" + x + " " + y + ")" });
    add(planter, "rect", {
      x: -r, y: -r, width: r * 2, height: r * 2, rx: r * .38,
      fill: "#ba7355", stroke: "#fff7eb", "stroke-width": 2.4,
    });
    add(planter, "rect", {
      x: -r + 1.2, y: -r + 1.2, width: r * 2 - 2.4, height: r * 2 - 2.4, rx: r * .28,
      fill: "#b7694c", stroke: "#8d4834", "stroke-width": 1,
    });
    add(planter, "circle", { cx: -r * .24, cy: r * .10, r: r * .50, fill: "#436b47" });
    add(planter, "circle", { cx: r * .21, cy: -r * .22, r: r * .42, fill: "#84a65b" });
    add(planter, "circle", { cx: -r * .12, cy: -r * .29, r: r * .2, fill: "#f4c178" });
  }

  function drawPavilion(layer, { x, y, r = 12, planned = false }) {
    const roof = Math.max(5, r);
    const pavilion = add(layer, "g", {
      transform: "translate(" + x + " " + y + ")", "data-scenery": "pavilion",
    });
    add(pavilion, "title", {}, planned ? "拟建凉亭" : "凉亭");
    add(pavilion, "rect", {
      x: -roof, y: -roof, width: roof * 2, height: roof * 2, rx: roof * 0.1,
      fill: "#39796f", stroke: "#fff8e6", "stroke-width": 4.4,
      "stroke-dasharray": planned ? "5 3" : "",
    });
    add(pavilion, "path", {
      d: "M" + -roof + " " + -roof + "L" + roof + " " + -roof + "L0 0Z",
      fill: "#8cbbab",
    });
    add(pavilion, "path", {
      d: "M" + roof + " " + -roof + "L" + roof + " " + roof + "L0 0Z",
      fill: "#265c54",
    });
    add(pavilion, "path", {
      d: "M" + -roof + " " + -roof + "L" + roof + " " + roof +
        "M" + roof + " " + -roof + "L" + -roof + " " + roof,
      stroke: "#d7e1c6", "stroke-width": 1, fill: "none",
    });
    add(pavilion, "rect", {
      x: -roof, y: -roof, width: roof * 2, height: roof * 2, rx: roof * 0.1,
      fill: "none", stroke: "#704e35", "stroke-width": 1.4,
    });
    add(pavilion, "circle", { r: Math.max(1.5, roof * 0.14), fill: "#e4cf94", stroke: "#704e35" });
  }

  function drawPlacement(layer, { x, y } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const marker = add(layer, "g", { transform: "translate(" + x + " " + y + ")", "pointer-events": "none" });
    add(marker, "circle", { r: 12, fill: "none", stroke: "#fffdf6", "stroke-width": 4.5 });
    add(marker, "circle", { r: 12, fill: "none", stroke: "#2a729a", "stroke-width": 2 });
    add(marker, "path", {
      d: "M-17 0h7 M10 0h7 M0 -17v7 M0 10v7", fill: "none", stroke: "#2a729a", "stroke-width": 2.2,
      "stroke-linecap": "round",
    });
  }

  function moveWalker(svg, pose) {
    let marker = walkers.get(svg);
    if (!Number.isFinite(pose?.x) || !Number.isFinite(pose?.y)) {
      marker?.group.remove();
      walkers.delete(svg);
      return;
    }

    // A redraw removes the marker. During playback only these transforms change.
    if (marker?.group.parentNode !== svg) {
      const group = add(svg, "g", {
        "data-marker": "route-walker", "pointer-events": "none", "aria-hidden": "true",
      });
      const heading = add(group, "g", {});
      add(heading, "path", {
        d: "M0 24L-6.5 11.5H6.5Z", fill: "#65428c", stroke: "#fffaf5",
        "stroke-width": 2, "stroke-linejoin": "round",
      });
      const body = add(group, "circle", {
        r: 13, fill: "#65428c", stroke: "#fffaf5", "stroke-width": 3,
      });
      add(group, "circle", { cx: 1, cy: -6, r: 2, fill: "#fffaf5" });
      add(group, "path", {
        d: "M-4 0l3-2 3 2 3-.5M-1-2l-.5 5 4 4m-4-4-4 4",
        fill: "none", stroke: "#fffaf5", "stroke-width": 1.7,
        "stroke-linecap": "round", "stroke-linejoin": "round",
      });
      marker = { group, heading, body };
      walkers.set(svg, marker);
    }

    marker.group.setAttribute("transform", "translate(" + pose.x + " " + pose.y + ")");
    const heading = Number.isFinite(pose.heading) ? pose.heading : 0;
    marker.heading.setAttribute("transform", "rotate(" + (-heading * 180 / Math.PI) + ")");
    marker.body.setAttribute("fill", pose.walking ? "#7147a2" : "#51366f");
  }

  function draw(svg, campus, {
    start, end, selected, alternate, minute, activeRoute = "shade", suggestions, placement, nextIds,
    showShade = true, lightLux, hideExistingScenery = Boolean(campus.image),
  } = {}) {
    const chosenStyle = routeStyle(activeRoute);
    const hasSelected = selected?.nodes?.length > 1;
    const candidates = suggestions ?? [{ id: activeRoute === "fast" ? "shade" : "fast", route: alternate }];
    const seen = new Set(hasSelected ? [JSON.stringify(selected.nodes)] : []);
    const alternatives = [];
    for (const { id, route } of candidates) {
      if (!route?.nodes || route.nodes.length < 2) continue;
      const key = JSON.stringify(route.nodes);
      if (seen.has(key)) continue;
      seen.add(key);
      alternatives.push({ route, style: routeStyle(id) });
    }
    const description = [];
    if (hasSelected) description.push(chosenStyle.label);
    description.push(...new Set(alternatives.map(({ style }) => style.label)));
    if (showShade && campus.edges.length) description.push("步道色带越宽、颜色越深，表示这一整段的估算遮阴比例越高");
    if (Number.isFinite(minute)) {
      description.push("当前时刻 " + Math.floor(minute / 60) + " 点 " + minute % 60 + " 分");
    }

    svg.replaceChildren();
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("role", "img");
    const label = "校园步行路线图";
    svg.setAttribute("aria-label", [label, ...description].join("。"));
    add(svg, "title", {}, label);
    if (description.length) add(svg, "desc", {}, description.join("。"));
    const graphic = add(svg, "g", {
      "font-family": '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif',
      "aria-hidden": "true",
    });

    add(graphic, "rect", { x: 0, y: 0, width, height, fill: "#f0f1e4" });
    add(graphic, "rect", {
      x: 17, y: 17, width: width - 34, height: height - 34, rx: 19,
      fill: "#f7f5e8", stroke: "#d9ddc8", "stroke-width": 1.5,
    });
    if (typeof campus.image === "string" && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(campus.image)) {
      add(graphic, "image", {
        href: campus.image, x: 0, y: 0, width, height,
        preserveAspectRatio: "none",
      });
    }
    drawScenery(graphic, campus, hideExistingScenery);
    if (showShade) drawShadeFootprints(graphic, campus, minute, lightLux);

    const positions = new Map(campus.nodes.map(node => [node.id, node]));
    if (showShade) drawShadeBands(graphic, campus, positions, minute);
    const edgeLayer = add(graphic, "g", {});
    for (const edge of campus.edges) {
      const points = [positions.get(edge.from), positions.get(edge.to)].filter(Boolean);
      const stairs = edge.kind === "stairs" || edge.kind === "阶梯" || edge.kind === "楼梯";
      drawLine(edgeLayer, points, "#e3dccc", 11);
      drawLine(edgeLayer, points, stairs ? "#9d9a87" : "#fffdf5", stairs ? 3 : 8, stairs ? "2 4" : "");
    }

    const { groves = [], pavilions = [] } = campus.scenery ?? campus;
    for (const pavilion of pavilions) drawPavilion(graphic, pavilion);
    const paths = add(graphic, "g", {});
    for (const { route, style } of alternatives) drawRoute(paths, route, style, positions, false);
    if (hasSelected) drawRoute(paths, selected, chosenStyle, positions, true);
    for (const grove of groves) {
      if (grove.type === "planter" && (!hideExistingScenery || grove.planned)) drawPlanter(graphic, grove);
    }

    const notable = add(graphic, "g", {});
    const eligible = new Set(nextIds ?? []);
    for (const node of campus.nodes) {
      const { id, x, y, name } = node;
      const isEndpoint = id === start || id === end;
      const canSelect = eligible.has(id);
      add(notable, "circle", {
        cx: x, cy: y, r: canSelect ? 6.8 : name ? 4 : 2.5,
        fill: canSelect ? "#7154a0" : name ? "#536859" : "#a8ad97",
        stroke: "#fffdf5", "stroke-width": canSelect ? 2.3 : 1.4,
      });
      if (name && (!isEndpoint || activeRoute === "custom")) {
        const rightEdge = x > width - 83;
        add(notable, "text", {
          x: rightEdge ? x - 8 : x + 8, y: y < 24 ? y + 14 : y - 8,
          "text-anchor": rightEdge ? "end" : "start",
          fill: "#3d574b", stroke: "#faf8ed", "stroke-width": 3, "paint-order": "stroke",
          "font-size": 13, "font-weight": 650,
        }, name);
      }
    }

    const markers = add(graphic, "g", {});
    if (start && end && start === end) {
      drawMarker(markers, positions.get(start), "起终点", "#216851");
    } else {
      const from = positions.get(start);
      const to = positions.get(end);
      const near = from && to && Math.abs(from.x - to.x) < 50 && Math.abs(from.y - to.y) < 34;
      drawMarker(markers, from, "起点", "#216851");
      drawMarker(markers, to, "终点", "#734857", near ? "below" : "above");
    }
    if (placement) drawPlacement(markers, placement);

    if (campus.demo) {
      const compass = add(graphic, "g", { transform: "translate(758 43)" });
      add(compass, "circle", { cx: 0, cy: 0, r: 16, fill: "#faf8ee", stroke: "#c5cbb5" });
      add(compass, "path", { d: "M0 -9 L5 6 L0 3 L-5 6 Z", fill: "#4b6658" });
      add(compass, "text", {
        x: 0, y: -21, "text-anchor": "middle", fill: "#52695b", "font-size": 11, "font-weight": 650,
      }, "北");
    }
  }

  window.CampusMap = { draw, moveWalker };
})();
