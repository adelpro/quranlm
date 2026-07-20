/**
 * App bootstrap — runs once on mount. Owns the FULL startup sequence:
 *
 *   resetSteps → webgpu (active → complete) → models (active → complete)
 *               → loadEngineFor (loading step) → ready (active → complete)
 *               → hideOverlay
 *
 * Sequential and synchronous (await each step). `useEngine`'s auto-load
 * effect skips the initial render so we don't race with the `resetSteps`
 * call below.
 */

import { useEffect } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import { appStore } from './store';
import { engineLifecycleAtom, webGpuStatusAtom } from './engine.atoms';
import { checkWebGPUSupport } from '../services/chat';
import { validateModel } from '../services/models';
import {
  modelStatusesAtom,
  selectedModelIdRWAtom,
} from '../features/models/model.atoms';
import { trackerStore } from '../features/loading/useStepTracker';
import { useEngine } from '../hooks/useEngine';

export function useAppBootstrap() {
  const setWebGpu = useSetAtom(webGpuStatusAtom);
  const setStatuses = useSetAtom(modelStatusesAtom);
  const modelId = useAtomValue(selectedModelIdRWAtom);
  const { loadEngineFor } = useEngine();

  useEffect(() => {
    let cancelled = false;
    const tracker = trackerStore();

    async function run() {
      // Reset all steps to pending before we start so the user sees them
      // animate from the beginning on every cold start.
      tracker.resetSteps();
      tracker.showOverlay();

      // ── Step 1: WebGPU ─────────────────────────────────────────────
      tracker.setStep('webgpu', { phase: 'active', detail: 'probing' });
      const gpu = await checkWebGPUSupport();
      if (cancelled) return;
      setWebGpu(gpu);
      if (!gpu.supported) {
        const detail = gpu.reason ?? 'unsupported';
        tracker.setStep('webgpu', { phase: 'error', detail });
        appStore.set(engineLifecycleAtom, { phase: 'error', message: detail });
        return;
      }
      tracker.setStep('webgpu', { phase: 'complete', detail: 'supported' });

      // ── Step 2: Models ──────────────────────────────────────────────
      tracker.setStep('models', { phase: 'active', detail: 'scanning storage' });
      const results = await Promise.all(
        (['e2b', 'e4b'] as const).map(async (id) => {
          try {
            const v = await validateModel(id);
            return {
              id,
              status: v.exists && v.valid ? ('cached' as const) : ('missing' as const),
            };
          } catch {
            return { id, status: 'error' as const };
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, 'cached' | 'missing' | 'error'> = {};
      for (const r of results) next[r.id] = r.status;
      setStatuses((prev) => ({ ...prev, ...next }));
      const cachedCount = Object.values(next).filter((v) => v === 'cached').length;
      tracker.setStep('models', {
        phase: 'complete',
        detail: `${cachedCount} cached`,
      });

      // ── Step 3: Load engine ─────────────────────────────────────────
      if (next[modelId] !== 'cached') {
        tracker.setStep('loading', {
          phase: 'error',
          detail: `${modelId} not cached — open Settings`,
        });
        tracker.setStep('ready', { phase: 'pending' });
        appStore.set(engineLifecycleAtom, {
          phase: 'error',
          modelId,
          message: `${modelId} is not cached yet. Open Settings to download.`,
        });
        tracker.hideOverlay(1500);
        return;
      }

      // Hand off to useEngine — it manages the 'loading' + 'ready' steps
      // (set to active here, complete there). It hides the overlay on
      // success or surfaces an error step on failure.
      const runtime = await loadEngineFor(modelId);
      if (cancelled) return;

      // If the load returned null (failure), keep the overlay visible with
      // the error step so the user can see what went wrong.
      if (!runtime) {
        console.warn('[bootstrap] loadEngineFor returned null for', modelId);
        return;
      }

      console.log('[bootstrap] engine ready', {
        modelId: runtime.modelId,
        gen: runtime.loadGeneration,
      });
    }

    void run();

    // Bridge the download hook's `litert:load-model` event to model switching.
    async function onLoadEvent(e: Event) {
      const detail = (e as CustomEvent<{ modelId: string }>).detail;
      if (!detail) return;
      appStore.set(selectedModelIdRWAtom, detail.modelId as typeof modelId);
    }
    window.addEventListener('litert:load-model', onLoadEvent);

    return () => {
      cancelled = true;
      window.removeEventListener('litert:load-model', onLoadEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}