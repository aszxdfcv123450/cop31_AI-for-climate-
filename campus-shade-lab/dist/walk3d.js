(() => {
  "use strict";

  const WIDTH = 800;
  const DEPTH = 560;
  const EYE = 3.4;
  const AVATAR_SCALE = 1.42;
  const BUILDING_HEIGHT_SCALE = 1.25;
  const DEFAULT_PITCH = -.12;
  const PERSPECTIVES = new Set(["first", "behind", "front"]);
  const COLORS = { fast: "#aa632d", shade: "#216851", balanced: "#386f9c", custom: "#7154a0" };
  const ACTIONS = { KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back",
    KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };
  const clamp = (value, a, b) => Math.min(b, Math.max(a, value));
  const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const pavilionRoof = 10.8;

  function sunAt(minute) {
    const hour = Number.isFinite(minute) ? minute / 60 : 12;
    const angle = (hour - 12) * Math.PI / 12;
    return [-.78 * Math.sin(angle), .87 * Math.cos(angle), -.34];
  }

  function shadowAreas(scenery, minute) {
    const [sunX, sunY, sunZ] = sunAt(minute);
    const offsetX = -sunX / Math.max(.29, sunY);
    const offsetZ = -sunZ / Math.max(.29, sunY);
    const areas = [];
    for (const { x, y, w, h, height = 32 } of scenery.buildings ?? []) {
      const elevation = Math.min(height, 50);
      areas.push({ x: x + offsetX * elevation, y: y + offsetZ * elevation,
        w, h, layer: .148, color: "#463e28" });
    }
    for (const { x, y, r = 17, type } of scenery.groves ?? []) {
      const span = r * (type === "planter" ? 1.1 : 1.24);
      const elevation = type === "planter" ? 5.5 : r * .95;
      areas.push({ x: x - span / 2 + offsetX * elevation, y: y - span * .44 + offsetZ * elevation,
        w: span, h: span * .88, layer: .151, color: "#3e4e35" });
    }
    for (const { x, y, r = 12 } of scenery.pavilions ?? []) {
      const extent = r * 1.03;
      areas.push({ x: x - extent + offsetX * pavilionRoof, y: y - extent + offsetZ * pavilionRoof,
        w: extent * 2, h: extent * 2, layer: .158, color: "#323c38" });
    }
    return areas;
  }

  const vertexSource = `
    precision mediump float;
    attribute vec3 aPosition;
    attribute vec3 aColor;
    attribute vec3 aNormal;
    attribute float aSurface;
    uniform vec3 uEye;
    uniform vec3 uRight;
    uniform vec3 uUp;
    uniform vec3 uForward;
    uniform float uAspect;
    varying vec3 vWorld;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vSurface;
    varying float vDepth;
    void main() {
      vColor = aColor;
      vNormal = aNormal;
      vSurface = aSurface;
      if (aSurface > 5.5 && aSurface < 6.5) {
        vWorld = uForward + uRight * (aPosition.x * uAspect / 1.32)
          + uUp * (aPosition.y / 1.32);
        vDepth = 0.0;
        gl_Position = vec4(aPosition.xy, 0.9999, 1.0);
        return;
      }
      vec3 offset = aPosition - uEye;
      float depth = dot(offset, uForward);
      vWorld = aPosition;
      vDepth = depth;
      gl_Position = vec4(dot(offset, uRight) * 1.32 / uAspect,
        dot(offset, uUp) * 1.32, depth * 1.00060 - 0.66, depth);
    }`;

  const fragmentSource = `
    precision mediump float;
    uniform vec3 uSun;
    uniform float uLight;
    uniform vec3 uSky;
    uniform float uDetail;
    uniform sampler2D uGround;
    uniform bool uHasGround;
    varying vec3 vWorld;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vSurface;
    varying float vDepth;

    float cellTone(vec3 cell) {
      vec3 value = fract(mod(cell, 97.0) * vec3(0.1031, 0.11369, 0.13787));
      value += dot(value, value.yzx + 13.19);
      return fract((value.x + value.y) * value.z);
    }

    vec3 skyColor(vec3 direction) {
      float altitude = smoothstep(-0.08, 0.63, direction.y);
      vec3 zenith = uSky * vec3(0.66, 0.83, 1.02);
      vec3 color = mix(uSky, zenith, altitude);
      float solar = clamp(dot(direction, normalize(uSun)), 0.0, 1.0);
      float haze = pow(solar, 13.0) * (0.08 + 0.15 * uLight);
      float disk = smoothstep(0.9992, 0.9997, solar) * 0.42 * uLight;
      return min(vec3(1.0), color + (haze + disk) * vec3(1.0, 0.93, 0.71));
    }

    void main() {
      if (vSurface > 5.5 && vSurface < 6.5) {
        gl_FragColor = vec4(skyColor(normalize(vWorld)), 1.0);
        return;
      }

      vec3 color = vColor;
      float detail = 1.0 - smoothstep(64.0 * uDetail, 170.0 * uDetail, vDepth);
      float texture = cellTone(floor(vWorld * 0.86));
      float sheen = 1.0 + (texture - 0.5) * 0.11 * detail;
      if ((vSurface > 0.5 && vSurface < 1.5) || (vSurface > 3.5 && vSurface < 4.5)) {
        float patch = cellTone(vec3(floor(vWorld.xz * 0.29), 8.0));
        sheen *= 1.0 + (patch - 0.5) * 0.17 * detail;
        if (vSurface > 3.5 && uHasGround) {
          color = mix(color, texture2D(uGround, vec2(vWorld.x / 800.0, vWorld.z / 560.0)).rgb, 0.24);
        }
      }
      if (vSurface > 1.5 && vSurface < 2.5) {
        float across = abs(vNormal.x) > 0.5 ? vWorld.z : vWorld.x;
        float row = floor(vWorld.y / 4.8);
        vec2 masonry = vec2((across + mod(row, 2.0) * 3.8) / 7.6, vWorld.y / 4.8);
        vec2 seams = min(fract(masonry), 1.0 - fract(masonry));
        float mortar = 1.0 - smoothstep(0.011, 0.03, min(seams.x, seams.y));
        sheen -= mortar * 0.12 * detail;
        sheen *= 1.0 + (cellTone(vec3(floor(masonry), 12.0)) - 0.5) * 0.12 * detail;
      }
      if (vSurface > 6.5 && vSurface < 7.5) {
        vec2 tile = vWorld.xz / 3.8;
        vec2 seams = min(fract(tile), 1.0 - fract(tile));
        float grout = 1.0 - smoothstep(0.014, 0.04, min(seams.x, seams.y));
        sheen -= grout * 0.10 * detail;
        sheen *= 1.0 + (cellTone(vec3(floor(tile), 42.0)) - 0.5) * 0.12 * detail;
      }
      float sunlight = max(dot(vNormal, normalize(uSun)), 0.0);
      float illumination = 0.67 + uLight * (0.13 + sunlight * 0.28);
      vec3 lightTint = mix(vec3(0.93, 0.97, 1.0), vec3(1.02, 1.00, 0.96), sunlight);
      if (vSurface > 2.5 && vSurface < 3.5) {
        sheen = 1.0;
        illumination = 0.97;
        lightTint = vec3(1.0);
      }
      if (vSurface > 7.5) {
        float across = abs(vNormal.x) > 0.5 ? vWorld.z : vWorld.x;
        float reflection = smoothstep(0.57, 0.83, fract(vWorld.y * 0.15 + across * 0.055));
        color = mix(color, uSky, (0.16 + reflection * 0.19) * (0.6 + 0.4 * uLight));
      }
      vec3 result = color * sheen * illumination * lightTint;
      float fog = smoothstep(260.0, 860.0, vDepth);
      bool isShadow = vSurface > 4.5 && vSurface < 5.5;
      float opacity = isShadow ? 0.24 + uLight * 0.30 : 1.0;
      gl_FragColor = vec4(mix(result, uSky, fog * 0.60), opacity);
    }`;

  function compile(gl, kind, source) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
  }

  function getProgram(gl) {
    const program = gl.createProgram();
    const fragmentPrecision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision;
    const qualifier = fragmentPrecision > 0 ? "precision highp float;" : "precision mediump float;";
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource.replace("precision mediump float;", qualifier));
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource.replace("precision mediump float;", qualifier));
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("3D linking failed");
    return program;
  }

  function create(canvas, { onNode, onPlace, onStatus } = {}) {
    let gl;
    let program;
    try {
      gl = canvas.getContext("webgl", { alpha: false, antialias: true }) ??
        canvas.getContext("experimental-webgl", { alpha: false, antialias: true });
      if (!gl) return null;
      program = getProgram(gl);
    } catch {
      return null;
    }
    gl.useProgram(program);
    const uniforms = Object.fromEntries(["Eye", "Right", "Up", "Forward", "Aspect", "Sun", "Light",
      "Sky", "Detail", "Ground", "HasGround"].map(name => [name, gl.getUniformLocation(program, "u" + name)]));
    const position = gl.getAttribLocation(program, "aPosition");
    const color = gl.getAttribLocation(program, "aColor");
    const normal = gl.getAttribLocation(program, "aNormal");
    const surface = gl.getAttribLocation(program, "aSurface");
    const cells = gl.createBuffer();
    const routeBuffer = gl.createBuffer();
    const shadowBuffer = gl.createBuffer();
    const avatarBuffer = gl.createBuffer();
    const skyBuffer = gl.createBuffer();
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([162, 181, 131, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uniforms.Ground, 0);
    gl.enable(gl.DEPTH_TEST);

    const skyVertices = [];
    for (const [x, y] of [[-1, -1], [3, -1], [-1, 3]]) {
      skyVertices.push(x, y, 0, 0, 0, 0, 0, 1, 0, 6);
    }
    upload(skyBuffer, skyVertices);

    const camera = { x: WIDTH / 2, z: DEPTH / 2, yaw: 0, pitch: DEFAULT_PITCH };
    let perspective = "first";
    let routePlayback = null;
    let playbackLookYaw = 0;
    let playbackLookPitch = DEFAULT_PITCH;
    const keys = new Set();
    const buttons = new Set();
    let campus;
    let options = {};
    let nodes = new Map();
    let blockers = [];
    let drawCount = 0;
    let routeCount = 0;
    let shadowCount = 0;
    let enabled = true;
    let ready = true;
    let frame = 0;
    let previousTime = null;
    let pointer = null;
    let campusKey = null;
    let baseCampus;
    let metersPerUnit = .6;
    let sceneSource;
    let sceneKey;
    let shadowKey;
    let routeSource;
    let routeKey;
    let imageSource;
    let hasGround = false;
    let lastStatus;

    function quad(vertices, corners, tint, direction, type = 0) {
      const colorValues = rgb(tint);
      for (const index of [0, 1, 2, 0, 2, 3]) {
        vertices.push(...corners[index], ...colorValues, ...direction, type);
      }
    }

    function flat(vertices, x, z, w, depth, y, tint, type = 0) {
      quad(vertices, [[x, y, z], [x + w, y, z], [x + w, y, z + depth], [x, y, z + depth]],
        tint, [0, 1, 0], type);
    }

    function box(vertices, x, z, w, depth, bottom, height, palette, material = 0) {
      const [top, southeast, southwest] = palette;
      const above = bottom + height;
      flat(vertices, x, z, w, depth, above, top);
      quad(vertices, [[x, bottom, z], [x + w, bottom, z], [x + w, above, z], [x, above, z]],
        southeast, [0, 0, -1], material);
      quad(vertices, [[x + w, bottom, z], [x + w, bottom, z + depth], [x + w, above, z + depth], [x + w, above, z]],
        southwest, [1, 0, 0], material);
      quad(vertices, [[x + w, bottom, z + depth], [x, bottom, z + depth], [x, above, z + depth], [x + w, above, z + depth]],
        southeast, [0, 0, 1], material);
      quad(vertices, [[x, bottom, z + depth], [x, bottom, z], [x, above, z], [x, above, z + depth]],
        southwest, [-1, 0, 0], material);
    }

    function strip(vertices, from, to, width, height, color, dash = false, material = height > .20 ? 3 : 0) {
      const dx = to.x - from.x;
      const dz = to.y - from.y;
      const length = Math.hypot(dx, dz);
      if (length < .1) return;
      const offsetX = -dz / length * width / 2;
      const offsetZ = dx / length * width / 2;
      const step = dash ? 9 : length;
      for (let offset = 0; offset < length; offset += step) {
        const a = offset / length;
        const b = Math.min(offset + (dash ? 4.8 : step), length) / length;
        quad(vertices, [
          [from.x + dx * a + offsetX, height, from.y + dz * a + offsetZ],
          [from.x + dx * b + offsetX, height, from.y + dz * b + offsetZ],
          [from.x + dx * b - offsetX, height, from.y + dz * b - offsetZ],
          [from.x + dx * a - offsetX, height, from.y + dz * a - offsetZ],
        ], color, [0, 1, 0], material);
      }
    }

    function building(vertices, { x, y, w, h, height, kind }, index) {
      const walls = [
        ["#dad8ba", "#d8c7a8", "#c8b48e"], ["#d7ddc9", "#d4cdb6", "#b5c4a7"],
        ["#c5d7d4", "#c8d9cb", "#aabfb5"], ["#c9d3c7", "#c4cdb9", "#a0b5a7"],
      ][index % 4];
      const originalHeight = height ?? [36, 41, 26, 47, 20, 31][index % 6];
      const roof = originalHeight * BUILDING_HEIGHT_SCALE;
      blockers.push({ x, y, w, h });
      if (kind === "tower" || kind === "gate-pier") {
        const stone = ["#f3dfab", "#d9c79c", "#c6b38f"];
        box(vertices, x, y, w, h, 0, roof, stone, 2);
        box(vertices, x - 1.5, y - 1.5, w + 3, h + 3, roof - 2.4, 2.7, stone);
        const taper = kind === "tower" ? [11, 8, 6, 4] : [2.2, 1.7, 1.3];
        let top = roof;
        for (const [step, rise] of taper.entries()) {
          const inset = (step + 1) * .11;
          box(vertices, x + w * inset, y + h * inset, w * (1 - 2 * inset), h * (1 - 2 * inset),
            top, rise, kind === "tower" ? ["#8b9d8c", "#718d79", "#5f7768"] : stone);
          top += rise;
        }
        return;
      }
      box(vertices, x, y, w, h, 0, roof, walls, 2);
      box(vertices, x - 1.7, y - 1.7, w + 3.4, h + 3.4, roof - 1.2, 2.9,
        ["#78908a", "#768d82", "#647f75"]);
      box(vertices, x + w * .42, y + h * .40, w * .16, h * .20, roof + 1.7, 3.7,
        ["#c5d3c8", "#9caf9d", "#839988"]);
      const upperFloors = Math.min(4, Math.floor(originalHeight / 7));
      const windowHeight = 3.4 * BUILDING_HEIGHT_SCALE;
      const bays = Math.min(11, Math.max(2, Math.floor(w / 9)));
      for (let i = 0; i < bays; i++) {
        for (let floor = 0; floor < upperFloors; floor++) {
          const hx = x + (i + .23) * (w / bays);
          const span = w / bays * .51;
          const level = (4 + floor * 7.3) * BUILDING_HEIGHT_SCALE;
          const glass = ["#678f8e", "#658a86", "#526c6c"];
          box(vertices, hx, y - .14, span, .2, level, windowHeight, glass, 8);
          box(vertices, hx, y + h - .05, span, .21, level, windowHeight, glass, 8);
        }
      }
      const sideBays = Math.min(10, Math.max(2, Math.floor(h / 9)));
      for (let bay = 0; bay < sideBays; bay++) {
        for (let floor = 0; floor < upperFloors; floor++) {
          const offset = y + (bay + .23) * h / sideBays;
          const span = h / sideBays * .51;
          const level = (4 + floor * 7.3) * BUILDING_HEIGHT_SCALE;
          const glass = ["#678f8e", "#658a86", "#526c6c"];
          box(vertices, x - .14, offset, .2, span, level, windowHeight, glass, 8);
          box(vertices, x + w - .05, offset, .21, span, level, windowHeight, glass, 8);
        }
      }
      const doorW = Math.max(5, Math.min(9, w * .15));
      box(vertices, x + w / 2 - doorW / 2, y + h - .01, doorW, .24, 0, 5.1 * BUILDING_HEIGHT_SCALE,
        ["#ebe0bd", "#4c625d", "#425954"]);
    }

    function tree(vertices, { x, y, r = 17, type, planned }, index) {
      if (type === "planter") {
        const span = r * 1.45;
        box(vertices, x - span / 2, y - span / 2, span, span, 0, 2.7,
          ["#b87b51", "#aa6449", "#955038"], 2);
        box(vertices, x - span * .55, y - span * .55, span * 1.1, span * 1.1, 2.3, .6,
          ["#a77650", "#c48967", "#a76248"]);
        box(vertices, x - r * .4, y - r * .38, r * .8, r * .76, 2.9, 2.7,
          ["#91af63", "#648b56", "#4d764a"]);
        box(vertices, x + r * .08, y - r * .22, r * .28, r * .28, 5.6, .9,
          ["#f7c76f", "#de9f54", "#b8a351"]);
        return;
      }
      const trunkHeight = r * .52;
      const girth = r * .18;
      const foliage = planned ? ["#92b772", "#6d9b69", "#51885d"] : [
        ["#a7b967", "#7c9b57", "#698c50"], ["#91ad60", "#76964f", "#5b844b"],
        ["#a1b874", "#809e65", "#6a8d53"],
      ][index % 3];
      box(vertices, x - girth / 2, y - girth / 2, girth, girth, 0, trunkHeight * 1.7,
        ["#9a7855", "#8b6e48", "#705a3e"], 2);
      box(vertices, x - r * .51, y - r * .50, r * 1.02, r, trunkHeight * .91, r * .42, foliage);
      box(vertices, x - r * .62, y - r * .57, r * 1.24, r * 1.14, trunkHeight * 1.42, r * .40, foliage);
      box(vertices, x - r * .47, y - r * .43, r * .92, r * .87, trunkHeight * 2.15, r * .34, foliage);
      box(vertices, x - r * .29, y - r * .22, r * .61, r * .5, trunkHeight * 2.78, r * .16, foliage);
    }

    function shelter(vertices, { x, y, x2, y2 }) {
      const dx = x2 - x;
      const dz = y2 - y;
      const length = Math.hypot(dx, dz);
      if (!Number.isFinite(length) || length < 1) return;
      const from = { x, y };
      const to = { x: x2, y: y2 };
      strip(vertices, from, to, 25, 10.6, "#77aa8e", false, 0);
      strip(vertices, from, to, 23.9, 10, "#6a9b82", false, 0);
      for (const end of [from, to]) {
        for (const side of [-1, 1]) {
          const px = end.x - dz / length * 10 * side - .8;
          const pz = end.y + dx / length * 10 * side - .8;
          box(vertices, px, pz, 1.6, 1.6, 0, 10.5, ["#5f8b75", "#4d7667", "#406358"]);
        }
      }
    }

    function pavilion(vertices, { x, y, r = 12 }) {
      const roof = ["#679486", "#4b776c", "#396259"];
      const trim = ["#e4ba80", "#cc985d", "#b5824e"];
      const post = ["#9b6952", "#815442", "#714734"];
      flat(vertices, x - r * .74, y - r * .74, r * 1.48, r * 1.48, .138, "#e7d5b3");
      for (const horizontal of [-1, 1]) {
        for (const vertical of [-1, 1]) {
          const postX = x + horizontal * r * .65;
          const postZ = y + vertical * r * .65;
          box(vertices, postX - .75, postZ - .75, 1.5, 1.5, 0, pavilionRoof, post, 2);
          box(vertices, postX - 1.05, postZ - 1.05, 2.1, 2.1, .1, .85, trim);
          box(vertices, postX - .95, postZ - .95, 1.9, 1.9, pavilionRoof - 2.4, .45, trim);
        }
      }
      box(vertices, x - r, y - r, r * 2, r * 2, pavilionRoof, .7, trim);
      quad(vertices, [[x - r, pavilionRoof, y - r], [x + r, pavilionRoof, y - r],
        [x + r, pavilionRoof, y + r], [x - r, pavilionRoof, y + r]], "#4e5e4c", [0, -1, 0]);
      for (let tier = 0; tier < 5; tier++) {
        const extent = r * (1.03 - .17 * tier);
        box(vertices, x - extent, y - extent, extent * 2, extent * 2,
          pavilionRoof + .7 + tier * .66, .75, roof);
      }
      box(vertices, x - .78, y - .78, 1.56, 1.56, pavilionRoof + 4.1, .56, trim);
    }

    function upload(buffer, vertices) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      return vertices.length / 10;
    }

    function loadGround(source) {
      if (source === imageSource) return;
      imageSource = source;
      hasGround = false;
      if (typeof source !== "string" || !/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(source)) return;
      const image = new Image();
      image.onload = () => {
        if (imageSource !== source) return;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        hasGround = true;
        invalidate();
      };
      image.src = source;
    }

    function buildScene(scenery) {
      const vertices = [];
      blockers = [];
      flat(vertices, -350, -350, WIDTH + 700, DEPTH + 700, -.15, "#a7bb83", 1);
      flat(vertices, 0, 0, WIDTH, DEPTH, 0, "#b5c789", campus.image ? 4 : 1);
      const { buildings = [], groves = [], shelters = [], pavilions = [], field } = scenery;
      if (field) {
        const { x, y, w, h } = field;
        flat(vertices, x - 5, y - 5, w + 10, h + 10, .019, "#aa7863", 1);
        flat(vertices, x, y, w, h, .035, "#8faf67", 1);
        flat(vertices, x + w / 2 - .35, y + 3, .7, h - 6, .05, "#f1edc6");
      }
      for (const edge of campus.edges ?? []) {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        if (!from || !to) continue;
        strip(vertices, from, to, 13.6, .112, "#9fa977");
        strip(vertices, from, to, 11.5, .133,
          edge.kind === "连廊" ? "#cad2b5" : "#e6d9b4", false, 7);
      }
      buildings.forEach((shape, index) => building(vertices, shape, index));
      groves.forEach((shape, index) => tree(vertices, shape, index));
      shelters.forEach(shape => shelter(vertices, shape));
      pavilions.forEach(shape => pavilion(vertices, shape));
      drawCount = upload(cells, vertices);
    }

    function buildShadows(scenery) {
      const vertices = [];
      const strength = Number.isFinite(options.lightLux) ? clamp(options.lightLux / 100000, 0, 1) : .6;
      if (options.showShade === false || strength < .05) {
        shadowCount = upload(shadowBuffer, vertices);
        return;
      }
      for (const { x, y, w, h, layer, color } of shadowAreas(scenery, options.minute)) {
        flat(vertices, x, y, w, h, layer, color, 5);
      }
      shadowCount = upload(shadowBuffer, vertices);
    }

    function buildRoutes() {
      const vertices = [];
      const selected = options.selected;
      const seen = new Set(selected?.nodes ? [JSON.stringify(selected.nodes)] : []);
      const choices = [...(options.suggestions ?? []), { id: options.activeRoute ?? "shade", route: selected, current: true }];
      let routeLayer = 0;
      for (const { id, route, current } of choices) {
        if (!(route?.nodes?.length > 1)) continue;
        const key = JSON.stringify(route.nodes);
        if (!current && seen.has(key)) continue;
        seen.add(key);
        routeLayer++;
        const color = Object.hasOwn(COLORS, id) ? COLORS[id] : COLORS.balanced;
        const height = .24 + (current ? .05 : routeLayer * .003);
        for (let index = 1; index < route.nodes.length; index++) {
          const from = nodes.get(route.nodes[index - 1]);
          const to = nodes.get(route.nodes[index]);
          if (!from || !to) continue;
          strip(vertices, from, to, current ? 3.9 : 2.5, height, "#fff5cc", id === "fast");
          strip(vertices, from, to, current ? 2.7 : 1.6, height + .011, color, id === "fast");
        }
      }
      const eligible = new Set(options.nextIds ?? []);
      const flags = new Map();
      for (const id of eligible) flags.set(id, COLORS.custom);
      if (options.start) flags.set(options.start, "#559a5a");
      if (options.end) flags.set(options.end, "#b2614d");
      for (const [id, tint] of flags) {
        const target = nodes.get(id);
        if (!target) continue;
        const {x, y} = target;
        flat(vertices, x - 4.2, y - 4.2, 8.4, 8.4, .37, "#fff2cc", 3);
        flat(vertices, x - 3.2, y - 3.2, 6.4, 6.4, .41, tint, 3);
        // The first-person camera starts at the origin, inside a tall marker if it is drawn here.
        if (id === options.start) continue;
        box(vertices, x - .48, y - .48, .96, .96, 0, 9.3, [tint, tint, tint]);
        box(vertices, x - 2.4, y - 2.4, 4.8, 4.8, 8.9, 3.2, [tint, tint, tint]);
      }
      routeCount = upload(routeBuffer, vertices);
    }

    function draw(nextCampus, nextOptions = {}) {
      if (!nextCampus) return;
      campus = nextCampus;
      options = nextOptions;
      const scenery = campus.scenery ?? campus;
      const nextKey = JSON.stringify([campus.name, campus.demo, campus.image?.length ?? 0,
        campus.nodes?.map(({ id, x, y }) => [id, x, y]), options.start]);
      const nextSceneKey = JSON.stringify([nextKey, campus.edges, scenery.buildings,
        scenery.groves, scenery.shelters, scenery.pavilions, scenery.field]);
      const nextShadowKey = JSON.stringify([nextSceneKey, options.minute, options.lightLux, options.showShade]);
      const nextRouteKey = JSON.stringify([nextKey, options.end, options.activeRoute, options.selected?.nodes,
        options.suggestions?.map(({ id, route }) => [id, route?.nodes]), options.nextIds]);
      const originChanged = routeSource !== nextKey || (options.campusKey && baseCampus !== options.campusKey);
      baseCampus = options.campusKey;
      if (nextKey !== campusKey) {
        campusKey = nextKey;
        nodes = new Map((campus.nodes ?? []).map(node => [node.id, node]));
        const scales = (campus.edges ?? []).flatMap(edge => {
          const a = nodes.get(edge.from);
          const b = nodes.get(edge.to);
          const units = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
          return units > 0 && edge.meters > 0 ? [edge.meters / units] : [];
        }).sort((a, b) => a - b);
        metersPerUnit = scales[Math.floor(scales.length / 2)] ?? .6;
        lastStatus = undefined;
      }
      if (sceneSource !== scenery || sceneKey !== nextSceneKey) {
        sceneSource = scenery;
        if (sceneKey !== nextSceneKey) {
          sceneKey = nextSceneKey;
          buildScene(scenery);
        }
      }
      if (shadowKey !== nextShadowKey) {
        shadowKey = nextShadowKey;
        buildShadows(scenery);
      }
      if (originChanged || routeKey !== nextRouteKey) {
        routeSource = nextKey;
        routeKey = nextRouteKey;
        buildRoutes();
      }
      loadGround(campus.image);
      if (originChanged) reset();
      invalidate();
    }

    function blocked(x, z) {
      const within = x >= 2 && x <= WIDTH - 2 && z >= 2 && z <= DEPTH - 2;
      return !within || blockers.some(box => x > box.x - 1.4 && x < box.x + box.w + 1.4 &&
        z > box.y - 1.4 && z < box.y + box.h + 1.4);
    }

    function reset() {
      lastStatus = undefined;
      if (routePlayback) {
        playbackLookYaw = 0;
        playbackLookPitch = DEFAULT_PITCH;
        invalidate();
        return;
      }
      const first = nodes.get(options.start) ?? nodes.values().next().value;
      const pathNext = nodes.get(options.selected?.nodes?.[1]);
      const edge = (campus?.edges ?? []).find(edge => edge.from === first?.id || edge.to === first?.id);
      const neighbor = pathNext ?? nodes.get(edge?.from === first?.id ? edge?.to : edge?.from);
      camera.x = first?.x ?? WIDTH / 2;
      camera.z = first?.y ?? DEPTH / 2;
      camera.yaw = neighbor ? Math.atan2(neighbor.x - camera.x, neighbor.y - camera.z) : 0;
      camera.pitch = DEFAULT_PITCH;
      if (first && blocked(camera.x, camera.z)) {
        for (const [x, z] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-10, 0], [10, 0], [0, -10], [0, 10]]) {
          if (blocked(first.x + x, first.y + z)) continue;
          camera.x = first.x + x;
          camera.z = first.y + z;
          break;
        }
      }
      invalidate();
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) {
        keys.clear();
        buttons.clear();
        pointer = null;
        previousTime = null;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else invalidate();
    }

    function move(action, active) {
      if (!["forward", "back", "left", "right"].includes(action)) return;
      if (routePlayback) return;
      if (active) buttons.add(action);
      else buttons.delete(action);
      invalidate();
    }

    function setPerspective(mode) {
      if (!PERSPECTIVES.has(mode) || perspective === mode) return;
      perspective = mode;
      invalidate();
    }

    function setRoutePlayback(pose) {
      if (pose !== null && (!Number.isFinite(pose?.x) || !Number.isFinite(pose?.y) ||
          !Number.isFinite(pose?.heading))) return;
      if (Boolean(pose) !== Boolean(routePlayback)) {
        keys.clear();
        buttons.clear();
        pointer = null;
        previousTime = null;
        playbackLookYaw = 0;
        playbackLookPitch = DEFAULT_PITCH;
        camera.pitch = DEFAULT_PITCH;
      }
      routePlayback = pose;
      if (pose) {
        camera.x = pose.x;
        camera.z = pose.y;
        camera.yaw = pose.heading;
      }
      invalidate();
    }

    function turn(degrees) {
      if (!Number.isFinite(degrees)) return;
      const radians = degrees * Math.PI / 180;
      if (routePlayback) {
        if (perspective !== "first") return;
        playbackLookYaw -= radians;
      } else camera.yaw -= radians;
      invalidate();
    }

    function viewDestination() {
      const goal = nodes.get(options.end);
      if (goal) {
        const toward = Math.atan2(goal.x - camera.x, goal.y - camera.z);
        if (routePlayback) {
          playbackLookYaw = toward - camera.yaw;
          playbackLookPitch = DEFAULT_PITCH;
        } else {
          camera.yaw = toward;
          camera.pitch = DEFAULT_PITCH;
        }
        invalidate();
      }
    }

    function invalidate() {
      if (!frame && enabled && ready && campus) frame = requestAnimationFrame(render);
    }

    function orientation(yaw, pitch) {
      const sinYaw = Math.sin(yaw);
      const cosYaw = Math.cos(yaw);
      const sinPitch = Math.sin(pitch);
      const cosPitch = Math.cos(pitch);
      return {
        forward: [sinYaw * cosPitch, sinPitch, cosYaw * cosPitch],
        right: [-cosYaw, 0, sinYaw],
        up: [-sinYaw * sinPitch, cosPitch, -cosYaw * sinPitch],
      };
    }

    function viewCamera() {
      if (perspective === "first") {
        const yaw = camera.yaw + (routePlayback ? playbackLookYaw : 0);
        const pitch = routePlayback ? playbackLookPitch : camera.pitch;
        return { eye: [camera.x, EYE, camera.z], ...orientation(yaw, pitch) };
      }

      const facingX = Math.sin(camera.yaw);
      const facingZ = Math.cos(camera.yaw);
      const direction = perspective === "behind" ? -1 : 1;
      const distance = perspective === "behind" ? 12.5 : 10.5;
      // Pull the eye toward the player at the first obstruction, as in a third-person camera rig.
      let available = distance;
      for (let step = .6; step <= distance; step += .6) {
        if (blocked(camera.x + facingX * direction * step, camera.z + facingZ * direction * step)) {
          available = step - .6;
          break;
        }
      }
      const overhead = available < 3.8;
      const height = overhead ? 9.7 : 6.6 + available * .17;
      const effectiveDistance = overhead ? .18 : available;
      const eye = [camera.x + facingX * direction * effectiveDistance, height,
        camera.z + facingZ * direction * effectiveDistance];
      const focusOffset = overhead ? 0 : perspective === "behind" ? 2.1 : 0;
      const targetX = camera.x + facingX * focusOffset;
      const targetZ = camera.z + facingZ * focusOffset;
      const aimX = targetX - eye[0];
      const aimZ = targetZ - eye[2];
      const yaw = Math.atan2(aimX, aimZ);
      const targetHeight = 2.15 * AVATAR_SCALE + clamp(camera.pitch - DEFAULT_PITCH, -.45, .45) * 4.1;
      const pitch = Math.atan2(targetHeight - eye[1], Math.hypot(aimX, aimZ));
      return { eye, ...orientation(yaw, pitch) };
    }

    function groundAt(screenX, screenY, width, height) {
      if (width <= 0 || height <= 0) return null;
      const sideways = (2 * screenX / width - 1) * width / height / 1.32;
      const upward = (1 - 2 * screenY / height) / 1.32;
      const { eye, forward, right, up } = viewCamera();
      const direction = forward.map((value, index) => value + sideways * right[index] + upward * up[index]);
      if (direction[1] >= -.0001) return null;
      const distance = -eye[1] / direction[1];
      const x = eye[0] + direction[0] * distance;
      const y = eye[2] + direction[2] * distance;
      if (x < 0 || x > WIDTH || y < 0 || y > DEPTH) return null;
      return { x, y };
    }

    function drawAvatar(timestamp, walking) {
      const vertices = [];
      const shirt = ["#8fcab5", "#559e8f", "#408074"];
      const pants = ["#7184a7", "#586d97", "#435879"];
      const skin = ["#e6bc90", "#d9a87e", "#ba865f"];
      const hair = ["#604839", "#4c382c", "#3e2b24"];
      const stride = walking ? Math.sin(timestamp / 82) * .24 : 0;
      for (const side of [-1, 1]) {
        const leg = side * stride;
        const arm = -side * stride;
        box(vertices, side * .27 - .23, -.24 + leg, .46, .48, .22, 1.25, pants);
        box(vertices, side * .27 - .24, -.25 + leg, .48, .59, 0, .25,
          ["#f0ecdc", "#ecdfcc", "#8f8271"]);
        box(vertices, side * .72 - .19, -.22 + arm, .38, .44, 1.7, 1.1, shirt);
        box(vertices, side * .72 - .18, -.21 + arm, .36, .42, 1.39, .39, skin);
      }
      box(vertices, -.54, -.29, 1.08, .58, 1.4, 1.47, shirt);
      box(vertices, -.35, -.37, .70, .13, 1.78, .77, ["#daa66e", "#b77b56", "#ae7450"]);
      box(vertices, -.49, -.47, .98, .94, 2.84, .88, skin);
      box(vertices, -.51, -.48, 1.02, .96, 3.55, .32, hair);
      box(vertices, -.50, -.49, 1.00, .27, 3.28, .43, hair);
      for (const x of [-.32, .14]) {
        box(vertices, x, .46, .17, .019, 3.23, .125, ["#253e3c", "#253e3c", "#253e3c"]);
      }

      const sinYaw = Math.sin(camera.yaw);
      const cosYaw = Math.cos(camera.yaw);
      for (let index = 0; index < vertices.length; index += 10) {
        const x = vertices[index] * AVATAR_SCALE;
        const z = vertices[index + 2] * AVATAR_SCALE;
        const nx = vertices[index + 6];
        const nz = vertices[index + 8];
        vertices[index] = camera.x + x * cosYaw + z * sinYaw;
        vertices[index + 1] *= AVATAR_SCALE;
        vertices[index + 2] = camera.z - x * sinYaw + z * cosYaw;
        vertices[index + 6] = nx * cosYaw + nz * sinYaw;
        vertices[index + 8] = -nx * sinYaw + nz * cosYaw;
      }
      useBuffer(avatarBuffer, upload(avatarBuffer, vertices));
    }

    function useBuffer(buffer, count) {
      if (!count) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [location, size, offset] of [[position, 3, 0], [color, 3, 12], [normal, 3, 24], [surface, 1, 36]]) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset);
      }
      gl.drawArrays(gl.TRIANGLES, 0, count);
    }

    function render(timestamp) {
      frame = 0;
      if (!enabled || !ready || !campus) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const nativeRatio = window.devicePixelRatio || 1;
      const pixelRatio = Math.min(nativeRatio, 2.5, Math.sqrt(3600000 / (width * height)));
      const pixelWidth = Math.round(width * pixelRatio);
      const pixelHeight = Math.round(height * pixelRatio);
      if (pixelWidth !== canvas.width || pixelHeight !== canvas.height) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const actions = routePlayback ? new Set() : new Set([...buttons, ...Array.from(keys, key => ACTIONS[key])]);
      const dt = previousTime === null ? 1 / 60 : clamp((timestamp - previousTime) / 1000, 0, .035);
      previousTime = actions.size ? timestamp : null;
      const forward = Number(actions.has("forward")) - Number(actions.has("back"));
      const sideways = Number(actions.has("right")) - Number(actions.has("left"));
      if (forward || sideways) {
        const step = 30 * dt / Math.hypot(forward, sideways);
        const x = (Math.sin(camera.yaw) * forward - Math.cos(camera.yaw) * sideways) * step;
        const z = (Math.cos(camera.yaw) * forward + Math.sin(camera.yaw) * sideways) * step;
        if (!blocked(camera.x + x, camera.z)) camera.x += x;
        if (!blocked(camera.x, camera.z + z)) camera.z += z;
      }

      const hour = (options.minute ?? 720) / 60;
      const strength = Number.isFinite(options.lightLux) ? clamp(options.lightLux / 100000, 0, 1) : .7;
      const warm = clamp(Math.abs(hour - 12) / 5.5, 0, 1);
      const sky = [.64 + strength * .12 + warm * .11, .75 + strength * .10 + warm * .025, .76 + strength * .13 - warm * .10];
      const { eye, right, up, forward: ahead } = viewCamera();
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.clearColor(...sky, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform3f(uniforms.Eye, ...eye);
      gl.uniform3f(uniforms.Right, ...right);
      gl.uniform3f(uniforms.Up, ...up);
      gl.uniform3f(uniforms.Forward, ...ahead);
      gl.uniform3f(uniforms.Sky, ...sky);
      gl.uniform3f(uniforms.Sun, ...sunAt(options.minute));
      gl.uniform1f(uniforms.Light, strength);
      gl.uniform1f(uniforms.Aspect, width / height);
      gl.uniform1i(uniforms.HasGround, Number(hasGround));
      gl.uniform1f(uniforms.Detail, clamp(pixelHeight / 660, 0.56, 1.5));
      gl.disable(gl.DEPTH_TEST);
      useBuffer(skyBuffer, 3);
      gl.enable(gl.DEPTH_TEST);
      useBuffer(cells, drawCount);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      useBuffer(shadowBuffer, shadowCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      useBuffer(routeBuffer, routeCount);
      const walking = routePlayback ? routePlayback.walking : Boolean(forward || sideways);
      if (perspective !== "first") drawAvatar(timestamp, walking);
      if (onStatus) {
        const destination = nodes.get(options.end);
        const distance = destination ? Math.hypot(destination.x - camera.x, destination.y - camera.z) * metersPerUnit : undefined;
        const remaining = distance === undefined ? undefined : Math.round(distance);
        const heading = (Math.round(180 - camera.yaw * 180 / Math.PI) % 360 + 360) % 360;
        let nearest;
        for (const node of nodes.values()) {
          if (!node.name) continue;
          const gap = Math.hypot(node.x - camera.x, node.y - camera.z);
          if (!nearest || gap < nearest.gap) nearest = { node, gap };
        }
        const statusKey = JSON.stringify([destination?.id, nearest?.node.id, remaining, heading]);
        if (statusKey !== lastStatus) {
          lastStatus = statusKey;
          onStatus({ x: camera.x, y: camera.z, nearest: nearest?.node.name ?? "", distance, remaining: distance, heading });
        }
      }
      if (actions.size || (routePlayback?.walking && perspective !== "first")) invalidate();
    }

    function pointerEnd(event, canceled) {
      if (pointer?.id !== event.pointerId) return;
      const tap = !pointer.moved && !canceled;
      pointer = null;
      if (!tap) return;
      const { left, top, width, height } = canvas.getBoundingClientRect();
      const ground = groundAt(event.clientX - left, event.clientY - top, width, height);
      selectAt(ground);
    }

    function interact() {
      if (!enabled || !campus) return;
      const { width, height } = canvas.getBoundingClientRect();
      return selectAt(groundAt(width / 2, height / 2, width, height));
    }

    function selectAt(ground) {
      if (!ground) return;
      if (options.planting) {
        onPlace?.(ground);
        return;
      }
      let target;
      let gap = 13;
      for (const id of options.nextIds ?? []) {
        const node = nodes.get(id);
        if (!node) continue;
        const distance = Math.hypot(node.x - ground.x, node.y - ground.y);
        if (distance > gap) continue;
        target = id;
        gap = distance;
      }
      if (target) onNode?.(target);
    }

    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", event => {
      if (!enabled || pointer || event.button > 0) return;
      canvas.focus({ preventScroll: true });
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener("pointermove", event => {
      if (pointer?.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (!pointer.moved && Math.hypot(dx, dy) < 5) return;
      pointer.moved = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (routePlayback) {
        if (perspective !== "first") return;
        playbackLookYaw -= dx * .0058;
        playbackLookPitch = clamp(playbackLookPitch + dy * .005, -.98, .72);
      } else {
        camera.yaw -= dx * .0058;
        camera.pitch = clamp(camera.pitch + dy * .005, -.98, .72);
      }
      invalidate();
    });
    canvas.addEventListener("pointerup", event => pointerEnd(event, false));
    canvas.addEventListener("pointercancel", event => pointerEnd(event, true));
    canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      ready = false;
      keys.clear();
      buttons.clear();
      onStatus?.({ unavailable: true });
    });
    canvas.addEventListener("keydown", event => {
      if (!enabled) return;
      if ((event.code === "Enter" || event.code === "Space") && !event.repeat) {
        event.preventDefault();
        interact();
        return;
      }
      if (!Object.hasOwn(ACTIONS, event.code)) return;
      event.preventDefault();
      if (routePlayback) return;
      keys.add(event.code);
      invalidate();
    });
    window.addEventListener("keyup", event => keys.delete(event.code));
    window.addEventListener("blur", () => {
      keys.clear();
      buttons.clear();
      pointer = null;
    });
    canvas.addEventListener("blur", () => keys.clear());
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(invalidate).observe(canvas);

    return { draw, setEnabled, move, turn, reset, viewDestination, interact, setPerspective, setRoutePlayback };
  }

  window.CampusWalk3D = { create, shadowAreas };
})();
