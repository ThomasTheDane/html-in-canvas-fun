import * as THREE from './vendor/three.module.min.js';

/**
 * The Rainforest of Information — Photorealistic 3D Twisting DNA Liana Vines &
 * Sculpted 3D Unfurling Rainforest Leaves with HTML-in-Canvas Texture Mapping
 */

const canvas = document.getElementById('rainforest-canvas');
const stageViewport = document.getElementById('stage-viewport');
const hudStageTitle = document.getElementById('hud-stage-title');
const hudDepthReadout = document.getElementById('hud-depth-readout');
const scrollGuideText = document.getElementById('scroll-guide-text');
const pillLeftVine = document.getElementById('pill-left-vine');
const pillRightVine = document.getElementById('pill-right-vine');
const hicPipelineBadge = document.getElementById('hic-pipeline-badge');

const leafCards = Array.from(document.querySelectorAll('.hic-leaf-card'));
const vineNodeButtons = Array.from(document.querySelectorAll('.vine-node-btn'));

// ============================================================================
// 1. HTML-IN-CANVAS FEATURE DETECTION & INVISIBLE HIT-TEST OVERLAY SETUP
// ============================================================================

const supportsNativeHIC =
  ('content' in HTMLCanvasElement.prototype ||
    'layoutSubtree' in HTMLCanvasElement.prototype ||
    typeof canvas.updateElementGeometry === 'function') &&
  (typeof canvas.getElementImageDefaultSize === 'function' ||
    typeof canvas.captureElementImage === 'function' ||
    typeof (canvas.getContext('webgl2') || canvas.getContext('webgl'))?.texElementSubImage2D ===
      'function');

if (!supportsNativeHIC) {
  // Place the DOM elements in an invisible hit-test & accessibility overlay
  // (`opacity: 0.001` in CSS) so NO flat CSS card ever covers the 3D scene;
  // all visual rendering happens 100% on the 3D sculpted leaf model in WebGL!
  const fallbackLayer = document.createElement('div');
  fallbackLayer.id = 'hic-fallback-layer';
  fallbackLayer.className = 'hic-fallback-layer';
  stageViewport.insertBefore(fallbackLayer, canvas.nextSibling);
  leafCards.forEach((card) => {
    fallbackLayer.appendChild(card);
  });
  if (hicPipelineBadge) {
    hicPipelineBadge.textContent = '3D Sculpted Leaf Model + Live HTML-in-Canvas Texture Active';
  }
} else if (hicPipelineBadge) {
  hicPipelineBadge.textContent =
    'Native HTML-in-Canvas (texElementSubImage2D + updateElementGeometry) Active';
}

// HTML-in-Canvas Spec Helpers (`apply-webgl-shaders` & `interactive-content-in-3d-scenes`)
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
      // Fall through to captureElementImage or CSS box fallback
    }
  }

  if (typeof targetCanvas.captureElementImage === 'function') {
    let elementImage;
    try {
      elementImage = targetCanvas.captureElementImage(element);
    } catch (_err) {
      if (typeof targetCanvas.requestPaint === 'function') {
        targetCanvas.requestPaint();
      }
      return null;
    }
    const width = Math.ceil(elementImage.width);
    const height = Math.ceil(elementImage.height);
    if (typeof elementImage.close === 'function') {
      elementImage.close();
    }
    return width > 0 && height > 0 ? { width, height } : null;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.ceil((element.offsetWidth || 650) * dpr);
  const h = Math.ceil((element.offsetHeight || 400) * dpr);
  return w > 0 && h > 0 ? { width: w, height: h } : null;
}

function allocateElementTexture(glContext, texture, state, width, height) {
  glContext.bindTexture(glContext.TEXTURE_2D, texture);
  if (state.width === width && state.height === height) return;

  glContext.texImage2D(
    glContext.TEXTURE_2D,
    0,
    glContext.RGBA8,
    width,
    height,
    0,
    glContext.RGBA,
    glContext.UNSIGNED_BYTE,
    null
  );
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MIN_FILTER, glContext.LINEAR);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MAG_FILTER, glContext.LINEAR);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_S, glContext.CLAMP_TO_EDGE);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_T, glContext.CLAMP_TO_EDGE);
  state.width = width;
  state.height = height;
}

function uploadElementWebGL(glContext, targetCanvas, texture, element, state) {
  const size = getElementImageSize(targetCanvas, element);
  if (!size) return false;
  const { width, height } = size;

  allocateElementTexture(glContext, texture, state, width, height);
  glContext.pixelStorei(glContext.UNPACK_FLIP_Y_WEBGL, false);
  glContext.texElementSubImage2D(glContext.TEXTURE_2D, 0, 0, 0, element, { width, height });
  return true;
}

/**
 * Constructs a clean 2D affine `DOMMatrix` (`is2D === true`, `m44 === 1`, `m33 === 1`)
 * that maps the drawable element's border-box `(0, 0) -> (offsetWidth, offsetHeight)`
 * directly onto its perspective-projected 3D leaf quad on the canvas in CSS pixels.
 */
function computeCanvasTransform(element, tlScreen, trScreen, blScreen) {
  const width = Math.max(1, element.offsetWidth || 650);
  const height = Math.max(1, element.offsetHeight || 400);

  const canvasTransform = new DOMMatrix();
  canvasTransform.a = (trScreen.x - tlScreen.x) / width;
  canvasTransform.b = (trScreen.y - tlScreen.y) / width;
  canvasTransform.c = (blScreen.x - tlScreen.x) / height;
  canvasTransform.d = (blScreen.y - tlScreen.y) / height;
  canvasTransform.e = tlScreen.x;
  canvasTransform.f = tlScreen.y;
  return canvasTransform;
}

// ============================================================================
// 2. STAGE METADATA & SCROLL COORDINATES
// ============================================================================

const TOTAL_STEPS = 7; // Steps 0..7
const STEP_SPACING_Y = 9.0;

const STAGE_METADATA = [
  {
    step: 0,
    side: 0,
    elevation: '65m (Emergent Crown)',
    title: 'Crown Canopy: Golden Poison Frog',
    guide: 'Scroll down the twin DNA liana vines to unfurl each leaf & highlight any animal fact'
  },
  {
    step: 1,
    side: -1,
    elevation: '54m (Upper Canopy)',
    title: 'Leaf #1 (Left Vine): Three-Toed Sloth',
    guide: 'Unfurling 3D Leaf from Left DNA Vine • Drag across the leaf to highlight the sloth fact'
  },
  {
    step: 2,
    side: 1,
    elevation: '44m (Middle Canopy)',
    title: 'Leaf #2 (Right Vine): Emerald Glass Frog',
    guide: 'Unfurling 3D Leaf from Right DNA Vine • Drag across the leaf to highlight the glass frog fact'
  },
  {
    step: 3,
    side: -1,
    elevation: '34m (Lower Canopy)',
    title: 'Leaf #3 (Left Vine): Puppeteer Decoy Spider',
    guide: 'Unfurling 3D Leaf from Left DNA Vine • Drag across the leaf to highlight the decoy spider fact'
  },
  {
    step: 4,
    side: 1,
    elevation: '24m (Understory Clearing)',
    title: 'Leaf #4 (Right Vine): Write Your Name on the Leaf',
    guide: 'Type your name on the leaf and press Submit to watch light draw it stroke-for-stroke!'
  },
  {
    step: 5,
    side: -1,
    elevation: '15m (Shaded Understory)',
    title: 'Leaf #5 (Left Vine): Rainforest Survival Multiple-Choice Exam',
    guide: 'Click answer choices A, B, C, or D directly on the 3D leaf surface!'
  },
  {
    step: 6,
    side: 1,
    elevation: '8m (Threatened Forest Edge)',
    title: 'Leaf #6 (Right Vine): The Burning Rainforest & Charred Remains',
    guide: 'Click "🔥 Ignite This Leaf" on the 3D leaf — scroll away & return to see the charred ash!'
  },
  {
    step: 7,
    side: 0,
    elevation: '0m (Root & Heart Convergence)',
    title: 'Finale: Twin Vines Intertwine — “PROTECT THE RAINFOREST”',
    guide: 'The Left & Right DNA Vines braid together in the center and form living 3D vine text!'
  }
];

// ============================================================================
// 3. THREE.JS SCENE, RENDERER, PMREM HDR ENVIRONMENT & REALISTIC LIGHTING
// ============================================================================

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false
});
renderer.setSize(
  Math.round(window.innerWidth * window.devicePixelRatio),
  Math.round(window.innerHeight * window.devicePixelRatio),
  false
);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const gl = renderer.getContext();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020905);
scene.fog = new THREE.FogExp2(0x031109, 0.036);

const camera = new THREE.PerspectiveCamera(
  43,
  window.innerWidth / Math.max(1, window.innerHeight),
  0.1,
  120
);
camera.position.set(0, 0, 10.8);

/**
 * Generates a physically-based PMREM Image-Based Lighting (IBL) Environment Map
 * simulating dappled golden canopy sunlight overhead, humid emerald mid-canopy bounce,
 * and deep dark forest floor shadows so PBR bark, moss, and leaves never look plastic!
 */
function buildRainforestPMREMEnvironment() {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x061a0e);

  // Dappled Golden Sun Openings in the Upper Canopy
  const sunSphereMat = new THREE.MeshBasicMaterial({ color: 0xfff0b8 });
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2;
    const radius = 6 + (i % 3) * 4;
    const sMesh = new THREE.Mesh(new THREE.SphereGeometry(1.4 + (i % 2) * 0.8, 12, 12), sunSphereMat);
    sMesh.position.set(Math.cos(angle) * radius, 14 + (i % 4) * 2, Math.sin(angle) * radius);
    envScene.add(sMesh);
  }

  // Humid Emerald Foliage Mid-Canopy Bounce Lights
  const foliageMat = new THREE.MeshBasicMaterial({ color: 0x1e6b38 });
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const fMesh = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 12), foliageMat);
    fMesh.position.set(Math.cos(angle) * 16, (i % 3 - 1) * 4, Math.sin(angle) * 16);
    envScene.add(fMesh);
  }

  // Warm Understory Sun-Shaft Bounce
  const warmMat = new THREE.MeshBasicMaterial({ color: 0xdba64b });
  const warmDome = new THREE.Mesh(new THREE.SphereGeometry(4.0, 16, 16), warmMat);
  warmDome.position.set(8, 10, 8);
  envScene.add(warmDome);

  const envRT = pmremGenerator.fromScene(envScene, 0.045);
  pmremGenerator.dispose();
  return envRT.texture;
}

scene.environment = buildRainforestPMREMEnvironment();
scene.environmentIntensity = 0.85;

// Camera-Tracked Lighting Rig for Dramatic Canopy Shadows & Subsurface Glow
const cameraLightRig = new THREE.Group();
scene.add(cameraLightRig);

const hemiLight = new THREE.HemisphereLight(0xb5ffd4, 0x09170d, 0.95);
scene.add(hemiLight);

// Primary Golden Sunbeam Directional Light (Casts soft shadows across vines & leaves)
const sunLight = new THREE.DirectionalLight(0xffe8b0, 4.2);
sunLight.position.set(6.2, 8.5, 7.2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 32;
const shadowBounds = 9.5;
sunLight.shadow.camera.left = -shadowBounds;
sunLight.shadow.camera.right = shadowBounds;
sunLight.shadow.camera.top = shadowBounds;
sunLight.shadow.camera.bottom = -shadowBounds;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.025;
cameraLightRig.add(sunLight);
cameraLightRig.add(sunLight.target);

// Back-Lit Subsurface Rim Light (simulates sunlight transmitting through leaf blades & moss)
const sssBackLight = new THREE.DirectionalLight(0x6eff9c, 2.4);
sssBackLight.position.set(-5.5, 4.0, -5.0);
cameraLightRig.add(sssBackLight);
cameraLightRig.add(sssBackLight.target);

// Cool Misty Understory Fill Light
const mistFillLight = new THREE.DirectionalLight(0x3ab88f, 1.15);
mistFillLight.position.set(-6.5, -4.5, 5.0);
cameraLightRig.add(mistFillLight);
cameraLightRig.add(mistFillLight.target);

// Dynamic Fire Point Light near Leaf #6
const firePointLight = new THREE.PointLight(0xff5511, 0.0, 24, 1.35);
firePointLight.position.set(1.5, -6 * STEP_SPACING_Y, 3.8);
scene.add(firePointLight);

// ============================================================================
// 4. TANGENT-SPACE NORMAL MAPS, ROUGHNESS MAPS & BARK/LEAF PBR TEXTURE ENGINE
// ============================================================================

/**
 * Computes a Tangent-Space Normal Map (`normalTex`) and a Micro-Roughness Map (`roughnessTex`)
 * from any source canvas/image using a 3x3 Sobel height-derivative filter.
 */
function generateNormalAndRoughnessMaps(sourceCanvas, normalStrength = 3.2) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const sCtx = sourceCanvas.getContext('2d');
  const srcData = sCtx.getImageData(0, 0, w, h).data;

  // Compute grayscale height buffer + moss detection
  const heights = new Float32Array(w * h);
  const mossness = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = srcData[i * 4] / 255;
    const g = srcData[i * 4 + 1] / 255;
    const b = srcData[i * 4 + 2] / 255;
    heights[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    // Detect green moss vs woody bark
    mossness[i] = Math.max(0, g - Math.max(r, b) * 0.85);
  }

  const normCanvas = document.createElement('canvas');
  normCanvas.width = w;
  normCanvas.height = h;
  const nCtx = normCanvas.getContext('2d');
  const normImg = nCtx.createImageData(w, h);
  const nData = normImg.data;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = w;
  roughCanvas.height = h;
  const rCtx = roughCanvas.getContext('2d');
  const roughImg = rCtx.createImageData(w, h);
  const rData = roughImg.data;

  const sampleH = (x, y) => {
    const cx = (x + w) % w;
    const cy = (y + h) % h;
    return heights[cy * w + cx];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sampleH(x - 1, y - 1);
      const t = sampleH(x, y - 1);
      const tr = sampleH(x + 1, y - 1);
      const l = sampleH(x - 1, y);
      const r = sampleH(x + 1, y);
      const bl = sampleH(x - 1, y + 1);
      const b = sampleH(x, y + 1);
      const br = sampleH(x + 1, y + 1);

      const dX = (tr + 2 * r + br - (tl + 2 * l + bl)) * normalStrength;
      const dY = (bl + 2 * b + br - (tl + 2 * t + tr)) * normalStrength;
      const dZ = 1.0;
      const invLen = 1.0 / Math.sqrt(dX * dX + dY * dY + dZ * dZ);

      const idx = (y * w + x) * 4;
      nData[idx] = Math.round((-dX * invLen * 0.5 + 0.5) * 255);
      nData[idx + 1] = Math.round((-dY * invLen * 0.5 + 0.5) * 255);
      nData[idx + 2] = Math.round((dZ * invLen * 0.5 + 0.5) * 255);
      nData[idx + 3] = 255;

      // Roughness: deep wet bark crevices have low roughness (0.28 = wet sheen),
      // raised bark fibers are 0.72, and fuzzy green moss is 0.94!
      const hVal = heights[y * w + x];
      const mVal = mossness[y * w + x];
      const roughVal = Math.min(0.96, Math.max(0.24, 0.32 + hVal * 0.48 + mVal * 0.45));
      const rByte = Math.round(roughVal * 255);
      rData[idx] = rByte;
      rData[idx + 1] = rByte;
      rData[idx + 2] = rByte;
      rData[idx + 3] = 255;
    }
  }

  nCtx.putImageData(normImg, 0, 0);
  rCtx.putImageData(roughImg, 0, 0);

  const normalTex = new THREE.CanvasTexture(normCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;

  const roughnessTex = new THREE.CanvasTexture(roughCanvas);
  roughnessTex.wrapS = THREE.RepeatWrapping;
  roughnessTex.wrapT = THREE.RepeatWrapping;

  return { normalTex, roughnessTex };
}

function createInitialProceduralBarkPBR() {
  const size = 512;
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = size;
  diffCanvas.height = size;
  const ctx = diffCanvas.getContext('2d');

  // Deep organic rainforest liana wood base
  const grad = ctx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, '#24150b');
  grad.addColorStop(0.3, '#382214');
  grad.addColorStop(0.55, '#1d1008');
  grad.addColorStop(0.8, '#3d2617');
  grad.addColorStop(1, '#24150b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Intertwined fibrous vascular striations
  for (let i = 0; i < 900; i++) {
    const x = (i * 41) % size;
    const y = (i * 83) % size;
    const w = 1 + (i % 4);
    const h = 35 + (i % 95);
    ctx.fillStyle =
      i % 3 === 0
        ? 'rgba(10, 5, 2, 0.65)'
        : i % 3 === 1
          ? 'rgba(86, 56, 34, 0.42)'
          : 'rgba(54, 34, 19, 0.48)';
    ctx.fillRect(x, y, w, h);
  }

  // Velvety bryophyte moss & pale cyan-green lichen colonies in bark crevices
  for (let m = 0; m < 95; m++) {
    const mx = (m * 97 + 19) % size;
    const my = (m * 137 + 31) % size;
    const mr = 10 + (m % 26);
    const mGrad = ctx.createRadialGradient(mx, my, 1, mx, my, mr);
    if (m % 5 === 0) {
      mGrad.addColorStop(0, 'rgba(115, 212, 152, 0.72)');
      mGrad.addColorStop(1, 'rgba(38, 105, 62, 0)');
    } else {
      mGrad.addColorStop(0, 'rgba(36, 118, 44, 0.85)');
      mGrad.addColorStop(0.65, 'rgba(22, 78, 28, 0.5)');
      mGrad.addColorStop(1, 'rgba(12, 42, 16, 0)');
    }
    ctx.fillStyle = mGrad;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
  }

  const colorTex = new THREE.CanvasTexture(diffCanvas);
  colorTex.wrapS = THREE.RepeatWrapping;
  colorTex.wrapT = THREE.RepeatWrapping;
  colorTex.repeat.set(2, 22);
  colorTex.colorSpace = THREE.SRGBColorSpace;

  const { normalTex, roughnessTex } = generateNormalAndRoughnessMaps(diffCanvas, 4.2);
  normalTex.repeat.set(2, 22);
  roughnessTex.repeat.set(2, 22);

  return { colorTex, normalTex, roughnessTex };
}

const initialBarkPBR = createInitialProceduralBarkPBR();
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// Physically-Based Materials for the Gnarled Liana Vines
const primaryLianaMat = new THREE.MeshPhysicalMaterial({
  map: initialBarkPBR.colorTex,
  normalMap: initialBarkPBR.normalTex,
  normalScale: new THREE.Vector2(1.85, 1.85),
  roughnessMap: initialBarkPBR.roughnessTex,
  roughness: 0.76,
  metalness: 0.02,
  clearcoat: 0.28, // Humid rainforest moisture film on the bark
  clearcoatRoughness: 0.42
});

const secondaryMossVineMat = new THREE.MeshPhysicalMaterial({
  color: 0xd4f0d8,
  map: initialBarkPBR.colorTex,
  normalMap: initialBarkPBR.normalTex,
  normalScale: new THREE.Vector2(1.65, 1.65),
  roughnessMap: initialBarkPBR.roughnessTex,
  roughness: 0.82,
  metalness: 0.01,
  sheen: 0.45, // Velvety moss sheen
  sheenColor: new THREE.Color(0x48c96c),
  sheenRoughness: 0.75
});

const petioleStemMat = new THREE.MeshPhysicalMaterial({
  color: 0x3b8c4c,
  map: initialBarkPBR.colorTex,
  normalMap: initialBarkPBR.normalTex,
  normalScale: new THREE.Vector2(0.85, 0.85),
  roughness: 0.48,
  metalness: 0.02,
  clearcoat: 0.35,
  clearcoatRoughness: 0.35
});

const epiphyteFernMat = new THREE.MeshPhysicalMaterial({
  color: 0x2ca852,
  roughness: 0.42,
  metalness: 0.01,
  clearcoat: 0.3,
  transmission: 0.18,
  side: THREE.DoubleSide
});

const texLoader = new THREE.TextureLoader();

