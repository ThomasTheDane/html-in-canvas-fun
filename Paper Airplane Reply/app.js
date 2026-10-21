import * as THREE from './vendor/three.module.min.js';

/**
 * Paper Airplane Reply — 3D Single-Vertex Origami Folding & HTML-in-Canvas Showcase
 *
 * Implements:
 * 1. Interactive HTML-in-Canvas (<canvas content="drawable"> + <form drawable>)
 *    with WebGL2 texElementSubImage2D, updateElementGeometry, ResizeObserver,
 *    and a synchronized 3D DOM + high-DPI 2D canvas texture fallback.
 * 2. Exact Single-Vertex Origami 3D mesh kinematics starting from a flat rectangular
 *    sheet and folding through 4 realistic stages (Nose Corners -> Center Keel ->
 *    Delta Wings -> Wingtip Stabilizers) with zero triangle self-intersection.
 * 3. Parallel-transported (Bishop frame) 3D flight physics with gravity-modulated
 *    Loop-the-Loop / Barrel Roll flips, wingtip flutter, and twin 3D ribbon contrails.
 */

const canvas = document.getElementById('airplane-canvas');
const stageViewport = document.getElementById('stage-viewport');
const paperForm = document.getElementById('paper-reply-form');
const senderInput = document.getElementById('sender-input');
const messageInput = document.getElementById('message-input');
const senderError = document.getElementById('sender-error');
const senderErrorText = document.getElementById('sender-error-text');
const messageError = document.getElementById('message-error');
const messageErrorText = document.getElementById('message-error-text');
const messageCounter = document.getElementById('message-counter');

const btnSampleNote = document.getElementById('btn-sample-note');
const btnClearForm = document.getElementById('btn-clear-form');
const btnSendAirplane = document.getElementById('btn-send-airplane');
const btnSendLabel = document.getElementById('btn-send-label');

const flightStatusDot = document.getElementById('flight-status-dot');
const flightStatusText = document.getElementById('flight-status-text');
const hicModeBadge = document.getElementById('hic-mode-badge');

const deliveryToast = document.getElementById('delivery-toast');
const toastHeadline = document.getElementById('toast-headline');
const toastDetail = document.getElementById('toast-detail');
const btnReplayFlight = document.getElementById('btn-replay-flight');
const btnNewSheet = document.getElementById('btn-new-sheet');

const foldScrubber = document.getElementById('fold-scrubber');
const foldPercentLabel = document.getElementById('fold-percent-label');
const stagePills = Array.from(document.querySelectorAll('.stage-pill'));
const btnHudReset = document.getElementById('btn-hud-reset');
const btnHudLaunch = document.getElementById('btn-hud-launch');
const flipRadioInputs = Array.from(document.querySelectorAll('input[name="flipStyle"]'));

// ============================================================================
// 1. HTML-IN-CANVAS FEATURE DETECTION & FALLBACK LAYER SETUP
// ============================================================================

const supportsNativeHIC =
  'content' in HTMLCanvasElement.prototype &&
  typeof canvas.captureElementImage === 'function';

if (!supportsNativeHIC) {
  // Fallback strategy per Modern Web Guidance (interactive-content-in-3d-scenes):
  // When native content="drawable" is not supported by the browser, place the
  // interactive HTML form in an overlay layer above the canvas and synchronize
  // its 3D transform while mirroring its live state onto the WebGL paper texture.
  const fallbackLayer = document.createElement('div');
  fallbackLayer.id = 'hic-fallback-layer';
  fallbackLayer.className = 'hic-fallback-layer';
  stageViewport.insertBefore(fallbackLayer, canvas.nextSibling);
  fallbackLayer.appendChild(paperForm);
  if (hicModeBadge) {
    hicModeBadge.textContent = 'WebGL Origami Shader + 3D DOM Sync Active';
  }
} else if (hicModeBadge) {
  hicModeBadge.textContent = 'Native HTML-in-Canvas (texElementSubImage2D) Active';
}

// ============================================================================
// 2. HTML-IN-CANVAS SPEC HELPERS (interactive-content-in-3d-scenes & apply-webgl-shaders)
// ============================================================================

// Returns the element's size in canvas grid pixels, or null if the element
// has no paint record yet.
function getElementImageSize(targetCanvas, element) {
  let elementImage;
  try {
    elementImage = targetCanvas.captureElementImage(element);
  } catch (_err) {
    if (typeof targetCanvas.requestPaint === 'function') {
      targetCanvas.requestPaint(); // No paint record yet: retry on the next paint event.
    }
    return null;
  }
  const width = Math.ceil(elementImage.width);
  const height = Math.ceil(elementImage.height);
  elementImage.close();
  return width > 0 && height > 0 ? { width, height } : null;
}

// Binds the texture, and allocates its storage on the first upload, and when
// the element size changes. `state` stores the allocated size.
function allocateElementTexture(gl, texture, state, width, height) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (state.width === width && state.height === height) return;

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,                // Mipmap level
    gl.RGBA8,         // Internal format: 8 bits per RGBA channel
    width,            // Size in canvas grid pixels
    height,
    0,                // Border: must be 0
    gl.RGBA,          // Format and type that match RGBA8
    gl.UNSIGNED_BYTE,
    null              // null reserves GPU memory without uploading pixels
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  state.width = width;
  state.height = height;
}

// Uploads the element into the texture. Returns false if the element has no
// paint record yet. In that case, it's uploaded on the next paint event.
function uploadElementWebGL(gl, targetCanvas, texture, element, state) {
  const size = getElementImageSize(targetCanvas, element);
  if (!size) return false;
  const { width, height } = size;

  allocateElementTexture(gl, texture, state, width, height);
  gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, element, { width, height });
  return true;
}

// Maps the element's border box (CSS pixels) to the canvas (CSS pixels), for a
// quad that spans -0.5 to 0.5 in model space and is drawn with the `mvp` matrix.
function computeCanvasTransform(targetCanvas, element, mvp) {
  const width = Math.max(1, element.offsetWidth || 440);
  const height = Math.max(1, element.offsetHeight || 544);

  // 1. Normalize the HTML element (CSS pixels -> WebGL Model Space)
  const toGLModel = new DOMMatrix()
    .scale(1 / width, -1 / height, 1 / height)
    .translate(-width / 2, -height / 2);

  // 2. Convert WebGL MVP Matrix to DOM Matrix
  const mvpDOM = new DOMMatrix(Array.from(mvp));

  // 3. Map to the canvas viewport, in CSS pixels
  const clipToCanvasViewport = new DOMMatrix()
    .translate(targetCanvas.clientWidth / 2, targetCanvas.clientHeight / 2)
    .scale(targetCanvas.clientWidth / 2, -targetCanvas.clientHeight / 2, targetCanvas.clientHeight / 2);

  // 4. Multiply: (Clip -> Pixels) * (MVP) * (pixels -> unit square)
  return clipToCanvasViewport.multiply(mvpDOM).multiply(toGLModel);
}

// ============================================================================
// 3. THREE.JS SCENE, CAMERA, SKY ENVIRONMENT & LIGHTING
// ============================================================================

const gl = canvas.getContext('webgl2', {
  alpha: false,
  antialias: true,
  powerPreference: 'high-performance'
});

