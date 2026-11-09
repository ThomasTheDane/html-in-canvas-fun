import * as THREE from './vendor/three.module.js';

/**
 * Gothic Geometry — Stained-Glass Shard Art & HTML-in-Canvas Marketing Site
 *
 * Architecture:
 * 1. High-resolution (2048×2048) WebGL Procedural Stained-Glass Shard Art Textures
 *    (`THREE.WebGLRenderTarget`) directly inspired by contemporary French cathedral
 *    flame-shard stained glass ("Le Sacerdoce"): sweeping, interlocking curved glass
 *    blades in fiery ruby, magenta-violet, burnt amber-gold, electric ice-cerulean,
 *    and deep Chartres cobalt, with hand-blown verre-antique striations and
 *    Beer-Lambert optical absorption.
 * 2. Watertight 3D Flame-Shard Tessellation (~294 interlocking curved flame-blade
 *    shards per window sharing bit-for-bit identical boundary vertices). At rest
 *    (`shatter = 0`), the shards lock together with 0.0000 gap so there are zero
 *    gaps or lines interrupting the glass or the DOM UI. On scroll (`shatter > 0`),
 *    all ~294 curved glass shards break apart in 3D carrying both the stained-glass
 *    art and the fractured DOM UI.
 * 3. Live HTML-in-Canvas DOM UI (`<canvas layoutsubtree content="drawable">` +
 *    Three.js r187 `THREE.HTMLTexture`) painted directly onto the glass shards.
 */

// ============================================================================
// 1. DOM REFERENCES & WINDOW STAGE CONFIGURATION
// ============================================================================

const canvas = document.getElementById('cathedral-canvas');
const stageViewport = document.getElementById('stage-viewport');
const scrollProgressBar = document.getElementById('scroll-progress-bar');
const glassBloom = document.getElementById('glass-bloom');
const scrollHintLabel = document.getElementById('scroll-hint-label');
const railDots = Array.from(document.querySelectorAll('.rail-dot'));

const stageElements = [
  document.getElementById('glass-stage-0'),
  document.getElementById('glass-stage-1'),
  document.getElementById('glass-stage-2'),
  document.getElementById('glass-stage-3')
];

const prefersReducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let prefersReducedMotion = prefersReducedMotionQuery.matches;
prefersReducedMotionQuery.addEventListener('change', (e) => {
  prefersReducedMotion = e.matches;
});

// Exact Gothic Window Outer Envelope in World Coordinates
const WIN_HALF_W = 3.96;
const WIN_SPAN = WIN_HALF_W * 2.0; // 7.92
const WIN_Y_BOTTOM = -4.16;
const WIN_Y_IMPOST = -0.86;
const WIN_Y_APEX = 4.22;
const WIN_ARCH_H = WIN_Y_APEX - WIN_Y_IMPOST; // 5.08 (archHeight / span = 0.6414 -> true pointed arch!)

// Pointed arch circle parameters for the outer Gothic window envelope:
// R = archHeight^2 / span + span / 4
const WIN_ARCH_R = (WIN_ARCH_H * WIN_ARCH_H) / WIN_SPAN + WIN_SPAN * 0.25;
const WIN_ARCH_CX_LEFT = -WIN_HALF_W + WIN_ARCH_R;   // positive x (center for left rising arc)
const WIN_ARCH_CX_RIGHT = WIN_HALF_W - WIN_ARCH_R;  // negative x (center for right rising arc)
const WIN_ARCH_APEX_ANGLE = Math.asin(Math.min(1, WIN_ARCH_H / WIN_ARCH_R));

const GLASS_Z = 0.0;
const STONE_Z = 0.018;

// Bounding box of the entire window for 2048x2048 WebGL glass art UV mapping
const WINDOW_UV_BOUNDS = {
  minX: -WIN_HALF_W,
  maxX: WIN_HALF_W,
  minY: WIN_Y_BOTTOM,
  maxY: WIN_Y_APEX
};

// Shared world-space rectangle where the 860×530 HTML-in-Canvas DOM UI overlaps the glass shards
const SHARED_UI_BOUNDS = {
  minX: -3.56,
  maxX: 3.56,
  minY: -4.00,
  maxY: 0.42
};

const STAGE_CONFIG = [
  {
    name: 'Sacred Fire Lancet & Oculus Window',
    uiBounds: SHARED_UI_BOUNDS,
    cssWidth: 860,
    cssHeight: 530,
    seed: 0.0,
    bloom: [
      'radial-gradient(circle at 50% 34%, rgba(232, 38, 78, 0.22), transparent 44%)',
      'radial-gradient(circle at 38% 62%, rgba(48, 136, 255, 0.20), transparent 42%)',
      'radial-gradient(circle at 62% 58%, rgba(255, 164, 36, 0.17), transparent 40%)'
    ].join(', ')
  },
  {
    name: 'Golden Rose & Triptych Shard Window',
    uiBounds: SHARED_UI_BOUNDS,
    cssWidth: 860,
    cssHeight: 530,
    seed: 1.0,
    bloom: [
      'radial-gradient(circle at 50% 30%, rgba(255, 172, 38, 0.22), transparent 44%)',
      'radial-gradient(circle at 36% 62%, rgba(224, 34, 68, 0.19), transparent 42%)',
      'radial-gradient(circle at 64% 62%, rgba(36, 112, 255, 0.19), transparent 42%)'
    ].join(', ')
  },
  {
    name: 'Celeste & Amethyst Flame Window',
    uiBounds: SHARED_UI_BOUNDS,
    cssWidth: 860,
    cssHeight: 530,
    seed: 2.0,
    bloom: [
      'radial-gradient(circle at 48% 32%, rgba(56, 168, 255, 0.22), transparent 44%)',
      'radial-gradient(circle at 38% 64%, rgba(164, 42, 224, 0.19), transparent 42%)',
      'radial-gradient(circle at 62% 60%, rgba(28, 188, 142, 0.16), transparent 40%)'
    ].join(', ')
  },
  {
    name: 'Sanctuary Portal Flame Window',
    uiBounds: SHARED_UI_BOUNDS,
    cssWidth: 860,
    cssHeight: 530,
    seed: 3.0,
    bloom: [
      'radial-gradient(circle at 50% 30%, rgba(188, 38, 196, 0.22), transparent 44%)',
      'radial-gradient(circle at 50% 62%, rgba(238, 48, 68, 0.20), transparent 44%)',
      'radial-gradient(circle at 50% 78%, rgba(255, 178, 42, 0.16), transparent 38%)'
    ].join(', ')
  }
];

const NUM_STAGES = STAGE_CONFIG.length;

// ============================================================================
// 2. THREE.JS r187 RENDERER & HTML-IN-CANVAS (`THREE.HTMLTexture`) SETUP
// ============================================================================

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const gl = renderer.getContext();
const supportsNativeHIC =
  ('content' in HTMLCanvasElement.prototype || 'layoutSubtree' in HTMLCanvasElement.prototype) &&
  ('texElementSubImage2D' in gl || 'texElementImage2D' in gl);

if (!supportsNativeHIC) {
  const fallbackOverlay = document.createElement('div');
  fallbackOverlay.className = 'hic-fallback-overlay';
  stageViewport.insertBefore(fallbackOverlay, canvas.nextSibling);
  stageElements.forEach((el) => {
    if (el) fallbackOverlay.appendChild(el);
  });
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0, 0, 13.5);
camera.lookAt(0, 0, 0);

// Warm architectural cathedral lighting for the outer Gothic stone arch & upper oculus ring
const ambientStoneLight = new THREE.AmbientLight(0xe4dacb, 1.25);
scene.add(ambientStoneLight);

const keyStoneLight = new THREE.DirectionalLight(0xfff0d4, 1.75);
keyStoneLight.position.set(3.2, 5.5, 8.0);
scene.add(keyStoneLight);

const rimStoneLight = new THREE.DirectionalLight(0x9ec0ff, 0.85);
rimStoneLight.position.set(-4.5, 2.2, 5.5);
scene.add(rimStoneLight);

// ============================================================================
// 3. HIGH-DPI 2D CANVAS FALLBACK FOR BROWSERS WITHOUT NATIVE HIC FLAG
// ============================================================================

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, align = 'left') {
  const words = text.trim().split(/\s+/);
  let line = '';
  let currY = y;
  ctx.textAlign = align;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, currY);
      line = words[i];
      currY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, currY);
    currY += lineHeight;
  }
  return currY;
}

