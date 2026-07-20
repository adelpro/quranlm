/**
 * Chat atoms.
 *
 * Streaming design:
 *   - Incoming SDK chunks are buffered in a non-reactive ref by the
 *     `useChat` hook (see Step 8) and flushed via `requestAnimationFrame`
 *     into `activeStreamAtom` at most once per frame.
 *   - Only `StreamingMessage` subscribes to `activeStreamAtom`. `MessageList`
 *     never reads it, so static messages never re-render at token cadence.
 *   - On end/cancel: hook synchronously flushes, appends one completed
 *     assistant message to `messagesAtom`, and clears `activeStreamAtom`.
 */

import { atom } from 'jotai';
import type { ActiveStream, ChatMessage, ChatPhase, ConversationMeta } from './chat.types';

export const messagesAtom = atom<ChatMessage[]>([]);

/** Active in-flight streaming slot. See file header for the contract. */
export const activeStreamAtom = atom<ActiveStream | null>(null);

export const chatPhaseAtom = atom<ChatPhase>('idle');

export const conversationMetaAtom = atom<ConversationMeta>({});

/** Derived: is a chat generation in progress (streaming or cancelling)? */
export const chatBusyAtom = atom((get) => {
  const phase = get(chatPhaseAtom);
  return phase === 'streaming' || phase === 'cancelling';
});