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

const KNOWN_MODEL_IDS = [
  'HuggingFaceTB/SmolLM2-135M-Instruct',
  'HuggingFaceTB/SmolLM2-360M-Instruct',
  'onnx-community/Qwen2.5-0.5B-Instruct',
  'HuggingFaceTB/SmolLM2-1.7B-Instruct'
];

const SAFE_MODEL_ID_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const MODEL_CACHE_NAME = 'fractal-llm-models-v1';
const LEGACY_CACHE_NAME = 'transformers-cache';
const IDB_NAME = 'fractal-llm-longterm-storage-v1';
const IDB_VERSION = 1;
const OPFS_DIR_NAME = 'fractal-llm-models-v1';

const pendingCacheWrites = new Set();
const loadedTokenizers = new Map();
const negativeLookupCache = new Set(); // Tracks 404 optional files (e.g. generation_config.json)

function trackCacheWrite(promise) {
  pendingCacheWrites.add(promise);
  promise.finally(() => {
    pendingCacheWrites.delete(promise);
  });
  return promise;
}

/**
 * Requests persistent storage quota from the browser so cached models are not evicted.
 */
async function ensurePersistentStorageQuota() {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
    try {
      const alreadyPersisted =
        typeof navigator.storage.persisted === 'function'
          ? await navigator.storage.persisted()
          : false;
      if (alreadyPersisted) return true;
      return await navigator.storage.persist();
    } catch (_err) {
      return false;
    }
  }
  return false;
}

/**
 * Normalizes any Cache API request key (Request object, local `/models/...` path, or remote HF URL)
 * into a canonical `https://huggingface.co/{modelId}/resolve/{revision}/{filePath}` URL string.
 */
function normalizeCacheKey(requestOrUrl) {
  const raw =
    typeof requestOrUrl === 'string'
      ? requestOrUrl
      : requestOrUrl && typeof requestOrUrl.url === 'string'
        ? requestOrUrl.url
        : String(requestOrUrl || '');
  if (!raw) return '';

  // Map local fallback paths like `/models/org/repo/file` to canonical remote HF URLs
  const localPrefix = '/models/';
  if (raw.startsWith(localPrefix)) {
    const rest = raw.slice(localPrefix.length).replace(/^\/+/, '');
    const parts = rest.split('/');
    if (parts.length >= 3) {
      const modelId = `${parts[0]}/${parts[1]}`;
      const filePath = parts.slice(2).join('/');
      if (SAFE_MODEL_ID_RE.test(modelId) && !filePath.includes('..')) {
        return `https://huggingface.co/${modelId}/resolve/main/${filePath}`;
      }
    }
  }

  try {
    const parsed = new URL(raw, self.location ? self.location.origin : 'https://huggingface.co');
    if (parsed.hostname === 'huggingface.co' || parsed.hostname === 'hf.co') {
      // Canonicalize hf.co -> huggingface.co and strip transient query params
      return `https://huggingface.co${parsed.pathname}`;
    }
    return parsed.href;
  } catch (_e) {
    return raw;
  }
}

/**
 * Extracts `{ modelId, revision, filePath }` from a canonical Hugging Face resolve URL.
 */
function parseHuggingFaceUrl(canonicalUrl) {
  try {
    const u = new URL(canonicalUrl);
    if (u.hostname !== 'huggingface.co' && u.hostname !== 'hf.co') return null;
    const match = u.pathname.match(/^\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
      modelId: match[1],
      revision: decodeURIComponent(match[2]),
      filePath: match[3]
    };
  } catch (_e) {
    return null;
  }
}

function inferContentType(urlStr, existingHeader) {
  const cleanPath = String(urlStr || '').split('?')[0].toLowerCase();
  if (cleanPath.endsWith('.json')) return 'application/json';
  if (cleanPath.endsWith('.txt') || cleanPath.endsWith('.jinja')) return 'text/plain; charset=utf-8';
  if (cleanPath.endsWith('.onnx') || cleanPath.endsWith('.onnx_data')) return 'application/octet-stream';
  return existingHeader || 'application/octet-stream';
}