function drawRoundedBox(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

function createFallbackGlassUITexture(stageIdx) {
  const cfg = STAGE_CONFIG[stageIdx];
  const w = cfg.cssWidth;
  const h = cfg.cssHeight;
  const c = document.createElement('canvas');
  c.width = w * 2;
  c.height = h * 2;
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  ctx.clearRect(0, 0, w, h);

  drawRoundedBox(ctx, 14, 10, w - 28, 220, 18, 'rgba(6, 9, 22, 0.38)', 'rgba(255, 232, 176, 0.36)');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe08a';
  ctx.font = '700 11px sans-serif';
  ctx.fillText('ARS GEOMETRIAE · COMPASS & STRAIGHTEDGE', w * 0.5, 42);
  ctx.fillStyle = '#fffdf9';
  ctx.font = '600 44px Georgia, serif';
  ctx.fillText(stageIdx === 0 ? 'Gothic Geometry' : cfg.name, w * 0.5, 90);
  ctx.fillStyle = 'rgba(255, 250, 238, 0.94)';
  ctx.font = '400 14.5px sans-serif';
  wrapCanvasText(
    ctx,
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.',
    w * 0.5,
    124,
    610,
    22,
    'center'
  );
  drawRoundedBox(ctx, w * 0.5 - 102, 174, 204, 40, 20, 'rgba(255, 251, 240, 0.96)', 'rgba(255, 236, 179, 0.96)');
  ctx.fillStyle = '#0b0e1b';
  ctx.font = '700 13.5px sans-serif';
  ctx.fillText('Launch Teaching App  →', w * 0.5, 199);

  const cardW = (w - 28 - 28) / 3;
  ['I · PROPORTIO', 'II · TRACERY', 'III · LUX SACRA'].forEach((kicker, idx) => {
    const cx = 14 + idx * (cardW + 14);
    drawRoundedBox(ctx, cx, 246, cardW, 270, 14, 'rgba(6, 9, 22, 0.42)', 'rgba(255, 232, 176, 0.38)');
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffe08a';
    ctx.font = '700 10.5px sans-serif';
    ctx.fillText(kicker, cx + 20, 278);
    ctx.fillStyle = '#fffdf9';
    ctx.font = '600 20px Georgia, serif';
    ctx.fillText('Lorem Ipsum Dolor', cx + 20, 306);
    ctx.fillStyle = 'rgba(255, 250, 238, 0.92)';
    ctx.font = '400 13px sans-serif';
    wrapCanvasText(
      ctx,
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna.',
      cx + 20,
      334,
      cardW - 40,
      19.5,
      'left'
    );
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

const stageHtmlTextures = stageElements.map((el, idx) => {
  if (supportsNativeHIC && el) {
    const htmlTex = new THREE.HTMLTexture(el);
    htmlTex.colorSpace = THREE.SRGBColorSpace;
    htmlTex.minFilter = THREE.LinearFilter;
    htmlTex.magFilter = THREE.LinearFilter;
    htmlTex.generateMipmaps = false;
    return htmlTex;
  }
  return createFallbackGlassUITexture(idx);
});

function requestStagePaint(stageIdx) {
  const tex = stageHtmlTextures[stageIdx];
  if (tex) tex.needsUpdate = true;
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
}

// ============================================================================
// 4. HIGH-RESOLUTION (2048×2048) WEBGL STAINED-GLASS SHARD ART GENERATOR
//    Modeled directly after the user's reference photo ("Le Sacerdoce"):
//    Sweeping, curving, flame-like & arched-petal glass shards in ruby,
//    magenta-violet, burnt amber-gold, electric ice-cerulean, and deep cobalt,
//    with hand-blown verre-antique lengthwise brushstrokes & Beer-Lambert glow.
// ============================================================================

const GLASS_ART_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const GLASS_ART_FRAG = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform float uStageSeed;
  uniform vec4 uWindowBounds; // minX, maxX, minY, maxY

  // Fast high-quality 2D -> 3D hash
  vec3 hash23(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
  }

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Smooth value noise & anisotropic FBM for hand-blown glass striations
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbmStreaks(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.96, 0.28, -0.28, 0.96);
    for (int i = 0; i < 5; i++) {
      v += amp * vnoise(p);
      p = rot * p * 2.06 + vec2(7.1, 3.7);
      amp *= 0.5;
    }
    return v;
  }

  // Non-uniform smooth coordinate warp so glass shard widths vary naturally
  float nonUniformRibbonWarp(float x, float seed) {
    return x
      + 0.30 * sin(x * 1.65 + seed * 2.1)
      + 0.16 * cos(x * 3.10 - seed * 1.4);
  }

  float nonUniformRibbonWarpDeriv(float x, float seed) {
    return 1.0
      + 0.30 * 1.65 * cos(x * 1.65 + seed * 2.1)
      - 0.16 * 3.10 * sin(x * 3.10 - seed * 1.4);
  }

  // Curated Cathedral Stained-Glass Pigment Families (matching reference photo!)
  // Returns dark pooled edge pigment, rich mid-body pigment, and luminous core pigment
  void pickCathedralGlassPigment(
    float h,
    float streamWarmth,
    float stageId,
    out vec3 edgePigment,
    out vec3 midPigment,
    out vec3 corePigment
  ) {
    // Cohesive cathedral color streams (macro current + per-shard jewel variation)
    // so neighboring shards form sweeping rivers of fire (ruby/crimson/amber/coral)
    // interwoven with rivers of sky & night (cobalt/ultramarine/ice-cerulean/amethyst)
    float streamSelector = fract(streamWarmth * 0.55 + h * 0.34 + stageId * 0.23);
    float subVar = fract(h * 17.3 + streamWarmth * 0.7);

    // Occasional contrasting jewel accent shard (12% of shards)
    if (fract(h * 31.7) > 0.88) {
      streamSelector = fract(streamSelector + 0.48);
    }

    if (streamSelector < 0.30) {
      // Fiery Cathedral Ruby -> Deep Crimson -> Glowing Vermilion-Scarlet Core
      edgePigment = mix(vec3(0.28, 0.01, 0.04), vec3(0.42, 0.02, 0.08), subVar);
      midPigment  = mix(vec3(0.74, 0.04, 0.12), vec3(0.88, 0.10, 0.17), subVar);
      corePigment = mix(vec3(0.95, 0.22, 0.15), vec3(1.00, 0.36, 0.19), subVar);
    } else if (streamSelector < 0.48) {
      // Burnt Cathedral Amber -> Golden Ochre -> Warm Honey-Gold Core
      edgePigment = mix(vec3(0.35, 0.09, 0.01), vec3(0.48, 0.16, 0.02), subVar);
      midPigment  = mix(vec3(0.82, 0.32, 0.03), vec3(0.92, 0.46, 0.06), subVar);
      corePigment = mix(vec3(0.98, 0.64, 0.10), vec3(1.00, 0.76, 0.18), subVar);
    } else if (streamSelector < 0.58) {
      // Warm Carmine-Rose / Coral-Flame Transitional Shard
      edgePigment = mix(vec3(0.34, 0.04, 0.10), vec3(0.46, 0.07, 0.14), subVar);
      midPigment  = mix(vec3(0.78, 0.16, 0.24), vec3(0.88, 0.26, 0.26), subVar);
      corePigment = mix(vec3(0.96, 0.46, 0.30), vec3(1.00, 0.60, 0.36), subVar);
    } else if (streamSelector < 0.73) {
      // Crystalline Sky / Ice-Cerulean Blue (signature glowing sky-blue shards in photo!)
      edgePigment = mix(vec3(0.06, 0.22, 0.56), vec3(0.11, 0.32, 0.68), subVar);
      midPigment  = mix(vec3(0.17, 0.50, 0.88), vec3(0.27, 0.64, 0.95), subVar);
      corePigment = mix(vec3(0.45, 0.78, 0.98), vec3(0.60, 0.88, 1.00), subVar);
    } else if (streamSelector < 0.89) {
      // Deep Chartres Cobalt / Royal Ultramarine
      edgePigment = mix(vec3(0.02, 0.05, 0.28), vec3(0.04, 0.09, 0.40), subVar);
      midPigment  = mix(vec3(0.06, 0.18, 0.72), vec3(0.11, 0.28, 0.86), subVar);
      corePigment = mix(vec3(0.16, 0.42, 0.96), vec3(0.26, 0.54, 1.00), subVar);
    } else {
      // Royal Amethyst / Deep Plum-Magenta
      edgePigment = mix(vec3(0.20, 0.02, 0.28), vec3(0.30, 0.04, 0.36), subVar);
      midPigment  = mix(vec3(0.52, 0.08, 0.58), vec3(0.68, 0.12, 0.64), subVar);
      corePigment = mix(vec3(0.82, 0.22, 0.68), vec3(0.92, 0.32, 0.62), subVar);
    }
  }

  void main() {
    // Map UV [0..1] to exact Gothic window world coordinates (wx, wy)
    vec2 p = vec2(
      mix(uWindowBounds.x, uWindowBounds.y, vUv.x),
      mix(uWindowBounds.z, uWindowBounds.w, vUv.y)
    );

    float stageShift = uStageSeed * 3.7;

    // ------------------------------------------------------------------------
    // 1. SWEEPING CURVILINEAR FLAME & ARCHED-PETAL COORDINATE FIELD
    //    Replicates the upward-to-diagonal flame sweep of the reference photo:
    //    - In the lower/mid window, shards rise in S-curve flame waves &
    //      sweeping parabolic Gothic petals.
    //    - In the upper crown & oculus, shards sweep diagonally like tongues
    //      of sacred fire!
    // ------------------------------------------------------------------------
    float upperSweep = smoothstep(-1.2, 3.4, p.y);
    float oculusSwirl = exp(-dot(p - vec2(0.0, 2.06), p - vec2(0.0, 2.06)) * 0.28);

    // Direction of diagonal flame sweep varies by stage
    float sweepDir = (mod(uStageSeed, 2.0) < 0.5) ? 1.0 : -0.88;

    // Smooth curvilinear domain warp
    float waveX =
      0.38 * sin(p.y * 0.74 + p.x * 0.48 + stageShift) +
      0.19 * cos(p.y * 1.52 - p.x * 1.08 - stageShift * 0.6) +
      0.09 * sin(p.y * 2.65 + p.x * 1.75 + 1.3);

    float waveY =
      0.30 * cos(p.x * 0.90 - p.y * 0.44 + stageShift) +
      0.15 * sin(p.x * 1.95 + p.y * 1.15);

    // Parabolic arch lift inside each of the 4 lancet bays in the lower/middle window
    float lancetBayX = sin((p.x + 3.96) * (3.14159265 / 1.98));
    float lowerArchLift = (1.0 - upperSweep * 0.75) * 0.24 * lancetBayX * lancetBayX;

    // Diagonal flame bend into the upper circular oculus
    float bendX = p.x - sweepDir * upperSweep * (p.y + 1.1) * 0.48 + waveX + oculusSwirl * 0.28 * sin(p.y * 1.70);
    float bendY = p.y + sweepDir * upperSweep * p.x * 0.26 + waveY + lowerArchLift;

    // Two acute-angled intersecting curve families that carve the window into
    // elongated, sharp-pointed, curved flame blades & Gothic petals!
    float scaleA = 2.85;
    float scaleB = 2.85;

    float rawA = bendX * scaleA + bendY * 0.62;
    float rawB = bendX * scaleB - bendY * 0.68 + 0.42 * sin(bendY * 0.68 + bendX * 0.78 + stageShift);

    float wA = nonUniformRibbonWarp(rawA, 1.1 + uStageSeed);
    float wB = nonUniformRibbonWarp(rawB, 4.7 + uStageSeed);

    float idA = floor(wA);
    float idB = floor(wB);

    float fA = fract(wA);
    float fB = fract(wB);

    // World-space gradient norms so shard edge width is uniform everywhere
    float gradA = max(0.65, abs(nonUniformRibbonWarpDeriv(rawA, 1.1 + uStageSeed)) * scaleA);
    float gradB = max(0.65, abs(nonUniformRibbonWarpDeriv(rawB, 4.7 + uStageSeed)) * scaleB);

    float dEdgeA = min(fA, 1.0 - fA) / gradA;
    float dEdgeB = min(fB, 1.0 - fB) / gradB;

    // Deterministic per-cell hash (100% constant inside each (idA, idB) curved diamond!)
    vec3 cellHash = hash23(vec2(idA * 1.37 + uStageSeed * 19.0, idB * 2.41 + uStageSeed * 7.3));

    // 1) Corner-pinned longitudinal flame spine from (0,0) to (1,1):
    //    Because sin(0) == 0 and sin(2*PI) == 0, diagCurve passes through the exact
    //    cell corners (0,0) and (1,1) and NEVER wraps or creates T-junctions!
    float diagBow = (cellHash.x - 0.5) * 0.38;
    float diagCurve = (fA - fB) + diagBow * sin((fA + fB) * 3.14159265);
    float useDiagSplit = step(0.16, cellHash.y);
    float diagSide = useDiagSplit * step(0.0, diagCurve);
    float dEdgeDiag = useDiagSplit > 0.5 ? (abs(diagCurve) / (gradA * 1.12)) : 10.0;

    // 2) Corner-pinned cross-petal Gothic arch from (0,1) to (1,0):
    //    Because sin(-PI) == 0 and sin(+PI) == 0, petalCurve passes through the exact
    //    cell corners (0,1) and (1,0) and NEVER wraps or jumps inside a cell!
    float petalBow = (cellHash.z - 0.5) * 0.42;
    float petalCurve = (fA + fB - 1.0) + petalBow * sin((fA - fB) * 3.14159265);
    float usePetalCut = step(0.54, cellHash.z);
    float petalSide = usePetalCut * step(0.0, petalCurve);
    float dEdgePetal = usePetalCut > 0.5 ? (abs(petalCurve) / (gradB * 1.12)) : 10.0;

    // Exact distance to the nearest curved shard boundary (in world units)
    float effectiveEdgeDist = min(min(dEdgeA, dEdgeB), min(dEdgeDiag, dEdgePetal));

    // Unique Shard Identifier for color & brushstroke lookup (only changes across edged curves!)
    vec2 shardId = vec2(
      idA * 4.0 + diagSide * 2.0 + petalSide,
      idB * 4.0 + petalSide * 1.5 + uStageSeed * 29.0
    );
    vec3 sh = hash23(shardId);
    vec3 sh2 = hash23(shardId + vec2(41.7, 19.3));

    // Smooth, 100% continuous intra-shard coordinates (zero wrap jumps inside any shard!)
    float spineU = (fA - fB) * 0.5 + 0.5;
    float spineV = (fA + fB) * 0.5;

    // ------------------------------------------------------------------------
    // 2. MACRO COLOR CURRENTS & UPPER OCULUS HARMONY
    //    IMPORTANT: Quantized per-shard coordinates (qA, qB) are used for
    //    streamWarmth so pickCathedralGlassPigment is 100% constant inside
    //    every individual shard and never switches pigment family mid-shard!
    // ------------------------------------------------------------------------
    vec2 oculusCenter = vec2(0.0, 2.06);
    float oculusR = 1.48;
    float distToOculusRing = abs(length(p - oculusCenter) - oculusR);

    float qA = (idA + 0.5 + (diagSide - 0.5) * 0.35) / scaleA;
    float qB = (idB + 0.5 + (petalSide - 0.5) * 0.35) / scaleB;
    float qX = (qA + qB) * 0.5;
    float qY = (qA - qB) * 0.75;

    // Sweeping warm/cool cathedral currents (ruby/amber fire vs cobalt/ice-blue streams)
    float streamWarmth =
      0.46 * sin(qX * 0.92 - qY * 0.36 + stageShift) +
      0.34 * cos(qX * 1.28 + qY * 0.52 - stageShift * 0.5) +
      0.22 * sin(length(vec2(qX, qY) - vec2(0.0, 1.2)) * 1.65 - stageShift);

    // ------------------------------------------------------------------------
    // 3. HAND-BLOWN VERRE-ANTIQUE GLASS COLOR, STRIATIONS & JEWEL DEPTH
    //    Strictly preserves deep stained-glass saturation with zero white clip!
    // ------------------------------------------------------------------------
    vec3 edgePigment;
    vec3 midPigment;
    vec3 corePigment;
    pickCathedralGlassPigment(sh.x, streamWarmth, uStageSeed, edgePigment, midPigment, corePigment);

    // Rotate local coordinates along the local flame angle so brushstrokes follow the shard curve!
    float flameAngle = 0.36 * upperSweep * sweepDir + (sh.y - 0.5) * 0.34;
    float ca = cos(flameAngle);
    float sa = sin(flameAngle);
    vec2 rotP = mat2(ca, -sa, sa, ca) * p;

    // Anisotropic lengthwise glass striations (stretched 11:1 along the flame blade!)
    float streaks = fbmStreaks(vec2(rotP.x * 11.5 + sh.x * 31.0, rotP.y * 1.35 + sh.y * 17.0));
    float fineBrush = vnoise(vec2(rotP.x * 29.0 + sh2.x * 40.0, rotP.y * 3.4 + streaks * 2.6));
    float grisailleGrain = vnoise(vec2(rotP.x * 52.0 - sh.z * 23.0, rotP.y * 6.5));

    // Edge pooling: glass is thicker & more deeply saturated near the curved shard rim
    float edgePooling = 1.0 - smoothstep(0.004, 0.068, effectiveEdgeDist);

    // Organic lengthwise gradient + hand-painted brushstroke modulation along each shard
    float lengthFlow = clamp(
      spineV * 0.62 +
      (streaks - 0.5) * 0.54 +
      (fineBrush - 0.5) * 0.24 +
      (sh2.y - 0.5) * 0.26,
      0.0,
      1.0
    );

    // Blend between rich mid-body pigment and luminous core pigment along the brushstrokes
    float coreMask = smoothstep(0.26, 0.86, lengthFlow) * (1.0 - edgePooling * 0.78);
    vec3 bodyColor = mix(midPigment, corePigment, coreMask);

    // Pool into deep jewel-toned edgePigment near shard boundaries and dark grisaille brush valleys
    float darkBrushValley = smoothstep(0.48, 0.12, streaks * 0.78 + fineBrush * 0.22);
    float poolFactor = clamp(edgePooling * 0.78 + darkBrushValley * 0.38, 0.0, 0.92);
    vec3 glassColor = mix(bodyColor, edgePigment, poolFactor);

    // Subtle fine hand-blown striation texture (grisaille hairlines inside the shard)
    glassColor *= (0.90 + 0.16 * fineBrush + 0.06 * grisailleGrain);

    // Warm backlit cathedral sun radiance (centered in upper-mid window, never blowing out!)
    float sunBeam = exp(-dot(p - vec2(0.0, 0.95), p - vec2(0.0, 0.95)) * 0.038);
    glassColor *= (0.92 + 0.16 * sunBeam);

    // ------------------------------------------------------------------------
    // 4. SUBTLE CUT-GLASS RIM GLINT & DELICATE DARK FUSION / CAME HAIRLINE
    // ------------------------------------------------------------------------
    // Subtle internal refractive glint right inside the shard edge (colored by corePigment, never white!)
    float innerFacetRim = smoothstep(0.030, 0.008, effectiveEdgeDist) * smoothstep(0.002, 0.008, effectiveEdgeDist);
    glassColor = mix(glassColor, corePigment * 1.06, innerFacetRim * 0.32);

    // Crisp, delicate dark charcoal-lead / fused-glass hairline right at the shard boundary
    float cameLine = 1.0 - smoothstep(0.000, 0.011, effectiveEdgeDist);
    glassColor = mix(glassColor, glassColor * 0.15 + vec3(0.02, 0.02, 0.04), cameLine * 0.88);

    // ------------------------------------------------------------------------
    // 5. UPPER OCULUS RING SHADOW (STRICTLY ABOVE DOM UI ZONE)
    // ------------------------------------------------------------------------
    float oculusShadow = (1.0 - smoothstep(0.018, 0.054, distToOculusRing));
    glassColor = mix(glassColor, glassColor * 0.20 + vec3(0.04, 0.035, 0.035), oculusShadow * 0.70);

    gl_FragColor = vec4(clamp(glassColor, 0.0, 1.0), 1.0);
  }
`;

const fboScene = new THREE.Scene();
const fboCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fboMaterial = new THREE.ShaderMaterial({
  vertexShader: GLASS_ART_VERT,
  fragmentShader: GLASS_ART_FRAG,
  uniforms: {
    uStageSeed: { value: 0.0 },
    uWindowBounds: {
      value: new THREE.Vector4(
        WINDOW_UV_BOUNDS.minX,
        WINDOW_UV_BOUNDS.maxX,
        WINDOW_UV_BOUNDS.minY,
        WINDOW_UV_BOUNDS.maxY
      )
    }
  },
  depthTest: false,
  depthWrite: false,
  toneMapped: false
});
const fboQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fboMaterial);
fboScene.add(fboQuad);

/**
 * Synthesizes a 2048×2048 WebGL Stained-Glass Shard Art Texture on the GPU for `stageIdx`.
 */
function generateStageGlassArtRenderTarget(stageIdx) {
  const rt = new THREE.WebGLRenderTarget(2048, 2048, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;

  fboMaterial.uniforms.uStageSeed.value = STAGE_CONFIG[stageIdx].seed;

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(fboScene, fboCamera);
  renderer.setRenderTarget(prevTarget);

  return rt.texture;
}

const stageGlassArtTextures = STAGE_CONFIG.map((_, idx) => generateStageGlassArtRenderTarget(idx));

// ============================================================================
// 5. LIVE SHARD MATERIAL COMPOSITING WEBGL GLASS ART + `THREE.HTMLTexture` DOM UI
//    - At `uShatter == 0`: 100% seamless across all ~294 shards (zero mesh lines!)
//    - Where DOM UI sits (`domTexel.a > 0`): locally deepens Beer-Lambert glass
//      absorption behind the typography so the flame shards remain vividly
//      visible right through the UI while text & buttons are razor-sharp!
//    - When `uShatter > 0`: reveals 3D cut-glass refractive bevels & specular
//      reflections on each tumbling flame shard!
// ============================================================================

const shardUniforms = {
  uGlassArtTex: { value: stageGlassArtTextures[0] },
  uHtmlTex: { value: stageHtmlTextures[0] },
  uTime: { value: 0.0 },
  uPointer: { value: new THREE.Vector2(0.0, 0.0) },
  uShatter: { value: 0.0 },
  uOpacity: { value: 1.0 }
};

const stainedGlassShardMaterial = new THREE.ShaderMaterial({
  uniforms: shardUniforms,
  transparent: true,
  depthWrite: true,
  toneMapped: false,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    attribute vec2 aWindowUv;
    attribute vec2 aUiUv;
    attribute vec2 aShardLocalUv;

    varying vec2 vWindowUv;
    varying vec2 vUiUv;
    varying vec2 vShardLocalUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;

    void main() {
      vWindowUv = aWindowUv;
      vUiUv = aUiUv;
      vShardLocalUv = aShardLocalUv;

      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D uGlassArtTex;
    uniform sampler2D uHtmlTex;
    uniform float uTime;
    uniform vec2 uPointer;
    uniform float uShatter;
    uniform float uOpacity;

    varying vec2 vWindowUv;
    varying vec2 vUiUv;
    varying vec2 vShardLocalUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;

    void main() {
      // 1. Sample the 2048x2048 WebGL Flame-Shard Stained-Glass Backdrop Texture
      vec3 glassCol = texture2D(uGlassArtTex, vWindowUv).rgb;

      // 2. Dynamic pointer-responsive cathedral sun caustics behind the window
      vec2 sunPos = vec2(uPointer.x * 1.45, 0.85 + uPointer.y * 1.05);
      float sunDist = length(vWorldPos.xy - sunPos);
      float sunCaustic = exp(-sunDist * sunDist * 0.042);
      glassCol *= (0.97 + 0.16 * sunCaustic);

      // 3. When scrolling (uShatter > 0), reveal 3D cut-glass bevels & specular glints
      //    as the 294 individual flame shards break apart and tilt in 3D space!
      //    At uShatter == 0, this is strictly 0.0 so ZERO lines/gaps exist between meshes!
      if (uShatter > 0.002) {
        float shatterAmt = smoothstep(0.0, 0.14, uShatter);
        float dEdge = min(
          min(vShardLocalUv.x, 1.0 - vShardLocalUv.x),
          min(vShardLocalUv.y, 1.0 - vShardLocalUv.y)
        );
        float cutBevel = (1.0 - smoothstep(0.0, 0.065, dEdge)) * shatterAmt;

        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(vec3(0.35, 0.62, 0.72));
        float spec = pow(max(dot(abs(N), normalize(L + V)), 0.0), 28.0);

        glassCol += vec3(1.0, 0.95, 0.84) * (cutBevel * 0.42 + spec * 0.52 * shatterAmt);
      }

      // 4. Paint live HTML-in-Canvas DOM UI (THREE.HTMLTexture) directly onto the glass shards!
      if (vUiUv.x >= 0.001 && vUiUv.x <= 0.999 && vUiUv.y >= 0.001 && vUiUv.y <= 0.999) {
        vec4 domTexel = texture2D(uHtmlTex, vUiUv);

        // Where text halos or sheer glass card frames sit (domTexel.a > 0):
        // Gently enrich Beer-Lambert pigment depth under text shadows while keeping
        // the colorful stained-glass flame shards vividly glowing through the UI!
        float haloWeight = smoothstep(0.12, 0.72, domTexel.a);
        vec3 deepenedGlass = pow(max(glassCol, vec3(0.01)), vec3(1.0 + 0.38 * haloWeight)) * (1.0 - 0.22 * haloWeight);

        glassCol = mix(deepenedGlass, domTexel.rgb, domTexel.a);
      }

      gl_FragColor = vec4(glassCol, uOpacity);
    }
  `
});

// ============================================================================
// 6. WATERTIGHT 3D FLAME-SHARD TESSELLATION ENGINE (0.0000 GAP AT REST!)
// ============================================================================

function hash2D(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Exact half-width `xMax(y)` of the pointed Gothic window at height `y`.
 * Guarantees every boundary shard hugs the outer Gothic arch with 0.0000 error!
 */
function getWindowHalfWidthAtY(y) {
  if (y <= WIN_Y_IMPOST) return WIN_HALF_W;
  const dy = Math.min(WIN_ARCH_H, Math.max(0, y - WIN_Y_IMPOST));
  const halfW = Math.sqrt(Math.max(0, WIN_ARCH_R * WIN_ARCH_R - dy * dy)) - WIN_ARCH_CX_LEFT;
  return Math.max(0.0, halfW);
}

/**
 * Builds a single 3D curved flame-shard mesh from an exact closed ring of world-space
 * `[wx, wy]` vertices. Because adjacent shards pass the exact same `[wx, wy]` points
 * along their shared edges and `curveSegments = 1` with `bevelEnabled = false`,
 * adjacent shards share bit-for-bit identical 3D vertices at `shatter = 0`!
 */
function buildWatertightFlameShardMesh(worldPts, salt = 0) {
  const shape = new THREE.Shape();
  for (let i = 0; i < worldPts.length; i++) {
    const [x, y] = worldPts[i];
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.014,
    bevelEnabled: false,
    curveSegments: 1
  });

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const cz = (bb.min.z + bb.max.z) * 0.5;
  const localW = Math.max(1e-4, bb.max.x - bb.min.x);
  const localH = Math.max(1e-4, bb.max.y - bb.min.y);

  // Compute the true area-weighted 2D polygon centroid of `worldPts` so that
  // paired diagonal flame blades inside the same cell have distinct 3D pivots!
  let area2 = 0.0;
  let cxAcc = 0.0;
  let cyAcc = 0.0;
  const nPts = worldPts.length;
  for (let i = 0; i < nPts; i++) {
    const [x0, y0] = worldPts[i];
    const [x1, y1] = worldPts[(i + 1) % nPts];
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cxAcc += (x0 + x1) * cross;
    cyAcc += (y0 + y1) * cross;
  }
  let cx = (bb.min.x + bb.max.x) * 0.5;
  let cy = (bb.min.y + bb.max.y) * 0.5;
  if (Math.abs(area2) > 1e-5) {
    cx = cxAcc / (3.0 * area2);
    cy = cyAcc / (3.0 * area2);
  }

  const wMinX = WINDOW_UV_BOUNDS.minX;
  const wSpanX = WINDOW_UV_BOUNDS.maxX - WINDOW_UV_BOUNDS.minX;
  const wMinY = WINDOW_UV_BOUNDS.minY;
  const wSpanY = WINDOW_UV_BOUNDS.maxY - WINDOW_UV_BOUNDS.minY;

  const uiMinX = SHARED_UI_BOUNDS.minX;
  const uiSpanX = SHARED_UI_BOUNDS.maxX - SHARED_UI_BOUNDS.minX;
  const uiMinY = SHARED_UI_BOUNDS.minY;
  const uiSpanY = SHARED_UI_BOUNDS.maxY - SHARED_UI_BOUNDS.minY;

  const pos = geo.attributes.position;
  const count = pos.count;

  const winUvs = new Float32Array(count * 2);
  const uiUvs = new Float32Array(count * 2);
  const shardLocalUvs = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const wx = pos.getX(i);
    const wy = pos.getY(i);
    const wz = pos.getZ(i);

    winUvs[i * 2] = (wx - wMinX) / wSpanX;
    winUvs[i * 2 + 1] = (wy - wMinY) / wSpanY;

    uiUvs[i * 2] = (wx - uiMinX) / uiSpanX;
    uiUvs[i * 2 + 1] = (wy - uiMinY) / uiSpanY;

    shardLocalUvs[i * 2] = (wx - bb.min.x) / localW;
    shardLocalUvs[i * 2 + 1] = (wy - bb.min.y) / localH;

    pos.setXYZ(i, wx - cx, wy - cy, wz - cz);
  }

  geo.setAttribute('aWindowUv', new THREE.BufferAttribute(winUvs, 2));
  geo.setAttribute('aUiUv', new THREE.BufferAttribute(uiUvs, 2));
  geo.setAttribute('aShardLocalUv', new THREE.BufferAttribute(shardLocalUvs, 2));
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, stainedGlassShardMaterial);
  mesh.position.set(cx, cy, GLASS_Z);

  return createAnimatedPieceRecord(mesh, cx, cy, GLASS_Z, salt);
}