const renderer = new THREE.WebGLRenderer({
  canvas,
  context: gl,
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 220);
camera.position.set(0, 0, 7.2);
camera.lookAt(0, 0, 0);

// Atmospheric Sky & Golden Horizon Backdrop Dome
const skyGeo = new THREE.SphereGeometry(165, 32, 24);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorldPos;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec3 vWorldPos;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main() {
      vec3 dir = normalize(vWorldPos);
      float elev = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

      vec3 deepZenith = vec3(0.06, 0.14, 0.30);
      vec3 midSky = vec3(0.14, 0.34, 0.62);
      vec3 warmHorizon = vec3(0.96, 0.64, 0.36);
      vec3 lowerMist = vec3(0.11, 0.19, 0.34);

      vec3 skyCol = mix(lowerMist, warmHorizon, smoothstep(0.32, 0.50, elev));
      skyCol = mix(skyCol, midSky, smoothstep(0.48, 0.70, elev));
      skyCol = mix(skyCol, deepZenith, smoothstep(0.68, 0.96, elev));

      // Distant golden sun glow along the flight corridor (-Z, slightly +X/+Y)
      vec3 sunDir = normalize(vec3(0.16, 0.12, -1.0));
      float sunCos = max(0.0, dot(dir, sunDir));
      skyCol += vec3(1.0, 0.78, 0.45) * pow(sunCos, 18.0) * 0.48;
      skyCol += vec3(1.0, 0.95, 0.80) * pow(sunCos, 160.0) * 0.75;

      // Soft drifting cloud bands near the horizon
      vec2 cloudUv = dir.xy * vec2(3.5, 9.0) + vec2(uTime * 0.015, 0.0);
      float c = noise(cloudUv) * 0.65 + noise(cloudUv * 2.3) * 0.35;
      float cloudBand = smoothstep(0.44, 0.58, elev) * (1.0 - smoothstep(0.58, 0.76, elev));
      float cloudMask = smoothstep(0.48, 0.75, c) * cloudBand;
      skyCol = mix(skyCol, vec3(1.0, 0.91, 0.78), cloudMask * 0.42);

      gl_FragColor = vec4(skyCol, 1.0);
    }
  `
});
const skyDome = new THREE.Mesh(skyGeo, skyMat);
scene.add(skyDome);

// Ambient & Directional Studio/Sunlight
const ambientLight = new THREE.AmbientLight(0xffeedd, 0.85);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff4dc, 1.9);
keyLight.position.set(4.5, 7.5, 6.5);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xf59e0b, 1.1);
rimLight.position.set(-5.0, 2.5, -8.0);
scene.add(rimLight);

// Floating Wind Stream Motes in the 3D Sky
const windMoteCount = 260;
const windMoteGeo = new THREE.BufferGeometry();
const windMotePos = new Float32Array(windMoteCount * 3);
const windMoteScale = new Float32Array(windMoteCount);

for (let i = 0; i < windMoteCount; i++) {
  windMotePos[i * 3] = (Math.random() - 0.5) * 34;
  windMotePos[i * 3 + 1] = (Math.random() - 0.35) * 20;
  windMotePos[i * 3 + 2] = 5 - Math.random() * 90;
  windMoteScale[i] = 0.5 + Math.random() * 1.4;
}
windMoteGeo.setAttribute('position', new THREE.BufferAttribute(windMotePos, 3));
windMoteGeo.setAttribute('aScale', new THREE.BufferAttribute(windMoteScale, 1));

const windMoteMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
  },
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uPixelRatio;
    attribute float aScale;
    varying float vAlpha;
    void main() {
      vec3 pos = position;
      pos.z = 6.0 - mod(6.0 - pos.z - uTime * (1.8 + aScale * 0.8), 92.0);
      pos.x += sin(uTime * 0.7 + pos.z * 0.12) * 0.35;
      pos.y += cos(uTime * 0.9 + pos.x * 0.15) * 0.25;
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = (14.0 * aScale * uPixelRatio) / max(1.0, -mv.z);
      vAlpha = smoothstep(-90.0, -15.0, pos.z) * (0.35 + 0.35 * sin(uTime * 2.5 + aScale * 6.0));
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      float glow = smoothstep(0.5, 0.05, d);
      gl_FragColor = vec4(vec3(1.0, 0.92, 0.76), glow * vAlpha);
    }
  `
});
const windMotes = new THREE.Points(windMoteGeo, windMoteMat);
scene.add(windMotes);

// ============================================================================
// 4. HIGH-DPI LIVE PAPER STATIONERY TEXTURE MIRROR (880 x 1088)
// ============================================================================

const PAPER_HALF_W = 1.70;  // Full width 2W = 3.40
const PAPER_HALF_H = 2.102; // Full length 2H = 4.204 (matches 440 : 544 aspect ratio)

const livePaperCanvas = document.createElement('canvas');
livePaperCanvas.width = 880;
livePaperCanvas.height = 1088;
const paperCtx = livePaperCanvas.getContext('2d');

const fallbackPaperTexture = new THREE.CanvasTexture(livePaperCanvas);
fallbackPaperTexture.colorSpace = THREE.SRGBColorSpace;
fallbackPaperTexture.minFilter = THREE.LinearFilter;
fallbackPaperTexture.magFilter = THREE.LinearFilter;

const nativeGLTexture = gl.createTexture();
const nativeTextureState = { width: 0, height: 0 };

