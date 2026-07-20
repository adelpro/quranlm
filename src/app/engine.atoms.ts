/**
 * Engine state atoms.
 *
 * The Engine + ChatSession are huge WebGPU/WASM objects. They MUST NOT live
 * in React state (causes re-renders and may trigger React Profiler warnings
 * on multi-GB instances). Instead we hold a stable mutable handle in
 * `engineRefAtom` and only mutate its `.current` field. The observable
 * state of the engine is exposed via `engineLifecycleAtom` (a discriminated
 * union), which `useEngine` is the sole writer of.
 */

import { atom } from 'jotai';
import type { ChatSession } from '../services/chat';
import type { ModelId } from '../data/models';
import type { Engine } from '@litert-lm/core';

export interface EngineRuntime {
  engine: Engine;
  session: ChatSession;
  modelId: ModelId;
  /** Monotonic counter — bumped on every load. Stale engines are deleted. */
  loadGeneration: number;
}

export type EngineLifecycle =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'loading'; modelId: ModelId; startedAt: number }
  | { phase: 'ready'; modelId: ModelId; loadGeneration: number }
  | { phase: 'error'; modelId?: ModelId; message: string }
  | { phase: 'disposing' };

export interface WebGPUStatus {
  supported: boolean;
  reason?: string;
}

/**
 * Mutable handle — set its `.current` from hooks; do NOT set the atom itself.
 */
export const engineRefAtom = atom<{ current: EngineRuntime | null }>({ current: null });

export const engineLifecycleAtom = atom<EngineLifecycle>({ phase: 'idle' });

export const webGpuStatusAtom = atom<WebGPUStatus | null>(null);

/** Derived: is the engine ready to handle a chat message? */
export const engineReadyAtom = atom((get) => get(engineLifecycleAtom).phase === 'ready');