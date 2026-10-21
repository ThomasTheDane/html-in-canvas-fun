import {
  env,
  AutoTokenizer,
  AutoModelForCausalLM,
  Tensor
} from './vendor/transformers.min.js';

/**
 * AI Fractal Word Chain Explorer — On-Device LLM Web Worker
 * Powered by Transformers.js (@huggingface/transformers v3)
 *
 * Performs exact causal language model forward passes (`model(inputs)`) to extract
 * the raw next-token `logits` tensor, compute temperature-scaled softmax probability
 * distributions + Shannon entropy, and recursively expand Top-K fractal token trees.
 */

env.allowLocalModels = false;
env.allowRemoteModels = true;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', self.location.href).href;
  if (!self.crossOriginIsolated) {
    env.backends.onnx.wasm.numThreads = 1;
  }
}

let activeModelId = null;
let activeDevice = null;
let activeDtype = null;
let tokenizer = null;
let model = null;
let isLoading = false;
let currentGenerationId = 0;

// In-memory LRU cache of computed next-token distributions keyed by tokenId sequence + temperature
const distributionCache = new Map();
const MAX_CACHE_ENTRIES = 400;

function getCacheKey(tokenIds, temperature, preferWords) {
  return `${temperature.toFixed(2)}:${preferWords ? 1 : 0}:${tokenIds.join(',')}`;
}

function setCacheEntry(key, value) {
  if (distributionCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = distributionCache.keys().next().value;
    distributionCache.delete(firstKey);
  }
  distributionCache.set(key, value);
}

/**
 * Checks if WebGPU is usable in this worker context.
 */
async function detectWebGPU() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return Boolean(adapter);
    } catch (_err) {
      return false;
    }
  }
  return false;
}

/**
 * Formats a decoded token string for human-friendly display on fractal nodes while
 * preserving exact token concatenation fidelity.
 */