function drawAirmailStripes(ctx, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y, w, h);
  ctx.clip();

  ctx.fillStyle = '#fdf9ee';
  ctx.fillRect(0, y, w, h);

  const stripeStep = 56;
  for (let x = -h * 2; x < w + h * 2; x += stripeStep) {
    // Red parallelogram
    ctx.fillStyle = '#d93829';
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + 18, y + h);
    ctx.lineTo(x + 18 + h, y);
    ctx.lineTo(x + h, y);
    ctx.closePath();
    ctx.fill();

    // Blue parallelogram
    const bx = x + 28;
    ctx.fillStyle = '#1b4f9c';
    ctx.beginPath();
    ctx.moveTo(bx, y + h);
    ctx.lineTo(bx + 18, y + h);
    ctx.lineTo(bx + 18 + h, y);
    ctx.lineTo(bx + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function renderLivePaperTexture() {
  const ctx = paperCtx;
  const w = livePaperCanvas.width;   // 880
  const h = livePaperCanvas.height;  // 1088
  ctx.clearRect(0, 0, w, h);

  // 1. Warm Cream Paper Stock Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, '#fdf9ee');
  bgGrad.addColorStop(1, '#f3e7cc');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Subtle paper border
  ctx.strokeStyle = '#d5c4a1';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  // 2. Top & Bottom Airmail Chevron Borders
  drawAirmailStripes(ctx, 0, w, 18);
  drawAirmailStripes(ctx, h - 18, w, 18);

  // 3. Origami Fold Crease Guides on the Paper Surface
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2;

  // Center vertical spine crease
  ctx.strokeStyle = 'rgba(27, 79, 156, 0.26)';
  ctx.beginPath();
  ctx.moveTo(w / 2, 20);
  ctx.lineTo(w / 2, h - 20);
  ctx.stroke();

  // Left & Right 45° nose corner fold creases
  ctx.strokeStyle = 'rgba(217, 56, 41, 0.25)';
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(0, w / 2);
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w, w / 2);
  ctx.stroke();

  // Left & Right Keel / Wing creases from nose apex
  ctx.strokeStyle = 'rgba(27, 79, 156, 0.18)';
  const keelXOffset = Math.tan((9.5 * Math.PI) / 180) * h;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2 - keelXOffset, h);
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2 + keelXOffset, h);
  ctx.stroke();
  ctx.restore();

  // 4. Header: PAR AVION Title & Express Postage Stamp
  ctx.fillStyle = '#1b4f9c';
  ctx.font = '900 30px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('PAR AVION • AIRMAIL REPLY', 52, 78);

  ctx.fillStyle = '#d93829';
  ctx.font = '700 21px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('FOLD ALONG CREASES & LAUNCH', 52, 108);

  // Header divider line
  ctx.strokeStyle = '#14284b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(52, 180);
  ctx.lineTo(w - 52, 180);
  ctx.stroke();

  // Postage Stamp Box (top right)
  ctx.save();
  ctx.translate(w - 110, 98);
  ctx.rotate((2.5 * Math.PI) / 180);
  ctx.fillStyle = '#fff8eb';
  ctx.fillRect(-58, -64, 116, 128);
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#d93829';
  ctx.lineWidth = 4;
  ctx.strokeRect(-58, -64, 116, 128);
  ctx.setLineDash([]);
  ctx.fillStyle = '#d93829';
  ctx.textAlign = 'center';
  ctx.font = '800 18px sans-serif';
  ctx.fillText('3D • HIC', 0, -34);
  ctx.font = '42px sans-serif';
  ctx.fillText('✈', 0, 14);
  ctx.fillStyle = '#1b4f9c';
  ctx.font = '800 17px sans-serif';
  ctx.fillText('EXPRESS', 0, 44);
  ctx.restore();

  // 5. Sender Field Box & Live Sender Text
  ctx.textAlign = 'left';
  ctx.fillStyle = '#14284b';
  ctx.font = '800 25px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('FROM (SENDER) *', 52, 232);

  ctx.fillStyle = '#5a6b87';
  ctx.textAlign = 'right';
  ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('Shown on left wing', w - 52, 232);

  // Input box background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.strokeStyle = '#8fa3c4';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(52, 248, w - 104, 96, 8);
  ctx.fill();
  ctx.stroke();

  const senderVal = (senderInput?.value || '').trim() || 'Anonymous Pilot';
  ctx.fillStyle = '#14284b';
  ctx.textAlign = 'left';
  ctx.font = 'bold 34px "Courier New", Courier, monospace';
  ctx.fillText(senderVal.slice(0, 38), 76, 308);

  // 6. Message Field Box, Ruled Lines & Live Wrapped Message Text
  ctx.fillStyle = '#14284b';
  ctx.font = '800 25px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('MESSAGE *', 52, 398);

  const rawMsg = messageInput?.value || '';
  ctx.fillStyle = '#5a6b87';
  ctx.textAlign = 'right';
  ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`${rawMsg.length} / 360 chars`, w - 52, 398);

  const msgBoxY = 414;
  const msgBoxH = 470;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.strokeStyle = '#8fa3c4';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(52, msgBoxY, w - 104, msgBoxH, 8);
  ctx.fill();
  ctx.stroke();

  // Horizontal ruled stationery lines inside message box
  ctx.strokeStyle = 'rgba(27, 79, 156, 0.18)';
  ctx.lineWidth = 2;
  for (let ly = msgBoxY + 56; ly < msgBoxY + msgBoxH - 16; ly += 52) {
    ctx.beginPath();
    ctx.moveTo(68, ly);
    ctx.lineTo(w - 68, ly);
    ctx.stroke();
  }

  // Wrap and render the user's message text safely via fillText
  ctx.fillStyle = '#14284b';
  ctx.textAlign = 'left';
  ctx.font = 'bold 30px "Courier New", Courier, monospace';
  const maxTextWidth = w - 156;
  const paragraphs = (rawMsg || 'Ready for takeoff!').split('\n');
  let lineY = msgBoxY + 48;
  const maxLineY = msgBoxY + msgBoxH - 22;

  for (let p = 0; p < paragraphs.length; p++) {
    const words = paragraphs[p].split(' ');
    let currentLine = '';
    for (let i = 0; i < words.length; i++) {
      const testLine = currentLine ? `${currentLine} ${words[i]}` : words[i];
      if (ctx.measureText(testLine).width > maxTextWidth && currentLine) {
        if (lineY <= maxLineY) {
          ctx.fillText(currentLine, 78, lineY);
        }
        currentLine = words[i];
        lineY += 52;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine && lineY <= maxLineY) {
      ctx.fillText(currentLine, 78, lineY);
      lineY += 52;
    }
  }

  // 7. Footer Buttons Visual Representation
  ctx.fillStyle = 'rgba(20, 40, 75, 0.08)';
  ctx.strokeStyle = 'rgba(20, 40, 75, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(52, 922, 165, 92, 8);
  ctx.roundRect(230, 922, 125, 92, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#14284b';
  ctx.textAlign = 'center';
  ctx.font = '700 23px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('↻ Sample', 134, 976);
  ctx.fillText('✕ Clear', 292, 976);

  // Red Send Button
  const sendGrad = ctx.createLinearGradient(372, 922, w - 52, 1014);
  sendGrad.addColorStop(0, '#d93829');
  sendGrad.addColorStop(1, '#b91c1c');
  ctx.fillStyle = sendGrad;
  ctx.beginPath();
  ctx.roundRect(372, 922, w - 424, 92, 10);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('✈ Send & Fold Airplane', 372 + (w - 424) / 2, 978);

  fallbackPaperTexture.needsUpdate = true;
}

renderLivePaperTexture();

// ============================================================================
// 5. SINGLE-VERTEX ORIGAMI 3D MESH & KINEMATICS ENGINE
// ============================================================================

/**
 * Exact Single-Vertex Origami Crease Angles from the Nose Apex A = (0, +H, 0),
 * measured in radians from the downward spine vector (0, -1, 0):
 * - THETA_KEEL (9.5°): separates the central vertical fuselage keel from the main wing.
 * - THETA_TIP (18.8°): separates the main delta wing from the outer wingtip stabilizer.
 * - THETA_BR (~22.02°): exact ray to the bottom corners (±W, -H) of the rectangular sheet.
 * - THETA_CORNER (45.0°): diagonal fold crease for the top-left and top-right nose corners.
 * - THETA_SPLIT_TIP (71.2° = 90° - THETA_TIP): reflects onto THETA_TIP when corner folds 180°.
 * - THETA_SPLIT_KEEL (80.5° = 90° - THETA_KEEL): reflects onto THETA_KEEL when corner folds 180°.
 */
const DEG2RAD = Math.PI / 180;
const THETA_KEEL = 9.5 * DEG2RAD;
const THETA_TIP = 18.8 * DEG2RAD;
const THETA_BR = Math.atan2(PAPER_HALF_W, PAPER_HALF_H * 2);
const THETA_CORNER = 45.0 * DEG2RAD;
const THETA_SPLIT_TIP = Math.PI / 2 - THETA_TIP;
const THETA_SPLIT_KEEL = Math.PI / 2 - THETA_KEEL;

// Distance from Nose Apex (0, +H) to outer border of the rectangle [0, W] x [-H, +H] along angle theta
function getMaxRadiusAtAngle(theta) {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const rBottom = cosT > 1e-5 ? (PAPER_HALF_H * 2) / cosT : 1e6;
  const rSide = sinT > 1e-5 ? PAPER_HALF_W / sinT : 1e6;
  return Math.min(rBottom, rSide);
}

// Build discrete origami panels so each panel has crisp crease normals along hinges
// while sharing exact 3D vertex coordinates along every hinge ray.
const PANEL_BANDS = [
  { id: 'keel', thetaStart: 0.0, thetaEnd: THETA_KEEL, steps: 4 },
  { id: 'wing_inner', thetaStart: THETA_KEEL, thetaEnd: THETA_TIP, steps: 5 },
  { id: 'wing_tip_bot', thetaStart: THETA_TIP, thetaEnd: THETA_BR, steps: 3 },
  { id: 'wing_tip_side', thetaStart: THETA_BR, thetaEnd: THETA_CORNER, steps: 7 },
  { id: 'flap_outer', thetaStart: THETA_CORNER, thetaEnd: THETA_SPLIT_TIP, steps: 7 },
  { id: 'flap_mid', thetaStart: THETA_SPLIT_TIP, thetaEnd: THETA_SPLIT_KEEL, steps: 4 },
  { id: 'flap_inner', thetaStart: THETA_SPLIT_KEEL, thetaEnd: Math.PI / 2, steps: 4 }
];

const RADIAL_STEPS = 18;

function buildOrigamiPaperGeometry() {
  const flatPositions = []; // Stores (x0, y0, theta, sideSign, radialFrac) per vertex
  const positions = [];
  const uvs = [];
  const indices = [];

  let vertexCursor = 0;

  // Build both Right Side (sideSign = +1) and Left Side (sideSign = -1)
  [1, -1].forEach((sideSign) => {
    PANEL_BANDS.forEach((band) => {
      const cols = band.steps;
      const rows = RADIAL_STEPS;
      const baseIndex = vertexCursor;

      for (let r = 0; r <= rows; r++) {
        const s = r / rows; // 0 at Nose Apex, 1 at Sheet Boundary
        for (let c = 0; c <= cols; c++) {
          const frac = c / cols;
          const theta = band.thetaStart + (band.thetaEnd - band.thetaStart) * frac;
          const rho = s * getMaxRadiusAtAngle(theta);

          const xAbs = rho * Math.sin(theta);
          const x0 = sideSign * xAbs;
          const y0 = PAPER_HALF_H - rho * Math.cos(theta);

          flatPositions.push({ xAbs, y0, theta, sideSign, s, bandId: band.id });
          positions.push(x0, y0, 0);

          const u = (x0 + PAPER_HALF_W) / (PAPER_HALF_W * 2);
          const v = (y0 + PAPER_HALF_H) / (PAPER_HALF_H * 2);
          uvs.push(u, v);
          vertexCursor++;
        }
      }

      const stride = cols + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i00 = baseIndex + r * stride + c;
          const i10 = i00 + 1;
          const i01 = baseIndex + (r + 1) * stride + c;
          const i11 = i01 + 1;

          // Ensure front-facing (+Z) winding order on both Right (+1) and Left (-1) halves
          if (sideSign > 0) {
            indices.push(i00, i01, i10);
            indices.push(i10, i01, i11);
          } else {
            indices.push(i00, i10, i01);
            indices.push(i10, i11, i01);
          }
        }
      }
    });
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.userData.flatPositions = flatPositions;
  return geo;
}

// Rodrigues' rotation formula: rotates vector (vx, vy, vz) around unit axis (ux, uy, 0) by angle phi
function rotateAroundPlanarRay(vx, vy, vz, ux, uy, phi) {
  if (Math.abs(phi) < 1e-6) return [vx, vy, vz];
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dot = ux * vx + uy * vy;

  // Cross product (ux, uy, 0) x (vx, vy, vz) = (uy * vz, -ux * vz, ux * vy - uy * vx)
  const cx = uy * vz;
  const cy = -ux * vz;
  const cz = ux * vy - uy * vx;

  const rx = vx * cosP + cx * sinP + ux * dot * (1 - cosP);
  const ry = vy * cosP + cy * sinP + uy * dot * (1 - cosP);
  const rz = vz * cosP + cz * sinP;
  return [rx, ry, rz];
}

// Precompute unit ray axes from the Nose Apex A = (0, +H, 0) on the Right Half
const AXIS_CORNER = [Math.sin(THETA_CORNER), -Math.cos(THETA_CORNER)];
const AXIS_TIP = [Math.sin(THETA_TIP), -Math.cos(THETA_TIP)];
const AXIS_KEEL = [Math.sin(THETA_KEEL), -Math.cos(THETA_KEEL)];
const AXIS_SPINE = [0, -1];

/**
 * Updates the 3D positions of all origami vertices for a given normalized
 * `foldProgress` in [0, 1] and optional dynamic `wingFlutterRad`.
 */
function updateOrigamiGeometry(geo, foldProgress, wingFlutterRad = 0) {
  const p = THREE.MathUtils.clamp(foldProgress, 0, 1);

  // 4-Stage Origami Folding Curves:
  // Stage 1 (0.00 -> 0.30): Top nose corners fold inward 178.5° across 45° diagonal creases
  const tCorner = THREE.MathUtils.smoothstep(p, 0.0, 0.30);
  // Stage 2 (0.27 -> 0.58): Center spine folds upward 85° so spine drops to form ventral V-keel
  const tSpine = THREE.MathUtils.smoothstep(p, 0.27, 0.58);
  // Stage 3 (0.54 -> 0.84): Delta wings fold outward/downward -77° from the vertical keel
  const tWing = THREE.MathUtils.smoothstep(p, 0.54, 0.84);
  // Stage 4 (0.80 -> 1.00): Outer wingtips fold upward +64° into stabilizing winglets
  const tTip = THREE.MathUtils.smoothstep(p, 0.80, 1.0);

  const phiCorner = tCorner * (178.5 * DEG2RAD);
  const phiSpine = tSpine * (85.0 * DEG2RAD);
  const phiWing = -tWing * (77.0 * DEG2RAD) + wingFlutterRad;
  const phiTip = tTip * (64.0 * DEG2RAD) + wingFlutterRad * 0.6;

  // Elastic paper bow while corners are mid-swing in Stage 1 (flattens to 0 when crease locks)
  const cornerBowStrength = Math.sin(tCorner * Math.PI) * 0.14;

  // Vertical centering offset so the airplane's center of mass stays near z = 0 as the keel forms
  const keelZCenterOffset = -tSpine * 0.22;

  const posAttr = geo.attributes.position;
  const posArr = posAttr.array;
  const flatPositions = geo.userData.flatPositions;
  const count = flatPositions.length;

  for (let i = 0; i < count; i++) {
    const v = flatPositions[i];
    const { xAbs, y0, theta, sideSign } = v;

    // Coordinates relative to Nose Apex A = (0, +H, 0) on the Right Half
    let rx = xAbs;
    let ry = y0 - PAPER_HALF_H;
    let rz = 0;

    // Effective angle after the 45° corner reflection
    let effTheta = theta;

    // 1. Stage 1: Nose Corner Fold (theta > 45°)
    if (theta > THETA_CORNER + 1e-5) {
      effTheta = Math.PI / 2 - theta;
      const distFromCornerCrease = (theta - THETA_CORNER) / (Math.PI / 4);

      [rx, ry, rz] = rotateAroundPlanarRay(
        rx,
        ry,
        rz,
        AXIS_CORNER[0],
        AXIS_CORNER[1],
        phiCorner
      );

      // Subtle organic paper bow during mid-fold + 6mm layer thickness offset to prevent z-fighting
      rz += cornerBowStrength * distFromCornerCrease * distFromCornerCrease;
      rz += 0.006 * tCorner;
    }

    // 2. Stage 4: Outer Wingtip Stabilizer Fold (effTheta > THETA_TIP)
    if (effTheta > THETA_TIP + 1e-5 && Math.abs(phiTip) > 1e-5) {
      [rx, ry, rz] = rotateAroundPlanarRay(
        rx,
        ry,
        rz,
        AXIS_TIP[0],
        AXIS_TIP[1],
        phiTip
      );
    }

    // 3. Stage 3: Main Delta Wing Fold (effTheta > THETA_KEEL)
    if (effTheta > THETA_KEEL + 1e-5 && Math.abs(phiWing) > 1e-5) {
      [rx, ry, rz] = rotateAroundPlanarRay(
        rx,
        ry,
        rz,
        AXIS_KEEL[0],
        AXIS_KEEL[1],
        phiWing
      );
    }

    // 4. Stage 2: Center Spine Keel Fold (all points with effTheta > 0)
    if (Math.abs(phiSpine) > 1e-5) {
      [rx, ry, rz] = rotateAroundPlanarRay(
        rx,
        ry,
        rz,
        AXIS_SPINE[0],
        AXIS_SPINE[1],
        phiSpine
      );
    }

    // Convert back from Nose Apex relative coordinates and apply bilateral symmetry (sideSign)
    posArr[i * 3] = sideSign * rx;
    posArr[i * 3 + 1] = ry + PAPER_HALF_H;
    posArr[i * 3 + 2] = rz + keelZCenterOffset;
  }

  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
}

// ============================================================================
// 6. DOUBLE-SIDED ORIGAMI PAPER WEBGL SHADER & MESH SETUP
// ============================================================================

const origamiGeo = buildOrigamiPaperGeometry();

const origamiShaderMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: {
    uPaperTexture: { value: fallbackPaperTexture },
    uFlipY: { value: 0.0 },
    uFoldProgress: { value: 0.0 },
    uTime: { value: 0.0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uPaperTexture;
    uniform float uFlipY;
    uniform float uFoldProgress;
    uniform float uTime;

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPos;

    // Fine procedural paper fiber grain
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec3 N = normalize(vWorldNormal);
      if (!gl_FrontFacing) {
        N = -N;
      }

      // Three-point studio & golden horizon lighting
      vec3 L1 = normalize(vec3(0.45, 0.72, 0.65));
      vec3 L2 = normalize(vec3(-0.55, 0.30, -0.75));
      float diff1 = max(0.0, dot(N, L1));
      float diff2 = max(0.0, dot(N, L2));

      // Blend from flat even lighting at foldProgress = 0 to rich 3D faceted lighting when folded
      float shadeMix = smoothstep(0.02, 0.35, uFoldProgress);
      float lighting = mix(1.0, 0.54 + 0.44 * diff1 + 0.18 * diff2, shadeMix);

      vec2 sampleUv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlipY));
      vec4 frontTex = texture2D(uPaperTexture, clamp(sampleUv, 0.0, 1.0));

      float grain = (hash(vUv * 420.0) - 0.5) * 0.028;

      if (gl_FrontFacing) {
        vec3 col = (frontTex.rgb + grain) * lighting;
        gl_FragColor = vec4(col, 1.0);
      } else {
        // Back side of the stationery sheet (visible on outer folded nose flaps & ventral keel)
        vec3 creamBack = vec3(0.96, 0.92, 0.83) + grain;
        // Subtle ink bleed-through from the front form
        vec3 bleed = mix(creamBack, frontTex.rgb, 0.14);

        // Par Avion diagonal watermark stripe on the back of the wings
        float stripeWave = fract((vUv.x + vUv.y) * 9.0);
        float redStripe = smoothstep(0.0, 0.04, stripeWave) * (1.0 - smoothstep(0.08, 0.12, stripeWave));
        float blueStripe = smoothstep(0.18, 0.22, stripeWave) * (1.0 - smoothstep(0.26, 0.30, stripeWave));

        vec2 edgeDist = min(vUv, 1.0 - vUv);
        float borderBand = 1.0 - smoothstep(0.015, 0.045, min(edgeDist.x, edgeDist.y));

        vec3 backCol = bleed;
        backCol = mix(backCol, vec3(0.85, 0.22, 0.16), redStripe * borderBand * 0.8);
        backCol = mix(backCol, vec3(0.11, 0.31, 0.61), blueStripe * borderBand * 0.8);

        gl_FragColor = vec4(backCol * lighting, 1.0);
      }
    }
  `
});

const airplaneGroup = new THREE.Group();
scene.add(airplaneGroup);

const origamiMesh = new THREE.Mesh(origamiGeo, origamiShaderMat);
airplaneGroup.add(origamiMesh);

// Invisible unit-square reference mesh used to compute the exact HTML-in-Canvas MVP matrix
// for the flat sheet (-PAPER_HALF_W..PAPER_HALF_W, -PAPER_HALF_H..PAPER_HALF_H)
const flatProxyMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
flatProxyMesh.scale.set(PAPER_HALF_W * 2, PAPER_HALF_H * 2, 1);
flatProxyMesh.visible = false;
airplaneGroup.add(flatProxyMesh);

// ============================================================================
// 7. 3D AEROBATIC FLIGHT TRAJECTORY, BISHOP FRAME & WINGTIP RIBBON TRAILS
// ============================================================================

const TRAIL_SEGMENTS = 85;

function createWingtipRibbonMesh(colorHex) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((TRAIL_SEGMENTS + 1) * 2 * 3);
  const alphas = new Float32Array((TRAIL_SEGMENTS + 1) * 2);
  const indices = [];

  for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
    const a = 1.0 - i / TRAIL_SEGMENTS;
    alphas[i * 2] = a;
    alphas[i * 2 + 1] = a;
    if (i < TRAIL_SEGMENTS) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2);
      indices.push(b + 1, b + 3, b + 2);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setIndex(indices);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uVisibleMix: { value: 0.0 }
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uVisibleMix;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha * vAlpha * 0.52 * uVisibleMix);
      }
    `
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, geo, mat, history: [] };
}

