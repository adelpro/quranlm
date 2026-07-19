// Thin wrapper around @litert-lm/core so the rest of the app
// never imports the SDK directly. This is the only file that knows
// about the LiteRT API surface.

import { Engine } from '@litert-lm/core';

const DEFAULT_MAX_TOKENS = 8192;

/**
 * Probe the browser for WebGPU support.
 * @returns {Promise<{ supported: boolean, reason?: string }>}
 */
export async function checkWebGPUSupport() {
  if (!('gpu' in navigator)) {
    return { supported: false, reason: 'navigator.gpu is not exposed in this browser.' };
  }
  try {
    // Some Chrome configurations (sandboxed GPU process, certain extensions,
    // remote-desktop sessions, etc.) leave requestAdapter() pending forever.
    // Cap it so the app can surface a real error instead of hanging silently.
    const adapter = await withTimeout(
      navigator.gpu.requestAdapter(),
      5000,
      'navigator.gpu.requestAdapter() timed out after 5s',
    );
    if (!adapter) {
      return { supported: false, reason: 'requestAdapter() returned null (no WebGPU device).' };
    }
    return { supported: true };
  } catch (err) {
    return { supported: false, reason: err?.message ?? String(err) };
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} reason
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, reason) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(reason)), ms);
    }),
  ]);
}

/**
 * Create a LiteRT Engine pointed at a model URL, Blob, or ReadableStream.
 * @param {{ modelUrl: string | Blob | ReadableStream<Uint8Array>, maxNumTokens?: number }} opts
 * @returns {Promise<import('@litert-lm/core').Engine>}
 */
export async function loadEngine({ modelUrl, maxNumTokens = DEFAULT_MAX_TOKENS }) {
  return Engine.create({
    model: modelUrl,
    mainExecutorSettings: { maxNumTokens },
  });
}

/**
 * Stateful chat session: owns one Engine + one Conversation.
 * Re-applying the config (system prompt and/or output schema) creates a
 * new Conversation (history resets). Pass `outputSchema: null` to chat in
 * free-form mode; pass a JSON-Schema object to constrain every reply to
 * that shape via a single function tool + `enableConstrainedDecoding`.
 */
export class ChatSession {
  /** @param {import('@litert-lm/core').Engine} engine */
  constructor(engine) {
    this.engine = engine;
    /** @type {import('@litert-lm/core').Conversation | null} */
    this.conversation = null;
    /** @type {string} */
    this.systemPrompt = '';
    /** @type {object | null} */
    this.outputSchema = null;
  }

  /**
   * Apply (or re-apply) the conversation config. Creates a new Conversation.
   *
   * @param {{
   *   systemPrompt?: string,
   *   outputSchema?: object | null,
   * }} opts
   */
  async setConfig({ systemPrompt, outputSchema = null } = {}) {
    if (systemPrompt !== undefined) {
      this.systemPrompt = (systemPrompt ?? '').trim();
    }
    this.outputSchema = outputSchema;
    if (outputSchema) {
      assertValidLiteRtSchema(outputSchema);
    }

    /** @type {import('@litert-lm/core').ConversationConfig} */
    const config = {
      preface: {
        messages: [{ role: 'system', content: this.systemPrompt }],
      },
    };
    if (outputSchema) {
      config.preface.tools = [{
        type: 'function',
        function: {
          name: 'respond',
          description: 'Respond with structured JSON matching the schema.',
          parameters: outputSchema,
        },
      }];
      config.enableConstrainedDecoding = true;
    }
    this.conversation = await this.engine.createConversation(config);
  }

  /**
   * Back-compat shim — old callers used `setSystemPrompt(prompt)`. Redirects
   * to `setConfig` with no schema.
   * @param {string} prompt
   */
  async setSystemPrompt(prompt) {
    return this.setConfig({ systemPrompt: prompt, outputSchema: this.outputSchema });
  }

