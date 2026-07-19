/**
 * Cross-Origin Storage (COS) Utility
 * Wraps the official COS API with proper error handling and logging.
 * 
 * Based on spec: https://wicg.github.io/cross-origin-storage/
 * 
 * Key concepts:
 * - requestFileHandles() (plural) - returns FileSystemFileHandle[] 
 * - Write handles are write-only - getFile() fails on them
 * - Reading requires transient activation (user interaction)
 * - Hash verification is automatic during write
 */

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} HashObject
 * @property {string} algorithm - 'SHA-256'
 * @property {string} value - Hex string
 */

/**
 * @typedef {Object} COSResult
 * @property {boolean} available
 * @property {boolean} supported
 */

// ─── Detection ────────────────────────────────────────────────────────────

/**
 * Check if Cross-Origin Storage is available in the current browser.
 * @returns {boolean}
 */
export function isCrossOriginStorageAvailable() {
    const available = typeof navigator !== 'undefined'
        && 'crossOriginStorage' in navigator
        && typeof navigator.crossOriginStorage.requestFileHandles === 'function';

    if (available) {
        console.log('[COS] ✅ Storage available');
    } else {
        console.log('[COS] ❌ Storage NOT available');
        if (typeof navigator !== 'undefined' && 'crossOriginStorage' in navigator) {
            console.log('[COS] Methods:', Object.keys(navigator.crossOriginStorage));
        }
    }

    return available;
}

/**
 * Get the COS API object with safe access.
 * @returns {object|null}
 */
function getCOS() {
    if (!isCrossOriginStorageAvailable()) return null;
    return navigator.crossOriginStorage;
}

// ─── Hash Helpers ────────────────────────────────────────────────────────

/**
 * Create a hash object from a hex string.
 * @param {string} hex - Hex string
 * @returns {HashObject}
 */
export function createHashObject(hex) {
    return { algorithm: 'SHA-256', value: hex };
}

/**
 * Get hash object from a model entry.
 * @param {Object} entry - Model entry with sha256 property
 * @returns {HashObject}
 */
export function hashForModel(entry) {
    return createHashObject(entry.sha256);
}

// ─── Write Operations ──────────────────────────────────────────────────

/**
 * Write a Blob to Cross-Origin Storage.
 * Hash verification is automatic during write.
 * 
 * @param {HashObject} hashObj - Hash object
 * @param {Blob} blob - Data to store
 * @param {string[]} origins - Allowed origins, ['*'] for all
 * @returns {Promise<boolean>} - true if write successful
 */
export async function writeToCOS(hashObj, blob, origins = ['*']) {
    const cos = getCOS();
    if (!cos) {
        console.warn('[COS] Cannot write: storage not available');
        return false;
    }

    console.log(`[COS] Writing ${(blob.size / 1024 / 1024).toFixed(1)} MB...`);
    console.log(`[COS] Hash: ${hashObj.value.substring(0, 16)}...`);

    try {
        // Delete existing file first (clean slate)
        await deleteFromCOS(hashObj);

        // Request write handle — singular form per WICG deprecation
        // (see https://github.com/WICG/cross-origin-storage/issues/61).
        console.log('[COS] Requesting write handle...');
        const handle = await cos.requestFileHandle(
            hashObj,
            { create: true, origins }
        );

        if (!handle) {
            console.warn('[COS] No handle returned');
            return false;
        }

        // Write the blob - hash is verified automatically
        console.log('[COS] Writing data...');
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();

        console.log('[COS] ✅ Write completed (hash verified by browser)');
        return true;

    } catch (err) {
        console.error('[COS] Write failed:', err.message);

        // Clean up on error
        try {
            await deleteFromCOS(hashObj);
        } catch (cleanupErr) {
            // Ignore cleanup errors
        }

        return false;
    }
}

// ─── Read Operations ──────────────────────────────────────────────────

