/**
 * Immutable model registry. Imported directly by `ModelPicker` and
 * `services/models.ts` — never put this in a Jotai atom (the registry
 * doesn't change at runtime).
 */

export interface ModelEntry {
  readonly id: string;
  readonly label: string;
  readonly sublabel: string;
  /** HuggingFace URL (raw `.litertlm` file). */
  readonly url: string;
  readonly filename: string;
  /** Hex SHA-256 of the `.litertlm` bytes. */
  readonly sha256: string;
  /** Exact byte count from the HF LFS pointer. */
  readonly approxSize: number;
}

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
} as const satisfies Record<string, ModelEntry>;

export type ModelId = keyof typeof MODELS;

export function listModels(): readonly ModelEntry[] {
  return Object.values(MODELS);
}

export function getModel(id: string): ModelEntry | null {
  return (MODELS as Record<string, ModelEntry | undefined>)[id] ?? null;
}

export function isModelId(value: string): value is ModelId {
  return value in MODELS;
}