function createAnimatedPieceRecord(mesh, rx, ry, rz, salt, bladeSide = 0) {
  const r1 = hash2D(rx * 13.7 + salt, ry * 29.3 + 1.7);
  const r2 = hash2D(rx * 41.1 + 5.3, ry * 17.9 + salt);
  const r3 = hash2D(rx * 23.3 + salt, ry * 37.1 + 9.1);
  const baseAngle = Math.atan2(ry, Math.abs(rx) < 0.001 && Math.abs(ry) < 0.001 ? 0.01 : rx);
  const radial = Math.hypot(rx, ry);

  // Opposing angular & Z separation for paired blades (bladeSide = -1 vs +1)
  // guarantees adjacent triangles never intersect in the 3D Z-buffer during shatter!
  const sideAngleSpread = bladeSide * 0.42;
  const sideZSpread = bladeSide * 1.35;

  return {
    mesh,
    rx,
    ry,
    rz,
    explodeAngle: baseAngle + sideAngleSpread + (r1 - 0.5) * 0.36,
    explodeDist: 6.2 + r2 * 3.8 + radial * 0.45,
    explodeZ: sideZSpread + (r3 - 0.45) * 3.6,
    spinX: (r1 - 0.5) * 3.2 + bladeSide * 0.65,
    spinY: (r2 - 0.5) * 3.6 - bladeSide * 0.65,
    spinZ: (r3 - 0.5) * 1.45,
    stagger: Math.min(0.14, radial * 0.018 + r1 * 0.04)
  };
}

