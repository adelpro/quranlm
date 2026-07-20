/**
 * Engine lifecycle hook. Owns:
 *   - engineRefAtom mutations (load / dispose / cancel-stale)
 *   - engineLifecycleAtom writes
 *   - serialized teardown before model switch
 *   - 90 s load timeout (with stale-engine deletion on late resolution)
 *   - pagehide cleanup
 *   - debounced session reconfigure (350 ms)
 *
 * Invariants:
 *   - Only one `loadEngineFor` call may be in flight at a time.
 *   - Loading a different model disposes the previous engine first.
 *   - The bootstrap effect owns the INITIAL load; this hook reacts only to
 *     EXPLICIT model picker changes after that.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { appStore } from '../app/store';
import {
  engineLifecycleAtom,
  engineRefAtom,
  type EngineRuntime,
} from '../app/engine.atoms';
import { ChatSession, loadEngine, assertValidLiteRtSchema } from '../services/chat';
import { getCachedBlob } from '../services/models';
import { trackerStore } from '../features/loading/useStepTracker';
import { selectedModelIdRWAtom } from '../features/models/model.atoms';
import {
  parsedOutputSchemaAtom,
  systemPromptTextAtom,
  toolsEnabledAtom,
} from '../features/settings/settings.atoms';
import type { ModelId } from '../data/models';
import type { Schema } from '@litert-lm/core';

const LOAD_TIMEOUT_MS = 90_000;
const RECONFIGURE_DEBOUNCE_MS = 350;

export function useEngine() {
  const modelId = useAtomValue(selectedModelIdRWAtom);
  const setLifecycle = useSetAtom(engineLifecycleAtom);
  const toolsEnabled = useAtomValue(toolsEnabledAtom);

  // Monotonic counter — every load bumps it. Stale `Engine.create()` results
  // are deleted immediately.
  const generationRef = useRef(0);

  // Guards against duplicate concurrent loads (bootstrap + auto-load effect).
  const loadInFlightRef = useRef(false);

  // Keep latest values in refs so the debounced reconfigure doesn't go stale.
  const promptRef = useRef('');
  const schemaRef = useRef<Schema | null>(null);
  useEffect(() => {
    const unsub = appStore.sub(systemPromptTextAtom, () => {
      promptRef.current = appStore.get(systemPromptTextAtom);
    });
    promptRef.current = appStore.get(systemPromptTextAtom);
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = appStore.sub(parsedOutputSchemaAtom, () => {
      const v = appStore.get(parsedOutputSchemaAtom);
      schemaRef.current = v.state === 'valid' ? v.schema : null;
    });
    const v = appStore.get(parsedOutputSchemaAtom);
    schemaRef.current = v.state === 'valid' ? v.schema : null;
    return unsub;
  }, []);

  const loadEngineFor = useCallback(
    async (targetModel: ModelId): Promise<EngineRuntime | null> => {
      // ── Guard 1: don't load the same model+generation twice. ─────────
      const existing = appStore.get(engineRefAtom).current;
      if (
        existing &&
        existing.modelId === targetModel &&
        existing.loadGeneration === generationRef.current
      ) {
        return existing;
      }

      // ── Guard 2: don't run two loads concurrently. ──────────────────
      if (loadInFlightRef.current) {
        console.warn('[engine] loadEngineFor skipped — another load is in flight');
        return existing;
      }
      loadInFlightRef.current = true;

      const tracker = trackerStore();
      try {
        // ── Dispose previous engine if it's a different model. ────────
        if (existing && existing.modelId !== targetModel) {
          try {
            await existing.session.dispose();
          } catch (err) {
            console.warn('[engine] previous dispose:', err);
          }
          appStore.set(engineRefAtom, { current: null });
        }

        tracker.setStep('loading', { phase: 'active', detail: targetModel, elapsedMs: 0 });
        setLifecycle({ phase: 'loading', modelId: targetModel, startedAt: Date.now() });

        const blob = await getCachedBlob(targetModel);
        if (!blob) {
          tracker.setStep('loading', { phase: 'error', detail: 'not cached' });
          setLifecycle({
            phase: 'error',
            modelId: targetModel,
            message: 'Model not cached. Download it in Settings.',
          });
          return null;
        }

        const myGen = ++generationRef.current;
        let engine;
        try {
          const loadP = loadEngine({ modelUrl: blob });
          const timer = setTimeout(() => {
            // We can't actually cancel Engine.create, but we can ensure that
            // if it ever does resolve, the engine is deleted immediately.
            generationRef.current++;
          }, LOAD_TIMEOUT_MS);
          engine = await loadP;
          clearTimeout(timer);
        } catch (err) {
          tracker.setStep('loading', {
            phase: 'error',
            detail: err instanceof Error ? err.message : String(err),
          });
          setLifecycle({
            phase: 'error',
            modelId: targetModel,
            message: err instanceof Error ? err.message : String(err),
          });
          return null;
        }

        // Stale late resolution — a newer load (or the 90 s timeout) bumped
        // the generation. Discard this engine.
        if (myGen !== generationRef.current) {
          console.warn('[engine] stale load resolution, deleting engine', {
            myGen,
            current: generationRef.current,
          });
          try {
            await engine.delete();
          } catch {
            /* ignore */
          }
          return null;
        }

        const session = new ChatSession(engine);
        const runtime: EngineRuntime = {
          engine,
          session,
          modelId: targetModel,
          loadGeneration: myGen,
        };
        appStore.set(engineRefAtom, { current: runtime });
        tracker.setStep('loading', { phase: 'complete' });
        tracker.setStep('ready', { phase: 'active' });
        setLifecycle({ phase: 'ready', modelId: targetModel, loadGeneration: myGen });

        // Initial conversation build.
        try {
          if (schemaRef.current) assertValidLiteRtSchema(schemaRef.current);
          await session.setConfig({
            systemPrompt: promptRef.current,
            outputSchema: schemaRef.current,
          });
          tracker.setStep('ready', { phase: 'complete' });
          tracker.hideOverlay(400);
        } catch (err) {
          tracker.setStep('ready', {
            phase: 'error',
            detail: err instanceof Error ? err.message : String(err),
          });
          setLifecycle({
            phase: 'error',
            modelId: targetModel,
            message: err instanceof Error ? err.message : String(err),
          });
          try {
            await session.dispose();
          } catch (dErr) {
            console.warn('[engine] dispose after failed setConfig:', dErr);
          }
          appStore.set(engineRefAtom, { current: null });
          generationRef.current++;
          return null;
        }

        void toolsEnabled;
        return runtime;
      } finally {
        loadInFlightRef.current = false;
      }
    },
    [setLifecycle, toolsEnabled],
  );

  // Debounced session reconfigure on prompt/schema changes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = appStore.sub(systemPromptTextAtom, schedule);
    const unsub2 = appStore.sub(parsedOutputSchemaAtom, schedule);
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const runtime = appStore.get(engineRefAtom).current;
        if (!runtime) return;
        const v = appStore.get(parsedOutputSchemaAtom);
        const schema = v.state === 'valid' ? v.schema : null;
        const prompt = appStore.get(systemPromptTextAtom);
        try {
          await runtime.session.setConfig({ systemPrompt: prompt, outputSchema: schema });
        } catch (err) {
          console.warn('[engine] reconfigure:', err);
        }
      }, RECONFIGURE_DEBOUNCE_MS);
    }
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
      unsub2();
    };
  }, []);

  // pagehide cleanup — release GPU/WASM when the user navigates away.
  useEffect(() => {
    function onPageHide() {
      const runtime = appStore.get(engineRefAtom).current;
      if (!runtime) return;
      try {
        void runtime.session.dispose();
      } catch (err) {
        console.warn('[engine] pagehide dispose:', err);
      }
      appStore.set(engineRefAtom, { current: null });
      generationRef.current++;
      setLifecycle({ phase: 'idle' });
    }
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [setLifecycle]);

  // React to MODEL PICKER changes — but skip the very first render, because
  // `useAppBootstrap` owns the initial load. If both fired on mount we'd
  // double-load the engine AND race with the bootstrap's `resetSteps` call.
  const prevModelIdRef = useRef<ModelId | null>(null);
  useEffect(() => {
    if (prevModelIdRef.current === null) {
      prevModelIdRef.current = modelId;
      return;
    }
    if (prevModelIdRef.current === modelId) return;
    prevModelIdRef.current = modelId;
    void loadEngineFor(modelId);
  }, [modelId, loadEngineFor]);

  return { loadEngineFor };
}