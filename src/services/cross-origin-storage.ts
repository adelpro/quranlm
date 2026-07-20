/**
 * Cross-Origin Storage (COS) Utility — typed wrapper around the WICG API.
 *
 * Spec: https://wicg.github.io/cross-origin-storage/
 *
 * Key points:
 * - `requestFileHandles()` (plural) returns `FileSystemFileHandle[]`
 * - Write handles are write-only — `getFile()` fails on them
 * - Reading requires transient activation (user interaction)
 * - Hash verification is automatic during write
 */

// ─── Hash shape ───────────────────────────────────────────────────────

export interface HashObject {
  algorithm: 'SHA-256';
  value: string;
}

export function createHashObject(hex: string): HashObject {
  return { algorithm: 'SHA-256', value: hex };
}

// ─── Detection ────────────────────────────────────────────────────────

function getCOS(): CrossOriginStorage | null {
  if (typeof navigator === 'undefined') return null;
  const cos = navigator.crossOriginStorage;
  if (!cos) return null;
  // Either the singular or the plural form must exist.
  if (typeof cos.requestFileHandle !== 'function' && typeof cos.requestFileHandles !== 'function') {
    return null;
  }
  return cos;
}

export function isCrossOriginStorageAvailable(): boolean {
  const available = getCOS() !== null;
  if (available) {
    console.log('[COS] ✅ Storage available');
  } else {
    console.log('[COS] ❌ Storage NOT available');
    if (typeof navigator !== 'undefined' && navigator.crossOriginStorage) {
      console.log('[COS] Methods:', Object.keys(navigator.crossOriginStorage));
    }
  }
  return available;
}

// ─── Write ────────────────────────────────────────────────────────────

/**
 * Write a Blob to Cross-Origin Storage. Hash verification is automatic
 * during write (the browser does it on `writable.close()`).
 */
export async function writeToCOS(
  hashObj: HashObject,
  blob: Blob,
  origins: string[] = ['*'],
): Promise<boolean> {
  const cos = getCOS();
  if (!cos) {
    console.warn('[COS] Cannot write: storage not available');
    return false;
  }

  console.log(`[COS] Writing ${(blob.size / 1024 / 1024).toFixed(1)} MB...`);
  console.log(`[COS] Hash: ${hashObj.value.substring(0, 16)}...`);

  try {
    // Clean slate — delete any pre-existing file at this hash.
    await deleteFromCOS(hashObj);

    // Prefer the singular form per WICG deprecation
    // (https://github.com/WICG/cross-origin-storage/issues/61); fall back to
    // the legacy plural form.
    console.log('[COS] Requesting write handle...');
    const handle = await requestHandle(cos, hashObj, { create: true, origins });
    if (!handle) {
      console.warn('[COS] No handle returned');
      return false;
    }

    console.log('[COS] Writing data...');
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();

    console.log('[COS] ✅ Write completed (hash verified by browser)');
    return true;
  } catch (err) {
    console.error('[COS] Write failed:', err instanceof Error ? err.message : String(err));
    // Best-effort cleanup; ignore secondary errors.
    try {
      await deleteFromCOS(hashObj);
    } catch {
      /* ignore */
    }
    return false;
  }
}

async function requestHandle(
  cos: CrossOriginStorage,
  hashObj: HashObject,
  options?: CrossOriginStorageOptions,
): Promise<FileSystemFileHandle | null> {
  if (typeof cos.requestFileHandle === 'function') {
    return cos.requestFileHandle(hashObj, options);
  }
  if (typeof cos.requestFileHandles === 'function') {
    const handles = await cos.requestFileHandles([hashObj], options);
    return handles[0] ?? null;
  }
  return null;
}

// ─── Read ─────────────────────────────────────────────────────────────

/**
 * Read a file from Cross-Origin Storage. May trigger a permission prompt
 * (requires transient activation). Returns the Blob or null.
 */
export async function readFromCOS(hashObj: HashObject): Promise<Blob | null> {
  const cos = getCOS();
  if (!cos) {
    console.warn('[COS] Cannot read: storage not available');
    return null;
  }

  console.log(`[COS] Reading hash: ${hashObj.value.substring(0, 16)}...`);

  try {
    console.log('[COS] Requesting read handle (may prompt user)...');
    const handle = await requestHandle(cos, hashObj);
    if (!handle) {
      console.log('[COS] No handle returned (file not found or denied)');
      return null;
    }

    console.log('[COS] Reading file...');
    const file = await handle.getFile();
    if (!file) {
      console.log('[COS] getFile() returned null');
      return null;
    }

    console.log(`[COS] ✅ Read successful: ${file.size} bytes`);
    return file;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : String(err);

    if (name === 'NotFoundError' || msg.includes('not found')) {
      console.log('[COS] File not found');
      return null;
    }
    if (name === 'NotAllowedError') {
      console.warn('[COS] Permission denied by user');
      return null;
    }
    console.error('[COS] Read failed:', msg);
    return null;
  }
}

// ─── Delete ───────────────────────────────────────────────────────────

/**
 * Delete a file from Cross-Origin Storage. Uses the non-standard
 * `__non_standard__deleteResource` method when available, falling back to
 * overwriting with an empty Blob.
 */
export async function deleteFromCOS(hashObj: HashObject): Promise<boolean> {
  const cos = getCOS();
  if (!cos) return false;

  console.log(`[COS] Deleting: ${hashObj.value.substring(0, 16)}...`);

  try {
    // Prefer the non-standard delete method.
    const cosWithDelete = cos as CrossOriginStorage & {
      __non_standard__deleteResource?: (hash: HashObject) => Promise<void>;
    };
    if (typeof cosWithDelete.__non_standard__deleteResource === 'function') {
      await cosWithDelete.__non_standard__deleteResource(hashObj);
      console.log('[COS] ✅ Deleted successfully');
      return true;
    }

    // Fallback: overwrite with empty bytes.
    console.log('[COS] Delete method not available, trying overwrite...');
    const handle = await requestHandle(cos, hashObj, { create: true, origins: ['*'] });
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(new Blob([]));
      await writable.close();
      console.log('[COS] ✅ Overwritten with empty data');
      return true;
    }

    console.log('[COS] ❌ Delete failed');
    return false;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : String(err);
    if (name === 'NotFoundError' || msg.includes('not found')) {
      console.log('[COS] File not found (nothing to delete)');
      return true;
    }
    console.error('[COS] Delete failed:', msg);
    return false;
  }
}

// ─── List / exists ────────────────────────────────────────────────────

export async function listCOSFiles(): Promise<CrossOriginStorageFile[]> {
  const cos = getCOS();
  if (!cos) {
    console.warn('[COS] Cannot list: storage not available');
    return [];
  }
  try {
    if (typeof cos.listFiles === 'function') {
      const files = await cos.listFiles();
      console.log(`[COS] Found ${files.length} files`);
      return files;
    }
    console.log('[COS] listFiles not available');
    return [];
  } catch (err) {
    console.warn('[COS] List failed:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Check if a file exists in COS without reading it. Returns null on
 * permission error (the file may exist but is inaccessible).
 */
export async function existsInCOS(hashObj: HashObject): Promise<boolean | null> {
  const cos = getCOS();
  if (!cos) return false;
  try {
    const handle = await requestHandle(cos, hashObj);
    return handle !== null;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotFoundError') return false;
    console.warn('[COS] exists check failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}