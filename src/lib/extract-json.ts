/**
 * Pull a JSON value out of an assistant reply. Handles three shapes:
 *   1. Pure JSON (constrained-decoded path) — `JSON.parse(text)` succeeds.
 *   2. Markdown-fenced JSON — model emits ```json\n{...}\n``` even when the
 *      schema asks for plain JSON; we strip the fence first.
 *   3. Prose with a leading JSON block — extract the first {...} or [...]
 *      span, respecting nested brackets and quoted strings.
 *
 * Returns the parsed value, or `null` when extraction fails. Pure — safe
 * to unit-test.
 */
export function extractJsonFromReply(text: string | null | undefined): unknown {
  if (!text) return null;

  // Strip a leading Markdown ```json...``` or ```...``` fence (with or without
  // a language tag). Non-greedy so we don't eat more than one fence.
  const fenced = text.match(/```(?:[a-zA-Z][\w-]*\s*)?\n?([\s\S]*?)\n?```/);
  if (fenced && fenced[1] !== undefined) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through to plain-parse */
    }
  }

  // Look for the first balanced {...} or [...] span.
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const candidates = [firstBrace, firstBracket].filter((i) => i >= 0);
  if (candidates.length === 0) return null;

  // Both `indexOf` results are guaranteed >= 0 here, so Math.min is safe.
  const start = Math.min(...candidates);
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';

  // Walk from `start` to the matching close, respecting nested braces/brackets
  // and quoted strings (very small bracket-balancer — sufficient for our JSON).
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  // No balanced span found — try the whole text as a last resort.
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Narrowed JSON guard for the quranic-terms reply shape. Returns the typed
 * value or `null` if the JSON doesn't match.
 */
export interface RelatedWord {
  term: string;
  note: string;
}
export interface QuranicReply {
  context: string;
  related_words: RelatedWord[];
  note?: string;
}

function isRelatedWord(value: unknown): value is RelatedWord {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.term === 'string' && typeof obj.note === 'string';
}

export function extractQuranicReply(text: string | null | undefined): QuranicReply | null {
  const parsed = extractJsonFromReply(text);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.context !== 'string') return null;
  if (!Array.isArray(obj.related_words)) return null;
  if (!obj.related_words.every(isRelatedWord)) return null;

  return {
    context: obj.context,
    related_words: obj.related_words,
    note: typeof obj.note === 'string' ? obj.note : undefined,
  };
}