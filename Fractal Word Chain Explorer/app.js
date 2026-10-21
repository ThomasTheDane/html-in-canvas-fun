/**
 * AI Fractal Word Chain Explorer — Main Application & HTML-in-Canvas Engine
 *
 * Visualizes on-device Causal LLM next-token probability distributions (`softmax(logits)`)
 * as an interactive, splintering fractal tree using Transformers.js (in a Web Worker)
 * and the HTML-in-Canvas API (`content="drawable"`, `drawable`, `drawElementImage`,
 * `updateElementGeometry`) with a synchronized DOM fallback layer.
 */

const canvas = document.getElementById('fractal-canvas');
const canvasViewport = document.getElementById('canvas-viewport');
const ctx = canvas.getContext('2d');

// UI Controls
const modelSelect = document.getElementById('model-select');
const btnLoadModel = document.getElementById('btn-load-model');
const modelStatusDot = document.getElementById('model-status-dot');
const modelStatusText = document.getElementById('model-status-text');
const hardwareBadge = document.getElementById('hardware-badge');
const modelProgressBar = document.getElementById('model-progressbar');
const modelProgressFill = document.getElementById('model-progress-fill');

const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const promptError = document.getElementById('prompt-error');
const btnSubmitPrompt = document.getElementById('btn-submit-prompt');
const btnAbortGen = document.getElementById('btn-abort-gen');
const tempSlider = document.getElementById('temp-slider');
const tempValLabel = document.getElementById('temp-val-label');
const preferWordsToggle = document.getElementById('prefer-words-toggle');

const activeChainTokensEl = document.getElementById('active-chain-tokens');
const chainProbSummaryEl = document.getElementById('chain-prob-summary');
const btnExpandActive = document.getElementById('btn-expand-active');
const btnPromoteRoot = document.getElementById('btn-promote-root');
const btnCopyChain = document.getElementById('btn-copy-chain');

const genActivityDot = document.getElementById('gen-activity-dot');
const telemetryText = document.getElementById('telemetry-text');
const hicBadge = document.getElementById('hic-badge');
const wordBufferSpinnerWrap = document.getElementById('word-buffer-spinner-wrap');
const wordBufferSpinnerLabel = document.getElementById('word-buffer-spinner-label');
const btnToggleRenderMode = document.getElementById('btn-toggle-render-mode');
const btnStageModeToggle = document.getElementById('btn-stage-mode-toggle');

const btnStepBack = document.getElementById('btn-step-back');
const btnStepForward = document.getElementById('btn-step-forward');
const btnFitTree = document.getElementById('btn-fit-tree');
const btnCenterSelected = document.getElementById('btn-center-selected');
const autoFollowToggle = document.getElementById('auto-follow-toggle');

// Optional Inspector Elements (kept for data reference)
const inspectorNodeLabel = document.getElementById('inspector-node-label');
const metricStepProb = document.getElementById('metric-step-prob');
const metricEntropy = document.getElementById('metric-entropy');
const metricDepth = document.getElementById('metric-depth');
const metricLatency = document.getElementById('metric-latency');
const topMassBadge = document.getElementById('top-mass-badge');
const distributionContextText = document.getElementById('distribution-context-text');
const siblingBarsList = document.getElementById('sibling-bars-list');
const inspectorPhraseBox = document.getElementById('inspector-phrase-box');
const btnInspectorExpand = document.getElementById('btn-inspector-expand');

// ============================================================================
// 0. DECLARATIVE INVOKER COMMANDS & POPOVER POLYFILL FEATURE DETECTION
// ============================================================================

if (!('commandForElement' in HTMLButtonElement.prototype)) {
  import('https://esm.run/invokers-polyfill').catch(() => {});
}

if (!('popover' in HTMLElement.prototype)) {
  import('https://unpkg.com/@oddbird/popover-polyfill@latest/dist/popover.min.js').catch(() => {});
}

// ============================================================================
// 1. HTML-IN-CANVAS FEATURE DETECTION & FALLBACK LAYER SETUP
// ============================================================================

const supportsNativeHIC =
  'content' in HTMLCanvasElement.prototype &&
  typeof ctx.drawElementImage === 'function' &&
  typeof canvas.updateElementGeometry === 'function';

let domNodeContainer = canvas;
if (!supportsNativeHIC) {
  const overlay = document.createElement('div');
  overlay.className = 'fractal-dom-overlay';
  overlay.id = 'fractal-dom-overlay';
  canvasViewport.insertBefore(overlay, canvas.nextSibling);
  domNodeContainer = overlay;
  if (hicBadge) {
    hicBadge.textContent = 'Canvas 2D Splines + 3D Matrix DOM Sync Active';
  }
} else if (hicBadge) {
  hicBadge.textContent = 'Native HTML-in-Canvas (drawElementImage) Active';
}

// ============================================================================
// 2. RESIZE OBSERVER (MANDATORY PER MODERN WEB GUIDANCE)
// ============================================================================

let viewportCssWidth = 1080;
let viewportCssHeight = 640;
let devicePixelScale = window.devicePixelRatio || 1;

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
  viewportCssWidth = Math.max(1, entry.contentRect.width);
  viewportCssHeight = Math.max(1, entry.contentRect.height);
  devicePixelScale = canvas.width / viewportCssWidth;

  if (treeNodes && treeNodes.size > 0) {
    recomputeTreeLayout();
  }

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
// 3. HARDWARE CAPABILITY CHECK & WEB WORKER INITIALIZATION
// ============================================================================

async function checkHardwareStatus() {
  if (!hardwareBadge) return;
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        hardwareBadge.textContent = 'WebGPU Ready (q4f16)';
        return;
      }
    } catch (_e) {
      // Fallback below
    }
  }
  hardwareBadge.textContent = 'WASM SIMD (q4)';
}
checkHardwareStatus();

const worker = new Worker('./llm-worker.js', { type: 'module' });
let isModelReady = false;
let isModelLoading = false;
let loadedModelId = null;
let isGenerating = false;
let pendingActionAfterLoad = null;

function setModelStatusUI(state, message, percent = null) {
  if (modelStatusDot) {
    modelStatusDot.className = `status-pill status-${state}`;
  }
  if (modelStatusText) {
    modelStatusText.textContent = message;
  }
  if (percent !== null && modelProgressFill && modelProgressBar) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    modelProgressFill.style.width = `${clamped}%`;
    modelProgressBar.setAttribute('aria-valuenow', String(clamped));
  }
}

function setGeneratingUI(busy, statusMsg) {
  isGenerating = busy;
  if (btnAbortGen) btnAbortGen.hidden = !busy;
  if (btnSubmitPrompt) btnSubmitPrompt.disabled = busy;
  if (genActivityDot) genActivityDot.classList.toggle('is-busy', busy);
  if (statusMsg && telemetryText) {
    telemetryText.textContent = statusMsg;
  }
}

// ============================================================================
// 4. SENTENCE STREAM & VERTICAL NEXT-WORD COLUMN LAYOUT ENGINE
// ============================================================================

const treeNodes = new Map(); // nodeId -> NodeObject
let rootNodeId = 'root';
let sentencePath = ['root']; // Ordered array of nodeIds forming the sentence developed thus far
let selectedNodeId = 'root'; // Always equals sentencePath[sentencePath.length - 1]
let highlightedOptionId = null; // Currently highlighted next-word candidate to join the sentence
let hoveredNodeId = null;
let manualPanOffsetX = 0;
const autoExpandedNodeIds = new Set();

// Expose full underlying probability distribution & entropy data
window.fractalChainData = {
  treeNodes,
  getSentencePath: () => sentencePath.map((id) => treeNodes.get(id)).filter(Boolean),
  getSelectedNode: () => treeNodes.get(selectedNodeId),
  getHighlightedOption: () => (highlightedOptionId ? treeNodes.get(highlightedOptionId) : null),
  getPathToNode
};

// Camera state (in CSS pixels; world Y=0 maps to vertical center of chart window)
const camera = {
  x: 36,
  y: 320,
  zoom: 1.0,
  targetX: 36,
  targetY: 320,
  targetZoom: 1.0
};

function clearTreeDOMAndState() {
  treeNodes.forEach((node) => {
    if (node.domEl) {
      if (supportsNativeHIC && typeof canvas.clearElementGeometry === 'function') {
        try {
          canvas.clearElementGeometry(node.domEl);
        } catch (_e) {
          // Ignore
        }
      }
      node.domEl.remove();
    }
  });
  treeNodes.clear();
  sentencePath = ['root'];
  selectedNodeId = 'root';
  highlightedOptionId = null;
  hoveredNodeId = null;
  manualPanOffsetX = 0;
  autoExpandedNodeIds.clear();
}

function formatProbPercent(prob) {
  const pct = prob * 100;
  if (pct >= 99.95) return '100%';
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

/**
 * Safely creates a semantic `<button drawable class="fractal-node-el">` using
 * `document.createElement` and `textContent` (no `innerHTML`).
 * Places a small probability % box at the top-left of the word so it never
 * interrupts the horizontal reading flow of the sentence.
 */
function createDrawableNodeElement(node) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('drawable', '');
  btn.dataset.nodeId = node.id;

  const isRoot = node.id === 'root';
  btn.className = `fractal-node-el ${isRoot ? 'is-root' : 'is-hidden-node'}`;

  if (!isRoot) {
    const probSpan = document.createElement('span');
    probSpan.className = 'node-prob-pill';
    probSpan.textContent = formatProbPercent(node.prob);
    btn.appendChild(probSpan);
  }

  const wordSpan = document.createElement('span');
  wordSpan.className = 'node-word-text';
  wordSpan.textContent = node.display;
  btn.appendChild(wordSpan);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleNodeClick(node.id);
  });

  btn.addEventListener('pointermove', () => {
    handleNodeHover(node.id);
  });

  btn.addEventListener('pointerenter', () => {
    handleNodeHover(node.id);
  });

  btn.addEventListener('pointerleave', () => {
    if (hoveredNodeId === node.id) {
      hoveredNodeId = null;
      renderActiveChainRibbon(getPathToNode(selectedNodeId));
    }
  });

  domNodeContainer.appendChild(btn);
  return btn;
}

let lastTipRightWorldX = 0;
let lastCol2LeftWorldX = 0;

function setHighlightedOption(optionId) {
  if (!optionId || !treeNodes.has(optionId)) return;
  if (highlightedOptionId !== optionId) {
    highlightedOptionId = optionId;
    recomputeTreeLayout();
    maybeTriggerAutoExpansion();
  }
  renderActiveChainRibbon(getPathToNode(optionId));
  updateInspectorPanel(optionId);
}

function handleNodeHover(nodeId) {
  const node = treeNodes.get(nodeId);
  if (!node) return;
  hoveredNodeId = nodeId;

  const tipNode = treeNodes.get(selectedNodeId);
  if (!tipNode) return;

  // If hovering one of the immediate next-word options (Column 1), highlight it & show its next words!
  if (tipNode.childrenIds.includes(nodeId)) {
    setHighlightedOption(nodeId);
    return;
  }

  // If hovering a lookahead option in Column 2, preview its full phrase in the top bar
  renderActiveChainRibbon(getPathToNode(nodeId));
  updateInspectorPanel(nodeId);
}

/**
 * Returns the ordered array of nodes from `root` to `targetNodeId`.
 */
function getPathToNode(targetNodeId) {
  const path = [];
  let curr = treeNodes.get(targetNodeId);
  while (curr) {
    path.push(curr);
    curr = curr.parentId ? treeNodes.get(curr.parentId) : null;
  }
  return path.reverse();
}