function buildCleanHeaders(contentType, byteLength) {
  return new Headers({
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Length': String(Math.max(0, Number(byteLength) || 0)),
    'Cache-Control': 'public, max-age=31536000, immutable'
  });
}

/**
 * Generates a strictly sanitized, flat filename for Origin Private File System (OPFS) storage.
 */
function toSafeOpfsFileName(canonicalUrl) {
  let hash = 2166136261;
  for (let i = 0; i < canonicalUrl.length; i++) {
    hash ^= canonicalUrl.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsignedHash = (hash >>> 0).toString(16).padStart(8, '0');
  const sanitized = canonicalUrl
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-140);
  return `${sanitized}_${unsignedHash}.bin`;
}

// ============================================================================
// LONG-TERM STORAGE TIER 1: ORIGIN PRIVATE FILE SYSTEM (OPFS)
// ============================================================================

let opfsDirPromise = null;

function getOpfsDirectory() {
  if (opfsDirPromise) return opfsDirPromise;
  opfsDirPromise = (async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.storage ||
      typeof navigator.storage.getDirectory !== 'function'
    ) {
      return null;
    }
    try {
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
    } catch (_e) {
      return null;
    }
  })();
  return opfsDirPromise;
}

async function readFromOpfs(canonicalUrl, contentType) {
  const dir = await getOpfsDirectory();
  if (!dir) return null;
  try {
    const fileName = toSafeOpfsFileName(canonicalUrl);
    const fileHandle = await dir.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    if (!file || file.size === 0) return null;
    const type = inferContentType(canonicalUrl, contentType || file.type);
    return new Response(file, {
      status: 200,
      statusText: 'OK',
      headers: buildCleanHeaders(type, file.size)
    });
  } catch (_e) {
    return null;
  }
}

async function writeToOpfs(canonicalUrl, bytes) {
  const dir = await getOpfsDirectory();
  if (!dir || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) return false;
  try {
    const fileName = toSafeOpfsFileName(canonicalUrl);
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    if (typeof fileHandle.createWritable === 'function') {
      const writable = await fileHandle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return true;
    }
  } catch (_e) {
    // Fallback to IndexedDB & CacheStorage if OPFS write is unsupported in this context
  }
  return false;
}

// ============================================================================
// LONG-TERM STORAGE TIER 2: INDEXEDDB (BLOBS + METADATA + 404 MARKERS)
// ============================================================================

let idbPromise = null;

function openModelIndexedDB() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'url' });
          fileStore.createIndex('by_model', 'modelId', { unique: false });
        }
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models', { keyPath: 'modelId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_e) {
      resolve(null);
    }
  });
  return idbPromise;
}

async function readRecordFromIndexedDB(storeName, key) {
  const db = await openModelIndexedDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_e) {
      resolve(null);
    }
  });
}

async function writeRecordToIndexedDB(storeName, record) {
  const db = await openModelIndexedDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (_e) {
      resolve(false);
    }
  });
}

// ============================================================================
// LONG-TERM STORAGE TIER 3: WEB CACHE STORAGE API + UNIFIED CUSTOM CACHE
// ============================================================================

async function readFromCacheStorage(canonicalUrl) {
  if (typeof caches === 'undefined') return null;
  for (const cacheName of [MODEL_CACHE_NAME, LEGACY_CACHE_NAME]) {
    try {
      const cache = await caches.open(cacheName);
      const matched = await cache.match(canonicalUrl);
      if (matched && matched.status === 200) {
        return matched;
      }
    } catch (_e) {
      // Ignore and try next cache tier
    }
  }
  return null;
}

async function writeToCacheStorage(canonicalUrl, bytes, contentType) {
  if (typeof caches === 'undefined' || !(bytes instanceof Uint8Array)) return false;
  const headers = buildCleanHeaders(contentType, bytes.byteLength);
  let stored = false;
  for (const cacheName of [MODEL_CACHE_NAME, LEGACY_CACHE_NAME]) {
    try {
      const cache = await caches.open(cacheName);
      await cache.put(
        canonicalUrl,
        new Response(bytes, {
          status: 200,
          statusText: 'OK',
          headers
        })
      );
      stored = true;
    } catch (_e) {
      // Ignore individual cache errors
    }
  }
  return stored;
}

