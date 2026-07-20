/**
 * Chat hook. Owns:
 *   - rAF-batched streaming of `sendStream` chunks into `activeStreamAtom`
 *   - cancel mid-stream (preserves partial content, skips Quran auto-search)
 *   - first-token timing + final flush
 *   - delegation to `useQuranSearch` after stream completes
 */

import { useCallback, useEffect, useRef } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import { appStore } from '../../app/store';
import { engineRefAtom } from '../../app/engine.atoms';
import {
  activeStreamAtom,
  chatPhaseAtom,
  conversationMetaAtom,
  messagesAtom,
} from './chat.atoms';
import { toolsEnabledAtom, systemPromptTextAtom, parsedOutputSchemaAtom } from '../settings/settings.atoms';
import { selectedModelIdRWAtom } from '../models/model.atoms';
import { useQuranSearch } from '../quran/useQuranSearch';
import type { ChatMessage } from './chat.types';

function uid(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useChat() {
  const setMessages = useSetAtom(messagesAtom);
  const setActive = useSetAtom(activeStreamAtom);
  const setPhase = useSetAtom(chatPhaseAtom);
  const setMeta = useSetAtom(conversationMetaAtom);
  const toolsEnabled = useAtomValue(toolsEnabledAtom);
  const quran = useQuranSearch();

  const bufferRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  // Clear any pending rAF on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const flush = useCallback(() => {
    rafRef.current = null;
    const id = streamIdRef.current;
    if (!id) return;
    setActive({ id, content: bufferRef.current, startedAt: Date.now() });
  }, [setActive]);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const send = useCallback(
    async (userText: string) => {
      const runtime = appStore.get(engineRefAtom).current;
      if (!runtime) return;
      if (appStore.get(chatPhaseAtom) !== 'idle') return;

      cancelledRef.current = false;
      bufferRef.current = '';
      const id = uid();
      streamIdRef.current = id;

      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: userText,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      setPhase('streaming');
      setActive({ id, content: '', startedAt: Date.now() });
      setMeta({ startedAt: Date.now(), firstTokenAt: undefined });

      try {
        let firstTokenLogged = false;
        for await (const chunk of runtime.session.sendStream(userText)) {
          if (cancelledRef.current) break;
          bufferRef.current += chunk;
          if (!firstTokenLogged) {
            firstTokenLogged = true;
            setMeta((m) => ({ ...m, firstTokenAt: Date.now() }));
          }
          scheduleFlush();
        }
        // Synchronous final flush.
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        const finalContent = bufferRef.current;

        const assistantMsg: ChatMessage = {
          id,
          role: 'assistant',
          content: finalContent,
          createdAt: Date.now(),
          cancelled: cancelledRef.current,
        };
        // If we cancelled before any token landed, drop the empty bubble.
        if (!cancelledRef.current || finalContent.length > 0) {
          setMessages((prev) => [...prev, assistantMsg]);
        }
        setActive(null);
        streamIdRef.current = null;
        bufferRef.current = '';

        // Quran auto-search — only if not cancelled and tool enabled.
        if (!cancelledRef.current && toolsEnabled.quranSearch && finalContent.length > 0) {
          // Attach the assistant message to a temp var so quran can mutate it.
          void quran.processAssistantReply(assistantMsg.id, finalContent);
        }

        setMeta((m) => ({ ...m, completedAt: Date.now() }));
        setPhase(cancelledRef.current ? 'idle' : 'idle');
      } catch (err) {
        setActive(null);
        streamIdRef.current = null;
        bufferRef.current = '';
        setPhase('error');
        setMeta((m) => ({ ...m, lastError: err instanceof Error ? err.message : String(err) }));
        // Surface error inline.
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            content: `⚠ ${err instanceof Error ? err.message : String(err)}`,
            createdAt: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          },
        ]);
        setTimeout(() => setPhase('idle'), 200);
      }
    },
    [quran, scheduleFlush, setActive, setMessages, setMeta, setPhase, toolsEnabled.quranSearch],
  );

  const cancel = useCallback(() => {
    if (appStore.get(chatPhaseAtom) !== 'streaming') return;
    cancelledRef.current = true;
    setPhase('cancelling');
    const runtime = appStore.get(engineRefAtom).current;
    runtime?.session.cancel();
  }, [setPhase]);

  const resetConversation = useCallback(async () => {
    const runtime = appStore.get(engineRefAtom).current;
    if (!runtime) return;
    const v = appStore.get(parsedOutputSchemaAtom);
    const schema = v.state === 'valid' ? v.schema : null;
    const prompt = appStore.get(systemPromptTextAtom);
    try {
      await runtime.session.setConfig({ systemPrompt: prompt, outputSchema: schema });
      setMessages([]);
      setActive(null);
      setMeta({});
      setPhase('idle');
    } catch (err) {
      setPhase('error');
      setMeta((m) => ({ ...m, lastError: err instanceof Error ? err.message : String(err) }));
    }
  }, [setActive, setMessages, setMeta, setPhase]);

  // Keep a reference to modelId to make the lint happy without breaking
  // the auto-rebuild semantics; the runtime + prompt/schema atoms already
  // trigger reconfigure in useEngine.
  void selectedModelIdRWAtom;

  return { send, cancel, resetConversation };
}