/**
 * Partitions the Gothic pointed-arch window interior into ~342 interlocking,
 * curved flame-blade 3D glass shards that share bit-for-bit identical boundary
 * vertices (`0.0000` seam at rest) and break apart along the flame curves on scroll!
 */
function buildWatertightWindowFlameShards(stageIdx) {
  const pieces = [];
  const seed = STAGE_CONFIG[stageIdx].seed;
  const sweepDir = stageIdx % 2 === 0 ? 1.0 : -0.85;

  const NUM_STRIPS = 18;
  const NUM_SEGS = 9;
  const SEG_STEPS = 6;
  const NUM_V_STEPS = NUM_SEGS * SEG_STEPS; // 54
  const Y_CAP_BASE = 4.06; // Above 4.06 up to 4.22 (apex), fan shards close the pointed tip cleanly

  // 1. Precompute the shared curvilinear vertex lattice V[i][j].
  //    Each row `j` lies on a strictly increasing scanline `y`, while `x` sweeps along
  //    S-curved flame streamlines. Because every shard is y-monotone with x_left(y) < x_right(y),
  //    every polygon is 100% guaranteed non-self-intersecting and watertight!
  const V = Array.from({ length: NUM_STRIPS + 1 }, () => new Array(NUM_V_STEPS + 1));

  for (let j = 0; j <= NUM_V_STEPS; j++) {
    const v0 = j / NUM_V_STEPS;
    const y = WIN_Y_BOTTOM + (Y_CAP_BASE - WIN_Y_BOTTOM) * v0;
    const halfW = getWindowHalfWidthAtY(y);

    for (let i = 0; i <= NUM_STRIPS; i++) {
      const u0 = i / NUM_STRIPS;

      let s = u0;
      if (i > 0 && i < NUM_STRIPS) {
        const pinU = Math.sin(Math.PI * u0);
        const upperBias = Math.max(0, (v0 - 0.35) / 0.65);
        const ds =
          pinU *
          (0.072 * Math.sin(v0 * 5.5 + u0 * 4.8 + seed * 2.7) +
            0.042 * Math.cos(v0 * 10.2 - u0 * 6.4 - seed) +
            0.095 * sweepDir * upperBias * Math.sin(v0 * 3.1));
        s = Math.min(0.985, Math.max(0.015, u0 + ds));
      }

      const x = -halfW + s * (2.0 * halfW);
      V[i][j] = [x, y];
    }

    // Enforce strict left-to-right ordering along scanline `y` so streamlines never cross
    V[0][j][0] = -halfW;
    V[NUM_STRIPS][j][0] = halfW;
    const minStepX = (2.0 * Math.max(0.1, halfW)) / (NUM_STRIPS * 2.5);
    for (let i = 1; i < NUM_STRIPS; i++) {
      if (V[i][j][0] < V[i - 1][j][0] + minStepX) {
        V[i][j][0] = V[i - 1][j][0] + minStepX;
      }
    }
    for (let i = NUM_STRIPS - 1; i >= 1; i--) {
      if (V[i][j][0] > V[i + 1][j][0] - minStepX) {
        V[i][j][0] = V[i + 1][j][0] - minStepX;
      }
    }
  }

  // 2. For each strip `i` and segment `seg`, split the curved cell along a
  //    curved diagonal flame spine D[0..SEG_STEPS] into two sharp-pointed flame blades!
  let shardCounter = 0;
  for (let i = 0; i < NUM_STRIPS; i++) {
    for (let seg = 0; seg < NUM_SEGS; seg++) {
      const j0 = seg * SEG_STEPS;
      const j1 = (seg + 1) * SEG_STEPS;
      const flipDiag = (i + seg + stageIdx) % 2 === 0;

      // Precompute the shared curved diagonal spine points D[0 .. SEG_STEPS]
      const D = new Array(SEG_STEPS + 1);
      for (let s = 0; s <= SEG_STEPS; s++) {
        if (s === 0) {
          D[s] = flipDiag ? V[i][j0] : V[i + 1][j0];
        } else if (s === SEG_STEPS) {
          D[s] = flipDiag ? V[i + 1][j1] : V[i][j1];
        } else {
          const frac = s / SEG_STEPS;
          const curveBow = 0.14 * Math.sin(Math.PI * frac) * ((i + seg) % 2 === 0 ? 1 : -1);
          const t = Math.min(0.92, Math.max(0.08, (flipDiag ? frac : 1.0 - frac) + curveBow));
          const pL = V[i][j0 + s];
          const pR = V[i + 1][j0 + s];
          D[s] = [pL[0] + (pR[0] - pL[0]) * t, pL[1] + (pR[1] - pL[1]) * t];
        }
      }

      if (flipDiag) {
        // Diagonal goes from bottom-left V[i][j0] to top-right V[i+1][j1]
        // Blade A (Upper-Left Flame Shard): V[i][j0..j1] -> V[i+1][j1] -> D[SEG_STEPS-1 .. 1]
        const ptsA = [];
        for (let s = 0; s <= SEG_STEPS; s++) ptsA.push(V[i][j0 + s]);
        ptsA.push(V[i + 1][j1]);
        for (let s = SEG_STEPS - 1; s >= 1; s--) ptsA.push(D[s]);
        const recA = buildWatertightFlameShardMesh(ptsA, stageIdx * 500 + (++shardCounter));
        Object.assign(recA, createAnimatedPieceRecord(recA.mesh, recA.rx, recA.ry, recA.rz, stageIdx * 500 + shardCounter, -1));
        pieces.push(recA);

        // Blade B (Lower-Right Flame Shard): D[0..SEG_STEPS] -> V[i+1][j1-1 .. j0]
        const ptsB = [];
        for (let s = 0; s <= SEG_STEPS; s++) ptsB.push(D[s]);
        for (let s = SEG_STEPS - 1; s >= 0; s--) ptsB.push(V[i + 1][j0 + s]);
        const recB = buildWatertightFlameShardMesh(ptsB, stageIdx * 500 + (++shardCounter));
        Object.assign(recB, createAnimatedPieceRecord(recB.mesh, recB.rx, recB.ry, recB.rz, stageIdx * 500 + shardCounter, 1));
        pieces.push(recB);
      } else {
        // Diagonal goes from bottom-right V[i+1][j0] to top-left V[i][j1]
        // Blade A (Lower-Left Flame Shard): V[i][j0..j1] -> D[SEG_STEPS-1 .. 0]
        const ptsA = [];
        for (let s = 0; s <= SEG_STEPS; s++) ptsA.push(V[i][j0 + s]);
        for (let s = SEG_STEPS - 1; s >= 0; s--) ptsA.push(D[s]);
        const recA = buildWatertightFlameShardMesh(ptsA, stageIdx * 500 + (++shardCounter));
        Object.assign(recA, createAnimatedPieceRecord(recA.mesh, recA.rx, recA.ry, recA.rz, stageIdx * 500 + shardCounter, -1));
        pieces.push(recA);

        // Blade B (Upper-Right Flame Shard): D[0..SEG_STEPS] -> V[i+1][j1 .. j0+1]
        const ptsB = [];
        for (let s = 0; s <= SEG_STEPS; s++) ptsB.push(D[s]);
        for (let s = SEG_STEPS; s >= 1; s--) ptsB.push(V[i + 1][j0 + s]);
        const recB = buildWatertightFlameShardMesh(ptsB, stageIdx * 500 + (++shardCounter));
        Object.assign(recB, createAnimatedPieceRecord(recB.mesh, recB.rx, recB.ry, recB.rz, stageIdx * 500 + shardCounter, 1));
        pieces.push(recB);
      }
    }
  }

  // 3. Close the top pointed-arch apex cap (`y = Y_CAP_BASE .. WIN_Y_APEX`) with
  //    watertight fan flame shards sharing `V[i][NUM_V_STEPS]` and the exact arch curve!
  const apexPt = [0.0, WIN_Y_APEX];
  const capSteps = 6;
  const leftCapArc = [];
  const rightCapArc = [];
  for (let s = 0; s <= capSteps; s++) {
    const y = Y_CAP_BASE + ((WIN_Y_APEX - Y_CAP_BASE) * s) / capSteps;
    const hw = getWindowHalfWidthAtY(y);
    leftCapArc.push([-hw, y]);
    rightCapArc.push([hw, y]);
  }

  for (let i = 0; i < NUM_STRIPS; i++) {
    const pLeft = V[i][NUM_V_STEPS];
    const pRight = V[i + 1][NUM_V_STEPS];
    const capPts = [pLeft, pRight];

    if (i === NUM_STRIPS - 1) {
      for (let s = 1; s <= capSteps; s++) capPts.push(rightCapArc[s]);
    } else {
      capPts.push(apexPt);
    }

    if (i === 0) {
      for (let s = capSteps - 1; s >= 1; s--) capPts.push(leftCapArc[s]);
    }

    const recCap = buildWatertightFlameShardMesh(capPts, stageIdx * 500 + (++shardCounter));
    Object.assign(recCap, createAnimatedPieceRecord(recCap.mesh, recCap.rx, recCap.ry, recCap.rz, stageIdx * 500 + shardCounter, i % 2 === 0 ? -1 : 1));
    pieces.push(recCap);
  }

  return pieces;
}

