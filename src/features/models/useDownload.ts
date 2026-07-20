/**
 * Download hook — owns the AbortController and the EMA speed/ETA computation.
 */

import { useCallback, useRef } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import { downloadModel, type ProgressInfo } from '../../services/models';
import {
  downloadProgressAtom,
  modelOperationIdAtom,
  modelStatusesAtom,
  preferredStorageAtom,
  type DownloadProgress,
} from './model.atoms';
import { engineLifecycleAtom } from '../../app/engine.atoms';
import { appStore } from '../../app/store';
import { trackerStore } from '../loading/useStepTracker';
import type { ModelId } from '../../data/models';

const EMA_ALPHA = 0.4;
/** Minimum gap between progress readout updates, in ms. Throttles the noisy
 *  per-chunk stream so speed/ETA read as a calm ~2s window average. */
const EMIT_INTERVAL_MS = 2000;

export function useDownload() {
  const setProgress = useSetAtom(downloadProgressAtom);
  const setStatuses = useSetAtom(modelStatusesAtom);
  const opId = useAtomValue(modelOperationIdAtom);
  const pref = useAtomValue(preferredStorageAtom);
  const setLifecycle = useSetAtom(engineLifecycleAtom);
  const controllerRef = useRef<AbortController | null>(null);

  const download = useCallback(
    async (modelId: ModelId) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setStatuses((s) => ({ ...s, [modelId]: 'downloading' }));
      const initial: DownloadProgress = {
        phase: 'fetching',
        modelId,
        downloaded: 0,
        total: null,
        speedBps: 0,
        etaS: undefined,
      };
      setProgress(initial);

      let lastTick = performance.now();
      let lastDownloaded = 0;
      let emaSpeed = 0;
      let lastPhase = 'fetching';
      const myOpId = opId + 1;
      appStore.set(modelOperationIdAtom, myOpId);

      const tracker = trackerStore();
      tracker.setStep('models', { phase: 'active', detail: `downloading ${modelId}` });

      try {
        const blob = await downloadModel(modelId, {
          signal: controller.signal,
          preferredStorage: pref,
          onProgress: (p: ProgressInfo) => {
            // Ignore progress from stale operations.
            if (appStore.get(modelOperationIdAtom) !== myOpId) return;

            const phase = (p.phase as DownloadProgress['phase']) ?? 'fetching';
            const phaseChanged = phase !== lastPhase;
            const now = performance.now();
            const elapsed = now - lastTick;

            // Throttle noisy per-chunk 'fetching' updates: only emit once a full
            // window has elapsed. Phase transitions (verifying/storing/…) always
            // pass through immediately so their labels never lag or get swallowed.
            if (phase === 'fetching' && !phaseChanged && elapsed < EMIT_INTERVAL_MS) {
              return;
            }

            // Recompute speed only from real 'fetching' progress over the window.
            if (phase === 'fetching') {
              const dtSec = Math.max(0.001, elapsed / 1000);
              const dBytes = p.downloaded - lastDownloaded;
              const instant = dBytes / dtSec;
              emaSpeed = emaSpeed === 0 ? instant : EMA_ALPHA * instant + (1 - EMA_ALPHA) * emaSpeed;
              lastTick = now;
              lastDownloaded = p.downloaded;
            }
            lastPhase = phase;

            const eta =
              emaSpeed > 0 && p.total !== null && p.total > 0
                ? (p.total - p.downloaded) / emaSpeed
                : undefined;

            setProgress({
              phase,
              modelId,
              downloaded: p.downloaded,
              total: p.total,
              speedBps: emaSpeed,
              etaS: eta,
            });
          },
        });
        if (appStore.get(modelOperationIdAtom) !== myOpId) return;
        setStatuses((s) => ({ ...s, [modelId]: 'cached' }));
        tracker.setStep('models', { phase: 'complete', detail: `${modelId} cached` });
        setProgress({
          phase: 'done',
          modelId,
          downloaded: blob.size,
          total: blob.size,
          speedBps: emaSpeed,
          etaS: 0,
        });

        // Auto-load the freshly downloaded model if nothing else is loaded.
        const lifecycle = appStore.get(engineLifecycleAtom);
        if (lifecycle.phase === 'idle' || lifecycle.phase === 'error') {
          // Defer to the engine hook via custom event. (Alternative: lift
          // loadEngineFor into a context — see the engine hook's auto-load
          // effect. We keep the path simple here.)
          window.dispatchEvent(new CustomEvent('litert:load-model', { detail: { modelId } }));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setProgress({
            phase: 'cancelled',
            modelId,
            downloaded: lastDownloaded,
            total: null,
            speedBps: 0,
            etaS: undefined,
          });
          setStatuses((s) => ({ ...s, [modelId]: 'missing' }));
          return;
        }
        setProgress({
          phase: 'error',
          modelId,
          downloaded: lastDownloaded,
          total: null,
          speedBps: 0,
          etaS: undefined,
          error: err instanceof Error ? err.message : String(err),
        });
        setStatuses((s) => ({ ...s, [modelId]: 'error' }));
        setLifecycle({
          phase: 'error',
          modelId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [opId, pref, setLifecycle, setProgress, setStatuses],
  );

  const cancelDownload = useCallback(
    (_modelId: ModelId) => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  return { download, cancelDownload };
}