const leftTrail = createWingtipRibbonMesh(0xfef08a);
const rightTrail = createWingtipRibbonMesh(0x7dd3fc);

function resetWingtipTrails() {
  leftTrail.history.length = 0;
  rightTrail.history.length = 0;
  leftTrail.mat.uniforms.uVisibleMix.value = 0;
  rightTrail.mat.uniforms.uVisibleMix.value = 0;
}

function updateWingtipRibbon(trailObj, tipWorldPos, rightVec, widthScale, visibleMix) {
  trailObj.mat.uniforms.uVisibleMix.value = visibleMix;
  if (visibleMix <= 0.01) return;

  trailObj.history.unshift({
    pos: tipWorldPos.clone(),
    right: rightVec.clone()
  });
  if (trailObj.history.length > TRAIL_SEGMENTS + 1) {
    trailObj.history.pop();
  }

  const posAttr = trailObj.geo.attributes.position;
  const arr = posAttr.array;
  const len = trailObj.history.length;

  for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
    const sample = trailObj.history[Math.min(i, len - 1)];
    const taper = (1.0 - i / TRAIL_SEGMENTS) * widthScale;
    const p = sample.pos;
    const r = sample.right;

    arr[i * 6] = p.x - r.x * taper;
    arr[i * 6 + 1] = p.y - r.y * taper;
    arr[i * 6 + 2] = p.z - r.z * taper;

    arr[i * 6 + 3] = p.x + r.x * taper;
    arr[i * 6 + 4] = p.y + r.y * taper;
    arr[i * 6 + 5] = p.z + r.z * taper;
  }

  posAttr.needsUpdate = true;
}

