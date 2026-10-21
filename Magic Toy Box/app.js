import * as THREE from './vendor/three.module.min.js';

/**
 * The Magical Toy Box — 3D Marketing Campaign
 * Built with Three.js, Custom WebGL Shaders, HTML-in-Canvas API, and Scrollytelling
 */

const canvas = document.getElementById('toybox-canvas');
const stageViewport = document.getElementById('stage-viewport');
const hudStageLabel = document.getElementById('hud-stage-label');
const hudRpmText = document.getElementById('hud-rpm-text');
const scrollPromptText = document.getElementById('scroll-prompt-text');
const hicModeStatus = document.getElementById('hic-mode-status');
const heroCard = document.getElementById('hic-hero-plaque');
const itemCards = Array.from(document.querySelectorAll('.hic-item-card'));
const allDrawableCards = [heroCard, ...itemCards];
const medallionButtons = Array.from(document.querySelectorAll('.medallion-btn'));

// 1. Check browser support for the HTML-in-Canvas API (Chrome 157+)
const supportsNativeHIC =
  'content' in HTMLCanvasElement.prototype &&
  typeof canvas.captureElementImage === 'function';

if (!supportsNativeHIC) {
  // Fallback strategy per Modern Web Guidance:
  // When native content="drawable" is not active in the browser, place the
  // drawable HTML elements in an overlay layer above the canvas while also
  // synthesizing their WebGL shader textures inside the 3D scene.
  const fallbackLayer = document.createElement('div');
  fallbackLayer.id = 'hic-fallback-layer';
  fallbackLayer.className = 'hic-fallback-layer';
  stageViewport.insertBefore(fallbackLayer, canvas.nextSibling);
  allDrawableCards.forEach((card) => {
    fallbackLayer.appendChild(card);
  });
  if (hicModeStatus) {
    hicModeStatus.textContent = 'WebGL Foil & Frost Shader + 3D DOM Matrix Sync Active';
  }
} else if (hicModeStatus) {
  hicModeStatus.textContent = 'Native HTML-in-Canvas (texElementSubImage2D) + WebGL Shader Active';
}

// ============================================================================
// HTML-IN-CANVAS SPEC HELPERS (apply-webgl-shaders & interactive-content-in-3d-scenes)
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
  const width = Math.max(1, element.offsetWidth || 480);
  const height = Math.max(1, element.offsetHeight || 280);

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
// CATALOG OF TOY BOX CHARACTERS, CONTRAPTIONS & RESOURCES
// ============================================================================

const TOYBOX_ITEMS = [
  {
    id: 'beaver',
    name: 'Barnaby the Chisel Beaver',
    role: 'Master Timber Sculptor • Lv.1 MAX',
    badge: 'Woodland Artisan • Lv.1 MAX',
    quip: '“Meet the beaver — he uses a chisel even though he’s literally a beaver.”',
    lore: 'North Pole union rules strictly forbid gnawing on company timber. Besides, Barnaby spent four years at the Artisanal Carpentry Academy.',
    stat1: 'Output: Carved Planks',
    stat2: 'Teeth Used: 0%',
    sheetUrl: './assets/beaver_sheet.png',
    gridCols: 2,
    gridRows: 2,
    frameCount: 4,
    accentColor: '#2a7b4c',
    boxSlot: [-1.1, -1.1]
  },
  {
    id: 'owl',
    name: 'Professor Hoot’s Toy Assembler',
    role: 'Chief Locomotive Architect',
    badge: 'Master Engineer • Tier III',
    quip: '“Adjusts his brass spectacles 40 times a minute, turns a wrench once, and claims full credit for the train.”',
    lore: 'Sporting a dapper crimson bow tie, this hand-carved owl fuses wooden dowels and iron gears into wind-up holiday locomotives.',
    stat1: 'Crafts: Holiday Express',
    stat2: 'Bow Tie: Festive',
    sheetUrl: './assets/toy_assembler_sheet.png',
    gridCols: 2,
    gridRows: 2,
    frameCount: 4,
    accentColor: '#c4302b',
    boxSlot: [0.0, -1.1]
  },
  {
    id: 'squirrel',
    name: 'Twigs the Lathe Squirrel',
    role: 'High-RPM Dowel Spinner',
    badge: 'Woodland Artisan • Tier I',
    quip: '“Spins a precision wood-lathe at 3,000 RPM while fighting every instinct to bury the sticks for winter.”',
    lore: 'Feed him a rough timber log and he’ll shave it into symmetrically turned wooden rods faster than you can say acorn.',
    stat1: 'Output: Bundled Dowels',
    stat2: 'Lathe Speed: 3,000 RPM',
    sheetUrl: './assets/stick_maker_sheet.png',
    gridCols: 2,
    gridRows: 2,
    frameCount: 4,
    accentColor: '#2e6b9e',
    boxSlot: [1.1, -1.1]
  },
  {
    id: 'mole',
    name: 'Digby the Goggled Mole',
    role: 'Deep-Box Ore Prospector',
    badge: 'Sub-Box Excavator • Tier I',
    quip: '“Wears brass aviation goggles inside a wooden tabletop box and somehow strikes pure iron ore.”',
    lore: 'Physicists are baffled as to how a two-inch mahogany board contains a rich subterranean iron vein, and Digby isn’t talking.',
    stat1: 'Output: Raw Iron Ore',
    stat2: 'Goggle Polish: 100%',
    sheetUrl: './assets/iron_mine_sheet.png',
    gridCols: 2,
    gridRows: 2,
    frameCount: 4,
    accentColor: '#8c6239',
    boxSlot: [-1.1, 0.0]
  },
  {
    id: 'badger',
    name: 'Barnabas the Bellows Badger',
    role: 'Master Foundry Smelter',
    badge: 'Foundry Specialist • Tier II',
    quip: '“Operates a 2,000-degree brick blast-furnace inside a wooden toy box. Fire Marshal Santa has given up.”',
    lore: 'Pumps the leather bellows with holiday glee and pulls glowing-hot stamped metal plates straight from the brass-domed kiln.',
    stat1: 'Output: Stamped Iron',
    stat2: 'Kiln Temp: Cozy',
    sheetUrl: './assets/iron_smelter_sheet.png',
    gridCols: 2,
    gridRows: 2,
    frameCount: 4,
    accentColor: '#d9531e',
    boxSlot: [0.0, 0.0]
  },
  {
    id: 'merger',
    name: 'The Spring-Loaded Merger',
    role: 'Kinetic Component Fusion Press',
    badge: 'Clockwork Contraption • Tier II',
    quip: '“Clamps two perfectly good parts together with violent clockwork enthusiasm until they upgrade.”',
    lore: 'Driven by twin brass pinions and an industrial coil spring. Drop two matching resources on the golden anvil and stand back!',
    stat1: 'Action: 2-into-1 Upgrade',
    stat2: 'Torque: Maximum',
    sheetUrl: './assets/merger_sheet.png',
    gridCols: 2,
    gridRows: 2,
    frameCount: 4,
    accentColor: '#c9932c',
    boxSlot: [1.1, 0.0]
  },
  {
    id: 'bouncer',
    name: 'The Jolly Santa Bouncer',
    role: 'Spring-Loaded Velvet Ricochet Pad',
    badge: 'Festive Logistics • Bumper',
    quip: '“A crimson pinball bumper wearing a carved wooden Santa hat—boings your resources into next Tuesday.”',
    lore: 'Why build sensible conveyor belts when you can launch timber and iron plates across the board with festive kinetic physics?',
    stat1: 'Action: Grid Ricochet',
    stat2: 'Jolliness: 11/10',
    sheetUrl: './assets/santa_bouncer_sheet.png',
    gridCols: 2,
    gridRows: 2,
    frameCount: 4,
    accentColor: '#b92525',
    boxSlot: [-1.1, 1.1]
  },
  {
    id: 'santa',
    name: 'Father Christmas & The Magic Sack',
    role: 'VP of Toy Collection & Quality Control',
    badge: 'Holiday VIP • Goal Tile',
    quip: '“Stands in the corner holding a bottomless burlap sack, smiling warmly while judging your throughput.”',
    lore: 'Every finished toy bounces straight into his golden-trimmed sack with a burst of starlight before Christmas Eve!',
    stat1: 'Capacity: Infinite Toys',
    stat2: 'Ho-Ho-Hos: Continuous',
    sheetUrl: './assets/santa_sack_sheet.png',
    gridCols: 2,
    gridRows: 2,
    frameCount: 4,
    accentColor: '#c92828',
    boxSlot: [0.0, 1.1]
  },
  {
    id: 'resources',
    name: 'The Wind-Up Holiday Express',
    role: 'Crafted from Planks, Dowels, Ore & Gears',
    badge: 'Masterpiece Toy & Resources',
    quip: '“A wind-up toy train built inside a wind-up toy box—complete with its own tiny wind-up key on the cab.”',
    lore: 'If a wind-up wooden owl inside a wind-up toy box builds a wind-up locomotive with a wind-up key on the back, how deep does it go?!',
    stat1: 'Value: 100 Holiday Joy',
    stat2: 'Inception: Recursive',
    sheetUrl: './assets/resources_sheet.png',
    gridCols: 3,
    gridRows: 2,
    frameCount: 5,
    accentColor: '#d49b35',
    boxSlot: [1.1, 1.1]
  }
];

