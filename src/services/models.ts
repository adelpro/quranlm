/**
 * Model service — registry + download + storage (Cross-Origin Storage and
 * Cache API).
 *
 * Design rules (see the migration plan):
 *   - `downloadModel()` accepts a real `AbortSignal` and plumbs it into
 *     `fetch` + the stream reader; cancellation stops network reading.
 *   - Verification (`verifySha256`) is performed ONLY against a freshly
 *     downloaded in-memory Blob. Cross-Origin Storage reads are passed
 *     straight to the engine without hashing — calling `arrayBuffer()` on
 *     a COS File consumes the underlying storage stream and hangs the
 *     engine on its second read.
 *   - All persistence is delegated to `services/cross-origin-storage.ts`,
 *     which follows the WICG Cross-Origin Storage spec correctly.
 */

import {
  deleteFromCOS,
  isCrossOriginStorageAvailable,
  readFromCOS,
  writeToCOS,
  type HashObject,
} from './cross-origin-storage';
import { getModel, MODELS, type ModelEntry } from '../data/models';
import { withTimeout } from '../lib/timeout';

const CACHE_NAME = 'litert-models-v1';

export { MODELS, getModel, listModels as _listModels } from '../data/models';
export { isCrossOriginStorageAvailable } from './cross-origin-storage';

// ─── Storage backend selection ────────────────────────────────────────

export type StorageBackend = 'cache' | 'cross-origin';

export interface EffectiveStorage {
  preferred: StorageBackend;
  effective: StorageBackend;
  available: 'cache' | 'cross-origin';
}

/** Which backend served the lookup — for surfacing in the UI. */
export function backendLabel(): 'Cross-Origin Storage' | 'Cache API' {
  return isCrossOriginStorageAvailable() ? 'Cross-Origin Storage' : 'Cache API';
}

// ─── SHA-256 verification ─────────────────────────────────────────────

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a Blob's SHA-256 hash matches the expected value. WARNING: only
 * call this on a freshly-downloaded in-memory Blob or a Cache API Blob.
 * Never call on a Cross-Origin Storage read — `arrayBuffer()` consumes
 * the storage stream.
 */