// Upgrade vine PBR maps with the high-resolution photorealistic `./assets/liana_bark.jpg`
texLoader.load('./assets/liana_bark.jpg', (barkImgTex) => {
  const img = barkImgTex.image;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 512, 512);

  const { normalTex, roughnessTex } = generateNormalAndRoughnessMaps(c, 4.8);
  normalTex.repeat.set(2, 22);
  normalTex.anisotropy = maxAniso;
  roughnessTex.repeat.set(2, 22);
  roughnessTex.anisotropy = maxAniso;

  barkImgTex.wrapS = THREE.RepeatWrapping;
  barkImgTex.wrapT = THREE.RepeatWrapping;
  barkImgTex.repeat.set(2, 22);
  barkImgTex.anisotropy = maxAniso;
  barkImgTex.colorSpace = THREE.SRGBColorSpace;

  primaryLianaMat.map = barkImgTex;
  primaryLianaMat.normalMap = normalTex;
  primaryLianaMat.roughnessMap = roughnessTex;
  primaryLianaMat.needsUpdate = true;

  secondaryMossVineMat.map = barkImgTex;
  secondaryMossVineMat.normalMap = normalTex;
  secondaryMossVineMat.roughnessMap = roughnessTex;
  secondaryMossVineMat.needsUpdate = true;

  petioleStemMat.normalMap = normalTex;
  petioleStemMat.needsUpdate = true;
});

// Deep Atmospheric Rainforest Canopy Backdrop Plane
const canopyBackdropMat = new THREE.MeshBasicMaterial({
  color: 0x3b6349,
  transparent: true,
  opacity: 0.32,
  depthWrite: false
});
const canopyBackdropMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(38, 24),
  canopyBackdropMat
);
canopyBackdropMesh.position.set(0, 0, -12.5);
cameraLightRig.add(canopyBackdropMesh);

texLoader.load('./assets/rainforest_bg.jpg', (bgTex) => {
  bgTex.colorSpace = THREE.SRGBColorSpace;
  canopyBackdropMat.map = bgTex;
  canopyBackdropMat.needsUpdate = true;
});

// ============================================================================
// 5. PHOTOREALISTIC GNARLED 3D DNA LIANA VINES, EPIPHYTES & AERIAL ROOTS
// ============================================================================

const vineWorldGroup = new THREE.Group();
scene.add(vineWorldGroup);

function getVineColumnCenterX(side, y) {
  const convergeT = THREE.MathUtils.smoothstep(-y, 48.0, 60.5);
  const spreadX = THREE.MathUtils.lerp(4.45, 0.0, convergeT);
  const organicSway = Math.sin(y * 0.16 + side * 1.3) * 0.28 * (1.0 - convergeT * 0.75);
  return side * spreadX + organicSway;
}

function getVineStrandPoint(side, strandIndex, y) {
  const centerX = getVineColumnCenterX(side, y);
  const convergeT = THREE.MathUtils.smoothstep(-y, 48.0, 60.5);

  const helixRadius = THREE.MathUtils.lerp(0.66, 0.96, convergeT);
  const twistRate = 0.72;
  const basePhase = strandIndex * Math.PI + (side > 0 ? Math.PI * 0.5 : 0);
  const angle = y * twistRate + basePhase;

  const x = centerX + Math.cos(angle) * helixRadius;
  const z = Math.sin(angle) * helixRadius - 0.45 - convergeT * 0.7;
  return new THREE.Vector3(x, y, z);
}

/**
 * Builds a high-resolution, organically displaced 3D Liana Vine Geometry.
 * Every vertex is displaced along its normal using twisted longitudinal vascular flutes,
 * bark ridges, and nodular burls so the silhouette looks like real ancient woody jungle lianas!
 */
function createGnarledLianaGeometry(curve, baseRadius, tubularSegments, radialSegments, seed = 0) {
  const geo = new THREE.TubeGeometry(curve, tubularSegments, baseRadius, radialSegments, false);
  const posAttr = geo.attributes.position;
  const normAttr = geo.attributes.normal;
  const uvAttr = geo.attributes.uv;

  const vPos = new THREE.Vector3();
  const vNorm = new THREE.Vector3();

  for (let i = 0; i < posAttr.count; i++) {
    vPos.fromBufferAttribute(posAttr, i);
    vNorm.fromBufferAttribute(normAttr, i);
    const u = uvAttr.getX(i); // 0..1 along length of vine
    const v = uvAttr.getY(i); // 0..1 around circumference

    const radialAngle = v * Math.PI * 2.0;

    // 1. Subtle helical vascular twist (characteristic of woody tropical Bauhinia & Ficus lianas)
    const flute1 = Math.sin(radialAngle * 3.0 + u * 52.0 + seed) * 0.045;
    const flute2 = Math.cos(radialAngle * 5.0 - u * 84.0 + seed * 1.7) * 0.025;

    // 2. Organic woody burls & internode swellings along the length
    const burlWave = Math.pow(0.5 + 0.5 * Math.sin(u * 48.0 + seed * 3.1), 3.0) * 0.16;
    const roughBark = Math.sin(radialAngle * 9.0 + u * 180.0) * 0.018;

    const displacement = baseRadius * (flute1 + flute2 + burlWave + roughBark);
    vPos.addScaledVector(vNorm, displacement);
    posAttr.setXYZ(i, vPos.x, vPos.y, vPos.z);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a 3D Epiphytic Climber Leaf Cluster (small heart-shaped tropical philodendron leaves
 * clinging to the damp liana bark).
 */
function createEpiphyteFernCluster(side, seed) {
  const cluster = new THREE.Group();
  const leafCount = 4;

  for (let f = 0; f < leafCount; f++) {
    const leafGeo = new THREE.PlaneGeometry(0.38, 0.52, 10, 14);
    const pos = leafGeo.attributes.position;
    const uv = leafGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getY(i); // 0 (base) .. 1 (tip)
      const v = (uv.getX(i) - 0.5) * 2.0; // -1 .. +1
      const absV = Math.abs(v);
      const heartWidth = Math.pow(Math.sin(Math.min(1.0, u * 1.05) * Math.PI), 0.72) * (1.0 - u * 0.25);
      const cordateDip = (1.0 - smoothstepJS(0.0, 0.22, u)) * Math.sin(absV * Math.PI) * 0.06;
      const archZ = -Math.pow(u, 1.6) * 0.18 + Math.pow(absV, 1.4) * 0.05;
      pos.setXYZ(i, v * 0.24 * heartWidth, u * 0.52 - cordateDip, archZ);
    }
    leafGeo.computeVertexNormals();

    const frond = new THREE.Mesh(leafGeo, epiphyteFernMat);
    const spreadAngle = ((f / (leafCount - 1)) - 0.5) * 1.35 + side * -0.35;
    frond.rotation.z = spreadAngle;
    frond.rotation.x = 0.45 + (f % 2) * 0.22 + Math.sin(seed + f) * 0.12;
    frond.castShadow = true;
    cluster.add(frond);
  }

  return cluster;
}

const VINE_TOP_Y = 14.0;
const VINE_BOTTOM_Y = -72.0;
const VINE_SAMPLES = 240;

const epiphyteClusters = [];

[-1, 1].forEach((side) => {
  // 2 Primary Intertwined Gnarled Woody DNA Liana Strands
  for (let strandIdx = 0; strandIdx < 2; strandIdx++) {
    const points = [];
    for (let i = 0; i <= VINE_SAMPLES; i++) {
      const t = i / VINE_SAMPLES;
      const y = THREE.MathUtils.lerp(VINE_TOP_Y, VINE_BOTTOM_Y, t);
      points.push(getVineStrandPoint(side, strandIdx, y));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const radius = strandIdx === 0 ? 0.29 : 0.23;
    const gnarledGeo = createGnarledLianaGeometry(
      curve,
      radius,
      300,
      36,
      side * 3.0 + strandIdx * 7.0
    );
    const mat = strandIdx === 0 ? primaryLianaMat : secondaryMossVineMat;
    const vineMesh = new THREE.Mesh(gnarledGeo, mat);
    vineMesh.castShadow = true;
    vineMesh.receiveShadow = true;
    vineWorldGroup.add(vineMesh);
  }

  // 2 Secondary Strangler-Root & Moss Climber Strands hugging the DNA trunks
  for (let cIdx = 0; cIdx < 2; cIdx++) {
    const climberPoints = [];
    for (let i = 0; i <= VINE_SAMPLES * 1.4; i++) {
      const t = i / (VINE_SAMPLES * 1.4);
      const y = THREE.MathUtils.lerp(VINE_TOP_Y, VINE_BOTTOM_Y, t);
      const basePt = getVineStrandPoint(side, cIdx, y);
      const coilAngle = y * (2.6 + cIdx * 0.8) + side * 1.5;
      climberPoints.push(
        new THREE.Vector3(
          basePt.x + Math.cos(coilAngle) * 0.29,
          y,
          basePt.z + Math.sin(coilAngle) * 0.29
        )
      );
    }
    const climberCurve = new THREE.CatmullRomCurve3(climberPoints);
    const climberGeo = createGnarledLianaGeometry(
      climberCurve,
      0.068,
      280,
      12,
      cIdx * 5.0
    );
    const climberMesh = new THREE.Mesh(
      climberGeo,
      cIdx === 0 ? secondaryMossVineMat : primaryLianaMat
    );
    climberMesh.castShadow = true;
    vineWorldGroup.add(climberMesh);
  }

  // DNA Cross-Rung Tendrils, Hanging Aerial Root Curtains & Epiphytic Fern Rosettes
  const rungStep = 1.65;
  for (let y = VINE_TOP_Y - 1.5; y >= VINE_BOTTOM_Y + 2.5; y -= rungStep) {
    const pA = getVineStrandPoint(side, 0, y);
    const pB = getVineStrandPoint(side, 1, y);
    const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
    mid.y += Math.sin(y * 1.9) * 0.22;
    mid.z += 0.16;

    const rungCurve = new THREE.CatmullRomCurve3([pA, mid, pB]);
    const rungGeo = createGnarledLianaGeometry(rungCurve, 0.082, 18, 12, y);
    const rungMesh = new THREE.Mesh(rungGeo, primaryLianaMat);
    rungMesh.castShadow = true;
    rungMesh.receiveShadow = true;
    vineWorldGroup.add(rungMesh);

    // Hanging Aerial Root Filaments draping down from the vine joints
    if (Math.abs(Math.cos(y * 2.3)) > 0.52) {
      const rootLen = 1.8 + (Math.abs(Math.sin(y * 4.1)) * 2.2);
      const rootTop = pA.clone();
      const rootMid = new THREE.Vector3(
        pA.x + side * -0.18 + Math.sin(y) * 0.12,
        pA.y - rootLen * 0.5,
        pA.z + 0.1
      );
      const rootBot = new THREE.Vector3(
        pA.x + side * -0.25 + Math.cos(y) * 0.15,
        pA.y - rootLen,
        pA.z + 0.15
      );
      const rootCurve = new THREE.CatmullRomCurve3([rootTop, rootMid, rootBot]);
      const rootGeo = new THREE.TubeGeometry(rootCurve, 14, 0.022, 6, false);
      vineWorldGroup.add(new THREE.Mesh(rootGeo, secondaryMossVineMat));
    }

    // 3D Epiphytic Rainforest Fern Rosettes growing in the damp bark forks
    if (Math.abs(Math.sin(y * 2.7 + side)) > 0.68) {
      const fernCluster = createEpiphyteFernCluster(side, y);
      fernCluster.position.copy(pB);
      fernCluster.position.z += 0.18;
      vineWorldGroup.add(fernCluster);
      epiphyteClusters.push({ group: fernCluster, baseY: y, side });
    }
  }
});

// ============================================================================
// 6. FINALE (STAGE 7): LIVING 3D VINE CALLIGRAPHY TEXT & BLOOMING ORCHIDS
// ============================================================================

const finaleVineTextGroup = new THREE.Group();
const finaleWorldY = -7 * STEP_SPACING_Y;
finaleVineTextGroup.position.set(0, finaleWorldY + 2.45, 0.45);
scene.add(finaleVineTextGroup);

const VINE_LETTER_GLYPHS = {
  P: [[[0, 0], [0, 1], [0.55, 1], [0.65, 0.75], [0.55, 0.5], [0, 0.5]]],
  R: [
    [[0, 0], [0, 1], [0.55, 1], [0.65, 0.75], [0.55, 0.5], [0, 0.5]],
    [[0.32, 0.5], [0.68, 0]]
  ],
  O: [[[0.1, 0], [0, 0.25], [0, 0.75], [0.1, 1], [0.55, 1], [0.65, 0.75], [0.65, 0.25], [0.55, 0], [0.1, 0]]],
  T: [[[0, 1], [0.68, 1]], [[0.34, 1], [0.34, 0]]],
  E: [[[0.62, 1], [0, 1], [0, 0], [0.62, 0]], [[0, 0.5], [0.48, 0.5]]],
  C: [[[0.65, 0.85], [0.5, 1], [0.12, 1], [0, 0.75], [0, 0.25], [0.12, 0], [0.5, 0], [0.65, 0.15]]],
  A: [[[0, 0], [0.34, 1], [0.68, 0]], [[0.12, 0.38], [0.56, 0.38]]],
  I: [[[0.12, 1], [0.52, 1]], [[0.32, 1], [0.32, 0]], [[0.12, 0], [0.52, 0]]],
  N: [[[0, 0], [0, 1], [0.65, 0], [0.65, 1]]],
  F: [[[0, 0], [0, 1], [0.62, 1]], [[0, 0.5], [0.48, 0.5]]],
  S: [[[0.62, 0.88], [0.45, 1], [0.12, 1], [0, 0.78], [0.15, 0.55], [0.52, 0.45], [0.65, 0.22], [0.5, 0], [0.12, 0], [0, 0.15]]]
};

const finaleOrchidBlooms = [];

function build3DVineWord(word, rowY, scaleX, scaleY, archHeight) {
  const spacing = 0.86 * scaleX;
  const totalWidth = (word.length - 1) * spacing;
  const startX = -totalWidth / 2;

  for (let cIdx = 0; cIdx < word.length; cIdx++) {
    const ch = word[cIdx];
    const strokes = VINE_LETTER_GLYPHS[ch];
    if (!strokes) continue;

    const charBaseX = startX + cIdx * spacing;
    const normX = totalWidth > 0 ? charBaseX / (totalWidth * 0.5) : 0;
    const archOffset = (1.0 - normX * normX) * archHeight;

    const rootOrigin = new THREE.Vector3(charBaseX * 0.25, rowY - 0.85, -0.55);
    const letterCenter = new THREE.Vector3(
      charBaseX + 0.3 * scaleX,
      rowY + archOffset + 0.3 * scaleY,
      0.08
    );
    const bridgeMid = new THREE.Vector3(
      (rootOrigin.x + letterCenter.x) * 0.5,
      (rootOrigin.y + letterCenter.y) * 0.5,
      -0.25 + Math.sin(cIdx) * 0.18
    );
    const feederCurve = new THREE.CatmullRomCurve3([rootOrigin, bridgeMid, letterCenter]);
    const feederGeo = createGnarledLianaGeometry(feederCurve, 0.032, 16, 8, cIdx);
    finaleVineTextGroup.add(new THREE.Mesh(feederGeo, secondaryMossVineMat));

    strokes.forEach((strokePts) => {
      const vecPts = strokePts.map(([lx, ly], idx) => {
        const px = charBaseX + (lx - 0.32) * scaleX;
        const py = rowY + archOffset + ly * scaleY;
        const pz = Math.sin(idx * 1.4 + cIdx) * 0.045 + 0.15;
        return new THREE.Vector3(px, py, pz);
      });
      const curve = new THREE.CatmullRomCurve3(vecPts);
      const tubeGeo = createGnarledLianaGeometry(curve, 0.052, 24, 10, cIdx * 2.1);
      const mesh = new THREE.Mesh(tubeGeo, petioleStemMat);
      mesh.castShadow = true;
      finaleVineTextGroup.add(mesh);

      const bloomAnchor = vecPts[Math.floor(vecPts.length / 2)];
      const bloomGroup = new THREE.Group();
      bloomGroup.position.copy(bloomAnchor);
      bloomGroup.position.z += 0.08;

      const petalMat = new THREE.MeshPhysicalMaterial({
        color: cIdx % 2 === 0 ? 0xffe070 : 0x62ffa6,
        emissive: cIdx % 2 === 0 ? 0xc47b10 : 0x18a854,
        emissiveIntensity: 0.85,
        roughness: 0.25,
        clearcoat: 0.5
      });

      for (let p = 0; p < 5; p++) {
        const pAngle = (p / 5) * Math.PI * 2;
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 10), petalMat);
        petal.position.set(Math.cos(pAngle) * 0.062, Math.sin(pAngle) * 0.062, 0.02);
        petal.scale.set(1.25, 0.65, 0.38);
        petal.rotation.z = pAngle;
        bloomGroup.add(petal);
      }
      finaleVineTextGroup.add(bloomGroup);
      finaleOrchidBlooms.push({
        group: bloomGroup,
        mat: petalMat,
        baseScale: 0.68,
        targetScale: 0.68,
        phase: cIdx * 0.7 + rowY
      });
    });
  }
}

build3DVineWord('PROTECT', 0.54, 0.68, 0.62, 0.2);
build3DVineWord('RAINFOREST', -0.32, 0.56, 0.52, 0.15);

// ============================================================================
// 7. TRUE SCULPTED 3D RAINFOREST LEAF MODEL & PHYSICAL UNFOLDING SHADERS
// ============================================================================

/**
 * Constructs a true 3D Botanical Rainforest Leaf Blade Geometry (`112 x 112` grid):
 * - UV.x (`u` in `0..1`): runs from Petiole Stem Base (`0.0`) to Acuminate Drip-Tip (`1.0`).
 * - UV.y (`vNorm` in `0..1`, `v = (vNorm - 0.5) * 2` in `-1..+1`): runs across the leaf blade
 *   with `v = 0` at the raised central midrib vein!
 * - Shapes the 3D vertices into a lush cordate/ovate tropical rainforest leaf with:
 *   1. Indented heart-shaped basal lobes at `u = 0`
 *   2. Full wide lamina in the center (`u = 0.12..0.78`)
 *   3. Tapered acuminate drip-tip at `u = 0.82..1.0`
 *   4. Raised 3D central midrib + 9 pairs of arched 3D lateral secondary veins + bullate pillowing
 *   5. Organic ruffled margin undulations
 */
function createSculptedRainforestLeafGeometry() {
  const segU = 144;
  const segV = 144;
  const geo = new THREE.PlaneGeometry(1, 1, segU, segV);
  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;

  const lengthScale = 7.55; // Leaf total length from cordate stem base to acuminate drip-tip
  const maxHalfWidth = 2.52; // Half-width of leaf blade

  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i); // 0 (stem base) .. 1 (drip-tip)
    const vNorm = uvAttr.getY(i); // 0 (bottom margin) .. 1 (top margin)
    const v = (vNorm - 0.5) * 2.0; // -1 .. +1 across midrib
    const absV = Math.abs(v);

    // Keep an orthogonal curvilinear (u, v) grid in X/Y so the HTML-in-Canvas DOM texture
    // never pinches or squishes into a triangle on the right, while sculpting the full 3D
    // midrib, lateral veins, bullate pillowing, and V-dihedral arch in Z!
    // The smooth botanical cordate-base + broad ovate blade + acuminate drip-tip silhouette
    // is carved at per-pixel resolution in `leafFragmentShader`.
    const dripHookY = -Math.pow(Math.max(0.0, u - 0.78) / 0.22, 2.0) * 0.16;

    const localX = (u - 0.5) * lengthScale;
    const localY = v * maxHalfWidth + dripHookY;

    // 3D Structural Midrib, Arched Lateral Veins & Bullate Lamina Relief (`localZ`)
    const midribThickness = (1.0 - u * 0.78) * 0.13;
    const midribRidge = Math.exp(-absV * 24.0) * midribThickness;

    // 9 Arched Secondary Lateral Veins sweeping from midrib toward margins
    const veinCoord = u * 9.5 - Math.pow(absV, 1.22) * 1.85;
    const veinWave = Math.cos(veinCoord * Math.PI * 2.0);
    const lateralVeinRib =
      Math.pow(Math.max(0.0, veinWave), 6.0) * 0.048 * (1.0 - absV * 0.35) * (1.0 - u * 0.28);
    const bullatePillow =
      Math.max(0.0, -veinWave) * 0.058 * Math.sin(absV * Math.PI) * (1.0 - u * 0.22);

    // Natural V-dihedral angle & longitudinal canopy arch
    const dihedralZ = Math.pow(absV, 1.35) * 0.24;
    const longitudinalArch = -Math.pow(u - 0.44, 2.0) * 0.36;
    const edgeRuffleZ =
      Math.sin(u * 22.0 + (v > 0 ? 0.0 : 1.5)) *
      0.055 *
      smoothstepJS(0.62, 1.0, absV);

    const localZ =
      midribRidge + lateralVeinRib + bullatePillow + dihedralZ + longitudinalArch + edgeRuffleZ;

    posAttr.setXYZ(i, localX, localY, localZ);
  }

  geo.computeVertexNormals();
  return geo;
}