// ============================================================================
// THREE.JS SCENE, CAMERA & WEBGL2 RENDERER INITIALIZATION
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
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x130804);
scene.fog = new THREE.FogExp2(0x130804, 0.032);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 4.2, 9.8);
camera.lookAt(0, 0.4, 0);

// ============================================================================
// LIGHTING — WARM CANDLELIGHT WORKSHOP & FESTIVE CHRISTMAS RIM LIGHTS
// ============================================================================

const ambientLight = new THREE.AmbientLight(0xffe4b8, 0.72);
scene.add(ambientLight);

const mainSpotLight = new THREE.SpotLight(0xffdf9e, 65);
mainSpotLight.position.set(4.5, 11.5, 7.5);
mainSpotLight.angle = Math.PI / 3.2;
mainSpotLight.penumbra = 0.65;
mainSpotLight.decay = 1.4;
mainSpotLight.castShadow = true;
mainSpotLight.shadow.mapSize.set(2048, 2048);
mainSpotLight.shadow.bias = -0.0005;
scene.add(mainSpotLight);

const crimsonRimLight = new THREE.DirectionalLight(0xff4a3d, 1.6);
crimsonRimLight.position.set(-7, 4, -5);
scene.add(crimsonRimLight);

const pineRimLight = new THREE.DirectionalLight(0x45e08b, 1.15);
pineRimLight.position.set(7, 3, -6);
scene.add(pineRimLight);

// Interior Magical Box Core Light (brightens as the lid opens!)
const boxInteriorLight = new THREE.PointLight(0xffc94d, 0.5, 12, 1.5);
boxInteriorLight.position.set(0, 0.6, 0);
scene.add(boxInteriorLight);

// ============================================================================
// SPRITE SHEET LOADER & EDGE-FLOOD-FILL WHITE BACKGROUND KEYER
// ============================================================================

// Removes the outer white background of each sprite cell via border-seeded BFS
// flood-fill so interior whites (Santa's beard, Owl's eyes, steam puffs) stay opaque!
function extractCleanFramesFromSheet(img, cols, rows, count) {
  const cellW = Math.floor(img.width / cols);
  const cellH = Math.floor(img.height / rows);
  const frames = [];

  for (let idx = 0; idx < count; idx++) {
    const col = idx % cols;
    const row = Math.floor(idx / cols);

    const offCanvas = document.createElement('canvas');
    offCanvas.width = cellW;
    offCanvas.height = cellH;
    const ctx = offCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);

    const imgData = ctx.getImageData(0, 0, cellW, cellH);
    const data = imgData.data;
    const totalPixels = cellW * cellH;
    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    let head = 0;
    let tail = 0;

    const isNearWhite = (pIdx) => {
      const r = data[pIdx];
      const g = data[pIdx + 1];
      const b = data[pIdx + 2];
      const a = data[pIdx + 3];
      return a < 20 || (r > 236 && g > 234 && b > 230);
    };

    const enqueue = (x, y) => {
      if (x < 0 || x >= cellW || y < 0 || y >= cellH) return;
      const pos = y * cellW + x;
      if (visited[pos]) return;
      if (isNearWhite(pos * 4)) {
        visited[pos] = 1;
        queue[tail++] = pos;
      }
    };

    // Seed flood-fill along all 4 edges of the frame
    for (let x = 0; x < cellW; x++) {
      enqueue(x, 0);
      enqueue(x, cellH - 1);
    }
    for (let y = 0; y < cellH; y++) {
      enqueue(0, y);
      enqueue(cellW - 1, y);
    }

    while (head < tail) {
      const pos = queue[head++];
      const pIdx = pos * 4;
      data[pIdx + 3] = 0; // Make background transparent

      const x = pos % cellW;
      const y = (pos - x) / cellW;
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }

    // Soft anti-aliased edge feathering around flood-filled boundary
    for (let y = 1; y < cellH - 1; y++) {
      for (let x = 1; x < cellW - 1; x++) {
        const pos = y * cellW + x;
        if (visited[pos]) continue;
        if (
          visited[pos - 1] ||
          visited[pos + 1] ||
          visited[pos - cellW] ||
          visited[pos + cellW]
        ) {
          const pIdx = pos * 4;
          const lum = (data[pIdx] + data[pIdx + 1] + data[pIdx + 2]) / 3;
          if (lum > 205) {
            data[pIdx + 3] = Math.max(0, Math.min(255, Math.round((250 - lum) * 5)));
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(offCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    frames.push({ canvas: offCanvas, texture });
  }

  return frames;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ============================================================================
// BUILD THE ORNATE 3D MAGICAL TOY BOX IN THREE.JS
// ============================================================================

const toyBoxRoot = new THREE.Group();
scene.add(toyBoxRoot);

const textureLoader = new THREE.TextureLoader();
const woodGridTexture = textureLoader.load('./assets/grid_bg.png');
woodGridTexture.colorSpace = THREE.SRGBColorSpace;
woodGridTexture.anisotropy = 8;

// Shared Ornate Materials
const mahoganyMat = new THREE.MeshStandardMaterial({
  map: woodGridTexture,
  color: 0xd99b66,
  roughness: 0.42,
  metalness: 0.08
});

const darkCarvedWoodMat = new THREE.MeshStandardMaterial({
  color: 0x3b1b0c,
  roughness: 0.5,
  metalness: 0.1
});

const antiqueBrassMat = new THREE.MeshStandardMaterial({
  color: 0xe6b347,
  roughness: 0.24,
  metalness: 0.86
});

const festiveCrimsonMat = new THREE.MeshStandardMaterial({
  color: 0xb82222,
  roughness: 0.35,
  metalness: 0.25
});

const pineVelvetMat = new THREE.MeshStandardMaterial({
  color: 0x1a5434,
  roughness: 0.45,
  metalness: 0.15
});

// 1. Box Base & Pedestal Plinth
const boxWidth = 4.4;
const boxDepth = 4.4;
const boxHeight = 2.0;
const wallThickness = 0.26;

const basePlinth = new THREE.Mesh(
  new THREE.BoxGeometry(boxWidth + 0.45, 0.28, boxDepth + 0.45),
  darkCarvedWoodMat
);
basePlinth.position.y = -boxHeight / 2 - 0.12;
basePlinth.castShadow = true;
basePlinth.receiveShadow = true;
toyBoxRoot.add(basePlinth);

const brassBaseTrim = new THREE.Mesh(
  new THREE.BoxGeometry(boxWidth + 0.52, 0.09, boxDepth + 0.52),
  antiqueBrassMat
);
brassBaseTrim.position.y = -boxHeight / 2 + 0.01;
toyBoxRoot.add(brassBaseTrim);

// 4 Ornate Brass Claw/Ball Feet
const footPositions = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1]
];
footPositions.forEach(([fx, fz]) => {
  const foot = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 20), antiqueBrassMat);
  foot.position.set(
    fx * (boxWidth / 2 + 0.08),
    -boxHeight / 2 - 0.26,
    fz * (boxDepth / 2 + 0.08)
  );
  foot.scale.set(1.1, 0.75, 1.1);
  foot.castShadow = true;
  toyBoxRoot.add(foot);
});

// 2. Interior 3x3 Mahogany Game Board Floor
const interiorFloor = new THREE.Mesh(
  new THREE.BoxGeometry(boxWidth - wallThickness * 1.5, 0.18, boxDepth - wallThickness * 1.5),
  mahoganyMat
);
interiorFloor.position.y = -boxHeight / 2 + 0.22;
interiorFloor.receiveShadow = true;
toyBoxRoot.add(interiorFloor);

// Subtle Golden Grid Lines on the Interior 3x3 Floor
for (let i = -1; i <= 1; i += 2) {
  const lineX = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.02, boxDepth - 0.6),
    antiqueBrassMat
  );
  lineX.position.set(i * 0.65, -boxHeight / 2 + 0.32, 0);
  toyBoxRoot.add(lineX);

  const lineZ = new THREE.Mesh(
    new THREE.BoxGeometry(boxWidth - 0.6, 0.02, 0.03),
    antiqueBrassMat
  );
  lineZ.position.set(0, -boxHeight / 2 + 0.32, i * 0.65);
  toyBoxRoot.add(lineZ);
}

