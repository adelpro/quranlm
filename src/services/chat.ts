/**
 * Thin wrapper around @litert-lm/core so the rest of the app never imports
 * the SDK directly. This is the only file that knows about the LiteRT API.
 */

import {
  type ContentPart,
  type Conversation,
  type Engine,
  Engine as EngineFactory,
  type Message,
  type MessageLike,
  type Schema,
  type Tool,
} from '@litert-lm/core';

const DEFAULT_MAX_TOKENS = 8192;

export interface WebGPUSupport {
  supported: boolean;
  reason?: string;
}

/**
 * Probe the browser for WebGPU support.
 *
 * Some Chrome configurations (sandboxed GPU process, certain extensions,
 * remote-desktop sessions, etc.) leave `requestAdapter()` pending forever.
 * We cap it so the app can surface a real error instead of hanging silently.
 */
export async function checkWebGPUSupport(): Promise<WebGPUSupport> {
  if (!('gpu' in navigator)) {
    return { supported: false, reason: 'navigator.gpu is not exposed in this browser.' };
  }
  try {
    const adapter = await withTimeout(
      navigator.gpu.requestAdapter() as Promise<GPUAdapter | null>,
      5000,
      'navigator.gpu.requestAdapter() timed out after 5s',
    );
    if (!adapter) {
      return { supported: false, reason: 'requestAdapter() returned null (no WebGPU device).' };
    }
    return { supported: true };
  } catch (err) {
    return { supported: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(reason)), ms);
    }),
  ]);
}

/**
 * Create a LiteRT Engine pointed at a model URL, Blob, or ReadableStream.
 */
export async function loadEngine(opts: {
  modelUrl: string | Blob | ReadableStream<Uint8Array>;
  maxNumTokens?: number;
}): Promise<Engine> {
  return EngineFactory.create({
    model: opts.modelUrl,
    mainExecutorSettings: { maxNumTokens: opts.maxNumTokens ?? DEFAULT_MAX_TOKENS },
  });
}

// ─── Schema validation ────────────────────────────────────────────────

const LITER_T_SCHEMA_TYPES: ReadonlySet<string> = new Set([
  'object', 'array', 'string', 'number', 'integer', 'boolean', 'null',
]);

/**
 * Throw early if the schema has features LiteRT-LM doesn't support, so users
 * see a clear message at edit-time instead of a decode-time confusion.
 */
export function assertValidLiteRtSchema(schema: unknown): asserts schema is Schema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Schema must be a JSON object.');
  }
  const s = schema as { type?: unknown; properties?: unknown; required?: unknown };

  if (s.type === undefined) {
    throw new Error('Schema must declare root "type" (LiteRT-LM requires type: "object").');
  }
  if (typeof s.type !== 'string' || !LITER_T_SCHEMA_TYPES.has(s.type)) {
    throw new Error(
      `Unsupported schema type "${String(s.type)}". LiteRT-LM supports: ${[...LITER_T_SCHEMA_TYPES].join(', ')}.`,
    );
  }
  // LiteRT-LM's constrained decoder only accepts schemas rooted at `type: "object"`.
  if (s.type !== 'object') {
    throw new Error(
      `LiteRT-LM constrained decoding requires root "type": "object" (got "${String(s.type)}").`,
    );
  }
  if (s.properties !== undefined && (typeof s.properties !== 'object' || Array.isArray(s.properties))) {
    throw new Error('"properties" must be an object.');
  }
  if (s.required !== undefined && !Array.isArray(s.required)) {
    throw new Error('"required" must be an array of strings.');
  }
  for (const k of s.required as unknown[]) {
    if (typeof k !== 'string') {
      throw new Error('"required" entries must be strings (property names).');
    }
  }
}

// ─── ChatSession ──────────────────────────────────────────────────────

export interface ChatSessionConfig {
  systemPrompt?: string;
  outputSchema?: Schema | null;
}

export type StreamChunk = string;

/**
 * Stateful chat session. Two modes, picked per `setConfig` call:
 *
 *   1. Free-form (no schema) — `Conversation` with `sendMessageStreaming`.
 *      Yields text fragments as they arrive.
 *
 *   2. Constrained structured output (outputSchema set) —
 *      `Conversation` with `enableConstrainedDecoding` + a single `respond` tool.
 *      Reads `tool_calls[0].function.arguments`, pretty-prints, yields that.
 *
 * Tool-calling from the model is intentionally NOT supported — search is
 * driven entirely by the client (see `features/quran/useQuranSearch.ts`).
 * The runtime only ever sees the `respond` tool.
 */