/**
 * Evaluates the 3D position P(u) along the flight trajectory for u in [0, 1].
 * Includes:
 * - Pullback wind-up anticipation (u in [0, 0.11])
 * - Updraft climb & 3D Loop-the-Loop / Flip (u in [0.11, 0.65])
 * - High-speed swooping glide into the distant horizon (u in [0.65, 1.00])
 */
function evaluateFlightPosition(uRaw, flipStyle = 'loop') {
  const u = THREE.MathUtils.clamp(uRaw, 0, 1);

  // Phase A: Wind-up pullback before release (u: 0 -> 0.11)
  if (u < 0.11) {
    const t = u / 0.11;
    // Smooth pullback (+Z) and slight dip (-Y), then surge forward
    const pull = Math.sin(t * Math.PI);
    return new THREE.Vector3(
      0.08 * pull,
      -0.22 * pull,
      0.65 * Math.sin(t * Math.PI * 0.85)
    );
  }

  // Normalized forward flight parameter s in [0, 1] after release
  const s = (u - 0.11) / 0.89;

  // Apply gravity-modulated time warping during the loop (s in [0.18, 0.56]):
  // The airplane slows down slightly at the inverted top of the loop (trading kinetic
  // energy for potential energy 2gh) and accelerates on the downward dive!
  const loopCenterS = 0.36;
  const loopWidth = 0.19;
  const distFromLoop = (s - loopCenterS) / loopWidth;
  const gravityMod =
    flipStyle === 'loop'
      ? -0.026 * Math.sin(THREE.MathUtils.clamp(distFromLoop, -1, 1) * Math.PI)
      : 0;
  const sp = THREE.MathUtils.clamp(s + gravityMod, 0, 1);

  // Base forward trajectory into the distant sunset sky (-Z)
  let x = Math.sin(sp * Math.PI * 1.6) * 1.45;
  let y = -0.15 + sp * 7.5;
  let z = 0.35 - Math.pow(sp, 1.38) * 92.0;

  // Envelope for the aerobatic maneuver (peaks cleanly around sp in [0.14, 0.58])
  const loopEnv =
    THREE.MathUtils.smoothstep(sp, 0.10, 0.22) *
    (1.0 - THREE.MathUtils.smoothstep(sp, 0.50, 0.64));
  const loopPhase = THREE.MathUtils.clamp((sp - 0.14) / 0.42, 0, 1) * Math.PI * 2.0;

  if (flipStyle === 'loop') {
    // Classic 3D Inside Loop-the-Loop Flip:
    // As loopPhase goes 0 -> 2*PI, the airplane climbs up, loops backward (+Z) at the top
    // so the tangent vector pitches a full 360 degrees, and dives out forward (-Z)!
    const loopRadiusY = 3.15;
    const loopRadiusZ = 4.65; // > forward travel per radian so dz/dsp > 0 at the top of the loop!
    y += loopEnv * loopRadiusY * (1.0 - Math.cos(loopPhase));
    z += loopEnv * loopRadiusZ * (loopPhase - Math.sin(loopPhase) - Math.PI);
    // Slight helical offset in X so the two sides of the vertical loop don't collide and show 3D depth
    x += loopEnv * 1.35 * Math.sin(loopPhase * 0.5);
  } else if (flipStyle === 'barrel') {
    // Wide 3D Helical Barrel Roll Flip
    const barrelRadius = 2.15;
    x += loopEnv * barrelRadius * Math.sin(loopPhase);
    y += loopEnv * barrelRadius * (1.0 - Math.cos(loopPhase));
  } else {
    // Corkscrew Immelmann Climb & Flip
    const corkRadius = 2.45;
    x += loopEnv * corkRadius * Math.sin(loopPhase * 1.25);
    y += loopEnv * corkRadius * (1.0 - Math.cos(loopPhase)) * 1.15;
    z += loopEnv * 3.8 * (loopPhase - Math.sin(loopPhase) - Math.PI);
  }

  return new THREE.Vector3(x, y, z);
}

// Precompute parallel-transported (Bishop) frames along the trajectory for each flipStyle
// so that vertical 360° loops never suffer from Euler/lookAt gimbal lock!
const FLIGHT_SAMPLES = 260;
const cachedFlightTables = new Map();

function getFlightTable(flipStyle) {
  if (cachedFlightTables.has(flipStyle)) {
    return cachedFlightTables.get(flipStyle);
  }

  const points = [];
  const tangents = [];
  const normals = [];
  const binormals = [];

  for (let i = 0; i <= FLIGHT_SAMPLES; i++) {
    const u = i / FLIGHT_SAMPLES;
    points.push(evaluateFlightPosition(u, flipStyle));
  }

  for (let i = 0; i <= FLIGHT_SAMPLES; i++) {
    const pPrev = points[Math.max(0, i - 1)];
    const pNext = points[Math.min(FLIGHT_SAMPLES, i + 1)];
    const u = i / FLIGHT_SAMPLES;

    let T;
    if (u < 0.11) {
      // During the initial pullback before release, keep the airplane pointing forward (-Z)
      // with a gentle upward launch pitch
      const launchPitch = 0.16 * Math.sin((u / 0.11) * Math.PI);
      T = new THREE.Vector3(0, launchPitch, -1).normalize();
    } else {
      T = pNext.clone().sub(pPrev);
      if (T.lengthSq() < 1e-8) {
        T.set(0, 0, -1);
      } else {
        T.normalize();
      }
    }
    tangents.push(T);
  }

  // Initialize orthonormal frame at i = 0:
  // Forward T0 = (0, 0, -1), Up U0 = (0, 1, 0), Right B0 = T0 x U0 = (+1, 0, 0)
  let U = new THREE.Vector3(0, 1, 0);
  const T0 = tangents[0];
  let B = new THREE.Vector3().crossVectors(T0, U).normalize();
  U = new THREE.Vector3().crossVectors(B, T0).normalize();

  normals.push(U.clone());
  binormals.push(B.clone());

  const stepQuat = new THREE.Quaternion();
  for (let i = 1; i <= FLIGHT_SAMPLES; i++) {
    const prevT = tangents[i - 1];
    const currT = tangents[i];

    stepQuat.setFromUnitVectors(prevT, currT);
    U.applyQuaternion(stepQuat);

    // Re-orthonormalize (Gram-Schmidt)
    U.addScaledVector(currT, -U.dot(currT)).normalize();
    B = new THREE.Vector3().crossVectors(currT, U).normalize();

    normals.push(U.clone());
    binormals.push(B.clone());
  }

  // Smoothly blend the post-loop upright vector back to level horizon (0, 1, 0) for u > 0.65
  const table = { points, tangents, normals, binormals };
  cachedFlightTables.set(flipStyle, table);
  return table;
}