/**
 * Read a file from Cross-Origin Storage.
 * Note: This may trigger a permission prompt (requires transient activation).
 * 
 * @param {HashObject} hashObj - Hash object
 * @returns {Promise<Blob|null>} - File data or null if not found
 */
export async function readFromCOS(hashObj) {
    const cos = getCOS();
    if (!cos) {
        console.warn('[COS] Cannot read: storage not available');
        return null;
    }

    console.log(`[COS] Reading hash: ${hashObj.value.substring(0, 16)}...`);

    try {
        // Request read handle — singular form per WICG deprecation
        // (see https://github.com/WICG/cross-origin-storage/issues/61).
        // This may trigger a permission prompt when reading cross-origin.
        console.log('[COS] Requesting read handle (may prompt user)...');
        const handle = await cos.requestFileHandle(hashObj);

        if (!handle) {
            console.log('[COS] No handle returned (file not found or denied)');
            return null;
        }

        // getFile() works on read handles
        console.log('[COS] Reading file...');
        const file = await handle.getFile();

        if (!file) {
            console.log('[COS] getFile() returned null');
            return null;
        }

        console.log(`[COS] ✅ Read successful: ${file.size} bytes`);
        return file;

    } catch (err) {
        // NotFoundError means file doesn't exist
        if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
            console.log('[COS] File not found');
            return null;
        }

        // NotAllowedError means user denied permission
        if (err.name === 'NotAllowedError') {
            console.warn('[COS] Permission denied by user');
            return null;
        }

        console.error('[COS] Read failed:', err.message);
        return null;
    }
}

// ─── Delete Operations ────────────────────────────────────────────────

/**
 * Delete a file from Cross-Origin Storage.
 * Uses the non-standard __non_standard__deleteResource method.
 * 
 * @param {HashObject} hashObj - Hash object
 * @returns {Promise<boolean>} - true if deletion successful
 */
export async function deleteFromCOS(hashObj) {
    const cos = getCOS();
    if (!cos) return false;

    console.log(`[COS] Deleting: ${hashObj.value.substring(0, 16)}...`);

    try {
        // Try non-standard delete method
        if (typeof cos.__non_standard__deleteResource === 'function') {
            await cos.__non_standard__deleteResource(hashObj);
            console.log('[COS] ✅ Deleted successfully');
            return true;
        }

        // Fallback: try to overwrite with empty data
        console.log('[COS] Delete method not available, trying overwrite...');
        const [handle] = await cos.requestFileHandles(
            [hashObj],
            { create: true, origins: ['*'] }
        );

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
        // If file doesn't exist, that's fine
        if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
            console.log('[COS] File not found (nothing to delete)');
            return true;
        }

        console.error('[COS] Delete failed:', err.message);
        return false;
    }
}

// ─── List Operations ──────────────────────────────────────────────────

/**
 * List all files in Cross-Origin Storage.
 * Note: This may trigger a permission prompt.
 * 
 * @returns {Promise<Array>} - Array of file entries
 */
export async function listCOSFiles() {
    const cos = getCOS();
    if (!cos) {
        console.warn('[COS] Cannot list: storage not available');
        return [];
    }

    try {
        // Check if listFiles exists (may not be in all implementations)
        if (typeof cos.listFiles === 'function') {
            const files = await cos.listFiles();
            console.log(`[COS] Found ${files.length} files`);
            return files;
        }

        console.log('[COS] listFiles not available');
        return [];
    } catch (err) {
        console.warn('[COS] List failed:', err.message);
        return [];
    }
}

// ─── Utility ────────────────────────────────────────────────────────────

/**
 * Check if a file exists in COS without reading it.
 * @param {HashObject} hashObj - Hash object
 * @returns {Promise<boolean>}
 */
export async function existsInCOS(hashObj) {
    try {
        const [handle] = await getCOS().requestFileHandles([hashObj]);
        return !!handle;
    } catch (err) {
        if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
            return false;
        }
        // Other errors (like permission denied) - assume exists but inaccessible
        console.warn('[COS] exists check failed:', err.message);
        return null;
    }
}