/**
 * Multi-tiered Web Cache API implementation assigned to `env.customCache`.
 * Reads and persists every model file across OPFS, IndexedDB, and CacheStorage
 * with exact uncompressed `Content-Length` headers so downloaded models are never
 * refetched from the network.
 */
const longTermModelCache = {
  async match(requestOrUrl) {
    const canonicalUrl = normalizeCacheKey(requestOrUrl);
    if (!canonicalUrl) return undefined;

    // 1. Check OPFS first (fastest zero-copy file streaming for large ONNX binaries)
    const opfsResp = await readFromOpfs(canonicalUrl);
    if (opfsResp) {
      return opfsResp;
    }

    // 2. Check IndexedDB persistent store
    const idbRecord = await readRecordFromIndexedDB('files', canonicalUrl);
    if (idbRecord) {
      if (idbRecord.status === 404) {
        negativeLookupCache.add(canonicalUrl);
        return undefined;
      }
      if (idbRecord.status === 200 && idbRecord.blob && idbRecord.blob.size > 0) {
        const contentType = inferContentType(canonicalUrl, idbRecord.contentType);
        return new Response(idbRecord.blob, {
          status: 200,
          statusText: 'OK',
          headers: buildCleanHeaders(contentType, idbRecord.blob.size)
        });
      }
    }

    // 3. Check CacheStorage (`fractal-llm-models-v1` and `transformers-cache`)
    const cacheResp = await readFromCacheStorage(canonicalUrl);
    if (cacheResp) {
      try {
        const buf = await cacheResp.clone().arrayBuffer();
        const bytes = new Uint8Array(buf);
        if (bytes.byteLength > 0) {
          const contentType = inferContentType(
            canonicalUrl,
            cacheResp.headers?.get('content-type')
          );
          // Backfill OPFS & IndexedDB in background if missing
          trackCacheWrite(
            (async () => {
              const parsed = parseHuggingFaceUrl(canonicalUrl);
              await Promise.all([
                writeToOpfs(canonicalUrl, bytes),
                writeRecordToIndexedDB('files', {
                  url: canonicalUrl,
                  modelId: parsed?.modelId || '',
                  filePath: parsed?.filePath || '',
                  status: 200,
                  contentType,
                  size: bytes.byteLength,
                  blob: new Blob([bytes], { type: contentType }),
                  updatedAt: Date.now()
                })
              ]);
            })()
          );
          return new Response(bytes, {
            status: 200,
            statusText: 'OK',
            headers: buildCleanHeaders(contentType, bytes.byteLength)
          });
        }
      } catch (_e) {
        return cacheResp;
      }
    }

    return undefined;
  },

  async put(requestOrUrl, response) {
    const canonicalUrl = normalizeCacheKey(requestOrUrl);
    if (!canonicalUrl || !response) return;

    const writePromise = (async () => {
      try {
        const buffer = await response.clone().arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (bytes.byteLength === 0) return;

        const contentType = inferContentType(
          canonicalUrl,
          response.headers?.get('content-type')
        );
        const parsed = parseHuggingFaceUrl(canonicalUrl);

        await Promise.all([
          writeToOpfs(canonicalUrl, bytes),
          writeToCacheStorage(canonicalUrl, bytes, contentType),
          writeRecordToIndexedDB('files', {
            url: canonicalUrl,
            modelId: parsed?.modelId || '',
            filePath: parsed?.filePath || '',
            status: 200,
            contentType,
            size: bytes.byteLength,
            blob: new Blob([bytes], { type: contentType }),
            updatedAt: Date.now()
          })
        ]);
      } catch (err) {
        console.warn('Failed to persist model file to long-term storage:', err);
      }
    })();

    await trackCacheWrite(writePromise);
  },

  async isCachedNotFound(url) {
    const canonicalUrl = normalizeCacheKey(url);
    if (!canonicalUrl) return false;
    if (negativeLookupCache.has(canonicalUrl)) return true;
    const record = await readRecordFromIndexedDB('files', canonicalUrl);
    if (record && record.status === 404) {
      negativeLookupCache.add(canonicalUrl);
      return true;
    }
    return false;
  },

  async putNotFound(url) {
    const canonicalUrl = normalizeCacheKey(url);
    if (!canonicalUrl) return;
    negativeLookupCache.add(canonicalUrl);
    const parsed = parseHuggingFaceUrl(canonicalUrl);
    await trackCacheWrite(
      writeRecordToIndexedDB('files', {
        url: canonicalUrl,
        modelId: parsed?.modelId || '',
        filePath: parsed?.filePath || '',
        status: 404,
        contentType: 'application/json',
        size: 0,
        blob: null,
        updatedAt: Date.now()
      })
    );
  }
};