function formatTokenDisplay(rawText, tokenId, eosTokenIds) {
  if (eosTokenIds.has(tokenId)) {
    return {
      display: '⏹ [EOS]',
      raw: '',
      isWordStart: true,
      isEos: true,
      isPunctuation: false
    };
  }

  if (!rawText || rawText.length === 0) {
    return {
      display: `#${tokenId}`,
      raw: '',
      isWordStart: false,
      isEos: false,
      isPunctuation: false
    };
  }

  const hasLeadingSpace = rawText.startsWith(' ') || rawText.startsWith('\t');
  const hasNewline = rawText.includes('\n');
  let cleaned = rawText.replace(/\r/g, '');

  if (hasNewline) {
    const trimmed = cleaned.replace(/\n+/g, '↵').trim();
    return {
      display: trimmed || '↵ [Newline]',
      raw: rawText,
      isWordStart: true,
      isEos: false,
      isPunctuation: false
    };
  }

  const trimmed = cleaned.trim();
  if (trimmed.length === 0) {
    return {
      display: '␣ [Space]',
      raw: rawText,
      isWordStart: true,
      isEos: false,
      isPunctuation: true
    };
  }

  const isPunctuation = /^[.,!?;:'"()[\]{}\-–—/\\…]+$/.test(trimmed);
  const displayLabel = hasLeadingSpace ? trimmed : `·${trimmed}`;

  return {
    display: displayLabel,
    raw: rawText,
    isWordStart: hasLeadingSpace,
    isEos: false,
    isPunctuation
  };
}

/**
 * Loads the requested Hugging Face ONNX Causal LM & Tokenizer.
 */
async function loadModel({ modelId, preferDevice = 'auto' }) {
  if (isLoading) return;
  if (model && tokenizer && activeModelId === modelId) {
    self.postMessage({
      type: 'model_ready',
      modelId: activeModelId,
      device: activeDevice,
      dtype: activeDtype
    });
    return;
  }

  isLoading = true;
  distributionCache.clear();

  try {
    if (model && typeof model.dispose === 'function') {
      try {
        await model.dispose();
      } catch (_e) {
        // Ignore disposal errors when switching models
      }
    }
    model = null;
    tokenizer = null;

    const hasWebGPU = await detectWebGPU();
    const useWebGPU = preferDevice === 'webgpu' || (preferDevice === 'auto' && hasWebGPU);

    // Select optimal device and quantization dtype
    let targetDevice = useWebGPU ? 'webgpu' : 'wasm';
    let targetDtype = useWebGPU ? 'q4f16' : 'q4';

    self.postMessage({
      type: 'model_status',
      status: 'loading_tokenizer',
      message: `Loading tokenizer for ${modelId}...`,
      modelId,
      device: targetDevice,
      dtype: targetDtype
    });

    const fileProgress = new Map();

    const onProgress = (info) => {
      if (!info) return;
      if (info.status === 'initiate' || info.status === 'download') {
        fileProgress.set(info.file || 'model', { loaded: 0, total: info.total || 0 });
      } else if (info.status === 'progress') {
        fileProgress.set(info.file || 'model', {
          loaded: info.loaded || 0,
          total: info.total || 0
        });
      } else if (info.status === 'done') {
        const prev = fileProgress.get(info.file || 'model');
        if (prev && prev.total > 0) {
          fileProgress.set(info.file || 'model', { loaded: prev.total, total: prev.total });
        }
      }

      let totalBytes = 0;
      let loadedBytes = 0;
      fileProgress.forEach((v) => {
        totalBytes += v.total;
        loadedBytes += v.loaded;
      });

      const percent =
        totalBytes > 0
          ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
          : Math.round(info.progress || 0);

      self.postMessage({
        type: 'model_progress',
        modelId,
        file: info.file || '',
        status: info.status || 'progress',
        loadedBytes,
        totalBytes,
        percent
      });
    };

    tokenizer = await AutoTokenizer.from_pretrained(modelId, {
      progress_callback: onProgress
    });

    self.postMessage({
      type: 'model_status',
      status: 'loading_weights',
      message: `Fetching & compiling ONNX weights (${targetDevice.toUpperCase()} • ${targetDtype})...`,
      modelId,
      device: targetDevice,
      dtype: targetDtype
    });

    try {
      model = await AutoModelForCausalLM.from_pretrained(modelId, {
        device: targetDevice,
        dtype: targetDtype,
        progress_callback: onProgress
      });
    } catch (primaryErr) {
      // If WebGPU compilation or q4f16 fails on this device, fall back to WASM q4 automatically
      if (targetDevice === 'webgpu') {
        targetDevice = 'wasm';
        targetDtype = 'q4';
        self.postMessage({
          type: 'model_status',
          status: 'fallback_wasm',
          message: `WebGPU unavailable for ${modelId}; falling back to WASM (${targetDtype})...`,
          modelId,
          device: targetDevice,
          dtype: targetDtype
        });
        model = await AutoModelForCausalLM.from_pretrained(modelId, {
          device: targetDevice,
          dtype: targetDtype,
          progress_callback: onProgress
        });
      } else {
        throw primaryErr;
      }
    }

    activeModelId = modelId;
    activeDevice = targetDevice;
    activeDtype = targetDtype;
    isLoading = false;

    self.postMessage({
      type: 'model_ready',
      modelId: activeModelId,
      device: activeDevice,
      dtype: activeDtype
    });
  } catch (err) {
    isLoading = false;
    self.postMessage({
      type: 'model_error',
      modelId,
      message: err instanceof Error ? err.message : 'Failed to initialize model.'
    });
  }
}

/**
 * Runs a single causal LM forward pass for `tokenIds` and returns the Top-K
 * next token candidates with their exact softmax probabilities and step entropy.
 */
async function computeNextTokenDistribution(tokenIds, { topK = 5, temperature = 1.0, preferWords = false }) {
  const safeTemp = Math.max(0.05, Math.min(2.5, Number(temperature) || 1.0));
  const cacheKey = getCacheKey(tokenIds, safeTemp, preferWords);
  if (distributionCache.has(cacheKey)) {
    const cached = distributionCache.get(cacheKey);
    return {
      ...cached,
      candidates: cached.candidates.slice(0, topK)
    };
  }

  const seqLen = tokenIds.length;
  const bigIntIds = new BigInt64Array(seqLen);
  const bigIntMask = new BigInt64Array(seqLen);
  for (let i = 0; i < seqLen; i++) {
    bigIntIds[i] = BigInt(tokenIds[i]);
    bigIntMask[i] = 1n;
  }

  const inputIdsTensor = new Tensor('int64', bigIntIds, [1, seqLen]);
  const attentionMaskTensor = new Tensor('int64', bigIntMask, [1, seqLen]);

  const startMs = performance.now();
  const output = await model({
    input_ids: inputIdsTensor,
    attention_mask: attentionMaskTensor
  });
  const forwardMs = Math.round(performance.now() - startMs);

  const logitsTensor = output.logits;
  const dims = logitsTensor.dims; // [1, seqLen, vocabSize]
  const vocabSize = dims[dims.length - 1];
  const lastStepOffset = (seqLen - 1) * vocabSize;
  const rawData = logitsTensor.data;

  // 1. Find maximum logit for numerically stable softmax
  let maxLogit = -Infinity;
  for (let i = 0; i < vocabSize; i++) {
    const val = Number(rawData[lastStepOffset + i]) / safeTemp;
    if (val > maxLogit) {
      maxLogit = val;
    }
  }

  // 2. Compute softmax denominator and track Top-M candidates (we gather top 24 first
  // so we can filter out special control tokens or optionally prioritize word-starts)
  const poolSize = 24;
  const topIds = new Int32Array(poolSize).fill(-1);
  const topExps = new Float64Array(poolSize).fill(-1);
  let sumExp = 0.0;

  for (let i = 0; i < vocabSize; i++) {
    const scaled = Number(rawData[lastStepOffset + i]) / safeTemp;
    const expVal = Math.exp(scaled - maxLogit);
    sumExp += expVal;

    if (expVal > topExps[poolSize - 1]) {
      let insertPos = poolSize - 1;
      while (insertPos > 0 && expVal > topExps[insertPos - 1]) {
        topExps[insertPos] = topExps[insertPos - 1];
        topIds[insertPos] = topIds[insertPos - 1];
        insertPos--;
      }
      topExps[insertPos] = expVal;
      topIds[insertPos] = i;
    }
  }

  // 3. Compute approximate Shannon entropy H (in bits) across the probability mass
  let entropyBits = 0.0;
  let topMass = 0.0;
  for (let i = 0; i < poolSize; i++) {
    if (topIds[i] < 0) continue;
    const p = topExps[i] / sumExp;
    topMass += p;
    if (p > 1e-9) {
      entropyBits -= p * Math.log2(p);
    }
  }
  const remainderMass = Math.max(0, 1.0 - topMass);
  if (remainderMass > 1e-6) {
    // Distribute remaining probability tail estimate
    entropyBits -= remainderMass * Math.log2(remainderMass / Math.max(1, vocabSize - poolSize));
  }

  // Collect EOS token IDs
  const eosTokenIds = new Set();
  if (tokenizer.eos_token_id !== undefined && tokenizer.eos_token_id !== null) {
    if (Array.isArray(tokenizer.eos_token_id)) {
      tokenizer.eos_token_id.forEach((id) => eosTokenIds.add(Number(id)));
    } else {
      eosTokenIds.add(Number(tokenizer.eos_token_id));
    }
  }

  // 4. Decode the top candidates and filter out < 0.1% probability & control artifacts
  const MIN_TOKEN_PROB = 0.001; // 0.1% minimum probability threshold
  const decodedPool = [];
  for (let i = 0; i < poolSize; i++) {
    const tokenId = topIds[i];
    if (tokenId < 0) continue;
    const prob = topExps[i] / sumExp;

    // Exclude any token with less than 0.1% probability
    if (prob < MIN_TOKEN_PROB) {
      continue;
    }

    const rawDecoded = tokenizer.decode([tokenId], {
      skip_special_tokens: false,
      clean_up_tokenization_spaces: false
    });

    // Skip internal chat template control tokens except EOS
    if (
      !eosTokenIds.has(tokenId) &&
      (/^<\|.*\|>$/.test(rawDecoded.trim()) || rawDecoded === '<unk>' || rawDecoded === '<pad>')
    ) {
      continue;
    }

    const formatted = formatTokenDisplay(rawDecoded, tokenId, eosTokenIds);
    // Skip pure whitespace-only tokens if there are meaningful lexical tokens available
    if (formatted.display === '␣ [Space]') {
      continue;
    }

    decodedPool.push({
      tokenId,
      prob,
      logit: Number(rawData[lastStepOffset + tokenId]),
      display: formatted.display,
      rawText: formatted.raw,
      isWordStart: formatted.isWordStart,
      isEos: formatted.isEos,
      isPunctuation: formatted.isPunctuation
    });
  }

  let selectedCandidates = decodedPool;
  if (preferWords) {
    const wordStarts = decodedPool.filter((c) => !c.isPunctuation && c.rawText.trim().length > 0);
    if (wordStarts.length > 0) {
      selectedCandidates = wordStarts;
    }
  }

  const finalCandidates = selectedCandidates
    .filter((c) => c.prob >= MIN_TOKEN_PROB)
    .slice(0, Math.max(8, topK));

  // Dispose output tensors if supported
  if (typeof logitsTensor.dispose === 'function') {
    try {
      logitsTensor.dispose();
    } catch (_e) {
      // Ignore
    }
  }

  const result = {
    entropyBits: Number(entropyBits.toFixed(2)),
    topMass: Number(topMass.toFixed(4)),
    forwardMs,
    candidates: finalCandidates
  };

  setCacheEntry(cacheKey, result);
  return {
    ...result,
    candidates: finalCandidates.slice(0, topK)
  };
}

/**
 * Encodes a user prompt into initial tokenIds according to the selected mode:
 * - 'continuation': Direct raw text completion (best for seeing the very next words after a phrase)
 * - 'chat': Wraps the prompt in the model's instruction chat template so it branches the assistant's reply
 */
async function encodeInitialPrompt(promptText, promptMode = 'continuation') {
  const cleanPrompt = String(promptText || '').trim();
  if (promptMode === 'chat' && typeof tokenizer.apply_chat_template === 'function') {
    try {
      const messages = [
        {
          role: 'system',
          content: 'You are a concise, vivid, insightful thinker. Answer directly.'
        },
        {
          role: 'user',
          content: cleanPrompt
        }
      ];
      const encoded = await tokenizer.apply_chat_template(messages, {
        add_generation_prompt: true,
        return_tensor: false
      });
      if (Array.isArray(encoded) && encoded.length > 0) {
        return encoded.map((x) => Number(x));
      }
    } catch (_err) {
      // Fallback to raw tokenization below
    }
  }

  const encoded = await tokenizer(cleanPrompt, {
    add_special_tokens: true
  });
  const rawList = Array.from(encoded.input_ids.data, (v) => Number(v));
  return rawList;
}

/**
 * Recursively expands a fractal tree of token distributions starting from `rootNodeId`
 * for `burstDepth` steps (e.g., 3..5 tokens deep), showing the Top-`topK` (e.g., 5)
 * next token choices at every expanded branch point.
 *
 * Uses an Adaptive Fractal Beam-Tree Schedule so the user gets:
 * - Step 1: All Top-5 choices from the starting node
 * - Step 2: Top-5 choices for each of the top `branchWidthDepth1` first-step tokens
 * - Step 3: Top-5 choices for the leading second-step branches
 * - Steps 4..5: Top-5 choices continuing along the highest-probability fractal spine
 */
async function expandFractalSubtree({
  generationId,
  startNodeId,
  startTokenIds,
  startDepth = 0,
  startCumulativeProb = 1.0,
  startTextSoFar = '',
  burstDepth = 4,
  topK = 5,
  branchFactor = 3,
  temperature = 1.0,
  preferWords = false
}) {
  // Queue of nodes to expand: { nodeId, tokenIds, relDepth, absDepth, cumulativeProb, textSoFar }
  const queue = [
    {
      nodeId: startNodeId,
      tokenIds: startTokenIds,
      relDepth: 0,
      absDepth: startDepth,
      cumulativeProb: startCumulativeProb,
      textSoFar: startTextSoFar
    }
  ];

  // Determine how many forward passes we will run in this burst so we can report accurate progress
  // relDepth 0: 1 node
  // relDepth 1: branchFactor nodes (default 3..5)
  // relDepth 2: Math.max(2, branchFactor - 1) nodes
  // relDepth 3+: 2 nodes per level
  const getBranchesToExpandAtRelDepth = (relDepth) => {
    if (relDepth >= burstDepth - 1) return 0; // Leaf level of this burst (already has Top-K children created!)
    if (relDepth === 0) return topK; // Always expand all Top-K immediate suggestions (including bottom options)
    if (relDepth === 1) return Math.min(topK, branchFactor);
    return Math.min(topK, 2);
  };

  let completedPasses = 0;

  while (queue.length > 0) {
    if (generationId !== currentGenerationId) {
      self.postMessage({
        type: 'generation_aborted',
        generationId
      });
      return;
    }

    const current = queue.shift();
    const dist = await computeNextTokenDistribution(current.tokenIds, {
      topK,
      temperature,
      preferWords
    });

    if (generationId !== currentGenerationId) {
      self.postMessage({
        type: 'generation_aborted',
        generationId
      });
      return;
    }

    completedPasses++;

    const children = dist.candidates.map((cand, rankIdx) => {
      const childNodeId = `${current.nodeId}_${rankIdx}_${cand.tokenId}`;
      const childTokenIds = [...current.tokenIds, cand.tokenId];
      const childTextSoFar = current.textSoFar + cand.rawText;
      const childCumProb = current.cumulativeProb * cand.prob;

      return {
        id: childNodeId,
        parentId: current.nodeId,
        rank: rankIdx,
        tokenId: cand.tokenId,
        display: cand.display,
        rawText: cand.rawText,
        prob: cand.prob,
        cumulativeProb: childCumProb,
        logit: cand.logit,
        depth: current.absDepth + 1,
        isWordStart: cand.isWordStart,
        isEos: cand.isEos,
        isPunctuation: cand.isPunctuation,
        tokenIds: childTokenIds,
        textSoFar: childTextSoFar
      };
    });

    // Stream this node's newly splintered Top-K children to the main thread immediately!
    self.postMessage({
      type: 'fractal_step',
      generationId,
      parentNodeId: current.nodeId,
      relDepth: current.relDepth,
      absDepth: current.absDepth,
      entropyBits: dist.entropyBits,
      topMass: dist.topMass,
      forwardMs: dist.forwardMs,
      completedPasses,
      children
    });

    // Enqueue the top branches for the next recursive level if within `burstDepth`
    const expandCount = getBranchesToExpandAtRelDepth(current.relDepth);
    if (expandCount > 0) {
      let enqueued = 0;
      for (const child of children) {
        if (child.isEos) continue;
        if (enqueued >= expandCount) break;
        queue.push({
          nodeId: child.id,
          tokenIds: child.tokenIds,
          relDepth: current.relDepth + 1,
          absDepth: child.depth,
          cumulativeProb: child.cumulativeProb,
          textSoFar: child.textSoFar
        });
        enqueued++;
      }
    }
  }

  self.postMessage({
    type: 'generation_complete',
    generationId,
    startNodeId,
    completedPasses
  });
}

self.addEventListener('message', async (event) => {
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;

  if (data.type === 'load_model') {
    await loadModel({
      modelId: data.modelId || 'HuggingFaceTB/SmolLM2-135M-Instruct',
      preferDevice: data.preferDevice || 'auto'
    });
    return;
  }

  if (data.type === 'abort') {
    currentGenerationId++;
    self.postMessage({
      type: 'generation_aborted',
      generationId: currentGenerationId
    });
    return;
  }

  if (data.type === 'start_prompt_fractal') {
    const genId = ++currentGenerationId;
    try {
      if (!model || !tokenizer) {
        await loadModel({
          modelId: data.modelId || 'HuggingFaceTB/SmolLM2-135M-Instruct',
          preferDevice: data.preferDevice || 'auto'
        });
      }
      if (!model || !tokenizer) return;

      const promptText = String(data.prompt || '').trim();
      if (!promptText) return;

      const rootTokenIds = await encodeInitialPrompt(promptText, data.promptMode || 'continuation');

      self.postMessage({
        type: 'fractal_root_initialized',
        generationId: genId,
        prompt: promptText,
        promptMode: data.promptMode || 'continuation',
        rootNodeId: 'root',
        rootTokenIds
      });

      await expandFractalSubtree({
        generationId: genId,
        startNodeId: 'root',
        startTokenIds: rootTokenIds,
        startDepth: 0,
        startCumulativeProb: 1.0,
        startTextSoFar: '',
        burstDepth: Math.max(1, Math.min(6, Number(data.burstDepth) || 4)),
        topK: Math.max(2, Math.min(8, Number(data.topK) || 5)),
        branchFactor: Math.max(2, Math.min(8, Number(data.branchFactor) || Number(data.topK) || 5)),
        temperature: Number(data.temperature) || 1.0,
        preferWords: Boolean(data.preferWords)
      });
    } catch (err) {
      self.postMessage({
        type: 'generation_error',
        generationId: genId,
        message: err instanceof Error ? err.message : 'Error during fractal prompt expansion.'
      });
    }
    return;
  }

  if (data.type === 'expand_node_fractal') {
    const genId = ++currentGenerationId;
    try {
      if (!model || !tokenizer) {
        await loadModel({
          modelId: data.modelId || 'HuggingFaceTB/SmolLM2-135M-Instruct',
          preferDevice: data.preferDevice || 'auto'
        });
      }
      if (!model || !tokenizer) return;

      let nodeTokenIds = Array.isArray(data.tokenIds) ? data.tokenIds.map(Number) : [];
      if (nodeTokenIds.length === 0 && data.fullText) {
        nodeTokenIds = await encodeInitialPrompt(
          String(data.fullText),
          data.promptMode || 'continuation'
        );
      }
      if (nodeTokenIds.length === 0) return;

      await expandFractalSubtree({
        generationId: genId,
        startNodeId: String(data.nodeId || 'root'),
        startTokenIds: nodeTokenIds,
        startDepth: Number(data.depth) || 0,
        startCumulativeProb: Number(data.cumulativeProb) || 1.0,
        startTextSoFar: String(data.textSoFar || ''),
        burstDepth: Math.max(1, Math.min(6, Number(data.burstDepth) || 4)),
        topK: Math.max(2, Math.min(8, Number(data.topK) || 5)),
        branchFactor: Math.max(2, Math.min(8, Number(data.branchFactor) || Number(data.topK) || 5)),
        temperature: Number(data.temperature) || 1.0,
        preferWords: Boolean(data.preferWords)
      });
    } catch (err) {
      self.postMessage({
        type: 'generation_error',
        generationId: genId,
        message: err instanceof Error ? err.message : 'Error expanding fractal branch.'
      });
    }
  }
});