function smoothstepJS(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const sharedSculptedLeafGeo = createSculptedRainforestLeafGeometry();

/**
 * Custom Vertex Shader for the 3D Botanical Origami / Flower-Petal Blooming Rainforest Leaf:
 * Takes the flat sculpted 3D surface (with the live HTML-in-Canvas DOM texture mapped onto it)
 * and folds/unfolds it piece-by-piece using a hierarchical kinematic chain of:
 *   1. Central Midrib Valley Book-Fold (the two halves of the leaf fold together like a book/petal)
 *   2. 6-Segment Longitudinal Petal-Arch Chain from Petiole Stem (u=0) to Drip-Tip (u=1) that
 *      blooms sequentially from base to tip and reverses when refolding (`uFoldDir`)
 *   3. 3-Tier Lateral Accordion Wing Hinges (`absV > 0.20, 0.46, 0.72`) that fold the outer
 *      lamina lobes inward and back outward like origami flower petals
 *   4. Diagonal Miura-Ori / Hornbeam Herringbone Vein Pleats along the arched secondary veins
 *      so every vein facet tilts and catches specular sunlight as it unfolds!
 */
const leafVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uUnfold;       // 0.0 = folded origami flower bud on vine, 1.0 = fully bloomed flat leaf
  uniform float uFoldDir;      // -1.0 = blooming open as user approaches, +1.0 = refolding as user scrolls past
  uniform float uSide;         // -1.0 = Left vine, +1.0 = Right vine, 0.0 = Center
  uniform float uBurnProgress; // 0.0 = living leaf, 0..1 = burning, 1.0 = charred skeletal remains
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying float vVeinHeight;
  varying float vOrigamiCrease;
  varying float vFacetShade;

  vec3 rotateAxis(vec3 p, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
  }

  // Piecewise origami hinge helper: rotates vertices on the distal side (d > 0) of an angled
  // hinge line passing through pivotXY with unit axisXY in the leaf plane.
  // Multiplying by midribSafe (smoothstep(0.0, 0.20, absV)) guarantees 100% C1 continuity
  // across the central midrib (v = 0) so the upper and lower halves never split or tear!
  void applyOrigamiPetalHinge(
    inout vec3 pos,
    inout vec3 norm,
    inout float creaseAccum,
    inout float facetAccum,
    vec2 pos0XY,
    float absV,
    vec2 pivotXY,
    vec2 axisXY,
    vec2 outwardNormalXY,
    float maxAngle,
    float localFold,
    float hingeWidth
  ) {
    float d = dot(pos0XY - pivotXY, outwardNormalXY);
    if (d > -hingeWidth && localFold > 0.0005) {
      float midribSafe = smoothstep(0.0, 0.20, absV);
      float w = smoothstep(0.0, hingeWidth, d) * midribSafe;
      float ang = maxAngle * localFold * w;
      vec3 pivot3 = vec3(pivotXY, 0.0);
      vec3 axis3 = normalize(vec3(axisXY, 0.0));
      pos = pivot3 + rotateAxis(pos - pivot3, axis3, ang);
      norm = rotateAxis(norm, axis3, ang);

      // Highlight the origami crease ridge right along the hinge line (d == 0)
      float creaseLine = exp(-pow(d / (hingeWidth * 0.45), 2.0)) * smoothstep(0.02, 0.25, localFold) * midribSafe;
      creaseAccum = max(creaseAccum, creaseLine);
      facetAccum += sin(ang) * 0.38 * w;
    }
  }

  void main() {
    vUv = uv;
    float u = uv.x;               // 0.0 (petiole stem base) .. 1.0 (acuminate drip-tip)
    float v = (uv.y - 0.5) * 2.0; // -1.0 (lower margin) .. +1.0 (upper margin), 0.0 = midrib
    float absV = abs(v);
    float sideSign = v >= 0.0 ? 1.0 : -1.0;

    // Canonical leaf coordinates: petiole at x = -3.775, drip-tip at x = +3.775, y in [-2.52, +2.52]
    vec3 pos = position;
    vec2 pos0XY = pos.xy;
    vec3 norm = normal;

    // Analytical vein height for fragment lighting
    float veinCoord = u * 7.5 - pow(absV, 1.12) * 2.15;
    vVeinHeight = exp(-absV * 22.0) + pow(max(0.0, cos(veinCoord * 6.28318)), 6.0) * 0.65;

    // ========================================================================
    // PIECE-BY-PIECE BOTANICAL ORIGAMI / FLOWER-PETAL UNFOLDING & REFOLDING
    // ========================================================================
    float fold = clamp(1.0 - uUnfold, 0.0, 1.0);
    vOrigamiCrease = 0.0;
    vFacetShade = 0.0;

    if (fold > 0.0005) {
      // Directional wave along the leaf blade:
      // - When approaching (uFoldDir <= 0), the basal stem petals bloom open first while the
      //   outer radial petals and drip-tip unfurl last like a blooming flower!
      // - When scrolling past (uFoldDir > 0), the sequence reverses so the petals refold
      //   piece-by-piece in the scroll direction!
      float dirU = uFoldDir > 0.0 ? (1.0 - u) : u;
      float midribSafe = smoothstep(0.0, 0.20, absV);

      // ----------------------------------------------------------------------
      // STAGE 1: DIAGONAL MIURA-ORI / HORNBEAM HERRINGBONE VEIN PLEATS
      // Each diagonal strip between secondary lateral veins acts as an origami
      // mountain/valley facet that accordion-pleats along the 42-degree vein angle!
      // ----------------------------------------------------------------------
      float pleatLocalFold = smoothstep(0.0, 0.85, fold * (0.68 + 0.32 * dirU));
      float pleatPhase = veinCoord * 3.14159265;
      float triWave = asin(clamp(sin(pleatPhase) * 0.985, -1.0, 1.0)) * (2.0 / 3.14159265);
      float squareSlope = atan(sin(pleatPhase) * 10.0) * (2.0 / 3.14159265);

      float pleatAmp = 0.26 * pleatLocalFold * midribSafe;
      pos.z += triWave * pleatAmp;
      // Foreshorten X and Y along the diagonal vein normal so facets don't stretch when pleated
      float foreshorten = (1.0 - cos(pleatLocalFold * 1.05)) * 0.34 * midribSafe;
      pos.x -= u * 7.55 * foreshorten * 0.45;
      pos.y -= v * 2.52 * foreshorten * 0.28;

      float facetTilt = squareSlope * pleatLocalFold * 0.65 * midribSafe;
      vec3 pleatHingeAxis = normalize(vec3(0.45, -sideSign * 0.89, 0.0));
      norm = rotateAxis(norm, pleatHingeAxis, facetTilt);

      vOrigamiCrease = pow(abs(cos(pleatPhase)), 14.0) * pleatLocalFold * 0.85 * midribSafe;
      vFacetShade = squareSlope * pleatLocalFold * 0.75 * midribSafe;

      // ----------------------------------------------------------------------
      // STAGE 2: 6 RADIAL FLOWER-PETAL FAN LOBES (Piece-by-Piece Non-Rectangular Bloom)
      // Radiating diagonally from the leaf heart like layered lotus/hibiscus petals,
      // each petal lobe unfolds at its own staggered phase!
      // ----------------------------------------------------------------------
      // Petal Pair 1 (Distal Tip Margin Petals - bloom open last when approaching, fold first when leaving)
      float p1Phase = uFoldDir > 0.0 ? 0.02 : 0.26;
      float p1Fold = clamp((fold - p1Phase) / 0.65, 0.0, 1.0);
      p1Fold = p1Fold * p1Fold * (3.0 - 2.0 * p1Fold);
      vec2 p1Pivot = vec2(0.55, sideSign * 1.18);
      vec2 p1Normal = normalize(vec2(0.52, sideSign * 0.854));
      vec2 p1Axis = vec2(-sideSign * p1Normal.y, sideSign * p1Normal.x);
      applyOrigamiPetalHinge(
        pos, norm, vOrigamiCrease, vFacetShade,
        pos0XY, absV, p1Pivot, p1Axis, p1Normal,
        1.48, p1Fold, 0.32
      );

      // Petal Pair 2 (Basal Cordate Margin Petals - angled diagonally toward the stem)
      float p2Phase = uFoldDir > 0.0 ? 0.22 : 0.06;
      float p2Fold = clamp((fold - p2Phase) / 0.68, 0.0, 1.0);
      p2Fold = p2Fold * p2Fold * (3.0 - 2.0 * p2Fold);
      vec2 p2Pivot = vec2(-0.65, sideSign * 1.15);
      vec2 p2Normal = normalize(vec2(-0.48, sideSign * 0.877));
      vec2 p2Axis = vec2(-sideSign * p2Normal.y, sideSign * p2Normal.x);
      applyOrigamiPetalHinge(
        pos, norm, vOrigamiCrease, vFacetShade,
        pos0XY, absV, p2Pivot, p2Axis, p2Normal,
        1.42, p2Fold, 0.32
      );

      // Petal Pair 3 (Mid-Blade Accordion Valley Wing - folds outward in reverse origami pleat)
      float p3Phase = 0.14;
      float p3Fold = clamp((fold - p3Phase) / 0.72, 0.0, 1.0);
      p3Fold = p3Fold * p3Fold * (3.0 - 2.0 * p3Fold);
      vec2 p3Pivot = vec2(-0.15, sideSign * 0.72);
      vec2 p3Normal = normalize(vec2(0.24, sideSign * 0.971));
      vec2 p3Axis = vec2(-sideSign * p3Normal.y, sideSign * p3Normal.x);
      applyOrigamiPetalHinge(
        pos, norm, vOrigamiCrease, vFacetShade,
        pos0XY, absV, p3Pivot, p3Axis, p3Normal,
        -1.24, p3Fold, 0.34
      );

      // Petal Pair 4 (Inner Calyx Cupping Petals - cups the entire upper and lower blades inward)
      float p4Fold = clamp((fold - 0.18) / 0.78, 0.0, 1.0);
      p4Fold = p4Fold * p4Fold * (3.0 - 2.0 * p4Fold);
      vec2 p4Pivot = vec2(-0.45, sideSign * 0.32);
      vec2 p4Normal = normalize(vec2(0.16, sideSign * 0.987));
      vec2 p4Axis = vec2(-sideSign * p4Normal.y, sideSign * p4Normal.x);
      applyOrigamiPetalHinge(
        pos, norm, vOrigamiCrease, vFacetShade,
        pos0XY, absV, p4Pivot, p4Axis, p4Normal,
        1.32, p4Fold, 0.34
      );

      // ----------------------------------------------------------------------
      // STAGE 3: 5-SEGMENT PIECEWISE ORIGAMI SPINE & PETAL BLOOM CHAIN (u = 0 -> 1)
      // Rotates the leaf blade piece-by-piece across 5 sequential hinge ribs from
      // distal tip (seg=4) to proximal stem (seg=0). Because the spine axis (0, 1, 0)
      // is symmetric across v=0, both halves and the midrib fold together seamlessly!
      // ----------------------------------------------------------------------
      for (int seg = 4; seg >= 0; seg--) {
        float segF = float(seg);
        // Sequential phase: when blooming (uFoldDir <= 0), basal seg=0 finishes unfolding first
        // while distal tip seg=4 unfolds last; when refolding (uFoldDir > 0), reversed!
        float orderIdx = uFoldDir > 0.0 ? segF : (4.0 - segF);
        float segStart = orderIdx * 0.12;
        float segFold = clamp((fold - segStart) / (1.0 - 4.0 * 0.12), 0.0, 1.0);
        float segEase = segFold * segFold * (3.0 - 2.0 * segFold);

        float hingeU = 0.14 + segF * 0.155; // u = 0.14, 0.295, 0.45, 0.605, 0.76
        float hingeX = (hingeU - 0.5) * 7.55;
        // Curved V-chevron hinge distance: outer margins reach the hinge earlier than the midrib,
        // giving each longitudinal fold a curved flower-petal contour while staying C1 symmetric at v=0!
        float chevronOffset = absV * absV * 0.65;
        float dLong = (pos0XY.x - hingeX) + chevronOffset;

        if (dLong > 0.0) {
          float wSeg = smoothstep(0.0, 0.32, dLong);
          // Alternating origami accordion pitch + forward petal cup
          float altPitch = (mod(segF, 2.0) < 0.5 ? 0.52 : -0.24) + 0.22;
          float pitchAng = -segEase * altPitch * wSeg;
          float sweepAng = segEase * 0.18 * (-uFoldDir) * wSeg;

          vec3 segPivot = vec3(hingeX, 0.0, 0.0);
          vec3 rel = pos - segPivot;
          rel = rotateAxis(rel, vec3(0.0, 1.0, 0.0), pitchAng);
          rel = rotateAxis(rel, vec3(0.0, 0.0, 1.0), sweepAng);
          pos = segPivot + rel;

          norm = rotateAxis(norm, vec3(0.0, 1.0, 0.0), pitchAng);
          norm = rotateAxis(norm, vec3(0.0, 0.0, 1.0), sweepAng);

          float segCrease = exp(-pow(dLong / 0.14, 2.0)) * smoothstep(0.05, 0.35, segEase);
          vOrigamiCrease = max(vOrigamiCrease, segCrease);
          vFacetShade += sin(pitchAng) * 0.28;
        }
      }
    }

    // Mirror X geometry if sprouting from Right Vine so stem base (u=0) is on the right!
    if (uSide > 0.1) {
      pos.x = -pos.x;
      norm.x = -norm.x;
    }

    // Organic Rainforest Wind Sway & Drip-Tip Flutter when unfolded
    float windWave = sin(uTime * 1.85 + u * 3.4 + v * 1.6) * (0.03 + u * 0.065) * uUnfold;
    pos.z += windWave;
    pos.y += cos(uTime * 1.4 + u * 2.5) * 0.025 * u * uUnfold;

    // Heat Curl & Shriveling when Burning / Charred (Leaf #6)
    if (uBurnProgress > 0.001) {
      float shrink = 1.0 - uBurnProgress * 0.14 * (0.3 + 0.7 * absV);
      pos.xy *= shrink;
      pos.z += pow(absV, 1.6) * 0.55 * uBurnProgress;
      pos.z += sin(u * 18.0 + uTime * 9.0) * 0.06 * sin(uBurnProgress * 3.14159);
    }

    vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPosition.xyz;
    vNormal = normalize(normalMatrix * norm);
    vViewDir = normalize(cameraPosition - worldPosition.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/**
 * Custom Fragment Shader for the 3D Botanical Origami / Flower-Petal Rainforest Leaf:
 * - Carves the smooth botanical silhouette (cordate heart-shaped basal sinus, wide ovate lamina,
 *   and slender acuminate drip-tip) at per-pixel resolution while keeping the DOM UVs orthogonal.
 * - Shades the piecewise diagonal origami facets and glowing vein crease lines as the leaf
 *   unfolds and refolds.
 * - Maps the live HTML-in-Canvas DOM texture (uHtmlTexture) directly onto the leaf lamina
 *   so the text, inputs, quiz buttons, and burn controls fold and bloom piece-by-piece with the leaf!
 */
const leafFragmentShader = /* glsl */ `
  uniform sampler2D uHtmlTexture;
  uniform sampler2D uFallbackTexture;
  uniform sampler2D uLeafBioTex;
  uniform float uHasBioTex;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uUnfold;
  uniform float uFoldDir;
  uniform float uSide;
  uniform float uFlipY;
  uniform float uBurnProgress;
  uniform vec2 uPointer;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying float vVeinHeight;
  varying float vOrigamiCrease;
  varying float vFacetShade;

  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.5);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.05 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float u = vUv.x;
    float v = (vUv.y - 0.5) * 2.0; // -1 .. +1
    float absV = abs(v);

    // ========================================================================
    // 1. BOTANICAL CORDATE-OVATE + ACUMINATE DRIP-TIP LEAF SILHOUETTE
    // ========================================================================
    float baseRound = pow(clamp(u / 0.12, 0.0, 1.0), 0.42);
    float bodyEnvelope = sin(clamp(u * 0.92 + 0.06, 0.0, 1.0) * 3.14159);
    float mainWidth = mix(baseRound, pow(max(0.0, bodyEnvelope), 0.52), smoothstep(0.04, 0.22, u));
    float tipTaper = 1.0 - smoothstep(0.75, 0.985, u) * 0.93;
    float dripSpike = exp(-pow((u - 0.92) * 9.0, 2.0)) * 0.10;
    float foldAmount = clamp(1.0 - uUnfold, 0.0, 1.0);
    float marginScallop = sin(u * 47.0) * (0.016 + 0.018 * foldAmount) * smoothstep(0.10, 0.85, u);
    float leafMaxV = clamp((mainWidth * tipTaper + dripSpike + marginScallop) * 0.98, 0.0, 0.99);

    // Cordate basal sinus notch right where the petiole stem attaches at (u=0, v=0)
    float basalNotch = 0.045 * exp(-pow(absV * 6.2, 2.0));
    if (u < basalNotch || absV > leafMaxV) {
      discard;
    }
    float marginSoftAlpha = smoothstep(leafMaxV, leafMaxV - 0.022, absV) * smoothstep(basalNotch, basalNotch + 0.015, u);

    // 2. Botanical Venation, Origami Crease Ridges & Cellular Reticulation
    float midribMask = exp(-absV * 28.0);
    float secVeinCoord = u * 7.5 - pow(absV, 1.12) * 2.15;
    float secVeinMask = pow(max(0.0, cos(secVeinCoord * 6.28318)), 10.0) * (1.0 - absV * 0.25);
    float tertVeinNoise = noise(vUv * vec2(52.0, 38.0));
    float tertVeinMask = smoothstep(0.62, 0.88, tertVeinNoise) * 0.32;
    float marginVeinRing = smoothstep(leafMaxV - 0.035, leafMaxV - 0.008, absV) * 0.55;
    float totalVeinMask = clamp(midribMask + secVeinMask * 0.82 + tertVeinMask + marginVeinRing + vOrigamiCrease * 0.72, 0.0, 1.0);

    // Perturb surface normal with fine venation relief + crisp origami facet tilt
    // Note: when uSide > 0.1, pos.x is mirrored in the vertex shader, which reverses triangle winding,
    // so the adaxial (upper, camera-facing) leaf surface has gl_FrontFacing == (uSide <= 0.1)!
    bool isAdaxialSurface = (uSide > 0.1) ? (!gl_FrontFacing) : gl_FrontFacing;
    vec3 n = normalize(vNormal);
    if (!isAdaxialSurface) {
      n = -n;
    }
    float veinSlopeU = -sin(secVeinCoord * 6.28318) * 1.5 + vFacetShade * 0.90;
    float veinSlopeV = -sign(v) * exp(-absV * 24.0) * 1.7 - sign(v) * vFacetShade * 0.95;
    vec3 veinPerturb = normalize(vec3(veinSlopeU, veinSlopeV, 1.0));
    n = normalize(mix(n, veinPerturb, 0.32 + foldAmount * 0.25));

    // 3. Sample Photorealistic Leaf Surface Texture (tropical_leaf.jpg)
    vec3 bioTex = texture2D(uLeafBioTex, vec2(vUv.y, u)).rgb;

    // Rich Chlorophyll Albedo (Front = glossy deep emerald, Back = matte pale sage underside)
    float innerLaminaDepth = smoothstep(0.92, 0.25, absV) * smoothstep(0.05, 0.22, u) * smoothstep(0.95, 0.72, u);
    vec3 upperEmerald = mix(vec3(0.04, 0.24, 0.10), vec3(0.11, 0.42, 0.19), 1.0 - absV * 0.35);
    upperEmerald = mix(upperEmerald, bioTex * 0.84, uHasBioTex * 0.72);
    upperEmerald *= mix(1.0, 0.62, innerLaminaDepth);
    vec3 veinColor = vec3(0.45, 0.92, 0.40);
    vec3 leafAlbedo = mix(upperEmerald, veinColor, (midribMask * 0.75 + secVeinMask * 0.42 + vOrigamiCrease * 0.65) * mix(1.0, 0.52, innerLaminaDepth) + marginVeinRing * 0.55);

    if (!isAdaxialSurface) {
      // Realistic pale-jade matte abaxial (underside) of the folded origami leaf petals!
      leafAlbedo = mix(vec3(0.16, 0.46, 0.25), vec3(0.65, 0.96, 0.56), midribMask * 0.85 + secVeinMask * 0.55 + vOrigamiCrease * 0.62);
    }

    // 4. Physically Inspired Rainforest Lighting + Origami Facet Contrast
    vec3 sunDir = normalize(vec3(0.45, 0.65, 0.62));
    vec3 viewDir = normalize(vViewDir);
    vec3 halfVec = normalize(sunDir + viewDir);

    float NdotL = max(0.0, dot(n, sunDir));
    // Distinct origami mountain/valley facet contrast when folding/unfolding
    float facetLightBoost = clamp(1.0 + vFacetShade * 0.32, 0.68, 1.38);
    float specPower = isAdaxialSurface ? 44.0 : 14.0;
    float specStrength = isAdaxialSurface ? 0.55 : 0.18;
    float specular = pow(max(0.0001, dot(n, halfVec)), specPower) * specStrength * (1.0 - totalVeinMask * 0.25);

    // Fresnel waxy rim sheen
    float fresnel = pow(max(0.0001, 1.0 - max(0.0, dot(n, viewDir))), 3.5);

    // Subsurface Scattering (SSS): warm golden-chartreuse light transmitting through thin leaf margins & origami creases!
    float sssThickness = (1.0 - clamp(midribMask * 0.9 + secVeinMask * 0.6, 0.0, 0.95)) * mix(1.0, 0.42, innerLaminaDepth);
    vec3 sssGlow = vec3(0.38, 0.95, 0.42) * (sssThickness + vOrigamiCrease * 0.45) * (0.26 + 0.34 * (1.0 - NdotL));

    // Morning Dewdrop Specular Micro-Glints near the leaf margins
    vec2 dewCell = floor(vUv * vec2(34.0, 22.0));
    vec2 dewLocal = fract(vUv * vec2(34.0, 22.0)) - vec2(0.5);
    float dewSeed = hash(dewCell);
    float dewDrop = step(0.88, dewSeed) * step(0.58, absV) * smoothstep(0.28, 0.06, length(dewLocal));
    float dewGlint = dewDrop * pow(max(0.0001, dot(normalize(vec3(dewLocal * 3.0, 1.0)), halfVec)), 32.0) * 1.35;

    vec3 litLeaf = leafAlbedo * (0.38 + NdotL * 0.82) * facetLightBoost + sssGlow + vec3(1.0, 0.95, 0.78) * (specular + dewGlint) + vec3(0.35, 0.85, 0.52) * fresnel * 0.25;

    // ========================================================================
    // 5. MAP HTML-IN-CANVAS DOM TEXTURE WITH 3D BOTANICAL EMBOSS & VEIN SHADER
    // ========================================================================
    // Map the DOM content cleanly across the broad central leaf blade (u: 0.12..0.75, vNorm: 0.15..0.85)
    // Because the vertex shader folds the vertices of this surface piece-by-piece, the DOM texture
    // automatically creases, pleats, and blooms open along every diagonal petal hinge!
    float domU = uSide > 0.1 ? (1.0 - u) : u;
    float domStartU = uSide > 0.1 ? 0.24 : 0.14;
    vec2 domUv = vec2(
      (domU - domStartU) / 0.62,
      (vUv.y - 0.16) / 0.68
    );

    if (domUv.x >= 0.0 && domUv.x <= 1.0 && domUv.y >= 0.0 && domUv.y <= 1.0) {
      vec2 sampleUv = vec2(domUv.x, mix(domUv.y, 1.0 - domUv.y, uFlipY));
      vec4 hSample = texture2D(uHtmlTexture, sampleUv);
      vec4 fSample = texture2D(uFallbackTexture, domUv);
      vec4 domSample = uFlipY > 0.5 ? hSample : fSample;

      // Soft organic feathering around the DOM region so it blends seamlessly into the leaf blade
      vec2 edgeFadeVec = smoothstep(vec2(0.0), vec2(0.03), domUv) * (vec2(1.0) - smoothstep(vec2(0.97), vec2(1.0), domUv));
      float domEdgeMask = edgeFadeVec.x * edgeFadeVec.y;
      float alpha = clamp(domSample.a * domEdgeMask, 0.0, 1.0);

      vec3 domColor = uFlipY > 0.5 ? (domSample.rgb / max(0.18, domSample.a)) : domSample.rgb;
      if (isAdaxialSurface) {
        // 3D Botanical Cuticle Emboss & Leaf-Vein Inlay Shader Effect:
        // Compute screen-space gradients of the DOM glyph alpha so every character and button looks
        // physically pressed/etched into the waxy leaf cuticle!
        float dAx = dFdx(alpha);
        float dAy = dFdy(alpha);
        float embossBevel = clamp((-dAx * 0.75 + dAy * 0.85) * 1.9, -0.45, 0.65);

        // Infuse the text pigment with subtle cellular leaf reticulation & secondary vein luminescence
        float bioGrain = 0.90 + 0.10 * tertVeinNoise + secVeinMask * 0.14 + midribMask * 0.10;
        vec3 botanicalTint = mix(vec3(0.90, 1.0, 0.93), vec3(1.0, 0.98, 0.86), secVeinMask * 0.6 + vOrigamiCrease * 0.5);
        vec3 inlaidText = domColor * botanicalTint * bioGrain * (0.86 + NdotL * 0.26) * facetLightBoost;
        inlaidText += vec3(0.75, 1.0, 0.80) * max(0.0, embossBevel) * 0.42;
        inlaidText += vec3(1.0, 0.96, 0.82) * (specular * 0.32 + vOrigamiCrease * 0.28);

        // Darken the leaf cuticle slightly in the recessed groove right around the etched glyphs
        float cuticleRecess = smoothstep(0.02, 0.48, alpha) * (1.0 - smoothstep(0.55, 0.95, alpha));
        vec3 recessedLeaf = litLeaf * (1.0 - cuticleRecess * 0.35 + min(0.0, embossBevel) * 0.38);

        litLeaf = mix(recessedLeaf, inlaidText, alpha);
      } else {
        // Subtle reverse-printed chlorophyll translucency visible through the back of folded petals!
        litLeaf = mix(litLeaf, domColor * vec3(0.48, 0.88, 0.55) * 0.68, alpha * 0.45);
      }
    }

    // ========================================================================
    // 6. PROCEDURAL REALISTIC 3D FIRE & SKELETAL CHARRED REMAINS (LEAF #6)
    // ========================================================================
    if (uBurnProgress > 0.001) {
      vec2 fireUv = vUv * vec2(5.0, 4.0) + vec2(-uTime * 1.9, -uTime * 1.2);
      float nFire = fbm(fireUv);
      // Ignite from drip-tip (u=1) toward petiole base (u=0)
      float distFromTip = (1.0 - u) * 0.82 + absV * 0.25;
      float burnThreshold = uBurnProgress * 1.52 - distFromTip + (nFire - 0.5) * 0.36;

      if (burnThreshold > 0.0) {
        float flameBand = 1.0 - smoothstep(0.0, 0.35, burnThreshold);
        vec3 whiteHot = vec3(1.0, 0.98, 0.82);
        vec3 orangeFlame = vec3(1.0, 0.40, 0.05);
        vec3 crimsonChar = vec3(0.68, 0.07, 0.01);
        vec3 flameCol = mix(crimsonChar, orangeFlame, smoothstep(0.0, 0.5, flameBand));
        flameCol = mix(flameCol, whiteHot, smoothstep(0.55, 1.0, flameBand));

        // Charred carbon & glowing skeletal veins
        vec3 carbonAsh = vec3(0.05, 0.04, 0.04);
        float emberPulse = 0.5 + 0.5 * sin(uTime * 5.2 + nFire * 14.0);
        vec3 veinEmbers = vec3(0.98, 0.30, 0.04) * totalVeinMask * (0.45 + 0.55 * emberPulse);

        // Burn holes through the thin inter-vein tissue near the outer margins while
        // preserving the charred midrib, main veins, and central message area!
        float isOuterLamina = smoothstep(0.58, 0.88, absV) + smoothstep(0.80, 0.96, u);
        if (burnThreshold > 0.40 && isOuterLamina > 0.45 && totalVeinMask < 0.32 && nFire > 0.38) {
          discard;
        }

        vec3 charredSurface = mix(carbonAsh + veinEmbers, litLeaf * 0.72, 0.55);
        litLeaf = mix(charredSurface, flameCol * 1.75, flameBand * (1.0 - step(0.995, uBurnProgress) * 0.82));
      }
    }

    gl_FragColor = vec4(litLeaf, uOpacity * marginSoftAlpha);
  }
`;

// ============================================================================
// 8. LIVE HIGH-DPI DOM-TO-3D-LEAF TEXTURE COMPOSITOR & INTERACTIVE HIT REGIONS
// ============================================================================

const LEAF_TEX_W = 1400;
const LEAF_TEX_H = 960;

// State for interactive leaves
let slothPooCount = 0;
let podDetonations = 0;
let decoyShakes = 14;
let pihaCallTriggered = false;

let explorerNameVal = '';
let explorerEmailVal = '';
let selectedCourier = 'Harpy Eagle Express';
let focusedInputId = null; // 'explorer-name' | 'explorer-email' | null
let newsletterSubmittedMsg = '';
let newsletterErrorMsg = '';

const nameEtchState = {
  text: '',
  active: false,
  completed: false,
  startTimeMs: 0,
  msPerChar: 450,
  letters: [],
  sparks: []
};

const QUIZ_QUESTIONS = [
  {
    prompt: 'Q1: Why do Amazonian macaws flock to riverbanks to eat clay?',
    choices: [
      'Lost a bet with a toucan',
      'Neutralizes seed toxins & adds sodium',
      'Ballast against canopy wind',
      'Polishes their beaks'
    ],
    correctIndex: 1,
    explanation: '✅ Correct! Clay binds toxic seed alkaloids and supplies vital dietary sodium.'
  },
  {
    prompt: 'Q2: What does the Zombie Ant fungus force an ant to do before sprouting?',
    choices: [
      'File colony taxes late',
      'Clamp jaws into a leaf vein 25 cm high',
      'Duel the colony queen',
      'Backstroke the Amazon'
    ],
    correctIndex: 1,
    explanation: '✅ Spot on! It locks the ant’s jaws into a leaf vein right above its foraging trail.'
  },
  {
    prompt: 'Q3: How much water do Amazon trees pump into the sky daily (“Flying Rivers”)?',
    choices: [
      '3 Olympic pools of mist',
      '20 BILLION metric tons per day',
      'Enough to frizz sloth fur',
      '450,000 gallons'
    ],
    correctIndex: 1,
    explanation: '✅ True! 20 billion tons daily—more water than the Amazon River dumps into the sea!'
  }
];
let currentQuizIndex = 0;
const quizUserAnswers = [null, null, null];

let leaf6BurnState = 'intact'; // 'intact' | 'burning' | 'burned'
let leaf6BurnStartTime = 0;
let leaf6BurnCompletedTime = 0;
let leaf6BurnProgress = 0.0;

let activeOrchidCount = 12;
const pledgedSet = new Set();
let finaleStatusMsg = '✨ Click any pledge above to bloom 3D orchids onto the braided vines.';

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  let line = '';
  let curY = y;
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      ctx.fillText(line.trim(), x, curY);
      line = words[i] + ' ';
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line.trim()) {
    ctx.fillText(line.trim(), x, curY);
    curY += lineHeight;
  }
  return curY;
}

function drawLeafButton(ctx, hitRegions, id, label, x, y, w, h, styleKind, hoveredId) {
  const isHovered = hoveredId === id;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 24);

  if (styleKind === 'fire') {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, isHovered ? '#ff5522' : '#dc3511');
    grad.addColorStop(1, isHovered ? '#b82008' : '#8a1404');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#ffca8a';
    ctx.stroke();
  } else if (styleKind === 'gold') {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, isHovered ? '#f0b43a' : '#d49522');
    grad.addColorStop(1, isHovered ? '#ad7212' : '#8f5c0c');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffe89c';
    ctx.stroke();
  } else if (styleKind === 'correct') {
    ctx.fillStyle = 'rgba(26, 132, 64, 0.92)';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#7dffaa';
    ctx.stroke();
  } else if (styleKind === 'wrong') {
    ctx.fillStyle = 'rgba(128, 30, 22, 0.9)';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#ff8575';
    ctx.stroke();
  } else {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, isHovered ? '#2eb85e' : '#1f8f47');
    grad.addColorStop(1, isHovered ? '#166e34' : '#0f4f25');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = isHovered ? '#fff2a6' : '#74ff9e';
    ctx.stroke();
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 23px Inter, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.restore();

  hitRegions.push({ id, x, y, w, h });
}