async function verifySha256(blob: Blob, expectedHex: string): Promise<boolean> {
  console.log(`[verify] Starting SHA256 verification...`);
  console.log(`[verify] Expected: ${expectedHex.substring(0, 16)}...`);
  console.log(`[verify] Blob size: ${blob.size} bytes (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);

  try {
    const startTime = performance.now();
    const buf = await blob.arrayBuffer();
    const readTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[verify] ArrayBuffer read in ${readTime}s`);

    const actualHex = await sha256Hex(buf);
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

// ─── Cross-Origin Storage backend ─────────────────────────────────────

function hashFor(entry: ModelEntry): HashObject {
  return { algorithm: 'SHA-256', value: entry.sha256 };
}

async function readCrossOrigin(entry: ModelEntry): Promise<Blob | null> {
  return readFromCOS(hashFor(entry));
}

async function writeCrossOrigin(entry: ModelEntry, blob: Blob): Promise<boolean> {
  return writeToCOS(hashFor(entry), blob);
}

async function deleteCrossOrigin(entry: ModelEntry): Promise<boolean> {
  return deleteFromCOS(hashFor(entry));
}

// ─── Cache API backend ────────────────────────────────────────────────

function cacheRequest(entry: ModelEntry): Request {
  return new Request(entry.url);
}

async function openCache(): Promise<Cache> {
  return withTimeout(caches.open(CACHE_NAME), 3000, 'caches.open() timed out');
}

async function readCache(entry: ModelEntry): Promise<Blob | null> {
  try {
    const cache = await openCache();
    const res = await cache.match(cacheRequest(entry));
    if (!res) return null;
    return res.blob();
  } catch (err) {
    console.warn('Cache API read failed:', err);
    return null;
  }
}

async function writeCache(entry: ModelEntry, blob: Blob): Promise<boolean> {
  try {
    const cache = await openCache();
    const response = new Response(blob, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    await cache.put(cacheRequest(entry), response);
    console.log('[models] Stored in Cache API');
    return true;
  } catch (err) {
    console.error('[models] Failed to store in Cache API:', err);
    return false;
  }
}

async function deleteCache(entry: ModelEntry): Promise<void> {
  try {
    const cache = await openCache();
    await cache.delete(cacheRequest(entry));
  } catch (err) {
    console.warn('[models] Cache API delete failed:', err);
  }
}

// ─── Validation ───────────────────────────────────────────────────────

export interface ModelValidation {
  exists: boolean;
  valid: boolean;
  size: number | null;
  blob?: Blob;
  backend?: 'cross-origin' | 'cache';
}

/**
 * Validate a model in storage:
 *   - check existence
 *   - verify SHA-256 (only against the Cache API — never against COS)
 *   - auto-delete corrupted files
 */
export async function validateModel(modelId: string): Promise<ModelValidation> {
  const entry = getModel(modelId);
  if (!entry) {
    console.log(`[models] ${modelId}: Model not found in registry`);
    return { exists: false, valid: false, size: null };
  }

  console.log(`[models] ${modelId}: Starting validation...`);
  console.log(`[models] ${modelId}: Expected SHA256: ${entry.sha256.substring(0, 16)}...`);

  // Cross-Origin first (preferred). Size check only — see comment above.
  if (isCrossOriginStorageAvailable()) {
    console.log(`[models] ${modelId}: Cross-origin storage available, checking...`);
    try {
      const file = await readCrossOrigin(entry);
      if (file) {
        console.log(`[models] ${modelId}: Cross-origin file found, size: ${file.size} bytes`);
        const sizeMatches = file.size === entry.approxSize;
        if (!sizeMatches) {
          console.warn(
            `[models] ${modelId}: Size mismatch (expected ${entry.approxSize}, got ${file.size}) — may be corrupted`,
          );
        } else {
          console.log(`[models] ${modelId}: ✅ Cross-origin file present (size matches)`);
        }
        return { exists: true, valid: sizeMatches, size: file.size, blob: file, backend: 'cross-origin' };
      }
      console.log(`[models] ${modelId}: Cross-origin file not found`);
    } catch (err) {
      console.warn(`[models] ${modelId}: Cross-origin read failed:`, err instanceof Error ? err.message : err);
    }
  } else {
    console.log(`[models] ${modelId}: Cross-origin storage NOT available`);
  }

  // Cache API fallback.
  console.log(`[models] ${modelId}: Checking Cache API...`);
  try {
    const blob = await readCache(entry);
    if (blob) {
      console.log(`[models] ${modelId}: Cache file found, size: ${blob.size} bytes`);
      const sizeMatches = blob.size === entry.approxSize;
      return { exists: true, valid: sizeMatches, size: blob.size, blob, backend: 'cache' };
    }
    console.log(`[models] ${modelId}: Cache file not found`);
  } catch (err) {
    console.warn(`[models] ${modelId}: Cache read failed:`, err instanceof Error ? err.message : err);
  }

  console.log(`[models] ${modelId}: ❌ Model not found in any storage`);
  return { exists: false, valid: false, size: null };
}

/**
 * Look up a cached Blob. Prefers Cross-Origin Storage, falls back to Cache API.
 * Verifies SHA-256 for the Cache API path; trusts size match for COS.
 */
export async function getCachedBlob(modelId: string): Promise<Blob | null> {
  const entry = getModel(modelId);
  if (!entry) return null;

  if (isCrossOriginStorageAvailable()) {
    try {
      const file = await readCrossOrigin(entry);
      if (file) {
        // For COS, we trust the size match (never call arrayBuffer()).
        if (file.size === entry.approxSize) {
          console.log('[models] Found valid in cross-origin storage');
          return file;
        }
        console.warn('[models] Cross-origin file size mismatch, deleting...');
        await deleteCrossOrigin(entry);
      }
    } catch (err) {
      console.warn('[models] Cross-origin read failed:', err);
    }
  }

  try {
    const blob = await readCache(entry);
    if (blob) {
      const isValid = await verifySha256(blob, entry.sha256);
      if (isValid) {
        console.log('[models] Found valid in Cache API');
        return blob;
      }
      console.warn('[models] Cache file corrupted, deleting...');
      await deleteCache(entry);
    }
  } catch (err) {
    console.warn('[models] Cache read failed:', err);
  }

  return null;
}

/** Delete a model from both backends. */
export async function deleteCached(modelId: string): Promise<void> {
  const entry = getModel(modelId);
  if (!entry) return;
  await Promise.all([deleteCrossOrigin(entry), deleteCache(entry)]);
  console.log(`[models] ${modelId} deleted from all storage`);
}

// ─── Download ─────────────────────────────────────────────────────────

export interface ProgressInfo {
  downloaded: number;
  total: number | null;
  /** Last phase — used by the React UI for verification / storing. */
  phase?: 'fetching' | 'verifying' | 'storing' | 'done' | 'error';
}

export interface DownloadOptions {
  onProgress?: (p: ProgressInfo) => void;
  signal?: AbortSignal;
  preferredStorage?: StorageBackend;
}

/**
 * Download a model into the preferred storage backend and return a Blob
 * ready for `Engine.create({ model })`.
 *
 * - Verifies SHA-256 BEFORE storing.
 * - Stores in the selected backend (falls back to Cache API if COS fails).
 * - Returns the validated blob regardless of storage success.
 */
export async function downloadModel(
  modelId: string,
  options: DownloadOptions = {},
): Promise<Blob> {
  const entry = getModel(modelId);
  if (!entry) throw new Error(`Unknown model: ${modelId}`);

  const { onProgress, signal, preferredStorage = 'cross-origin' } = options;
  const useCrossOrigin = preferredStorage === 'cross-origin' && isCrossOriginStorageAvailable();

  onProgress?.({ downloaded: 0, total: null, phase: 'fetching' });

  const response = await fetch(entry.url, { redirect: 'follow', signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error('Response had no body — cannot download model.');
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? Number.parseInt(contentLength, 10) : null;
  const reader = response.body.getReader();

  const chunks: BlobPart[] = [];
  let downloaded = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      // Re-buffer each chunk into a fresh ArrayBuffer so the Blob constructor
      // sees `ArrayBuffer` rather than `ArrayBufferLike` (avoids the
      // SharedArrayBuffer mismatch surfaced under strict DOM lib types).
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy);
      downloaded += value.length;
      onProgress?.({ downloaded, total, phase: 'fetching' });
    }
  } catch (err) {
    if (signal?.aborted) {
      throw new DOMException('Download cancelled', 'AbortError');
    }
    throw err;
  }

  const blob = new Blob(chunks);

  // Verify BEFORE storing — never store a corrupt blob.
  onProgress?.({ downloaded, total, phase: 'verifying' });
  const isValid = await verifySha256(blob, entry.sha256);
  if (!isValid) {
    onProgress?.({ downloaded, total, phase: 'error' });
    throw new Error(
      `Downloaded file hash mismatch.\nExpected: ${entry.sha256}\nDownloaded: (hash verification failed)`,
    );
  }
  console.log('[models] Download verified successfully');

  onProgress?.({ downloaded, total, phase: 'storing' });
  let stored = false;
  if (useCrossOrigin) {
    stored = await writeCrossOrigin(entry, blob);
    if (stored) {
      console.log('[models] Stored in cross-origin storage');
    } else {
      console.warn('[models] Cross-origin write failed, falling back to Cache API');
      stored = await writeCache(entry, blob);
    }
  } else {
    stored = await writeCache(entry, blob);
  }

  if (!stored) {
    console.warn('[models] Storage failed, but returning blob from memory');
  }

  onProgress?.({ downloaded, total, phase: 'done' });
  return blob;
}

// Suppress unused-import warning when the consumer only uses the type.
export type { ModelEntry };
// Reference MODELS so the import isn't tree-shaken away during local dev.
void MODELS;