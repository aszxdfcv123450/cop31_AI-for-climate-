(function () {
  "use strict";

  const walkingSpeed = 1.2;
  const shadeTimes = [480, 720, 960];
  const epsilon = 1e-9;

  function shadeAt(edge, minute) {
    const time = Number.isFinite(minute) ? minute : shadeTimes[1];
    const samples = shadeTimes.map((_, index) => {
      const fraction = edge.shade?.[index];
      return Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    });
    if (time <= shadeTimes[0]) return samples[0];
    if (time >= shadeTimes[2]) return samples[2];

    const left = time < shadeTimes[1] ? 0 : 1;
    const progress = (time - shadeTimes[left]) / (shadeTimes[left + 1] - shadeTimes[left]);
    return samples[left] + progress * (samples[left + 1] - samples[left]);
  }

  function getRoute(network, start, end, rank, discouraged = null) {
    function precedes(left, right) {
      if (!right) return true;
      if (left.discouraged !== right.discouraged) return left.discouraged < right.discouraged;
      const primaryDifference = rank.score(left) - rank.score(right);
      return Math.abs(primaryDifference) > epsilon
        ? primaryDifference < 0
        : left[rank.secondary] < right[rank.secondary] - epsilon;
    }

    const labels = new Map([[start, { meters: 0, sunMeters: 0, discouraged: 0 }]]);
    const unsettled = new Set([start]);
    const previous = new Map();

    while (unsettled.size) {
      let current;
      let currentLabel;
      for (const node of unsettled) {
        const label = labels.get(node);
        if (precedes(label, currentLabel)) {
          current = node;
          currentLabel = label;
        }
      }
      if (current === end) break;
      unsettled.delete(current);

      for (const neighbor of network.get(current)) {
        const candidate = {
          meters: currentLabel.meters + neighbor.edge.meters,
          sunMeters: currentLabel.sunMeters + neighbor.sunMeters,
          discouraged: currentLabel.discouraged + Number(discouraged?.has(neighbor.key) ?? false)
        };
        if (precedes(candidate, labels.get(neighbor.node))) {
          labels.set(neighbor.node, candidate);
          previous.set(neighbor.node, { node: current, edge: neighbor.edge });
          unsettled.add(neighbor.node);
        }
      }
    }

    const destination = labels.get(end);
    if (!destination) return null;

    const nodes = [end];
    const edges = [];
    for (let node = end; node !== start;) {
      const step = previous.get(node);
      edges.push(step.edge);
      node = step.node;
      nodes.push(node);
    }

    const { meters, sunMeters } = destination;
    const shadeMeters = Math.max(0, meters - sunMeters);
    return {
      nodes: nodes.reverse(),
      edges: edges.reverse(),
      meters,
      sunMeters,
      shadeMeters,
      seconds: meters / walkingSpeed,
      sunSeconds: sunMeters / walkingSpeed,
      shadePercent: meters ? (shadeMeters / meters) * 100 : 0
    };
  }

  const fastest = { score: route => route.meters, secondary: "sunMeters" };
  const leastSun = { score: route => route.sunMeters, secondary: "meters" };
  const blended = factor => ({
    score: route => route.meters + factor * route.sunMeters,
    secondary: "meters"
  });
  const segmentKey = (from, to) => JSON.stringify(from < to ? [from, to] : [to, from]);

  function suggestRoutes(network, start, end, fast, shade) {
    if (!fast || !shade) return [];
    if (start === end) return [{ id: "fast", route: fast }];

    const suggestions = [{ id: "fast", route: fast }];
    const signatures = new Set([JSON.stringify(fast.nodes)]);
    const shadeSignature = JSON.stringify(shade.nodes);
    if (!signatures.has(shadeSignature)) {
      suggestions.push({ id: "shade", route: shade });
      signatures.add(shadeSignature);
    }

    const distanceRange = shade.meters - fast.meters;
    const sunRange = fast.sunMeters - shade.sunMeters;
    const factor = distanceRange > epsilon && sunRange > epsilon ? distanceRange / sunRange : 1;
    const candidates = [];
    function consider(route) {
      if (!route) return;
      const signature = JSON.stringify(route.nodes);
      if (signatures.has(signature)) return;
      signatures.add(signature);
      candidates.push(route);
    }

    // Weighted profiles produce useful trade-offs without enumerating possible paths.
    if (distanceRange > epsilon && sunRange > epsilon) {
      for (const weight of [0.5, 1, 2]) {
        consider(getRoute(network, start, end, blended(weight * factor)));
      }
    }

    // A bounded fallback prefers paths using fewer segments of an existing suggestion.
    // Key by endpoints so a parallel copy of the same path counts as the same segment.
    if (suggestions.length + candidates.length < 3) {
      const seeds = suggestions.map(item => item.route);
      if (seeds.length === 1) {
        const route = getRoute(network, start, end, fastest, routeSegments(fast));
        consider(route);
        if (candidates.length) seeds.push(route);
      }
      for (const seed of seeds) {
        consider(getRoute(network, start, end, blended(factor), routeSegments(seed)));
      }
      if (suggestions.length + candidates.length < 3 && seeds.length > 1) {
        const shared = new Set(seeds.flatMap(seed => [...routeSegments(seed)]));
        consider(getRoute(network, start, end, fastest, shared));
      }
    }

    const genuineTradeoff = route => route.sunMeters < fast.sunMeters - epsilon &&
      route.meters < shade.meters - epsilon;
    const compromise = route => Math.hypot(
      (route.meters - fast.meters) / (distanceRange > epsilon ? distanceRange : fast.meters),
      (route.sunMeters - shade.sunMeters) / (sunRange > epsilon ? sunRange : fast.meters)
    );
    candidates.sort((left, right) =>
      Number(genuineTradeoff(right)) - Number(genuineTradeoff(left)) ||
      compromise(left) - compromise(right) || left.meters - right.meters);
    let alternative = 0;
    let balanced = false;
    for (const route of candidates) {
      if (suggestions.length === 3) break;
      const isBalanced = !balanced && genuineTradeoff(route);
      const id = isBalanced ? "balanced" : "alternative-" + ++alternative;
      suggestions.push({ id, route });
      balanced ||= isBalanced;
    }
    return suggestions;
  }

  function routeSegments(route) {
    return new Set(route.edges.map(edge => segmentKey(edge.from, edge.to)));
  }

  function compute(campus, start, end, minute) {
    const network = new Map((campus?.nodes ?? []).map(({ id }) => [id, []]));
    if (!network.has(start) || !network.has(end)) {
      return { fast: null, shade: null, suggestions: [] };
    }

    for (const edge of campus.edges ?? []) {
      if (!network.has(edge.from) || !network.has(edge.to) ||
          !Number.isFinite(edge.meters) || edge.meters <= 0) continue;

      // A route uses the selected time's shade estimate for every segment.
      const sunMeters = edge.meters * (1 - shadeAt(edge, minute));
      const key = segmentKey(edge.from, edge.to);
      network.get(edge.from).push({ node: edge.to, edge, sunMeters, key });
      network.get(edge.to).push({ node: edge.from, edge, sunMeters, key });
    }

    const fast = getRoute(network, start, end, fastest);
    const shade = getRoute(network, start, end, leastSun);
    return {
      fast, shade, suggestions: suggestRoutes(network, start, end, fast, shade)
    };
  }

  window.CampusRoutes = { compute, shadeAt };
}());