function renderLiveDOMToLeafCanvas(node, nowMs, hoveredId = null) {
  const ctx = node.fallbackCanvas.getContext('2d');
  const w = LEAF_TEX_W;
  const h = LEAF_TEX_H;
  ctx.clearRect(0, 0, w, h);

  const step = node.step;
  const hitRegions = [];
  node.hitRegions = hitRegions;

  const isCharred = step === 6 && leaf6BurnState === 'burned';

  // Soft organic radial chlorophyll depth (no rectangular box border!)
  const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 40, w * 0.5, h * 0.5, w * 0.50);
  if (isCharred) {
    bgGrad.addColorStop(0, 'rgba(18, 12, 10, 0.78)');
    bgGrad.addColorStop(0.75, 'rgba(12, 8, 7, 0.45)');
    bgGrad.addColorStop(1, 'rgba(8, 5, 5, 0.0)');
  } else {
    bgGrad.addColorStop(0, 'rgba(4, 28, 14, 0.52)');
    bgGrad.addColorStop(0.75, 'rgba(3, 20, 10, 0.28)');
    bgGrad.addColorStop(1, 'rgba(3, 18, 9, 0.0)');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  const padX = 92;
  const contentW = w - padX * 2;

  // Header Badge & Serial
  ctx.fillStyle = isCharred ? '#ffaa88' : '#8affb2';
  ctx.font = 'bold 21px Inter, sans-serif';
  let badgeText = '';
  let serialText = '';

  if (step === 0) {
    badgeText = '🌴 THE RAINFOREST OF INFORMATION • ANIMAL FACT #01';
    serialText = 'PHYLLOBATES TERRIBILIS';
  } else if (step === 1) {
    badgeText = '🌿 LEFT DNA VINE • ANIMAL FACT #02';
    serialText = 'BRADYPUS TRIDACTYLUS';
  } else if (step === 2) {
    badgeText = '🐸 RIGHT DNA VINE • ANIMAL FACT #03';
    serialText = 'HYALINOBATRACHIUM';
  } else if (step === 3) {
    badgeText = '🕷️ LEFT DNA VINE • ANIMAL FACT #04';
    serialText = 'CYCLOSA MULMEINENSIS';
  } else if (step === 4) {
    badgeText = '✨ RIGHT DNA VINE • LUMINOUS LEAF INSCRIPTION';
    serialText = 'WRITE YOUR NAME';
  } else if (step === 5) {
    const score = quizUserAnswers.reduce(
      (acc, ans, idx) => acc + (ans === QUIZ_QUESTIONS[idx].correctIndex ? 1 : 0),
      0
    );
    badgeText = '🎓 LEFT DNA VINE SPROUT • MULTIPLE-CHOICE FIELD EXAM';
    serialText = `SCORE: ${score} / 3 CORRECT`;
  } else if (step === 6) {
    badgeText = isCharred
      ? '🥀 BURNED REMAINS • SCORCHED PETIOLE & COLD ASH'
      : '🔥 RIGHT DNA VINE SPROUT • LEAF #06 • CANOPY IN PERIL';
    serialText = isCharred ? '100% CHARRED' : 'STATUS // LIVING CANOPY';
  } else {
    badgeText = '🧬 CONVERGENCE FINALE • TWIN VINES WEAVE IN THE CENTER';
    serialText = `BLOOMS: ${activeOrchidCount} ACTIVE`;
  }

  ctx.fillText(badgeText, padX, 88);
  ctx.fillStyle = '#f7d574';
  ctx.textAlign = 'right';
  ctx.fillText(serialText, w - padX, 88);
  ctx.textAlign = 'left';

  // Header divider
  ctx.strokeStyle = 'rgba(140, 250, 175, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, 108);
  ctx.lineTo(w - padX, 108);
  ctx.stroke();

  // ==========================================================================
  // RENDER STAGE-SPECIFIC LIVE DOM CONTENT ONTO THE 3D LEAF TEXTURE
  // ==========================================================================

  if (step === 0 || step === 1 || step === 2 || step === 3) {
    const simpleFacts = [
      {
        title: 'Golden Poison Frog',
        fact: 'A single two-inch golden poison dart frog carries enough natural neurotoxin on its skin to take down ten grown humans, yet becomes completely harmless if raised away from its wild rainforest ant diet.'
      },
      {
        title: 'Three-Toed Sloth',
        fact: 'Three-toed sloths climb down from the canopy just once a week to poop, losing up to one-third of their entire body weight in a single sitting so resident fur moths can lay eggs in the dung.'
      },
      {
        title: 'Emerald Glass Frog',
        fact: 'The rainforest glass frog has completely translucent skin on its belly, allowing you to see its tiny heart beating and meals digesting in real time while it sleeps under canopy leaves.'
      },
      {
        title: 'Puppeteer Decoy Spider',
        fact: 'A tiny five-millimeter Peruvian orb-weaver spider sculpts a giant eight-legged decoy spider out of moss and insect husks in its web and shakes the silk strings like a puppet to scare off predators.'
      }
    ];
    const item = simpleFacts[step];
    ctx.fillStyle = '#fffef4';
    ctx.font = 'bold 58px Georgia, serif';
    ctx.fillText(item.title, padX, 290);

    ctx.fillStyle = '#f2fff5';
    ctx.font = '36px Inter, sans-serif';
    wrapCanvasText(ctx, item.fact, padX, 378, contentW, 56);
  } else if (step === 4) {
    // LEAF #4: WRITE YOUR NAME ON THE LEAF (STROKE-BY-STROKE LIGHT ETCHING)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px Georgia, serif';
    ctx.fillText('Write Your Name on the Leaf', padX, 170);

    ctx.fillStyle = '#d9fce3';
    ctx.font = '23px Inter, sans-serif';
    ctx.fillText(
      'Type your name below and press Submit to etch it stroke-by-stroke in living light:',
      padX,
      216
    );

    const caretBlink = Math.floor(nowMs / 500) % 2 === 0 ? '|' : '';
    const nameBoxX = padX;
    const nameBoxY = 242;
    const btnW = 300;
    const inputW = contentW - btnW - 24;
    const isNameFocused = focusedInputId === 'explorer-name';

    ctx.fillStyle = 'rgba(3, 24, 12, 0.78)';
    ctx.strokeStyle = isNameFocused ? '#f7d574' : 'rgba(130, 245, 165, 0.55)';
    ctx.lineWidth = isNameFocused ? 4 : 2.5;
    ctx.beginPath();
    ctx.roundRect(nameBoxX, nameBoxY, inputW, 68, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = explorerNameVal ? '#ffffff' : 'rgba(180, 220, 192, 0.55)';
    ctx.font = '26px Inter, sans-serif';
    const dispName = explorerNameVal
      ? explorerNameVal + (isNameFocused ? caretBlink : '')
      : isNameFocused
        ? caretBlink
        : 'Write your name on the leaf...';
    ctx.fillText(dispName, nameBoxX + 22, nameBoxY + 42);
    hitRegions.push({ id: 'input-explorer-name', x: nameBoxX, y: nameBoxY, w: inputW, h: 68 });

    drawLeafButton(
      ctx,
      hitRegions,
      'btn-newsletter-submit',
      '✨ Write on Leaf',
      nameBoxX + inputW + 24,
      nameBoxY,
      btnW,
      68,
      'gold',
      hoveredId
    );

    // Etching stage box
    const stageY = 345;
    const stageH = 380;
    ctx.fillStyle = 'rgba(4, 28, 14, 0.58)';
    ctx.strokeStyle = 'rgba(145, 255, 180, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(padX, stageY, contentW, stageH, 24);
    ctx.fill();
    ctx.stroke();

    if (nameEtchState.text) {
      const targetStr = nameEtchState.text;
      const elapsed = nowMs - nameEtchState.startTimeMs;
      const fSize = targetStr.length > 16 ? 78 : targetStr.length > 11 ? 92 : 108;
      ctx.font = `bold ${fSize}px Georgia, serif`;
      const totalW = ctx.measureText(targetStr).width + (targetStr.length - 1) * 8;
      let curX = padX + (contentW - totalW) * 0.5;
      const baseY = stageY + 215;

      for (let i = 0; i < targetStr.length; i++) {
        const ch = targetStr[i];
        const chW = ctx.measureText(ch).width;
        const charStart = i * nameEtchState.msPerChar;
        const tLocal = Math.max(0, Math.min(1, (elapsed - charStart) / nameEtchState.msPerChar));

        if (tLocal > 0) {
          ctx.save();
          ctx.font = `bold ${fSize}px Georgia, serif`;
          ctx.strokeStyle = '#fffef0';
          ctx.lineWidth = 4;
          ctx.setLineDash([400]);
          ctx.lineDashOffset = (1 - tLocal) * 400;
          ctx.strokeText(ch, curX, baseY);

          if (tLocal > 0.45) {
            ctx.globalAlpha = (tLocal - 0.45) / 0.55;
            ctx.fillStyle = '#ffe885';
            ctx.fillText(ch, curX, baseY);
          }
          ctx.restore();
        }
        curX += chW + 8;
      }
    }

    ctx.fillStyle = '#ffe89e';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      newsletterSubmittedMsg ||
        newsletterErrorMsg ||
        'Submit your name above to watch light trace each letter into the leaf blade.',
      padX + contentW * 0.5,
      stageY + stageH - 36
    );
    ctx.textAlign = 'left';
  } else if (step === 5) {
    // LEAF #5: MULTIPLE-CHOICE RAINFOREST EXAM ON THE 3D LEAF
    const q = QUIZ_QUESTIONS[currentQuizIndex];
    const chosen = quizUserAnswers[currentQuizIndex];

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px Georgia, serif';
    ctx.fillText('Rainforest Survival & Weirdness Exam', padX, 162);

    // Question Tabs (Q1, Q2, Q3)
    const tabLabels = ['Q1: Clay Licks', 'Q2: Zombie Ants', 'Q3: Flying Rivers'];
    tabLabels.forEach((tLabel, idx) => {
      const tx = w - padX - (3 - idx) * 185;
      const ty = 124;
      const isCur = idx === currentQuizIndex;
      drawLeafButton(
        ctx,
        hitRegions,
        `quiz-tab-${idx}`,
        tLabel,
        tx,
        ty,
        175,
        48,
        isCur ? 'gold' : 'emerald',
        hoveredId
      );
    });

    ctx.fillStyle = '#fff5c8';
    ctx.font = 'bold 25px Inter, sans-serif';
    wrapCanvasText(ctx, q.prompt, padX, 224, contentW, 34);

    // 4 Clickable Multiple-Choice Option Buttons in a 2x2 Grid
    const letters = ['A', 'B', 'C', 'D'];
    const cW = (contentW - 28) / 2;
    const cH = 118;
    q.choices.forEach((choiceText, cIdx) => {
      const col = cIdx % 2;
      const row = Math.floor(cIdx / 2);
      const cx = padX + col * (cW + 28);
      const cy = 285 + row * (cH + 20);

      let style = 'emerald';
      if (chosen !== null) {
        if (cIdx === q.correctIndex) style = 'correct';
        else if (cIdx === chosen) style = 'wrong';
      }

      const isHov = hoveredId === `quiz-choice-${cIdx}`;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(cx, cy, cW, cH, 18);
      if (style === 'correct') {
        ctx.fillStyle = 'rgba(24, 128, 60, 0.94)';
        ctx.strokeStyle = '#7dffaa';
      } else if (style === 'wrong') {
        ctx.fillStyle = 'rgba(128, 28, 22, 0.92)';
        ctx.strokeStyle = '#ff8575';
      } else {
        ctx.fillStyle = isHov ? 'rgba(26, 92, 48, 0.92)' : 'rgba(5, 28, 15, 0.85)';
        ctx.strokeStyle = isHov ? '#f7d574' : 'rgba(120, 245, 160, 0.48)';
      }
      ctx.lineWidth = 3;
      ctx.fill();
      ctx.stroke();

      // Letter badge
      ctx.fillStyle = '#f7d574';
      ctx.font = 'bold 24px Inter, sans-serif';
      ctx.fillText(`${letters[cIdx]}.`, cx + 20, cy + 40);

      ctx.fillStyle = '#ffffff';
      ctx.font = '21px Inter, sans-serif';
      wrapCanvasText(ctx, choiceText, cx + 56, cy + 38, cW - 72, 28);
      ctx.restore();

      hitRegions.push({ id: `quiz-choice-${cIdx}`, choiceIdx: cIdx, x: cx, y: cy, w: cW, h: cH });
    });

    // Explanation Banner
    ctx.fillStyle = 'rgba(3, 18, 9, 0.86)';
    ctx.strokeStyle = 'rgba(247, 213, 116, 0.48)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(padX, 576, contentW, 92, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#d4ffe4';
    ctx.font = 'bold 21px Inter, sans-serif';
    const expMsg =
      chosen === null
        ? '👆 Click answer choice A, B, C, or D directly on this 3D leaf to test your instincts!'
        : chosen === q.correctIndex
          ? q.explanation
          : `💡 Not quite! ${q.explanation.replace('✅ Correct! ', '').replace('✅ Spot on! ', '').replace('✅ Incredible but true! ', '')}`;
    wrapCanvasText(ctx, expMsg, padX + 22, 614, contentW - 44, 28);

    const nextQ = ((currentQuizIndex + 1) % 3) + 1;
    drawLeafButton(
      ctx,
      hitRegions,
      'btn-quiz-next',
      `Next Question (Q${nextQ}) ▶`,
      padX,
      h - 130,
      340,
      62,
      'emerald',
      hoveredId
    );
    drawLeafButton(
      ctx,
      hitRegions,
      'btn-quiz-reset',
      '↺ Reset Exam',
      padX + 360,
      h - 130,
      240,
      62,
      'gold',
      hoveredId
    );
    drawLeafButton(
      ctx,
      hitRegions,
      'jump-6',
      'Next Leaf ▼',
      w - padX - 260,
      h - 130,
      260,
      62,
      'emerald',
      hoveredId
    );
  } else if (step === 6) {
    // LEAF #6: THE BURNING RAINFOREST LEAF & PERSISTENT CHARRED REMAINS
    if (!isCharred) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 42px Georgia, serif';
      ctx.fillText('What Took 10 Million Years Turns to Ash in Seconds', padX, 166);

      ctx.fillStyle = '#effcf3';
      ctx.font = '24px Inter, sans-serif';
      let curY = wrapCanvasText(
        ctx,
        'Every single minute, an area of primary tropical rainforest the size of 18 football fields is slashed and burned. Unlike dry savannas, the humid tropical rainforest never evolved to survive fire. Its bark is paper-thin and its nutrient cycle lives inside the living canopy.',
        padX,
        228,
        contentW,
        36
      );
      curY = wrapCanvasText(
        ctx,
        'When fires sweep through the Amazon, the sloth’s canopy gardens, the decoy spider’s silk sculptures, and uncatalogued medicinal plants vanish together in seconds—leaving blackened earth that takes centuries to heal.',
        padX,
        curY + 18,
        contentW,
        36
      );

      // Fire Warning Box
      ctx.fillStyle = 'rgba(48, 12, 6, 0.85)';
      ctx.strokeStyle = '#ff7b47';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(padX, 515, contentW, 152, 22);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffb596';
      ctx.font = 'bold 25px Inter, sans-serif';
      ctx.fillText('🔥 Witness the Irreversible Cost of Canopy Fire', padX + 26, 562);
      ctx.fillStyle = '#ffe6dc';
      ctx.font = '22px Inter, sans-serif';
      wrapCanvasText(
        ctx,
        'Pressing Ignite below sets this 3D leaf ablaze in real time. When you scroll away and scroll back to this leaf later, only the burned-off remains will be waiting.',
        padX + 26,
        600,
        contentW - 52,
        30
      );

      drawLeafButton(
        ctx,
        hitRegions,
        'btn-ignite-leaf',
        leaf6BurnState === 'burning'
          ? '🔥 Canopy Ignited — Consuming Leaf...'
          : '🔥 Ignite This Leaf (Burn in 3D)',
        padX,
        h - 135,
        540,
        66,
        'fire',
        hoveredId
      );
      drawLeafButton(
        ctx,
        hitRegions,
        'jump-7',
        'Braided Finale ▼',
        w - padX - 300,
        h - 135,
        300,
        66,
        'gold',
        hoveredId
      );
    } else {
      // PERSISTENT CHARRED SKELETAL REMAINS STATE WHEN USER STAYS OR SCROLLS BACK!
      ctx.fillStyle = '#ffd6c4';
      ctx.font = 'bold 44px Georgia, serif';
      ctx.fillText('Only Blackened Veins and Silent Ash Remain', padX, 166);

      ctx.fillStyle = 'rgba(32, 16, 12, 0.85)';
      ctx.fillRect(padX, 192, contentW, 92);
      ctx.fillStyle = '#ff6a2b';
      ctx.fillRect(padX, 192, 7, 92);
      ctx.fillStyle = '#ffded0';
      ctx.font = 'italic 24px Georgia, serif';
      wrapCanvasText(
        ctx,
        '“It took less than four seconds for the flames to consume this leaf. Yet no matter how many times you scroll away and return, the forest cannot simply snap back.”',
        padX + 24,
        230,
        contentW - 44,
        34
      );

      ctx.fillStyle = '#f2dcd4';
      ctx.font = '24px Inter, sans-serif';
      let curY = wrapCanvasText(
        ctx,
        'What you see left on this vine is the haunting reality of primary rainforest loss. Once a tropical canopy is burned to ash, torrential rains wash away the thin topsoil and local rainfall collapses.',
        padX,
        330,
        contentW,
        35
      );
      curY = wrapCanvasText(
        ctx,
        'Botanists estimate it takes 200 to 500 years for a burned primary rainforest to recover its original canopy structure—and extinct endemic species never return at all.',
        padX,
        curY + 14,
        contentW,
        35
      );

      const sinceBurnSec = Math.max(1, Math.floor((nowMs - leaf6BurnCompletedTime) * 0.001));
      ctx.fillStyle = 'rgba(28, 14, 11, 0.88)';
      ctx.strokeStyle = 'rgba(255, 110, 55, 0.55)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(padX, 565, contentW, 115, 20);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffaa80';
      ctx.font = 'bold 24px Inter, sans-serif';
      ctx.fillText('⏳ Estimated Natural Canopy Regrowth Time: ~250 Years', padX + 26, 610);
      ctx.fillStyle = '#f5cfc0';
      ctx.font = '21px ui-monospace, monospace';
      ctx.fillText(
        `Time elapsed since this leaf burned: ${sinceBurnSec}s • Recovery progress: 0.000001%`,
        padX + 26,
        652
      );

      drawLeafButton(
        ctx,
        hitRegions,
        'btn-fastforward-regrowth',
        '🌱 Fast-Forward 250 Years (Regrow Leaf)',
        padX,
        h - 130,
        490,
        62,
        'emerald',
        hoveredId
      );
      drawLeafButton(
        ctx,
        hitRegions,
        'jump-7',
        'See How to Protect It ▼',
        w - padX - 350,
        h - 130,
        350,
        62,
        'gold',
        hoveredId
      );
    }
  } else if (step === 7) {
    // STAGE 7 FINALE: BRAIDED VINES & CONSERVATION PLEDGES ON THE 3D LEAF
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 42px Georgia, serif';
    ctx.fillText('Intertwined for Survival: Protect the Rainforest', padX, 162);

    ctx.fillStyle = '#e2fced';
    ctx.font = '22px Inter, sans-serif';
    wrapCanvasText(
      ctx,
      'Look above this leaf: the Left and Right DNA liana vines have grown together in the center, weaving their living tendrils into “PROTECT THE RAINFOREST”. Click any pledge below to bloom 3D orchids:',
      padX,
      204,
      contentW,
      32
    );

    const pillars = [
      {
        id: 'pledge-indigenous',
        kind: 'indigenous',
        title: '🛡️ 1. Indigenous Stewardship',
        desc: 'Indigenous lands have 80% lower deforestation. Back frontline guardians like Amazon Watch.',
        btn: '🌺 Pledge: Indigenous Rights'
      },
      {
        id: 'pledge-reserve',
        kind: 'reserve',
        title: '🌳 2. Lock In Reserves',
        desc: 'Groups like Rainforest Trust & Cool Earth legally title threatened primary corridors.',
        btn: '🌺 Pledge: Sponsor Canopy'
      },
      {
        id: 'pledge-supply',
        kind: 'supply',
        title: '🔍 3. Deforestation-Free',
        desc: 'Choose FSC timber, shade-grown cacao/coffee, and verified deforestation-free goods.',
        btn: '🌺 Pledge: Audit Footprint'
      }
    ];

    const pW = (contentW - 36) / 3;
    pillars.forEach((p, idx) => {
      const px = padX + idx * (pW + 18);
      const py = 285;
      ctx.fillStyle = 'rgba(4, 24, 12, 0.82)';
      ctx.strokeStyle = pledgedSet.has(p.kind) ? '#f7d574' : 'rgba(120, 245, 160, 0.42)';
      ctx.lineWidth = pledgedSet.has(p.kind) ? 3.5 : 2;
      ctx.beginPath();
      ctx.roundRect(px, py, pW, 275, 20);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f7d574';
      ctx.font = 'bold 22px Inter, sans-serif';
      ctx.fillText(p.title, px + 18, py + 40);

      ctx.fillStyle = '#e6faee';
      ctx.font = '20px Inter, sans-serif';
      wrapCanvasText(ctx, p.desc, px + 18, py + 78, pW - 36, 28);

      drawLeafButton(
        ctx,
        hitRegions,
        p.id,
        pledgedSet.has(p.kind) ? '✅ Pledged & Blooming!' : p.btn,
        px + 16,
        py + 198,
        pW - 32,
        58,
        pledgedSet.has(p.kind) ? 'gold' : 'emerald',
        hoveredId
      );
    });

    // Status Banner
    ctx.fillStyle = 'rgba(6, 32, 17, 0.88)';
    ctx.strokeStyle = '#f7d574';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(padX, 586, contentW, 68, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff3be';
    ctx.font = 'bold 21px Inter, sans-serif';
    ctx.fillText(finaleStatusMsg, padX + 24, 628);

    drawLeafButton(
      ctx,
      hitRegions,
      'btn-bloom-all',
      '🌸 Bloom Full Canopy of Hope',
      padX,
      h - 130,
      460,
      62,
      'gold',
      hoveredId
    );
    drawLeafButton(
      ctx,
      hitRegions,
      'jump-0',
      '▲ Ascend Back to Crown (Top)',
      w - padX - 380,
      h - 130,
      380,
      62,
      'emerald',
      hoveredId
    );
  }

  node.fallbackTexture.needsUpdate = true;
}

