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
 * Re-applying the system prompt creates a new Conversation (history resets).
 */
export class ChatSession {
  /** @param {import('@litert-lm/core').Engine} engine */
  constructor(engine) {
    this.engine = engine;
    /** @type {import('@litert-lm/core').Conversation | null} */
    this.conversation = null;
    this.systemPrompt = '';
  }

  /**
   * Apply (or re-apply) a system prompt. Creates a new Conversation.
   * @param {string} prompt
   */
  async setSystemPrompt(prompt) {
    const content = (prompt ?? '').trim();
    this.systemPrompt = content;
    this.conversation = await this.engine.createConversation({
      preface: { messages: [{ role: 'system', content }] },
    });
  }

  /**
   * Stream assistant text for a user message. Yields text fragments.
   * `cancel()` on this session interrupts the stream.
   *
   * Note: `sendMessageStreaming` returns a ReadableStream<Message>, where
   * `Message.content` may be a plain string or an array of ContentPart.
   * We coalesce text out of both shapes.
   *
   * @param {string} userText
   */
  async *sendStream(userText) {
    if (!this.conversation) {
      throw new Error('ChatSession has no conversation. Call setSystemPrompt() first.');
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