/**
 * Measures the natural width of the word text inside a node button.
 */
function getNodeWordWidth(node, fallback = 110) {
  if (!node || !node.domEl) return fallback;
  const wordSpan = node.domEl.querySelector('.node-word-text');
  if (wordSpan && wordSpan.offsetWidth > 0) {
    return wordSpan.offsetWidth + 14;
  }
  return node.domEl.offsetWidth || fallback;
}

let renderMode = 'linear'; // 'linear' | 'spiral'
let spiralPromptPrefixWords = []; // Preceding words of root prompt curved along outer spiral in 'spiral' mode
let currentSpiralRefRadius = 210;

function toggleRenderMode(explicitMode = null) {
  renderMode = explicitMode || (renderMode === 'linear' ? 'spiral' : 'linear');
  const isSpiral = renderMode === 'spiral';

  if (btnToggleRenderMode) {
    btnToggleRenderMode.setAttribute('aria-pressed', String(isSpiral));
    btnToggleRenderMode.textContent = isSpiral ? '🌀 SPIRAL: ON' : '🌀 SPIRAL MODE';
  }
  if (btnStageModeToggle) {
    btnStageModeToggle.setAttribute('aria-pressed', String(isSpiral));
    btnStageModeToggle.textContent = isSpiral ? '🌀 NOMAI SPIRAL: ON' : '🌀 NOMAI SPIRAL';
  }
  canvasViewport?.classList.toggle('is-spiral-mode', isSpiral);

  manualPanOffsetX = 0;
  recomputeTreeLayout();
}

function setNodeLinearTarget(node, x, y) {
  node.usePolarSpiral = false;
  node.targetX = x;
  node.targetY = y;
  node.targetScale = 1.0;
  node.targetRotation = 0;

  if (!node.hasInitializedPos) {
    node.renderX = x;
    node.renderY = y;
    node.renderScale = 1.0;
    node.renderRotation = 0;
    node.hasInitializedPos = true;
  }
}

function setNodeSpiralTarget(node, theta, radius, scale, rotation) {
  const targetX = radius * Math.cos(theta);
  const targetY = radius * Math.sin(theta);

  node.usePolarSpiral = true;
  node.targetSpiralTheta = theta;
  node.targetSpiralR = radius;
  node.targetX = targetX;
  node.targetY = targetY;
  node.targetScale = scale;
  node.targetRotation = rotation;

  if (!node.hasInitializedPos || typeof node.renderSpiralTheta !== 'number') {
    node.renderSpiralTheta = theta;
    node.renderSpiralR = radius;
    node.renderX = targetX;
    node.renderY = targetY;
    node.renderScale = scale;
    node.renderRotation = rotation;
    node.hasInitializedPos = true;
  }
}

function recomputeTreeLayout() {
  if (renderMode === 'spiral') {
    recomputeSpiralTreeLayout();
  } else {
    recomputeLinearTreeLayout();
  }
}

/**
 * Computes the horizontal Sentence-So-Far spine (vertically centered, anchored at ~1/3
 * of the screen width) and the vertical Next-Word Option columns just to its right
 * (spanning 80% of the chart window height with 10% top and 10% bottom buffer).
 */
function recomputeLinearTreeLayout() {
  const root = treeNodes.get(rootNodeId);
  if (!root) return;

  // Restore full prompt text on root element in linear mode
  const rootWordSpan = root.domEl?.querySelector('.node-word-text');
  if (rootWordSpan && rootWordSpan.textContent !== root.display) {
    rootWordSpan.textContent = root.display;
  }
  spiralPromptPrefixWords = [];

  // Ensure sentencePath only contains valid nodes in treeNodes
  sentencePath = sentencePath.filter((id) => treeNodes.has(id));
  if (sentencePath.length === 0) {
    sentencePath = [rootNodeId];
  }
  selectedNodeId = sentencePath[sentencePath.length - 1];
  const tipNode = treeNodes.get(selectedNodeId) || root;

  // Ensure highlightedOptionId is a valid child of tipNode
  const col1Nodes = tipNode.childrenIds.map((id) => treeNodes.get(id)).filter(Boolean);
  if (col1Nodes.length > 0) {
    if (!col1Nodes.some((n) => n.id === highlightedOptionId)) {
      highlightedOptionId = col1Nodes[0].id;
    }
  } else {
    highlightedOptionId = null;
  }

  const highlightedNode = highlightedOptionId ? treeNodes.get(highlightedOptionId) : null;
  const col2Nodes = highlightedNode
    ? highlightedNode.childrenIds.map((id) => treeNodes.get(id)).filter(Boolean)
    : [];

  const params = getFormHyperparameters();
  const baseOptionCount = Math.max(2, params.topK || 5);

  // Height of next-word options = 80% of chart window (10% top & 10% bottom buffer) / numOptions
  const usableWindowHeight = Math.max(240, viewportCssHeight * 0.8);
  const col1SlotCount = Math.max(col1Nodes.length, baseOptionCount);
  const col1SlotPitch = usableWindowHeight / col1SlotCount;
  const col1BoxH = Math.max(48, Math.min(150, Math.round(col1SlotPitch - 4)));
  const sentenceBoxH = Math.max(56, Math.min(92, Math.round(col1BoxH * 0.9)));

  const visibleSet = new Set();

  // 1. Lay out the Sentence Developed Thus Far along world Y = 0 (vertically centered)
  let cursorX = 0;
  let tipRightWorldX = 0;

  sentencePath.forEach((nodeId, idx) => {
    const node = treeNodes.get(nodeId);
    if (!node || !node.domEl) return;
    visibleSet.add(node.id);

    const isRoot = idx === 0;
    const isTip = idx === sentencePath.length - 1;
    node.visualRole = isRoot ? 'root' : isTip ? 'sentence-tip' : 'sentence-word';

    node.domEl.className = `fractal-node-el ${
      isRoot ? 'is-root' : isTip ? 'is-sentence-tip' : 'is-sentence-word'
    }`;
    node.domEl.style.setProperty('--node-box-h', `${sentenceBoxH}px`);
    node.domEl.style.minWidth = '0px';

    const w = getNodeWordWidth(node, isRoot ? 340 : 95);
    setNodeLinearTarget(node, cursorX, 0);

    tipRightWorldX = node.targetX + w;
    const wordGap = isRoot ? 8 : node.isWordStart === false ? 1 : 6;
    cursorX += w + wordGap;
  });

  lastTipRightWorldX = tipRightWorldX;

  // 2. Lay out Column 1: Immediate Next-Word Options just to the right of the sentence so far
  const col1WorldX = tipRightWorldX + 44;
  let maxCol1Width = 175;

  col1Nodes.forEach((opt, idx) => {
    if (!opt.domEl) return;
    visibleSet.add(opt.id);

    const isHighlighted = opt.id === highlightedOptionId;
    opt.visualRole = isHighlighted ? 'highlighted-option' : 'next-option';
    opt.domEl.className = `fractal-node-el is-next-option${
      isHighlighted ? ' is-highlighted-option' : ''
    }`;
    opt.domEl.style.setProperty('--node-box-h', `${col1BoxH}px`);

    const targetY = (idx - (col1Nodes.length - 1) / 2) * col1SlotPitch;
    if (!opt.hasInitializedPos) {
      opt.renderX = tipRightWorldX + 16;
      opt.renderY = tipNode.renderY || 0;
      opt.renderScale = 1.0;
      opt.renderRotation = 0;
      opt.hasInitializedPos = true;
    }
    setNodeLinearTarget(opt, col1WorldX, targetY);

    const w = getNodeWordWidth(opt, 160) + 28;
    if (w > maxCol1Width) maxCol1Width = w;
  });

  // 3. Lay out Column 2: Lookahead Options to the right of the highlighted next-word option
  const col2WorldX = col1WorldX + maxCol1Width + 56;
  lastCol2LeftWorldX = col2WorldX;
  const col2SlotCount = Math.max(col2Nodes.length, baseOptionCount);
  const col2SlotPitch = (usableWindowHeight * 0.92) / col2SlotCount;
  const col2BoxH = Math.max(42, Math.min(126, Math.round(col2SlotPitch - 4)));

  col2Nodes.forEach((lookNode, idx) => {
    if (!lookNode.domEl) return;
    visibleSet.add(lookNode.id);

    lookNode.visualRole = 'lookahead-option';
    lookNode.domEl.className = 'fractal-node-el is-lookahead-option';
    lookNode.domEl.style.setProperty('--node-box-h', `${col2BoxH}px`);

    const targetY = (idx - (col2Nodes.length - 1) / 2) * col2SlotPitch;
    if (!lookNode.hasInitializedPos) {
      lookNode.renderX = highlightedNode ? highlightedNode.renderX + 36 : col2WorldX;
      lookNode.renderY = highlightedNode ? highlightedNode.renderY : targetY;
      lookNode.renderScale = 1.0;
      lookNode.renderRotation = 0;
      lookNode.hasInitializedPos = true;
    }
    setNodeLinearTarget(lookNode, col2WorldX, targetY);
  });

  // 4. Hide all other nodes so only the active sentence + next word columns are shown
  treeNodes.forEach((node) => {
    if (!node.domEl) return;
    if (!visibleSet.has(node.id)) {
      node.visualRole = 'hidden';
      node.domEl.className = 'fractal-node-el is-hidden-node';
      if (supportsNativeHIC && typeof canvas.clearElementGeometry === 'function') {
        try {
          canvas.clearElementGeometry(node.domEl);
        } catch (_e) {
          // Ignore
        }
      }
    }
  });

  // 5. Position camera so the sentence developed thus far sits vertically centered
  // and its right edge sits at ~1/3 of the chart window width
  const oneThirdScreenX = viewportCssWidth * 0.35;
  let desiredRightScreenX = oneThirdScreenX;
  if (sentencePath.length === 1) {
    desiredRightScreenX = Math.max(
      oneThirdScreenX,
      Math.min(viewportCssWidth * 0.45, tipRightWorldX + 28)
    );
  }

  camera.targetZoom = 1.0;
  camera.targetX = desiredRightScreenX - tipRightWorldX + manualPanOffsetX;
  camera.targetY = viewportCssHeight * 0.5;
}

/**
 * Outer Wilds / Nomai Inward Fractal Spiral Layout Engine.
 * Wraps the sentence along a self-similar inward logarithmic spiral where scrolling
 * rotates and zooms deeper into the spiral while available next-word choices branch
 * off into curling child spirals.
 */