// ============================================================================
// 9. CREATE THE 8 SPROUTING 3D SCULPTED LEAVES & TAPERED 3D PETIOLES
// ============================================================================

const leavesGroup = new THREE.Group();
scene.add(leavesGroup);

const leafNodes = [];

STAGE_METADATA.forEach((meta, idx) => {
  const domCard = leafCards[idx];
  const stepY = -idx * STEP_SPACING_Y;
  const side = meta.side; // -1 = Left Vine, +1 = Right Vine, 0 = Center

  const nodeGroup = new THREE.Group();
  nodeGroup.position.set(0, stepY, 0);
  leavesGroup.add(nodeGroup);

  // 1. Curved 3D Petiole Stalk growing from the Left or Right DNA Vine into the Leaf Base
  let petioleMesh = null;
  if (side !== 0) {
    const vineAttachPt = getVineStrandPoint(side, 0, stepY);
    const localStart = new THREE.Vector3(vineAttachPt.x, -0.45, vineAttachPt.z);
    const localMid = new THREE.Vector3(side * 3.7, -0.15, 0.55);
    const localEnd = new THREE.Vector3(side * 2.95, 0.0, 1.35);

    const petioleCurve = new THREE.CatmullRomCurve3([localStart, localMid, localEnd]);
    const petioleGeo = createGnarledLianaGeometry(petioleCurve, 0.105, 28, 12, idx * 4.1);
    petioleMesh = new THREE.Mesh(petioleGeo, petioleStemMat);
    petioleMesh.castShadow = true;
    petioleMesh.receiveShadow = true;
    nodeGroup.add(petioleMesh);

    // Pulvinus swelling at the vine attachment node
    const pulvinus = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 14),
      secondaryMossVineMat
    );
    pulvinus.position.copy(localStart);
    pulvinus.scale.set(1.2, 0.85, 1.1);
    nodeGroup.add(pulvinus);
  }

  // 2. High-DPI Texture for the 3D Leaf Blade
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = LEAF_TEX_W;
  fallbackCanvas.height = LEAF_TEX_H;

  const fallbackTexture = new THREE.CanvasTexture(fallbackCanvas);
  fallbackTexture.colorSpace = THREE.SRGBColorSpace;
  fallbackTexture.anisotropy = maxAniso;

  const nativeGLTexture = gl.createTexture();
  const nativeThreeTexture = new THREE.Texture();
  nativeThreeTexture.colorSpace = THREE.SRGBColorSpace;
  const textureState = { width: 0, height: 0 };

  const leafShaderMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    extensions: {
      derivatives: true
    },
    uniforms: {
      uHtmlTexture: { value: fallbackTexture },
      uFallbackTexture: { value: fallbackTexture },
      uLeafBioTex: { value: fallbackTexture },
      uHasBioTex: { value: 0.0 },
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uUnfold: { value: idx === 0 ? 1.0 : 0.0 },
      uFoldDir: { value: -1.0 },
      uSide: { value: side },
      uFlipY: { value: 0.0 },
      uBurnProgress: { value: 0.0 },
      uPointer: { value: new THREE.Vector2(0.5, 0.5) }
    },
    vertexShader: leafVertexShader,
    fragmentShader: leafFragmentShader
  });

  const leafMesh = new THREE.Mesh(sharedSculptedLeafGeo, leafShaderMat);
  leafMesh.position.set(0, 0, 1.45);
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;
  nodeGroup.add(leafMesh);

  const nodeObj = {
    step: idx,
    side,
    stepY,
    domCard,
    nodeGroup,
    petioleMesh,
    leafMesh,
    leafShaderMat,
    fallbackCanvas,
    fallbackTexture,
    nativeGLTexture,
    nativeThreeTexture,
    textureState,
    hitRegions: []
  };

  renderLiveDOMToLeafCanvas(nodeObj, 0, null);
  leafNodes.push(nodeObj);
});

texLoader.load('./assets/tropical_leaf.jpg', (leafBioTex) => {
  leafBioTex.colorSpace = THREE.SRGBColorSpace;
  leafBioTex.anisotropy = maxAniso;
  epiphyteFernMat.map = leafBioTex;
  epiphyteFernMat.color.setHex(0xffffff);
  epiphyteFernMat.needsUpdate = true;
  leafNodes.forEach((node) => {
    node.leafShaderMat.uniforms.uLeafBioTex.value = leafBioTex;
    node.leafShaderMat.uniforms.uHasBioTex.value = 1.0;
  });
});