// ============================================================================
// 7. SLENDER GOTHIC STONE PERIMETER ARCH & UPPER OCULUS RING
//    Frames the window silhouette without ever placing bars over the DOM UI!
// ============================================================================

function createCarvedLimestoneTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = (hash2D(x * 0.7, y * 0.7) - 0.5) * 16;
      const v = Math.max(60, Math.min(180, 128 + grain));
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.round(v * 1.04);
      img.data[idx + 1] = Math.round(v * 0.98);
      img.data[idx + 2] = Math.round(v * 0.90);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const stoneTraceryMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0x9a8f7e),
  emissive: new THREE.Color(0x1b1712),
  map: createCarvedLimestoneTexture(),
  roughness: 0.68,
  metalness: 0.10,
  transparent: true,
  opacity: 1.0
});

function makeStoneBarShape(x1, y1, x2, y2, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1e-5, Math.hypot(dx, dy));
  const nx = (-dy / len) * (width * 0.5);
  const ny = (dx / len) * (width * 0.5);

  const s = new THREE.Shape();
  s.moveTo(x1 + nx, y1 + ny);
  s.lineTo(x2 + nx, y2 + ny);
  s.lineTo(x2 - nx, y2 - ny);
  s.lineTo(x1 - nx, y1 - ny);
  s.closePath();
  return s;
}