// 3. Four Ornate Outer Walls of the Toy Box
const frontBackGeo = new THREE.BoxGeometry(boxWidth, boxHeight, wallThickness);
const leftRightGeo = new THREE.BoxGeometry(wallThickness, boxHeight, boxDepth - wallThickness * 2);

const frontWall = new THREE.Mesh(frontBackGeo, mahoganyMat);
frontWall.position.set(0, 0, boxDepth / 2 - wallThickness / 2);
frontWall.castShadow = true;
frontWall.receiveShadow = true;
toyBoxRoot.add(frontWall);

const backWall = new THREE.Mesh(frontBackGeo, mahoganyMat);
backWall.position.set(0, 0, -boxDepth / 2 + wallThickness / 2);
backWall.castShadow = true;
backWall.receiveShadow = true;
toyBoxRoot.add(backWall);

const leftWall = new THREE.Mesh(leftRightGeo, mahoganyMat);
leftWall.position.set(-boxWidth / 2 + wallThickness / 2, 0, 0);
leftWall.castShadow = true;
leftWall.receiveShadow = true;
toyBoxRoot.add(leftWall);

const rightWall = new THREE.Mesh(leftRightGeo, mahoganyMat);
rightWall.position.set(boxWidth / 2 - wallThickness / 2, 0, 0);
rightWall.castShadow = true;
rightWall.receiveShadow = true;
toyBoxRoot.add(rightWall);

// Corner Brass Pillars & Festive Rivets
footPositions.forEach(([cx, cz]) => {
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, boxHeight + 0.08, 16),
    antiqueBrassMat
  );
  pillar.position.set(cx * (boxWidth / 2), 0, cz * (boxDepth / 2));
  pillar.castShadow = true;
  toyBoxRoot.add(pillar);

  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 16), antiqueBrassMat);
  finial.position.set(cx * (boxWidth / 2), boxHeight / 2 + 0.04, cz * (boxDepth / 2));
  toyBoxRoot.add(finial);
});

// Upper Brass Rim Molding
const rimThickness = 0.12;
const frontRim = new THREE.Mesh(
  new THREE.BoxGeometry(boxWidth + 0.2, rimThickness, 0.34),
  antiqueBrassMat
);
frontRim.position.set(0, boxHeight / 2, boxDepth / 2 - wallThickness / 2);
toyBoxRoot.add(frontRim);

const backRim = frontRim.clone();
backRim.position.set(0, boxHeight / 2, -boxDepth / 2 + wallThickness / 2);
toyBoxRoot.add(backRim);

// Front Ornate Brass Escutcheon Lock Plate & Festive Holly Crest
const lockPlate = new THREE.Mesh(
  new THREE.CylinderGeometry(0.45, 0.38, 0.12, 6),
  antiqueBrassMat
);
lockPlate.rotation.x = Math.PI / 2;
lockPlate.position.set(0, 0.22, boxDepth / 2 + 0.04);
toyBoxRoot.add(lockPlate);

const keyholeGlow = new THREE.Mesh(
  new THREE.CircleGeometry(0.12, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff0a8 })
);
keyholeGlow.position.set(0, 0.22, boxDepth / 2 + 0.11);
toyBoxRoot.add(keyholeGlow);

// Festive Holly Berries & Pine Leaves on the Front of the Box
for (let b = -1; b <= 1; b++) {
  const berry = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), festiveCrimsonMat);
  berry.position.set(b * 0.09, -0.25 + Math.abs(b) * 0.04, boxDepth / 2 + 0.06);
  toyBoxRoot.add(berry);
}
for (let l = -1; l <= 1; l += 2) {
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 4), pineVelvetMat);
  leaf.rotation.z = l * (Math.PI / 2.6);
  leaf.position.set(l * 0.26, -0.26, boxDepth / 2 + 0.04);
  toyBoxRoot.add(leaf);
}

// 4. Articulated Hinged Ornate Lid (pivots from the back top edge)
const lidPivotGroup = new THREE.Group();
lidPivotGroup.position.set(0, boxHeight / 2 + 0.04, -boxDepth / 2 + wallThickness / 2);
toyBoxRoot.add(lidPivotGroup);

const lidMain = new THREE.Mesh(
  new THREE.BoxGeometry(boxWidth + 0.16, 0.28, boxDepth + 0.16),
  mahoganyMat
);
lidMain.position.set(0, 0.14, boxDepth / 2 - wallThickness / 2);
lidMain.castShadow = true;
lidMain.receiveShadow = true;
lidPivotGroup.add(lidMain);

const lidCrown = new THREE.Mesh(
  new THREE.BoxGeometry(boxWidth - 0.65, 0.22, boxDepth - 0.65),
  darkCarvedWoodMat
);
lidCrown.position.set(0, 0.34, boxDepth / 2 - wallThickness / 2);
lidCrown.castShadow = true;
lidPivotGroup.add(lidCrown);

const lidGoldInlay = new THREE.Mesh(
  new THREE.BoxGeometry(boxWidth - 0.5, 0.06, boxDepth - 0.5),
  antiqueBrassMat
);
lidGoldInlay.position.set(0, 0.27, boxDepth / 2 - wallThickness / 2);
lidPivotGroup.add(lidGoldInlay);

//Front Clasp Hasps on Lid
const lidClasp = new THREE.Mesh(
  new THREE.BoxGeometry(0.36, 0.42, 0.12),
  antiqueBrassMat
);
lidClasp.position.set(0, -0.02, boxDepth - wallThickness / 2 + 0.06);
lidPivotGroup.add(lidClasp);

// 5. The 3D Wind-Up Turn Key on the Right Side of the Toy Box
const windupKeyGroup = new THREE.Group();
windupKeyGroup.position.set(boxWidth / 2 + 0.05, 0.05, 0);
toyBoxRoot.add(windupKeyGroup);

// Brass Collar Socket on the Right Wall
const keyCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.34, 0.38, 0.22, 24),
  antiqueBrassMat
);
keyCollar.rotation.z = -Math.PI / 2;
keyCollar.position.set(0.08, 0, 0);
windupKeyGroup.add(keyCollar);

// Rotating Shaft & Winged Bow
const keySpinnerGroup = new THREE.Group();
windupKeyGroup.add(keySpinnerGroup);

const keyShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 0.16, 1.25, 20),
  mahoganyMat
);
keyShaft.rotation.z = -Math.PI / 2;
keyShaft.position.set(0.68, 0, 0);
keyShaft.castShadow = true;
keySpinnerGroup.add(keyShaft);

const keyBrassRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.18, 0.045, 12, 24),
  antiqueBrassMat
);
keyBrassRing.rotation.y = Math.PI / 2;
keyBrassRing.position.set(0.75, 0, 0);
keySpinnerGroup.add(keyBrassRing);

// Double-looped 3D Key Bow + Textured Sprite Plane
const upperLoop = new THREE.Mesh(
  new THREE.TorusGeometry(0.46, 0.13, 16, 32),
  mahoganyMat
);
upperLoop.position.set(1.45, 0.48, 0);
upperLoop.castShadow = true;
keySpinnerGroup.add(upperLoop);