// ============================================================================
// 10. VOLUMETRIC CANOPY SUNBEAMS & ATMOSPHERIC POLLEN / FIREFLY PARTICLES
// ============================================================================

const sunbeamsGroup = new THREE.Group();
cameraLightRig.add(sunbeamsGroup);

const sunbeamMat = new THREE.MeshBasicMaterial({
  color: 0xc4ffd2,
  transparent: true,
  opacity: 0.038,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide
});

for (let b = 0; b < 5; b++) {
  const beamGeo = new THREE.ConeGeometry(1.9 + b * 0.4, 24, 16, 1, true);
  const beam = new THREE.Mesh(beamGeo, sunbeamMat);
  beam.position.set((b - 2) * 2.8, 3.8, -2.8 - b * 0.6);
  beam.rotation.z = -0.34 + b * 0.05;
  sunbeamsGroup.add(beam);
}

const sporeCount = 680;
const sporeGeo = new THREE.BufferGeometry();
const sporePositions = new Float32Array(sporeCount * 3);
const sporeScales = new Float32Array(sporeCount);
const sporeKinds = new Float32Array(sporeCount);

for (let i = 0; i < sporeCount; i++) {
  sporePositions[i * 3] = (Math.random() - 0.5) * 16;
  sporePositions[i * 3 + 1] = Math.random() * 86 - 72;
  sporePositions[i * 3 + 2] = (Math.random() - 0.5) * 10;
  sporeScales[i] = 0.5 + Math.random() * 1.6;
  sporeKinds[i] = Math.random() > 0.45 ? 1.0 : 0.0;
}
sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePositions, 3));
sporeGeo.setAttribute('aScale', new THREE.BufferAttribute(sporeScales, 1));
sporeGeo.setAttribute('aKind', new THREE.BufferAttribute(sporeKinds, 1));

const sporeShaderMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uSporeBoost: { value: 1.0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
  },
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uSporeBoost;
    uniform float uPixelRatio;
    attribute float aScale;
    attribute float aKind;
    varying float vKind;
    varying float vAlpha;

    void main() {
      vKind = aKind;
      vec3 pos = position;
      pos.x += sin(uTime * 0.7 + position.y * 0.4) * 0.45;
      pos.y += cos(uTime * 0.5 + position.x * 0.5) * 0.35;
      pos.z += sin(uTime * 0.9 + aScale * 4.0) * 0.25;

      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = (22.0 * aScale * uSporeBoost * uPixelRatio) / max(1.0, -mvPosition.z);
      vAlpha = 0.45 + 0.55 * sin(uTime * 3.0 + aScale * 9.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vKind;
    varying float vAlpha;

    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      float glow = smoothstep(0.5, 0.04, d);
      vec3 goldSpore = vec3(1.0, 0.88, 0.42);
      vec3 bioGreen = vec3(0.38, 1.0, 0.62);
      vec3 col = mix(goldSpore, bioGreen, vKind);
      gl_FragColor = vec4(col, glow * vAlpha * 0.85);
    }
  `
});

const rainforestSpores = new THREE.Points(sporeGeo, sporeShaderMat);
scene.add(rainforestSpores);

// Dedicated 3D Fire & Rising Ash Ember Particle System for Leaf #6
const fireParticleCount = 280;
const fireParticleGeo = new THREE.BufferGeometry();
const fireOffsets = new Float32Array(fireParticleCount * 3);
const fireSpeeds = new Float32Array(fireParticleCount);

for (let i = 0; i < fireParticleCount; i++) {
  fireOffsets[i * 3] = (Math.random() - 0.5) * 5.6;
  fireOffsets[i * 3 + 1] = Math.random() * 3.2 - 1.4;
  fireOffsets[i * 3 + 2] = 1.5 + (Math.random() - 0.5) * 0.8;
  fireSpeeds[i] = 0.6 + Math.random() * 1.4;
}
fireParticleGeo.setAttribute('position', new THREE.BufferAttribute(fireOffsets, 3));
fireParticleGeo.setAttribute('aSpeed', new THREE.BufferAttribute(fireSpeeds, 1));

const fireParticleMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uIntensity: { value: 0.0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
  },
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uIntensity;
    uniform float uPixelRatio;
    attribute float aSpeed;
    varying float vLife;

    void main() {
      vec3 pos = position;
      float cycle = fract(uTime * aSpeed * 0.55 + position.x * 0.37);
      vLife = cycle;
      pos.y += cycle * 3.8;
      pos.x += sin(uTime * 3.5 + cycle * 6.0) * 0.32;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = (36.0 * (1.0 - cycle * 0.65) * uIntensity * uPixelRatio) / max(1.0, -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uIntensity;
    varying float vLife;

    void main() {
      if (uIntensity < 0.01) discard;
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      float core = smoothstep(0.5, 0.05, d);
      vec3 hotCol = mix(vec3(1.0, 0.92, 0.45), vec3(1.0, 0.25, 0.04), vLife);
      gl_FragColor = vec4(hotCol, core * (1.0 - vLife) * uIntensity);
    }
  `
});

const fireParticleSystem = new THREE.Points(fireParticleGeo, fireParticleMat);
fireParticleSystem.position.set(0, -6 * STEP_SPACING_Y, 0);
scene.add(fireParticleSystem);

// ============================================================================
// 11. RESIZE OBSERVER (MANDATORY PER MODERN WEB GUIDANCE)
// ============================================================================

const resizeObserver = new ResizeObserver(([entry]) => {
  const dpc = entry.devicePixelContentBoxSize;
  const pixelW = dpc
    ? dpc[0].inlineSize
    : Math.round(entry.contentRect.width * window.devicePixelRatio);
  const pixelH = dpc
    ? dpc[0].blockSize
    : Math.round(entry.contentRect.height * window.devicePixelRatio);

  canvas.width = pixelW;
  canvas.height = pixelH;

  if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
    camera.aspect = entry.contentRect.width / entry.contentRect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(pixelW, pixelH, false);
  }

  if (typeof canvas.requestPaint === 'function') {
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
// 12. INTERACTIVE ACTIONS, FORM VALIDATION, QUIZ, FIRE & 3D RAYCASTER HIT-TESTING
// ============================================================================

let sporeBoostUntil = 0;
let hoveredHitId = null;

function triggerSporeBurst() {
  sporeBoostUntil = performance.now() + 2200;
  if (typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
}

function scrollToStep(stepNumber) {
  const clamped = Math.max(0, Math.min(TOTAL_STEPS, stepNumber));
  const targetSection = document.getElementById(`step-${clamped}`);
  if (targetSection) {
    targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Masks email address per `mandatory-secure-web-skills` PII Masking rule
function maskEmailAddress(rawEmail) {
  const trimmed = String(rawEmail || '').trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 1) return '***@canopy.org';
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  return `${local[0]}***${local.slice(-1)}@${domain}`;
}

const domNameInput = document.getElementById('explorer-name');
const domEmailInput = document.getElementById('explorer-email');
const newsletterForm = document.getElementById('newsletter-form');
const etchLettersGroup = document.getElementById('etch-letters-group');
const etchLightBeamGroup = document.getElementById('etch-light-beam-group');
const etchSparksGroup = document.getElementById('etch-sparks-group');
const etchFlareOuter = document.getElementById('etch-flare-outer');
const etchRayH = document.getElementById('etch-ray-h');
const etchRayV = document.getElementById('etch-ray-v');
const nameEtchStatusPill = document.getElementById('name-etch-status');

const SVG_NS = 'http://www.w3.org/2000/svg';
const _etchMeasureCanvas = document.createElement('canvas');
const _etchMeasureCtx = _etchMeasureCanvas.getContext('2d');

/**
 * Generates 3 directional stroke segments across a character's glyph box `[x .. x+w, y-capH .. y]`
 * so the glowing light beam visibly traces the vertical stem, crossbar, and curves of each letter
 * stroke-for-stroke while the SVG stroke-dashoffset reveals the glyph!
 */
function buildCharacterStrokes(ch, x, baseY, w, capH) {
  const topY = baseY - capH * 0.84;
  const midY = baseY - capH * 0.42;
  const botY = baseY - capH * 0.04;
  const leftX = x + w * 0.16;
  const midX = x + w * 0.50;
  const rightX = x + w * 0.84;

  const upper = ch.toUpperCase();
  if ('I1LJT'.includes(upper)) {
    return [
      { x1: leftX, y1: topY, x2: rightX, y2: topY },
      { x1: midX, y1: topY, x2: midX, y2: botY },
      { x1: leftX, y1: botY, x2: rightX, y2: botY }
    ];
  }
  if ('O0QCGU'.includes(upper)) {
    return [
      { x1: midX, y1: topY, x2: leftX, y2: midY },
      { x1: leftX, y1: midY, x2: midX, y2: botY },
      { x1: midX, y1: botY, x2: rightX, y2: topY }
    ];
  }
  if ('AVWXYMZN'.includes(upper)) {
    return [
      { x1: leftX, y1: botY, x2: midX, y2: topY },
      { x1: midX, y1: topY, x2: rightX, y2: botY },
      { x1: leftX, y1: midY, x2: rightX, y2: midY }
    ];
  }
  // Default 3-stroke calligraphic pattern (vertical stem -> upper curve/bar -> lower diagonal/bar)
  return [
    { x1: leftX, y1: topY, x2: leftX, y2: botY },
    { x1: leftX, y1: topY, x2: rightX, y2: midY },
    { x1: leftX, y1: midY, x2: rightX, y2: botY }
  ];
}

function startNameInscription(rawName) {
  const cleanName = String(rawName || '').trim().slice(0, 24);
  const fb = document.getElementById('newsletter-feedback');

  if (!cleanName) {
    newsletterSubmittedMsg = '';
    newsletterErrorMsg = '⚠️ Type your name in the box above first, then click Write on Leaf!';
    if (fb) fb.textContent = newsletterErrorMsg;
    focusedInputId = 'explorer-name';
    domNameInput?.focus();
    requestActiveLeafRepaint();
    return;
  }

  newsletterErrorMsg = '';
  explorerNameVal = cleanName;
  if (domNameInput && domNameInput.value !== cleanName) {
    domNameInput.value = cleanName;
  }

  nameEtchState.text = cleanName;
  nameEtchState.startTimeMs = performance.now();
  nameEtchState.active = true;
  nameEtchState.completed = false;
  nameEtchState.msPerChar = Math.max(260, Math.min(460, Math.round(3800 / Math.max(4, cleanName.length))));
  nameEtchState.letters = [];
  nameEtchState.sparks = [];

  if (etchLettersGroup) {
    etchLettersGroup.replaceChildren();
  }
  if (etchSparksGroup) {
    etchSparksGroup.replaceChildren();
  }

  const fontSize = cleanName.length > 16 ? 38 : cleanName.length > 11 ? 46 : 56;
  const letterGap = cleanName.length > 14 ? 3 : 5;
  _etchMeasureCtx.font = `bold ${fontSize}px Georgia, 'Times New Roman', serif`;

  const charWidths = Array.from(cleanName).map((ch) =>
    ch === ' ' ? fontSize * 0.34 : Math.max(fontSize * 0.32, _etchMeasureCtx.measureText(ch).width)
  );
  const totalWidth =
    charWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, cleanName.length - 1) * letterGap;

  let cursorX = Math.max(24, (590 - totalWidth) * 0.5);
  const baseY = 86;

  // Create reusable spark circle nodes inside `#etch-sparks-group`
  const sparkEls = [];
  if (etchSparksGroup) {
    for (let s = 0; s < 10; s++) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('r', s % 2 === 0 ? '2.6' : '1.8');
      c.setAttribute('fill', s % 3 === 0 ? '#64ff9e' : '#fff6a8');
      c.setAttribute('opacity', '0');
      etchSparksGroup.appendChild(c);
      sparkEls.push(c);
    }
  }
  nameEtchState.sparkEls = sparkEls;

  Array.from(cleanName).forEach((ch, idx) => {
    const chW = charWidths[idx];
    const g = document.createElementNS(SVG_NS, 'g');

    const createGlyphLayer = (stroke, strokeWidth, fill, dash) => {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', cursorX.toFixed(1));
      t.setAttribute('y', String(baseY));
      t.setAttribute('font-family', "Georgia, 'Times New Roman', serif");
      t.setAttribute('font-size', String(fontSize));
      t.setAttribute('font-weight', '700');
      t.setAttribute('fill', fill);
      if (stroke) {
        t.setAttribute('stroke', stroke);
        t.setAttribute('stroke-width', String(strokeWidth));
        t.setAttribute('stroke-linecap', 'round');
        t.setAttribute('stroke-linejoin', 'round');
      }
      if (dash) {
        t.setAttribute('stroke-dasharray', String(dash));
        t.setAttribute('stroke-dashoffset', String(dash));
      }
      t.textContent = ch;
      return t;
    };

    const dashLen = 290;
    const grooveEl = createGlyphLayer('rgba(1, 15, 7, 0.92)', 5.2, 'none', dashLen);
    const glowEl = createGlyphLayer('#58ff9c', 5.8, 'none', dashLen);
    glowEl.setAttribute('opacity', '0');
    const strokeEl = createGlyphLayer('#fffef2', 2.4, 'none', dashLen);
    const fillEl = createGlyphLayer(null, 0, 'url(#etch-gold-grad)', 0);
    fillEl.setAttribute('opacity', '0');

    // Active stroke-guide laser path that traces the 3 directional strokes of the letter
    const guidePathEl = document.createElementNS(SVG_NS, 'path');
    guidePathEl.setAttribute('fill', 'none');
    guidePathEl.setAttribute('stroke', '#fff8a6');
    guidePathEl.setAttribute('stroke-width', '2.8');
    guidePathEl.setAttribute('stroke-linecap', 'round');
    guidePathEl.setAttribute('opacity', '0');

    g.appendChild(grooveEl);
    g.appendChild(glowEl);
    g.appendChild(fillEl);
    g.appendChild(strokeEl);
    g.appendChild(guidePathEl);
    etchLettersGroup?.appendChild(g);

    const strokes = buildCharacterStrokes(ch, cursorX, baseY, chW, fontSize);

    nameEtchState.letters.push({
      char: ch,
      x: cursorX,
      y: baseY,
      width: chW,
      fontSize,
      dashLen,
      grooveEl,
      glowEl,
      strokeEl,
      fillEl,
      guidePathEl,
      strokes
    });

    cursorX += chW + letterGap;
  });

  if (nameEtchStatusPill) {
    nameEtchStatusPill.textContent = '✨ ETCHING WITH LIGHT...';
  }
  newsletterSubmittedMsg = `✨ Drawing "${cleanName}" stroke-by-stroke into the leaf...`;
  if (fb) {
    fb.textContent = newsletterSubmittedMsg;
  }

  triggerSporeBurst();
  requestActiveLeafRepaint();
}

function updateNameInscriptionAnimation(nowMs) {
  if (!nameEtchState.text || nameEtchState.letters.length === 0) return;

  const elapsed = nowMs - nameEtchState.startTimeMs;
  const msPerChar = nameEtchState.msPerChar;
  let activeLetter = null;
  let activeLocalT = 0;

  nameEtchState.letters.forEach((item, idx) => {
    const startMs = idx * msPerChar;
    const rawT = (elapsed - startMs) / msPerChar;
    const t = Math.max(0, Math.min(1, rawT));

    if (item.char === ' ') {
      return;
    }

    if (t <= 0) {
      item.grooveEl.setAttribute('stroke-dashoffset', String(item.dashLen));
      item.strokeEl.setAttribute('stroke-dashoffset', String(item.dashLen));
      item.glowEl.setAttribute('opacity', '0');
      item.fillEl.setAttribute('opacity', '0');
      item.guidePathEl.setAttribute('opacity', '0');
    } else if (t < 1) {
      activeLetter = item;
      activeLocalT = t;

      const eased = t * t * (3 - 2 * t);
      const offset = ((1 - eased) * item.dashLen).toFixed(1);
      item.grooveEl.setAttribute('stroke-dashoffset', offset);
      item.glowEl.setAttribute('stroke-dashoffset', offset);
      item.strokeEl.setAttribute('stroke-dashoffset', offset);

      // Pulse the bioluminescent halo brightly while the stroke is being drawn
      const haloAlpha = 0.35 + 0.65 * Math.sin(t * Math.PI);
      item.glowEl.setAttribute('opacity', haloAlpha.toFixed(2));

      // Reveal the golden-chlorophyll inner fill as the strokes complete
      const fillAlpha = Math.max(0, Math.min(1, (t - 0.38) / 0.62));
      item.fillEl.setAttribute('opacity', fillAlpha.toFixed(2));

      // Trace the active stroke segment (Stroke 1 -> Stroke 2 -> Stroke 3)
      const segCount = item.strokes.length;
      const scaledSeg = t * segCount;
      const segIdx = Math.min(segCount - 1, Math.floor(scaledSeg));
      const segT = scaledSeg - segIdx;
      const seg = item.strokes[segIdx];
      const curX = seg.x1 + (seg.x2 - seg.x1) * segT;
      const curY = seg.y1 + (seg.y2 - seg.y1) * segT;

      item.guidePathEl.setAttribute(
        'd',
        `M ${seg.x1.toFixed(1)} ${seg.y1.toFixed(1)} L ${curX.toFixed(1)} ${curY.toFixed(1)}`
      );
      item.guidePathEl.setAttribute('opacity', (0.85 * Math.sin(segT * Math.PI)).toFixed(2));
    } else {
      item.grooveEl.setAttribute('stroke-dashoffset', '0');
      item.glowEl.setAttribute('stroke-dashoffset', '0');
      item.strokeEl.setAttribute('stroke-dashoffset', '0');
      const shimmer = 0.24 + 0.14 * Math.sin(nowMs * 0.005 + idx * 0.8);
      item.glowEl.setAttribute('opacity', shimmer.toFixed(2));
      item.fillEl.setAttribute('opacity', '1');
      item.guidePathEl.setAttribute('opacity', '0');
    }
  });

  if (activeLetter && etchLightBeamGroup) {
    const segCount = activeLetter.strokes.length;
    const scaledSeg = activeLocalT * segCount;
    const segIdx = Math.min(segCount - 1, Math.floor(scaledSeg));
    const segT = scaledSeg - segIdx;
    const seg = activeLetter.strokes[segIdx];

    const penX = seg.x1 + (seg.x2 - seg.x1) * segT;
    const penY = seg.y1 + (seg.y2 - seg.y1) * segT;

    etchLightBeamGroup.setAttribute('opacity', '1');
    etchLightBeamGroup.setAttribute('transform', `translate(${penX.toFixed(1)}, ${penY.toFixed(1)})`);

    const flareRadius = 25 + Math.sin(nowMs * 0.045) * 6;
    etchFlareOuter?.setAttribute('r', flareRadius.toFixed(1));
    const rotDeg = (nowMs * 0.22) % 360;
    etchRayH?.setAttribute('transform', `rotate(${rotDeg.toFixed(1)})`);
    etchRayV?.setAttribute('transform', `rotate(${rotDeg.toFixed(1)})`);

    // Animate radiating light sparks around the active stroke tip
    if (nameEtchState.sparkEls) {
      nameEtchState.sparkEls.forEach((spEl, sIdx) => {
        const phase = ((nowMs * 0.007 + sIdx * 0.31) % 1);
        const angle = sIdx * 1.15 + nowMs * 0.004;
        const dist = 4 + phase * 26;
        const sx = Math.cos(angle) * dist;
        const sy = Math.sin(angle) * dist - phase * 8;
        spEl.setAttribute('cx', sx.toFixed(1));
        spEl.setAttribute('cy', sy.toFixed(1));
        spEl.setAttribute('opacity', ((1 - phase) * 0.95).toFixed(2));
      });
    }

    requestActiveLeafRepaint();
  } else if (nameEtchState.active) {
    // Just finished drawing the final letter!
    nameEtchState.active = false;
    nameEtchState.completed = true;
    etchLightBeamGroup?.setAttribute('opacity', '0');
    if (nameEtchStatusPill) {
      nameEtchStatusPill.textContent = '✨ INSCRIBED IN LIGHT';
    }
    const fb = document.getElementById('newsletter-feedback');
    newsletterSubmittedMsg = `✨ "${nameEtchState.text}" is now etched into the living leaf!`;
    if (fb) {
      fb.textContent = newsletterSubmittedMsg;
    }
    triggerSporeBurst();
    requestActiveLeafRepaint();
  }
}

// Keep live state synced when user types into DOM inputs
domNameInput?.addEventListener('input', () => {
  explorerNameVal = domNameInput.value;
  newsletterErrorMsg = '';
  requestActiveLeafRepaint();
});
domNameInput?.addEventListener('focus', () => {
  focusedInputId = 'explorer-name';
  requestActiveLeafRepaint();
});
domNameInput?.addEventListener('blur', () => {
  if (focusedInputId === 'explorer-name') focusedInputId = null;
  requestActiveLeafRepaint();
});

// Also allow direct keyboard typing when a 3D leaf input is active
window.addEventListener('keydown', (e) => {
  if (!focusedInputId) return;
  if (document.activeElement === domNameInput) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNewsletterSubmit();
    }
    requestActiveLeafRepaint();
    return;
  }
  if (e.key === 'Backspace') {
    explorerNameVal = explorerNameVal.slice(0, -1);
    if (domNameInput) domNameInput.value = explorerNameVal;
    e.preventDefault();
  } else if (e.key === 'Enter') {
    handleNewsletterSubmit();
    e.preventDefault();
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && explorerNameVal.length < 24) {
    explorerNameVal += e.key;
    if (domNameInput) domNameInput.value = explorerNameVal;
    newsletterErrorMsg = '';
  }
  requestActiveLeafRepaint();
});

