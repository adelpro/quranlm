/**
 * Loading-overlay step atoms + simple UI toggles.
 */

import { atom } from 'jotai';

export type StepPhase = 'pending' | 'active' | 'complete' | 'error';

export interface LoadingStep {
  id: 'webgpu' | 'models' | 'loading' | 'ready';
  label: string;
  phase: StepPhase;
  detail?: string;
  /** Optional elapsed-ms for the active step. */
  elapsedMs?: number;
}

export const loadingStepsAtom = atom<LoadingStep[]>([
  { id: 'webgpu', label: 'Check WebGPU', phase: 'pending' },
  { id: 'models', label: 'Inspect cached models', phase: 'pending' },
  { id: 'loading', label: 'Load engine', phase: 'pending' },
  { id: 'ready', label: 'Ready', phase: 'pending' },
]);

export const loadingOverlayVisibleAtom = atom<boolean>(true);

/** Settings drawer toggle. Both Header and StatusBar can open it. */
export const settingsOpenAtom = atom<boolean>(false);