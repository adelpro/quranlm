/**
 * Step tracker for the loading overlay. Owns its own timers (used to fade
 * the overlay out); step state itself lives in `loadingStepsAtom`.
 */

import { useCallback } from 'react';
import { useSetAtom, useAtom } from 'jotai';
import { appStore } from '../../app/store';
import {
  loadingStepsAtom,
  loadingOverlayVisibleAtom,
  type LoadingStep,
} from './loading.atoms';

export function useStepTracker() {
  const [steps, setSteps] = useAtom(loadingStepsAtom);
  const setVisible = useSetAtom(loadingOverlayVisibleAtom);

  const resetSteps = useCallback(() => {
    setSteps((prev) => prev.map((s) => ({ ...s, phase: 'pending', detail: undefined, elapsedMs: undefined })));
    setVisible(true);
  }, [setSteps, setVisible]);

  const updateStep = useCallback(
    (id: LoadingStep['id'], patch: Partial<LoadingStep>) => {
      setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [setSteps],
  );

  const start = useCallback((id: LoadingStep['id'], detail?: string) => {
    updateStep(id, { phase: 'active', detail, elapsedMs: 0 });
  }, [updateStep]);

  const complete = useCallback(
    (id: LoadingStep['id'], detail?: string) => {
      updateStep(id, { phase: 'complete', detail });
    },
    [updateStep],
  );

  const fail = useCallback(
    (id: LoadingStep['id'], detail: string) => {
      updateStep(id, { phase: 'error', detail });
    },
    [updateStep],
  );

  const hideAfter = useCallback(
    (delayMs = 600) => {
      setTimeout(() => setVisible(false), delayMs);
    },
    [setVisible],
  );

  return { steps, resetSteps, start, complete, fail, hideAfter };
}

// Helper for non-React call-sites (e.g., the bootstrap effect that writes
// via the explicit store).
export function trackerStore() {
  return {
    resetSteps: () =>
      appStore.set(loadingStepsAtom, (prev) =>
        prev.map((s) => ({ ...s, phase: 'pending' as const, detail: undefined, elapsedMs: undefined })),
      ),
    setStep: (id: LoadingStep['id'], patch: Partial<LoadingStep>) => {
      appStore.set(loadingStepsAtom, (prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      );
    },
    showOverlay: () => appStore.set(loadingOverlayVisibleAtom, true),
    hideOverlay: (delayMs = 0) => {
      if (delayMs <= 0) {
        appStore.set(loadingOverlayVisibleAtom, false);
        return;
      }
      setTimeout(() => appStore.set(loadingOverlayVisibleAtom, false), delayMs);
    },
  };
}