// Intercept worker `fetch` for Hugging Face URLs so cached files and 404 optional configs
// (like missing `generation_config.json`) never trigger network requests once cached.
const nativeFetch = self.fetch.bind(self);
self.fetch = async function cachedModelFetch(input, init) {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
  const canonicalUrl = normalizeCacheKey(rawUrl);
  const parsedHf = canonicalUrl ? parseHuggingFaceUrl(canonicalUrl) : null;

  if (method === 'GET' && parsedHf) {
    const cachedHit = await longTermModelCache.match(canonicalUrl);
    if (cachedHit) {
      return cachedHit;
    }
    if (await longTermModelCache.isCachedNotFound(canonicalUrl)) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }

    try {
      const netResp = await nativeFetch(input, init);
      if (netResp.status === 404) {
        await longTermModelCache.putNotFound(canonicalUrl);
      }
      return netResp;
    } catch (netErr) {
      // If offline and requesting an optional metadata JSON, fail softly with 404 if non-essential
      const retryHit = await longTermModelCache.match(canonicalUrl);
      if (retryHit) return retryHit;
      if (parsedHf.filePath === 'generation_config.json') {
        return new Response(null, { status: 404, statusText: 'Not Found' });
      }
      throw netErr;
    }
  }

  return nativeFetch(input, init);
};

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = longTermModelCache;

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
 * Checks whether all required files for `modelId` (with a specific dtype or any supported dtype)
 * are already stored in long-term storage.
 */
async function checkModelCachedState(modelId, preferredDtype = null) {
  if (!SAFE_MODEL_ID_RE.test(String(modelId || ''))) {
    return { cached: false, dtypes: [], totalBytes: 0 };
  }

  const baseFiles = ['config.json', 'tokenizer.json', 'tokenizer_config.json'];
  for (const file of baseFiles) {
    const url = `https://huggingface.co/${modelId}/resolve/main/${file}`;
    const hit = await longTermModelCache.match(url);
    if (!hit) {
      return { cached: false, dtypes: [], totalBytes: 0 };
    }
  }

  const candidateDtypes = preferredDtype
    ? [preferredDtype, ...['q4f16', 'q4'].filter((d) => d !== preferredDtype)]
    : ['q4f16', 'q4'];

  const availableDtypes = [];
  let totalBytes = 0;

  for (const dtype of candidateDtypes) {
    const onnxPath = `onnx/model_${dtype}.onnx`;
    const onnxUrl = `https://huggingface.co/${modelId}/resolve/main/${onnxPath}`;
    const hit = await longTermModelCache.match(onnxUrl);
    if (hit) {
      availableDtypes.push(dtype);
      const len = Number(hit.headers?.get('content-length') || 0);
      if (len > totalBytes) totalBytes = len;
    }
  }

  return {
    cached: availableDtypes.length > 0,
    dtypes: availableDtypes,
    totalBytes
  };
}

/**
 * Inspects all known models and notifies the main thread which ones are cached in long-term storage.
 */
