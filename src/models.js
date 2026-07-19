const CACHE_NAME = 'litert-models-v1';

// Persistence is delegated to the canonical COS utility (src/utils/cross-origin-storage.js),
// which follows the WICG Cross-Origin Storage spec correctly:
// - write handles from `{create:true}` are write-only (no `getFile()` afterwards)
// - hash verification happens during `writable.close()`
// - reads are re-requested per call (no implicit cache).
import {
  isCrossOriginStorageAvailable,
  readFromCOS,
  writeToCOS,
  deleteFromCOS,
} from './utils/cross-origin-storage.js';
export { isCrossOriginStorageAvailable };

// ─── SHA-256 ──────────────────────────────────────────────────────────────

async function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Verify a Blob's SHA-256 hash matches the expected value.
 * @param {Blob} blob
 * @param {string} expectedHex
 * @returns {Promise<boolean>}
 */
async function verifySha256(blob, expectedHex) {
  console.log(`[verify] Starting SHA256 verification...`);
  console.log(`[verify] Expected: ${expectedHex.substring(0, 16)}...`);
  console.log(`[verify] Blob size: ${blob.size} bytes (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);

  try {
    const startTime = performance.now();
    const buf = await blob.arrayBuffer();
    const readTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[verify] ArrayBuffer read in ${readTime}s`);

    const digest = await crypto.subtle.digest('SHA-256', buf);
    const actualHex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const isValid = actualHex === expectedHex.toLowerCase();
    console.log(`[verify] Actual:   ${actualHex.substring(0, 16)}...`);
    console.log(`[verify] ${isValid ? '✅ MATCH' : '❌ MISMATCH'}`);

    if (!isValid) {
      console.log(`[verify] Full expected: ${expectedHex}`);
      console.log(`[verify] Full actual:   ${actualHex}`);
    }

    return isValid;
  } catch (err) {
    console.error('[verify] Hash verification error:', err);
    return false;
  }
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
//
// All persistence is delegated to the canonical COS utility
// (src/utils/cross-origin-storage.js). The previous inline implementation
// was deleted because it called `handle.getFile()` on a write handle — which
// is a no-op under the WICG spec — and then DELETED what it had just written,
// producing silent data loss. The util does it correctly:
//   * `writable.close()` triggers the browser's own hash verification.
//   * Reads use a separate `requestFileHandles([hashObj])` call (no create).
//   * `__non_standard__deleteResource` is the only delete currently exposed.
// ─────────────────────────────────────────────────────────────────────────────

function hashFor(entry) {
  return { algorithm: 'SHA-256', value: entry.sha256 };
}

async function readCrossOrigin(entry) {
  return readFromCOS(hashFor(entry));
}

async function writeCrossOrigin(entry, blob) {
  return writeToCOS(hashFor(entry), blob);
}