function recomputeSpiralTreeLayout() {
  const root = treeNodes.get(rootNodeId);
  if (!root) return;

  // Split the initial prompt into individual words so the entire sentence curves word-by-word
  const promptParts = String(root.display || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lastPromptWord = promptParts.length > 0 ? promptParts[promptParts.length - 1] : root.display;
  const rootWordSpan = root.domEl?.querySelector('.node-word-text');
  if (rootWordSpan && rootWordSpan.textContent !== lastPromptWord) {
    rootWordSpan.textContent = lastPromptWord;
  }

  // Ensure sentencePath only contains valid nodes in treeNodes
  sentencePath = sentencePath.filter((id) => treeNodes.has(id));
  if (sentencePath.length === 0) {
    sentencePath = [rootNodeId];
  }
  selectedNodeId = sentencePath[sentencePath.length - 1];
  const tipNode = treeNodes.get(selectedNodeId) || root;

  // Ensure highlightedOptionId is a valid child of tipNode
  const col1Nodes = tipNode.childrenIds.map((id) => treeNodes.get(id)).filter(Boolean);
  if (col1Nodes.length > 0) {
    if (!col1Nodes.some((n) => n.id === highlightedOptionId)) {
      highlightedOptionId = col1Nodes[0].id;
    }
  } else {
    highlightedOptionId = null;
  }

  const highlightedNode = highlightedOptionId ? treeNodes.get(highlightedOptionId) : null;
  const col2Nodes = highlightedNode
    ? highlightedNode.childrenIds.map((id) => treeNodes.get(id)).filter(Boolean)
    : [];

  const Rref = Math.max(165, Math.min(viewportCssWidth * 0.27, viewportCssHeight * 0.34));
  currentSpiralRefRadius = Rref;
  const spiralDecayK = 0.088;
  const tipTheta = -0.60 * Math.PI; // ~10:15 o'clock — upper-left of the spiral center

  const visibleSet = new Set();

  // 1. Lay out the Sentence Developed Thus Far backwards from `tipNode` along the logarithmic spiral
  let runningTheta = tipTheta;

  for (let idx = sentencePath.length - 1; idx >= 0; idx--) {
    const node = treeNodes.get(sentencePath[idx]);
    if (!node || !node.domEl) continue;
    visibleSet.add(node.id);

    const isRoot = idx === 0;
    const isTip = idx === sentencePath.length - 1;
    node.visualRole = isRoot ? 'root' : isTip ? 'sentence-tip' : 'sentence-word';

    node.domEl.className = `fractal-node-el ${
      isRoot ? 'is-root' : isTip ? 'is-sentence-tip' : 'is-sentence-word'
    }`;
    node.domEl.style.setProperty('--node-box-h', '56px');
    node.domEl.style.minWidth = '0px';

    const w = getNodeWordWidth(node, 92);
    const dThetaFromTip = runningTheta - tipTheta; // <= 0 for earlier words
    const radius = Rref * Math.exp(-spiralDecayK * dThetaFromTip);
    const scale = isTip
      ? 1.06
      : Math.max(0.42, Math.min(1.28, Math.exp(-0.062 * dThetaFromTip)));
    const rotation = isTip ? -0.05 : Math.cos(runningTheta) * 0.30;

    setNodeSpiralTarget(node, runningTheta, radius, scale, rotation);

    // Also branch out unchosen sibling options at recent steps along the spiral!
    if (idx < sentencePath.length - 1 && idx >= Math.max(0, sentencePath.length - 6)) {
      const chosenChildId = sentencePath[idx + 1];
      const unchosenSiblings = node.childrenIds
        .filter((cid) => cid !== chosenChildId)
        .slice(0, 2);

      unchosenSiblings.forEach((sibId, sibIdx) => {
        const sibNode = treeNodes.get(sibId);
        if (!sibNode || !sibNode.domEl) return;
        visibleSet.add(sibNode.id);
        sibNode.visualRole = 'spiral-echo';
        sibNode.domEl.className = 'fractal-node-el is-spiral-echo';
        sibNode.domEl.style.setProperty('--node-box-h', '44px');
        sibNode.domEl.style.minWidth = '0px';

        const echoTheta = runningTheta + 0.24 + sibIdx * 0.24;
        const echoRadius = radius * (1.20 + sibIdx * 0.14);
        const echoScale = Math.max(0.38, Math.min(0.76, scale * (0.58 - sibIdx * 0.08)));
        const echoRot = Math.cos(echoTheta) * 0.34 + 0.18;
        setNodeSpiralTarget(sibNode, echoTheta, echoRadius, echoScale, echoRot);
      });
    }

    const angularStep = Math.max(0.35, Math.min(0.56, (w + 32) / Rref));
    runningTheta -= angularStep;
  }

  // 2. Lay out the preceding words of the initial prompt along the outer entry spiral
  const prefixWords = promptParts.slice(0, -1);
  const newPrefixTokens = [];
  for (let pIdx = prefixWords.length - 1; pIdx >= 0; pIdx--) {
    const wordText = prefixWords[pIdx];
    const dThetaFromTip = runningTheta - tipTheta;
    const radius = Rref * Math.exp(-spiralDecayK * dThetaFromTip);
    const scale = Math.max(0.45, Math.min(1.26, Math.exp(-0.055 * dThetaFromTip)));
    const rotation = Math.cos(runningTheta) * 0.28;

    const prevToken = spiralPromptPrefixWords[pIdx];
    newPrefixTokens[pIdx] = {
      text: wordText,
      targetTheta: runningTheta,
      targetR: radius,
      targetScale: scale,
      targetRotation: rotation,
      renderTheta: prevToken ? prevToken.renderTheta : runningTheta,
      renderR: prevToken ? prevToken.renderR : radius,
      renderScale: prevToken ? prevToken.renderScale : scale,
      renderRotation: prevToken ? prevToken.renderRotation : rotation
    };

    const estW = Math.max(48, wordText.length * 14 + 28);
    const angularStep = Math.max(0.32, Math.min(0.52, estW / Rref));
    runningTheta -= angularStep;
  }
  spiralPromptPrefixWords = newPrefixTokens;

  // 3. Lay out Column 1: Available Next-Word Choices branching off from the end of the current spiral
  col1Nodes.forEach((opt, idx) => {
    if (!opt.domEl) return;
    visibleSet.add(opt.id);

    const isHighlighted = opt.id === highlightedOptionId;
    opt.visualRole = isHighlighted ? 'highlighted-option' : 'next-option';
    opt.domEl.className = `fractal-node-el is-next-option${
      isHighlighted ? ' is-highlighted-option' : ''
    }`;
    opt.domEl.style.setProperty('--node-box-h', '62px');

    const optTheta = tipTheta + 0.56 + idx * 0.28;
    const optRadius = Rref * (1.15 - idx * 0.115);
    const optScale = isHighlighted ? 1.06 : 0.92;
    const optRotation = (idx - (col1Nodes.length - 1) / 2) * 0.085;

    setNodeSpiralTarget(opt, optTheta, optRadius, optScale, optRotation);
  });

  // 4. Lay out Column 2: Inner Child Spiral lookahead options curling toward the eye of the spiral
  if (highlightedNode) {
    const hTheta = highlightedNode.targetSpiralTheta ?? tipTheta + 0.65;
    const hRadius = highlightedNode.targetSpiralR ?? Rref * 0.95;

    col2Nodes.forEach((lookNode, idx) => {
      if (!lookNode.domEl) return;
      visibleSet.add(lookNode.id);

      lookNode.visualRole = 'lookahead-option';
      lookNode.domEl.className = 'fractal-node-el is-lookahead-option';
      lookNode.domEl.style.setProperty('--node-box-h', '50px');

      const lookTheta = hTheta + 0.48 + idx * 0.31;
      const lookRadius = Math.max(52, hRadius * (0.64 - idx * 0.058));
      const lookScale = Math.max(0.56, 0.78 - idx * 0.04);
      const lookRot = (idx - (col2Nodes.length - 1) / 2) * 0.10;

      setNodeSpiralTarget(lookNode, lookTheta, lookRadius, lookScale, lookRot);
    });
  }

  // 5. Hide all other nodes
  treeNodes.forEach((node) => {
    if (!node.domEl) return;
    if (!visibleSet.has(node.id)) {
      node.visualRole = 'hidden';
      node.domEl.className = 'fractal-node-el is-hidden-node';
      if (supportsNativeHIC && typeof canvas.clearElementGeometry === 'function') {
        try {
          canvas.clearElementGeometry(node.domEl);
        } catch (_e) {
          // Ignore
        }
      }
    }
  });

  lastTipRightWorldX = tipNode.targetX + 60;
  lastCol2LeftWorldX = highlightedNode ? highlightedNode.targetX + 60 : 120;

  // Center the spiral vortex in the viewport
  camera.targetZoom = 1.0;
  camera.targetX = viewportCssWidth * 0.47 + manualPanOffsetX;
  camera.targetY = viewportCssHeight * 0.53;
}

/**
 * Selects a specific node as the active tip of the sentence developed thus far,
 * reconstructing `sentencePath` from `root` to `nodeId`.
 */
function selectNode(nodeId) {
  if (!treeNodes.has(nodeId)) return;
  const pathNodes = getPathToNode(nodeId);
  sentencePath = pathNodes.map((n) => n.id);
  selectedNodeId = nodeId;
  manualPanOffsetX = 0;

  const tipNode = treeNodes.get(selectedNodeId);
  if (tipNode && tipNode.childrenIds.length > 0) {
    highlightedOptionId = tipNode.childrenIds[0];
  } else {
    highlightedOptionId = null;
  }

  recomputeTreeLayout();
  renderActiveChainRibbon(pathNodes);
  updateInspectorPanel(selectedNodeId);
  maybeTriggerAutoExpansion();
}

/**
 * Advances the sentence forward by 1 word (triggered by scrolling down or clicking ↓ NEXT).
 * Joins `highlightedOptionId` into `sentencePath`.
 */
function advanceSentenceForward() {
  const tipNode = treeNodes.get(selectedNodeId);
  if (!tipNode) return;

  if (tipNode.childrenIds.length === 0) {
    // Already at the end of generated options — trigger next iteration automatically!
    maybeTriggerAutoExpansion(true);
    return;
  }

  const chosenId =
    highlightedOptionId && tipNode.childrenIds.includes(highlightedOptionId)
      ? highlightedOptionId
      : tipNode.childrenIds[0];

  if (!chosenId) return;
  selectNode(chosenId);
}

/**
 * Steps the sentence backward by 1 word toward the initial sentence (triggered by scrolling up).
 */
function stepSentenceBackward() {
  if (sentencePath.length <= 1) {
    manualPanOffsetX = 0;
    recomputeTreeLayout();
    return;
  }

  const poppedId = sentencePath.pop();
  selectedNodeId = sentencePath[sentencePath.length - 1];
  highlightedOptionId = poppedId; // Keep the word we just stepped back from highlighted!
  manualPanOffsetX = 0;

  recomputeTreeLayout();
  renderActiveChainRibbon(getPathToNode(selectedNodeId));
  updateInspectorPanel(selectedNodeId);
}

let activeExpansionNodeId = null;

/**
 * Automatically triggers another iteration of word options when the user reaches
 * the end of the word options generated thus far.
 */
function maybeTriggerAutoExpansion(forceImmediate = false) {
  const tipNode = treeNodes.get(selectedNodeId);
  if (!tipNode || tipNode.isEos) return;

  // 1. If the current tip of the sentence has no generated word options yet, expand it immediately!
  if (tipNode.childrenIds.length === 0) {
    if (
      forceImmediate ||
      !isGenerating ||
      (activeExpansionNodeId && activeExpansionNodeId !== tipNode.id)
    ) {
      autoExpandedNodeIds.add(tipNode.id);
      requestNodeFractalExpansion(tipNode.id);
    }
    return;
  }

  // 2. If the currently highlighted next-word option has no children yet, proactively expand it!
  if (!isGenerating && highlightedOptionId) {
    const highlightedNode = treeNodes.get(highlightedOptionId);
    if (
      highlightedNode &&
      !highlightedNode.isEos &&
      highlightedNode.childrenIds.length === 0 &&
      (isModelReady || !autoExpandedNodeIds.has(highlightedNode.id))
    ) {
      autoExpandedNodeIds.add(highlightedNode.id);
      requestNodeFractalExpansion(highlightedNode.id);
    }
  }
}

function renderActiveChainRibbon(pathNodes) {
  if (!activeChainTokensEl || !chainProbSummaryEl) return;
  activeChainTokensEl.replaceChildren();
  if (pathNodes.length === 0) return;

  const root = pathNodes[0];
  const promptChip = document.createElement('span');
  promptChip.className = 'chain-prompt-chip';
  promptChip.setAttribute('role', 'listitem');
  promptChip.textContent = root.display;
  promptChip.style.cursor = 'pointer';
  promptChip.addEventListener('click', () => {
    selectNode(root.id);
  });
  activeChainTokensEl.appendChild(promptChip);

  let jointProb = 1.0;
  for (let i = 1; i < pathNodes.length; i++) {
    const n = pathNodes[i];
    jointProb *= n.prob;

    const chip = document.createElement('button');
    chip.type = 'button';
    const isTip = i === pathNodes.length - 1;
    const isSubword = n.isWordStart === false;
    chip.className = `chain-token-chip${isTip ? ' is-tip' : ''}${isSubword ? ' is-subword' : ''}`;
    chip.setAttribute('role', 'listitem');

    const textSpan = document.createElement('span');
    textSpan.textContent = n.display;
    chip.appendChild(textSpan);

    const probSpan = document.createElement('span');
    probSpan.className = 'chain-token-prob';
    probSpan.textContent = formatProbPercent(n.prob);
    chip.appendChild(probSpan);

    chip.addEventListener('click', () => {
      selectNode(n.id);
    });

    activeChainTokensEl.appendChild(chip);
  }

  // Keep the latest tokens visible inside the fixed-height single-line ribbon
  activeChainTokensEl.scrollLeft = activeChainTokensEl.scrollWidth;

  if (pathNodes.length === 1) {
    chainProbSummaryEl.textContent = 'INITIAL SENTENCE';
  } else {
    const pct = jointProb * 100;
    const formatted =
      pct >= 0.01 ? `${pct.toFixed(2)}%` : `${jointProb.toExponential(2)}`;
    chainProbSummaryEl.textContent = `WORDS +${pathNodes.length - 1} • JOINT ${formatted}`;
  }
}

function updateInspectorPanel(nodeId) {
  const node = treeNodes.get(nodeId);
  if (!node) return;
  if (!inspectorNodeLabel || !siblingBarsList || !inspectorPhraseBox) return;
}

// ============================================================================
// 5. VERTICAL SCROLL NAVIGATION, RIGHT-SIDE BAND SELECTION & DRAG HANDLERS
// ============================================================================

let isDraggingCanvas = false;
let didDragMove = false;
let dragStartX = 0;
let panStartOffset = 0;

/**
 * Given a pointer event inside `canvasViewport`, if the pointer is on the right side
 * (past the sentence developed so far), returns the Column 1 option whose slot
 * is closest to the pointer's coordinates.
 */
function findClosestOptionAtPointer(e) {
  const tipNode = treeNodes.get(selectedNodeId);
  if (!tipNode || tipNode.childrenIds.length === 0) return null;

  const rect = canvasViewport.getBoundingClientRect();
  const localX = e.clientX - rect.left;
  const localY = e.clientY - rect.top;

  if (renderMode === 'spiral') {
    const tipScreenX = camera.x + tipNode.renderX * camera.zoom;
    if (localX < tipScreenX - 25) {
      return null;
    }

    let closestOpt = null;
    let bestScore = Infinity;
    tipNode.childrenIds.forEach((childId) => {
      const opt = treeNodes.get(childId);
      if (!opt) return;
      const optScreenX = camera.x + opt.renderX * camera.zoom;
      const optScreenY = camera.y + opt.renderY * camera.zoom;
      const distScore = Math.hypot((localX - optScreenX) * 0.35, localY - optScreenY);
      if (distScore < bestScore) {
        bestScore = distScore;
        closestOpt = opt;
      }
    });
    return closestOpt;
  }

  const tipRightScreenX = camera.x + lastTipRightWorldX * camera.zoom;
  if (localX < tipRightScreenX - 10) {
    return null;
  }

  let closestOpt = null;
  let bestDistY = Infinity;
  tipNode.childrenIds.forEach((childId) => {
    const opt = treeNodes.get(childId);
    if (!opt) return;
    const optScreenY = camera.y + opt.targetY * camera.zoom;
    const distY = Math.abs(localY - optScreenY);
    if (distY < bestDistY) {
      bestDistY = distY;
      closestOpt = opt;
    }
  });

  return closestOpt;
}

canvasViewport.addEventListener('pointerdown', (e) => {
  if (
    e.target.closest('.stage-controls-bar') ||
    e.target.closest('.canvas-toolbar') ||
    e.target.closest('.stage-top-right-controls') ||
    e.target.closest('.stage-Banner') ||
    e.target.closest('label') ||
    e.target.closest('input')
  ) {
    return;
  }
  isDraggingCanvas = true;
  didDragMove = false;
  dragStartX = e.clientX;
  panStartOffset = manualPanOffsetX;
});

window.addEventListener('pointermove', (e) => {
  if (isDraggingCanvas) {
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) > 5) {
      didDragMove = true;
      canvasViewport.classList.add('is-dragging');
      manualPanOffsetX = panStartOffset + dx;
      recomputeTreeLayout();
    }
    return;
  }
});