const tempBasisMat = new THREE.Matrix4();
const tempFoldQuat = new THREE.Quaternion();
const tempFlightQuat = new THREE.Quaternion();
const tempRollQuat = new THREE.Quaternion();

/**
 * Computes the 3D position and orientation quaternion of the airplane for any
 * `foldProgress` in [0, 1] and `flightProgress` in [0, 1].
 */
function evaluateAirplanePose(foldProgress, flightProgress, flipStyle) {
  const pFold = THREE.MathUtils.clamp(foldProgress, 0, 1);
  const uFlight = THREE.MathUtils.clamp(flightProgress, 0, 1);

  // Orientation during folding (transitions from flat sheet (0,0,0) to 3D launch attitude)
  // At pFold = 1, the airplane is pitched into horizontal flight (-90 deg in X + slight upward climb)
  const foldRotEuler = new THREE.Euler(
    -pFold * (Math.PI * 0.44),
    Math.sin(pFold * Math.PI) * 0.42,
    Math.sin(pFold * Math.PI * 2.0) * 0.08,
    'YXZ'
  );
  tempFoldQuat.setFromEuler(foldRotEuler);

  if (uFlight <= 0.0001) {
    const foldLiftY = Math.sin(pFold * Math.PI) * 0.18;
    const foldPushZ = -Math.sin(pFold * Math.PI) * 0.45;
    return {
      position: new THREE.Vector3(0, foldLiftY, foldPushZ),
      quaternion: tempFoldQuat.clone(),
      rightVec: new THREE.Vector3(1, 0, 0).applyQuaternion(tempFoldQuat),
      scale: 1.0
    };
  }

  const table = getFlightTable(flipStyle);
  const fIdx = uFlight * FLIGHT_SAMPLES;
  const idx0 = Math.min(FLIGHT_SAMPLES - 1, Math.floor(fIdx));
  const idx1 = idx0 + 1;
  const frac = fIdx - idx0;

  const pos = new THREE.Vector3().lerpVectors(table.points[idx0], table.points[idx1], frac);
  const T = new THREE.Vector3().lerpVectors(table.tangents[idx0], table.tangents[idx1], frac).normalize();
  const U = new THREE.Vector3().lerpVectors(table.normals[idx0], table.normals[idx1], frac).normalize();
  const B = new THREE.Vector3().crossVectors(T, U).normalize();
  U.crossVectors(B, T).normalize();

  // Build rotation matrix mapping:
  // Local +X (Right Wing) -> B
  // Local +Y (Nose Forward) -> T
  // Local +Z (Dorsal Top) -> U
  tempBasisMat.makeBasis(B, T, U);
  tempFlightQuat.setFromRotationMatrix(tempBasisMat);

  // Add intentional aerodynamic bank/roll around the forward axis T:
  let rollAngle = 0;
  if (flipStyle === 'barrel') {
    const rollT = THREE.MathUtils.smoothstep(uFlight, 0.22, 0.66);
    rollAngle = rollT * Math.PI * 2.0;
  } else if (flipStyle === 'immelmann') {
    const rollT = THREE.MathUtils.smoothstep(uFlight, 0.34, 0.68);
    rollAngle = rollT * Math.PI * 2.0;
  } else {
    // In Loop-the-Loop mode: subtle 18° bank into the loop + a crisp little victory roll on exit
    const loopBank = Math.sin(THREE.MathUtils.smoothstep(uFlight, 0.15, 0.65) * Math.PI) * 0.32;
    const exitVictoryRoll = THREE.MathUtils.smoothstep(uFlight, 0.56, 0.80) * Math.PI * 2.0;
    rollAngle = loopBank + exitVictoryRoll;
  }

  tempRollQuat.setFromAxisAngle(T, rollAngle);
  tempFlightQuat.premultiply(tempRollQuat);

  // Blend smoothly from the end-of-fold attitude to the trajectory frame over the first 10% of flight
  const launchBlend = THREE.MathUtils.smoothstep(uFlight, 0.0, 0.10);
  const finalQuat = tempFoldQuat.clone().slerp(tempFlightQuat, launchBlend);
  const rightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(finalQuat);

  // Slight perspective scale-down at extreme horizon distance so it vanishes into the clouds
  const distFadeScale = 1.0 - THREE.MathUtils.smoothstep(uFlight, 0.86, 1.0) * 0.65;

  return {
    position: pos,
    quaternion: finalQuat,
    rightVec,
    scale: distFadeScale
  };
}

// ============================================================================
// 8. FORM VALIDATION, SAMPLE NOTES & INTERACTIVITY (MODERN WEB GUIDANCE: FORMS)
// ============================================================================

const SAMPLE_NOTES = [
  {
    sender: 'Alex Rivera',
    message:
      'Meet me at the rooftop observatory at sunset! Folding this note into a dart glider and sending it across the skyline.'
  },
  {
    sender: 'Captain Amelia Vance',
    message:
      'Tailwinds are picking up over the bay — watch for the loop-the-loop flip right before this paper plane clears the clouds!'
  },
  {
    sender: 'Prof. Kenji Takahashi',
    message:
      'Single-vertex origami theorem verified: reflecting the 45° nose flap aligns the inner crease collinearly with the delta wing hinge!'
  },
  {
    sender: 'Maya Lin & Studio 4',
    message:
      'Every word you type into this HTML-in-Canvas sheet stays mapped across the folded fuselage and delta wings in 3D space.'
  }
];
let currentSampleIdx = 0;

function updateCharCounter() {
  if (!messageCounter || !messageInput) return;
  const len = messageInput.value.length;
  messageCounter.textContent = `${len} / 360 chars`;
}

// Validate a single field; returns true if valid
function validateField(inputEl, errorContainer, errorTextEl, emptyMsg, shortMsg) {
  if (!inputEl) return true;
  const val = inputEl.value.trim();
  const minLen = Number(inputEl.getAttribute('minlength') || 1);

  if (val.length === 0) {
    inputEl.setCustomValidity(emptyMsg);
    inputEl.classList.add('is-invalid');
    if (errorTextEl) errorTextEl.textContent = emptyMsg;
    if (errorContainer) errorContainer.hidden = false;
    return false;
  }

  if (val.length < minLen) {
    inputEl.setCustomValidity(shortMsg);
    inputEl.classList.add('is-invalid');
    if (errorTextEl) errorTextEl.textContent = shortMsg;
    if (errorContainer) errorContainer.hidden = false;
    return false;
  }

  inputEl.setCustomValidity('');
  inputEl.classList.remove('is-invalid');
  if (errorContainer) errorContainer.hidden = true;
  return true;
}

function clearFieldErrorOnInput(inputEl, errorContainer) {
  if (!inputEl) return;
  inputEl.setCustomValidity('');
  inputEl.classList.remove('is-invalid');
  if (errorContainer) errorContainer.hidden = true;
}

// Validate on `blur` and clear error states on `input` per Forms Validation Event Timing Matrix
senderInput?.addEventListener('blur', () => {
  validateField(
    senderInput,
    senderError,
    senderErrorText,
    'Please enter your sender name before launching.',
    'Sender name must be at least 2 characters.'
  );
});

senderInput?.addEventListener('input', () => {
  clearFieldErrorOnInput(senderInput, senderError);
  renderLivePaperTexture();
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
});

messageInput?.addEventListener('blur', () => {
  validateField(
    messageInput,
    messageError,
    messageErrorText,
    'Please write a message before folding your airplane.',
    'Message must be at least 3 characters long.'
  );
});

messageInput?.addEventListener('input', () => {
  clearFieldErrorOnInput(messageInput, messageError);
  updateCharCounter();
  renderLivePaperTexture();
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
});

// IME-safe Ctrl+Enter / Cmd+Enter submit shortcut inside the message textarea
messageInput?.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    paperForm?.requestSubmit();
  }
});

btnSampleNote?.addEventListener('click', () => {
  currentSampleIdx = (currentSampleIdx + 1) % SAMPLE_NOTES.length;
  const sample = SAMPLE_NOTES[currentSampleIdx];
  if (senderInput) {
    senderInput.value = sample.sender;
    clearFieldErrorOnInput(senderInput, senderError);
  }
  if (messageInput) {
    messageInput.value = sample.message;
    clearFieldErrorOnInput(messageInput, messageError);
  }
  updateCharCounter();
  renderLivePaperTexture();
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
});

btnClearForm?.addEventListener('click', () => {
  if (senderInput) {
    senderInput.value = '';
    clearFieldErrorOnInput(senderInput, senderError);
  }
  if (messageInput) {
    messageInput.value = '';
    clearFieldErrorOnInput(messageInput, messageError);
  }
  updateCharCounter();
  renderLivePaperTexture();
  senderInput?.focus();
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
});

