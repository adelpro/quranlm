/**
 * Quran atoms. The Quran search singleton (`services/quran-search.ts`) is
 * the source of truth for status — the React hook in Step 10 subscribes to
 * `onStatusChange` and writes the result here.
 */

import { atom } from 'jotai';
import type { QuranStatus } from '../../services/quran-search';

export interface QuranState {
  phase: QuranStatus;
  detail?: string;
}

export const quranStatusAtom = atom<QuranState>({ phase: 'idle' });