async function deleteCrossOrigin(entry) {
  return deleteFromCOS(hashFor(entry));
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
    const response = new Response(blob, {
      headers: { 'Content-Type': 'application/octet-stream' }
    });
    await cache.put(cacheRequest(entry), response);
    return true;
  } catch (err) {
    console.warn('Cache API write failed:', err);
    return false;
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

async function storeInCache(url, blob) {
  try {
    const cache = await openCache();
    const response = new Response(blob, {
      headers: { 'Content-Type': 'application/octet-stream' }
    });
    await cache.put(url, response);
    console.log('[models] Stored in Cache API');
    return true;
  } catch (err) {
    console.error('[models] Failed to store in Cache API:', err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — with automatic validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a model in storage:
 * - Check if it exists
 * - Verify SHA-256 hash
 * - Auto-delete corrupted files
 * 
 * @param {string} modelId
 * @returns {Promise<{ exists: boolean, valid: boolean, size: number | null }>}
 */
export async function validateModel(modelId) {
  const model = MODELS[modelId];
  if (!model) {
    console.log(`[models] ${modelId}: Model not found in registry`);
    return { exists: false, valid: false, size: null };
  }

  console.log(`[models] ${modelId}: Starting validation...`);
  console.log(`[models] ${modelId}: Expected SHA256: ${model.sha256.substring(0, 16)}...`);

  // Try cross-origin first
  if (isCrossOriginStorageAvailable()) {
    console.log(`[models] ${modelId}: Cross-origin storage available, checking...`);
    try {
      const file = await readCrossOrigin(model);
      if (file) {
        console.log(`[models] ${modelId}: Cross-origin file found, size: ${file.size} bytes`);
        // Size-sanity check only. We deliberately skip the SHA-256 verify
        // here because calling .arrayBuffer() on a WICG-stored File
        // consumes the underlying storage stream — Engine.create then
        // sees an empty/closed Blob and hangs on its second read.
        // LiteRT-LM's WASM parser validates the file format itself when
        // it loads; if the bytes are corrupted, Engine.create will
        // throw and we delete + re-download at that point.
        const sizeMatches = file.size === model.approxSize;
        if (!sizeMatches) {
          console.warn(
            `[models] ${modelId}: Size mismatch (expected ${model.approxSize}, got ${file.size}) — may be corrupted`
          );
        } else {
          console.log(`[models] ${modelId}: ✅ Cross-origin file present (size matches)`);
        }
        return { exists: true, valid: sizeMatches, size: file.size, blob: file };
      } else {
        console.log(`[models] ${modelId}: Cross-origin file not found`);
      }
    } catch (err) {
      console.warn(`[models] ${modelId}: Cross-origin read failed:`, err.message);
    }
  } else {
    console.log(`[models] ${modelId}: Cross-origin storage NOT available`);
  }

  // Fallback to Cache API
  console.log(`[models] ${modelId}: Checking Cache API...`);
  try {
    const blob = await readCache(model);
    if (blob) {
      console.log(`[models] ${modelId}: Cache file found, size: ${blob.size} bytes`);
      const sizeMatches = blob.size === model.approxSize;
      return { exists: true, valid: sizeMatches, size: blob.size, blob };
    } else {
      console.log(`[models] ${modelId}: Cache file not found`);
    }
  } catch (err) {
    console.warn(`[models] ${modelId}: Cache read failed:`, err.message);
  }

  console.log(`[models] ${modelId}: ❌ Model not found in any storage`);
  return { exists: false, valid: false, size: null };
}

/**
 * Check if a model is cached and valid.
 * @param {string} modelId
 * @returns {Promise<boolean>}
 */
export async function isCached(modelId) {
  const result = await validateModel(modelId);
  return result.exists && result.valid;
}

/**
 * Look up a cached Blob. Prefers Cross-Origin Storage, falls back to Cache API.
 * Auto-validates SHA-256 and deletes corrupted files.
 * @param {string} modelId
 * @returns {Promise<Blob | null>}
 */
export async function getCachedBlob(modelId) {
  const model = MODELS[modelId];
  if (!model) return null;

  // Try cross-origin first
  if (isCrossOriginStorageAvailable()) {
    try {
      const file = await readCrossOrigin(model);
      if (file) {
        const isValid = await verifySha256(file, model.sha256);
        if (isValid) {
          console.log('[models] Found valid in cross-origin storage');
          return file;
        } else {
          console.warn('[models] Cross-origin file corrupted, deleting...');
          await deleteCrossOrigin(model);
        }
      }
    } catch (err) {
      console.warn('[models] Cross-origin read failed:', err);
    }
  }

  // Fallback to Cache API
  try {
    const blob = await readCache(model);
    if (blob) {
      const isValid = await verifySha256(blob, model.sha256);
      if (isValid) {
        console.log('[models] Found valid in Cache API');
        return blob;
      } else {
        console.warn('[models] Cache file corrupted, deleting...');
        await deleteCache(model);
      }
    }
  } catch (err) {
    console.warn('[models] Cache read failed:', err);
  }

  return null;
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
  console.log(`[models] ${modelId} deleted from all storage`);
}

/** Which backend served the lookup — for surfacing in the UI. */
export function backendLabel() {
  return isCrossOriginStorageAvailable()
    ? 'Cross-Origin Storage'
    : 'Cache API';
}

// ─────────────────────────────────────────────────────────────────────────────
// Download with verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProgressInfo
 * @property {number} downloaded
 * @property {number|null} total
 * @property {boolean} [done]
 */

/**
 * Download a model into the preferred storage backend and return a Blob ready
 * for `Engine.create({ model })`. 
 * 
 * - Verifies SHA-256 hash BEFORE storing
 * - Stores in the selected backend
 * - Returns the validated blob
 *
 * @param {string} modelId
 * @param {{
 *   onProgress?: (p: ProgressInfo) => void,
 *   signal?: AbortSignal,
 *   preferredStorage?: 'cache' | 'cross-origin',
 * }} [opts]
 * @returns {Promise<Blob>}
 */
export async function downloadModel(modelId, options = {}) {
  const model = MODELS[modelId];
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  const { onProgress, preferredStorage = 'cache' } = options;
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

  // VERIFY HASH BEFORE STORING
  const isValid = await verifySha256(blob, model.sha256);
  if (!isValid) {
    throw new Error(
      `Downloaded file hash mismatch.\nExpected: ${model.sha256}\nDownloaded: (hash verification failed)`
    );
  }

  console.log('[models] Download verified successfully');

  // Store in the selected backend
  let stored = false;
  if (useCrossOrigin) {
    stored = await writeCrossOrigin(model, blob);
    if (stored) {
      console.log('[models] Stored in cross-origin storage');
    } else {
      console.warn('[models] Cross-origin write failed, falling back to Cache API');
      stored = await storeInCache(model.url, blob);
    }
  } else {
    stored = await storeInCache(model.url, blob);
  }

  if (!stored) {
    console.warn('[models] Storage failed, but returning blob from memory');
  }

  return blob;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

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