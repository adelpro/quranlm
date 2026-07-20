/**
 * Quran search service. Wraps `quran-search-engine` in-process because this
 * app is a browser-only SPA — a real MCP transport would need an extra
 * sidecar bridge.
 *
 * Lifecycle:
 *   - Module-scope load promise (`ensureLoaded()`) is shared across calls.
 *   - Lazy: nothing loads until the first tool call (or until the user opts
 *     in to the tool and we pre-warm — see `features/quran/useQuranSearch.ts`).
 *   - LRU cache (50 entries) is shared across calls.
 *
 * Status changes are surfaced to React via `onStatusChange(fn)`, which the
 * Quran hook syncs into `quranStatusAtom`.
 */

import Fuse from 'fuse.js';
import {
  buildInvertedIndex,
  createArabicFuseSearch,
  loadMorphology,
  loadQuranData,
  loadWordMap,
  LRUCache,
  search,
  type AdvancedSearchOptions,
  type InvertedIndex,
  type QuranText,
  type SearchResponse,
} from 'quran-search-engine';

// ─── Tool definition ──────────────────────────────────────────────────
// JSON Schema LiteRT-LM hands to the model.

export const QURAN_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'quran_search',
    description:
      'Search the Quran for verses by Arabic text, lemma, root, or coordinate range. ' +
      'Returns the top matches with sura:aya references and the verse text. ' +
      'Examples: "الرحمن", "الله NOT الرحمن", "2:255", "1:1-7", regex "^.*الله".',
    parameters: {
      type: 'object',
      properties: {
        query:     { type: 'string',  description: 'Arabic query, range, regex, or boolean expression.' },
        lemma:     { type: 'boolean', default: true },
        root:      { type: 'boolean', default: true },
        fuzzy:     { type: 'boolean', default: false },
        isRegex:   { type: 'boolean', default: false },
        isBoolean: { type: 'boolean', default: false },
        semantic:  { type: 'boolean', default: false },
        suraId:    { type: 'integer', minimum: 1, maximum: 114 },
        limit:     { type: 'integer', default: 5, minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
} as const;

// ─── Status + observer ────────────────────────────────────────────────

export type QuranStatus = 'idle' | 'loading' | 'ready' | 'error';

export type QuranStatusListener = (status: QuranStatus, detail?: string) => void;

let _status: QuranStatus = 'idle';
let _loadPromise: Promise<QuranContext> | null = null;
let _ctx: QuranContext | null = null;
const _listeners = new Set<QuranStatusListener>();

export function getToolStatus(): QuranStatus {
  return _status;
}

export function onStatusChange(fn: QuranStatusListener): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

function _setStatus(next: QuranStatus, detail?: string): void {
  _status = next;
  for (const fn of _listeners) {
    try {
      fn(next, detail);
    } catch (err) {
      console.warn('quran-search: status listener threw', err);
    }
  }
}

// ─── Context + lazy load ──────────────────────────────────────────────

interface QuranContext {
  quranData: Map<number, QuranText>;
  morphologyMap: Map<number, import('quran-search-engine').MorphologyAya>;
  wordMap: import('quran-search-engine').WordMap;
  invertedIndex: InvertedIndex;
  fuseIndex: Fuse<QuranText>;
  cache: LRUCache<string, SearchResponse>;
}

export async function ensureLoaded(): Promise<QuranContext> {
  const existing = _ctx;
  if (existing) return existing;
  const inFlight = _loadPromise;
  if (inFlight) return inFlight;

  _setStatus('loading');
  const promise: Promise<QuranContext> = (async () => {
    // Loads run in parallel — total ~1–3s on a fast link, slower on cold cache.
    const [quranData, morphologyMap, wordMap] = await Promise.all([
      loadQuranData(),
      loadMorphology(),
      loadWordMap(),
    ]);
    const invertedIndex = buildInvertedIndex(morphologyMap, quranData);
    const fuseIndex = createArabicFuseSearch(
      Array.from(quranData.values()),
      ['standard', 'uthmani'],
    );
    const cache = new LRUCache<string, SearchResponse>(50);
    const ctx: QuranContext = {
      quranData,
      morphologyMap,
      wordMap,
      invertedIndex,
      fuseIndex,
      cache,
    };
    _ctx = ctx;
    _setStatus('ready');
    return ctx;
  })().catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    _setStatus('error', detail);
    _loadPromise = null; // allow a future call to retry
    throw err;
  });
  _loadPromise = promise;
  return promise;
}

// ─── Tool body ────────────────────────────────────────────────────────