function makeStoneArcShape(cx, cy, radius, a0, a1, width, steps = 20) {
  const rOut = radius + width * 0.5;
  const rIn = Math.max(0.005, radius - width * 0.5);
  const s = new THREE.Shape();

  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const x = cx + Math.cos(a) * rOut;
    const y = cy + Math.sin(a) * rOut;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    s.lineTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
  }
  s.closePath();
  return s;
}

function buildThinStonePiece(worldShape, depth = 0.044, z = STONE_Z, curveSegments = 16, salt = 0) {
  const geo = new THREE.ExtrudeGeometry(worldShape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.004,
    bevelSegments: 1,
    curveSegments
  });

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const cx = (bb.min.x + bb.max.x) * 0.5;
  const cy = (bb.min.y + bb.max.y) * 0.5;
  const cz = (bb.min.z + bb.max.z) * 0.5;

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz);
  }
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, stoneTraceryMaterial);
  mesh.position.set(cx, cy, z);

  return createAnimatedPieceRecord(mesh, cx, cy, z, salt + 900);
}

/**
 * Builds the slender outer Gothic pointed-arch frame + upper crown oculus ring
 * (matching the architectural frame in the reference photo without placing any
 * stone bars inside the DOM UI region!).
 */
function buildOuterGothicStoneFrame(stageIdx) {
  const pieces = [];
  const frameW = 0.056;
  const saltBase = stageIdx * 700;

  // 1. Vertical Left & Right Outer Jambs (`y = WIN_Y_BOTTOM .. WIN_Y_IMPOST`)
  const midJambY = (WIN_Y_BOTTOM + WIN_Y_IMPOST) * 0.5;
  pieces.push(buildThinStonePiece(makeStoneBarShape(-WIN_HALF_W, WIN_Y_BOTTOM, -WIN_HALF_W, midJambY, frameW), 0.048, STONE_Z, 4, saltBase + 1));
  pieces.push(buildThinStonePiece(makeStoneBarShape(-WIN_HALF_W, midJambY, -WIN_HALF_W, WIN_Y_IMPOST, frameW), 0.048, STONE_Z, 4, saltBase + 2));
  pieces.push(buildThinStonePiece(makeStoneBarShape(WIN_HALF_W, WIN_Y_BOTTOM, WIN_HALF_W, midJambY, frameW), 0.048, STONE_Z, 4, saltBase + 3));
  pieces.push(buildThinStonePiece(makeStoneBarShape(WIN_HALF_W, midJambY, WIN_HALF_W, WIN_Y_IMPOST, frameW), 0.048, STONE_Z, 4, saltBase + 4));

  // 2. Outer Pointed Gothic Arch Ribs (`y = WIN_Y_IMPOST .. WIN_Y_APEX`)
  const archSegs = 4;
  for (let k = 0; k < archSegs; k++) {
    const a0L = Math.PI - (WIN_ARCH_APEX_ANGLE * (k + 1)) / archSegs;
    const a1L = Math.PI - (WIN_ARCH_APEX_ANGLE * k) / archSegs;
    pieces.push(buildThinStonePiece(
      makeStoneArcShape(WIN_ARCH_CX_LEFT, WIN_Y_IMPOST, WIN_ARCH_R, a0L, a1L, frameW, 14),
      0.048,
      STONE_Z,
      14,
      saltBase + 10 + k
    ));

    const a0R = (WIN_ARCH_APEX_ANGLE * k) / archSegs;
    const a1R = (WIN_ARCH_APEX_ANGLE * (k + 1)) / archSegs;
    pieces.push(buildThinStonePiece(
      makeStoneArcShape(WIN_ARCH_CX_RIGHT, WIN_Y_IMPOST, WIN_ARCH_R, a0R, a1R, frameW, 14),
      0.048,
      STONE_Z,
      14,
      saltBase + 20 + k
    ));
  }

  // 3. Bottom Stone Sill (`y = WIN_Y_BOTTOM`)
  for (let k = 0; k < 4; k++) {
    const x0 = -WIN_HALF_W + (k * WIN_SPAN) / 4;
    const x1 = x0 + WIN_SPAN / 4;
    pieces.push(buildThinStonePiece(makeStoneBarShape(x0, WIN_Y_BOTTOM, x1, WIN_Y_BOTTOM, 0.058), 0.050, STONE_Z, 4, saltBase + 30 + k));
  }

  // 4. Slender Upper Oculus Ring (`center = (0, 2.06), R = 1.48`, strictly above DOM UI!)
  const oculusY = 2.06;
  const oculusR = 1.48;
  for (let k = 0; k < 6; k++) {
    const a0 = (k * Math.PI * 2) / 6;
    const a1 = ((k + 1) * Math.PI * 2) / 6;
    pieces.push(buildThinStonePiece(
      makeStoneArcShape(0.0, oculusY, oculusR, a0, a1, 0.040, 12),
      0.040,
      STONE_Z,
      12,
      saltBase + 40 + k
    ));
  }

  return pieces;
}