function handleNewsletterSubmit() {
  const currentVal = domNameInput ? domNameInput.value : explorerNameVal;
  startNameInscription(currentVal);
}

newsletterForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  handleNewsletterSubmit();
});

let forceActiveLeafTextureUpload = false;

function requestActiveLeafRepaint() {
  forceActiveLeafTextureUpload = true;
  if (typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
}

// Immediately repaint and re-upload the 3D leaf texture whenever the user selects text on a leaf!
document.addEventListener('selectionchange', () => {
  requestActiveLeafRepaint();
});

function syncQuizDOM() {
  const q = QUIZ_QUESTIONS[currentQuizIndex];
  const score = quizUserAnswers.reduce(
    (acc, ans, idx) => acc + (ans === QUIZ_QUESTIONS[idx].correctIndex ? 1 : 0),
    0
  );
  const progressText = document.getElementById('quiz-progress-text');
  if (progressText) progressText.textContent = `Question ${currentQuizIndex + 1} of ${QUIZ_QUESTIONS.length}`;
  const scoreBadge = document.getElementById('quiz-score-badge');
  if (scoreBadge) scoreBadge.textContent = `SCORE: ${score} / ${QUIZ_QUESTIONS.length}`;
  const qPrompt =
    document.getElementById('quiz-prompt-text') ||
    document.getElementById('quiz-question-prompt');
  if (qPrompt) qPrompt.textContent = q.prompt;

  document.querySelectorAll('.quiz-tab-btn').forEach((tabBtn, idx) => {
    const isCur = idx === currentQuizIndex;
    tabBtn.classList.toggle('is-active', isCur);
    tabBtn.setAttribute('aria-selected', isCur ? 'true' : 'false');
  });

  const userAns = quizUserAnswers[currentQuizIndex];
  document.querySelectorAll('.quiz-choice-btn').forEach((btn, idx) => {
    const textSpan = btn.querySelector('.choice-label') || btn.querySelector('.choice-text');
    if (textSpan && q.choices[idx]) textSpan.textContent = q.choices[idx];
    btn.classList.remove('is-correct', 'is-wrong');
    if (userAns !== null) {
      if (idx === q.correctIndex) btn.classList.add('is-correct');
      else if (idx === userAns) btn.classList.add('is-wrong');
    }
  });

  const explainEl =
    document.getElementById('quiz-explanation-banner') ||
    document.getElementById('quiz-explanation');
  if (explainEl) {
    explainEl.textContent =
      userAns !== null
        ? `${userAns === q.correctIndex ? '' : '❌ Not quite! '}${q.explanation}`
        : 'Select an answer choice etched into the leaf above.';
  }
  requestActiveLeafRepaint();
}

function bloomMoreCanopyOrchids(kind, message) {
  if (kind) pledgedSet.add(kind);
  activeOrchidCount += 8;
  finaleOrchidBlooms.forEach((b) => {
    b.targetScale = Math.min(1.75, b.targetScale + 0.34);
    b.mat.emissiveIntensity = Math.min(2.5, b.mat.emissiveIntensity + 0.45);
  });
  finaleStatusMsg = message;
  const st = document.getElementById('finale-pledge-status');
  if (st) st.textContent = message;
  const counterBadge = document.getElementById('pledge-counter-badge');
  if (counterBadge) counterBadge.textContent = `BLOOMS: ${activeOrchidCount} ACTIVE`;
  document.querySelectorAll('.btn-pledge-action').forEach((btn) => {
    if (pledgedSet.has(btn.dataset.pledge)) {
      btn.classList.add('is-pledged');
    }
  });
  triggerSporeBurst();
  requestActiveLeafRepaint();
}

function executeLeafAction(hitRegion) {
  if (!hitRegion) return;
  const id = hitRegion.id;

  if (id === 'btn-start-descent') {
    triggerSporeBurst();
    scrollToStep(1);
  } else if (id === 'btn-pulse-spores') {
    triggerSporeBurst();
    const badge = document.getElementById('hic-pipeline-badge');
    if (badge) {
      badge.textContent = '✨ Canopy Spores Released! Drag across leaf text to select!';
    }
  } else if (id.startsWith('jump-')) {
    const stepNum = Number(id.replace('jump-', ''));
    scrollToStep(stepNum);
  } else if (id === 'btn-sloth-dance') {
    slothPooCount++;
    const fb =
      document.getElementById('sloth-stat-readout') ||
      document.getElementById('sloth-dance-feedback');
    if (fb) {
      fb.textContent = `🕺 Poo Dance #${slothPooCount} (-33% weight) • Fur Moths: ${124 + slothPooCount * 38}`;
    }
    triggerSporeBurst();
  } else if (id === 'btn-detonate-pod') {
    podDetonations++;
    const fb =
      document.getElementById('grenade-stat-readout') ||
      document.getElementById('pod-blast-feedback');
    if (fb) {
      fb.textContent = `💥 BOOM #${podDetonations}: Flung ${(18 + (podDetonations % 5) * 4).toFixed(1)}m at 160 MPH!`;
    }
    triggerSporeBurst();
  } else if (id === 'btn-shake-decoy') {
    decoyShakes++;
    pihaCallTriggered = false;
    const fb =
      document.getElementById('decoy-stat-readout') ||
      document.getElementById('spider-decoy-feedback');
    if (fb) {
      fb.textContent = `🕸️ Decoy Active • Wasps Fooled: ${14 + decoyShakes}`;
    }
    triggerSporeBurst();
  } else if (id === 'btn-piha-call') {
    pihaCallTriggered = true;
    const fb =
      document.getElementById('decoy-stat-readout') ||
      document.getElementById('spider-decoy-feedback');
    if (fb) {
      fb.textContent = '📢 FWEEEE-OOOH! 116 dB shockwave blasted!';
    }
    triggerSporeBurst();
  } else if (id === 'input-explorer-name') {
    focusedInputId = 'explorer-name';
    domNameInput?.focus();
  } else if (id === 'input-explorer-email') {
    focusedInputId = 'explorer-email';
    domEmailInput?.focus();
  } else if (id.startsWith('courier-')) {
    selectedCourier = hitRegion.courierVal;
    const radio = document.querySelector(`input[name="courier"][value="${selectedCourier}"]`);
    if (radio) radio.checked = true;
  } else if (id === 'btn-newsletter-submit') {
    handleNewsletterSubmit();
  } else if (id.startsWith('quiz-tab-')) {
    currentQuizIndex = Number(id.replace('quiz-tab-', ''));
    syncQuizDOM();
  } else if (id.startsWith('quiz-choice-')) {
    quizUserAnswers[currentQuizIndex] = hitRegion.choiceIdx;
    syncQuizDOM();
    triggerSporeBurst();
  } else if (id === 'btn-quiz-next') {
    currentQuizIndex = (currentQuizIndex + 1) % QUIZ_QUESTIONS.length;
    syncQuizDOM();
  } else if (id === 'btn-quiz-reset') {
    quizUserAnswers[0] = null;
    quizUserAnswers[1] = null;
    quizUserAnswers[2] = null;
    currentQuizIndex = 0;
    syncQuizDOM();
  } else if (id === 'btn-ignite-leaf') {
    if (leaf6BurnState === 'intact') {
      leaf6BurnState = 'burning';
      leaf6BurnStartTime = performance.now();
      leaf6BurnProgress = 0.02;
      const pill = document.getElementById('burn-status-pill');
      if (pill) pill.textContent = '🔥 ENGULFED IN FLAMES';
    }
  } else if (id === 'btn-fastforward-regrowth') {
    leaf6BurnState = 'intact';
    leaf6BurnProgress = 0.0;
    const pill = document.getElementById('burn-status-pill');
    if (pill) pill.textContent = 'LIVING CANOPY';
    document.getElementById('burn-state-intact')?.classList.remove('is-hidden');
    document.getElementById('burn-state-remains')?.classList.add('is-hidden');
    triggerSporeBurst();
  } else if (id === 'pledge-indigenous') {
    bloomMoreCanopyOrchids(
      'indigenous',
      '🌺 Pledged: Indigenous Land Stewardship! New 3D orchids bloomed!'
    );
  } else if (id === 'pledge-reserve') {
    bloomMoreCanopyOrchids(
      'reserve',
      '🌺 Pledged: Permanent Rainforest Corridors! Central vines glow brighter!'
    );
  } else if (id === 'pledge-supply') {
    bloomMoreCanopyOrchids(
      'supply',
      '🌺 Pledged: Deforestation-Free Action! Watch the vine letters blossom!'
    );
  } else if (id === 'btn-bloom-all') {
    pledgedSet.add('indigenous');
    pledgedSet.add('reserve');
    pledgedSet.add('supply');
    bloomMoreCanopyOrchids(
      null,
      '🌸 Full Canopy of Hope Awakened! All 3D orchids are in full bloom!'
    );
  }

  requestActiveLeafRepaint();
}

// Wire up the underlying DOM buttons & controls so native HTML-in-Canvas hit-testing works directly!
document.getElementById('btn-start-descent')?.addEventListener('click', () => executeLeafAction({ id: 'btn-start-descent' }));
document.getElementById('btn-pulse-spores')?.addEventListener('click', () => executeLeafAction({ id: 'btn-pulse-spores' }));
document.getElementById('btn-sloth-dance')?.addEventListener('click', () => executeLeafAction({ id: 'btn-sloth-dance' }));
document.getElementById('btn-detonate-pod')?.addEventListener('click', () => executeLeafAction({ id: 'btn-detonate-pod' }));
document.getElementById('btn-shake-decoy')?.addEventListener('click', () => executeLeafAction({ id: 'btn-shake-decoy' }));
document.getElementById('btn-piha-call')?.addEventListener('click', () => executeLeafAction({ id: 'btn-piha-call' }));
document.getElementById('btn-ignite-leaf')?.addEventListener('click', () => executeLeafAction({ id: 'btn-ignite-leaf' }));
document.getElementById('btn-fastforward-regrowth')?.addEventListener('click', () => executeLeafAction({ id: 'btn-fastforward-regrowth' }));
document.getElementById('btn-quiz-next')?.addEventListener('click', () => executeLeafAction({ id: 'btn-quiz-next' }));
document.getElementById('btn-quiz-reset')?.addEventListener('click', () => executeLeafAction({ id: 'btn-quiz-reset' }));
document.getElementById('btn-bloom-all')?.addEventListener('click', () => executeLeafAction({ id: 'btn-bloom-all' }));
document.getElementById('btn-newsletter-submit')?.addEventListener('click', (e) => {
  e.preventDefault();
  handleNewsletterSubmit();
});

document.querySelectorAll('.btn-leaf-step').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetStep = Number(btn.dataset.jump || 0);
    scrollToStep(targetStep);
  });
});

document.querySelectorAll('.quiz-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const qIdx = Number(btn.dataset.qindex ?? btn.dataset.q ?? 0);
    executeLeafAction({ id: `quiz-tab-${qIdx}` });
  });
});

document.querySelectorAll('.quiz-choice-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const cIdx = Number(btn.dataset.choice || 0);
    executeLeafAction({ id: `quiz-choice-${cIdx}`, choiceIdx: cIdx });
  });
});

document.querySelectorAll('input[name="courier"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      selectedCourier = radio.value;
      requestActiveLeafRepaint();
    }
  });
});

document.querySelectorAll('.btn-pledge-action').forEach((btn) => {
  btn.addEventListener('click', () => {
    executeLeafAction({ id: `pledge-${btn.dataset.pledge}` });
  });
});

vineNodeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    scrollToStep(Number(btn.dataset.stepTarget || 0));
  });
});

const archDialog = document.getElementById('arch-dialog');
document.getElementById('btn-open-arch-modal')?.addEventListener('click', () => {
  if (archDialog && typeof archDialog.showModal === 'function') {
    archDialog.showModal();
  }
});

// 3D Raycaster UV Hit-Testing on the Sculpted 3D Leaf Surface (Fallback when !supportsNativeHIC)
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2(0, 0);
const pointerNorm = new THREE.Vector2(0.5, 0.5);

function findLeafHitRegionAtPointer(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  const activeIdx = Math.round(smoothScrollStep);
  const activeNode = leafNodes[activeIdx];
  if (!activeNode || !activeNode.nodeGroup.visible) return null;

  raycaster.setFromCamera(pointerNDC, camera);
  const intersects = raycaster.intersectObject(activeNode.leafMesh, false);
  if (intersects.length === 0 || !intersects[0].uv) return null;

  const uv = intersects[0].uv;
  const domU = activeNode.side > 0.1 ? 1.0 - uv.x : uv.x;
  const domStartU = activeNode.side > 0.1 ? 0.24 : 0.14;
  const domUvX = (domU - domStartU) / 0.62;
  const domUvY = 1.0 - (uv.y - 0.16) / 0.68;

  if (domUvX < 0 || domUvX > 1 || domUvY < 0 || domUvY > 1) return null;

  const px = domUvX * LEAF_TEX_W;
  const py = domUvY * LEAF_TEX_H;

  for (const r of activeNode.hitRegions) {
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return r;
    }
  }
  return null;
}

window.addEventListener('pointermove', (e) => {
  pointerNorm.x = e.clientX / Math.max(1, window.innerWidth);
  pointerNorm.y = 1.0 - e.clientY / Math.max(1, window.innerHeight);

  if (!supportsNativeHIC) {
    const hit = findLeafHitRegionAtPointer(e.clientX, e.clientY);
    hoveredHitId = hit ? hit.id : null;
    if (hit) {
      canvas.style.cursor = hit.id.startsWith('input-') ? 'text' : 'pointer';
    } else {
      canvas.style.cursor = 'default';
    }
  } else if (e.buttons === 1) {
    // Repaint while dragging a text selection across the 3D leaf
    requestActiveLeafRepaint();
  }
});

window.addEventListener('pointerup', () => {
  if (supportsNativeHIC) {
    requestActiveLeafRepaint();
  }
});

window.addEventListener('pointerdown', (e) => {
  // Ignore clicks inside the top HUD or modal dialog
  if (e.target.closest?.('.canopy-hud') || e.target.closest?.('.arch-dialog')) return;
  if (!supportsNativeHIC) {
    const hit = findLeafHitRegionAtPointer(e.clientX, e.clientY);
    if (hit) {
      executeLeafAction(hit);
    } else {
      focusedInputId = null;
    }
  } else {
    requestActiveLeafRepaint();
  }
});

// ============================================================================
// 13. SCROLL TRACKING, 3D ORIGAMI VERTEX EVALUATOR & HIT-TEST GEOMETRY SYNC
// ============================================================================

let targetScrollStep = 0;
let smoothScrollStep = 0;

function updateScrollPosition() {
  const vh = Math.max(1, window.innerHeight);
  const rawStep = Math.max(0, Math.min(TOTAL_STEPS, window.scrollY / vh));
  targetScrollStep = rawStep;

  const progress = targetScrollStep / TOTAL_STEPS;
  document.documentElement.style.setProperty('--scroll-progress', progress.toFixed(4));
}

window.addEventListener('scroll', updateScrollPosition, { passive: true });
updateScrollPosition();

const _evalAxis = new THREE.Vector3();
const _evalPivot = new THREE.Vector3();
const _pTL = new THREE.Vector3();
const _pTR = new THREE.Vector3();
const _pBL = new THREE.Vector3();
const _pBR = new THREE.Vector3();

function applyOrigamiPetalHingeJS(
  pos,
  pos0X,
  pos0Y,
  absV,
  pivotX,
  pivotY,
  axisX,
  axisY,
  normX,
  normY,
  maxAngle,
  localFold,
  hingeWidth
) {
  const d = (pos0X - pivotX) * normX + (pos0Y - pivotY) * normY;
  if (d > -hingeWidth && localFold > 0.0005) {
    const midribSafe = smoothstepJS(0.0, 0.20, absV);
    const w = smoothstepJS(0.0, hingeWidth, d) * midribSafe;
    const ang = maxAngle * localFold * w;
    _evalPivot.set(pivotX, pivotY, 0.0);
    _evalAxis.set(axisX, axisY, 0.0).normalize();
    pos.sub(_evalPivot).applyAxisAngle(_evalAxis, ang).add(_evalPivot);
  }
}

/**
 * Evaluates the exact 3D vertex position of any `(u, vNorm)` point on the sculpted leaf
 * at the given `(unfold, foldDir, side, timeSec)`, matching `leafVertexShader` step-for-step.
 * This allows `syncInvisibleDOMHitLayer` to update `canvasTransform` dynamically at every
 * intermediate unfolding and refolding step so text on the leaf is always selectable!
 */
