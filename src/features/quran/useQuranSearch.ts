/**
 * Quran search hook.
 *   - Subscribes to the service's `onStatusChange` observer and writes
 *     into `quranStatusAtom`.
 *   - After a structured assistant reply, runs `executeQuranSearch` on
 *     every term in parallel and attaches the results to that message.
 */

import { useCallback, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { appStore } from '../../app/store';
import { quranStatusAtom } from './quran.atoms';
import { messagesAtom } from '../chat/chat.atoms';
import {
  ensureLoaded,
  executeQuranSearch,
  getToolStatus,
  onStatusChange,
} from '../../services/quran-search';
import { extractQuranicReply, type QuranicReply } from '../../lib/extract-json';
import { selectedModelIdRWAtom } from '../models/model.atoms';

export function useQuranSearch() {
  const setQuran = useSetAtom(quranStatusAtom);
  const messages = useAtomValue(messagesAtom);
  void messages; // keep import live; we read via store in callbacks

  useEffect(() => {
    // Seed initial status.
    setQuran({ phase: getToolStatus() });
    const off = onStatusChange((phase, detail) => {
      setQuran({ phase, detail });
    });
    return off;
  }, [setQuran]);

  const processAssistantReply = useCallback(
    async (messageId: string, text: string) => {
      const parsed: QuranicReply | null = extractQuranicReply(text);

      // Attach "loading" placeholder immediately.
      appStore.set(messagesAtom, (prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                sources: parsed
                  ? { status: 'loading', terms: parsed.related_words.map((w) => w.term) }
                  : { status: 'parse-error', rawText: text },
              }
            : m,
        ),
      );

      if (!parsed) return;

      // Idempotent prewarm.
      void ensureLoaded();

      const results = await Promise.all(
        parsed.related_words.map(async (w) => {
          try {
            const result = await executeQuranSearch({ query: w.term, limit: 8 });
            return { term: w.term, result };
          } catch (err) {
            return {
              term: w.term,
              result: { ok: false as const, error: err instanceof Error ? err.message : String(err) },
            };
          }
        }),
      );

      // Verify the message still exists (user may have reset or switched model).
      const stillExists = appStore.get(messagesAtom).some((m) => m.id === messageId);
      if (!stillExists) return;

      const anyError = results.some((r) => !r.result.ok);
      appStore.set(messagesAtom, (prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                sources: {
                  status: anyError ? 'partial-error' : 'ready',
                  entries: results,
                },
              }
            : m,
        ),
      );
    },
    [],
  );

  // Auto-prewarm when the Quran toggle flips on.
  void useAtomValue(selectedModelIdRWAtom);

  return { processAssistantReply };
}