const lowerLoop = new THREE.Mesh(
  new THREE.TorusGeometry(0.46, 0.13, 16, 32),
  mahoganyMat
);
lowerLoop.position.set(1.45, -0.48, 0);
lowerLoop.castShadow = true;
keySpinnerGroup.add(lowerLoop);

const upperInnerBrass = new THREE.Mesh(
  new THREE.TorusGeometry(0.32, 0.035, 12, 24),
  antiqueBrassMat
);
upperInnerBrass.position.set(1.45, 0.48, 0);
keySpinnerGroup.add(upperInnerBrass);

const lowerInnerBrass = new THREE.Mesh(
  new THREE.TorusGeometry(0.32, 0.035, 12, 24),
  antiqueBrassMat
);
lowerInnerBrass.position.set(1.45, -0.48, 0);
keySpinnerGroup.add(lowerInnerBrass);

// ============================================================================
// CUSTOM WEBGL SHADERS (HTML-in-Canvas Card Shader + Holiday Particle Shader)
// ============================================================================

const hicCardVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uFocusStrength;
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    vNormal = normal;
    vec3 pos = position;

    // Gentle magical parchment float & corner curl when popping out
    float wave = sin(pos.x * 4.5 + uTime * 2.4) * cos(pos.y * 3.5 + uTime * 1.8);
    pos.z += wave * 0.018 * uFocusStrength;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const hicCardFragmentShader = /* glsl */ `
  uniform sampler2D uHtmlTexture;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFlipY;
  uniform vec2 uPointer;
  varying vec2 vUv;

  // Pseudo-random snow/gold sparkle generator
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    // Ornate animated gold-foil border shimmer (shared by front & back of card)
    vec2 edgeDist = min(vUv, 1.0 - vUv);
    float borderMask = smoothstep(0.048, 0.014, min(edgeDist.x, edgeDist.y));
    float foilWave = 0.5 + 0.5 * sin((vUv.x * 6.0 + vUv.y * 4.0) - uTime * 3.0);
    vec3 goldFoil = mix(vec3(0.83, 0.61, 0.21), vec3(1.0, 0.93, 0.60), foilWave);

    // When the card spins vertically front-over-back (rotateX), shade the ornate 3D backplate!
    if (!gl_FrontFacing) {
      vec2 centered = vUv - vec2(0.5);
      float radial = length(centered * vec2(1.65, 1.0));
      vec3 mahoganyBack = mix(vec3(0.22, 0.09, 0.04), vec3(0.10, 0.04, 0.02), radial * 1.25);

      // Engraved brass clockwork rosette rings on the backplate
      float ring1 = smoothstep(0.018, 0.0, abs(radial - 0.28));
      float ring2 = smoothstep(0.012, 0.0, abs(radial - 0.21));
      float spokes = smoothstep(0.92, 0.99, abs(sin(atan(centered.y, centered.x) * 12.0 + uTime * 1.5))) * step(radial, 0.28);
      float backEngraving = clamp(ring1 + ring2 + spokes * 0.65, 0.0, 1.0);

      vec3 backRgb = mix(mahoganyBack, goldFoil, max(borderMask * 0.85, backEngraving * 0.75));
      gl_FragColor = vec4(backRgb, uOpacity * 0.96);
      return;
    }

    vec2 baseUv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlipY));

    // Subtle lens ripple around pointer position
    vec2 dir = baseUv - uPointer;
    float dist = length(dir);
    vec2 rippleUv = baseUv + normalize(dir + 0.0001) * sin(dist * 28.0 - uTime * 5.0) * exp(-dist * 7.0) * 0.0035;

    vec4 texColor = texture2D(uHtmlTexture, clamp(rippleUv, 0.0, 1.0));

    // Diagonal holographic holiday sheen sweep across card surface
    float sheenPos = fract(uTime * 0.18);
    float sheen = smoothstep(0.14, 0.0, abs((vUv.x * 0.65 + vUv.y * 0.35) - sheenPos));
    vec3 sheenColor = vec3(1.0, 0.91, 0.65) * sheen * 0.18;

    // Tiny twinkling holiday sparkles along the card edges
    vec2 gridUv = floor(vUv * vec2(36.0, 22.0));
    float sparkNoise = hash(gridUv);
    float sparkTwinkle = pow(max(0.0, sin(uTime * 4.0 + sparkNoise * 6.2831)), 12.0);
    float sparkMask = step(0.92, sparkNoise) * borderMask * sparkTwinkle;

    vec3 finalRgb = texColor.rgb + sheenColor;
    finalRgb = mix(finalRgb, goldFoil, borderMask * 0.55);
    finalRgb += vec3(1.0, 0.97, 0.82) * sparkMask * 0.85;

    gl_FragColor = vec4(finalRgb, texColor.a * uOpacity);
  }
`;

// Festive Snow & Golden Workshop Dust Particle System
const particleCount = 420;
const particleGeo = new THREE.BufferGeometry();
const particlePositions = new Float32Array(particleCount * 3);
const particleScales = new Float32Array(particleCount);
const particleKinds = new Float32Array(particleCount); // 0 = gold ember, 1 = snowflake

for (let i = 0; i < particleCount; i++) {
  particlePositions[i * 3] = (Math.random() - 0.5) * 18;
  particlePositions[i * 3 + 1] = Math.random() * 11 - 2.5;
  particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 14;
  particleScales[i] = 0.5 + Math.random() * 1.5;
  particleKinds[i] = Math.random() > 0.45 ? 1.0 : 0.0;
}
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
particleGeo.setAttribute('aScale', new THREE.BufferAttribute(particleScales, 1));
particleGeo.setAttribute('aKind', new THREE.BufferAttribute(particleKinds, 1));

const particleShaderMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
  },
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uPixelRatio;
    attribute float aScale;
    attribute float aKind;
    varying float vKind;
    varying float vAlpha;

    void main() {
      vKind = aKind;
      vec3 pos = position;
      if (aKind > 0.5) {
        // Soft falling snow
        pos.y = mod(pos.y - uTime * (0.45 + aScale * 0.2) + 3.0, 12.0) - 3.0;
        pos.x += sin(uTime * 0.8 + position.z) * 0.35;
      } else {
        // Rising golden workshop magic dust
        pos.y = mod(pos.y + uTime * (0.55 + aScale * 0.25) + 3.0, 12.0) - 3.0;
        pos.x += cos(uTime * 1.1 + position.y) * 0.28;
      }
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = (18.0 * aScale * uPixelRatio) / -mvPosition.z;
      vAlpha = 0.55 + 0.45 * sin(uTime * 3.2 + aScale * 10.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vKind;
    varying float vAlpha;

    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      float glow = smoothstep(0.5, 0.05, d);
      vec3 snowColor = vec3(0.88, 0.96, 1.0);
      vec3 goldColor = vec3(1.0, 0.84, 0.38);
      vec3 col = mix(goldColor, snowColor, vKind);
      gl_FragColor = vec4(col, glow * vAlpha * 0.85);
    }
  `
});

const magicParticles = new THREE.Points(particleGeo, particleShaderMat);
scene.add(magicParticles);

// ============================================================================
// CREATE 3D CAROUSEL FIGURINE NODES & HTML-IN-CANVAS SHADER PLANES
// ============================================================================

const carouselGroup = new THREE.Group();
scene.add(carouselGroup);

const carouselNodes = [];
const spritePreviewCanvases = new Map();
document.querySelectorAll('.hic-sprite-preview').forEach((c) => {
  spritePreviewCanvases.set(c.dataset.sprite, c);
});

// Synthesizes a high-DPI 2D canvas fallback snapshot of a drawable card so the
// Three.js WebGL shader plane always displays rich typography, ornate borders,
// and the animated sprite even if native `texElementSubImage2D` is unavailable.
function renderCardFallbackSnapshot(cardCanvas, item, frameCanvas, isHero = false) {
  const ctx = cardCanvas.getContext('2d');
  const w = cardCanvas.width;
  const h = cardCanvas.height;
  ctx.clearRect(0, 0, w, h);

  // Rounded parchment/mahogany background
  const grad = ctx.createLinearGradient(0, 0, w, h);
  if (isHero) {
    grad.addColorStop(0, '#2c1409');
    grad.addColorStop(1, '#160904');
  } else {
    grad.addColorStop(0, '#fcf3df');
    grad.addColorStop(1, '#efd7aa');
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(8, 8, w - 16, h - 16, 26);
  ctx.fill();

  // Ornate Double Brass Border
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#d49b35';
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = isHero ? '#ffd86b' : '#8c5c16';
  ctx.strokeRect(20, 20, w - 40, h - 40);

  if (isHero) {
    ctx.fillStyle = '#ffd86b';
    ctx.font = 'bold 22px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('❄ ✦ NORTH POLE CLOCKWORK WORKSHOP ✦ ❄', w / 2, 68);
    ctx.font = 'bold 52px Georgia, serif';
    ctx.fillText('The Magical Toy Box', w / 2, 135);
    ctx.fillStyle = '#fbf2dc';
    ctx.font = '24px Optima, sans-serif';
    ctx.fillText('Crank the brass key & scroll to pop open the lid!', w / 2, 190);
    return;
  }

  // Draw Portrait Frame & Current Sprite Frame
  ctx.fillStyle = '#241108';
  ctx.beginPath();
  ctx.roundRect(38, 78, 190, 190, 20);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#d49b35';
  ctx.stroke();

  if (frameCanvas) {
    ctx.drawImage(frameCanvas, 46, 86, 174, 174);
  }

  // Header Badge
  ctx.fillStyle = item.accentColor || '#1e5938';
  ctx.beginPath();
  ctx.roundRect(38, 34, 340, 32, 16);
  ctx.fill();
  ctx.fillStyle = '#fbf2dc';
  ctx.font = 'bold 17px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(item.badge, 54, 56);

  // Title & Quip
  ctx.fillStyle = '#251309';
  ctx.font = 'bold 31px Georgia, serif';
  ctx.fillText(item.name, 250, 108);

  ctx.fillStyle = '#7c1313';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(item.role.toUpperCase(), 250, 134);

  // Wrap Quip Text
  ctx.fillStyle = '#251309';
  ctx.font = 'italic bold 21px Georgia, serif';
  const words = item.quip.split(' ');
  let line = '';
  let y = 172;
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    if (ctx.measureText(testLine).width > w - 285 && i > 0) {
      ctx.fillText(line, 250, y);
      line = words[i] + ' ';
      y += 27;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, 250, y);
}

// Helper to attach the 3D backplate (.hic-card-back) and interactive Spin 360° button
// using safe DOM creation APIs (createElement + textContent).
function enhanceCardWith3DBackplate(cardElement, item, index = null) {
  if (!cardElement) return;

  const backFace = document.createElement('div');
  backFace.className = 'hic-card-back';
  backFace.setAttribute('aria-hidden', 'true');

  const seal = document.createElement('span');
  seal.className = 'hic-back-seal';
  seal.textContent = '⚙';

  const title = document.createElement('span');
  title.className = 'hic-back-title';
  title.textContent = 'North Pole Clockwork Workshop • HTML-in-Canvas 3D Plate';

  const sub = document.createElement('span');
  sub.className = 'hic-back-sub';
  sub.textContent = item
    ? `${item.name} • Double-Sided WebGL & DOM Quad`
    : 'The Magical Toy Box • Festive Collectors Edition';

  backFace.appendChild(seal);
  backFace.appendChild(title);
  backFace.appendChild(sub);
  cardElement.appendChild(backFace);

  if (index !== null) {
    const footer = cardElement.querySelector('.hic-card-footer');
    const navPills = cardElement.querySelector('.hic-nav-pills');
    if (footer) {
      const flipBtn = document.createElement('button');
      flipBtn.type = 'button';
      flipBtn.className = 'btn-card-flip';
      flipBtn.dataset.flip = String(index);
      flipBtn.textContent = '🔄 Spin 360°';
      if (navPills) {
        footer.insertBefore(flipBtn, navPills);
      } else {
        footer.appendChild(flipBtn);
      }
    }
  }
}

enhanceCardWith3DBackplate(heroCard, null, null);

// Create the 3D Hero Plaque Mesh (for Stage 1)
const heroFallbackCanvas = document.createElement('canvas');
heroFallbackCanvas.width = 820;
heroFallbackCanvas.height = 320;
renderCardFallbackSnapshot(heroFallbackCanvas, null, null, true);

const heroFallbackTexture = new THREE.CanvasTexture(heroFallbackCanvas);
heroFallbackTexture.colorSpace = THREE.SRGBColorSpace;

const heroNativeGLTexture = gl.createTexture();
const heroTextureState = { width: 0, height: 0 };

const heroShaderMat = new THREE.ShaderMaterial({
  transparent: true,
  side: THREE.DoubleSide,
  uniforms: {
    uHtmlTexture: { value: heroFallbackTexture },
    uTime: { value: 0 },
    uFocusStrength: { value: 1.0 },
    uOpacity: { value: 1.0 },
    uFlipY: { value: 0.0 },
    uPointer: { value: new THREE.Vector2(0.5, 0.5) }
  },
  vertexShader: hicCardVertexShader,
  fragmentShader: hicCardFragmentShader
});

const heroCardMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 24, 24), heroShaderMat);
heroCardMesh.scale.set(4.5, 2.55, 1);
heroCardMesh.position.set(0, 2.55, 1.8);
scene.add(heroCardMesh);

// Build each of the 9 Carousel Nodes
TOYBOX_ITEMS.forEach((item, index) => {
  const domCard = itemCards[index];
  enhanceCardWith3DBackplate(domCard, item, index);

  const nodeGroup = new THREE.Group();
  carouselGroup.add(nodeGroup);

  // 1. Carved Wooden Pedestal & Spinning Brass Gear Base
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.82, 0.92, 0.24, 28),
    mahoganyMat
  );
  pedestal.position.y = -0.82;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  nodeGroup.add(pedestal);

  const gearRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.98, 0.98, 0.08, 16),
    antiqueBrassMat
  );
  gearRing.position.y = -0.92;
  nodeGroup.add(gearRing);

  // 2. Figurine Standee Billboard Mesh
  const standeeMat = new THREE.MeshStandardMaterial({
    transparent: true,
    alphaTest: 0.05,
    roughness: 0.35,
    metalness: 0.08,
    side: THREE.DoubleSide
  });
  const standeeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.95), standeeMat);
  standeeMesh.position.y = 0.15;
  standeeMesh.castShadow = true;
  nodeGroup.add(standeeMesh);

  // 3. 3D HTML-in-Canvas Collector Card Mesh with Custom Double-Sided WebGL Shader
  const fallbackCardCanvas = document.createElement('canvas');
  fallbackCardCanvas.width = 860;
  fallbackCardCanvas.height = 460;
  renderCardFallbackSnapshot(fallbackCardCanvas, item, null, false);

  const fallbackCardTexture = new THREE.CanvasTexture(fallbackCardCanvas);
  fallbackCardTexture.colorSpace = THREE.SRGBColorSpace;

  const nativeGLTexture = gl.createTexture();
  const textureState = { width: 0, height: 0 };

  const cardShaderMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uHtmlTexture: { value: fallbackCardTexture },
      uTime: { value: 0 },
      uFocusStrength: { value: 0.0 },
      uOpacity: { value: 0.0 },
      uFlipY: { value: 0.0 },
      uPointer: { value: new THREE.Vector2(0.5, 0.5) }
    },
    vertexShader: hicCardVertexShader,
    fragmentShader: hicCardFragmentShader
  });

  const cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 24, 24), cardShaderMat);
  cardMesh.scale.set(3.8, 2.15, 1);

  // Add a 3D Brass Trunnion Flip-Axle bar across the card so its vertical 3D rotation is unmistakable
  const axleRod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 1.06, 12),
    antiqueBrassMat
  );
  axleRod.rotation.z = Math.PI / 2;
  axleRod.position.z = -0.01;
  cardMesh.add(axleRod);

  [-0.53, 0.53].forEach((endX) => {
    const finialCap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 12), antiqueBrassMat);
    finialCap.position.set(endX, 0, -0.01);
    cardMesh.add(finialCap);
  });

  scene.add(cardMesh);

  carouselNodes.push({
    index,
    item,
    domCard,
    nodeGroup,
    pedestal,
    gearRing,
    standeeMesh,
    standeeMat,
    cardMesh,
    cardShaderMat,
    fallbackCardCanvas,
    fallbackCardTexture,
    nativeGLTexture,
    textureState,
    frames: [],
    currentFrameIndex: 0,
    lastFrameTime: 0,
    boostUntil: 0,
    targetFlipAngle: 0,
    smoothFlipAngle: 0
  });
});

// Load all sprite sheets and populate clean transparent frames
Promise.all(
  carouselNodes.map(async (node) => {
    try {
      const img = await loadImage(node.item.sheetUrl);
      node.frames = extractCleanFramesFromSheet(
        img,
        node.item.gridCols,
        node.item.gridRows,
        node.item.frameCount
      );
      if (node.frames.length > 0) {
        node.standeeMat.map = node.frames[0].texture;
        node.standeeMat.needsUpdate = true;
        renderCardFallbackSnapshot(
          node.fallbackCardCanvas,
          node.item,
          node.frames[0].canvas,
          false
        );
        node.fallbackCardTexture.needsUpdate = true;

        // Draw initial frame into the HTML card's <canvas class="hic-sprite-preview">
        const previewCanvas = spritePreviewCanvases.get(node.item.id);
        if (previewCanvas) {
          const pCtx = previewCanvas.getContext('2d');
          pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
          pCtx.drawImage(
            node.frames[0].canvas,
            0,
            0,
            previewCanvas.width,
            previewCanvas.height
          );
        }
      }
    } catch (err) {
      console.error('Failed to load sprite sheet:', node.item.sheetUrl, err);
    }
  })
).then(() => {
  if (typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
});

// ============================================================================
// RESIZE OBSERVER (MANDATORY PER MODERN WEB GUIDANCE)
// ============================================================================

function handleViewportResize(cssWidth, cssHeight, pixelW, pixelH) {
  if (cssWidth <= 0 || cssHeight <= 0) return;
  camera.aspect = cssWidth / cssHeight;
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

  canvas.width = pixelW;
  canvas.height = pixelH;
  handleViewportResize(entry.contentRect.width, entry.contentRect.height, pixelW, pixelH);

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
// INTERACTIVITY, EXACT SCROLL-STEP SNAPPING & SCROLL-SNAP-STATE-SYNC
// ============================================================================

// All 11 `.scroll-step` sections are uniform 100vh:
// Step 0: #step-hero
// Step 1: #step-opening
// Steps 2..10: #step-carousel-0 .. #step-carousel-8
const TOTAL_SCROLL_STEPS = 10; // 0..10 inclusive
let targetScrollStep = 0;
let smoothScrollStep = 0;
let snappedStepNumber = 0;
let manualKeyTurns = 0;
let smoothKeyTurns = 0;
const pointerNorm = new THREE.Vector2(0.5, 0.5);

function updateScrollTarget() {
  const stepHeight = Math.max(1, window.innerHeight);
  const rawStep = Math.max(0, Math.min(TOTAL_SCROLL_STEPS, window.scrollY / stepHeight));
  const nearestInt = Math.round(rawStep);

  // Magnetic snap zone: when within 9% of a section boundary, lock cleanly to the exact integer step
  if (Math.abs(rawStep - nearestInt) < 0.09) {
    targetScrollStep = nearestInt;
  } else {
    targetScrollStep = rawStep;
  }

  const normalizedProgress = targetScrollStep / TOTAL_SCROLL_STEPS;
  document.documentElement.style.setProperty('--scroll-progress', normalizedProgress.toFixed(4));
}

window.addEventListener('scroll', updateScrollTarget, { passive: true });
updateScrollTarget();

// Synchronize active state from CSS Scroll Snap via `scrollsnapchange` with IntersectionObserver fallback
function applySnappedSectionState(sectionEl) {
  if (!sectionEl) return;
  const stepNum = Number(sectionEl.dataset.stepNumber ?? 0);
  snappedStepNumber = stepNum;
  const activeCarouselIdx = stepNum >= 2 ? stepNum - 2 : -1;

  medallionButtons.forEach((btn, idx) => {
    const isCurrent = idx === activeCarouselIdx;
    btn.classList.toggle('is-active', isCurrent);
    if (isCurrent) {
      btn.setAttribute('aria-current', 'location');
    } else {
      btn.removeAttribute('aria-current');
    }
  });
}

const scrollSteps = Array.from(document.querySelectorAll('.scroll-step'));
if ('onscrollsnapchange' in window) {
  window.addEventListener('scrollsnapchange', (event) => {
    const snappedEl = event.snapTargetBlock;
    if (snappedEl && snappedEl.classList?.contains('scroll-step')) {
      applySnappedSectionState(snappedEl);
    }
  });
} else if ('IntersectionObserver' in window) {
  const snapObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          applySnappedSectionState(entry.target);
        }
      });
    },
    { threshold: 0.6 }
  );
  scrollSteps.forEach((stepEl) => snapObserver.observe(stepEl));
}

window.addEventListener('pointermove', (e) => {
  pointerNorm.x = e.clientX / Math.max(1, window.innerWidth);
  pointerNorm.y = 1.0 - e.clientY / Math.max(1, window.innerHeight);
});

function triggerCardVerticalFlip(targetIndex) {
  const node = carouselNodes[targetIndex];
  if (!node) return;
  node.targetFlipAngle += Math.PI * 2;
  if (typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
}

function triggerWindUpBurst(targetIndex = null) {
  manualKeyTurns += Math.PI * 2.5;
  const now = performance.now();
  if (targetIndex !== null && carouselNodes[targetIndex]) {
    carouselNodes[targetIndex].boostUntil = now + 2600;
  } else {
    carouselNodes.forEach((n) => {
      n.boostUntil = now + 2000;
    });
  }
  if (typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
}

function scrollToCarouselIndex(idx) {
  const wrapped = ((idx % TOYBOX_ITEMS.length) + TOYBOX_ITEMS.length) % TOYBOX_ITEMS.length;
  const targetSection = document.querySelector(
    `.step-carousel[data-carousel-index="${wrapped}"]`
  );
  if (targetSection) {
    targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Wire up buttons without any inline event handlers
document.getElementById('btn-crank-hero')?.addEventListener('click', () => {
  triggerWindUpBurst();
});

document.getElementById('btn-jump-carousel')?.addEventListener('click', () => {
  scrollToCarouselIndex(0);
});

document.getElementById('btn-wind-hud')?.addEventListener('click', () => {
  triggerWindUpBurst();
});

const shaderDialog = document.getElementById('shader-dialog');
document.getElementById('btn-open-shader-info')?.addEventListener('click', () => {
  if (shaderDialog && typeof shaderDialog.showModal === 'function') {
    shaderDialog.showModal();
  }
});

medallionButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.jump || 0);
    triggerWindUpBurst(idx);
    scrollToCarouselIndex(idx);
  });
});

document.querySelectorAll('.btn-card-action').forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.wind || 0);
    triggerWindUpBurst(idx);
    triggerCardVerticalFlip(idx);
  });
});

document.querySelectorAll('.btn-card-flip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.flip || 0);
    triggerWindUpBurst(idx);
    triggerCardVerticalFlip(idx);
  });
});

document.querySelectorAll('.btn-card-nav').forEach((btn) => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.hic-item-card');
    const currentIdx = Number(card?.dataset.index || 0);
    const delta = btn.dataset.nav === 'prev' ? -1 : 1;
    scrollToCarouselIndex(currentIdx + delta);
  });
});

// ============================================================================
// CORE 3D SCENE + HTML-IN-CANVAS GEOMETRY SYNC & ONPAINT HANDLER
// ============================================================================

const tempMVPMatrix = new THREE.Matrix4();
const tempViewProjMatrix = new THREE.Matrix4();

// Binds a raw WebGLTexture populated by `gl.texElementSubImage2D` into a
// Three.js Texture slot so Three.js's ShaderMaterial samples it directly.
function bindNativeHICTextureToThree(threeTex, nativeGLTex, shaderMat) {
  const texProps = renderer.properties.get(threeTex);
  texProps.__webglTexture = nativeGLTex;
  texProps.__webglInit = true;
  threeTex.needsUpdate = false;
  shaderMat.uniforms.uFlipY.value = 1.0;
}

function syncElementWithMesh(element, mesh, isVisible, opacity, flipAngleX = 0, tiltAngleY = 0) {
  if (!element) return;

  if (!isVisible || opacity < 0.04) {
    if (supportsNativeHIC && typeof canvas.clearElementGeometry === 'function') {
      canvas.clearElementGeometry(element);
    }
    element.style.opacity = '0';
    element.style.pointerEvents = 'none';
    element.setAttribute('inert', '');
    return;
  }

  element.removeAttribute('inert');
  // Keep interactive buttons clickable whenever the card is predominantly facing front and opaque
  const cosFlip = Math.cos(flipAngleX);
  element.style.pointerEvents = opacity > 0.65 && cosFlip > 0.35 ? 'auto' : 'none';

  // Compute WebGL Model-View-Projection matrix for the unit-square mesh
  mesh.updateMatrixWorld();
  tempViewProjMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  tempMVPMatrix.multiplyMatrices(tempViewProjMatrix, mesh.matrixWorld);

  const canvasTransform = computeCanvasTransform(canvas, element, tempMVPMatrix.elements);

  if (supportsNativeHIC && typeof canvas.updateElementGeometry === 'function') {
    canvas.updateElementGeometry(element, {
      canvasTransform,
      preserveHitTestOrder: true
    });
    element.style.opacity = String(opacity);
  } else {
    // 3D DOM Matrix + Perspective Spin Sync: positions the card at its 3D anchor and
    // rotates it vertically front-over-back (rotateX) in lockstep with the WebGL plane!
    const screenPos = new THREE.Vector3();
    mesh.getWorldPosition(screenPos);
    screenPos.project(camera);

    const cx = (screenPos.x * 0.5 + 0.5) * canvas.clientWidth;
    const cy = (-screenPos.y * 0.5 + 0.5) * canvas.clientHeight;
    const w = element.offsetWidth || 490;
    const h = element.offsetHeight || 280;

    const fitScale = Math.min(1, (canvas.clientWidth * 0.5) / Math.max(1, w));
    const tx = Math.max(16, Math.min(canvas.clientWidth - w * fitScale - 16, cx - (w * fitScale) / 2));
    const ty = Math.max(76, Math.min(canvas.clientHeight - h * fitScale - 48, cy - (h * fitScale) / 2));

    const flipDeg = ((flipAngleX * 180) / Math.PI).toFixed(2);
    const tiltYDeg = ((tiltAngleY * 180) / Math.PI).toFixed(2);

    element.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${fitScale.toFixed(3)}) rotateY(${tiltYDeg}deg) rotateX(${flipDeg}deg)`;
    element.style.opacity = String(opacity);
  }
}