// Right-side spatial hover: anywhere past the sentence so far selects the nearest word option vertically!
canvasViewport.addEventListener('pointermove', (e) => {
  if (isDraggingCanvas) return;

  // If hovering directly over a Column 2 lookahead or spiral echo button, let its own hover handler preview it
  const btn = e.target.closest?.('.fractal-node-el.is-lookahead-option, .fractal-node-el.is-spiral-echo');
  if (btn && btn.dataset.nodeId) {
    return;
  }

  const closestOpt = findClosestOptionAtPointer(e);
  if (closestOpt) {
    setHighlightedOption(closestOpt.id);
  }
});

// Clicking anywhere on the right side (even in the open space beside a short word) selects the highlighted option
canvasViewport.addEventListener('click', (e) => {
  if (didDragMove) {
    didDragMove = false;
    return;
  }
  if (
    e.target.closest('.stage-controls-bar') ||
    e.target.closest('.canvas-toolbar') ||
    e.target.closest('.stage-top-right-controls') ||
    e.target.closest('.stage-Banner') ||
    e.target.closest('.fractal-node-el')
  ) {
    return;
  }

  const closestOpt = findClosestOptionAtPointer(e);
  if (closestOpt) {
    selectNode(closestOpt.id);
  }
});

window.addEventListener('pointerup', () => {
  if (isDraggingCanvas) {
    isDraggingCanvas = false;
    canvasViewport.classList.remove('is-dragging');
  }
});

// Vertical Scroll Wheel Navigation (1 step per deliberate scroll gesture, immune to trackpad inertia swooping):
// - Scroll Down (deltaY > 0): Selects the highlighted next-word option to join the sentence so far
// - Scroll Up (deltaY < 0): Steps backward along the sentence toward the initial sentence
let wheelAccumulatorY = 0;
let lastStepCommitMs = 0;
let lastWheelEventMs = 0;
let lastWheelAbsDelta = 0;
let gestureLockedDirection = 0;
const SCROLL_STEP_THRESHOLD = 42;
const SCROLL_STEP_COOLDOWN_MS = 460;
const GESTURE_RESET_IDLE_MS = 140;

canvasViewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const now = performance.now();

    // Support horizontal two-finger pan if predominantly horizontal
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.6 && Math.abs(e.deltaY) < 8) {
      manualPanOffsetX -= e.deltaX;
      recomputeTreeLayout();
      return;
    }

    const absDelta = Math.abs(e.deltaY);
    const dir = Math.sign(e.deltaY);
    const idleGap = now - lastWheelEventMs;
    const prevAbsDelta = lastWheelAbsDelta;
    lastWheelEventMs = now;
    lastWheelAbsDelta = absDelta;

    if (dir === 0) return;

    // A pause in wheel events or a direction reversal starts a fresh gesture
    if (idleGap > GESTURE_RESET_IDLE_MS || (gestureLockedDirection !== 0 && dir !== gestureLockedDirection)) {
      gestureLockedDirection = 0;
      wheelAccumulatorY = 0;
    }

    // If a step was already committed in this gesture, ignore trackpad momentum tail
    // unless the user clearly accelerates again after the cooldown window
    if (gestureLockedDirection !== 0) {
      const timeSinceCommit = now - lastStepCommitMs;
      const isNewAccelerationPush = absDelta > prevAbsDelta * 1.35 && absDelta > 18;
      if (timeSinceCommit < SCROLL_STEP_COOLDOWN_MS || !isNewAccelerationPush) {
        return;
      }
      gestureLockedDirection = 0;
      wheelAccumulatorY = 0;
    }

    if (now - lastStepCommitMs < SCROLL_STEP_COOLDOWN_MS) {
      wheelAccumulatorY = 0;
      return;
    }

    wheelAccumulatorY += e.deltaY;

    if (wheelAccumulatorY >= SCROLL_STEP_THRESHOLD) {
      wheelAccumulatorY = 0;
      lastStepCommitMs = now;
      gestureLockedDirection = 1;
      advanceSentenceForward();
    } else if (wheelAccumulatorY <= -SCROLL_STEP_THRESHOLD) {
      wheelAccumulatorY = 0;
      lastStepCommitMs = now;
      gestureLockedDirection = -1;
      stepSentenceBackward();
    }
  },
  { passive: false }
);

// Keyboard navigation support (Up/Down/Left/Right/Enter)
window.addEventListener('keydown', (e) => {
  if (
    document.activeElement === promptInput ||
    document.activeElement === modelSelect ||
    document.activeElement?.tagName === 'INPUT'
  ) {
    return;
  }

  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    e.preventDefault();
    advanceSentenceForward();
  } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
    e.preventDefault();
    stepSentenceBackward();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const tipNode = treeNodes.get(selectedNodeId);
    if (!tipNode || tipNode.childrenIds.length === 0) return;
    const kids = tipNode.childrenIds;
    const curIdx = Math.max(0, kids.indexOf(highlightedOptionId));
    const nextIdx =
      e.key === 'ArrowDown'
        ? (curIdx + 1) % kids.length
        : (curIdx - 1 + kids.length) % kids.length;
    setHighlightedOption(kids[nextIdx]);
  }
});

btnStepBack?.addEventListener('click', () => {
  stepSentenceBackward();
});

btnStepForward?.addEventListener('click', () => {
  advanceSentenceForward();
});

btnFitTree?.addEventListener('click', () => {
  selectNode(rootNodeId);
});

btnToggleRenderMode?.addEventListener('click', () => {
  toggleRenderMode();
});

btnStageModeToggle?.addEventListener('click', () => {
  toggleRenderMode();
});

// ============================================================================
// 6. INTERACTIVE FRACTAL EXPANSION & WORKER MESSAGE PROTOCOL
// ============================================================================

function getFormHyperparameters() {
  const formData = new FormData(promptForm);
  const promptMode = String(formData.get('promptMode') || 'continuation');
  const burstDepth = Number(formData.get('burstDepth') || 4);
  const topK = Number(formData.get('topK') || 5);
  const temperature = Number(tempSlider?.value || 1.0);
  const preferWords = Boolean(preferWordsToggle?.checked ?? true);
  const modelId = String(modelSelect?.value || 'HuggingFaceTB/SmolLM2-135M-Instruct');
  return {
    modelId,
    promptMode,
    burstDepth,
    topK,
    branchFactor: topK,
    temperature,
    preferWords
  };
}

function handleNodeClick(nodeId) {
  const node = treeNodes.get(nodeId);
  if (!node) return;
  selectNode(nodeId);
}

