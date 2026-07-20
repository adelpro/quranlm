/// <reference types="vite/client" />

// ─── Experimental Cross-Origin Storage (WICG) ───────────────────────
// Not yet natively implemented in any browser; available today via the
// Chrome extension: https://chromewebstore.google.com/detail/cross-origin-storage/...
interface CrossOriginStorageFile {
  readonly hash: string;
  readonly lastModified: number;
  readonly size: number;
}

interface CrossOriginStorageOptions {
  create?: boolean;
  origins?: string[];
}

interface CrossOriginStorage {
  // Newer (singular) form — see https://github.com/WICG/cross-origin-storage/issues/61
  requestFileHandle?(
    hash: unknown,
    options?: CrossOriginStorageOptions,
  ): Promise<FileSystemFileHandle | null>;
  // Legacy plural form, still used by some implementations.
  requestFileHandles?(
    hashes: unknown[],
    options?: CrossOriginStorageOptions,
  ): Promise<FileSystemFileHandle[]>;
  listFiles?(): Promise<CrossOriginStorageFile[]>;
}

interface Navigator {
  readonly crossOriginStorage?: CrossOriginStorage;
}

interface Window {
  crossOriginStorage?: CrossOriginStorage;
}