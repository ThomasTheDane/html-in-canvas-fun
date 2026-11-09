import * as THREE from './vendor/three.module.min.js';
import { SHARDS_ATLAS } from './assets/shards-data.js';

/**
 * Stained Glass Odyssey
 * ---------------------
 * - Extrudes 1,490 real lead-came-segmented SVG glass shards across 3 stained glass windows
 *   into 3D beveled cathedral glass meshes in Three.js.
 * - Renders live interactive HTML-in-Canvas (`drawable`) editorial Lorem Ipsum, form fields,
 *   and buttons directly onto the stained glass shards via `gl.texElementSubImage2D()`.
 * - Explodes shards outward toward the left & right sides of the screen on scroll while
 *   combining the next window's shards & UI elements together.
 */

const canvas = document.getElementById('stained-glass-canvas');
const stageViewport = document.getElementById('stage-viewport');
const hudWindowTitle = document.getElementById('hud-window-title');
const hicModePill = document.getElementById('hic-mode-pill');
const svgInspectLink = document.getElementById('svg-inspect-link');
const footerPhaseLabel = document.getElementById('footer-phase-label');
const footerShardReadout = document.getElementById('footer-shard-readout');
const scrollTrackFill = document.getElementById('scroll-track-fill');

const windowNavBtns = Array.from(document.querySelectorAll('.window-nav-btn'));
const allDrawablePanels = Array.from(document.querySelectorAll('.hic-glass-panel'));

// ============================================================================
// 1. WINDOW METADATA & WORLD GEOMETRY CONSTANTS
// ============================================================================

const IMAGE_W = 1840;
const IMAGE_H = 1040;
const WORLD_W = 18.4;
const WORLD_H = 10.4;
const HALF_THICK = 0.055; // 3D extruded glass slab half-thickness

// World-space rectangles for Left & Right HTML-in-Canvas UI Panels (centered vertically & brought inward toward center)
const LEFT_UI_RECT = {
  xMin: -5.68,
  xMax: -1.04,
  yMin: -3.06,
  yMax: 3.06
};

const RIGHT_UI_RECT = {
  xMin: 1.04,
  xMax: 5.68,
  yMin: -3.06,
  yMax: 3.06
};

const WINDOWS_META = [
  {
    index: 0,
    key: 'giraffe',
    hudTitle: 'I. Aurelia Giraffa — Savanna Arch',
    textureUrl: './assets/window-giraffe.jpg',
    svgUrl: './assets/giraffe-shards.svg',
    shardCount: SHARDS_ATLAS.giraffe.shardCount,
    sunColor: new THREE.Color(0xffdfa0),
    rimColor: new THREE.Color(0xf59e0b),
    ambientTint: new THREE.Color(0x28385e)
  },
  {
    index: 1,
    key: 'robin',
    hudTitle: 'II. Erithacus Brumalis — Solstice Robin',
    textureUrl: './assets/window-robin.jpg',
    svgUrl: './assets/robin-shards.svg',
    shardCount: SHARDS_ATLAS.robin.shardCount,
    sunColor: new THREE.Color(0xdcf4ff),
    rimColor: new THREE.Color(0x38bdf8),
    ambientTint: new THREE.Color(0x1c3a56)
  },
  {
    index: 2,
    key: 'tree',
    hudTitle: 'III. Arbor Vitae — Tiffany Tree of Life',
    textureUrl: './assets/window-tree.jpg',
    svgUrl: './assets/tree-shards.svg',
    shardCount: SHARDS_ATLAS.tree.shardCount,
    sunColor: new THREE.Color(0xfff0b8),
    rimColor: new THREE.Color(0x34d399),
    ambientTint: new THREE.Color(0x234236)
  }
];

// ============================================================================
// 2. THREE.JS RENDERER, SCENE, CAMERA & HTML-IN-CANVAS FEATURE DETECTION
// ============================================================================

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const gl = renderer.getContext();

const supportsNativeHIC =
  ('content' in HTMLCanvasElement.prototype ||
    'layoutSubtree' in HTMLCanvasElement.prototype ||
    typeof canvas.updateElementGeometry === 'function') &&
  typeof gl?.texElementSubImage2D === 'function';

if (!supportsNativeHIC) {
  // Move drawable panels into an invisible hit-test & accessibility overlay (`opacity: 0.001`)
  // so 100% of visual rendering stays inside the shattering 3D stained-glass WebGL shards!
  const fallbackLayer = document.createElement('div');
  fallbackLayer.id = 'hic-fallback-layer';
  fallbackLayer.className = 'hic-fallback-layer';
  stageViewport.insertBefore(fallbackLayer, canvas.nextSibling);
  allDrawablePanels.forEach((panel) => {
    fallbackLayer.appendChild(panel);
  });
  if (hicModePill) {
    hicModePill.textContent = '3D Glass Texture Sync Active';
  }
} else if (hicModePill) {
  hicModePill.textContent = 'Native HTML-in-Canvas Active';
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 120);

function updateCameraFraming() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const aspect = w / h;
  camera.aspect = aspect;

  // At z = 14.54 with fov = 38 deg, visible height at z = 0 is 10.00 world units,
  // and visible width at 16:10 (1.6) is 16.00 world units (matching our 18.4 x 10.4 mosaic!).
  // If viewport is narrower than 1.56, pull camera back slightly so both UI panels fit cleanly.
  const baseZ = 14.54;
  const minAspect = 1.56;
  camera.position.set(0, 0, aspect < minAspect ? baseZ * (minAspect / aspect) : baseZ);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
updateCameraFraming();