function updateSceneAndSyncDOM(nowMs, changedElementsSet = null) {
  const timeSec = nowMs * 0.001;

  // Smoothly interpolate scroll step (0..10) & snap cleanly to exact integers when settled
  smoothScrollStep += (targetScrollStep - smoothScrollStep) * 0.13;
  if (
    Math.abs(targetScrollStep - Math.round(targetScrollStep)) < 0.001 &&
    Math.abs(smoothScrollStep - targetScrollStep) < 0.005
  ) {
    smoothScrollStep = targetScrollStep;
  }

  smoothKeyTurns += (manualKeyTurns - smoothKeyTurns) * 0.12;

  const s = smoothScrollStep; // 0 = Hero, 1 = Opening, 2..10 = Carousel Figurines 0..8
  const p = s / TOTAL_SCROLL_STEPS;

  // Exact stage curves keyed directly to uniform 100vh step numbers:
  // Step 0: Sealed Toy Box + Hero Plaque
  // Step 1: Winding Key & Popping Open Lid
  // Steps 2..10: Swirling 3D Carousel (Step 2 = Item 0, Step 3 = Item 1, ..., Step 10 = Item 8)
  const openProgress = THREE.MathUtils.smoothstep(s, 0.12, 0.92);
  const popOutProgress = THREE.MathUtils.smoothstep(s, 0.2, 1.65);
  const carouselActive = THREE.MathUtils.smoothstep(s, 1.15, 1.9);

  // Exact carousel index (0.000 at Step 2, 1.000 at Step 3, ..., 8.000 at Step 10)
  const rawCarouselFloat = THREE.MathUtils.clamp(s - 2.0, 0, TOYBOX_ITEMS.length - 1);
  const activeFocusIndex = Math.round(rawCarouselFloat);

  // Update HUD labels & active medallion
  if (s < 0.65) {
    hudStageLabel.textContent = 'Stage 1: The Sealed Mahogany Toy Box';
    scrollPromptText.textContent = 'Scroll down to crank the wind-up key & unlock the lid';
  } else if (s < 1.65) {
    hudStageLabel.textContent = 'Stage 2: Winding the Key & Popping Open the Workshop!';
    scrollPromptText.textContent = 'Keep scrolling as the wooden artisans pop out of the box!';
  } else {
    const focusedItem = TOYBOX_ITEMS[activeFocusIndex] || TOYBOX_ITEMS[0];
    hudStageLabel.textContent = `Carousel Focus (${activeFocusIndex + 1}/9): ${focusedItem.name}`;
    scrollPromptText.textContent =
      'Scroll to spin cards vertically in 3D or click 🔄 Spin 360° on any card!';
  }

  medallionButtons.forEach((btn, idx) => {
    const isCurrent = s >= 1.65 && idx === activeFocusIndex;
    btn.classList.toggle('is-active', isCurrent);
    if (isCurrent) {
      btn.setAttribute('aria-current', 'location');
    } else if (snappedStepNumber < 2) {
      btn.removeAttribute('aria-current');
    }
  });

  // 1. Animate the Wind-Up Turn Key & HUD RPM
  const totalKeyAngle = p * Math.PI * 18 + smoothKeyTurns + timeSec * 0.6;
  keySpinnerGroup.rotation.x = totalKeyAngle;
  const deg = Math.round((totalKeyAngle * 180) / Math.PI) % 360;
  document.documentElement.style.setProperty('--crank-angle', `${deg}deg`);
  const rpm = Math.round(30 + openProgress * 90 + (manualKeyTurns - smoothKeyTurns) * 15);
  if (hudRpmText) {
    hudRpmText.textContent = `${rpm} RPM`;
  }

  // 2. Animate the Ornate Toy Box Position, Lid & Interior Glow
  lidPivotGroup.rotation.x = -openProgress * 2.05; // Swings open ~117 degrees
  boxInteriorLight.intensity = 0.5 + openProgress * 18.0;

  // Shift box slightly back & down during carousel stage so focused figure + card shine in front
  const isNarrow = window.innerWidth < 860;
  toyBoxRoot.position.x = THREE.MathUtils.lerp(0, isNarrow ? 0 : -1.25, carouselActive);
  toyBoxRoot.position.y =
    THREE.MathUtils.lerp(-0.35, -1.35, carouselActive) + Math.sin(timeSec * 1.6) * 0.06;
  toyBoxRoot.position.z = THREE.MathUtils.lerp(0.2, -1.8, carouselActive);
  toyBoxRoot.rotation.y =
    Math.sin(timeSec * 0.45) * 0.12 + p * 0.35 * (1.0 - carouselActive * 0.6);

  // 3. Update Hero HTML-in-Canvas Plaque (visible in Step 0, flips vertically as you scroll to Step 1)
  const heroOpacity = 1.0 - THREE.MathUtils.smoothstep(s, 0.15, 0.85);
  const heroFlipX = THREE.MathUtils.smoothstep(s, 0.05, 0.85) * Math.PI;
  heroCardMesh.visible = supportsNativeHIC ? heroOpacity > 0.02 : false;
  heroCardMesh.position.set(0, 2.35 + (1.0 - heroOpacity) * 0.8, 2.2);
  heroCardMesh.rotation.x = heroFlipX;
  heroShaderMat.uniforms.uTime.value = timeSec;
  heroShaderMat.uniforms.uOpacity.value = heroOpacity;
  heroShaderMat.uniforms.uPointer.value.copy(pointerNorm);

  if (supportsNativeHIC && heroOpacity > 0.02) {
    if (!changedElementsSet || changedElementsSet.has(heroCard) || heroTextureState.width === 0) {
      try {
        if (uploadElementWebGL(gl, canvas, heroNativeGLTexture, heroCard, heroTextureState)) {
          bindNativeHICTextureToThree(heroFallbackTexture, heroNativeGLTexture, heroShaderMat);
        }
      } catch (_e) {
        // Retry on next paint event
      }
    }
  }
  syncElementWithMesh(heroCard, heroCardMesh, heroOpacity > 0.02, heroOpacity, heroFlipX, 0);

  // 4. Update all 9 Pop-Out Figurines & Vertically Spinning 3D Carousel Cards
  const count = carouselNodes.length;
  const ringRadiusX = isNarrow ? 3.2 : 4.35;
  const ringRadiusZ = isNarrow ? 2.8 : 3.55;

  carouselNodes.forEach((node, i) => {
    // Interpolate any manual 360° vertical flip triggered by clicking "🔄 Spin 360°"
    node.smoothFlipAngle += (node.targetFlipAngle - node.smoothFlipAngle) * 0.12;

    // Advance sprite-sheet animation frame (faster when cranked!)
    const isBoosted = nowMs < node.boostUntil;
    const frameInterval = isBoosted ? 110 : 320;
    if (node.frames.length > 1 && nowMs - node.lastFrameTime > frameInterval) {
      node.lastFrameTime = nowMs;
      node.currentFrameIndex = (node.currentFrameIndex + 1) % node.frames.length;
      const activeFrame = node.frames[node.currentFrameIndex];
      node.standeeMat.map = activeFrame.texture;
      node.standeeMat.needsUpdate = true;

      // Update the 2D canvas portrait inside the HTML card
      const previewCanvas = spritePreviewCanvases.get(node.item.id);
      if (previewCanvas) {
        const pCtx = previewCanvas.getContext('2d');
        pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        pCtx.drawImage(
          activeFrame.canvas,
          0,
          0,
          previewCanvas.width,
          previewCanvas.height
        );
      }

      if (!supportsNativeHIC) {
        renderCardFallbackSnapshot(
          node.fallbackCardCanvas,
          node.item,
          activeFrame.canvas,
          false
        );
        node.fallbackCardTexture.needsUpdate = true;
      }
    }

    // Staggered pop-out progress for this figurine
    const stagger = i * 0.025;
    const itemPop = THREE.MathUtils.clamp((popOutProgress - stagger) / (1.0 - stagger * 0.5), 0, 1);

    // Start position: nestled inside the 3x3 mahogany toy box grid
    const [slotX, slotZ] = node.item.boxSlot;
    const startPos = new THREE.Vector3(
      toyBoxRoot.position.x + slotX * 0.85,
      toyBoxRoot.position.y - 0.35,
      toyBoxRoot.position.z + slotZ * 0.85
    );

    // Swirling Carousel angle: snaps item `rawCarouselFloat` to angle 0 (front-and-center!)
    const relativeIdx = i - rawCarouselFloat;
    const absRel = Math.abs(relativeIdx);
    const angle = relativeIdx * ((Math.PI * 2) / count) + (1.0 - carouselActive) * Math.PI * 0.65;

    // Flat-top focus plateau so snapped items are 100% focused and 100% opaque
    const focusPlateau = absRel < 0.14 ? 1.0 : Math.max(0, 1.0 - (absRel - 0.14) * 1.32);
    const focusProximity = focusPlateau * carouselActive;
    const focusShiftX = isNarrow ? 0 : -1.55 * focusProximity;
    const focusShiftZ = 1.35 * focusProximity;
    const focusLiftY = 0.35 * focusProximity;

    const ringPos = new THREE.Vector3(
      Math.sin(angle) * ringRadiusX + focusShiftX,
      -0.15 + Math.cos(angle * 2.0 + timeSec) * 0.12 + focusLiftY,
      Math.cos(angle) * ringRadiusZ - 0.5 + focusShiftZ
    );

    // Parabolic pop-out arc height (`sin(itemPop * PI)`)
    const arcLift = Math.sin(itemPop * Math.PI) * 3.1;
    node.nodeGroup.position.lerpVectors(startPos, ringPos, itemPop);
    node.nodeGroup.position.y += arcLift;

    // Scale from 0.01 inside closed box to full size in carousel (and larger when focused!)
    const baseScale = THREE.MathUtils.lerp(0.01, 0.72 + focusProximity * 0.54, itemPop);
    const bounceScale = isBoosted ? 1.0 + Math.sin(nowMs * 0.03) * 0.12 : 1.0;
    node.nodeGroup.scale.setScalar(baseScale * bounceScale);
    node.nodeGroup.visible = itemPop > 0.02;

    // Spin pedestal brass gear & orient figurine standee toward camera
    node.gearRing.rotation.y = totalKeyAngle * (i % 2 === 0 ? 1 : -1);
    node.nodeGroup.lookAt(camera.position.x, node.nodeGroup.position.y + 0.3, camera.position.z);

    // Card Opacity: Guaranteed 1.0 (100% opaque) when snapped in focus (`absRel < 0.16`),
    // while staying visible across transitions (`absRel < 0.85`) so you see the full vertical 3D flip!
    const cardOpacity =
      absRel < 0.16 && carouselActive > 0.95
        ? 1.0
        : THREE.MathUtils.smoothstep(focusProximity, 0.08, 0.68);
    const isCardVisible = cardOpacity > 0.04;
    node.cardMesh.visible = isCardVisible;

    // Vertical Front-Over-Back Spin (`rotateX`):
    // Within the snap deadzone (`absRel <= 0.07`), scrollFlipRad = 0 (card is 100% flat & readable).
    // Between steps (`0.07 < absRel < 1.0`), the card performs a full 360° vertical front-over-back
    // somersault (`Math.PI * 2`) around its horizontal brass trunnion axle!
    const flipDeadzone = 0.07;
    const normalizedScrollFlip =
      absRel <= flipDeadzone
        ? 0
        : Math.sign(relativeIdx) * ((absRel - flipDeadzone) / (1.0 - flipDeadzone));
    const scrollFlipRad = -normalizedScrollFlip * Math.PI * 2.0;
    const pointerTiltX = absRel <= flipDeadzone ? (pointerNorm.y - 0.5) * 0.06 : 0;
    const totalFlipX = scrollFlipRad + node.smoothFlipAngle + pointerTiltX;
    const tiltY = isNarrow ? 0 : -0.14 + (pointerNorm.x - 0.5) * 0.08;

    if (isCardVisible) {
      const cardX = isNarrow ? 0 : 1.85;
      // Slight vertical Rolodex arc offset as cards flip in from below and out toward the top
      const rolodexArcY = -normalizedScrollFlip * 0.65;
      const cardY =
        (isNarrow ? -1.15 : 0.35 + Math.sin(timeSec * 2.0) * 0.04) + rolodexArcY;
      const cardZ = 3.1 - Math.abs(normalizedScrollFlip) * 0.35;

      node.cardMesh.position.set(cardX, cardY, cardZ);
      node.cardMesh.rotation.order = 'YXZ';
      node.cardMesh.rotation.y = tiltY;
      node.cardMesh.rotation.x = totalFlipX;

      node.cardShaderMat.uniforms.uTime.value = timeSec;
      node.cardShaderMat.uniforms.uFocusStrength.value = focusProximity;
      node.cardShaderMat.uniforms.uOpacity.value = supportsNativeHIC ? cardOpacity : cardOpacity * 0.55;
      node.cardShaderMat.uniforms.uPointer.value.copy(pointerNorm);

      if (supportsNativeHIC) {
        if (
          !changedElementsSet ||
          changedElementsSet.has(node.domCard) ||
          node.textureState.width === 0
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
              bindNativeHICTextureToThree(
                node.fallbackCardTexture,
                node.nativeGLTexture,
                node.cardShaderMat
              );
            }
          } catch (_err) {
            // Will retry on next paint event
          }
        }
      }
    }

    syncElementWithMesh(node.domCard, node.cardMesh, isCardVisible, cardOpacity, totalFlipX, tiltY);
  });

  // 5. Update Magic Snow & Gold Dust Shader
  particleShaderMat.uniforms.uTime.value = timeSec;

  // 6. Render Three.js Scene
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
    updateSceneAndSyncDOM(performance.now(), changedSet);
  };
}

// Main Animation Loop
function renderLoop(nowMs) {
  paintedThisFrame = false;
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
  if (!paintedThisFrame) {
    updateSceneAndSyncDOM(nowMs, null);
  }
  requestAnimationFrame(renderLoop);
}

requestAnimationFrame(renderLoop);