// ============================================================================
// 9. STATE MACHINE: EDITING -> FOLDING -> FLYING -> DELIVERED
// ============================================================================

const FOLD_DURATION_MS = 2500;
const FLIGHT_DURATION_MS = 3800;

let appState = 'editing'; // 'editing' | 'scrubbing' | 'folding' | 'flying' | 'delivered'
let foldProgress = 0.0;
let flightProgress = 0.0;
let animStartTimeMs = 0;
let selectedFlipStyle = 'loop';

function getSelectedFlipStyle() {
  const checked = flipRadioInputs.find((r) => r.checked);
  return checked ? checked.value : 'loop';
}

flipRadioInputs.forEach((radio) => {
  radio.addEventListener('change', () => {
    selectedFlipStyle = getSelectedFlipStyle();
  });
});

function updateHUDTelemetry() {
  const pct = Math.round(foldProgress * 100);
  if (foldScrubber && document.activeElement !== foldScrubber) {
    foldScrubber.value = String(pct);
  }
  if (foldPercentLabel) {
    foldPercentLabel.textContent = `${pct}%`;
  }

  // Determine active origami stage index (0..4)
  let stageIdx = 0;
  if (foldProgress >= 0.80 || appState === 'flying' || appState === 'delivered') {
    stageIdx = 4;
  } else if (foldProgress >= 0.54) {
    stageIdx = 3;
  } else if (foldProgress >= 0.27) {
    stageIdx = 2;
  } else if (foldProgress >= 0.02) {
    stageIdx = 1;
  }

  stagePills.forEach((pill, idx) => {
    pill.classList.toggle('is-active', idx === stageIdx);
  });

  if (!flightStatusDot || !flightStatusText) return;
  flightStatusDot.className = 'status-dot';

  if (appState === 'editing' && foldProgress < 0.01) {
    flightStatusText.textContent = 'Stage 0: Flat Stationery — Ready for Your Reply';
  } else if (appState === 'scrubbing') {
    const labels = [
      'Stage 0: Flat Airmail Stationery Sheet',
      'Stage 1: Folding 45° Top Nose Corners to Center Spine',
      'Stage 2: Hinged Center Spine Folding Into Vertical V-Keel',
      'Stage 3: Unfolding Horizontal Delta Wings (+8° Dihedral)',
      'Stage 4: Wingtip Stabilizers Creased — Ready for Flight!'
    ];
    flightStatusDot.classList.add('is-folding');
    flightStatusText.textContent = labels[stageIdx];
  } else if (appState === 'folding') {
    flightStatusDot.classList.add('is-folding');
    const labels = [
      'Folding Step 1/4: Creasing Top Nose Corners Inward...',
      'Folding Step 1/4: Creasing Top Nose Corners Inward...',
      'Folding Step 2/4: Forming Central Fuselage Keel...',
      'Folding Step 3/4: Spreading Delta Wings...',
      'Folding Step 4/4: Creasing Wingtip Stabilizers...'
    ];
    flightStatusText.textContent = labels[stageIdx];
  } else if (appState === 'flying') {
    flightStatusDot.classList.add('is-flying');
    if (flightProgress < 0.14) {
      flightStatusText.textContent = 'Launch: Drawing Back & Releasing Into Updraft...';
    } else if (flightProgress < 0.66) {
      const styleNames = {
        loop: 'Executing 360° Inside Loop-the-Loop Flip!',
        barrel: 'Executing 360° Helical Barrel Roll Flip!',
        immelmann: 'Executing Corkscrew Immelmann Flip!'
      };
      flightStatusText.textContent = styleNames[selectedFlipStyle] || styleNames.loop;
    } else {
      flightStatusText.textContent = 'Soaring Off Into the Golden Horizon...';
    }
  } else if (appState === 'delivered') {
    flightStatusDot.classList.add('is-flying');
    flightStatusText.textContent = 'Reply Delivered Across the Horizon!';
  }
}

function startFoldAndFlySequence() {
  renderLivePaperTexture();
  selectedFlipStyle = getSelectedFlipStyle();
  if (deliveryToast) deliveryToast.hidden = true;

  // Disable submit button after valid submission to prevent double-submit per Forms guide
  if (btnSendAirplane) btnSendAirplane.disabled = true;
  if (btnSendLabel) btnSendLabel.textContent = 'Folding & Launching...';

  resetWingtipTrails();
  appState = 'folding';
  foldProgress = 0.0;
  flightProgress = 0.0;
  animStartTimeMs = performance.now();
  updateHUDTelemetry();
}

function resetToFlatSheet() {
  appState = 'editing';
  foldProgress = 0.0;
  flightProgress = 0.0;
  resetWingtipTrails();

  if (deliveryToast) deliveryToast.hidden = true;
  if (btnSendAirplane) btnSendAirplane.disabled = false;
  if (btnSendLabel) btnSendLabel.textContent = 'Send & Fold Airplane';

  updateOrigamiGeometry(origamiGeo, 0.0, 0.0);
  renderLivePaperTexture();
  updateHUDTelemetry();

  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
}

paperForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (appState === 'folding' || appState === 'flying') return;

  const isSenderOk = validateField(
    senderInput,
    senderError,
    senderErrorText,
    'Please enter your sender name before launching.',
    'Sender name must be at least 2 characters.'
  );
  const isMsgOk = validateField(
    messageInput,
    messageError,
    messageErrorText,
    'Please write a message before folding your airplane.',
    'Message must be at least 3 characters long.'
  );

  if (!isSenderOk) {
    senderInput?.focus();
    return;
  }
  if (!isMsgOk) {
    messageInput?.focus();
    return;
  }

  startFoldAndFlySequence();
});

// HUD Controls: Manual Scrubber, Stage Pills, Reset & Launch
foldScrubber?.addEventListener('input', () => {
  const val = Number(foldScrubber.value || 0) / 100;
  if (deliveryToast) deliveryToast.hidden = true;
  resetWingtipTrails();

  if (val <= 0.005) {
    resetToFlatSheet();
    return;
  }

  appState = 'scrubbing';
  foldProgress = val;
  flightProgress = 0.0;
  if (btnSendAirplane) btnSendAirplane.disabled = false;
  if (btnSendLabel) btnSendLabel.textContent = 'Send & Fold Airplane';
  updateHUDTelemetry();
});

stagePills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const stage = Number(pill.dataset.stage || 0);
    if (stage === 0) {
      resetToFlatSheet();
      return;
    }
    const targetPcts = [0, 0.30, 0.58, 0.84, 1.0];
    const targetFold = targetPcts[stage] ?? 0;

    if (stage === 4 && foldProgress >= 0.95) {
      // Clicking Stage 4 when already folded launches the flight!
      startFoldAndFlySequence();
      return;
    }

    if (deliveryToast) deliveryToast.hidden = true;
    resetWingtipTrails();
    appState = 'scrubbing';
    foldProgress = targetFold;
    flightProgress = 0.0;
    updateHUDTelemetry();
  });
});

btnHudReset?.addEventListener('click', () => {
  resetToFlatSheet();
});

btnHudLaunch?.addEventListener('click', () => {
  if (appState === 'editing') {
    paperForm?.requestSubmit();
  } else {
    startFoldAndFlySequence();
  }
});

btnReplayFlight?.addEventListener('click', () => {
  startFoldAndFlySequence();
});

btnNewSheet?.addEventListener('click', () => {
  resetToFlatSheet();
  senderInput?.focus();
});

// ============================================================================
// 10. RESIZE OBSERVER (MANDATORY PER MODERN WEB GUIDANCE)
// ============================================================================

function handleViewportResize(cssWidth, cssHeight, pixelW, pixelH) {
  if (cssWidth <= 0 || cssHeight <= 0) return;
  camera.aspect = cssWidth / cssHeight;

  // Adjust camera Z distance slightly on narrow viewports so the flat paper sheet fits comfortably
  const targetZ = camera.aspect < 0.82 ? 7.2 / Math.max(0.58, camera.aspect * 1.05) : 7.2;
  camera.position.set(0, 0, targetZ);
  camera.updateProjectionMatrix();
  renderer.setSize(pixelW, pixelH, false);
}

const resizeObserver = new ResizeObserver(([entry]) => {
  const dpc = entry.devicePixelContentBoxSize;
  const pixelW = dpc
    ? dpc[0].inlineSize
    : Math.round(entry.contentRect.width * window.devicePixelRatio);
  const pixelH = dpc
    ? dpc[0].blockSize
    : Math.round(entry.contentRect.height * window.devicePixelRatio);

  canvas.width = Math.max(1, pixelW);
  canvas.height = Math.max(1, pixelH);
  handleViewportResize(entry.contentRect.width, entry.contentRect.height, canvas.width, canvas.height);

  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
});

