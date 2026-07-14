// Model registry + storage layer.
//
// Two storage backends, used in priority order:
//
//   1. Cross-Origin Storage (navigator.crossOriginStorage) — proposed WICG
//      API, only available today via the Chrome extension. Files are looked
//      up by SHA-256, so the same model can be shared across sites and
//      downloads are verified by the browser on write.
//      See https://huggingface.co/blog/cross-origin-storage
//
//   2. Cache API — works in every browser, but per-origin.
//
// Reads try #1 first, then fall back to #2. Writes always go to both.

const CACHE_NAME = 'litert-models-v1';

async function sha256(message) {
  // Convert string to Uint8Array
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  // Use SubtleCrypto to compute SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * @typedef {Object} ModelEntry
 * @property {string} id
 * @property {string} label
 * @property {string} sublabel
 * @property {string} url          HuggingFace URL (raw .litertlm file)
 * @property {string} filename
 * @property {string} sha256       Hex SHA-256 of the .litertlm bytes
 * @property {number} approxSize   Exact byte count from the HF LFS pointer
 */

/** @type {Record<string, ModelEntry>} */
export const MODELS = {
  e2b: {
    id: 'e2b',
    label: 'Gemma 4 E2B',
    sublabel: '~1.9 GB · faster, lighter',
    url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm',
    filename: 'gemma-4-E2B-it-web.litertlm',
    sha256: '3a08e8d94e23b814ae5414469c370c503813949acb8ceaa17e4ebf8a35af35b5',
    approxSize: 2_008_432_640,
  },
  e4b: {
    id: 'e4b',
    label: 'Gemma 4 E4B',
    sublabel: '~2.8 GB · smarter, slower',
    url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm',
    filename: 'gemma-4-E4B-it-web.litertlm',
    sha256: '3904d826d5dddd25ea173e85204caec09e68ba038116e9b992b69cbdc94f57a0',
    approxSize: 2_969_059_328,
  },
};

export function listModels() {
  return Object.values(MODELS);
}

export function getModel(id) {
  return MODELS[id] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Origin Storage backend
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @returns {boolean} true if navigator.crossOriginStorage is exposed
 *                    (currently requires the Chrome extension).
 */
export function isCrossOriginStorageAvailable() {
  return typeof navigator !== 'undefined'
    && 'crossOriginStorage' in navigator;
}

function hashFor(entry) {
  return { algorithm: 'SHA-256', value: entry.sha256 };
}

/**
 * Try to read a stored File from Cross-Origin Storage. Returns null if the
 * backend is unavailable or the file isn't there.
 * @param {ModelEntry} entry
 * @returns {Promise<Blob | null>}
 */
/**
 * Try to read a stored File from Cross-Origin Storage. Returns null if the
 * backend is unavailable or the file isn't there.
 * @param {ModelEntry | string} entry - Model entry or hash string
 * @returns {Promise<Blob | null>}
 */
async function readCrossOrigin(entry) {
  if (!isCrossOriginStorageAvailable()) return null;

  let hashObj;
  if (typeof entry === 'string') {
    // If we got a hash string, create a hash object
    hashObj = { algorithm: 'SHA-256', value: entry };
  } else {
    hashObj = hashFor(entry);
  }

  try {
    const handle = await withTimeout(
      navigator.crossOriginStorage.requestFileHandle(hashObj),
      8000,
      'crossOriginStorage.requestFileHandle() timed out after 8s',
    );
    if (!handle) return null;
    if (typeof handle.getFile !== 'function') {
      console.warn('crossOriginStorage: handle has no getFile(); falling back to HTTP');
      return null;
    }
    const file = await handle.getFile();
    return file ?? null;
  } catch (err) {
    // Don't log "not found" errors as warnings - they're expected
    if (!err?.message?.includes('not found')) {
      console.warn('crossOriginStorage read failed:', err);
    }
    return null;
  }
}

/**
 * Write a Blob to Cross-Origin Storage, keyed by SHA-256.
 * @param {ModelEntry} entry
 * @param {Blob} blob
 */
/**
 * Write a Blob to Cross-Origin Storage, keyed by SHA-256.
 * @param {ModelEntry | string} entry - Model entry or hash string
 * @param {Blob} blob
 */
async function writeCrossOrigin(entry, blob) {
  if (!isCrossOriginStorageAvailable()) return;

  let hashObj;
  if (typeof entry === 'string') {
    hashObj = { algorithm: 'SHA-256', value: entry };
  } else {
    hashObj = hashFor(entry);
  }

  try {
    const handle = await navigator.crossOriginStorage.requestFileHandle(
      hashObj,
      { create: true, origins: '*' },
    );
    if (!handle) return;
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    console.warn('crossOriginStorage write failed:', err);
  }
}
async function deleteCrossOrigin(entry) {
  if (!isCrossOriginStorageAvailable()) return;
  try {
    // No explicit delete API in the current proposal — the cache entry will
    // expire naturally. Best-effort: just clear our local reference.
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache API backend (fallback)
// ─────────────────────────────────────────────────────────────────────────────

async function openCache() {
  return caches.open(CACHE_NAME);
}

function cacheRequest(entry) {
  return new Request(entry.url);
}

async function readCache(entry) {
  try {
    const cache = await withTimeout(openCache(), 3000, 'caches.open() timed out');
    const res = await cache.match(cacheRequest(entry));
    if (!res) return null;
    return res.blob();
  } catch (err) {
    console.warn('Cache API read failed:', err);
    return null;
  }
}

async function writeCache(entry, blob) {
  try {
    const cache = await openCache();
    await cache.put(cacheRequest(entry), new Response(blob));
  } catch (err) {
    console.warn('Cache API write failed:', err);
  }
}

async function deleteCache(entry) {
  try {
    const cache = await openCache();
    await cache.delete(cacheRequest(entry));
  } catch (err) {
    console.warn('Cache API delete failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — backed by whichever tier is available
// ─────────────────────────────────────────────────────────────────────────────

/** @returns {Promise<boolean>} */
/** @returns {Promise<boolean>} */
export async function isCached(modelId) {
  const model = MODELS[modelId];
  if (!model) return false;

  // Try cross-origin storage first if available
  if (isCrossOriginStorageAvailable()) {
    try {
      const file = await readCrossOrigin(model);
      if (file) return true;
    } catch (err) {
      // If it's a "not found" error, that's fine - just continue to Cache API
      if (!err?.message?.includes('not found')) {
        console.debug('[models] Cross-origin storage error:', err.message);
      }
      // Continue to Cache API fallback
    }
  }

  // Fallback to Cache API
  try {
    const cache = await caches.open('litert-models');
    const response = await cache.match(model.url);
    if (response) {
      return true;
    }
  } catch (err) {
    console.debug('[models] Cache API error:', err.message);
  }

  return false;
}
/**
 * Look up a cached Blob. Prefers Cross-Origin Storage, falls back to Cache API.
 * @param {string} modelId
 * @returns {Promise<Blob | null>}
 */
/**
 * Look up a cached Blob. Prefers Cross-Origin Storage, falls back to Cache API.
 * @param {string} modelId
 * @returns {Promise<Blob | null>}
 */
export async function getCachedBlob(modelId) {
  const model = MODELS[modelId];
  if (!model) return null;

  // Try cross-origin storage first
  if (isCrossOriginStorageAvailable()) {
    try {
      const file = await readCrossOrigin(model);
      if (file) {
        console.log('[models] Found in cross-origin storage');
        return file;
      }
    } catch (err) {
      if (!err?.message?.includes('not found')) {
        console.warn('[models] Cross-origin storage read failed:', err);
      }
      // Continue to Cache API
    }
  }

  // Fallback to Cache API
  try {
    const cache = await caches.open('litert-models');
    const response = await cache.match(model.url);
    if (response) {
      console.log('[models] Found in Cache API');
      return await response.blob();
    }
  } catch (err) {
    console.warn('[models] Cache API read failed:', err);
  }

  return null;
}

/** Which backend served the lookup — for surfacing in the UI. */
export function backendLabel() {
  return isCrossOriginStorageAvailable()
    ? 'Cross-Origin Storage'
    : 'Cache API';
}

/**
 * Delete a model from both backends.
 * @param {string} modelId
 */
export async function deleteCached(modelId) {
  const entry = MODELS[modelId];
  if (!entry) return;
  await Promise.all([
    deleteCrossOrigin(entry),
    deleteCache(entry),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Download
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProgressInfo
 * @property {number} downloaded
 * @property {number|null} total
 * @property {boolean} [done]
 */

/**
 * Download a model into the preferred storage backend and return a Blob ready
 * for `Engine.create({ model })`. Reads always check both backends (so a model
 * downloaded with a previous preference still works); writes go to the
 * currently-selected backend.
 *
 * @param {string} modelId
 * @param {{
 *   onProgress?: (p: ProgressInfo) => void,
 *   signal?: AbortSignal,
 *   preferredStorage?: 'cache' | 'cross-origin' | 'both',
 * }} [opts]
 * @returns {Promise<Blob>}
 */
/**
 * Download a model into the preferred storage backend and return a Blob ready
 * for `Engine.create({ model })`. Reads always check both backends (so a model
 * downloaded with a previous preference still works); writes go to the
 * currently-selected backend.
 *
 * @param {string} modelId
 * @param {{
 *   onProgress?: (p: ProgressInfo) => void,
 *   signal?: AbortSignal,
 *   preferredStorage?: 'cache' | 'cross-origin' | 'both',
 * }} [opts]
 * @returns {Promise<Blob>}
 */
export async function downloadModel(modelId, options = {}) {
  const model = MODELS[modelId];
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  const { onProgress, preferredStorage = 'cache' } = options;

  // Determine which storage to use
  const useCrossOrigin = preferredStorage === 'cross-origin' && isCrossOriginStorageAvailable();

  // Download the model
  const response = await fetch(model.url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : null;
  const reader = response.body.getReader();

  // Collect chunks
  const chunks = [];
  let downloaded = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    chunks.push(value);
    downloaded += value.length;

    if (onProgress) {
      onProgress({ downloaded, total });
    }
  }

  // Combine chunks into a single Blob
  const blob = new Blob(chunks);

  // Store in the selected backend
  if (useCrossOrigin) {
    try {
      await writeCrossOrigin(model, blob);
      console.log('[models] Stored in cross-origin storage');
    } catch (err) {
      console.warn('[models] Failed to write to cross-origin storage, falling back to Cache API:', err);
      // Fallback to Cache API
      await storeInCache(model.url, blob);
    }
  } else {
    // Store in Cache API
    await storeInCache(model.url, blob);
  }

  return blob;
}

// Helper function to store in Cache API
async function storeInCache(url, blob) {
  try {
    const cache = await caches.open('litert-models');
    const response = new Response(blob, {
      headers: { 'Content-Type': 'application/octet-stream' }
    });
    await cache.put(url, response);
    console.log('[models] Stored in Cache API');
  } catch (err) {
    console.error('[models] Failed to store in Cache API:', err);
    throw err;
  }
}

/**
 * @param {Blob} blob
 * @param {string} expectedHex
 */
async function verifySha256(blob, expectedHex) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const actualHex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (actualHex !== expectedHex.toLowerCase()) {
    throw new Error(`expected ${expectedHex}, got ${actualHex}`);
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} reason
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, reason) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(reason)), ms);
    }),
  ]);
}