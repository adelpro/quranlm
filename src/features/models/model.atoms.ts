/**
 * Model atoms — selected model (persisted), per-model status, and download
 * progress.
 *
 * The static `MODELS` registry is NOT an atom — `ModelPicker` imports it
 * directly from `data/models.ts`.
 */

import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { isModelId, type ModelId } from '../../data/models';
import { isCrossOriginStorageAvailable } from '../../services/cross-origin-storage';

export type ModelStatus = 'unknown' | 'missing' | 'cached' | 'downloading' | 'error';

export interface DownloadProgress {
  phase: 'fetching' | 'verifying' | 'storing' | 'done' | 'error' | 'cancelled';
  modelId: ModelId;
  downloaded: number;
  total: number | null;
  /** EMA speed in bytes/sec. */
  speedBps: number;
  /** Estimated seconds remaining (undefined while computing). */
  etaS: number | undefined;
  /** Phase-specific error message. */
  error?: string;
}

/** Default if nothing persisted (or persisted value is invalid). */
const FALLBACK_MODEL_ID: ModelId = 'e2b';

function readPersistedModelId(raw: unknown): ModelId {
  if (typeof raw === 'string' && isModelId(raw)) return raw;
  return FALLBACK_MODEL_ID;
}

export const persistedModelIdRawAtom = atomWithStorage<string>(
  'litert-selected-model',
  FALLBACK_MODEL_ID,
  undefined,
  { getOnInit: true },
);

/** Validated read — consumers should use this. */
export const validatedSelectedModelIdAtom = atom(
  (get) => readPersistedModelId(get(persistedModelIdRawAtom)),
);

/**
 * Convenience: read+write the validated id without exposing the raw atom.
 * `ModelPicker` should use this.
 */
export const selectedModelIdRWAtom = atom(
  (get) => get(validatedSelectedModelIdAtom),
  (_get, set, next: ModelId) => {
    set(persistedModelIdRawAtom, next);
  },
);

/** Back-compat alias used elsewhere in the codebase. */
export const selectedModelIdAtom = validatedSelectedModelIdAtom;

export const modelStatusesAtom = atom<Record<string, ModelStatus>>({});

export const downloadProgressAtom = atom<DownloadProgress | null>(null);

export const modelOperationIdAtom = atom<number>(0);

export type StorageBackendPref = 'cache' | 'cross-origin';

export const preferredStorageAtom = atomWithStorage<StorageBackendPref>(
  'litert-storage-pref',
  isCrossOriginStorageAvailable() ? 'cross-origin' : 'cache',
  undefined,
  { getOnInit: true },
);

/** Derived: which backend will actually be used right now? */
export const effectiveStorageAtom = atom((get) => {
  const preferred = get(preferredStorageAtom);
  // Without React context for COS availability (not yet wired in Step 4),
  // we fall back to "cache" as the effective choice. Step 7's bootstrap
  // will surface COS availability through this atom by writing into a
  // sibling atom.
  return preferred;
});