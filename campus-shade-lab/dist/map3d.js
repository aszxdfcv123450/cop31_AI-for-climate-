(() => {
  const groundWidth = 800;
  const groundHeight = 560;
  const baseCamera = { yaw: -0.30, pitch: 0.85, zoom: 1 };
  const routeColors = { fast: "#aa632d", shade: "#216851", balanced: "#386F9C", custom: "#7154a0" };
  const imagePattern = /^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function create(canvas, onNode, onPlace) {
    const ctx = canvas.getContext("2d");
    let campus = null;
    let options = {};
    let groundImage = null;
    let imageSource = null;
    let hitTargets = [];
    let groundPoint = null;
    let camera = { ...baseCamera };
    let pointer = null;
    let frame = 0;

    function invalidate() {
      if (!frame) frame = requestAnimationFrame(render);
    }

    function draw(nextCampus, nextOptions = {}) {
      campus = nextCampus;
      options = nextOptions;
      const source = campus?.image;
      if (source !== imageSource) {
        imageSource = source;
        groundImage = null;
        if (typeof source === "string" && imagePattern.test(source)) {
          const image = new Image();
          image.onload = () => {
            if (imageSource === source) {
              groundImage = image;
              invalidate();
            }
          };
          image.src = source;
        }
      }
      invalidate();
    }

    function rotate(degrees) {
      camera.yaw += degrees * Math.PI / 180;
      invalidate();
    }

    function zoom(factor) {
      camera.zoom = clamp(camera.zoom * factor, 0.60, 2.35);
      invalidate();
    }

    function reset() {
      camera = { ...baseCamera };
      invalidate();
    }

    function setCursor() {
      canvas.style.cursor = pointer?.moved ? "grabbing" :
        options.planting ? "crosshair" : hitTargets.length ? "pointer" : "grab";
    }

    function render() {
      frame = 0;
      if (!ctx || !campus) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width * pixelRatio);
      const pixelHeight = Math.round(height * pixelRatio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const brightness = Number.isFinite(options.lightLux) ? clamp(options.lightLux / 100000, 0, 1) : .7;
      const hour = Number.isFinite(options.minute) ? options.minute / 60 : 12;
      const warmth = clamp(Math.abs(hour - 12) / 6, 0, 1);
      const tint = (red, green, blue) => "rgb(" + [red, green, blue].map(Math.round).join(" ") + ")";
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, tint(219 + 12 * brightness, 231 + 8 * brightness, 227 - 11 * warmth));
      gradient.addColorStop(1, tint(239 + 11 * brightness, 235 + 6 * brightness, 232 - 16 * warmth));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const sinYaw = Math.sin(camera.yaw);
      const cosYaw = Math.cos(camera.yaw);
      const sinPitch = Math.sin(camera.pitch);
      const cosPitch = Math.cos(camera.pitch);
      const spanX = Math.abs(cosYaw) * 800 + Math.abs(sinYaw) * 560;
      const spanDepth = Math.abs(sinYaw) * 800 + Math.abs(cosYaw) * 560;
      const scale = 0.88 * camera.zoom * Math.min(
        width / spanX, height / (spanDepth * sinPitch + 118 * cosPitch));
      const centerX = width / 2;
      const centerY = height * 0.54;

      groundPoint = (screenX, screenY) => {
        const sideways = (screenX - centerX) / scale;
        const forward = (screenY - centerY) / (scale * sinPitch);
        const x = sideways * cosYaw + forward * sinYaw + groundWidth / 2;
        const y = -sideways * sinYaw + forward * cosYaw + groundHeight / 2;
        const tolerance = 1e-8;
        if (x < -tolerance || x > groundWidth + tolerance || y < -tolerance || y > groundHeight + tolerance) {
          return null;
        }
        return { x: clamp(x, 0, groundWidth), y: clamp(y, 0, groundHeight) };
      };

      function project(x, y, z = 0) {
        const dx = x - groundWidth / 2;
        const dy = y - groundHeight / 2;
        const sideways = dx * cosYaw - dy * sinYaw;
        const forward = dx * sinYaw + dy * cosYaw;
        return {
          x: centerX + sideways * scale,
          y: centerY + (forward * sinPitch - z * cosPitch) * scale,
          depth: forward * cosPitch + z * sinPitch,
        };
      }

      function poly(points, fill, stroke, weight = 1) {
        if (!points.length) return;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.closePath();
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = weight;
          ctx.stroke();
        }
      }

      function line(points, color, weight, dash = []) {
        if (points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = weight;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash(dash);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      function rect(x, y, w, h, z) {
        return [project(x, y, z), project(x + w, y, z),
          project(x + w, y + h, z), project(x, y + h, z)];
      }

      function circle(point, radius, fill, stroke, weight = 1, ellipse = 1) {
        ctx.beginPath();
        ctx.ellipse(point.x, point.y, radius, radius * ellipse, 0, 0, 2 * Math.PI);
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = weight;
          ctx.stroke();
        }
      }

      function text(point, value, { fill = "#34564a", size = 12, weight = 600, halo = true } = {}) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = weight + " " + size + 'px "PingFang SC", "Noto Sans SC", sans-serif';
        if (halo) {
          ctx.strokeStyle = "#fffdf4";
          ctx.lineWidth = 3;
          ctx.lineJoin = "round";
          ctx.strokeText(value, point.x, point.y);
        }
        ctx.fillStyle = fill;
        ctx.fillText(value, point.x, point.y);
      }

      const platform = rect(0, 0, groundWidth, groundHeight, 0);
      const underside = rect(0, 0, groundWidth, groundHeight, -30);
      ctx.save();
      ctx.shadowColor = "rgba(58,70,49,0.29)";
      ctx.shadowBlur = 21;
      ctx.shadowOffsetY = 12;
      poly(underside, "#9ba786");
      ctx.restore();
      for (let i = 0; i < platform.length; i++) {
        const next = (i + 1) % platform.length;
        if (platform[next].x < platform[i].x) {
          poly([platform[i], platform[next], underside[next], underside[i]], "#b9b897", "#aeb291");
        }
      }
      const lawn = tint(210 + 10 * brightness, 220 + 10 * brightness, 196 - 7 * warmth);
      const innerLawn = tint(229 + 12 * brightness, 232 + 12 * brightness, 218 - 8 * warmth);
      poly(platform, groundImage ? "#f0efdc" : lawn, "#aab798");
      poly(rect(19, 18, 762, 524, 0.2), groundImage ? "#f0efdc" : innerLawn, "#c5d0ae");

      if (groundImage) {
        const [origin, east, , south] = platform;
        ctx.save();
        ctx.transform(
          (east.x - origin.x) / groundImage.width, (east.y - origin.y) / groundImage.width,
          (south.x - origin.x) / groundImage.height, (south.y - origin.y) / groundImage.height,
          origin.x, origin.y);
        ctx.drawImage(groundImage, 0, 0);
        ctx.restore();
      }

      const { buildings = [], groves = [], shelters = [], field } = campus.scenery ?? campus;
      if (campus.demo) {
        poly(rect(202, 249, 370, 101, .3), "#efead7", "#e2ddc7", 1);
        poly(rect(75, 59, 564, 52, .3), "#dfe8c9");
        poly(rect(74, 101, 54, 192, .3), "#dfe8c9");
        poly(rect(629, 357, 101, 47, .3), "#dfe8c9");
      }
      if (field) {
        const { x, y, w, h } = field;
        poly(rect(x - 6, y - 6, w + 12, h + 12, 0.4), "#b88772", "#ab7d6b", 1);
        poly(rect(x, y, w, h, 0.5), "#a9c492", "#f2edda", 1);
        poly(rect(x + 12, y + 9, w - 24, h - 18, 0.6), "#b7cc9b", "#ecedd7", 1);
        line([project(x + w / 2, y + 9, .7), project(x + w / 2, y + h - 9, .7)], "#ecedd7", 1);
        const midfield = Array.from({ length: 16 }, (_, index) => {
          const angle = index * 2 * Math.PI / 16;
          return project(x + w / 2 + Math.cos(angle) * 11, y + h / 2 + Math.sin(angle) * 11, .7);
        });
        poly(midfield, null, "#ecedd7");
      }

      const positions = new Map((campus.nodes ?? []).map(node => [node.id, node]));
      const edges = campus.edges ?? [];
      for (const edge of edges) {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) continue;
        const path = [project(from.x, from.y, .7), project(to.x, to.y, .7)];
        const pathWidth = clamp(scale * 15, 3, 15);
        const paving = edge.kind === "树荫" ? "#d3ddbc" :
          edge.kind === "连廊" ? "#e4e3d3" : "#faf4df";
        line(path, "#c1c7a9", pathWidth + 1.4);
        line(path, paving, pathWidth);
      }

      function renderRoute(route, kind, prominent) {
        if (!route?.nodes || route.nodes.length < 2) return;
        const points = route.nodes.map(id => positions.get(id)).filter(Boolean)
          .map(node => project(node.x, node.y, 1.6));
        const stroke = prominent ? clamp(scale * 8, 3.2, 8.8) : clamp(scale * 5.3, 2.4, 6.2);
        const dash = kind === "fast" ? [stroke * 1.6, stroke * 1.15] : [];
        line(points, "#fdfbf2", stroke + 2.1, dash);
        const color = Object.hasOwn(routeColors, kind) ? routeColors[kind] : routeColors.balanced;
        line(points, color, stroke, dash);
      }

      const kind = options.activeRoute ?? "shade";
      const candidates = options.suggestions ?? [{
        id: kind === "fast" ? "shade" : "fast", route: options.alternate,
      }];
      const seen = new Set(options.selected?.nodes ? [JSON.stringify(options.selected.nodes)] : []);
      for (const { id, route } of candidates) {
        if (!route?.nodes || route.nodes.length < 2) continue;
        const key = JSON.stringify(route.nodes);
        if (seen.has(key)) continue;
        seen.add(key);
        renderRoute(route, id, false);
      }
      renderRoute(options.selected, kind, true);

      const geometry = [];
      const annotations = [];
      function building(shape, index) {
        const { x, y, w, h, label } = shape;
        const z = Number.isFinite(shape.height) ? shape.height : [53, 68, 44, 76, 34, 49][index % 6];
        const bottom = rect(x, y, w, h, .6);
        const top = rect(x, y, w, h, z);
        const center = project(x + w / 2, y + h / 2, z);
        poly(rect(x + 10, y + 16, w, h, 1), "rgba(93,107,78,0.15)");
        function wall(i, next) {
          if (top[next].x >= top[i].x) return;
          const side = [bottom[i], bottom[next], top[next], top[i]];
          const sidePaint = ["#b9c3c0", "#a5b4b6", "#b1bdb3", "#9faead"][i];
          const windowCount = clamp(Math.floor(Math.hypot(top[next].x - top[i].x, top[next].y - top[i].y) / 12), 1, 11);
          geometry.push({
            depth: (bottom[i].depth + bottom[next].depth) / 2 + z * sinPitch * .16,
            paint() {
              poly(side, sidePaint, "#879d96", .8);
              if (scale < .35 || z < 22) return;
              const start = top[i];
              const end = top[next];
              const faceDepth = bottom[i].y - start.y;
              const wallLength = Math.hypot(end.x - start.x, end.y - start.y);
              if (wallLength < 3) return;
              const half = clamp(scale * 4, 1.7, 5);
              const halfX = (end.x - start.x) / wallLength * half;
              const halfY = (end.y - start.y) / wallLength * half;
              const floors = z >= 57 ? 3 : 2;
              for (let floor = 1; floor <= floors; floor++) {
                for (let slot = 1; slot <= windowCount; slot++) {
                  const offset = slot / (windowCount + 1);
                  const wx = start.x + (end.x - start.x) * offset;
                  const wy = start.y + (end.y - start.y) * offset + faceDepth * floor / (floors + 1);
                  line([{ x: wx - halfX, y: wy - halfY }, { x: wx + halfX, y: wy + halfY }],
                    "#758c85", clamp(scale * 3, 1.2, 3));
                }
              }
            },
          });
        }
        for (let i = 0; i < 4; i++) wall(i, (i + 1) % 4);
        geometry.push({
          depth: Math.max(...bottom.map(point => point.depth)) + z * sinPitch * .16 + .2,
          paint() {
            poly(top, ["#e3e5d8", "#d9e0d0", "#d9dfe0"][index % 3], "#8caa9b", 1);
            if (w > 35 && h > 35) {
              const bevel = rect(x + 5, y + 5, w - 10, h - 10, z + .8);
              poly(bevel, "#d2ddd0", "#eff4e6", .8);
              const roofTrim = rect(x + 6, y + 8, w - 12, h * .13, z + 1.1);
              poly(roofTrim, "#95ae9d");
            }
          },
        });
        if (label) annotations.push(() => text(center, label, { size: width < 500 ? 10 : 12 }));
      }

      function planter({ x, y, r = 8 }) {
        const foot = project(x, y, 1);
        const rim = rect(x - r, y - r, r * 2, r * 2, 12);
        const inset = r * .21;
        const base = rect(x - r + inset, y - r + inset, r * 2 - inset * 2, r * 2 - inset * 2, 1);
        geometry.push({
          depth: foot.depth + 10 * sinPitch,
          paint() {
            for (const [index, corner] of rim.entries()) {
              const next = (index + 1) % rim.length;
              if (rim[next].x < corner.x) {
                poly([corner, rim[next], base[next], base[index]], "#a96144", "#854c38", .9);
              }
            }
            poly(rim, "#c4815e", "#8d4e38", 1.1);
            const leaves = [
              [x - r * .24, y + r * .12, 15, "#426e4a"],
              [x + r * .23, y - r * .11, 16, "#779459"],
              [x - r * .18, y - r * .27, 18, "#f6c484"],
            ];
            for (const [leafX, leafY, height, color] of leaves) {
              const leaf = project(leafX, leafY, height);
              const radius = Math.max(color === "#f6c484" ? 1.8 : 2.4, r * scale * .42);
              circle(leaf, radius, color);
            }
          },
        });
      }

      function tree({ x, y, r = 17, planned = false }, index) {
        const height = r * (1.5 + (index % 4) * .11);
        const foot = project(x, y, 1);
        const center = project(x, y, height * .84);
        const crownRadius = Math.max(3, r * scale * .86);
        const shade = project(x + r * .52, y + r * .65, 1);
        circle(shade, crownRadius * 1.10, "rgba(70,92,63,0.15)", null, 0, sinPitch * .79);
        geometry.push({
          depth: foot.depth + height * sinPitch * .16,
          paint() {
            line([foot, center], "#7b7454", Math.max(1.2, scale * 3.1));
            const foliage = planned ? "#6fa58b" : ["#789e79", "#719774", "#84a776"][index % 3];
            const canopyEdge = planned ? "#39796c" : "#618e6c";
            circle(center, crownRadius, foliage, canopyEdge, planned ? 1.4 : .7);
            circle({ x: center.x - crownRadius * .27, y: center.y - crownRadius * .29 },
              crownRadius * .69, ["#a4bf86", "#91b381", "#b0c793"][index % 3]);
            circle({ x: center.x - crownRadius * .49, y: center.y - crownRadius * .47 },
              crownRadius * .26, "rgba(238,246,207,0.38)");
          },
        });
      }

      function shelter({ x, y, x2, y2 }) {
        const dx = x2 - x;
        const dy = y2 - y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < 1) return;
        const offsetX = -dy * 14 / length;
        const offsetY = dx * 14 / length;
        const corners = [
          [x + offsetX, y + offsetY], [x2 + offsetX, y2 + offsetY],
          [x2 - offsetX, y2 - offsetY], [x - offsetX, y - offsetY],
        ];
        const ground = corners.map(([cx, cy]) => project(cx, cy, 1));
        const eaves = corners.map(([cx, cy]) => project(cx, cy, 27));
        const roof = corners.map(([cx, cy]) => project(cx, cy, 32));
        const depth = Math.max(...ground.map(point => point.depth));
        geometry.push({
          depth,
          paint() {
            const stroke = clamp(scale * 2.4, 1, 3.2);
            for (const [index, foot] of ground.entries()) {
              line([foot, eaves[index]], "#39796c", stroke);
            }
            for (const [index, corner] of roof.entries()) {
              const next = (index + 1) % roof.length;
              if (roof[next].x < corner.x) {
                poly([corner, roof[next], eaves[next], eaves[index]], "#539283", "#39796c", .8);
              }
            }
            poly(roof, "rgba(137,186,167,.72)", "#39796c", .9);
            line([project(x, y, 32.2), project(x2, y2, 32.2)], "#e7f2e5", stroke * .7);
          },
        });
      }

      buildings.forEach(building);
      groves.forEach((grove, index) => {
        if (grove.type === "planter") planter(grove);
        else tree(grove, index);
      });
      shelters.forEach(shelter);
      geometry.sort((one, two) => one.depth - two.depth);
      geometry.forEach(shape => shape.paint());

      const endpoints = new Map();
      if (options.start) endpoints.set(options.start, { text: "起点", color: "#216851" });
      if (options.end) {
        const label = options.start === options.end ? "起终点" : "终点";
        endpoints.set(options.end, { text: label, color: "#8a4f56" });
      }
      const eligible = new Set(options.nextIds ?? []);
      hitTargets = [];
      const markerSize = width < 500 ? 11 : 13;
      for (const node of positions.values()) {
        const endpoint = endpoints.get(node.id);
        const canSelect = eligible.has(node.id);
        if (!endpoint && !node.name && !canSelect) continue;
        const elevated = endpoint || canSelect ? 20 : 10;
        const foot = project(node.x, node.y, 1.8);
        const top = project(node.x, node.y, elevated);
        const color = endpoint?.color ?? (canSelect ? "#7154a0" : "#546c5b");
        const radius = endpoint ? 7 : canSelect ? 5.8 : 3.3;
        if (!campus.demo || endpoint || canSelect) line([foot, top], color, endpoint ? 2.2 : 1.3);
        circle(endpoint || canSelect || !campus.demo ? top : foot, radius, color, "#fffdf4", 1.5);
        if (canSelect) hitTargets.push({ id: node.id, top, foot, radius: 22 });
        if (endpoint) {
          const textPoint = { x: top.x, y: top.y - 13 };
          annotations.push(() => text(textPoint, endpoint.text, { fill: color, size: markerSize, weight: 750 }));
        } else if (node.name && (canSelect || !campus.demo)) {
          const textPoint = { x: top.x, y: top.y - 10 };
          annotations.push(() => text(textPoint, node.name, { fill: color, size: markerSize - 1 }));
        }
      }
      annotations.forEach(paint => paint());
      if (Number.isFinite(options.placement?.x) && Number.isFinite(options.placement?.y)) {
        const { x, y } = project(options.placement.x, options.placement.y, 1.8);
        const radius = 10;
        ctx.beginPath();
        ctx.ellipse(x, y, radius, radius, 0, 0, 2 * Math.PI);
        ctx.strokeStyle = "#fffdf6";
        ctx.lineWidth = 4.5;
        ctx.stroke();
        ctx.strokeStyle = "#2a729a";
        ctx.lineWidth = 2;
        ctx.stroke();
        line([{ x: x - 14, y }, { x: x - 8, y }], "#2a729a", 2);
        line([{ x: x + 8, y }, { x: x + 14, y }], "#2a729a", 2);
        line([{ x, y: y - 14 }, { x, y: y - 8 }], "#2a729a", 2);
        line([{ x, y: y + 8 }, { x, y: y + 14 }], "#2a729a", 2);
      }
      setCursor();
    }

    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", event => {
      if (pointer || event.button > 0) return;
      pointer = { id: event.pointerId, beginX: event.clientX, beginY: event.clientY,
        x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener("pointermove", event => {
      if (pointer?.id !== event.pointerId) return;
      if (!pointer.moved && Math.hypot(event.clientX - pointer.beginX, event.clientY - pointer.beginY) < 5) return;
      pointer.moved = true;
      camera.yaw += (event.clientX - pointer.x) * .0067;
      camera.pitch = clamp(camera.pitch + (event.clientY - pointer.y) * .005, .36, 1.47);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      setCursor();
      invalidate();
    });
    canvas.addEventListener("pointerup", event => {
      if (pointer?.id !== event.pointerId) return;
      const isTap = !pointer.moved;
      pointer = null;
      setCursor();
      if (!isTap) return;
      const { left, top } = canvas.getBoundingClientRect();
      const x = event.clientX - left;
      const y = event.clientY - top;
      if (options.planting) {
        const point = groundPoint?.(x, y);
        if (point) onPlace?.(point);
        return;
      }
      if (!onNode) return;
      let best = null;
      let distance = Infinity;
      for (const target of hitTargets) {
        const gap = Math.min(Math.hypot(target.top.x - x, target.top.y - y),
          Math.hypot(target.foot.x - x, target.foot.y - y));
        if (gap <= target.radius && gap < distance) {
          best = target;
          distance = gap;
        }
      }
      if (best) onNode(best.id);
    });
    canvas.addEventListener("pointercancel", event => {
      if (pointer?.id === event.pointerId) {
        pointer = null;
        setCursor();
      }
    });
    canvas.addEventListener("wheel", event => {
      if (!campus || !canvas.getBoundingClientRect().width) return;
      event.preventDefault();
      zoom(Math.exp(-event.deltaY * .001));
    }, { passive: false });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(invalidate).observe(canvas);

    return { draw, rotate, zoom, reset };
  }

  window.CampusMap3D = { create };
})();
