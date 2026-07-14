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
// Reads try #1 first, then fall back to #2. Writes go to the selected backend.
// All reads automatically validate SHA-256 and delete corrupted files.

const CACHE_NAME = 'litert-models-v1';

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
  try {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const actualHex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return actualHex === expectedHex.toLowerCase();
  } catch (err) {
    console.error('Hash verification error:', err);
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
 * If the file is corrupted (hash mismatch), it's automatically deleted.
 * @param {ModelEntry | string} entry - Model entry or hash string
 * @returns {Promise<Blob | null>}
 */
async function readCrossOrigin(entry) {
  if (!isCrossOriginStorageAvailable()) return null;

  let hashObj;
  if (typeof entry === 'string') {
    hashObj = { algorithm: 'SHA-256', value: entry };
  } else {
    hashObj = hashFor(entry);
  }

  try {
    const handle = await withTimeout(
      navigator.crossOriginStorage.requestFileHandle(hashObj),
      8000,
      'crossOriginStorage.requestFileHandle() timed out after 8s'
    );
    if (!handle) return null;

    if (typeof handle.getFile !== 'function') {
      console.warn('crossOriginStorage: handle has no getFile(); falling back');
      return null;
    }

    try {
      const file = await handle.getFile();
      if (!file) return null;
      return file;
    } catch (getFileErr) {
      // getFile failed - file might be corrupted or still being written
      console.warn('crossOriginStorage: getFile failed:', getFileErr.message);

      // Wait and retry once (in case it's still being written)
      await new Promise(r => setTimeout(r, 300));
      try {
        const file = await handle.getFile();
        if (file) {
          console.log('crossOriginStorage: getFile succeeded on retry');
          return file;
        }
      } catch (retryErr) {
        console.warn('crossOriginStorage: Retry failed, deleting corrupted file');
        // Delete the corrupted file
        await deleteCrossOriginByHash(hashObj);
      }
      return null;
    }
  } catch (err) {
    if (err?.message?.includes('not found')) {
      return null;
    }
    console.warn('crossOriginStorage read failed:', err?.message || err);
    return null;
  }
}

/**
 * Write a Blob to Cross-Origin Storage, keyed by SHA-256.
 * @param {ModelEntry | string} entry - Model entry or hash string
 * @param {Blob} blob
 * @returns {Promise<boolean>} - true if write was successful
 */
async function writeCrossOrigin(entry, blob) {
  if (!isCrossOriginStorageAvailable()) return false;

  let hashObj;
  if (typeof entry === 'string') {
    hashObj = { algorithm: 'SHA-256', value: entry };
  } else {
    hashObj = hashFor(entry);
  }

  try {
    // Delete any existing file first (clean slate)
    if (typeof navigator.crossOriginStorage.__non_standard__deleteResource === 'function') {
      try {
        await navigator.crossOriginStorage.__non_standard__deleteResource(hashObj);
      } catch (e) { /* ignore if not found */ }
    }

    // Create new file
    const handle = await navigator.crossOriginStorage.requestFileHandle(
      hashObj,
      { create: true, origins: '*' }
    );
    if (!handle) return false;

    // Write the blob
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();

    // Give the extension a moment to process the write
    await new Promise(r => setTimeout(r, 200));

    // Verify by reading back
    try {
      const file = await handle.getFile();
      if (file && file.size === blob.size) {
        console.log('[models] Cross-origin storage write verified ✓');
        return true;
      } else {
        console.warn(`[models] Cross-origin write verification failed: size mismatch (expected ${blob.size}, got ${file?.size || 0})`);
        // Try to delete the corrupted file
        await deleteCrossOriginByHash(hashObj);
        return false;
      }
    } catch (verifyErr) {
      console.warn('[models] Cross-origin verification error:', verifyErr.message);
      // The write might still be successful even if getFile fails immediately
      // Try one more time with a longer delay
      await new Promise(r => setTimeout(r, 500));
      try {
        const file = await handle.getFile();
        if (file && file.size === blob.size) {
          console.log('[models] Cross-origin storage write verified on retry ✓');
          return true;
        }
      } catch (retryErr) {
        console.warn('[models] Cross-origin verification retry failed:', retryErr.message);
        // Delete the corrupted file
        await deleteCrossOriginByHash(hashObj);
        return false;
      }
      return false;
    }
  } catch (err) {
    console.warn('[models] Cross-origin write failed:', err);
    return false;
  }
}

/**
 * Delete a file from Cross-Origin Storage by hash object.
 * @param {Object} hashObj - { algorithm: 'SHA-256', value: string }
 */
async function deleteCrossOriginByHash(hashObj) {
  if (!isCrossOriginStorageAvailable()) return;
  try {
    // Try non-standard delete method first
    if (typeof navigator.crossOriginStorage.__non_standard__deleteResource === 'function') {
      await navigator.crossOriginStorage.__non_standard__deleteResource(hashObj);
      console.log('[models] Deleted from cross-origin storage');
      return;
    }

    // Fallback: try to overwrite with empty data
    const handle = await navigator.crossOriginStorage.requestFileHandle(
      hashObj,
      { create: true, origins: '*' }
    );
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(new Blob([]));
      await writable.close();
      console.log('[models] Overwritten cross-origin storage entry');
    }
  } catch (err) {
    console.warn('crossOriginStorage delete failed:', err);
  }
}

async function deleteCrossOrigin(entry) {
  if (!isCrossOriginStorageAvailable()) return;
  await deleteCrossOriginByHash(hashFor(entry));
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
  if (!model) return { exists: false, valid: false, size: null };

  // Try cross-origin first
  if (isCrossOriginStorageAvailable()) {
    try {
      const file = await readCrossOrigin(model);
      if (file) {
        const isValid = await verifySha256(file, model.sha256);
        if (isValid) {
          return { exists: true, valid: true, size: file.size };
        } else {
          console.warn(`[models] ${modelId}: Cross-origin file corrupted, deleting...`);
          await deleteCrossOrigin(model);
          return { exists: true, valid: false, size: file.size };
        }
      }
    } catch (err) {
      console.warn(`[models] ${modelId}: Cross-origin read failed:`, err.message);
    }
  }

  // Fallback to Cache API
  try {
    const blob = await readCache(model);
    if (blob) {
      const isValid = await verifySha256(blob, model.sha256);
      if (isValid) {
        return { exists: true, valid: true, size: blob.size };
      } else {
        console.warn(`[models] ${modelId}: Cache file corrupted, deleting...`);
        await deleteCache(model);
        return { exists: true, valid: false, size: blob.size };
      }
    }
  } catch (err) {
    console.warn(`[models] ${modelId}: Cache read failed:`, err.message);
  }

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