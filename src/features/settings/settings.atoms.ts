/**
 * Settings atoms — system prompt, output-format schema, tool toggles.
 *
 * Persisted in localStorage under the same keys the vanilla app used, so
 * existing users keep their preferences.
 */

import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { DEFAULT_PROMPT_ID, type PromptEntry } from '../../data/prompts';
import { DEFAULT_OUTPUT_FORMAT, type LiteRtSchemaNode } from '../../data/output-format';
import type { Schema } from '@litert-lm/core';

const PROMPT_ID_KEY = 'litert-prompt-id';
const PROMPT_TEXT_KEY = 'litert-prompt-text-v1';
const OUTPUT_FORMAT_KEY = 'litert-output-format-v1';
const TOOLS_KEY = 'litert-tools-enabled';

export interface ToolsEnabled {
  quranSearch: boolean;
}

export const systemPromptIdAtom = atomWithStorage<PromptEntry['id']>(
  PROMPT_ID_KEY,
  DEFAULT_PROMPT_ID,
  undefined,
  { getOnInit: true },
);

export const systemPromptTextAtom = atomWithStorage<string>(
  PROMPT_TEXT_KEY,
  '',
  undefined,
  { getOnInit: true },
);

export const outputFormatJsonAtom = atomWithStorage<string>(
  OUTPUT_FORMAT_KEY,
  DEFAULT_OUTPUT_FORMAT,
  undefined,
  { getOnInit: true },
);

export const toolsEnabledAtom = atomWithStorage<ToolsEnabled>(
  TOOLS_KEY,
  { quranSearch: true },
  undefined,
  { getOnInit: true },
);

// ─── Output schema validation (derived) ───────────────────────────────

export type SchemaState =
  | { state: 'off'; schema: null }
  | { state: 'valid'; schema: Schema }
  | { state: 'invalid'; schema: null; message: string };

const VALID_TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array']);

function validateSchemaNode(node: unknown, path: string): string | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return `${path}: must be a JSON object.`;
  }
  const n = node as Record<string, unknown>;
  if (n.type !== undefined && (typeof n.type !== 'string' || !VALID_TYPES.has(n.type))) {
    return `${path}: invalid type "${String(n.type)}".`;
  }
  if (n.properties !== undefined) {
    if (!n.properties || typeof n.properties !== 'object' || Array.isArray(n.properties)) {
      return `${path}.properties: must be an object.`;
    }
    for (const [k, v] of Object.entries(n.properties as Record<string, unknown>)) {
      const inner = validateSchemaNode(v, `${path}.properties.${k}`);
      if (inner) return inner;
    }
  }
  if (n.items !== undefined) {
    const inner = validateSchemaNode(n.items, `${path}.items`);
    if (inner) return inner;
  }
  if (n.required !== undefined && !Array.isArray(n.required)) {
    return `${path}.required: must be an array of strings.`;
  }
  if (Array.isArray(n.required)) {
    for (const k of n.required) {
      if (typeof k !== 'string') {
        return `${path}.required[]: every entry must be a string.`;
      }
    }
  }
  return null;
}

/**
 * Parsed + validated output schema. `valid` means JSON.parse succeeded AND
 * the LiteRT-LM subset check passed. The Settings panel renders the message
 * when `invalid`; the engine hook only consumes `valid`.
 */
export const parsedOutputSchemaAtom = atom<SchemaState>((get) => {
  const raw = get(outputFormatJsonAtom).trim();
  if (!raw) return { state: 'off', schema: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      state: 'invalid',
      schema: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (path(parsed) !== 'object') {
    return { state: 'invalid', schema: null, message: 'Root must be a JSON object.' };
  }

  // LiteRT-LM requires root.type === 'object'.
  const root = parsed as Record<string, unknown>;
  if (root.type !== 'object') {
    return {
      state: 'invalid',
      schema: null,
      message: 'LiteRT-LM requires root "type": "object".',
    };
  }

  const err = validateSchemaNode(parsed, '$');
  if (err) return { state: 'invalid', schema: null, message: err };

  return { state: 'valid', schema: parsed as Schema };
});

function path(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// Re-export so consumers don't reach into data/.
export { PROMPTS } from '../../data/prompts';
export type { LiteRtSchemaNode };