const stagePieceLists = STAGE_CONFIG.map((_, idx) => [
  ...buildWatertightWindowFlameShards(idx),
  ...buildOuterGothicStoneFrame(idx)
]);

const stageGroups = stagePieceLists.map((list, idx) => {
  const g = new THREE.Group();
  g.visible = idx === 0;
  for (const p of list) {
    g.add(p.mesh);
  }
  scene.add(g);
  return g;
});

// ============================================================================
// 8. SCROLL SHATTER / RECOMBINE & CHROME 159 ZERO-DOUBLE-TRANSFORM DOM SYNC
// ============================================================================

const MAX_STAGE_INDEX = NUM_STAGES - 1;
let targetStageFloat = 0;
let smoothStageFloat = 0;

function readScrollStageFloat() {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const pct = Math.min(1, Math.max(0, window.scrollY / maxScroll));
  return pct * MAX_STAGE_INDEX;
}

window.addEventListener('scroll', () => {
  targetStageFloat = readScrollStageFloat();
}, { passive: true });

function evaluateTransitionCurve(stageVal) {
  const clamped = Math.min(MAX_STAGE_INDEX, Math.max(0, stageVal));
  const baseIdx = Math.min(MAX_STAGE_INDEX - 1, Math.floor(clamped));
  const frac = clamped - baseIdx;
  const dwell = 0.08;

  let activeStage = baseIdx;
  let shatter = 0;

  if (frac <= dwell) {
    activeStage = baseIdx;
    shatter = 0;
  } else if (frac >= 1 - dwell) {
    activeStage = baseIdx + 1;
    shatter = 0;
  } else {
    const u = (frac - dwell) / (1 - 2 * dwell);
    if (u < 0.5) {
      activeStage = baseIdx;
      const outP = Math.min(1, u / 0.45);
      shatter = prefersReducedMotion ? outP : Math.pow(outP, 1.45);
    } else {
      activeStage = baseIdx + 1;
      const inP = Math.min(1, Math.max(0, (u - 0.55) / 0.45));
      shatter = prefersReducedMotion ? (1 - inP) : Math.pow(1 - inP, 1.55);
    }
  }

  const offscreenFade = shatter > 0.92 ? Math.max(0, 1 - (shatter - 0.92) / 0.075) : 1.0;
  return { activeStage, shatter, offscreenFade };
}

const _projTL = new THREE.Vector3();
const _projTR = new THREE.Vector3();
const _projBL = new THREE.Vector3();
const _offscreenMatrix = new DOMMatrix([0.001, 0, 0, 0.001, -9999, -9999]);

function projectWorldPointToCSS(worldVec, cssW, cssH) {
  const v = worldVec.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * cssW,
    y: (-v.y * 0.5 + 0.5) * cssH
  };
}

/**
 * Synchronizes the active `<article drawable>` hit-testing & native text-selection
 * geometry in CSS pixels.
 *
 * Chrome Canary 159+ actively applies `canvas.updateElementGeometry(el, { canvasTransform })`
 * to layout/hit-testing, so setting `el.style.transform` on top of it would apply
 * `canvasTransform` twice (`canvasTransform^2`). We clear `el.style.transform` first,
 * call `canvas.updateElementGeometry`, and only fall back to `el.style.transform`
 * if `updateElementGeometry` is a no-op stub (Chrome 155 / non-HIC fallback).
 */