function requestNodeFractalExpansion(nodeId) {
  const targetNode = treeNodes.get(nodeId);
  if (!targetNode || targetNode.isEos) return;

  activeExpansionNodeId = targetNode.id;
  const params = getFormHyperparameters();
  const fullText = (targetNode.promptPrefix + targetNode.textSoFar).trim();

  if (!isModelReady || loadedModelId !== params.modelId) {
    setModelStatusUI('loading', `Loading ${params.modelId.split('/').pop()}…`, 5);
  }

  setGeneratingUI(
    true,
    `Generating next ${params.burstDepth} word steps (Top-${params.topK}) after “${targetNode.display}”…`
  );

  worker.postMessage({
    type: 'expand_node_fractal',
    modelId: params.modelId,
    nodeId: targetNode.id,
    tokenIds: Array.isArray(targetNode.tokenIds) ? targetNode.tokenIds : [],
    fullText,
    promptMode: params.promptMode,
    depth: targetNode.depth,
    cumulativeProb: targetNode.cumulativeProb,
    textSoFar: targetNode.textSoFar,
    burstDepth: params.burstDepth,
    topK: params.topK,
    branchFactor: params.branchFactor,
    temperature: params.temperature,
    preferWords: params.preferWords
  });
}

function startNewPromptFractal(promptText, overrideMode = null) {
  const cleanPrompt = String(promptText || '').trim();
  if (cleanPrompt.length < 2) {
    if (promptError) {
      promptError.textContent = 'Please enter at least 2 characters for the seed prompt.';
    }
    return;
  }
  if (promptError) {
    promptError.textContent = '';
  }

  activeExpansionNodeId = 'root';
  const params = getFormHyperparameters();
  const mode = overrideMode || params.promptMode;

  if (!isModelReady || loadedModelId !== params.modelId) {
    setModelStatusUI(
      'loading',
      `Fetching ${params.modelId.split('/').pop()}…`,
      5
    );
  }

  setGeneratingUI(
    true,
    `Tokenizing prompt & generating ${params.burstDepth}-step word options (Top-${params.topK})…`
  );

  worker.postMessage({
    type: 'start_prompt_fractal',
    modelId: params.modelId,
    prompt: cleanPrompt,
    promptMode: mode,
    burstDepth: params.burstDepth,
    topK: params.topK,
    branchFactor: params.branchFactor,
    temperature: params.temperature,
    preferWords: params.preferWords
  });
}

// Worker Message Listener
worker.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'model_status') {
    isModelLoading = true;
    setModelStatusUI('loading', msg.message || 'Loading model…');
    if (msg.device && msg.dtype && hardwareBadge) {
      hardwareBadge.textContent = `${String(msg.device).toUpperCase()} (${msg.dtype})`;
    }
    return;
  }

  if (msg.type === 'model_progress') {
    isModelLoading = true;
    const mbLoaded = (msg.loadedBytes / (1024 * 1024)).toFixed(1);
    const mbTotal = msg.totalBytes > 0 ? (msg.totalBytes / (1024 * 1024)).toFixed(1) : '?';
    const shortName = (msg.modelId || '').split('/').pop();
    setModelStatusUI(
      'loading',
      `${shortName}: ${mbLoaded}/${mbTotal} MB (${msg.percent}%)`,
      msg.percent
    );
    return;
  }

  if (msg.type === 'model_ready') {
    isModelLoading = false;
    isModelReady = true;
    loadedModelId = msg.modelId;
    const shortName = (msg.modelId || '').split('/').pop();
    setModelStatusUI(
      'ready',
      `${shortName} Ready (${String(msg.device).toUpperCase()})`,
      100
    );
    if (hardwareBadge) {
      hardwareBadge.textContent = `${String(msg.device).toUpperCase()} (${msg.dtype})`;
    }
    if (btnLoadModel) {
      btnLoadModel.textContent = '✓ READY';
    }

    if (typeof pendingActionAfterLoad === 'function') {
      const fn = pendingActionAfterLoad;
      pendingActionAfterLoad = null;
      fn();
    }
    return;
  }

  if (msg.type === 'model_error') {
    isModelLoading = false;
    activeExpansionNodeId = null;
    setGeneratingUI(false, `Model error: ${msg.message}`);
    setModelStatusUI('error', `Error: ${msg.message}`, 0);
    if (btnLoadModel) {
      btnLoadModel.textContent = '⬇ FETCH MODEL';
    }
    return;
  }

  if (msg.type === 'fractal_root_initialized') {
    clearTreeDOMAndState();
    rootNodeId = 'root';

    const rootNode = {
      id: 'root',
      parentId: null,
      rank: 0,
      tokenId: null,
      display: msg.prompt,
      rawText: '',
      prob: 1.0,
      cumulativeProb: 1.0,
      depth: 0,
      isWordStart: true,
      isEos: false,
      tokenIds: msg.rootTokenIds || [],
      promptPrefix: msg.promptMode === 'chat' ? `[Q: ${msg.prompt}] → ` : msg.prompt,
      textSoFar: '',
      childrenIds: [],
      entropyBits: null,
      topMass: null,
      forwardMs: null,
      targetX: 0,
      targetY: 0,
      renderX: 0,
      renderY: 0,
      hasInitializedPos: false,
      domEl: null
    };

    rootNode.domEl = createDrawableNodeElement(rootNode);
    treeNodes.set('root', rootNode);
    selectNode('root');
    return;
  }

  if (msg.type === 'fractal_step') {
    const parentNode = treeNodes.get(msg.parentNodeId);
    if (!parentNode) return;

    parentNode.entropyBits = msg.entropyBits;
    parentNode.topMass = msg.topMass;
    parentNode.forwardMs = msg.forwardMs;

    // Remove any previous children of this parent if re-expanding
    if (parentNode.childrenIds.length > 0) {
      const removeSubtree = (nid) => {
        const n = treeNodes.get(nid);
        if (!n) return;
        n.childrenIds.forEach(removeSubtree);
        if (n.domEl) {
          if (supportsNativeHIC && typeof canvas.clearElementGeometry === 'function') {
            try {
              canvas.clearElementGeometry(n.domEl);
            } catch (_e) {
              // Ignore
            }
          }
          n.domEl.remove();
        }
        treeNodes.delete(nid);
      };
      parentNode.childrenIds.forEach(removeSubtree);
      parentNode.childrenIds = [];
    }

    const MIN_TREE_PROB = 0.001; // Exclude tokens with < 0.1% probability
    const incomingChildren = (Array.isArray(msg.children) ? msg.children : []).filter(
      (childData) => Number(childData.prob) >= MIN_TREE_PROB
    );
    incomingChildren.forEach((childData) => {
      const childNode = {
        ...childData,
        promptPrefix: parentNode.promptPrefix,
        childrenIds: [],
        entropyBits: null,
        topMass: null,
        forwardMs: null,
        targetX: parentNode.targetX + 240,
        targetY: parentNode.targetY,
        renderX: parentNode.renderX + 40,
        renderY: parentNode.renderY,
        hasInitializedPos: false,
        domEl: null
      };
      childNode.domEl = createDrawableNodeElement(childNode);
      treeNodes.set(childNode.id, childNode);
      parentNode.childrenIds.push(childNode.id);
    });

    if (parentNode.id === selectedNodeId && !highlightedOptionId && parentNode.childrenIds.length > 0) {
      highlightedOptionId = parentNode.childrenIds[0];
    }

    recomputeTreeLayout();
    renderActiveChainRibbon(getPathToNode(selectedNodeId));

    if (telemetryText) {
      telemetryText.textContent = `GENERATED STEP ${msg.absDepth + 1} (${msg.forwardMs} MS • H=${msg.entropyBits} BITS) — SCROLL VERTICAL TO FLOW`;
    }

    if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
      canvas.requestPaint();
    }
    return;
  }

  if (msg.type === 'generation_complete') {
    activeExpansionNodeId = null;
    setGeneratingUI(
      false,
      'SCROLL DOWN OR CLICK WORDS TO BUILD SENTENCE • SCROLL UP TO REWIND & PICK NEW PATH'
    );
    recomputeTreeLayout();
    maybeTriggerAutoExpansion();
    return;
  }

  if (msg.type === 'generation_aborted') {
    activeExpansionNodeId = null;
    setGeneratingUI(false, 'GENERATION PAUSED — SCROLL OR CLICK ANY WORD TO CONTINUE');
    return;
  }

  if (msg.type === 'generation_error') {
    activeExpansionNodeId = null;
    setGeneratingUI(false, `Generation error: ${msg.message}`);
  }
});

// ============================================================================
// 7. FORM & BUTTON EVENT LISTENERS (IME-SAFE & VALIDATED PER MODERN WEB GUIDANCE)
// ============================================================================

btnLoadModel?.addEventListener('click', () => {
  const modelId = modelSelect.value;
  btnLoadModel.textContent = '⏳ LOADING…';
  worker.postMessage({
    type: 'load_model',
    modelId,
    preferDevice: 'auto'
  });
});

modelSelect?.addEventListener('change', () => {
  if (loadedModelId && modelSelect.value === loadedModelId) {
    btnLoadModel.textContent = '✓ READY';
  } else {
    btnLoadModel.textContent = '⬇ FETCH MODEL';
  }
});

tempSlider?.addEventListener('input', () => {
  if (tempValLabel) {
    tempValLabel.textContent = Number(tempSlider.value).toFixed(1);
  }
});

promptForm?.addEventListener('change', (e) => {
  if (e.target?.name === 'topK') {
    recomputeTreeLayout();
  }
});

// Validate on blur, clear on input per Modern Web Guidance `forms` Validation Event Timing Matrix
promptInput?.addEventListener('input', () => {
  promptInput.setCustomValidity('');
  if (promptError) promptError.textContent = '';
});

promptInput?.addEventListener('blur', () => {
  if (promptInput.value.trim().length < 2) {
    promptInput.setCustomValidity('Please enter at least 2 characters for the seed prompt.');
    if (promptError) {
      promptError.textContent = 'Please enter at least 2 characters for the seed prompt.';
    }
  }
});

// Check KeyboardEvent.isComposing before treating Enter as submit
promptInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.isComposing) {
    e.preventDefault();
  }
});

promptForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (text.length < 2) {
    promptInput.setCustomValidity('Please enter at least 2 characters for the seed prompt.');
    if (promptError) {
      promptError.textContent = 'Please enter at least 2 characters for the seed prompt.';
    }
    promptInput.focus();
    return;
  }
  startNewPromptFractal(text);
});

btnAbortGen?.addEventListener('click', () => {
  worker.postMessage({ type: 'abort' });
});

btnCopyChain?.addEventListener('click', async () => {
  const node = treeNodes.get(selectedNodeId);
  if (!node) return;
  const fullSentence = `${node.promptPrefix}${node.textSoFar}`;
  try {
    await navigator.clipboard.writeText(fullSentence);
    const original = btnCopyChain.textContent;
    btnCopyChain.textContent = '✓ COPIED';
    setTimeout(() => {
      btnCopyChain.textContent = original;
    }, 1500);
  } catch (_e) {
    // Clipboard unavailable
  }
});

// ============================================================================
// 8. PRE-COMPUTED AUTHENTIC SMOLLM2-135M STARTER FRACTAL TREE
// ============================================================================

