// Quran search tool: exposes `quran-search-engine` to the LiteRT-LM model as
// a function-calling tool. The package is the same one quran-search-engine-mcp
// wraps — we use it in-process because this app is a browser-only SPA and a
// real MCP transport would require an extra sidecar bridge.
//
// Lifecycle:
//   - Module-scope load promise (`ensureLoaded()`) is shared across calls.
//   - Lazy: nothing loads until the first tool call (or until the user opts in
//     to the tool and we pre-warm — see main.js).
//   - LRU cache (50 entries) is shared across calls.

import {
  loadQuranData,
  loadMorphology,
  loadWordMap,
  buildInvertedIndex,
  createArabicFuseSearch,
  LRUCache,
  search,
} from 'quran-search-engine';

// ─── Tool definition (the JSON Schema LiteRT-LM hands to the model) ──────────

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
        limit:     { type: 'integer', default: 5,  minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

// ─── Module-scope state ──────────────────────────────────────────────────────

/** 'idle' | 'loading' | 'ready' | 'error' */
let _status = 'idle';
let _loadPromise = null;
/** @type {{ quranData: Map<number, unknown>, morphologyMap: Map<number, unknown>, wordMap: Map<string, unknown>, invertedIndex: unknown, fuseIndex: unknown, cache: LRUCache<string, unknown> } | null} */
let _ctx = null;
const _listeners = new Set();

export function getToolStatus() {
  return _status;
}

export function onStatusChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _setStatus(next, detail) {
  _status = next;
  for (const fn of _listeners) {
    try { fn(next, detail); }
    catch (err) { console.warn('quran-search-tool: status listener threw', err); }
  }
}

// ─── Lazy load + idempotency ────────────────────────────────────────────────

export async function ensureLoaded() {
  if (_ctx) return _ctx;
  if (_loadPromise) return _loadPromise;

  _setStatus('loading');
  _loadPromise = (async () => {
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
    const cache = new LRUCache(50);
    _ctx = { quranData, morphologyMap, wordMap, invertedIndex, fuseIndex, cache };
    _setStatus('ready');
    return _ctx;
  })().catch((err) => {
    const detail = err?.message ?? String(err);
    _setStatus('error', detail);
    _loadPromise = null;     // allow a future call to retry
    throw err;
  });
  return _loadPromise;
}

// ─── Tool body ──────────────────────────────────────────────────────────────

/**
 * Try one search pass; swallow errors so the multi-pass loop below can
 * continue even if any single strategy fails (e.g., bad regex).
 */
function _safeSearch(query, ctx, opts, fuseIndex, cache, limit) {
  try {
    return search(query, ctx, opts, { page: 1, limit }, fuseIndex, cache);
  } catch {
    return { pagination: { totalResults: 0 }, counts: {}, results: [] };
  }
}

/**
 * Run a Quran search with a multi-pass fallback. Returns a structured
 * payload:
 *   { ok: true,  query, total, counts, results: [...] }
 *   { ok: false, error }
 *
 * Passes (each stops at the first hit):
 *   1. Exact form with lemma+root matching.
 *   2. Same query with fuzzy fallback enabled (catches small typos and
 *      'صاحب الحوت'-style phrases where the engine's AND-tokenization
 *      beats strict match but fuzzy rescued it).
 *   3. Strip Arabic possessive prefixes (ذو / ذا / صاحب / صاحبة / ابن /
 *      ابنة / أبو / أم) and search the bare noun. This rescues queries
 *      like 'ذو النون' → 'النون' that the engine can't normalize, since
 *      the actual verse uses 'ذا النون' (different vowel, same word).
 *
 * If every pass returns zero, the payload still has `ok: true` and an
 * empty results array; the UI shows 'No matching verses.'
 */
export async function executeQuranSearch(args) {
  const {
    query,
    lemma = true,
    root = true,
    fuzzy = false,
    isRegex = false,
    isBoolean = false,
    semantic = false,
    suraId,
    limit = 8,
  } = args ?? {};
  if (typeof query !== 'string' || !query.trim()) {
    return { ok: false, error: 'Missing or invalid "query" argument.' };
  }

  let ctx;
  try {
    ctx = await ensureLoaded();
  } catch (err) {
    return { ok: false, error: `Quran corpus failed to load: ${err?.message ?? err}` };
  }

  const baseOpts = {
    lemma,
    root,
    fuzzy,
    isRegex,
    isBoolean,
    semantic,
    ...(Number.isInteger(suraId) ? { suraId } : {}),
  };

  // Pass 1: as-is
  let response = _safeSearch(query, ctx, baseOpts, ctx.fuseIndex, ctx.cache, limit);

  // Pass 2: enable fuzzy as a fallback (cheap, often rescues multi-word
  // phrases and minor inflection differences).
  if (response.pagination.totalResults === 0 && !fuzzy) {
    response = _safeSearch(
      query,
      ctx,
      { ...baseOpts, fuzzy: true },
      ctx.fuseIndex,
      ctx.cache,
      limit,
    );
  }

  // Pass 3: strip Arabic possessive prefixes and search the noun alone.
  // The engine unifies alef variants but treats ذو / ذا as distinct words;
  // removing them lets the noun match the actual verse text.
  if (response.pagination.totalResults === 0) {
    const stripped = query.replace(
      /^(?:ذ[وا]|صاحب(?:ة)?|ابن(?:ة)?|أبو|أم|بن)\s+/u,
      '',
    );
    if (stripped !== query && stripped.trim().length > 0) {
      response = _safeSearch(
        stripped,
        ctx,
        { ...baseOpts, fuzzy: true },
        ctx.fuseIndex,
        ctx.cache,
        limit,
      );
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
