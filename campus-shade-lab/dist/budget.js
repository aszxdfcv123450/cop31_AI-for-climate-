(() => {
  "use strict";

  const options = [
    {
      id: "planter", name: "树形盆栽", cost: 800,
      description: "摆放一株带树冠的盆栽，为附近短段步道增添遮阴。", timeframe: "摆放完成后"
    },
    {
      id: "tree", name: "栽种遮阴树", cost: 3000,
      description: "估算树冠成形后能覆盖的邻近步道。", timeframe: "树冠成形后"
    },
    {
      id: "pavilion", name: "凉亭", cost: 8000,
      description: "在地图上选址，为亭顶覆盖的附近步道提供遮阴。", timeframe: "建成后"
    },
    {
      id: "canopy", name: "安装遮阳篷", cost: 6000,
      description: "为所选路段增加一处局部遮挡。", timeframe: "安装完成后"
    },
    {
      id: "shelter", name: "加建固定顶棚", cost: 12000,
      description: "覆盖所选路段中更长的一段。", timeframe: "施工完成后"
    }
  ];
  const byId = new Map(options.map(option => [option.id, option]));

  // Illustrative coverage at 08:00, 12:00, and 16:00.
  const structuralCoverage = {
    canopy: [0.38, 0.48, 0.40],
    shelter: [0.64, 0.68, 0.64]
  };
  const shadeRadiusMeters = {
    planter: [2.5, 2.1, 2.5],
    tree: [7.5, 6.0, 7.5],
    pavilion: [4, 4, 4]
  };

  function isPlant(optionId) {
    return optionId === "tree" || optionId === "planter";
  }

  function isPlaceable(optionId) {
    return Object.hasOwn(shadeRadiusMeters, optionId);
  }

  function hasPosition(item) {
    return Number.isFinite(item.x) && item.x >= 0 && item.x <= 800 &&
      Number.isFinite(item.y) && item.y >= 0 && item.y <= 560;
  }

  function readPlan(plan) {
    const result = new Map();
    for (const item of Array.isArray(plan) ? plan : []) {
      if (!item || !byId.has(item.optionId)) continue;
      const hasId = (typeof item.id === "string" && item.id.length > 0) || Number.isSafeInteger(item.id);
      if (isPlaceable(item.optionId) && hasId && hasPosition(item)) {
        result.set("point:" + item.id, item);
      } else if (item.optionId !== "pavilion" && Number.isInteger(item.edgeIndex) && item.edgeIndex >= 0) {
        result.set(item.edgeIndex, item);
      }
    }
    return result;
  }

  function candidates(campus) {
    const locations = new Map(campus.nodes.map((node, index) => [node.id, {
      name: node.name || node.detail || "路口 " + (index + 1),
      node
    }]));

    return campus.edges.flatMap((edge, edgeIndex) => {
      const from = locations.get(edge.from);
      const to = locations.get(edge.to);
      if (!from || !to) return [];
      return [{
        edgeIndex, label: from.name + " → " + to.name,
        edge, from: from.node, to: to.node
      }];
    }).sort((left, right) =>
      Number(right.edge.kind === "开阔") - Number(left.edge.kind === "开阔") ||
      left.edge.shade[1] - right.edge.shade[1] ||
      left.edgeIndex - right.edgeIndex);
  }

  function summarize(plan, limit) {
    const current = readPlan(plan);
    const total = Array.from(current.values()).reduce((sum, item) => sum + byId.get(item.optionId).cost, 0);
    const remaining = (Number.isFinite(limit) ? limit : 0) - total;
    return { total, remaining, count: current.size, overBudget: remaining < 0 };
  }

  function pointAlong(from, to, progress) {
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress
    };
  }

  function metersPerMapUnit(edges, positions) {
    const ratios = [];
    for (const edge of edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to || !Number.isFinite(edge.meters) || edge.meters <= 0) continue;
      const mapLength = Math.hypot(to.x - from.x, to.y - from.y);
      if (mapLength > 0) ratios.push(edge.meters / mapLength);
    }
    if (!ratios.length) return 1;
    ratios.sort((a, b) => a - b);
    const left = ratios[Math.floor((ratios.length - 1) / 2)];
    const right = ratios[Math.floor(ratios.length / 2)];
    return (left + right) / 2;
  }

  function adjacentPoint(from, to, middle, radius) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const offset = Math.min(8, radius * 0.45) / (Math.hypot(dx, dy) || 1);
    return {
      x: Math.max(0, Math.min(800, middle.x - dy * offset)),
      y: Math.max(0, Math.min(560, middle.y + dx * offset))
    };
  }

  function shadeInterval(from, to, edgeMeters, area, timeIndex, scale) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!length) return null;
    const relativeX = area.x - from.x;
    const relativeY = area.y - from.y;
    const along = (relativeX * dx + relativeY * dy) / length;
    const across = (relativeX * dy - relativeY * dx) / length;
    const radius = shadeRadiusMeters[area.type][timeIndex] / scale;
    if (Math.abs(across) >= radius) return null;

    // A diagram may depict a long path using a short line, so cap the shade
    // length in meters as well as by where its canopy intersects the line.
    const halfSpan = Math.sqrt(radius * radius - across * across) /
      Math.max(length, edgeMeters / scale);
    const middle = along / length;
    const start = Math.max(0, middle - halfSpan);
    const end = Math.min(1, middle + halfSpan);
    return end > start ? [start, end] : null;
  }

  function unionFraction(intervals) {
    intervals.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let previousEnd = 0;
    for (const [start, end] of intervals) {
      covered += Math.max(0, end - Math.max(start, previousEnd));
      previousEnd = Math.max(previousEnd, end);
    }
    return covered;
  }

  function apply(campus, plan) {
    const changes = readPlan(plan);
    if (!changes.size) return campus;

    const positions = new Map(campus.nodes.map(node => [node.id, node]));
    const scenery = campus.scenery ?? { buildings: campus.buildings, groves: campus.groves, field: campus.field };
    const scale = metersPerMapUnit(campus.edges, positions);
    const groves = [...(scenery.groves ?? [])];
    const shelters = [...(scenery.shelters ?? [])];
    const pavilions = [...(scenery.pavilions ?? [])];
    const interventions = [...(scenery.interventions ?? [])];
    const newShadeAreas = [];
    const structures = new Map();
    for (const item of changes.values()) {
      const { edgeIndex } = item;
      const edge = campus.edges[edgeIndex];
      const from = positions.get(edge?.from);
      const to = positions.get(edge?.to);

      const option = byId.get(item.optionId);
      let center;
      if (isPlaceable(option.id)) {
        const radius = Math.max(...shadeRadiusMeters[option.id]) / scale;
        if (hasPosition(item)) {
          center = { x: item.x, y: item.y };
        } else if (from && to) {
          center = adjacentPoint(from, to, pointAlong(from, to, 0.5), radius);
        } else {
          continue;
        }
        const area = {
          ...center,
          r: Math.max(2, Math.min(100, radius)),
          planned: true,
          type: option.id,
          optionId: option.id,
          ...(item.id != null ? { id: item.id } : {}),
          edgeIndex
        };
        if (isPlant(option.id)) groves.push(area);
        else pavilions.push(area);
        newShadeAreas.push(area);
      } else {
        if (!from || !to) continue;
        center = pointAlong(from, to, 0.5);
        const coverage = structuralCoverage[option.id];
        structures.set(edgeIndex, coverage);
        const halfSpan = coverage[1] / 2;
        const start = pointAlong(from, to, 0.5 - halfSpan);
        const end = pointAlong(from, to, 0.5 + halfSpan);
        shelters.push({
          x: start.x, y: start.y, x2: end.x, y2: end.y,
          planned: true, optionId: option.id, edgeIndex
        });
      }
      interventions.push({
        ...center, optionId: option.id, edgeIndex, name: option.name,
        ...(item.id != null ? { id: item.id } : {})
      });
    }

    const edges = campus.edges.map((edge, edgeIndex) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return edge;
      const structure = structures.get(edgeIndex);
      const shade = edge.shade.map((fraction, index) => {
        const intervals = [];
        if (structure) intervals.push([0.5 - structure[index] / 2, 0.5 + structure[index] / 2]);
        for (const area of newShadeAreas) {
          const interval = shadeInterval(from, to, edge.meters, area, index, scale);
          if (interval) intervals.push(interval);
        }
        // Existing shade is an average for the segment. The overlap with it
        // is unknown, so only the estimated exposed share can gain shade.
        return Math.min(1, fraction + (1 - fraction) * unionFraction(intervals));
      });
      return shade.some((fraction, index) => fraction !== edge.shade[index])
        ? { ...edge, shade }
        : edge;
    });

    return {
      ...campus, edges,
      scenery: { ...scenery, groves, shelters, pavilions, interventions }
    };
  }

  window.CampusBudget = { options, isPlant, isPlaceable, candidates, summarize, apply };
})();
