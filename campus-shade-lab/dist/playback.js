(() => {
  "use strict";

  function prepare(campus, route) {
    if (!Array.isArray(campus?.nodes) || !Array.isArray(route?.nodes) ||
        !route.nodes.length || !Array.isArray(route.edges) ||
        route.edges.length !== route.nodes.length - 1) return null;

    const locations = new Map(campus.nodes.map(node => [node.id, node]));
    const points = [];
    for (const id of route.nodes) {
      const node = locations.get(id);
      if (!Number.isFinite(node?.x) || !Number.isFinite(node?.y)) return null;
      points.push({ x: node.x, y: node.y });
    }

    let meters = 0;
    let lastHeading = null;
    const segments = [];
    for (const [index, edge] of route.edges.entries()) {
      const length = edge?.meters;
      if (!Number.isFinite(length) || length <= 0) return null;
      const from = points[index];
      const to = points[index + 1];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const moving = dx !== 0 || dy !== 0;
      if (moving) lastHeading = Math.atan2(dx, dy);
      const startMeters = meters;
      meters += length;
      if (!Number.isFinite(meters) || meters <= startMeters) return null;
      segments.push({ from, to, startMeters, endMeters: meters, length, heading: lastHeading, moving });
    }

    const firstHeading = segments.find(segment => segment.moving)?.heading ?? 0;
    for (const segment of segments) {
      segment.heading ??= firstHeading;
    }
    return { meters, segments, start: points[0], end: points.at(-1) };
  }

  function sample(path, traveledMeters) {
    if (!path) return null;
    const requested = typeof traveledMeters === "number" && !Number.isNaN(traveledMeters) ? traveledMeters : 0;
    const distance = Math.max(0, Math.min(path.meters, requested));
    if (distance === path.meters) {
      return { ...path.end, heading: path.segments.at(-1)?.heading ?? 0, walking: false };
    }

    const segment = path.segments.find(item => distance < item.endMeters);
    const progress = (distance - segment.startMeters) / segment.length;
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * progress,
      y: segment.from.y + (segment.to.y - segment.from.y) * progress,
      heading: segment.heading,
      walking: segment.moving
    };
  }

  window.CampusRoutePlayback = { prepare, sample };
})();