function syncDrawableDOMGeometry(activeStage, shatter) {
  const cssW = canvas.clientWidth || window.innerWidth;
  const cssH = canvas.clientHeight || window.innerHeight;
  const isInteractive = shatter < 0.05;

  stageElements.forEach((el, idx) => {
    if (!el) return;

    if (idx !== activeStage || !isInteractive) {
      el.style.pointerEvents = 'none';
      el.setAttribute('inert', '');
      el.style.transform = '';
      let movedOffscreen = false;
      if (supportsNativeHIC && typeof canvas.updateElementGeometry === 'function') {
        try {
          canvas.updateElementGeometry(el, { canvasTransform: _offscreenMatrix });
          movedOffscreen = el.getBoundingClientRect().left < -1000;
        } catch (_e) {
          movedOffscreen = false;
        }
      }
      if (!movedOffscreen) {
        el.style.transform = 'translate3d(-9999px, -9999px, 0)';
      }
      return;
    }

    el.removeAttribute('inert');
    el.style.pointerEvents = 'auto';

    const cfg = STAGE_CONFIG[idx];
    const b = cfg.uiBounds;
    const frontZ = GLASS_Z + 0.007;

    _projTL.set(b.minX, b.maxY, frontZ);
    _projTR.set(b.maxX, b.maxY, frontZ);
    _projBL.set(b.minX, b.minY, frontZ);

    const tl = projectWorldPointToCSS(_projTL, cssW, cssH);
    const tr = projectWorldPointToCSS(_projTR, cssW, cssH);
    const bl = projectWorldPointToCSS(_projBL, cssW, cssH);

    const elemW = Math.max(1, el.offsetWidth || cfg.cssWidth);
    const elemH = Math.max(1, el.offsetHeight || cfg.cssHeight);

    const canvasTransform = new DOMMatrix();
    canvasTransform.a = (tr.x - tl.x) / elemW;
    canvasTransform.b = (tr.y - tl.y) / elemW;
    canvasTransform.c = (bl.x - tl.x) / elemH;
    canvasTransform.d = (bl.y - tl.y) / elemH;
    canvasTransform.e = tl.x;
    canvasTransform.f = tl.y;

    el.style.transform = '';
    let handledByNativeUpdateGeom = false;
    if (supportsNativeHIC && typeof canvas.updateElementGeometry === 'function') {
      try {
        canvas.updateElementGeometry(el, { canvasTransform });
        const rect = el.getBoundingClientRect();
        handledByNativeUpdateGeom =
          Math.abs(rect.left - tl.x) < 4.0 &&
          Math.abs(rect.top - tl.y) < 4.0;
      } catch (_e) {
        handledByNativeUpdateGeom = false;
      }
    }

    if (!handledByNativeUpdateGeom) {
      el.style.transform = canvasTransform.toString();
    }
  });
}

// ============================================================================
// 9. RESIZE OBSERVER & UI INTERACTION WIRING
// ============================================================================

function updateViewportSizing() {
  const cssW = Math.max(1, stageViewport.clientWidth || window.innerWidth);
  const cssH = Math.max(1, stageViewport.clientHeight || window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  renderer.setPixelRatio(dpr);
  renderer.setSize(cssW, cssH, false);

  camera.aspect = cssW / cssH;
  const narrowScale = camera.aspect < 1.25 ? 1.25 / Math.max(0.62, camera.aspect) : 1.0;
  camera.position.z = 13.5 * Math.min(1.6, narrowScale);
  camera.updateProjectionMatrix();

  stageHtmlTextures.forEach((tex) => {
    if (tex) tex.needsUpdate = true;
  });
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
}

const resizeObserver = new ResizeObserver(() => {
  updateViewportSizing();
});
resizeObserver.observe(stageViewport);
updateViewportSizing();

function scrollToStageIndex(stageIdx) {
  const clamped = Math.max(0, Math.min(MAX_STAGE_INDEX, stageIdx));
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({
    top: (clamped / MAX_STAGE_INDEX) * maxScroll,
    behavior: prefersReducedMotion ? 'auto' : 'smooth'
  });
}

railDots.forEach((btn) => {
  btn.addEventListener('click', () => {
    scrollToStageIndex(Number(btn.dataset.stageTarget || 0));
  });
});

const launchButtons = Array.from(document.querySelectorAll('[data-launch-app]'));
launchButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const parentStage = btn.closest('.hic-glass-stage');
    const stageIdx = Number(parentStage?.dataset.stage || 0);
    btn.classList.toggle('is-preview-clicked');
    const labelSpan = btn.querySelector('.btn-launch-label');
    if (labelSpan) {
      const isClicked = btn.classList.contains('is-preview-clicked');
      if (!btn.dataset.defaultLabel) {
        btn.dataset.defaultLabel = labelSpan.textContent || 'Launch Teaching App';
      }
      labelSpan.textContent = isClicked ? 'App Preview Ready' : btn.dataset.defaultLabel;
    }
    const statusNote = parentStage?.querySelector('[data-launch-status]');
    if (statusNote) {
      statusNote.textContent = btn.classList.contains('is-preview-clicked')
        ? 'Marketing preview · Teaching app launch placeholder'
        : 'Interactive Euclidean studio · Free preview';
    }
    requestStagePaint(stageIdx);
  });
});

let pointerNormX = 0;
let pointerNormY = 0;
window.addEventListener('pointermove', (e) => {
  pointerNormX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
  pointerNormY = -((e.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
}, { passive: true });

// ============================================================================
// 10. MAIN ANIMATION LOOP
// ============================================================================

let currentDisplayedStage = -1;
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(0.05, clock.getDelta());
  const elapsed = clock.elapsedTime;

  const damp = prefersReducedMotion ? 0.35 : 1.0 - Math.exp(-dt * 9.5);
  smoothStageFloat += (targetStageFloat - smoothStageFloat) * damp;
  if (Math.abs(targetStageFloat - smoothStageFloat) < 0.0004) {
    smoothStageFloat = targetStageFloat;
  }

  const { activeStage, shatter, offscreenFade } = evaluateTransitionCurve(smoothStageFloat);

  if (scrollProgressBar && !CSS.supports('animation-timeline', 'scroll()')) {
    scrollProgressBar.style.transform = `scaleX(${(smoothStageFloat / MAX_STAGE_INDEX).toFixed(4)})`;
  }

  if (activeStage !== currentDisplayedStage) {
    currentDisplayedStage = activeStage;

    stageGroups.forEach((grp, idx) => {
      grp.visible = idx === activeStage;
    });

    railDots.forEach((dot, idx) => {
      const isAct = idx === activeStage;
      dot.classList.toggle('is-active', isAct);
      if (isAct) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });

    if (glassBloom) {
      glassBloom.style.background = STAGE_CONFIG[activeStage].bloom;
    }
    if (scrollHintLabel) {
      scrollHintLabel.textContent = activeStage === MAX_STAGE_INDEX
        ? 'IV · Sanctuary Portal'
        : 'Scroll to shatter & transition glass shards';
    }
    requestStagePaint(activeStage);
  }

  if (glassBloom) {
    glassBloom.style.opacity = String((0.68 * (1 - shatter * 0.88)).toFixed(3));
  }

  // Subtle camera parallax when window is assembled at rest
  const parallax = prefersReducedMotion ? 0 : (1 - shatter) * 0.08;
  camera.position.x = pointerNormX * parallax;
  camera.position.y = pointerNormY * parallax * 0.65;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  // Update shared stained-glass shard uniforms
  shardUniforms.uGlassArtTex.value = stageGlassArtTextures[activeStage];
  shardUniforms.uHtmlTex.value = stageHtmlTextures[activeStage];
  shardUniforms.uTime.value = elapsed;
  shardUniforms.uPointer.value.set(pointerNormX, pointerNormY);
  shardUniforms.uShatter.value = shatter;
  shardUniforms.uOpacity.value = offscreenFade;
  stoneTraceryMaterial.opacity = offscreenFade;

  const aspectBoost = Math.max(1.0, camera.aspect / 1.5);
  const activePieces = stagePieceLists[activeStage];

  for (let i = 0; i < activePieces.length; i++) {
    const p = activePieces[i];
    if (shatter <= 0.0001) {
      p.mesh.position.set(p.rx, p.ry, p.rz);
      p.mesh.rotation.set(0, 0, 0);
    } else {
      const localS = Math.min(1, Math.max(0, (shatter - p.stagger * 0.35) / (1 - p.stagger * 0.35)));
      const dist = localS * p.explodeDist * aspectBoost;
      const swirl = localS * 0.42;
      const ang = p.explodeAngle + swirl;

      p.mesh.position.set(
        p.rx + Math.cos(ang) * dist,
        p.ry + Math.sin(ang) * dist,
        p.rz + localS * p.explodeZ
      );
      p.mesh.rotation.set(
        localS * p.spinX,
        localS * p.spinY,
        localS * p.spinZ
      );
    }
  }

  syncDrawableDOMGeometry(activeStage, shatter);
  renderer.render(scene, camera);
}

targetStageFloat = readScrollStageFloat();
smoothStageFloat = targetStageFloat;
animate();