const supportsDevicePixelContentBox =
  typeof ResizeObserverEntry !== 'undefined' &&
  'devicePixelContentBoxSize' in ResizeObserverEntry.prototype;
resizeObserver.observe(
  canvas,
  supportsDevicePixelContentBox ? { box: 'device-pixel-content-box' } : {}
);

// ============================================================================
// 11. HTML-IN-CANVAS GEOMETRY SYNC & ONPAINT RENDER LOOP
// ============================================================================

const tempMVPMatrix = new THREE.Matrix4();
const tempViewProjMatrix = new THREE.Matrix4();
const cornerTL = new THREE.Vector3();
const cornerBR = new THREE.Vector3();
const leftTipLocal = new THREE.Vector3(-1.35, -1.65, 0.25);
const rightTipLocal = new THREE.Vector3(1.35, -1.65, 0.25);

function bindNativeHICTextureToThree(threeTex, nativeGLTex, shaderMat) {
  const texProps = renderer.properties.get(threeTex);
  texProps.__webglTexture = nativeGLTex;
  texProps.__webglInit = true;
  threeTex.needsUpdate = false;
  shaderMat.uniforms.uFlipY.value = 1.0;
}

function syncPaperFormDOM(isInteractiveFlat) {
  if (!paperForm) return;

  if (!isInteractiveFlat) {
    if (supportsNativeHIC && typeof canvas.clearElementGeometry === 'function') {
      try {
        canvas.clearElementGeometry(paperForm);
      } catch (_e) {
        // Ignore if not registered yet
      }
    }
    paperForm.style.opacity = '0';
    paperForm.style.pointerEvents = 'none';
    paperForm.setAttribute('inert', '');
    return;
  }

  paperForm.removeAttribute('inert');
  paperForm.style.pointerEvents = 'auto';

  flatProxyMesh.updateMatrixWorld();
  tempViewProjMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  tempMVPMatrix.multiplyMatrices(tempViewProjMatrix, flatProxyMesh.matrixWorld);

  if (supportsNativeHIC && typeof canvas.updateElementGeometry === 'function') {
    const canvasTransform = computeCanvasTransform(canvas, paperForm, tempMVPMatrix.elements);
    canvas.updateElementGeometry(paperForm, {
      canvasTransform,
      preserveHitTestOrder: true
    });
    paperForm.style.opacity = '1';
  } else {
    // Exact 3D-to-CSS projection alignment for fallback layer:
    // Projects the top-left (-PAPER_HALF_W, +PAPER_HALF_H, 0) and bottom-right
    // (+PAPER_HALF_W, -PAPER_HALF_H, 0) corners of the 3D sheet onto the viewport.
    cornerTL.set(-PAPER_HALF_W, PAPER_HALF_H, 0).applyMatrix4(airplaneGroup.matrixWorld).project(camera);
    cornerBR.set(PAPER_HALF_W, -PAPER_HALF_H, 0).applyMatrix4(airplaneGroup.matrixWorld).project(camera);

    const cw = Math.max(1, canvas.clientWidth);
    const ch = Math.max(1, canvas.clientHeight);

    const xLeft = (cornerTL.x * 0.5 + 0.5) * cw;
    const xRight = (cornerBR.x * 0.5 + 0.5) * cw;
    const yTop = (-cornerTL.y * 0.5 + 0.5) * ch;
    const yBottom = (-cornerBR.y * 0.5 + 0.5) * ch;

    const projW = Math.max(100, xRight - xLeft);
    const projH = Math.max(100, yBottom - yTop);

    const naturalW = paperForm.offsetWidth || 440;
    const naturalH = paperForm.offsetHeight || 544;
    const scaleX = projW / naturalW;
    const scaleY = projH / naturalH;

    paperForm.style.transform = `translate3d(${xLeft.toFixed(2)}px, ${yTop.toFixed(2)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
    paperForm.style.opacity = '1';
  }
}

function updateSceneAndSync(nowMs, changedElementsSet = null) {
  const timeSec = nowMs * 0.001;

  // Advance state machine timers
  if (appState === 'folding') {
    const elapsed = nowMs - animStartTimeMs;
    foldProgress = THREE.MathUtils.clamp(elapsed / FOLD_DURATION_MS, 0, 1);
    updateHUDTelemetry();

    if (foldProgress >= 1.0) {
      appState = 'flying';
      flightProgress = 0.0;
      animStartTimeMs = nowMs;
      updateHUDTelemetry();
    }
  } else if (appState === 'flying') {
    const elapsed = nowMs - animStartTimeMs;
    flightProgress = THREE.MathUtils.clamp(elapsed / FLIGHT_DURATION_MS, 0, 1);
    updateHUDTelemetry();

    if (flightProgress >= 1.0) {
      appState = 'delivered';
      updateHUDTelemetry();

      const senderName = (senderInput?.value || '').trim() || 'Anonymous Pilot';
      if (toastHeadline) {
        toastHeadline.textContent = `Reply Delivered from ${senderName}!`;
      }
      if (toastDetail) {
        toastDetail.textContent =
          'Your folded paper airplane completed its 3D aerobatic flip and soared into the horizon.';
      }
      if (deliveryToast) {
        deliveryToast.hidden = false;
      }
    }
  }

  // Compute aerodynamic wingtip flutter during flight
  const airspeedFlutter =
    appState === 'flying'
      ? Math.sin(timeSec * 38.0) * 0.045 * THREE.MathUtils.smoothstep(flightProgress, 0.08, 0.35)
      : 0.0;

  // Update 3D Origami Mesh Vertices
  updateOrigamiGeometry(origamiGeo, foldProgress, airspeedFlutter);

  // Update Airplane Group 3D Pose (Position, Orientation Quaternion, Scale)
  const pose = evaluateAirplanePose(foldProgress, flightProgress, selectedFlipStyle);
  airplaneGroup.position.copy(pose.position);
  airplaneGroup.quaternion.copy(pose.quaternion);
  airplaneGroup.scale.setScalar(pose.scale);
  airplaneGroup.updateMatrixWorld();

  origamiMesh.visible = appState !== 'delivered';

  // Update Wingtip Contrail Ribbons during flight
  if (appState === 'flying' && flightProgress > 0.08) {
    const trailVisibility =
      THREE.MathUtils.smoothstep(flightProgress, 0.08, 0.18) *
      (1.0 - THREE.MathUtils.smoothstep(flightProgress, 0.88, 1.0));
    const leftWorld = leftTipLocal.clone().applyMatrix4(airplaneGroup.matrixWorld);
    const rightWorld = rightTipLocal.clone().applyMatrix4(airplaneGroup.matrixWorld);

    updateWingtipRibbon(leftTrail, leftWorld, pose.rightVec, 0.11 * pose.scale, trailVisibility);
    updateWingtipRibbon(rightTrail, rightWorld, pose.rightVec, 0.11 * pose.scale, trailVisibility);
  } else if (appState !== 'flying') {
    leftTrail.mat.uniforms.uVisibleMix.value = 0;
    rightTrail.mat.uniforms.uVisibleMix.value = 0;
  }

  // Upload HTML-in-Canvas texture when supported
  const isInteractiveFlat = appState === 'editing' && foldProgress < 0.008;
  if (supportsNativeHIC) {
    if (!changedElementsSet || changedElementsSet.has(paperForm) || nativeTextureState.width === 0) {
      try {
        if (uploadElementWebGL(gl, canvas, nativeGLTexture, paperForm, nativeTextureState)) {
          bindNativeHICTextureToThree(fallbackPaperTexture, nativeGLTexture, origamiShaderMat);
        }
      } catch (_err) {
        // Retry on next paint event
      }
    }
  }

  // Sync HTML Form Geometry & Interactivity
  syncPaperFormDOM(isInteractiveFlat);

  // Update Shader Uniforms
  origamiShaderMat.uniforms.uFoldProgress.value = foldProgress;
  origamiShaderMat.uniforms.uTime.value = timeSec;
  skyMat.uniforms.uTime.value = timeSec;
  windMoteMat.uniforms.uTime.value = timeSec;

  renderer.render(scene, camera);
}

// Register `canvas.onpaint` handler per HTML-in-Canvas specification
let paintedThisFrame = false;

if (supportsNativeHIC) {
  canvas.onpaint = (event) => {
    paintedThisFrame = true;
    const changedSet =
      event && Array.isArray(event.changedElements)
        ? new Set(event.changedElements)
        : null;
    updateSceneAndSync(performance.now(), changedSet);
  };
}

// Main Animation Loop
function renderLoop(nowMs) {
  paintedThisFrame = false;
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
  if (!paintedThisFrame) {
    updateSceneAndSync(nowMs, null);
  }
  requestAnimationFrame(renderLoop);
}

requestAnimationFrame(renderLoop);