function evaluateLeafPoint3D(u, vNorm, unfold, foldDir, side, timeSec, outVec) {
  const v = (vNorm - 0.5) * 2.0;
  const absV = Math.abs(v);
  const sideSign = v >= 0.0 ? 1.0 : -1.0;

  const dripHookY = -Math.pow(Math.max(0.0, u - 0.78) / 0.22, 2.0) * 0.16;
  const pos0X = (u - 0.5) * 7.55;
  const pos0Y = v * 2.52 + dripHookY;

  const midribRidge = Math.exp(-absV * 24.0) * (1.0 - u * 0.78) * 0.13;
  const veinCoord0 = u * 9.5 - Math.pow(absV, 1.22) * 1.85;
  const veinWave = Math.cos(veinCoord0 * Math.PI * 2.0);
  const lateralVeinRib =
    Math.pow(Math.max(0.0, veinWave), 6.0) * 0.048 * (1.0 - absV * 0.35) * (1.0 - u * 0.28);
  const bullatePillow =
    Math.max(0.0, -veinWave) * 0.058 * Math.sin(absV * Math.PI) * (1.0 - u * 0.22);
  const dihedralZ = Math.pow(absV, 1.35) * 0.24;
  const longitudinalArch = -Math.pow(u - 0.44, 2.0) * 0.36;
  const edgeRuffleZ =
    Math.sin(u * 22.0 + (v > 0 ? 0.0 : 1.5)) * 0.055 * smoothstepJS(0.62, 1.0, absV);

  const pos0Z =
    midribRidge + lateralVeinRib + bullatePillow + dihedralZ + longitudinalArch + edgeRuffleZ;
  outVec.set(pos0X, pos0Y, pos0Z);

  const fold = Math.max(0.0, Math.min(1.0, 1.0 - unfold));
  if (fold > 0.0005) {
    const dirU = foldDir > 0.0 ? 1.0 - u : u;
    const midribSafe = smoothstepJS(0.0, 0.20, absV);
    const veinCoord = u * 7.5 - Math.pow(absV, 1.12) * 2.15;

    // Stage 1: Diagonal Miura-ori vein pleats & foreshortening
    const pleatLocalFold = smoothstepJS(0.0, 0.85, fold * (0.68 + 0.32 * dirU));
    const pleatPhase = veinCoord * Math.PI;
    const triWave =
      Math.asin(Math.max(-1.0, Math.min(1.0, Math.sin(pleatPhase) * 0.985))) * (2.0 / Math.PI);
    outVec.z += triWave * 0.26 * pleatLocalFold * midribSafe;
    const foreshorten = (1.0 - Math.cos(pleatLocalFold * 1.05)) * 0.34 * midribSafe;
    outVec.x -= u * 7.55 * foreshorten * 0.45;
    outVec.y -= v * 2.52 * foreshorten * 0.28;

    // Stage 2: Radial flower-petal hinges
    const p1Phase = foldDir > 0.0 ? 0.02 : 0.26;
    let p1Fold = Math.max(0.0, Math.min(1.0, (fold - p1Phase) / 0.65));
    p1Fold = p1Fold * p1Fold * (3.0 - 2.0 * p1Fold);
    const p1Nx = 0.52 / Math.hypot(0.52, 0.854);
    const p1Ny = (sideSign * 0.854) / Math.hypot(0.52, 0.854);
    applyOrigamiPetalHingeJS(
      outVec,
      pos0X,
      pos0Y,
      absV,
      0.55,
      sideSign * 1.18,
      -sideSign * p1Ny,
      sideSign * p1Nx,
      p1Nx,
      p1Ny,
      1.48,
      p1Fold,
      0.32
    );

    const p2Phase = foldDir > 0.0 ? 0.22 : 0.06;
    let p2Fold = Math.max(0.0, Math.min(1.0, (fold - p2Phase) / 0.68));
    p2Fold = p2Fold * p2Fold * (3.0 - 2.0 * p2Fold);
    const p2Nx = -0.48 / Math.hypot(-0.48, 0.877);
    const p2Ny = (sideSign * 0.877) / Math.hypot(-0.48, 0.877);
    applyOrigamiPetalHingeJS(
      outVec,
      pos0X,
      pos0Y,
      absV,
      -0.65,
      sideSign * 1.15,
      -sideSign * p2Ny,
      sideSign * p2Nx,
      p2Nx,
      p2Ny,
      1.42,
      p2Fold,
      0.32
    );

    let p3Fold = Math.max(0.0, Math.min(1.0, (fold - 0.14) / 0.72));
    p3Fold = p3Fold * p3Fold * (3.0 - 2.0 * p3Fold);
    const p3Nx = 0.24 / Math.hypot(0.24, 0.971);
    const p3Ny = (sideSign * 0.971) / Math.hypot(0.24, 0.971);
    applyOrigamiPetalHingeJS(
      outVec,
      pos0X,
      pos0Y,
      absV,
      -0.15,
      sideSign * 0.72,
      -sideSign * p3Ny,
      sideSign * p3Nx,
      p3Nx,
      p3Ny,
      -1.24,
      p3Fold,
      0.34
    );

    let p4Fold = Math.max(0.0, Math.min(1.0, (fold - 0.18) / 0.78));
    p4Fold = p4Fold * p4Fold * (3.0 - 2.0 * p4Fold);
    const p4Nx = 0.16 / Math.hypot(0.16, 0.987);
    const p4Ny = (sideSign * 0.987) / Math.hypot(0.16, 0.987);
    applyOrigamiPetalHingeJS(
      outVec,
      pos0X,
      pos0Y,
      absV,
      -0.45,
      sideSign * 0.32,
      -sideSign * p4Ny,
      sideSign * p4Nx,
      p4Nx,
      p4Ny,
      1.32,
      p4Fold,
      0.34
    );

    // Stage 3: 5-segment piecewise origami spine & petal bloom chain
    for (let seg = 4; seg >= 0; seg--) {
      const orderIdx = foldDir > 0.0 ? seg : 4 - seg;
      const segStart = orderIdx * 0.12;
      const segFold = Math.max(0.0, Math.min(1.0, (fold - segStart) / (1.0 - 4.0 * 0.12)));
      const segEase = segFold * segFold * (3.0 - 2.0 * segFold);

      const hingeU = 0.14 + seg * 0.155;
      const hingeX = (hingeU - 0.5) * 7.55;
      const chevronOffset = absV * absV * 0.65;
      const dLong = pos0X - hingeX + chevronOffset;

      if (dLong > 0.0) {
        const wSeg = smoothstepJS(0.0, 0.32, dLong);
        const altPitch = (seg % 2 === 0 ? 0.52 : -0.24) + 0.22;
        const pitchAng = -segEase * altPitch * wSeg;
        const sweepAng = segEase * 0.18 * -foldDir * wSeg;

        _evalPivot.set(hingeX, 0.0, 0.0);
        outVec.sub(_evalPivot);
        _evalAxis.set(0.0, 1.0, 0.0);
        outVec.applyAxisAngle(_evalAxis, pitchAng);
        _evalAxis.set(0.0, 0.0, 1.0);
        outVec.applyAxisAngle(_evalAxis, sweepAng);
        outVec.add(_evalPivot);
      }
    }
  }

  if (side > 0.1) {
    outVec.x = -outVec.x;
  }

  // Wind sway
  outVec.z += Math.sin(timeSec * 1.85 + u * 3.4 + v * 1.6) * (0.03 + u * 0.065) * unfold;
  outVec.y += Math.cos(timeSec * 1.4 + u * 2.5) * 0.025 * u * unfold;
  return outVec;
}

function evaluateDomQuadPoint3D(qx, qy, unfold, foldDir, side, timeSec, outVec) {
  const domStartU = side > 0.1 ? 0.24 : 0.14;
  const domU = domStartU + (qx + 0.5) * 0.62;
  const u = side > 0.1 ? 1.0 - domU : domU;
  const vNorm = 0.50 + qy * 0.68;
  return evaluateLeafPoint3D(u, vNorm, unfold, foldDir, side, timeSec, outVec);
}

function bindNativeHICTextureToThree(node) {
  const texProps = renderer.properties.get(node.nativeThreeTexture);
  texProps.__webglTexture = node.nativeGLTexture;
  texProps.__webglInit = true;
  node.leafShaderMat.uniforms.uHtmlTexture.value = node.nativeThreeTexture;
  node.leafShaderMat.uniforms.uFlipY.value = 1.0;
}

function projectWorldPointToCanvasCSS(worldVec, cw, ch) {
  worldVec.project(camera);
  return {
    x: (worldVec.x + 1.0) * 0.5 * cw,
    y: (1.0 - worldVec.y) * 0.5 * ch
  };
}

function syncInvisibleDOMHitLayer(node, unfoldProgress, foldDir = -1.0, timeSec = 0.0) {
  const element = node.domCard;
  if (!element) return;

  if (unfoldProgress < 0.02) {
    if (supportsNativeHIC && typeof canvas.clearElementGeometry === 'function') {
      try {
        canvas.clearElementGeometry(element);
      } catch (_err) {
        // Ignore if not registered
      }
    }
    element.style.transform = 'translate3d(-9999px, -9999px, 0)';
    element.style.pointerEvents = 'none';
    element.setAttribute('inert', '');
    return;
  }

  element.removeAttribute('inert');
  element.style.pointerEvents = 'auto';

  // Ensure parent `leavesGroup` and `node.nodeGroup` world matrices are updated before
  // transforming leaf vertices to world space (since `syncInvisibleDOMHitLayer` runs
  // before `renderer.render(scene, camera)` and `nodeGroup` may have just become visible).
  node.leafMesh.updateWorldMatrix(true, false);

  const cw = Math.max(1, canvas.clientWidth || window.innerWidth);
  const ch = Math.max(1, canvas.clientHeight || window.innerHeight);

  // Sample the 3D unfolding leaf surface across the DOM region and project to canvas CSS pixels
  // so `canvasTransform` is a well-conditioned 2D affine DOMMatrix (`m44 = 1, m33 = 1`)
  // that accurately tracks position, scale, and tilt at every step of the animation.
  const span = 0.36;
  const invSpan = 0.5 / span;

  evaluateDomQuadPoint3D(-span, span, unfoldProgress, foldDir, node.side, timeSec, _pTL);
  evaluateDomQuadPoint3D(span, span, unfoldProgress, foldDir, node.side, timeSec, _pTR);
  evaluateDomQuadPoint3D(-span, -span, unfoldProgress, foldDir, node.side, timeSec, _pBL);
  evaluateDomQuadPoint3D(span, -span, unfoldProgress, foldDir, node.side, timeSec, _pBR);

  _pTL.applyMatrix4(node.leafMesh.matrixWorld);
  _pTR.applyMatrix4(node.leafMesh.matrixWorld);
  _pBL.applyMatrix4(node.leafMesh.matrixWorld);
  _pBR.applyMatrix4(node.leafMesh.matrixWorld);

  const sTL = projectWorldPointToCanvasCSS(_pTL, cw, ch);
  const sTR = projectWorldPointToCanvasCSS(_pTR, cw, ch);
  const sBL = projectWorldPointToCanvasCSS(_pBL, cw, ch);
  const sBR = projectWorldPointToCanvasCSS(_pBR, cw, ch);

  const centerX = 0.25 * (sTL.x + sTR.x + sBL.x + sBR.x);
  const centerY = 0.25 * (sTL.y + sTR.y + sBL.y + sBR.y);

  const axisXx = 0.5 * (sTR.x - sTL.x + (sBR.x - sBL.x)) * invSpan;
  const axisXy = 0.5 * (sTR.y - sTL.y + (sBR.y - sBL.y)) * invSpan;
  const axisYx = 0.5 * (sBL.x - sTL.x + (sBR.x - sTR.x)) * invSpan;
  const axisYy = 0.5 * (sBL.y - sTL.y + (sBR.y - sTR.y)) * invSpan;

  const fullTL = {
    x: centerX - 0.5 * axisXx - 0.5 * axisYx,
    y: centerY - 0.5 * axisXy - 0.5 * axisYy
  };
  const fullTR = {
    x: fullTL.x + axisXx,
    y: fullTL.y + axisXy
  };
  const fullBL = {
    x: fullTL.x + axisYx,
    y: fullTL.y + axisYy
  };

  const canvasTransform = computeCanvasTransform(element, fullTL, fullTR, fullBL);

  if (supportsNativeHIC && typeof canvas.updateElementGeometry === 'function') {
    try {
      canvas.updateElementGeometry(element, {
        canvasTransform
      });
    } catch (_err) {
      // Ignore if unsupported
    }
  }
  element.style.transform = canvasTransform.toString();
}

function updateSceneAndSyncDOM(nowMs, changedElementsSet = null) {
  const timeSec = nowMs * 0.001;

  // Update stroke-for-stroke light inscription animation on Leaf #4
  updateNameInscriptionAnimation(nowMs);

  // 1. Smoothly interpolate scroll step (0..7)
  smoothScrollStep += (targetScrollStep - smoothScrollStep) * 0.14;
  if (Math.abs(smoothScrollStep - targetScrollStep) < 0.0015) {
    smoothScrollStep = targetScrollStep;
  }

  const activeStepIndex = Math.round(smoothScrollStep);
  const activeMeta = STAGE_METADATA[activeStepIndex] || STAGE_METADATA[0];

  if (hudStageTitle) hudStageTitle.textContent = activeMeta.title;
  if (hudDepthReadout) hudDepthReadout.textContent = `Elevation: ${activeMeta.elevation}`;
  if (scrollGuideText) scrollGuideText.textContent = activeMeta.guide;

  if (pillLeftVine) {
    pillLeftVine.classList.toggle('is-sprouting', activeMeta.side === -1 || activeMeta.step === 7);
  }
  if (pillRightVine) {
    pillRightVine.classList.toggle('is-sprouting', activeMeta.side === 1 || activeMeta.step === 7);
  }

  vineNodeButtons.forEach((btn, idx) => {
    const isCurrent = idx === activeStepIndex;
    btn.classList.toggle('is-active', isCurrent);
    if (isCurrent) {
      btn.setAttribute('aria-current', 'location');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  // 2. Move Camera & Lighting Rig down the Gnarled DNA Liana Vines
  const camY = -smoothScrollStep * STEP_SPACING_Y;
  const finaleApproach = THREE.MathUtils.smoothstep(smoothScrollStep, 6.0, 7.0);
  camera.position.x = (pointerNorm.x - 0.5) * 0.52;
  camera.position.y = camY + (pointerNorm.y - 0.5) * 0.32;
  camera.position.z = THREE.MathUtils.lerp(10.6, 11.4, finaleApproach);
  camera.lookAt(0, camY + finaleApproach * 0.4, 0);
  camera.updateMatrixWorld();

  cameraLightRig.position.set(0, camY, 0);
  sunLight.target.position.set(0, camY - 1.5, 0);
  sssBackLight.target.position.set(0, camY, 1.5);
  mistFillLight.target.position.set(0, camY, 0);

  // Sway 3D Epiphytic Climber Leaves along the vines
  epiphyteClusters.forEach((item, i) => {
    item.group.rotation.z = Math.sin(timeSec * 1.5 + i) * 0.08;
  });

  // 3. Update Leaf #6 Fire Progression & Persistent Charred Remains State
  if (leaf6BurnState === 'burning') {
    const elapsedSec = (nowMs - leaf6BurnStartTime) * 0.001;
    leaf6BurnProgress = THREE.MathUtils.clamp(elapsedSec / 3.8, 0.02, 1.0);

    firePointLight.intensity = 10.0 + Math.sin(nowMs * 0.045) * 4.0;
    fireParticleMat.uniforms.uIntensity.value = Math.sin(leaf6BurnProgress * Math.PI);

    if (leaf6BurnProgress >= 1.0) {
      leaf6BurnState = 'burned';
      leaf6BurnCompletedTime = nowMs;
      document.getElementById('burn-state-intact')?.classList.add('is-hidden');
      document.getElementById('burn-state-remains')?.classList.remove('is-hidden');
      requestActiveLeafRepaint();
    }
  } else if (leaf6BurnState === 'burned') {
    firePointLight.intensity = 1.8 + Math.sin(timeSec * 8.0) * 0.6;
    fireParticleMat.uniforms.uIntensity.value = 0.28;
  } else {
    firePointLight.intensity = 0.0;
    fireParticleMat.uniforms.uIntensity.value = 0.0;
  }
  fireParticleMat.uniforms.uTime.value = timeSec;

  // 4. Update all 8 Sculpted 3D Leaves & Unfurl/Refold their Piecewise Origami Geometry + HTML-in-Canvas Texture
  let primaryNodeRecord = null;

  leafNodes.forEach((node, idx) => {
    const relOffset = idx - smoothScrollStep;
    const absDist = Math.abs(relOffset);

    const unfold =
      absDist <= 0.06
        ? 1.0
        : 1.0 - THREE.MathUtils.smoothstep(absDist, 0.06, 0.56);

    node.nodeGroup.visible = unfold > 0.008;

    if (unfold > 0.008) {
      const curl = 1.0 - unfold;
      const side = node.side;
      // relOffset >= 0 means we are approaching/blooming the leaf (-1.0);
      // relOffset < 0 means we have scrolled past and the leaf is refolding (+1.0)!
      const foldDir = relOffset >= 0.0 ? -1.0 : 1.0;

      // Counter-translate Y toward the camera center during unfolding/refolding so the
      // piecewise flower-petal bloom and refold happen right in the middle of the viewport!
      const viewportFollowY = relOffset * STEP_SPACING_Y * 0.78;
      node.leafMesh.position.x = THREE.MathUtils.lerp(0.0, side * 1.25, Math.pow(curl, 1.35));
      node.leafMesh.position.y =
        (idx === 7 ? -0.95 : 0.0) + viewportFollowY + Math.sin(timeSec * 1.5 + idx) * 0.04;
      node.leafMesh.position.z = THREE.MathUtils.lerp(1.45, 0.95, curl);
      if (node.petioleMesh) {
        node.petioleMesh.position.y = viewportFollowY * 0.9;
      }

      node.leafMesh.rotation.order = 'YXZ';
      node.leafMesh.rotation.y = -side * curl * 0.36 + (pointerNorm.x - 0.5) * 0.1 * unfold;
      node.leafMesh.rotation.x = relOffset * 0.28 * curl + (pointerNorm.y - 0.5) * 0.08 * unfold;
      node.leafMesh.rotation.z = -side * curl * 0.18;

      const sFactor = THREE.MathUtils.lerp(0.76, idx === 7 ? 0.92 : 1.0, unfold);
      node.leafMesh.scale.setScalar(sFactor);

      node.leafShaderMat.uniforms.uTime.value = timeSec;
      node.leafShaderMat.uniforms.uUnfold.value = unfold;
      node.leafShaderMat.uniforms.uFoldDir.value = foldDir;
      node.leafShaderMat.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(unfold, 0.01, 0.12);
      node.leafShaderMat.uniforms.uBurnProgress.value = idx === 6 ? leaf6BurnProgress : 0.0;
      node.leafShaderMat.uniforms.uPointer.value.copy(pointerNorm);

      // Update the live DOM-to-3D-Leaf Texture & UV hit-regions for the active leaf
      if (!supportsNativeHIC && absDist < 0.62) {
        renderLiveDOMToLeafCanvas(node, nowMs, idx === activeStepIndex ? hoveredHitId : null);
      }

      if (idx === activeStepIndex) {
        primaryNodeRecord = { node, unfold, foldDir };
      } else {
        syncInvisibleDOMHitLayer(node, unfold, foldDir, timeSec);
      }

      if (supportsNativeHIC && unfold >= 0.02) {
        if (
          !changedElementsSet ||
          changedElementsSet.has(node.domCard) ||
          node.textureState.width === 0 ||
          (idx === activeStepIndex && forceActiveLeafTextureUpload)
        ) {
          try {
            if (
              uploadElementWebGL(
                gl,
                canvas,
                node.nativeGLTexture,
                node.domCard,
                node.textureState
              )
            ) {
              bindNativeHICTextureToThree(node);
            }
            renderer.state.bindTexture(gl.TEXTURE_2D, null);
          } catch (_err) {
            // Retry on next paint event
          }
        }
      }
    } else {
      syncInvisibleDOMHitLayer(node, unfold, -1.0, timeSec);
    }
  });

  // Update the primary active leaf's geometry LAST so it sits on top of the HTML-in-Canvas hit-test stack!
  if (primaryNodeRecord) {
    syncInvisibleDOMHitLayer(
      primaryNodeRecord.node,
      primaryNodeRecord.unfold,
      primaryNodeRecord.foldDir,
      timeSec
    );
  }
  forceActiveLeafTextureUpload = false;

  // 5. Animate Finale 3D Living Vine Text & Bioluminescent Orchid Blossoms
  finaleVineTextGroup.rotation.y = Math.sin(timeSec * 0.65) * 0.06 + (pointerNorm.x - 0.5) * 0.12;
  finaleOrchidBlooms.forEach((b) => {
    b.baseScale += (b.targetScale - b.baseScale) * 0.08;
    const pulse = 1.0 + Math.sin(timeSec * 2.8 + b.phase) * 0.12;
    b.group.scale.setScalar(b.baseScale * pulse);
  });

  // 6. Update Rainforest Spores & Fireflies
  const isBoosted = nowMs < sporeBoostUntil;
  sporeShaderMat.uniforms.uTime.value = timeSec;
  sporeShaderMat.uniforms.uSporeBoost.value +=
    ((isBoosted ? 1.85 : 1.0) - sporeShaderMat.uniforms.uSporeBoost.value) * 0.1;

  // 7. Render Three.js Scene
  renderer.render(scene, camera);
}

let paintedThisFrame = false;

canvas.onpaint = (event) => {
  paintedThisFrame = true;
  const changedSet =
    event && Array.isArray(event.changedElements) ? new Set(event.changedElements) : null;
  updateSceneAndSyncDOM(performance.now(), changedSet);
};

function animationLoop(nowMs) {
  paintedThisFrame = false;
  if (typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
  if (!paintedThisFrame) {
    updateSceneAndSyncDOM(nowMs, null);
  }
  requestAnimationFrame(animationLoop);
}

requestAnimationFrame(animationLoop);