  /**
   * Stream assistant text for a user message. Yields text fragments.
   * `cancel()` on this session interrupts the stream.
   *
   * Two modes:
   * - Free-form (no schema): streaming via `sendMessageStreaming`.
   * - Constrained (outputSchema set): non-streaming via `sendMessage`; if
   *   the model emits a tool call, yields the pretty-printed JSON of its
   *   arguments; otherwise falls back to any `reply.content` text.
   *
   * Note: `sendMessageStreaming` returns a ReadableStream<Message>, where
   * `Message.content` may be a plain string or an array of ContentPart.
   * We coalesce text out of both shapes.
   *
   * @param {string} userText
   */
  async *sendStream(userText) {
    if (!this.conversation) {
      throw new Error('ChatSession has no conversation. Call setConfig() first.');
    }

    if (this.outputSchema) {
      // Constrained mode: single non-streaming call, then yield the result.
      const reply = await this.conversation.sendMessage(userText);
      const call = reply?.tool_calls?.[0];
      const args = call?.function?.arguments;
      if (args != null) {
        const pretty = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
        if (pretty) yield pretty;
        return;
      }
      const content = reply?.content;
      if (typeof content === 'string' && content) yield content;
      else if (Array.isArray(content)) {
        for (const item of content) {
          if (item?.type === 'text' && typeof item.text === 'string' && item.text) {
            yield item.text;
          }
        }
      }
      return;
    }

    const stream = this.conversation.sendMessageStreaming(userText);
    const reader = stream.getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const content = value?.content;
        if (typeof content === 'string') {
          if (content) yield content;
        } else if (Array.isArray(content)) {
          for (const item of content) {
            if (item?.type === 'text' && typeof item.text === 'string' && item.text) {
              yield item.text;
            }
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }

  /** Request cancellation of the in-flight generation, if any. */
  cancel() {
    try {
      this.conversation?.cancel();
    } catch (err) {
      // Best-effort: cancel may throw if no generation is running.
      console.warn('ChatSession.cancel:', err);
    }
  }

  /** Free GPU/WASM resources. Safe to call multiple times. */
  async dispose() {
    const engine = this.engine;
    this.engine = null;
    this.conversation = null;
    if (!engine) return;
    try {
      await engine.delete();
    } catch (err) {
      console.warn('ChatSession.dispose:', err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExtractorSession — constrained-decoding wrapper for structured output.
//
// One conversation = one schema. Calling setSchema() builds a fresh
// Conversation whose preface declares a single function-calling tool whose
// `parameters` IS the user's JSON Schema, with `enableConstrainedDecoding`
// turned on. Under the hood the runtime filters every sampled token against
// the grammar derived from the schema, so the model's final
// `tool_calls[0].function.arguments` is JSON valid by construction.
//
// API surface vs. the (non-existent) LiteRTLmSession.create({decodingConstraint}):
// we use what `@litert-lm/core@0.14.0` actually exposes — see
// node_modules/@litert-lm/core/dist/conversation_config.d.ts. The C++ core
// offers the same path via `OptionalArgs.decoding_constraint = kJsonSchema`.
// ─────────────────────────────────────────────────────────────────────────────

const LITER_T_SCHEMA_TYPES = new Set([
  'object', 'array', 'string', 'number', 'integer', 'boolean', 'null',
]);

/**
 * Throw early if the schema has features LiteRT-LM doesn't support, so users
 * see a clear message at click-time instead of a decode-time confusion.
 * @param {unknown} schema
 */
export function assertValidLiteRtSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Schema must be a JSON object.');
  }
  const s = /** @type {{ type?: string, properties?: object, required?: unknown, items?: unknown }} */ (schema);
  // LiteRT-LM's constrained decoder (gemma_model_constraint_provider) only
  // accepts schemas rooted at `type: "object"`. Reject anything else up-front
  // so the user sees a clear message at edit-time instead of a
  // `Failed to create constraint with tools` decode-time crash.
  if (s.type === undefined) {
    throw new Error('Schema must declare root "type" (LiteRT-LM requires type: "object").');
  }
  if (!LITER_T_SCHEMA_TYPES.has(s.type)) {
    throw new Error(
      `Unsupported schema type "${s.type}". LiteRT-LM supports: ${[...LITER_T_SCHEMA_TYPES].join(', ')}.`
    );
  }
  if (s.type !== 'object') {
    throw new Error(
      `LiteRT-LM constrained decoding requires root "type": "object" (got "${s.type}").`
    );
  }
  if (s.properties && (typeof s.properties !== 'object' || Array.isArray(s.properties))) {
    throw new Error('"properties" must be an object.');
  }
  if (s.required !== undefined && !Array.isArray(s.required)) {
    throw new Error('"required" must be an array of strings.');
  }
  for (const k of s.required ?? []) {
    if (typeof k !== 'string') {
      throw new Error('"required" entries must be strings (property names).');
    }
  }
}

export class ExtractorSession {
  /** @param {import('@litert-lm/core').Engine} engine */
  constructor(engine) {
    this.engine = engine;
    /** @type {import('@litert-lm/core').Conversation | null} */
    this.conversation = null;
    /** @type {string} */
    this.activeSchemaName = '';
  }

  /**
   * Build (or rebuild) the conversation for one schema. Each call tears down
   * the previous conversation — different schemas need different tools.
   *
   * @param {{
   *   name?: string,
   *   description?: string,
   *   schema: object,
   *   systemPrompt?: string,
   * }} opts
   */
  async setSchema({
    name = 'extract',
    description,
    schema,
    systemPrompt = 'You are a precise data extractor. Always respond by calling the provided tool.',
  }) {
    assertValidLiteRtSchema(schema);
    const previous = this.conversation;
    this.conversation = null;
    if (previous) {
      try { await previous.delete(); } catch (err) { console.warn('ExtractorSession: previous conversation delete failed:', err); }
    }
    this.activeSchemaName = name;
    this.conversation = await this.engine.createConversation({
      preface: {
        messages: [{ role: 'system', content: systemPrompt }],
        tools: [{
          type: 'function',
          function: {
            name,
            description: description ?? `Call ${name} with structured output.`,
            parameters: schema,
          },
        }],
      },
      enableConstrainedDecoding: true,
    });
  }

  /**
   * Run extraction. Non-streaming — the constrained decoder produces a tool
   * call token-by-token against the schema grammar; by the time it finishes
   * the entire JSON is in `tool_calls[0].function.arguments`.
   *
   * @param {string} userText
   * @returns {Promise<{ ok: true, data: unknown } | { ok: false, error: string }>}
   */
  async extract(userText) {
    if (!this.conversation) {
      return { ok: false, error: 'No schema configured. Call setSchema() first.' };
    }
    if (!userText || !userText.trim()) {
      return { ok: false, error: 'Input is empty.' };
    }
    try {
      const reply = await this.conversation.sendMessage(userText);
      const call = reply?.tool_calls?.[0];
      const raw = call?.function?.arguments;
      if (!raw) {
        return { ok: false, error: 'Model produced no structured output.' };
      }
      try {
        return { ok: true, data: JSON.parse(raw) };
      } catch (parseErr) {
        // Should be unreachable under constrained decoding, but be defensive.
        return {
          ok: false,
          error: `Model returned non-parseable JSON: ${parseErr.message}\nRaw: ${raw}`,
        };
      }
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  cancel() {
    try { this.conversation?.cancel(); } catch (err) {
      console.warn('ExtractorSession.cancel:', err);
    }
  }

  async dispose() {
    const conv = this.conversation;
    this.conversation = null;
    if (!conv) return;
    try { await conv.delete(); } catch (err) {
      console.warn('ExtractorSession.dispose:', err);
    }
  }
}