export function startLiquidMotion(canvas) {
  if (!canvas) return () => {};
  const abort = new AbortController();
  const listen = (target, type, listener, options = {}) => target.addEventListener(type, listener, { ...options, signal: abort.signal });
  let revealObserver = null;
  let vertexBuffer = null;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  let gl = null;
  let program = null;
  let uniforms = null;
  let frameId = 0;
  let lastTick = 0;
  let lastPaint = 0;
  let elapsed = 0;
  let currentState = 0;
  let targetState = 0;
  let contextLost = false;
  let sectionPoints = [];

  const vertexSource = `
    attribute vec2 aPosition;
    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision highp float;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uState;
    uniform float uCompact;
    uniform vec3 uBg;
    uniform vec3 uFg;
    uniform vec3 uAccent;

    float softBand(float value, float width) {
      return exp(-pow(abs(value) / width, 2.2));
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uResolution.xy;
      vec2 p = uv - 0.5;
      p.x *= uResolution.x / uResolution.y;

      float flow = uTime * 0.055;
      float stateWave = sin(uState * 0.92);
      float center = 0.22 + 0.15 * stateWave;
      float bend = sin(p.y * 5.0 + uState * 1.1 + flow) * 0.085;
      bend += sin(p.y * 10.0 - flow * 0.75 + uState) * 0.022;
      float ridge = softBand(p.x - center - bend, 0.17 + 0.025 * cos(uState));

      float foldCenter = -0.12 + 0.16 * cos(uState * 0.78);
      float fold = softBand(p.y - foldCenter - 0.055 * sin(p.x * 4.0 - uState), 0.12);
      fold *= smoothstep(-0.26, 0.5, p.x);

      vec2 q = p - vec2(0.28 + 0.12 * cos(uState * 1.3), -0.12 + 0.2 * sin(uState * 0.64));
      q.x *= 0.72 + 0.12 * sin(uState);
      float pool = exp(-dot(q, q) * (5.0 + 0.7 * cos(uState)));
      float shape = clamp(max(ridge, fold * 0.72) + pool * 0.36, 0.0, 1.0);

      float grain = sin((p.x + p.y) * 42.0 + flow * 2.0) * 0.018;
      float reflection = 0.5 + 0.5 * sin((p.y * 7.0 - p.x * 4.5) + flow + uState * 0.8);
      reflection = smoothstep(0.18, 0.94, reflection + grain);
      float rim = smoothstep(0.2, 0.8, shape) * (1.0 - smoothstep(0.78, 1.0, shape));
      float shade = clamp(0.12 + reflection * 0.76 + rim * 0.35, 0.0, 1.0);

      vec3 metal = mix(uBg, uFg, shade);
      metal = mix(metal, uAccent, rim * 0.22);

      float rightField = smoothstep(0.34, 0.7, uv.x);
      float outerField = smoothstep(0.2, 0.48, abs(uv.x - 0.5)) * 0.28;
      float spatialMask = max(rightField, outerField);
      float quietCenter = 1.0 - smoothstep(0.0, 0.22, 0.22 - abs(uv.x - 0.48));
      spatialMask *= mix(quietCenter, 1.0, 0.55);
      float alpha = shape * (0.12 + reflection * 0.42 + rim * 0.2) * spatialMask;
      alpha *= mix(0.86, 0.58, uCompact);
      gl_FragColor = vec4(metal, alpha);
    }
  `;

  function makeShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function tokenRgb(name) {
    const sample = document.createElement('canvas');
    sample.width = sample.height = 1;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return new Float32Array([pixel[0] / 255, pixel[1] / 255, pixel[2] / 255]);
  }

  function setupRenderer() {
    gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) return false;
    const vertex = makeShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = makeShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return false;
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;

    gl.useProgram(program);
    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    uniforms = {
      resolution: gl.getUniformLocation(program, 'uResolution'),
      time: gl.getUniformLocation(program, 'uTime'),
      state: gl.getUniformLocation(program, 'uState'),
      compact: gl.getUniformLocation(program, 'uCompact'),
      bg: gl.getUniformLocation(program, 'uBg'),
      fg: gl.getUniformLocation(program, 'uFg'),
      accent: gl.getUniformLocation(program, 'uAccent')
    };
    gl.uniform3fv(uniforms.bg, tokenRgb('--bg'));
    gl.uniform3fv(uniforms.fg, tokenRgb('--fg'));
    gl.uniform3fv(uniforms.accent, tokenRgb('--accent'));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }

  function resizeCanvas() {
    if (!gl) return;
    const compact = window.innerWidth <= 640;
    const ratio = Math.min(window.devicePixelRatio || 1, compact ? 1 : 1.5);
    const width = Math.min(1920, Math.max(1, Math.round(window.innerWidth * ratio)));
    const height = Math.min(1440, Math.max(1, Math.round(window.innerHeight * ratio)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    gl.uniform2f(uniforms.resolution, width, height);
    gl.uniform1f(uniforms.compact, compact ? 1 : 0);
  }

  function measureSections() {
    const selectors = [
      '[data-od-id="hero"]',
      '[data-od-id="decision-explorer"]',
      '[data-od-id="outcome-trace"]',
      '[data-od-id="readiness"]',
      '[data-od-id="closing"]'
    ];
    sectionPoints = selectors.map((selector, state) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { state, y: box.top + window.scrollY + Math.min(box.height * 0.45, window.innerHeight * 0.65) };
    }).filter(Boolean).sort((a, b) => a.y - b.y);
  }

  function smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function updateScrollTarget() {
    if (!sectionPoints.length) return;
    const y = window.scrollY + window.innerHeight * 0.52;
    if (y <= sectionPoints[0].y) targetState = sectionPoints[0].state;
    else if (y >= sectionPoints[sectionPoints.length - 1].y) targetState = sectionPoints[sectionPoints.length - 1].state;
    else {
      for (let index = 0; index < sectionPoints.length - 1; index += 1) {
        const start = sectionPoints[index];
        const end = sectionPoints[index + 1];
        if (y < start.y || y > end.y) continue;
        const progress = (y - start.y) / Math.max(1, end.y - start.y);
        const transition = smoothstep((progress - 0.2) / 0.6);
        targetState = start.state + (end.state - start.state) * transition;
        break;
      }
    }
    if (reduced.matches && gl) {
      currentState = 0;
      drawFrame(0);
    }
  }

  function drawFrame(time) {
    if (!gl || contextLost) return;
    resizeCanvas();
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uniforms.time, time);
    gl.uniform1f(uniforms.state, currentState);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function canRun() {
    return Boolean(gl && !contextLost && !reduced.matches && !document.hidden);
  }

  function stopRenderer() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    lastTick = 0;
  }

  function renderLoop(timestamp) {
    if (!canRun()) {
      stopRenderer();
      return;
    }
    const delta = lastTick ? Math.min(0.1, (timestamp - lastTick) / 1000) : 0;
    lastTick = timestamp;
    elapsed += delta;
    currentState += (targetState - currentState) * (1 - Math.exp(-delta / 0.28));
    if (!lastPaint || timestamp - lastPaint >= 32) {
      drawFrame(elapsed);
      lastPaint = timestamp;
    }
    frameId = requestAnimationFrame(renderLoop);
  }

  function startRenderer() {
    if (canRun() && !frameId) frameId = requestAnimationFrame(renderLoop);
  }

  function syncRenderer() {
    const supported = Boolean(gl && !contextLost);
    const active = supported && !reduced.matches && !document.hidden;
    document.body.dataset.motionState = active ? 'running' : 'paused';
    if (active) startRenderer();
    else stopRenderer();
  }

  function setupReveals() {
    const elements = document.querySelectorAll('.hero-copy, .capital-visual, .section-heading, .hero-foot, .outcome-header, .timeline, .readiness-strip, .closing-inner');
    elements.forEach(element => element.classList.add('motion-reveal'));
    document.body.classList.add('motion-enhanced');
    if (!('IntersectionObserver' in window)) {
      elements.forEach(element => element.classList.add('is-visible'));
      return;
    }
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    elements.forEach(element => revealObserver.observe(element));
  }

  let supported = false;
  try { supported = setupRenderer(); } catch (_) { supported = false; }
  if (!supported) gl = null;
  document.body.dataset.metalRenderer = supported ? 'webgl' : 'fallback';
  measureSections();
  updateScrollTarget();
  currentState = reduced.matches ? 0 : targetState;
  if (supported) drawFrame(0);
  setupReveals();
  syncRenderer();

  let resizeTimer = 0;
  listen(window, 'scroll', updateScrollTarget, { passive: true });
  listen(window, 'resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      measureSections();
      updateScrollTarget();
      if (!canRun()) drawFrame(elapsed);
    }, 120);
  }, { passive: true });
  listen(document, 'visibilitychange', () => {
    syncRenderer();
    if (!document.hidden && !canRun()) drawFrame(elapsed);
  });
  listen(reduced, 'change', () => {
    updateScrollTarget();
    syncRenderer();
    if (!canRun()) drawFrame(0);
  });
  listen(canvas, 'webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    document.body.dataset.metalRenderer = 'fallback';
    syncRenderer();
  });
  return () => {
    abort.abort();
    stopRenderer();
    clearTimeout(resizeTimer);
    revealObserver?.disconnect();
    if (gl) { if (vertexBuffer) gl.deleteBuffer(vertexBuffer); if (program) gl.deleteProgram(program); }
    document.querySelectorAll('.motion-reveal').forEach(element => element.classList.remove('motion-reveal', 'is-visible'));
    document.body.classList.remove('motion-enhanced');
    delete document.body.dataset.motionState;
    delete document.body.dataset.metalRenderer;
  };
}