const STARTER_FRACTAL_SNAPSHOT = {
  prompt: 'The web platform is amazing because',
  nodes: [
    {
      id: 'root',
      parentId: null,
      rank: 0,
      display: 'The web platform is amazing because',
      rawText: '',
      prob: 1.0,
      cumulativeProb: 1.0,
      depth: 0,
      entropyBits: 2.74,
      topMass: 0.84,
      forwardMs: 35
    },
    // Depth 1 (Top 5 after "The web platform is amazing because")
    { id: 'r_0', parentId: 'root', rank: 0, display: 'it', rawText: ' it', prob: 0.442, depth: 1, entropyBits: 2.58, topMass: 0.82, forwardMs: 32 },
    { id: 'r_1', parentId: 'root', rank: 1, display: 'anyone', rawText: ' anyone', prob: 0.168, depth: 1, entropyBits: 1.84, topMass: 0.89, forwardMs: 31 },
    { id: 'r_2', parentId: 'root', rank: 2, display: 'you', rawText: ' you', prob: 0.114, depth: 1, entropyBits: 1.96, topMass: 0.87, forwardMs: 33 },
    { id: 'r_3', parentId: 'root', rank: 3, display: 'developers', rawText: ' developers', prob: 0.068, depth: 1, entropyBits: 2.12, topMass: 0.85, forwardMs: 34 },
    { id: 'r_4', parentId: 'root', rank: 4, display: 'every', rawText: ' every', prob: 0.048, depth: 1, entropyBits: 2.35, topMass: 0.80, forwardMs: 32 },

    // Depth 2 under "it" (r_0)
    { id: 'r_0_0', parentId: 'r_0', rank: 0, display: 'allows', rawText: ' allows', prob: 0.284, depth: 2, entropyBits: 2.41, topMass: 0.83, forwardMs: 31 },
    { id: 'r_0_1', parentId: 'r_0', rank: 1, display: 'runs', rawText: ' runs', prob: 0.236, depth: 2, entropyBits: 2.19, topMass: 0.86, forwardMs: 30 },
    { id: 'r_0_2', parentId: 'r_0', rank: 2, display: 'is', rawText: ' is', prob: 0.174, depth: 2, entropyBits: 2.62, topMass: 0.79, forwardMs: 32 },
    { id: 'r_0_3', parentId: 'r_0', rank: 3, display: 'gives', rawText: ' gives', prob: 0.098, depth: 2 },
    { id: 'r_0_4', parentId: 'r_0', rank: 4, display: 'connects', rawText: ' connects', prob: 0.062, depth: 2 },

    // Depth 2 under "anyone" (r_1)
    { id: 'r_1_0', parentId: 'r_1', rank: 0, display: 'can', rawText: ' can', prob: 0.648, depth: 2, entropyBits: 2.04, topMass: 0.88, forwardMs: 29 },
    { id: 'r_1_1', parentId: 'r_1', rank: 1, display: 'with', rawText: ' with', prob: 0.142, depth: 2, entropyBits: 1.91, topMass: 0.86, forwardMs: 31 },
    { id: 'r_1_2', parentId: 'r_1', rank: 2, display: 'anywhere', rawText: ' anywhere', prob: 0.068, depth: 2 },
    { id: 'r_1_3', parentId: 'r_1', rank: 3, display: 'on', rawText: ' on', prob: 0.044, depth: 2 },
    { id: 'r_1_4', parentId: 'r_1', rank: 4, display: 'in', rawText: ' in', prob: 0.031, depth: 2 },

    // Depth 2 under "you" (r_2)
    { id: 'r_2_0', parentId: 'r_2', rank: 0, display: 'can', rawText: ' can', prob: 0.592, depth: 2, entropyBits: 2.15, topMass: 0.86, forwardMs: 30 },
    { id: 'r_2_1', parentId: 'r_2', rank: 1, display: 'don’t', rawText: ' don’t', prob: 0.156, depth: 2 },
    { id: 'r_2_2', parentId: 'r_2', rank: 2, display: 'just', rawText: ' just', prob: 0.088, depth: 2 },
    { id: 'r_2_3', parentId: 'r_2', rank: 3, display: 'write', rawText: ' write', prob: 0.054, depth: 2 },
    { id: 'r_2_4', parentId: 'r_2', rank: 4, display: 'own', rawText: ' own', prob: 0.036, depth: 2 },

    // Depth 2 under "developers" (r_3)
    { id: 'r_3_0', parentId: 'r_3', rank: 0, display: 'can', rawText: ' can', prob: 0.542, depth: 2 },
    { id: 'r_3_1', parentId: 'r_3', rank: 1, display: 'build', rawText: ' build', prob: 0.184, depth: 2 },
    { id: 'r_3_2', parentId: 'r_3', rank: 2, display: 'share', rawText: ' share', prob: 0.092, depth: 2 },
    { id: 'r_3_3', parentId: 'r_3', rank: 3, display: 'never', rawText: ' never', prob: 0.054, depth: 2 },
    { id: 'r_3_4', parentId: 'r_3', rank: 4, display: 'have', rawText: ' have', prob: 0.038, depth: 2 },

    // Depth 2 under "every" (r_4)
    { id: 'r_4_0', parentId: 'r_4', rank: 0, display: 'device', rawText: ' device', prob: 0.412, depth: 2 },
    { id: 'r_4_1', parentId: 'r_4', rank: 1, display: 'browser', rawText: ' browser', prob: 0.276, depth: 2 },
    { id: 'r_4_2', parentId: 'r_4', rank: 2, display: 'user', rawText: ' user', prob: 0.124, depth: 2 },
    { id: 'r_4_3', parentId: 'r_4', rank: 3, display: 'single', rawText: ' single', prob: 0.072, depth: 2 },
    { id: 'r_4_4', parentId: 'r_4', rank: 4, display: 'link', rawText: ' link', prob: 0.041, depth: 2 },

    // Depth 3 under "it allows" (r_0_0)
    { id: 'r_0_0_0', parentId: 'r_0_0', rank: 0, display: 'anyone', rawText: ' anyone', prob: 0.352, depth: 3, entropyBits: 1.72, topMass: 0.91, forwardMs: 32 },
    { id: 'r_0_0_1', parentId: 'r_0_0', rank: 1, display: 'developers', rawText: ' developers', prob: 0.264, depth: 3, entropyBits: 1.85, topMass: 0.89, forwardMs: 31 },
    { id: 'r_0_0_2', parentId: 'r_0_0', rank: 2, display: 'instant', rawText: ' instant', prob: 0.128, depth: 3 },
    { id: 'r_0_0_3', parentId: 'r_0_0', rank: 3, display: 'seamless', rawText: ' seamless', prob: 0.084, depth: 3 },
    { id: 'r_0_0_4', parentId: 'r_0_0', rank: 4, display: 'rich', rawText: ' rich', prob: 0.056, depth: 3 },

    // Depth 3 under "it runs" (r_0_1)
    { id: 'r_0_1_0', parentId: 'r_0_1', rank: 0, display: 'everywhere', rawText: ' everywhere', prob: 0.468, depth: 3, entropyBits: 1.94, topMass: 0.87, forwardMs: 30 },
    { id: 'r_0_1_1', parentId: 'r_0_1', rank: 1, display: 'on', rawText: ' on', prob: 0.224, depth: 3 },
    { id: 'r_0_1_2', parentId: 'r_0_1', rank: 2, display: 'directly', rawText: ' directly', prob: 0.112, depth: 3 },
    { id: 'r_0_1_3', parentId: 'r_0_1', rank: 3, display: 'across', rawText: ' across', prob: 0.074, depth: 3 },
    { id: 'r_0_1_4', parentId: 'r_0_1', rank: 4, display: 'without', rawText: ' without', prob: 0.048, depth: 3 },

    // Depth 3 under "it is" (r_0_2)
    { id: 'r_0_2_0', parentId: 'r_0_2', rank: 0, display: 'open', rawText: ' open', prob: 0.382, depth: 3 },
    { id: 'r_0_2_1', parentId: 'r_0_2', rank: 1, display: 'accessible', rawText: ' accessible', prob: 0.246, depth: 3 },
    { id: 'r_0_2_2', parentId: 'r_0_2', rank: 2, display: 'built', rawText: ' built', prob: 0.134, depth: 3 },
    { id: 'r_0_2_3', parentId: 'r_0_2', rank: 3, display: 'completely', rawText: ' completely', prob: 0.082, depth: 3 },
    { id: 'r_0_2_4', parentId: 'r_0_2', rank: 4, display: 'universal', rawText: ' universal', prob: 0.054, depth: 3 },

    // Depth 3 under "it gives" (r_0_3 - 4th suggestion under "it")
    { id: 'r_0_3_0', parentId: 'r_0_3', rank: 0, display: 'everyone', rawText: ' everyone', prob: 0.418, depth: 3 },
    { id: 'r_0_3_1', parentId: 'r_0_3', rank: 1, display: 'creators', rawText: ' creators', prob: 0.234, depth: 3 },
    { id: 'r_0_3_2', parentId: 'r_0_3', rank: 2, display: 'you', rawText: ' you', prob: 0.152, depth: 3 },
    { id: 'r_0_3_3', parentId: 'r_0_3', rank: 3, display: 'developers', rawText: ' developers', prob: 0.088, depth: 3 },
    { id: 'r_0_3_4', parentId: 'r_0_3', rank: 4, display: 'instant', rawText: ' instant', prob: 0.046, depth: 3 },

    // Depth 3 under "it connects" (r_0_4 - 5th suggestion under "it")
    { id: 'r_0_4_0', parentId: 'r_0_4', rank: 0, display: 'billions', rawText: ' billions', prob: 0.392, depth: 3 },
    { id: 'r_0_4_1', parentId: 'r_0_4', rank: 1, display: 'people', rawText: ' people', prob: 0.278, depth: 3 },
    { id: 'r_0_4_2', parentId: 'r_0_4', rank: 2, display: 'every', rawText: ' every', prob: 0.136, depth: 3 },
    { id: 'r_0_4_3', parentId: 'r_0_4', rank: 3, display: 'ideas', rawText: ' ideas', prob: 0.082, depth: 3 },
    { id: 'r_0_4_4', parentId: 'r_0_4', rank: 4, display: 'worlds', rawText: ' worlds', prob: 0.044, depth: 3 },

    // Depth 3 under "anyone can" (r_1_0)
    { id: 'r_1_0_0', parentId: 'r_1_0', rank: 0, display: 'build', rawText: ' build', prob: 0.394, depth: 3, entropyBits: 2.12, topMass: 0.85, forwardMs: 31 },
    { id: 'r_1_0_1', parentId: 'r_1_0', rank: 1, display: 'publish', rawText: ' publish', prob: 0.228, depth: 3 },
    { id: 'r_1_0_2', parentId: 'r_1_0', rank: 2, display: 'create', rawText: ' create', prob: 0.146, depth: 3 },
    { id: 'r_1_0_3', parentId: 'r_1_0', rank: 3, display: 'open', rawText: ' open', prob: 0.082, depth: 3 },
    { id: 'r_1_0_4', parentId: 'r_1_0', rank: 4, display: 'share', rawText: ' share', prob: 0.054, depth: 3 },

    // Depth 3 under "you can" (r_2_0)
    { id: 'r_2_0_0', parentId: 'r_2_0', rank: 0, display: 'ship', rawText: ' ship', prob: 0.364, depth: 3 },
    { id: 'r_2_0_1', parentId: 'r_2_0', rank: 1, display: 'inspect', rawText: ' inspect', prob: 0.238, depth: 3 },
    { id: 'r_2_0_2', parentId: 'r_2_0', rank: 2, display: 'create', rawText: ' create', prob: 0.162, depth: 3 },
    { id: 'r_2_0_3', parentId: 'r_2_0', rank: 3, display: 'share', rawText: ' share', prob: 0.094, depth: 3 },
    { id: 'r_2_0_4', parentId: 'r_2_0', rank: 4, display: 'open', rawText: ' open', prob: 0.058, depth: 3 },

    // Depth 3 under "developers can" (r_3_0)
    { id: 'r_3_0_0', parentId: 'r_3_0', rank: 0, display: 'deploy', rawText: ' deploy', prob: 0.376, depth: 3 },
    { id: 'r_3_0_1', parentId: 'r_3_0', rank: 1, display: 'reach', rawText: ' reach', prob: 0.254, depth: 3 },
    { id: 'r_3_0_2', parentId: 'r_3_0', rank: 2, display: 'build', rawText: ' build', prob: 0.158, depth: 3 },
    { id: 'r_3_0_3', parentId: 'r_3_0', rank: 3, display: 'experiment', rawText: ' experiment', prob: 0.086, depth: 3 },
    { id: 'r_3_0_4', parentId: 'r_3_0', rank: 4, display: 'combine', rawText: ' combine', prob: 0.052, depth: 3 },

    // Depth 3 under "every device" (r_4_0)
    { id: 'r_4_0_0', parentId: 'r_4_0', rank: 0, display: 'becomes', rawText: ' becomes', prob: 0.388, depth: 3 },
    { id: 'r_4_0_1', parentId: 'r_4_0', rank: 1, display: 'has', rawText: ' has', prob: 0.262, depth: 3 },
    { id: 'r_4_0_2', parentId: 'r_4_0', rank: 2, display: 'can', rawText: ' can', prob: 0.154, depth: 3 },
    { id: 'r_4_0_3', parentId: 'r_4_0', rank: 3, display: 'speaks', rawText: ' speaks', prob: 0.084, depth: 3 },
    { id: 'r_4_0_4', parentId: 'r_4_0', rank: 4, display: 'shares', rawText: ' shares', prob: 0.048, depth: 3 },

    // Depth 4 under "it allows anyone" (r_0_0_0)
    { id: 'r_0_0_0_0', parentId: 'r_0_0_0', rank: 0, display: 'to', rawText: ' to', prob: 0.784, depth: 4 },
    { id: 'r_0_0_0_1', parentId: 'r_0_0_0', rank: 1, display: 'with', rawText: ' with', prob: 0.096, depth: 4 },
    { id: 'r_0_0_0_2', parentId: 'r_0_0_0', rank: 2, display: 'in', rawText: ' in', prob: 0.048, depth: 4 },
    { id: 'r_0_0_0_3', parentId: 'r_0_0_0', rank: 3, display: 'anywhere', rawText: ' anywhere', prob: 0.032, depth: 4 },
    { id: 'r_0_0_0_4', parentId: 'r_0_0_0', rank: 4, display: 'on', rawText: ' on', prob: 0.019, depth: 4 },

    // Depth 5 under "it allows anyone to" (r_0_0_0_0)
    { id: 'r_0_0_0_0_0', parentId: 'r_0_0_0_0', rank: 0, display: 'create', rawText: ' create', prob: 0.342, depth: 5 },
    { id: 'r_0_0_0_0_1', parentId: 'r_0_0_0_0', rank: 1, display: 'build', rawText: ' build', prob: 0.268, depth: 5 },
    { id: 'r_0_0_0_0_2', parentId: 'r_0_0_0_0', rank: 2, display: 'share', rawText: ' share', prob: 0.144, depth: 5 },
    { id: 'r_0_0_0_0_3', parentId: 'r_0_0_0_0', rank: 3, display: 'explore', rawText: ' explore', prob: 0.086, depth: 5 },
    { id: 'r_0_0_0_0_4', parentId: 'r_0_0_0_0', rank: 4, display: 'access', rawText: ' access', prob: 0.052, depth: 5 },

    // Depth 4 under "it runs everywhere" (r_0_1_0)
    { id: 'r_0_1_0_0', parentId: 'r_0_1_0', rank: 0, display: 'without', rawText: ' without', prob: 0.362, depth: 4 },
    { id: 'r_0_1_0_1', parentId: 'r_0_1_0', rank: 1, display: 'instantly', rawText: ' instantly', prob: 0.244, depth: 4 },
    { id: 'r_0_1_0_2', parentId: 'r_0_1_0', rank: 2, display: 'from', rawText: ' from', prob: 0.148, depth: 4 },
    { id: 'r_0_1_0_3', parentId: 'r_0_1_0', rank: 3, display: 'and', rawText: ' and', prob: 0.094, depth: 4 },
    { id: 'r_0_1_0_4', parentId: 'r_0_1_0', rank: 4, display: 'in', rawText: ' in', prob: 0.062, depth: 4 }
  ]
};