// Subtle atmospheric sanctuary dust motes behind & in front of the stained glass
function createCathedralDust() {
  const count = 220;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 24;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
    pos[i * 3 + 2] = (Math.random() - 0.3) * 8;
    seed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0xffdfa0) }
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.y += mod(uTime * 0.18 + aSeed, 14.0) - 7.0;
        p.x += sin(uTime * 0.45 + aSeed * 1.7) * 0.35;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(24.0 / max(1.0, -mv.z), 1.5, 5.0);
        vAlpha = 0.22 + 0.22 * sin(uTime * 1.6 + aSeed * 3.1);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        if (r > 0.5) discard;
        float glow = smoothstep(0.5, 0.05, r);
        gl_FragColor = vec4(uTint, glow * vAlpha);
      }
    `
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return mat;
}
const dustMaterial = createCathedralDust();

// ============================================================================
// 3. BUILD 3D EXTRUDED BEVELED GLASS SHARD GEOMETRY FROM SVG ATLAS
// ============================================================================

function seededHash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/**
 * Converts pixel coordinates `(px, py)` in `[0..1840, 0..1040]` to 3D world rest coords & UVs.
 */
function pxToWorldX(px) {
  return (px / IMAGE_W - 0.5) * WORLD_W;
}
function pxToWorldY(py) {
  return (0.5 - py / IMAGE_H) * WORLD_H;
}

function buildExtrudedWindowGeometry(atlasEntry, windowIdx) {
  const shards = atlasEntry.shards;

  const positions = [];
  const normals = [];
  const uvs = [];
  const centers = [];
  const seeds = [];
  const partTypes = []; // 0.0 = front/back glass face, 1.0 = 3D beveled perimeter & lead-came rim

  const pushVertex = (x, y, z, nx, ny, nz, u, v, cx, cy, s0, s1, s2, s3, part) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    centers.push(cx, cy);
    seeds.push(s0, s1, s2, s3);
    partTypes.push(part);
  };

  for (let sIdx = 0; sIdx < shards.length; sIdx++) {
    const sh = shards[sIdx];
    if (!sh.p || sh.p.length < 3) continue;

    // Convert outer contour to 2D THREE.Vector2 in world coordinates (y-up)
    const rawOuter = sh.p.map((pt) => new THREE.Vector2(pxToWorldX(pt[0]), pxToWorldY(pt[1])));
    // Ensure counter-clockwise winding for +Z front face
    if (THREE.ShapeUtils.isClockWise(rawOuter)) {
      rawOuter.reverse();
    }

    const holesVec2 = [];
    if (sh.h && sh.h.length > 0) {
      for (const hPts of sh.h) {
        if (hPts.length < 3) continue;
        const hv = hPts.map((pt) => new THREE.Vector2(pxToWorldX(pt[0]), pxToWorldY(pt[1])));
        if (!THREE.ShapeUtils.isClockWise(hv)) {
          hv.reverse();
        }
        holesVec2.push(hv);
      }
    }

    const tris = THREE.ShapeUtils.triangulateShape(rawOuter, holesVec2);
    if (!tris || tris.length === 0) continue;

    const allPts = [...rawOuter];
    for (const hv of holesVec2) {
      allPts.push(...hv);
    }

    const cx = pxToWorldX(sh.c[0]);
    const cy = pxToWorldY(sh.c[1]);

    // Deterministic per-shard physics attributes
    const baseSeed = windowIdx * 4099 + sIdx * 17 + 5;
    const randPhase = seededHash(baseSeed);
    const speedMul = 0.55 + seededHash(baseSeed + 1) * 0.95;
    const rotAngle = seededHash(baseSeed + 2) * Math.PI * 2;
    // Slight organic zig-zag around x = 0; shards fly across to the OPPOSITE side of where they start!
    // Left-starting shards (cx < splitBias) travel to the RIGHT (+1.0), and right-starting shards travel to the LEFT (-1.0).
    const splitBias = Math.sin(cy * 1.45 + randPhase * 2.2) * 0.42;
    const outDirX = cx < splitBias ? 1.0 : -1.0;

    // 1. Front & Back Glass Faces
    for (let t = 0; t < tris.length; t++) {
      const [i0, i1, i2] = tris[t];
      const p0 = allPts[i0];
      const p1 = allPts[i1];
      const p2 = allPts[i2];

      const u0 = p0.x / WORLD_W + 0.5;
      const v0 = p0.y / WORLD_H + 0.5;
      const u1 = p1.x / WORLD_W + 0.5;
      const v1 = p1.y / WORLD_H + 0.5;
      const u2 = p2.x / WORLD_W + 0.5;
      const v2 = p2.y / WORLD_H + 0.5;

      // Front face (+Z, CCW)
      pushVertex(p0.x, p0.y, HALF_THICK, 0, 0, 1, u0, v0, cx, cy, randPhase, speedMul, rotAngle, outDirX, 0.0);
      pushVertex(p1.x, p1.y, HALF_THICK, 0, 0, 1, u1, v1, cx, cy, randPhase, speedMul, rotAngle, outDirX, 0.0);
      pushVertex(p2.x, p2.y, HALF_THICK, 0, 0, 1, u2, v2, cx, cy, randPhase, speedMul, rotAngle, outDirX, 0.0);

      // Back face (-Z, reversed winding so tumbling shards glow from both sides!)
      pushVertex(p0.x, p0.y, -HALF_THICK, 0, 0, -1, u0, v0, cx, cy, randPhase, speedMul, rotAngle, outDirX, 0.0);
      pushVertex(p2.x, p2.y, -HALF_THICK, 0, 0, -1, u2, v2, cx, cy, randPhase, speedMul, rotAngle, outDirX, 0.0);
      pushVertex(p1.x, p1.y, -HALF_THICK, 0, 0, -1, u1, v1, cx, cy, randPhase, speedMul, rotAngle, outDirX, 0.0);
    }

    // 2. Extruded 3D Beveled Perimeter Side Wall + Thin Front Bevel Lip (for SVG Wireframe & Edge Glints!)
    const rings = [rawOuter, ...holesVec2];
    for (const ring of rings) {
      const rLen = ring.length;
      for (let i = 0; i < rLen; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % rLen];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1e-5;
        // Outward normal for CCW ring in y-up is (dy, -dx) / len
        const nx = (dy / len) * 0.88;
        const ny = (-dx / len) * 0.88;
        const nz = 0.47;

        const ua = a.x / WORLD_W + 0.5;
        const va = a.y / WORLD_H + 0.5;
        const ub = b.x / WORLD_W + 0.5;
        const vb = b.y / WORLD_H + 0.5;

        // Side wall quad (a_top, a_bot, b_bot) + (a_top, b_bot, b_top)
        pushVertex(a.x, a.y, HALF_THICK, nx, ny, nz, ua, va, cx, cy, randPhase, speedMul, rotAngle, outDirX, 1.0);
        pushVertex(a.x, a.y, -HALF_THICK, nx, ny, -nz, ua, va, cx, cy, randPhase, speedMul, rotAngle, outDirX, 1.0);
        pushVertex(b.x, b.y, -HALF_THICK, nx, ny, -nz, ub, vb, cx, cy, randPhase, speedMul, rotAngle, outDirX, 1.0);

        pushVertex(a.x, a.y, HALF_THICK, nx, ny, nz, ua, va, cx, cy, randPhase, speedMul, rotAngle, outDirX, 1.0);
        pushVertex(b.x, b.y, -HALF_THICK, nx, ny, -nz, ub, vb, cx, cy, randPhase, speedMul, rotAngle, outDirX, 1.0);
        pushVertex(b.x, b.y, HALF_THICK, nx, ny, nz, ub, vb, cx, cy, randPhase, speedMul, rotAngle, outDirX, 1.0);

        // Thin front-surface bevel highlight ribbon (`z = HALF_THICK + 0.0015`) so SVG seam inspection
        // and specular bevel glints outline every polygon cleanly even at uExplosion = 0!
        const inset = 0.024;
        const aiX = a.x - (dy / len) * inset;
        const aiY = a.y + (dx / len) * inset;
        const biX = b.x - (dy / len) * inset;
        const biY = b.y + (dx / len) * inset;
        const zLip = HALF_THICK + 0.0012;

        pushVertex(a.x, a.y, zLip, nx * 0.5, ny * 0.5, 0.86, ua, va, cx, cy, randPhase, speedMul, rotAngle, outDirX, 2.0);
        pushVertex(b.x, b.y, zLip, nx * 0.5, ny * 0.5, 0.86, ub, vb, cx, cy, randPhase, speedMul, rotAngle, outDirX, 2.0);
        pushVertex(biX, biY, zLip, 0, 0, 1, ub, vb, cx, cy, randPhase, speedMul, rotAngle, outDirX, 2.0);

        pushVertex(a.x, a.y, zLip, nx * 0.5, ny * 0.5, 0.86, ua, va, cx, cy, randPhase, speedMul, rotAngle, outDirX, 2.0);
        pushVertex(biX, biY, zLip, 0, 0, 1, ub, vb, cx, cy, randPhase, speedMul, rotAngle, outDirX, 2.0);
        pushVertex(aiX, aiY, zLip, 0, 0, 1, ua, va, cx, cy, randPhase, speedMul, rotAngle, outDirX, 2.0);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aShardCenter', new THREE.Float32BufferAttribute(centers, 2));
  geometry.setAttribute('aShardSeed', new THREE.Float32BufferAttribute(seeds, 4));
  geometry.setAttribute('aPartType', new THREE.Float32BufferAttribute(partTypes, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 38);
  return geometry;
}

// ============================================================================
// 4. STAINED GLASS + LIVE HTML-IN-CANVAS SHADER MATERIAL
// ============================================================================

const SHARD_VERTEX_SHADER = /* glsl */ `
  attribute vec2 aShardCenter;
  attribute vec4 aShardSeed;
  attribute float aPartType;

  uniform float uExplosion;
  uniform float uTime;
  uniform float uRippleTime;
  uniform vec2 uRippleOrigin;
  uniform vec2 uPointerWorld;
  uniform vec2 uPointerTrail;
  uniform float uPointerActive;

  varying vec2 vUv;
  varying vec2 vRestWorldXY;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vPartType;
  varying float vLocalExplode;
  varying float vShardHash;
  varying float vMouseSink;

  vec3 rotateAxisAngle(vec3 v, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }

  void main() {
    float randPhase = aShardSeed.x;
    float speedMul = aShardSeed.y;
    float rotAng = aShardSeed.z;
    float outDirX = aShardSeed.w;

    vUv = uv;
    vRestWorldXY = position.xy;
    vPartType = aPartType;
    vShardHash = randPhase;

    vec3 localPos = position;
    vec3 localNorm = normal;

    // 1. Concentric 3D Glass Ripple Wave when user clicks "Ripple Glass" or submits a form
    if (uRippleTime > 0.001 && uRippleTime < 3.5) {
      float distToOrigin = length(aShardCenter - uRippleOrigin);
      float waveFront = uRippleTime * 11.5;
      float band = exp(-pow((distToOrigin - waveFront) * 0.72, 2.0));
      float env = exp(-uRippleTime * 1.15);
      float osc = sin((distToOrigin - waveFront) * 2.6);
      float zPulse = osc * band * env * 0.44;
      localPos.z += zPulse;

      vec2 radialDir = normalize(aShardCenter - uRippleOrigin + vec2(0.0001));
      float tiltAngle = cos((distToOrigin - waveFront) * 2.6) * band * env * 0.28;
      vec3 rippleAxis = normalize(vec3(-radialDir.y, radialDir.x, 0.0));
      vec3 relR = localPos - vec3(aShardCenter, 0.0);
      localPos = vec3(aShardCenter, 0.0) + rotateAxisAngle(relR, rippleAxis, tiltAngle);
      localNorm = rotateAxisAngle(localNorm, rippleAxis, tiltAngle);
    }

    // 2. Scroll-Driven Outward Shard Explosion to the OPPOSITE side of where each shard starts!
    float radialNorm = clamp(abs(aShardCenter.x) / 9.2, 0.0, 1.0);
    // Stagger slightly so shards peel organically without ever moving when uExplosion == 0
    float stagger = (1.0 - radialNorm) * 0.11 + randPhase * 0.15;
    float localE = uExplosion <= 0.0001
      ? 0.0
      : clamp((uExplosion - stagger * 0.65) / (1.0 - 0.26 * 0.65), 0.0, 1.0);
    vLocalExplode = localE;

    // 3. Per-Shard Mouse Weight Sinking & Turning Away from the Screen
    // As the user moves the mouse across the shards of glass, each specific shard under/near the cursor
    // sinks into -Z (away from the screen) and turns/tilts away as if weighted down by the cursor!
    vec2 toCursorFast = uPointerWorld - aShardCenter;
    vec2 toCursorTrail = uPointerTrail - aShardCenter;
    float distFast = length(toCursorFast);
    float distTrail = length(toCursorTrail);

    float fastWeight = exp(-distFast * distFast * 1.55);
    float trailWeight = exp(-distTrail * distTrail * 0.95) * 0.42;
    float shardPress = clamp(max(fastWeight, trailWeight * 1.35), 0.0, 1.0) * uPointerActive * (1.0 - smoothstep(0.0, 0.35, localE));
    vMouseSink = shardPress;

    if (shardPress > 0.001) {
      // Combine lever-arm torque toward the cursor point with a natural backward-sinking pitch away from screen
      vec2 pressDir = toCursorFast / (distFast + 0.28);
      vec3 sinkAxis = normalize(vec3(
        -pressDir.y + 0.72 + (randPhase - 0.5) * 0.35,
        pressDir.x + (sin(rotAng) * 0.38),
        (randPhase - 0.5) * 0.18
      ));
      float sinkAngle = shardPress * (0.42 + 0.18 * speedMul);

      vec3 relPress = localPos - vec3(aShardCenter, 0.0);
      relPress = rotateAxisAngle(relPress, sinkAxis, sinkAngle);
      localNorm = rotateAxisAngle(localNorm, sinkAxis, sinkAngle);

      // Sink away from the screen (-Z) and slightly downward (-Y) under the cursor's weight
      float sinkZ = -shardPress * (0.58 + 0.22 * randPhase);
      float sinkY = -shardPress * (0.09 + 0.04 * speedMul);
      localPos = vec3(aShardCenter, 0.0) + relPress + vec3(0.0, sinkY, sinkZ);
    }

    if (localE > 0.0) {
      // Crack-lift phase in first 8%, followed by sweeping crossover explosion toward the OPPOSITE screen edge
      float crackLift = smoothstep(0.0, 0.08, localE);
      float blastCurve = pow(localE, 1.42);
      float crossArc = sin(localE * 3.14159265);

      vec3 rel = localPos - vec3(aShardCenter, 0.0);

      // Shrink shards smoothly as they lift off and travel across / come in so they stay compact
      // and never loom large or close to the screen. Also tame oversized outer border shards.
      float flightEase = smoothstep(0.03, 0.38, localE);
      float restRadius = length(rel.xy);
      float borderTame = 1.0 / (1.0 + max(0.0, restRadius - 0.52) * 0.85 * flightEase);
      float flightScale = mix(1.0, 0.42, flightEase) * (1.0 - 0.16 * crossArc) * borderTame;
      rel.xy *= flightScale;

      // Subtle per-vertex shape & 3D curvature morphing as shards travel to the opposite side
      float morphEnv = crossArc * 0.55 + smoothstep(0.15, 1.0, localE) * 0.35;
      float vAng = atan(rel.y, rel.x);
      float lobeMorph =
        0.14 * sin(vAng * 3.0 + localE * 9.0 + randPhase * 6.28318) +
        0.10 * cos(vAng * 2.0 - localE * 6.5 + rotAng);
      rel.xy *= 1.0 + morphEnv * lobeMorph;

      // Gentle aerodynamic shear along flight trajectory without inflating shard width
      float shearFactor = morphEnv * 0.18 * sin(localE * 5.2 + randPhase * 6.28318);
      rel.x += rel.y * shearFactor;

      // Subtle 3D crystalline cupping/twisting warp & bevel thickness in flight
      float cupZ = clamp((rel.x * rel.x - rel.y * rel.y * 0.65) * 0.38, -0.06, 0.06) * sin(localE * 6.4 + randPhase * 6.28318);
      float twistZ = clamp(rel.x * rel.y * 0.45, -0.06, 0.06) * cos(localE * 5.6 + rotAng);
      rel.z *= mix(1.0, 0.85, flightEase);
      rel.z += morphEnv * (cupZ + twistZ);

      // Perturb normal slightly to reflect the 3D surface morphing
      localNorm = normalize(localNorm + vec3(-cupZ * 0.35, -twistZ * 0.35, 0.0) * morphEnv);

      // Compound 3D multi-axis turning & tumbling as pieces cross to the opposite side
      vec3 spinAxis1 = normalize(vec3(
        sin(rotAng) * 0.72,
        outDirX * 0.88,
        cos(rotAng) * 0.58
      ));
      float spinTheta1 = blastCurve * (5.4 + speedMul * 6.8);

      vec3 spinAxis2 = normalize(vec3(
        cos(rotAng * 1.7),
        sin(rotAng * 1.3) * 0.75,
        outDirX * 0.65
      ));
      float spinTheta2 = crossArc * (2.6 + randPhase * 2.8);

      rel = rotateAxisAngle(rel, spinAxis1, spinTheta1);
      rel = rotateAxisAngle(rel, spinAxis2, spinTheta2);
      localNorm = rotateAxisAngle(localNorm, spinAxis1, spinTheta1);
      localNorm = rotateAxisAngle(localNorm, spinAxis2, spinTheta2);

      // Travel across the window to the OPPOSITE side of where each shard starts!
      // Left-starting shards (outDirX = +1) sweep across to the right side, and right-starting shards (outDirX = -1) sweep across to the left side.
      float targetOppositeX = outDirX * (10.4 + abs(aShardCenter.x) * 0.34 + speedMul * 3.8);
      float crossDeltaX = (targetOppositeX - aShardCenter.x) * blastCurve;

      float fanY =
        (aShardCenter.y * 0.38 + (randPhase - 0.5) * 3.2) * blastCurve +
        outDirX * crossArc * (0.65 + randPhase * 0.55);

      // Keep shards further back in Z (slightly receding away from the camera rather than surging toward the screen)
      float depthZ =
        crackLift * (0.12 + randPhase * 0.14) * (1.0 - blastCurve) +
        crossArc * (-1.05 - speedMul * 0.95 + outDirX * 0.32) +
        (randPhase - 0.58) * 1.35 * blastCurve;

      localPos = vec3(aShardCenter, 0.0) + rel + vec3(crossDeltaX, fanY, depthZ);
    }

    vec4 worldPosition = modelMatrix * vec4(localPos, 1.0);
    vWorldPos = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * localNorm);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const SHARD_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uGlassTex;
  uniform sampler2D uHtmlLeftTex;
  uniform sampler2D uHtmlRightTex;

  uniform vec4 uLeftRect;   // (xMin, xMax, yMin, yMax)
  uniform vec4 uRightRect;  // (xMin, xMax, yMin, yMax)

  uniform vec3 uSunColor;
  uniform vec3 uRimColor;
  uniform vec3 uSunDir;
  uniform vec2 uPointerWorld;
  uniform float uRefractionStrength;
  uniform float uWireframeMix;
  uniform float uTime;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec2 vRestWorldXY;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vPartType;
  varying float vLocalExplode;
  varying float vShardHash;
  varying float vMouseSink;

  // Gentle cathedral glass ripple normal perturbation
  vec2 glassRippleOffset(vec2 p, float hash) {
    float n1 = sin(p.x * 9.5 + hash * 18.0) * cos(p.y * 9.5 - hash * 12.0);
    float n2 = sin(p.x * 21.0 - p.y * 17.0 + hash * 31.0);
    return vec2(n1 + 0.4 * n2, n2 - 0.4 * n1) * 0.0022 * uRefractionStrength;
  }

  void main() {
    // Fade only at far outer edge of explosion so shards fly completely offscreen smoothly
    float shardAlpha = uOpacity * (1.0 - smoothstep(0.86, 1.0, vLocalExplode));
    if (shardAlpha <= 0.005) discard;

    vec3 N = normalize(vWorldNormal);
    if (!gl_FrontFacing) {
      N = -N;
    }
    vec3 V = normalize(cameraPosition - vWorldPos);

    // Sample stained glass texture with subtle cathedral ripple refraction (enhanced when weighted down by mouse)
    vec2 sinkRefract = N.xy * (vMouseSink * 0.0085);
    vec2 rippleUv = clamp(vUv + glassRippleOffset(vRestWorldXY, vShardHash) + sinkRefract, vec2(0.001), vec2(0.999));
    vec3 glassTexel = texture2D(uGlassTex, rippleUv).rgb;

    // Detect dark lead-came lines in the stained glass artwork
    float lum = dot(glassTexel, vec3(0.299, 0.587, 0.114));
    float isLeadCame = 1.0 - smoothstep(0.05, 0.16, lum);

    // Backlit cathedral sunlight transmission + mouse-following warm lantern spotlight
    float mouseDist = length(vWorldPos.xy - uPointerWorld);
    float lanternGlow = exp(-mouseDist * mouseDist * 0.055);
    float centerSun = exp(-dot(vWorldPos.xy * vec2(0.09, 0.11), vWorldPos.xy * vec2(0.09, 0.11)));

    // Subtle recessed shadow as shard sinks away from screen, paired with bright bevel rim catchlight
    float sinkShade = 1.0 - vMouseSink * 0.16;
    vec3 transmittedGlass = glassTexel * (0.94 + 0.34 * centerSun + 0.28 * lanternGlow) * sinkShade * mix(vec3(1.0), uSunColor, 0.28);
    // Keep dark soldered lead lines rich charcoal-iron with subtle metallic sheen
    vec3 baseColor = mix(transmittedGlass, glassTexel * 0.65 + vec3(0.03, 0.035, 0.05), isLeadCame * 0.72);

    // 3D Extruded Side Wall (vPartType == 1.0): dark soldered lead edge + glowing colored glass core!
    if (vPartType > 0.5 && vPartType < 1.5) {
      float edgeFresnel = pow(1.0 - abs(dot(N, V)), 1.6);
      vec3 edgeColor = mix(vec3(0.05, 0.06, 0.09), glassTexel * 1.35 + uRimColor * (0.45 + 0.45 * vMouseSink), 0.42 + 0.48 * edgeFresnel);
      baseColor = edgeColor;
    }

    // Composite Live HTML-in-Canvas UI Textures directly onto the front glass faces of the shards!
    if (vPartType < 0.5 || vPartType > 1.5) {
      // Check Left UI Panel bounds
      if (
        vRestWorldXY.x >= uLeftRect.x &&
        vRestWorldXY.x <= uLeftRect.y &&
        vRestWorldXY.y >= uLeftRect.z &&
        vRestWorldXY.y <= uLeftRect.w
      ) {
        vec2 uiUv = vec2(
          (vRestWorldXY.x - uLeftRect.x) / (uLeftRect.y - uLeftRect.x),
          (uLeftRect.w - vRestWorldXY.y) / (uLeftRect.w - uLeftRect.z)
        );
        // Frosted stained-glass diffusion behind the semi-transparent HTML card
        vec3 frostedGlass =
          0.25 * texture2D(uGlassTex, clamp(rippleUv + vec2(0.004, 0.004), 0.001, 0.999)).rgb +
          0.25 * texture2D(uGlassTex, clamp(rippleUv + vec2(-0.004, 0.004), 0.001, 0.999)).rgb +
          0.25 * texture2D(uGlassTex, clamp(rippleUv + vec2(0.004, -0.004), 0.001, 0.999)).rgb +
          0.25 * texture2D(uGlassTex, clamp(rippleUv + vec2(-0.004, -0.004), 0.001, 0.999)).rgb;

        vec4 htmlTexel = texture2D(uHtmlLeftTex, uiUv);
        vec3 underGlass = mix(baseColor, frostedGlass * 1.18, smoothstep(0.05, 0.65, htmlTexel.a));
        baseColor = mix(underGlass, htmlTexel.rgb, htmlTexel.a);
      }

      // Check Right UI Panel bounds
      if (
        vRestWorldXY.x >= uRightRect.x &&
        vRestWorldXY.x <= uRightRect.y &&
        vRestWorldXY.y >= uRightRect.z &&
        vRestWorldXY.y <= uRightRect.w
      ) {
        vec2 uiUv = vec2(
          (vRestWorldXY.x - uRightRect.x) / (uRightRect.y - uRightRect.x),
          (uRightRect.w - vRestWorldXY.y) / (uRightRect.w - uRightRect.z)
        );
        vec3 frostedGlass =
          0.25 * texture2D(uGlassTex, clamp(rippleUv + vec2(0.004, 0.004), 0.001, 0.999)).rgb +
          0.25 * texture2D(uGlassTex, clamp(rippleUv + vec2(-0.004, 0.004), 0.001, 0.999)).rgb +
          0.25 * texture2D(uGlassTex, clamp(rippleUv + vec2(0.004, -0.004), 0.001, 0.999)).rgb +
          0.25 * texture2D(uGlassTex, clamp(rippleUv + vec2(-0.004, -0.004), 0.001, 0.999)).rgb;

        vec4 htmlTexel = texture2D(uHtmlRightTex, uiUv);
        vec3 underGlass = mix(baseColor, frostedGlass * 1.18, smoothstep(0.05, 0.65, htmlTexel.a));
        baseColor = mix(underGlass, htmlTexel.rgb, htmlTexel.a);
      }
    }

    // Specular cathedral light glints on glass surface & tumbling/sinking 3D shard bevels
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 38.0);
    float bevelBoost = vPartType > 0.5
      ? (0.38 + 0.95 * smoothstep(0.0, 0.22, vLocalExplode) + 0.68 * vMouseSink)
      : (0.16 + 0.34 * vMouseSink);
    baseColor += uSunColor * spec * bevelBoost;

    // Optional SVG Shard Polygon Wireframe Overlay ("◈ SVG Seams" button!)
    if (vPartType > 1.5 && uWireframeMix > 0.01) {
      float pulse = 0.78 + 0.22 * sin(uTime * 3.6 + vShardHash * 12.0);
      baseColor = mix(baseColor, uRimColor * 1.35 * pulse + vec3(0.22), uWireframeMix * 0.88);
    }

    gl_FragColor = vec4(baseColor, shardAlpha);
  }
