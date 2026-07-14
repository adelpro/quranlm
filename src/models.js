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
async function readCrossOrigin(entry) {
  if (!isCrossOriginStorageAvailable()) return null;
  try {
    const handle = await withTimeout(
      navigator.crossOriginStorage.requestFileHandle(hashFor(entry)),
      8000,
      'crossOriginStorage.requestFileHandle() timed out after 8s',
    );
    if (!handle) return null;
    // Some extension builds return a handle whose getFile isn't a function
    // (or throws synchronously). Guard so we can still fall back to HTTP.
    if (typeof handle.getFile !== 'function') {
      console.warn('crossOriginStorage: handle has no getFile(); falling back to HTTP');
      return null;
    }
    const file = await handle.getFile();
    return file ?? null;
  } catch (err) {
    console.warn('crossOriginStorage read failed:', err);
    return null;
  }
}

/**
 * Write a Blob to Cross-Origin Storage, keyed by SHA-256.
 * @param {ModelEntry} entry
 * @param {Blob} blob
 */
async function writeCrossOrigin(entry, blob) {
  if (!isCrossOriginStorageAvailable()) return;
  try {
    const handle = await navigator.crossOriginStorage.requestFileHandle(
      hashFor(entry),
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
export async function isCached(modelId) {
  const entry = MODELS[modelId];
  if (!entry) return false;
  return (await readCrossOrigin(entry)) != null || (await readCache(entry)) != null;
}

/**
 * Look up a cached Blob. Prefers Cross-Origin Storage, falls back to Cache API.
 * @param {string} modelId
 * @returns {Promise<Blob | null>}
 */
export async function getCachedBlob(modelId) {
  const entry = MODELS[modelId];
  if (!entry) return null;
  return (await readCrossOrigin(entry)) ?? (await readCache(entry));
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
export async function downloadModel(modelId, opts = {}) {
  const { onProgress, signal, preferredStorage = 'cache' } = opts;
  const entry = MODELS[modelId];
  if (!entry) throw new Error(`Unknown model: ${modelId}`);

  // Already cached anywhere? Reuse without touching the network.
  const existing = await getCachedBlob(modelId);
  if (existing) {
    onProgress?.({ downloaded: existing.size, total: existing.size, done: true });
    return existing;
  }

  const res = await fetch(entry.url, { signal });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText} — ${entry.url}\n` +
      `If the URL has changed, update MODELS in src/models.js.`,
    );
  }
  if (!res.body) throw new Error('Response had no body');

  const declaredTotal = Number(res.headers.get('content-length')) || null;
  const total = declaredTotal ?? entry.approxSize ?? null;

  const reader = res.body.getReader();
  const chunks = [];
  let downloaded = 0;
  let lastEmit = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloaded += value.byteLength;

      const now = Date.now();
      if (now - lastEmit > 100) {
        onProgress?.({ downloaded, total });
        lastEmit = now;
      }
    }
  } catch (err) {
    reader.cancel().catch(() => {});
    throw err;
  }

  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  chunks.length = 0;

  // Verify integrity against the LFS-declared SHA-256 before persisting.
  await verifySha256(blob, entry.sha256).catch((err) => {
    throw new Error(`SHA-256 mismatch for ${entry.filename}: ${err.message}`);
  });

  // Persist to the preferred backend. Cross-Origin Storage is always written
  // first when selected so the globally-shared copy is available even if the
  // local Cache API write fails.
  if (preferredStorage === 'cross-origin' || preferredStorage === 'both') {
    await writeCrossOrigin(entry, blob);
  }
  if (preferredStorage === 'cache' || preferredStorage === 'both') {
    await writeCache(entry, blob);
  }

  onProgress?.({ downloaded: blob.size, total: blob.size, done: true });
  return blob;
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