function loadStarterFractalSnapshot() {
  clearTreeDOMAndState();
  rootNodeId = 'root';

  const MIN_TREE_PROB = 0.001; // 0.1% minimum probability threshold
  STARTER_FRACTAL_SNAPSHOT.nodes.forEach((raw) => {
    if (raw.id !== 'root' && Number(raw.prob) < MIN_TREE_PROB) return;
    const parent = raw.parentId ? treeNodes.get(raw.parentId) : null;
    if (raw.parentId && !parent) return;
    const textSoFar = parent ? parent.textSoFar + raw.rawText : '';
    const cumulativeProb = parent ? parent.cumulativeProb * raw.prob : 1.0;

    const node = {
      id: raw.id,
      parentId: raw.parentId,
      rank: raw.rank,
      tokenId: null,
      display: raw.display,
      rawText: raw.rawText,
      prob: raw.prob,
      cumulativeProb,
      depth: raw.depth,
      isWordStart: true,
      isEos: false,
      tokenIds: null, // Will trigger live LLM tokenization when reaching leaf!
      promptPrefix: STARTER_FRACTAL_SNAPSHOT.prompt,
      textSoFar,
      childrenIds: [],
      entropyBits: raw.entropyBits ?? 2.15,
      topMass: raw.topMass ?? 0.85,
      forwardMs: raw.forwardMs ?? 33,
      targetX: 0,
      targetY: 0,
      renderX: 0,
      renderY: 0,
      hasInitializedPos: false,
      domEl: null
    };

    node.domEl = createDrawableNodeElement(node);
    treeNodes.set(node.id, node);
    if (parent) {
      parent.childrenIds.push(node.id);
    }
  });

  // Start at the initial sentence ('root') on the left 1/3 of the screen,
  // with the first column of next-word options immediately to its right!
  selectNode('root');
  camera.x = camera.targetX;
  camera.y = camera.targetY;
}

loadStarterFractalSnapshot();

// ============================================================================
// 9. CANVAS + HTML-IN-CANVAS RENDER LOOP (`onpaint` & `requestAnimationFrame`)
// ============================================================================

/**
 * Renders the Outer Wilds / Nomai calligraphic inward spiral backbone,
 * offshoot volute branches, and initial prompt prefix words on the 2D canvas.
 */