async function broadcastCachedModelsStatus(extraModelIds = []) {
  const persisted = await ensurePersistentStorageQuota();
  const hasWebGPU = await detectWebGPU();
  const defaultDtype = hasWebGPU ? 'q4f16' : 'q4';

  const allIds = Array.from(new Set([...KNOWN_MODEL_IDS, ...extraModelIds.filter(Boolean)]));
  const cachedModels = {};

  for (const id of allIds) {
    const status = await checkModelCachedState(id, defaultDtype);
    cachedModels[id] = status;
  }

  self.postMessage({
    type: 'cached_models_status',
    persisted,
    preferredDtype: defaultDtype,
    cachedModels
  });

  return cachedModels;
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
 * Loads the requested Hugging Face ONNX Causal LM & Tokenizer, serving from
 * long-term storage (OPFS / IndexedDB / CacheStorage) when already cached or
 * persisting newly downloaded files so they never need to be refetched.
 */
async function loadModel({ modelId, preferDevice = 'auto' }) {
  if (isLoading) return;
  if (model && tokenizer && activeModelId === modelId) {
    self.postMessage({
      type: 'model_ready',
      modelId: activeModelId,
      device: activeDevice,
      dtype: activeDtype,
      fromCache: true,
      cachedInStorage: true
    });
    return;
  }

  isLoading = true;
  distributionCache.clear();

  try {
    await ensurePersistentStorageQuota();

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

    const preCacheState = await checkModelCachedState(modelId, targetDtype);
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (
      isOffline &&
      preCacheState.cached &&
      !preCacheState.dtypes.includes(targetDtype) &&
      preCacheState.dtypes.length > 0
    ) {
      targetDtype = preCacheState.dtypes[0];
      if (targetDtype === 'q4' && targetDevice === 'webgpu') {
        targetDevice = 'wasm';
      }
    }

    const loadingFromCache =
      preCacheState.cached && preCacheState.dtypes.includes(targetDtype);

    self.postMessage({
      type: 'model_status',
      status: 'loading_tokenizer',
      message: loadingFromCache
        ? `Restoring ${modelId} tokenizer from long-term storage...`
        : `Loading tokenizer for ${modelId}...`,
      modelId,
      device: targetDevice,
      dtype: targetDtype,
      fromCache: loadingFromCache
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
        percent,
        fromCache: loadingFromCache
      });
    };

    if (loadedTokenizers.has(modelId)) {
      tokenizer = loadedTokenizers.get(modelId);
    } else {
      tokenizer = await AutoTokenizer.from_pretrained(modelId, {
        progress_callback: onProgress
      });
      loadedTokenizers.set(modelId, tokenizer);
    }

    self.postMessage({
      type: 'model_status',
      status: 'loading_weights',
      message: loadingFromCache
        ? `Loading cached ONNX weights from storage (${targetDevice.toUpperCase()} • ${targetDtype})...`
        : `Fetching & caching ONNX weights (${targetDevice.toUpperCase()} • ${targetDtype})...`,
      modelId,
      device: targetDevice,
      dtype: targetDtype,
      fromCache: loadingFromCache
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
          dtype: targetDtype,
          fromCache: preCacheState.dtypes.includes(targetDtype)
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

    // Ensure all asynchronous writes to OPFS / IndexedDB / CacheStorage have settled
    if (pendingCacheWrites.size > 0) {
      await Promise.allSettled(Array.from(pendingCacheWrites));
    }

    await writeRecordToIndexedDB('models', {
      modelId,
      device: targetDevice,
      dtype: targetDtype,
      cachedAt: Date.now()
    });

    const cachedModels = await broadcastCachedModelsStatus([modelId]);

    activeModelId = modelId;
    activeDevice = targetDevice;
    activeDtype = targetDtype;
    isLoading = false;

    self.postMessage({
      type: 'model_ready',
      modelId: activeModelId,
      device: activeDevice,
      dtype: activeDtype,
      fromCache: loadingFromCache,
      cachedInStorage: Boolean(cachedModels[modelId]?.cached)
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

// Proactively inspect long-term storage on worker boot so the UI knows which models are cached
broadcastCachedModelsStatus().catch(() => {});

self.addEventListener('message', async (event) => {
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;

  if (data.type === 'query_cached_models') {
    await broadcastCachedModelsStatus(Array.isArray(data.modelIds) ? data.modelIds : []);
    return;
  }

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
      const targetModelId = data.modelId || 'HuggingFaceTB/SmolLM2-135M-Instruct';
      if (!model || !tokenizer || activeModelId !== targetModelId) {
        await loadModel({
          modelId: targetModelId,
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
      const targetModelId = data.modelId || 'HuggingFaceTB/SmolLM2-135M-Instruct';
      if (!model || !tokenizer || activeModelId !== targetModelId) {
        await loadModel({
          modelId: targetModelId,
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
