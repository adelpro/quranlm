/**
 * Chat types shared across atoms, hooks, and components.
 */

import type { QuranSearchResult } from '../../services/quran-search';

export type ChatRole = 'user' | 'assistant' | 'system';

export type SourceState =
  /** No reply yet OR tool disabled — nothing to show. */
  | { status: 'idle' }
  /** Reply received; searching Quran. */
  | { status: 'loading'; terms: string[] }
  /** Reply received; search finished (zero or more hits). */
  | { status: 'ready'; entries: Array<{ term: string; result: QuranSearchResult }> }
  /** JSON extraction failed — show the raw text. */
  | { status: 'parse-error'; rawText: string }
  /** One or more terms failed. */
  | { status: 'partial-error'; entries: Array<{ term: string; result: QuranSearchResult }> };

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  content: string;
  /** When true, this is the in-progress streaming slot; cleared on completion. */
  streaming?: boolean;
  cancelled?: boolean;
  error?: string;
  sources?: SourceState;
  createdAt: number;
}

export type ChatPhase = 'idle' | 'streaming' | 'cancelling' | 'error';

export interface ConversationMeta {
  startedAt?: number;
  firstTokenAt?: number;
  completedAt?: number;
  cancelReason?: string;
  lastError?: string;
}

export interface ActiveStream {
  id: string;
  content: string;
  startedAt: number;
  firstChunkAt?: number;
}