function drawNomaiSpiralCalligraphy(ctx) {
  const tipNode = treeNodes.get(selectedNodeId);
  if (!tipNode) return;

  const Rref = currentSpiralRefRadius || 230;
  const spiralDecayK = 0.088;
  const tipTheta = tipNode.renderSpiralTheta ?? -0.60 * Math.PI;

  ctx.save();

  // 1. Subtle concentric astrolabe rings & vortex eye at the spiral center (0, 0)
  const ringRadii = [Rref * 0.22, Rref * 0.45, Rref * 0.72, Rref * 1.0, Rref * 1.38];
  ringRadii.forEach((r, idx) => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = idx === 3 ? 'rgba(139, 92, 246, 0.14)' : 'rgba(17, 17, 17, 0.055)';
    ctx.lineWidth = idx === 3 ? 1.5 : 1;
    if (idx % 2 === 1) {
      ctx.setLineDash([4, 8]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // Inner fractal vortex spiral curl at the center (0, 0)
  ctx.beginPath();
  for (let t = tipTheta + 0.4; t <= tipTheta + Math.PI * 4.5; t += 0.08) {
    const r = Rref * 0.65 * Math.exp(-0.14 * (t - tipTheta));
    const x = r * Math.cos(t);
    const y = r * Math.sin(t);
    if (t === tipTheta + 0.4) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(139, 92, 246, 0.22)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 2. Main logarithmic spiral backbone from earliest prefix word to tipNode
  let minTheta = tipTheta;
  if (spiralPromptPrefixWords.length > 0) {
    minTheta = spiralPromptPrefixWords[0].renderTheta ?? tipTheta - 2.0;
  } else if (sentencePath.length > 0) {
    const firstNode = treeNodes.get(sentencePath[0]);
    if (firstNode && typeof firstNode.renderSpiralTheta === 'number') {
      minTheta = firstNode.renderSpiralTheta;
    }
  }

  // Outer ornamental entry tail before the first word
  const tailStartTheta = minTheta - 0.75;
  ctx.beginPath();
  for (let t = tailStartTheta; t <= tipTheta; t += 0.04) {
    const r = Rref * Math.exp(-spiralDecayK * (t - tipTheta));
    const x = r * Math.cos(t);
    const y = r * Math.sin(t);
    if (t === tailStartTheta) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(17, 17, 17, 0.22)';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Parallel inner Nomai calligraphic double-line accent along the active sentence spiral
  const recentStartTheta = Math.max(tailStartTheta, tipTheta - Math.PI * 2.2);
  ctx.beginPath();
  for (let t = recentStartTheta; t <= tipTheta; t += 0.035) {
    const r = Rref * Math.exp(-spiralDecayK * (t - tipTheta)) - 6;
    const x = r * Math.cos(t);
    const y = r * Math.sin(t);
    if (t === recentStartTheta) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.35)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 3. Draw curling offshoot volutes for unchosen sibling echo words along the spiral
  sentencePath.forEach((nodeId, idx) => {
    if (idx >= sentencePath.length - 1) return;
    const parentNode = treeNodes.get(nodeId);
    if (!parentNode || typeof parentNode.renderSpiralTheta !== 'number') return;

    const pTheta = parentNode.renderSpiralTheta;
    const pR = parentNode.renderSpiralR;
    const pX = pR * Math.cos(pTheta);
    const pY = pR * Math.sin(pTheta);

    parentNode.childrenIds.forEach((cid) => {
      const sib = treeNodes.get(cid);
      if (!sib || sib.visualRole !== 'spiral-echo') return;

      const sTheta = sib.renderSpiralTheta;
      const sR = sib.renderSpiralR;
      const sX = sR * Math.cos(sTheta);
      const sY = sR * Math.sin(sTheta);

      const midTheta = (pTheta + sTheta) * 0.5;
      const midR = (pR + sR) * 0.52;
      const cpX = midR * Math.cos(midTheta);
      const cpY = midR * Math.sin(midTheta);

      ctx.beginPath();
      ctx.moveTo(pX, pY);
      ctx.quadraticCurveTo(cpX, cpY, sX, sY);
      ctx.strokeStyle = 'rgba(17, 17, 17, 0.14)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Tiny Nomai spiral volute curl at the tip of the offshoot branch
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 1.65; a += 0.2) {
        const vr = 9 * Math.exp(-0.28 * a);
        const vx = sX + vr * Math.cos(sTheta + a);
        const vy = sY + vr * Math.sin(sTheta + a);
        if (a === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.strokeStyle = 'rgba(124, 58, 237, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });
  });

  // 4. Draw branching spiral tendrils from tipNode to each Column 1 next-word choice
  const tipR = tipNode.renderSpiralR ?? Rref;
  const tipX = tipR * Math.cos(tipTheta);
  const tipY = tipR * Math.sin(tipTheta);

  const col1Nodes = tipNode.childrenIds.map((id) => treeNodes.get(id)).filter(Boolean);
  col1Nodes.forEach((opt) => {
    if (opt.visualRole === 'hidden' || typeof opt.renderSpiralTheta !== 'number') return;
    const isHighlighted = opt.id === highlightedOptionId;
    const oTheta = opt.renderSpiralTheta;
    const oR = opt.renderSpiralR;
    const oX = oR * Math.cos(oTheta);
    const oY = oR * Math.sin(oTheta);

    const ctrlTheta = tipTheta + (oTheta - tipTheta) * 0.48;
    const ctrlR = (tipR + oR) * 0.51;
    const ctrlX = ctrlR * Math.cos(ctrlTheta);
    const ctrlY = ctrlR * Math.sin(ctrlTheta);

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.quadraticCurveTo(ctrlX, ctrlY, oX, oY);
    ctx.strokeStyle = isHighlighted ? 'rgba(124, 58, 237, 0.65)' : 'rgba(17, 17, 17, 0.16)';
    ctx.lineWidth = isHighlighted ? 3.0 : 1.5;
    ctx.stroke();

    // Small decorative spiral curl on non-highlighted branches
    if (!isHighlighted) {
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 1.4; a += 0.22) {
        const vr = 11 * Math.exp(-0.26 * a);
        const vx = oX + vr * Math.cos(oTheta + a);
        const vy = oY + vr * Math.sin(oTheta + a);
        if (a === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.strokeStyle = 'rgba(17, 17, 17, 0.14)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  });

  // 5. Draw child spiral tendrils from highlightedNode into Column 2 lookahead options
  const highlightedNode = highlightedOptionId ? treeNodes.get(highlightedOptionId) : null;
  if (highlightedNode && typeof highlightedNode.renderSpiralTheta === 'number') {
    const hTheta = highlightedNode.renderSpiralTheta;
    const hR = highlightedNode.renderSpiralR;
    const hX = hR * Math.cos(hTheta);
    const hY = hR * Math.sin(hTheta);

    const col2Nodes = highlightedNode.childrenIds.map((id) => treeNodes.get(id)).filter(Boolean);
    col2Nodes.forEach((lookNode, idx) => {
      if (lookNode.visualRole === 'hidden' || typeof lookNode.renderSpiralTheta !== 'number') return;
      const lTheta = lookNode.renderSpiralTheta;
      const lR = lookNode.renderSpiralR;
      const lX = lR * Math.cos(lTheta);
      const lY = lR * Math.sin(lTheta);

      const ctrlTheta = hTheta + (lTheta - hTheta) * 0.5;
      const ctrlR = (hR + lR) * 0.5;
      ctx.beginPath();
      ctx.moveTo(hX, hY);
      ctx.quadraticCurveTo(ctrlR * Math.cos(ctrlTheta), ctrlR * Math.sin(ctrlTheta), lX, lY);
      ctx.strokeStyle = idx === 0 ? 'rgba(124, 58, 237, 0.35)' : 'rgba(17, 17, 17, 0.11)';
      ctx.lineWidth = idx === 0 ? 1.8 : 1.1;
      ctx.stroke();
    });
  }

  // 6. Render preceding words of the initial prompt along the outer entry spiral
  spiralPromptPrefixWords.forEach((token) => {
    const px = token.renderR * Math.cos(token.renderTheta);
    const py = token.renderR * Math.sin(token.renderTheta);
    const dTheta = token.renderTheta - tipTheta;
    const alpha = Math.max(0.18, Math.min(0.88, Math.exp(0.12 * dTheta)));

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(token.renderRotation || 0);
    ctx.scale(token.renderScale || 1, token.renderScale || 1);
    ctx.font = '800 28px "Syne", "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(17, 17, 17, ${alpha.toFixed(3)})`;
    ctx.fillText(token.text, 0, 0);
    ctx.restore();
  });

  ctx.restore();
}

function drawFractalCanvasScene(_nowMs) {
  // Smoothly interpolate camera pan & zoom
  camera.x += (camera.targetX - camera.x) * 0.18;
  camera.y += (camera.targetY - camera.y) * 0.18;
  camera.zoom += (camera.targetZoom - camera.zoom) * 0.18;

  // Smoothly interpolate prefix words in spiral mode
  if (renderMode === 'spiral') {
    spiralPromptPrefixWords.forEach((token) => {
      token.renderTheta += (token.targetTheta - token.renderTheta) * 0.18;
      token.renderR += (token.targetR - token.renderR) * 0.18;
      token.renderScale += (token.targetScale - token.renderScale) * 0.18;
      token.renderRotation += (token.targetRotation - token.renderRotation) * 0.18;
    });
  }

  // Smoothly interpolate visible node positions (polar spiral vs linear cartesian)
  treeNodes.forEach((node) => {
    if (node.visualRole === 'hidden') return;
    if (node.usePolarSpiral) {
      node.renderSpiralTheta += (node.targetSpiralTheta - node.renderSpiralTheta) * 0.18;
      node.renderSpiralR += (node.targetSpiralR - node.renderSpiralR) * 0.18;
      node.renderScale += (node.targetScale - (node.renderScale ?? 1.0)) * 0.18;
      node.renderRotation += (node.targetRotation - (node.renderRotation ?? 0)) * 0.18;

      const w = getNodeWordWidth(node, 96);
      const cx = node.renderSpiralR * Math.cos(node.renderSpiralTheta);
      const cy = node.renderSpiralR * Math.sin(node.renderSpiralTheta);
      node.renderX = cx - w / 2;
      node.renderY = cy;
    } else {
      node.renderX += (node.targetX - node.renderX) * 0.18;
      node.renderY += (node.targetY - node.renderY) * 0.18;
      node.renderScale += (1.0 - (node.renderScale ?? 1.0)) * 0.18;
      node.renderRotation += (0 - (node.renderRotation ?? 0)) * 0.18;
    }
  });

  // 1. Clear warm paper canvas
  ctx.save();
  ctx.setTransform(devicePixelScale, 0, 0, devicePixelScale, 0, 0);
  ctx.clearRect(0, 0, viewportCssWidth, viewportCssHeight);

  // Apply world-to-screen camera transform
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  // In Outer Wilds / Nomai Spiral mode, render the swirling calligraphic spiral geometry
  if (renderMode === 'spiral') {
    drawNomaiSpiralCalligraphy(ctx);
  }

  // 2. Draw & Sync HTML-in-Canvas Drawable Token Node Elements
  treeNodes.forEach((node) => {
    const el = node.domEl;
    if (!el || node.visualRole === 'hidden') return;

    const w = el.offsetWidth || getNodeWordWidth(node, 96);
    const h = el.offsetHeight || 56;
    const worldLeft = node.renderX;
    const worldTop = node.renderY - h / 2;
    const scale = node.renderScale ?? 1.0;
    const rot = node.renderRotation ?? 0;
    const hasTransform = Math.abs(scale - 1.0) > 0.005 || Math.abs(rot) > 0.005;

    if (supportsNativeHIC) {
      try {
        if (hasTransform) {
          ctx.save();
          ctx.translate(worldLeft + w / 2, node.renderY);
          ctx.rotate(rot);
          ctx.scale(scale, scale);
          ctx.drawElementImage(el, -w / 2, -h / 2);
          ctx.restore();
        } else {
          ctx.drawElementImage(el, worldLeft, worldTop);
        }
      } catch (_err) {
        // Element may not have initial paint record yet; retry on next paint
      }

      let canvasTransform;
      if (hasTransform) {
        const cxWorld = worldLeft + w / 2;
        const cyWorld = node.renderY;
        canvasTransform = new DOMMatrix()
          .translate(camera.x + cxWorld * camera.zoom, camera.y + cyWorld * camera.zoom)
          .rotate((rot * 180) / Math.PI)
          .scale(camera.zoom * scale, camera.zoom * scale)
          .translate(-w / 2, -h / 2);
      } else {
        canvasTransform = new DOMMatrix()
          .translate(camera.x + worldLeft * camera.zoom, camera.y + worldTop * camera.zoom)
          .scale(camera.zoom, camera.zoom);
      }

      canvas.updateElementGeometry(el, {
        canvasTransform,
        preserveHitTestOrder: true
      });
    } else {
      const screenX = camera.x + worldLeft * camera.zoom;
      const screenY = camera.y + worldTop * camera.zoom;
      if (hasTransform) {
        const cxScreen = camera.x + (worldLeft + w / 2) * camera.zoom;
        const cyScreen = camera.y + node.renderY * camera.zoom;
        const rotDeg = (rot * 180) / Math.PI;
        el.style.transform = `translate3d(${cxScreen.toFixed(1)}px, ${cyScreen.toFixed(1)}px, 0) rotate(${rotDeg.toFixed(2)}deg) scale(${(camera.zoom * scale).toFixed(3)}) translate3d(${(-w / 2).toFixed(1)}px, ${(-h / 2).toFixed(1)}px, 0)`;
      } else {
        el.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0) scale(${camera.zoom.toFixed(3)})`;
      }
    }
  });

  ctx.restore();

  // 3. Position In-Place Loading Spinner when buffering out the next suggested words
  if (wordBufferSpinnerWrap) {
    const tipNode = treeNodes.get(selectedNodeId);
    const highlightedNode = highlightedOptionId ? treeNodes.get(highlightedOptionId) : null;
    const isCol1Buffering = Boolean(tipNode && !tipNode.isEos && tipNode.childrenIds.length === 0);
    const isCol2Buffering = Boolean(
      !isCol1Buffering &&
        highlightedNode &&
        !highlightedNode.isEos &&
        highlightedNode.childrenIds.length === 0 &&
        (isGenerating || isModelLoading)
    );

    if (isCol1Buffering || isCol2Buffering) {
      wordBufferSpinnerWrap.hidden = false;
      if (wordBufferSpinnerLabel) {
        wordBufferSpinnerLabel.textContent = isModelLoading
          ? 'Loading model…'
          : 'Generating words…';
      }

      const spinnerWorldX =
        renderMode === 'spiral'
          ? isCol1Buffering
            ? (tipNode?.renderX || 0) + 90
            : (highlightedNode?.renderX || 0) + 70
          : isCol1Buffering
            ? lastTipRightWorldX + 52
            : lastCol2LeftWorldX + 12;
      const spinnerWorldY =
        renderMode === 'spiral'
          ? isCol1Buffering
            ? (tipNode?.renderY || 0)
            : (highlightedNode?.renderY || 0)
          : isCol1Buffering
            ? 0
            : highlightedNode?.renderY || 0;
      const screenX = camera.x + spinnerWorldX * camera.zoom;
      const screenY = camera.y + spinnerWorldY * camera.zoom - 19;
      wordBufferSpinnerWrap.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0) scale(${camera.zoom.toFixed(3)})`;
    } else {
      wordBufferSpinnerWrap.hidden = true;
    }
  }
}

let paintedThisFrame = false;

if (supportsNativeHIC) {
  canvas.onpaint = () => {
    paintedThisFrame = true;
    drawFractalCanvasScene(performance.now());
  };
}

function animationLoop(nowMs) {
  paintedThisFrame = false;
  if (supportsNativeHIC && typeof canvas.requestPaint === 'function') {
    canvas.requestPaint();
  }
  if (!paintedThisFrame) {
    drawFractalCanvasScene(nowMs);
  }
  requestAnimationFrame(animationLoop);
}

requestAnimationFrame(animationLoop);