export interface QuranSearchArgs {
  query?: string;
  lemma?: boolean;
  root?: boolean;
  fuzzy?: boolean;
  isRegex?: boolean;
  isBoolean?: boolean;
  semantic?: boolean;
  suraId?: number;
  limit?: number;
}

export interface QuranVerseHit {
  sura_id: number;
  sura_name: string;
  sura_name_en: string;
  aya_id: number;
  reference: string;
  uthmani: string;
  standard: string;
  matchType: string;
  matchScore: number;
}

export type QuranSearchResult =
  | { ok: true; query: string; total: number; counts: SearchResponse['counts']; results: QuranVerseHit[] }
  | { ok: false; error: string };

/**
 * Try one search pass; swallow errors so the multi-pass loop can continue
 * even if a single strategy throws (e.g., bad regex).
 */
function _safeSearch(
  query: string,
  ctx: QuranContext,
  opts: AdvancedSearchOptions,
  limit: number,
): SearchResponse<QuranText> {
  try {
    const response = search<QuranText>(query, ctx, opts, { page: 1, limit }, ctx.fuseIndex, ctx.cache);
    // The package returns SearchResponse<VerseInput> here because of how the
    // generic resolves at the call site — coerce to the QuranText result
    // type since that IS what `search` returns for QuranText input.
    return response as SearchResponse<QuranText>;
  } catch {
    return {
      pagination: { totalResults: 0, totalPages: 0, currentPage: 1, limit },
      counts: { simple: 0, lemma: 0, root: 0, fuzzy: 0, range: 0, semantic: 0, regex: 0, total: 0 },
      results: [],
    };
  }
}

/**
 * Run a Quran search with a multi-pass fallback. Each pass stops at the
 * first hit:
 *   1. Exact form with lemma+root matching.
 *   2. Same query with fuzzy fallback (catches small typos and
 *      'صاحب الحوت'-style phrases where the engine's AND-tokenization
 *      beats strict match).
 *   3. Strip Arabic possessive prefixes (ذو / ذا / صاحب / صاحبة / ابن /
 *      ابنة / أبو / أم) and search the bare noun. Rescues queries like
 *      'ذو النون' → 'النون' since the actual verse uses 'ذا النون'.
 *
 * If every pass returns zero, the payload still has `ok: true` with an
 * empty results array; the UI shows "No matching verses."
 */
export async function executeQuranSearch(args: QuranSearchArgs | null | undefined): Promise<QuranSearchResult> {
  const {
    query,
    lemma = true,
    root = true,
    fuzzy = false,
    isRegex = false,
    semantic = false,
    suraId,
    limit = 8,
  } = args ?? {};

  if (typeof query !== 'string' || !query.trim()) {
    return { ok: false, error: 'Missing or invalid "query" argument.' };
  }

  let ctx: QuranContext;
  try {
    ctx = await ensureLoaded();
  } catch (err) {
    return {
      ok: false,
      error: `Quran corpus failed to load: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const baseOpts: AdvancedSearchOptions = {
    lemma,
    root,
    fuzzy,
    isRegex,
    semantic,
    ...(Number.isInteger(suraId) ? { suraId } : {}),
  };

  // Pass 1: as-is
  let response = _safeSearch(query, ctx, baseOpts, limit);

  // Pass 2: enable fuzzy as a fallback (cheap, often rescues multi-word
  // phrases and minor inflection differences).
  if (response.pagination.totalResults === 0 && !fuzzy) {
    response = _safeSearch(query, ctx, { ...baseOpts, fuzzy: true }, limit);
  }

  // Pass 3: strip Arabic possessive prefixes.
  if (response.pagination.totalResults === 0) {
    const stripped = query.replace(/^(?:ذ[وا]|صاحب(?:ة)?|ابن(?:ة)?|أبو|أم|بن)\s+/u, '');
    if (stripped !== query && stripped.trim().length > 0) {
      response = _safeSearch(stripped, ctx, { ...baseOpts, fuzzy: true }, limit);
    }
  }

  return {
    ok: true,
    query,
    total: response.pagination.totalResults,
    counts: response.counts,
    results: response.results.map((v) => ({
      sura_id: v.sura_id,
      sura_name: v.sura_name,
      sura_name_en: v.sura_name_en,
      aya_id: v.aya_id,
      reference: `${v.sura_name} ${v.sura_id}:${v.aya_id}`,
      uthmani: v.uthmani,
      standard: v.standard,
      matchType: v.matchType,
      matchScore: v.matchScore,
    })),
  };
}