`;

// ============================================================================
// 5. HTML-IN-CANVAS TEXTURE MANAGEMENT & FALLBACK RASTERIZER
// ============================================================================

function getElementImageSize(targetCanvas, element) {
  if (typeof targetCanvas.getElementImageDefaultSize === 'function') {
    try {
      const size = targetCanvas.getElementImageDefaultSize(element);
      if (size && size.width > 0 && size.height > 0) {
        return {
          width: Math.ceil(size.width),
          height: Math.ceil(size.height)
        };
      }
    } catch (_err) {
      // Fall through
    }
  }
  if (typeof targetCanvas.captureElementImage === 'function') {
    let img = null;
    try {
      img = targetCanvas.captureElementImage(element);
      const w = Math.ceil(img.width);
      const h = Math.ceil(img.height);
      if (typeof img.close === 'function') img.close();
      if (w > 0 && h > 0) return { width: w, height: h };
    } catch (_err) {
      if (typeof targetCanvas.requestPaint === 'function') {
        targetCanvas.requestPaint();
      }
      return null;
    }
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.ceil((element.offsetWidth || 440) * dpr);
  const h = Math.ceil((element.offsetHeight || 580) * dpr);
  return w > 0 && h > 0 ? { width: w, height: h } : null;
}

function uploadElementToNativeGLTexture(panelSlot) {
  const size = getElementImageSize(canvas, panelSlot.element);
  if (!size) return false;
  const { width, height } = size;

  // Bind on dedicated texture unit 7 via Three.js state manager so we never clobber active units
  renderer.state.activeTexture(gl.TEXTURE0 + 7);
  renderer.state.bindTexture(gl.TEXTURE_2D, panelSlot.nativeGLTex);

  if (panelSlot.texWidth !== width || panelSlot.texHeight !== height) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    panelSlot.texWidth = width;
    panelSlot.texHeight = height;
  }

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, panelSlot.element, { width, height });

  const texProps = renderer.properties.get(panelSlot.threeTex);
  texProps.__webglTexture = panelSlot.nativeGLTex;
  texProps.__webglInit = true;

  renderer.state.bindTexture(gl.TEXTURE_2D, null);
  return true;
}

/**
 * Pure Canvas2D fallback renderer used ONLY if the browser does not have CanvasDrawElement enabled.
 */
function renderFallbackPanelTexture(panelSlot, accentHex) {
  const el = panelSlot.element;
  const dpr = 2;
  const cw = 440;
  const ch = 580;

  if (!panelSlot.fallbackCanvas) {
    panelSlot.fallbackCanvas = document.createElement('canvas');
    panelSlot.fallbackCanvas.width = cw * dpr;
    panelSlot.fallbackCanvas.height = ch * dpr;
    panelSlot.fallbackTex = new THREE.CanvasTexture(panelSlot.fallbackCanvas);
    panelSlot.fallbackTex.flipY = false;
    panelSlot.fallbackTex.colorSpace = THREE.SRGBColorSpace;
  }

  const ctx = panelSlot.fallbackCanvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cw, ch);

  // Translucent leaded-glass card background
  ctx.fillStyle = 'rgba(11, 15, 28, 0.78)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(1, 1, cw - 2, ch - 2, 16);
  ctx.fill();
  ctx.stroke();

  const wrapText = (text, x, y, maxW, lineH, align = 'center') => {
    const words = (text || '').trim().split(/\s+/);
    let line = '';
    let curY = y;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = align;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, curY);
        line = w;
        curY += lineH;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, curY);
      curY += lineH;
    }
    ctx.textAlign = prevAlign;
    return curY;
  };

  const badgeText = el.querySelector('.shard-badge')?.textContent || '';
  ctx.fillStyle = accentHex;
  ctx.font = '700 11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(badgeText, cw / 2, 38);

  if (panelSlot.side === 'left') {
    const title = el.querySelector('.panel-display-title')?.textContent || '';
    const sub = el.querySelector('.panel-subtitle')?.textContent || '';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 31px Georgia, serif';
    ctx.fillText(title, cw / 2, 84);

    ctx.fillStyle = accentHex;
    ctx.font = '600 14px -apple-system, sans-serif';
    let y = wrapText(sub, cw / 2, 112, 392, 19, 'center');

    ctx.fillStyle = '#eef2fa';
    ctx.font = '400 14px -apple-system, sans-serif';
    y += 12;
    el.querySelectorAll('.lorem-prose p').forEach((p) => {
      y = wrapText(p.textContent, cw / 2, y, 392, 22, 'center') + 10;
    });

    const btns = Array.from(el.querySelectorAll('.btn-glass-action'));
    btns.forEach((btn, idx) => {
      const bx = 24 + idx * 133;
      const by = 516;
      ctx.fillStyle = btn.classList.contains('is-toggled') ? accentHex : 'rgba(20, 28, 48, 0.9)';
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, 125, 38, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = btn.classList.contains('is-toggled') ? '#090d16' : '#f8f5ee';
      ctx.font = '600 12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(btn.textContent.trim(), bx + 62.5, by + 23);
    });
  } else {
    const title = el.querySelector('.panel-form-title')?.textContent || '';
    const note = el.querySelector('.form-lorem-note')?.textContent || '';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 22px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, cw / 2, 76);

    ctx.fillStyle = '#cbd3e3';
    ctx.font = '400 12.5px -apple-system, sans-serif';
    let y = wrapText(note, cw / 2, 98, 392, 17, 'center') + 8;

    const controls = Array.from(el.querySelectorAll('input:not([type="radio"]), select, textarea'));
    controls.forEach((ctrl) => {
      const id = ctrl.id;
      const lbl = id ? el.querySelector(`label[for="${id}"]`)?.textContent : '';
      if (lbl) {
        ctx.fillStyle = '#f1f5f9';
        ctx.font = '600 12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(lbl, cw / 2, y + 12);
        y += 18;
      }
      const boxH = ctrl.tagName === 'TEXTAREA' ? 44 : 34;
      ctx.fillStyle = 'rgba(7, 10, 19, 0.86)';
      ctx.strokeStyle = document.activeElement === ctrl ? accentHex : 'rgba(226,232,240,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(24, y, 392, boxH, 8);
      ctx.fill();
      ctx.stroke();

      let valText = '';
      if (ctrl.tagName === 'SELECT') {
        valText = ctrl.options[ctrl.selectedIndex]?.text || '';
      } else {
        valText = ctrl.value || ctrl.getAttribute('placeholder') || '';
      }
      ctx.fillStyle = ctrl.value || ctrl.tagName === 'SELECT' ? '#ffffff' : 'rgba(203,211,227,0.5)';
      ctx.font = '400 13px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(valText.slice(0, 48), cw / 2, y + 21);
      y += boxH + 12;
    });

    // Primary & secondary buttons
    ctx.fillStyle = accentHex;
    ctx.beginPath();
    ctx.roundRect(24, 476, 232, 38, 9);
    ctx.fill();
    ctx.fillStyle = '#070a12';
    ctx.font = '700 13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const pBtn = el.querySelector('.btn-glass-primary')?.textContent || 'Submit';
    ctx.fillText(pBtn, 24 + 116, 500);

    ctx.fillStyle = 'rgba(18, 25, 42, 0.88)';
    ctx.strokeStyle = 'rgba(226,232,240,0.34)';
    ctx.beginPath();
    ctx.roundRect(266, 476, 150, 38, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f8f5ee';
    const sBtn = el.querySelector('.btn-glass-secondary')?.textContent || 'Reset';
    ctx.fillText(sBtn, 266 + 75, 500);

    const status = el.querySelector('.form-status-banner')?.textContent || '';
    ctx.fillStyle = '#dbeafe';
    ctx.font = '400 11.5px -apple-system, sans-serif';
    wrapText(status, cw / 2, 536, 392, 16, 'center');
  }

  ctx.restore();
  panelSlot.fallbackTex.needsUpdate = true;
  panelSlot.materialUniform.value = panelSlot.fallbackTex;
}

// ============================================================================
// 6. INSTANTIATE ALL 3 STAINED GLASS WINDOWS IN THREE.JS
// ============================================================================

const textureLoader = new THREE.TextureLoader();

// 1x1 transparent placeholder until HTML texture uploads on first paint
function createPlaceholderTexture() {
  const data = new Uint8Array([0, 0, 0, 0]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const ACCENT_HEX = ['#f6ad3c', '#38bdf8', '#34d399'];

const windowRecords = WINDOWS_META.map((meta, idx) => {
  const glassTex = textureLoader.load(meta.textureUrl, () => {
    requestCanvasRepaint();
  });
  glassTex.colorSpace = THREE.SRGBColorSpace;
  glassTex.minFilter = THREE.LinearMipmapLinearFilter;
  glassTex.magFilter = THREE.LinearFilter;
  glassTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const leftEl = document.getElementById(`hic-left-${idx}`);
  const rightEl = document.getElementById(`hic-right-${idx}`);

  const leftThreeTex = new THREE.Texture();
  const rightThreeTex = new THREE.Texture();

  const shaderMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: {
      uGlassTex: { value: glassTex },
      uHtmlLeftTex: { value: supportsNativeHIC ? leftThreeTex : createPlaceholderTexture() },
      uHtmlRightTex: { value: supportsNativeHIC ? rightThreeTex : createPlaceholderTexture() },
      uLeftRect: {
        value: new THREE.Vector4(
          LEFT_UI_RECT.xMin,
          LEFT_UI_RECT.xMax,
          LEFT_UI_RECT.yMin,
          LEFT_UI_RECT.yMax
        )
      },
      uRightRect: {
        value: new THREE.Vector4(
          RIGHT_UI_RECT.xMin,
          RIGHT_UI_RECT.xMax,
          RIGHT_UI_RECT.yMin,
          RIGHT_UI_RECT.yMax
        )
      },
      uExplosion: { value: idx === 0 ? 0.0 : 1.0 },
      uOpacity: { value: idx === 0 ? 1.0 : 0.0 },
      uTime: { value: 0.0 },
      uRippleTime: { value: 99.0 },
      uRippleOrigin: { value: new THREE.Vector2(0, 0) },
      uSunColor: { value: meta.sunColor.clone() },
      uRimColor: { value: meta.rimColor.clone() },
      uSunDir: { value: new THREE.Vector3(0.28, 0.42, 0.86).normalize() },
      uPointerWorld: { value: new THREE.Vector2(0, 0) },
      uPointerTrail: { value: new THREE.Vector2(0, 0) },
      uPointerActive: { value: 0.0 },
      uRefractionStrength: { value: 1.0 },
      uWireframeMix: { value: 0.0 }
    },
    vertexShader: SHARD_VERTEX_SHADER,
    fragmentShader: SHARD_FRAGMENT_SHADER
  });

  const geometry = buildExtrudedWindowGeometry(SHARDS_ATLAS[meta.key], idx);
  const mesh = new THREE.Mesh(geometry, shaderMaterial);
  mesh.frustumCulled = false;
  mesh.visible = idx === 0;
  scene.add(mesh);

  const leftSlot = {
    side: 'left',
    element: leftEl,
    nativeGLTex: supportsNativeHIC ? gl.createTexture() : null,
    threeTex: leftThreeTex,
    materialUniform: shaderMaterial.uniforms.uHtmlLeftTex,
    texWidth: 0,
    texHeight: 0,
    dirty: true
  };

  const rightSlot = {
    side: 'right',
    element: rightEl,
    nativeGLTex: supportsNativeHIC ? gl.createTexture() : null,
    threeTex: rightThreeTex,
    materialUniform: shaderMaterial.uniforms.uHtmlRightTex,
    texWidth: 0,
    texHeight: 0,
    dirty: true
  };

  return {
    meta,
    index: idx,
    mesh,
    shaderMaterial,
    leftSlot,
    rightSlot,
    rippleStartMs: -1e6,
    wireframeActive: false,
    targetWireframe: 0.0,
    sunPresetIndex: 0
  };
});

// ============================================================================
// 7. HTML-IN-CANVAS HIT-TESTING GEOMETRY SYNC (DPR=1 & DPR=2 SAFE!)
// ============================================================================

const _tlVec = new THREE.Vector3();
const _trVec = new THREE.Vector3();
const _blVec = new THREE.Vector3();

function projectWorldToCanvasCSS(worldVec, cw, ch) {
  worldVec.project(camera);
  return {
    x: (worldVec.x + 1.0) * 0.5 * cw,
    y: (1.0 - worldVec.y) * 0.5 * ch
  };
}

/**
 * Builds a normalized 2D affine `DOMMatrix` (`is2D === true, m33 = 1, m44 = 1`)
 * in CSS pixels mapping `(0, 0) -> (offsetWidth, offsetHeight)` onto `[tlScreen, trScreen, blScreen]`.
 */
function computeAffineCanvasTransform(element, tlScreen, trScreen, blScreen) {
  const width = Math.max(1, element.offsetWidth || 440);
  const height = Math.max(1, element.offsetHeight || 580);

  const m = new DOMMatrix();
  m.a = (trScreen.x - tlScreen.x) / width;
  m.b = (trScreen.y - tlScreen.y) / width;
  m.c = (blScreen.x - tlScreen.x) / height;
  m.d = (blScreen.y - tlScreen.y) / height;
  m.e = tlScreen.x;
  m.f = tlScreen.y;
  return m;
}

function parkElementOffscreen(element) {
  if (!element) return;
  if (supportsNativeHIC && typeof canvas.clearElementGeometry === 'function') {
    try {
      canvas.clearElementGeometry(element);
    } catch (_err) {
      // Ignore if not registered
    }
    element.style.transform = '';
  } else {
    element.style.transform = 'translate3d(-9999px, -9999px, 0)';
  }
  element.style.pointerEvents = 'none';
  element.setAttribute('inert', '');
}

function syncPanelHitGeometry(mesh, element, worldRect, isInteractive) {
  if (!element) return;
  if (!isInteractive) {
    parkElementOffscreen(element);
    return;
  }

  element.removeAttribute('inert');
  element.style.pointerEvents = 'auto';

  mesh.updateWorldMatrix(true, false);
  const cw = Math.max(1, canvas.clientWidth || window.innerWidth);
  const ch = Math.max(1, canvas.clientHeight || window.innerHeight);

  _tlVec.set(worldRect.xMin, worldRect.yMax, HALF_THICK).applyMatrix4(mesh.matrixWorld);
  _trVec.set(worldRect.xMax, worldRect.yMax, HALF_THICK).applyMatrix4(mesh.matrixWorld);
  _blVec.set(worldRect.xMin, worldRect.yMin, HALF_THICK).applyMatrix4(mesh.matrixWorld);

  const sTL = projectWorldToCanvasCSS(_tlVec, cw, ch);
  const sTR = projectWorldToCanvasCSS(_trVec, cw, ch);
  const sBL = projectWorldToCanvasCSS(_blVec, cw, ch);

  const canvasTransform = computeAffineCanvasTransform(element, sTL, sTR, sBL);

  // In native HTML-in-Canvas (Chrome 157+), `canvas.updateElementGeometry` positions the
  // interactive DOM hit-test & accessibility box while `element.style.transform` must stay
  // empty so `texElementSubImage2D` rasterizes the full unclipped drawable border-box.
  if (supportsNativeHIC && typeof canvas.updateElementGeometry === 'function') {
    element.style.transform = '';
    try {
      canvas.updateElementGeometry(element, { canvasTransform });
    } catch (_err) {
      // Ignore
    }
  } else {
    element.style.transform = canvasTransform.toString();
  }
}

// ============================================================================
// 8. INTERACTIVE UI CONTROLS, FORMS, SCROLL & POINTER HANDLERS
// ============================================================================

let forceAllPanelUploads = true;

function requestCanvasRepaint(winIdx = -1) {
  if (winIdx >= 0 && windowRecords[winIdx]) {
    windowRecords[winIdx].leftSlot.dirty = true;
    windowRecords[winIdx].rightSlot.dirty = true;
  } else {
    forceAllPanelUploads = true;
  }
  if (typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
}

function triggerShardRipple(winIdx, originX = 0, originY = 0) {
  const rec = windowRecords[winIdx];
  if (!rec) return;
  rec.rippleStartMs = performance.now();
  rec.shaderMaterial.uniforms.uRippleOrigin.value.set(originX, originY);
}

const SUN_PRESETS = [
  { dir: [0.28, 0.42, 0.86], mult: [1.0, 1.0, 1.0] },
  { dir: [-0.52, 0.35, 0.78], mult: [1.14, 0.92, 0.76] },
  { dir: [0.0, -0.32, 0.94], mult: [0.84, 1.04, 1.18] }
];

// Wire up editorial action buttons ("✦ Ripple Glass", "◈ SVG Seams", "☀ Shift Sun")
document.querySelectorAll('.btn-glass-action').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    const winIdx = Number(btn.dataset.window || 0);
    const rec = windowRecords[winIdx];

    if (btn.dataset.jumpWindow !== undefined) {
      scrollToWindowIndex(Number(btn.dataset.jumpWindow));
      return;
    }
    if (!rec) return;

    if (action === 'ripple') {
      triggerShardRipple(winIdx, -2.4, 0.2);
    } else if (action === 'wireframe') {
      rec.wireframeActive = !rec.wireframeActive;
      rec.targetWireframe = rec.wireframeActive ? 1.0 : 0.0;
      btn.classList.toggle('is-toggled', rec.wireframeActive);
      requestCanvasRepaint(winIdx);
    } else if (action === 'sunlight') {
      rec.sunPresetIndex = (rec.sunPresetIndex + 1) % SUN_PRESETS.length;
      const preset = SUN_PRESETS[rec.sunPresetIndex];
      rec.shaderMaterial.uniforms.uSunDir.value.set(...preset.dir).normalize();
      rec.shaderMaterial.uniforms.uSunColor.value
        .copy(rec.meta.sunColor)
        .multiply(new THREE.Color(...preset.mult));
      triggerShardRipple(winIdx, 0, 1.2);
      requestCanvasRepaint(winIdx);
    }
  });
});

// Jump-to-window buttons (HUD nav & in-panel buttons)
function scrollToWindowIndex(index) {
  const clamped = Math.max(0, Math.min(2, index));
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const targetY = (clamped / 2) * maxScroll;
  window.scrollTo({ top: targetY, behavior: 'smooth' });
}

windowNavBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    scrollToWindowIndex(Number(btn.dataset.windowIndex || 0));
  });
});

document.querySelectorAll('[data-jump-window]').forEach((btn) => {
  if (!btn.classList.contains('btn-glass-action')) {
    btn.addEventListener('click', () => {
      scrollToWindowIndex(Number(btn.dataset.jumpWindow || 0));
    });
  }
});

// Live shader reactions when form selects or radio pills change
const glassStockSelect0 = document.getElementById('glass-stock-0');
if (glassStockSelect0) {
  glassStockSelect0.addEventListener('change', () => {
    const rec = windowRecords[0];
    const tints = {
      amber: 0xffdfa0,
      gold: 0xffe97d,
      ruby: 0xffb3a7,
      cobalt: 0xaad8ff
    };
    rec.shaderMaterial.uniforms.uSunColor.value.setHex(tints[glassStockSelect0.value] || 0xffdfa0);
    triggerShardRipple(0, 2.5, 0.4);
    requestCanvasRepaint(0);
  });
}

document.querySelectorAll('input[name="atmosphere"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    const rec = windowRecords[1];
    const presets = {
      frost: 0xdcf4ff,
      zenith: 0xa5f3fc,
      hearth: 0xffd29d
    };
    rec.shaderMaterial.uniforms.uSunColor.value.setHex(presets[radio.value] || 0xdcf4ff);
    triggerShardRipple(1, 2.2, 0.8);
    requestCanvasRepaint(1);
  });
});

const refractionSelect1 = document.getElementById('refraction-select-1');
if (refractionSelect1) {
  refractionSelect1.addEventListener('change', () => {
    const rec = windowRecords[1];
    const strengths = { crisp: 1.0, soft: 0.45, deep: 2.1 };
    rec.shaderMaterial.uniforms.uRefractionStrength.value =
      strengths[refractionSelect1.value] || 1.0;
    requestCanvasRepaint(1);
  });
}

// Repaint HTML-in-Canvas textures on any input/focus/reset/submit interaction
allDrawablePanels.forEach((panel) => {
  const winIdx = Number(panel.dataset.window || 0);
  ['input', 'change', 'focusin', 'focusout'].forEach((evtName) => {
    panel.addEventListener(evtName, () => {
      requestCanvasRepaint(winIdx);
    });
  });
});

// IME-safe Enter handling & accessible form submission with safe textContent updates
document.querySelectorAll('.stained-form').forEach((form) => {
  const winIdx = Number(form.dataset.window || 0);
  const statusBanner = document.getElementById(`form-status-${winIdx}`);

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      // Respect IME text composition per modern-web-guidance `forms`
      if (e.isComposing) return;
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      // Trigger :user-invalid visual state by focusing first invalid field
      const firstInvalid = form.querySelector(':invalid');
      if (firstInvalid && typeof firstInvalid.focus === 'function') {
        firstInvalid.focus();
      }
      if (statusBanner) {
        statusBanner.classList.remove('is-success');
        statusBanner.classList.add('is-warn');
        statusBanner.textContent = 'Please complete the highlighted glass ledger fields above.';
      }
      requestCanvasRepaint(winIdx);
      return;
    }

    const formData = new FormData(form);
    const rawName = String(
      formData.get('patron_name') ||
        formData.get('observer_name') ||
        formData.get('guild_name') ||
        'Patron'
    )
      .trim()
      .slice(0, 42);

    if (statusBanner) {
      statusBanner.classList.remove('is-warn');
      statusBanner.classList.add('is-success');
      statusBanner.textContent = `✓ Inscribed for ${rawName} — scroll to watch this live record shatter with the glass!`;
    }

    triggerShardRipple(winIdx, 2.8, -0.4);
    requestCanvasRepaint(winIdx);
  });

  form.addEventListener('reset', () => {
    setTimeout(() => {
      if (statusBanner) {
        statusBanner.classList.remove('is-success', 'is-warn');
        statusBanner.textContent = 'Form cleared — ready for new stained glass entry.';
      }
      requestCanvasRepaint(winIdx);
    }, 0);
  });
});

document.addEventListener('selectionchange', () => {
  requestCanvasRepaint();
});

// Track pointer in 3D world z=0 plane for per-shard mouse-weighted sinking/tilting & lantern backlight
const pointerWorld = new THREE.Vector2(0, 0);
const pointerTrail = new THREE.Vector2(0, 0);
const targetPointerWorld = new THREE.Vector2(0, 0);
let targetPointerActive = 0.0;
let smoothPointerActive = 0.0;

window.addEventListener(
  'pointermove',
  (e) => {
    const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    const ny = 1 - (e.clientY / Math.max(1, window.innerHeight)) * 2;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.position.z;
    const halfW = halfH * camera.aspect;
    targetPointerWorld.set(nx * halfW, ny * halfH);
    if (targetPointerActive < 0.01) {
      pointerWorld.copy(targetPointerWorld);
      pointerTrail.copy(targetPointerWorld);
    }
    targetPointerActive = 1.0;
  },
  { passive: true }
);

window.addEventListener(
  'pointerleave',
  () => {
    targetPointerActive = 0.0;
  },
  { passive: true }
);

// Track native page scroll [0.0 .. 2.0]
let targetScrollProgress = 0.0;
let smoothScrollProgress = 0.0;

function updateTargetScrollFromWindow() {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const ratio = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1);
  targetScrollProgress = ratio * 2.0;
}

window.addEventListener('scroll', updateTargetScrollFromWindow, { passive: true });
window.addEventListener('resize', () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateCameraFraming();
  updateTargetScrollFromWindow();
  requestCanvasRepaint();
});
updateTargetScrollFromWindow();

// ============================================================================
// 9. SCROLL CHOREOGRAPHY & RENDER / PAINT LOOP
// ============================================================================

/**
 * Evaluates per-window `(explosion, opacity, visible, isSettled)` from `scrollProg in [0..2]`.
 * - Resting windows (`explosion == 0`) have a gentle dwell plateau so typing/clicking is rock-solid.
 * - Between Window A and Window B, Window A's shards explode across to the opposite sides (`0 -> 1`)
 *   while Window B's shards fly inward from the opposite sides (`1 -> 0`) and lock together!
 */
function evaluateWindowTransitionStates(scrollProg) {
  const states = [
    { explosion: 1.0, opacity: 0.0, visible: false, isSettled: false },
    { explosion: 1.0, opacity: 0.0, visible: false, isSettled: false },
    { explosion: 1.0, opacity: 0.0, visible: false, isSettled: false }
  ];

  const clamped = THREE.MathUtils.clamp(scrollProg, 0.0, 2.0);
  const seg = Math.min(1, Math.floor(clamped)); // 0 (Window 0->1) or 1 (Window 1->2)
  const rawFrac = clamped - seg; // [0.0 .. 1.0]

  // Comfortable dwell plateau [0..0.06] and [0.94..1.0]
  const t = THREE.MathUtils.smoothstep(rawFrac, 0.06, 0.94);

  const outExplode = THREE.MathUtils.smoothstep(t, 0.0, 0.90);
  const inExplode = 1.0 - THREE.MathUtils.smoothstep(t, 0.10, 1.0);

  if (outExplode < 0.999) {
    states[seg].explosion = outExplode;
    states[seg].opacity = 1.0;
    states[seg].visible = true;
    states[seg].isSettled = outExplode < 0.015;
  }

  if (inExplode < 0.999) {
    states[seg + 1].explosion = inExplode;
    states[seg + 1].opacity = 1.0;
    states[seg + 1].visible = true;
    states[seg + 1].isSettled = inExplode < 0.015;
  }

  return states;
}

let lastHudIndex = -1;

function updateSceneAndSyncDOM(nowMs, changedElementsSet = null) {
  const timeSec = nowMs * 0.001;

  // Smooth scroll & pointer interpolation
  smoothScrollProgress += (targetScrollProgress - smoothScrollProgress) * 0.12;
  if (Math.abs(targetScrollProgress - smoothScrollProgress) < 0.0008) {
    smoothScrollProgress = targetScrollProgress;
  }

  pointerWorld.lerp(targetPointerWorld, 0.28);
  pointerTrail.lerp(targetPointerWorld, 0.075);
  smoothPointerActive += (targetPointerActive - smoothPointerActive) * 0.18;

  const states = evaluateWindowTransitionStates(smoothScrollProgress);
  const nearestIdx = Math.round(smoothScrollProgress);
  const activeMeta = WINDOWS_META[nearestIdx] || WINDOWS_META[0];

  // Update Top & Bottom Sanctuary HUD
  if (nearestIdx !== lastHudIndex) {
    lastHudIndex = nearestIdx;
    if (hudWindowTitle) hudWindowTitle.textContent = activeMeta.hudTitle;
    if (svgInspectLink) {
      svgInspectLink.href = activeMeta.svgUrl;
      svgInspectLink.textContent = `View Extracted SVG (${activeMeta.shardCount} Shards) ↗`;
    }
    windowNavBtns.forEach((btn, idx) => {
      const active = idx === nearestIdx;
      btn.classList.toggle('is-active', active);
      if (active) {
        btn.setAttribute('aria-current', 'step');
      } else {
        btn.removeAttribute('aria-current');
      }
    });
  }

  if (scrollTrackFill) {
    scrollTrackFill.style.width = `${(smoothScrollProgress / 2) * 100}%`;
  }

  const activeState = states[nearestIdx];
  const scatterPct = Math.round((activeState ? activeState.explosion : 0) * 100);
  if (footerShardReadout) {
    footerShardReadout.textContent =
      scatterPct === 0
        ? `Assembled • ${activeMeta.shardCount} Shards Locked`
        : `Transitioning • ${scatterPct}% Crossover Scatter`;
  }
  if (footerPhaseLabel) {
    footerPhaseLabel.textContent =
      scatterPct === 0
        ? `Move mouse over shards to weight them down, interact with the UI, or scroll to morph & scatter all ${activeMeta.shardCount} shards`
        : 'Stained glass & HTML-in-Canvas UI shards turning & morphing across to opposite sides as next window combines';
  }

  dustMaterial.uniforms.uTime.value = timeSec;
  dustMaterial.uniforms.uTint.value.lerp(activeMeta.sunColor, 0.06);

  // Update each stained-glass window mesh, upload HTML-in-Canvas textures, & sync DOM hit layers
  let settledRecord = null;

  if (forceAllPanelUploads) {
    windowRecords.forEach((rec) => {
      rec.leftSlot.dirty = true;
      rec.rightSlot.dirty = true;
    });
    forceAllPanelUploads = false;
  }

  windowRecords.forEach((rec, idx) => {
    const st = states[idx];
    rec.mesh.visible = st.visible;

    for (const slot of [rec.leftSlot, rec.rightSlot]) {
      if (changedElementsSet && changedElementsSet.has(slot.element)) {
        slot.dirty = true;
      }
      // Pre-upload initial textures even before scrolling so incoming shards already have their UI texture
      if (!st.visible && slot.texWidth === 0 && slot.dirty) {
        if (supportsNativeHIC) {
          try {
            if (uploadElementToNativeGLTexture(slot)) {
              slot.dirty = false;
            }
          } catch (_err) {
            // Will retry when visible
          }
        } else {
          renderFallbackPanelTexture(slot, ACCENT_HEX[idx]);
          slot.dirty = false;
        }
      }
    }

    if (!st.visible) {
      parkElementOffscreen(rec.leftSlot.element);
      parkElementOffscreen(rec.rightSlot.element);
      return;
    }

    // Smooth wireframe toggle interpolation
    const curWf = rec.shaderMaterial.uniforms.uWireframeMix.value;
    rec.shaderMaterial.uniforms.uWireframeMix.value += (rec.targetWireframe - curWf) * 0.14;

    rec.shaderMaterial.uniforms.uExplosion.value = st.explosion;
    rec.shaderMaterial.uniforms.uOpacity.value = st.opacity;
    rec.shaderMaterial.uniforms.uTime.value = timeSec;
    rec.shaderMaterial.uniforms.uRippleTime.value = Math.max(0, (nowMs - rec.rippleStartMs) * 0.001);
    rec.shaderMaterial.uniforms.uPointerWorld.value.copy(pointerWorld);
    rec.shaderMaterial.uniforms.uPointerTrail.value.copy(pointerTrail);
    rec.shaderMaterial.uniforms.uPointerActive.value = smoothPointerActive;

    // Upload Left & Right HTML-in-Canvas UI textures when dirty or changed
    for (const slot of [rec.leftSlot, rec.rightSlot]) {
      const needsUpload = slot.dirty || slot.texWidth === 0;

      if (needsUpload) {
        if (supportsNativeHIC) {
          try {
            if (uploadElementToNativeGLTexture(slot)) {
              slot.dirty = false;
            }
          } catch (_err) {
            // Will retry on next paint cycle
          }
        } else {
          renderFallbackPanelTexture(slot, ACCENT_HEX[idx]);
          slot.dirty = false;
        }
      }
    }

    if (st.isSettled) {
      settledRecord = rec;
    } else {
      parkElementOffscreen(rec.leftSlot.element);
      parkElementOffscreen(rec.rightSlot.element);
    }
  });

  // Sync the active settled window's DOM hit-testing geometry LAST so it sits cleanly on top
  if (settledRecord) {
    syncPanelHitGeometry(settledRecord.mesh, settledRecord.leftSlot.element, LEFT_UI_RECT, true);
    syncPanelHitGeometry(settledRecord.mesh, settledRecord.rightSlot.element, RIGHT_UI_RECT, true);
  }

  renderer.render(scene, camera);
}

let paintedThisFrame = false;

canvas.onpaint = (event) => {
  paintedThisFrame = true;
  const changedSet =
    event && Array.isArray(event.changedElements) ? new Set(event.changedElements) : null;
  updateSceneAndSyncDOM(performance.now(), changedSet);
};

function tick(nowMs) {
  paintedThisFrame = false;
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    try {
      canvas.requestPaint();
    } catch (_err) {
      // Fallback to direct render
    }
  }
  if (!paintedThisFrame) {
    updateSceneAndSyncDOM(nowMs, null);
  }
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