export class ChatSession {
  private conversation: Conversation | null = null;
  private systemPrompt = '';
  private outputSchema: Schema | null = null;
  // Held so dispose() can free the GPU/WASM resources; the prior version
  // forgot to call `engine.delete()`, leaking the multi-GB engine across
  // model switches.
  private engine: Engine | null;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  /**
   * Apply (or re-apply) the conversation config. Creates a new Conversation.
   * `outputSchema: null` → chat reverts to free-form.
   */
  async setConfig(opts: ChatSessionConfig = {}): Promise<void> {
    if (opts.systemPrompt !== undefined) {
      this.systemPrompt = (opts.systemPrompt ?? '').trim();
    }
    if (opts.outputSchema) {
      assertValidLiteRtSchema(opts.outputSchema);
      this.outputSchema = opts.outputSchema;
    } else if (opts.outputSchema === null) {
      this.outputSchema = null;
    }

    await this._teardownConversation();

    if (this.outputSchema) {
      const tool: Tool = {
        type: 'function',
        function: {
          name: 'respond',
          description: 'Respond with structured JSON matching the schema.',
          parameters: this.outputSchema,
        },
      };
      this.conversation = await this.engine!.createConversation({
        preface: {
          messages: [{ role: 'system', content: this.systemPrompt }],
          tools: [tool],
        },
        enableConstrainedDecoding: true,
      });
      return;
    }

    this.conversation = await this.engine!.createConversation({
      preface: { messages: [{ role: 'system', content: this.systemPrompt }] },
    });
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
   * `sendMessageStreaming` returns a `ReadableStream<Message>` where
   * `Message.content` may be a plain string or an array of ContentPart.
   * We coalesce text out of both shapes.
   */
  async *sendStream(userText: string): AsyncGenerator<StreamChunk> {
    if (!this.conversation) {
      throw new Error('ChatSession has no conversation. Call setConfig() first.');
    }

    if (this.outputSchema) {
      yield* this._sendConstrained(userText);
      return;
    }

    yield* this._sendStreaming(userText);
  }

  private async *_sendConstrained(userText: string): AsyncGenerator<StreamChunk> {
    const reply = await this.conversation!.sendMessage(userText as MessageLike);
    const call = reply?.tool_calls?.[0];
    const args = call?.function?.arguments;
    if (args != null) {
      const pretty = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
      if (pretty) yield pretty;
      return;
    }
    yield* extractTextContent(reply);
  }

  private async *_sendStreaming(userText: string): AsyncGenerator<StreamChunk> {
    const stream = this.conversation!.sendMessageStreaming(userText as MessageLike);
    const reader = stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        yield* extractTextContent(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }
  }

  /** Request cancellation of the in-flight generation, if any. */
  cancel(): void {
    try {
      this.conversation?.cancel();
    } catch (err) {
      console.warn('ChatSession.cancel:', err);
    }
  }

  /** Free GPU/WASM resources. Safe to call multiple times. */
  async dispose(): Promise<void> {
    await this._teardownConversation();
    if (this.engine) {
      try {
        await this.engine.delete();
      } catch (err) {
        console.warn('ChatSession: engine.delete() failed:', err);
      }
      this.engine = null;
    }
  }

  private async _teardownConversation(): Promise<void> {
    const conv = this.conversation;
    this.conversation = null;
    if (!conv) return;
    try {
      await conv.delete();
    } catch (err) {
      console.warn('ChatSession teardown:', err);
    }
  }
}

function* extractTextContent(message: Message | undefined): Generator<StreamChunk> {
  if (!message) return;
  const content = message.content;
  if (typeof content === 'string') {
    if (content) yield content;
    return;
  }
  if (Array.isArray(content)) {
    for (const part of content as ContentPart[]) {
      if (isTextPart(part) && part.text) yield part.text;
    }
  }
}

function isTextPart(part: ContentPart): part is Extract<ContentPart, { type: 'text' }> {
  return part.type === 'text';
}