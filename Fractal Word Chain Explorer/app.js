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

/**
 * Computes the horizontal Sentence-So-Far spine (vertically centered, anchored at ~1/3
 * of the screen width) and the vertical Next-Word Option columns just to its right
 * (spanning 80% of the chart window height with 10% top and 10% bottom buffer).
 */
function recomputeTreeLayout() {
  const root = treeNodes.get(rootNodeId);
  if (!root) return;

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
    node.targetX = cursorX;
    node.targetY = 0;

    if (!node.hasInitializedPos) {
      node.renderX = node.targetX;
      node.renderY = node.targetY;
      node.hasInitializedPos = true;
    }

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

    opt.targetX = col1WorldX;
    opt.targetY = (idx - (col1Nodes.length - 1) / 2) * col1SlotPitch;

    if (!opt.hasInitializedPos) {
      opt.renderX = tipRightWorldX + 16;
      opt.renderY = tipNode.renderY || 0;
      opt.hasInitializedPos = true;
    }

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

    lookNode.targetX = col2WorldX;
    lookNode.targetY = (idx - (col2Nodes.length - 1) / 2) * col2SlotPitch;

    if (!lookNode.hasInitializedPos) {
      lookNode.renderX = highlightedNode ? highlightedNode.renderX + 36 : col2WorldX;
      lookNode.renderY = highlightedNode ? highlightedNode.renderY : lookNode.targetY;
      lookNode.hasInitializedPos = true;
    }
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
    // Ensure the initial sentence on the left is never clipped on the left edge
    desiredRightScreenX = Math.max(oneThirdScreenX, Math.min(viewportCssWidth * 0.45, tipRightWorldX + 28));
  }

  camera.targetZoom = 1.0;
  camera.targetX = desiredRightScreenX - tipRightWorldX + manualPanOffsetX;
  camera.targetY = viewportCssHeight * 0.5;
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
 * (past the sentence developed so far), returns the Column 1 option whose vertical slot
 * is closest to the pointer's Y coordinate.
 */
function findClosestOptionAtPointer(e) {
  const tipNode = treeNodes.get(selectedNodeId);
  if (!tipNode || tipNode.childrenIds.length === 0) return null;

  const rect = canvasViewport.getBoundingClientRect();
  const localX = e.clientX - rect.left;
  const localY = e.clientY - rect.top;

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

  // If hovering directly over a Column 2 lookahead word button, let its own hover handler preview it
  const btn = e.target.closest?.('.fractal-node-el.is-lookahead-option');
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

function drawFractalCanvasScene(_nowMs) {
  // Smoothly interpolate camera pan
  camera.x += (camera.targetX - camera.x) * 0.18;
  camera.y += (camera.targetY - camera.y) * 0.18;
  camera.zoom += (camera.targetZoom - camera.zoom) * 0.18;

  // Smoothly interpolate visible node positions
  treeNodes.forEach((node) => {
    if (node.visualRole === 'hidden') return;
    node.renderX += (node.targetX - node.renderX) * 0.18;
    node.renderY += (node.targetY - node.renderY) * 0.18;
  });

  // 1. Clear warm paper canvas (no connector lines or boxes — pure typographic focus)
  ctx.save();
  ctx.setTransform(devicePixelScale, 0, 0, devicePixelScale, 0, 0);
  ctx.clearRect(0, 0, viewportCssWidth, viewportCssHeight);

  // Apply world-to-screen camera transform
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  // 2. Draw & Sync HTML-in-Canvas Drawable Token Node Elements
  treeNodes.forEach((node) => {
    const el = node.domEl;
    if (!el || node.visualRole === 'hidden') return;

    const h = el.offsetHeight || 56;
    const worldLeft = node.renderX;
    const worldTop = node.renderY - h / 2;

    if (supportsNativeHIC) {
      try {
        ctx.drawElementImage(el, worldLeft, worldTop);
      } catch (_err) {
        // Element may not have initial paint record yet; retry on next paint
      }

      const canvasTransform = new DOMMatrix()
        .translate(camera.x + worldLeft * camera.zoom, camera.y + worldTop * camera.zoom)
        .scale(camera.zoom, camera.zoom);

      canvas.updateElementGeometry(el, {
        canvasTransform,
        preserveHitTestOrder: true
      });
    } else {
      const screenX = camera.x + worldLeft * camera.zoom;
      const screenY = camera.y + worldTop * camera.zoom;
      el.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0) scale(${camera.zoom.toFixed(3)})`;
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

      const spinnerWorldX = isCol1Buffering ? lastTipRightWorldX + 52 : lastCol2LeftWorldX + 12;
      const spinnerWorldY = isCol1Buffering ? 0 : highlightedNode.renderY || 0;
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
