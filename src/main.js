// Entry point. Boots the app: checks WebGPU → lists models → lets the user
// pick one (downloading if needed) → loads the engine → wires the chat UI.

import {
  checkWebGPUSupport,
  loadEngine,
  ChatSession,
  assertValidLiteRtSchema,
} from './chat.js';
import { mountChat } from './ui.js';
import { formatBytes } from './utils/format.js';
import {
  MODELS,
  isCached,
  getCachedBlob,
  downloadModel,
  deleteCached,
  validateModel,
  backendLabel,
  isCrossOriginStorageAvailable,
} from './models.js';
import { DEFAULT_PROMPT_ID, listPrompts, getPrompt } from './prompts.js';
import { DEFAULT_OUTPUT_FORMAT } from './output-format.js';
import {
  executeQuranSearch,
  ensureLoaded as ensureQuranLoaded,
  onStatusChange as onQuranSearchStatus,
  getToolStatus as getQuranSearchStatus,
} from './quran-search-tool.js';

const MAX_NUM_TOKENS = 8192;
const STORAGE_KEY = 'litert-storage-backend';
const MODEL_KEY = 'litert-selected-model';
const TOOL_KEY = 'litert-tool-quran-search';

const appEl = document.getElementById('app');

// ─── Storage preference ──────────────────────────────────────────────────
function loadStoredStoragePreference() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'cache' || stored === 'cross-origin') {
    return stored;
  }
  return isCrossOriginStorageAvailable() ? 'cross-origin' : 'cache';
}

let preferredStorage = loadStoredStoragePreference();

// ─── Model selection persistence ────────────────────────────────────────
function getStoredModel() {
  const stored = localStorage.getItem(MODEL_KEY);
  if (stored && MODELS[stored]) {
    return stored;
  }
  return null;
}

function saveModelPreference(modelId) {
  localStorage.setItem(MODEL_KEY, modelId);
}

// ─── Tool toggle persistence ────────────────────────────────────────────
function loadToolPreferences() {
  return { quranSearch: localStorage.getItem(TOOL_KEY) !== 'false' };   // default ON
}
function saveToolPreference(name, enabled) {
  localStorage.setItem(TOOL_KEY, String(enabled));
}

/** @type {{ quranSearch: boolean }} */
let toolsEnabled = loadToolPreferences();

/** Tool toggle in Settings — controls whether the client auto-runs
 *  `executeQuranSearch` for each term extracted from a JSON reply. */
function isAutoSearchEnabled() {
  return toolsEnabled.quranSearch;
}

// ─── Mount UI ─────────────────────────────────────────────────────────────
const ui = mountChat(appEl, {
  onSend: (text) => { void sendMessage(text); },
  onCancel: () => session?.cancel(),
  onSystemPromptChange: (text) => { void applySystemPrompt(text); },
  onReset: () => { void resetConversation(); },
  onModelSelect: (id) => {
    saveModelPreference(id);
    void selectModel(id);
  },
  onDownload: (id) => { void downloadSelected(id); },
  onDelete: (id) => { void deleteSelected(id); },
  onPromptPreset: (id) => { void applyPromptPreset(id); },
  onStorageBackendChange: (id) => { setPreferredStorage(id); },
  onOutputFormatChange: (text) => { void applyOutputFormat(text); },
  onToolToggle: (name, enabled) => { void onToolToggle(name, enabled); },
});

/** @type {ChatSession | null} */
let session = null;
/** @type {string|null} */
let currentModelId = null;
/** @type {object | null} */
let outputSchema = null;

function setPreferredStorage(id) {
  if (id !== 'cache' && id !== 'cross-origin') return;
  preferredStorage = id;
  localStorage.setItem(STORAGE_KEY, id);
  console.log('[litert] storage backend:', id);
}

// Populate the dropdowns immediately
ui.setModels(Object.values(MODELS));
ui.setStorageAvailability({
  crossOriginAvailable: isCrossOriginStorageAvailable(),
  preferred: preferredStorage
});
ui.setPrompts(listPrompts(), DEFAULT_PROMPT_ID);
ui.setOutputFormat(DEFAULT_OUTPUT_FORMAT);
ui.setToolsAvailability({ quranSearch: { enabled: toolsEnabled.quranSearch } });
ui.setToolStatus('quran_search', {
  status: getQuranSearchStatus(),
  detail: '',
});
onQuranSearchStatus((status, detail) => {
  ui.setToolStatus('quran_search', { status, detail });
});
// Seed the parser + apply handler so the initial schema is honored without
// waiting for the user to type.
void applyOutputFormat(DEFAULT_OUTPUT_FORMAT);

// ─── Init ──────────────────────────────────────────────────────────────────
(async function init() {
  console.log('[litert] init: start');

  // Show loading overlay
  ui.showLoading();

  // Define steps
  const stepDefs = [
    { id: 'webgpu', label: 'WebGPU support' },
    { id: 'models', label: 'Checking models' },
    { id: 'loading', label: 'Loading model' },
    { id: 'ready', label: 'Ready' }
  ];

  ui.addSteps(stepDefs);
  ui.updateStep('webgpu', 'active');

  try {
    // Step 2: WebGPU
    const gpu = await checkWebGPUSupport();
    console.log('[litert] WebGPU:', gpu);

    if (!gpu.supported) {
      ui.updateStep('webgpu', 'error', 'Not supported');
      ui.setWebGPU('bad', 'WebGPU not available');
      ui.setEngine('bad', 'Engine disabled');
      ui.hideLoading();
      return;
    }
    ui.updateStep('webgpu', 'done', 'Supported ✓');
    ui.setWebGPU('ok', 'WebGPU ready');

    // Step 3: Models
    ui.updateStep('models', 'active', 'Checking...');

    // Get stored model preference
    let defaultId = getStoredModel() || Object.keys(MODELS)[0];
    console.log('[litert] default model:', defaultId);

    // Check ALL models with progress
    const modelStatuses = {};
    const modelIds = Object.keys(MODELS);

    for (let i = 0; i < modelIds.length; i++) {
      const id = modelIds[i];
      const label = MODELS[id].label;
      ui.updateStep('models', 'active', `${label} (${i + 1}/${modelIds.length})`);
      ui.setActiveModel(id);

      try {
        const result = await validateModel(id);
        modelStatuses[id] = result;

        if (result.valid) {
          ui.setModelStatus('cached ✓');
          ui.setModelStatusState('cached');
        } else if (result.exists && !result.valid) {
          ui.setModelStatus('corrupted ✗');
          ui.setModelStatusState('error');
        } else {
          ui.setModelStatus('not downloaded');
          ui.setModelStatusState('available');
        }
      } catch (err) {
        console.debug(`[litert] Could not check cache for ${id}:`, err.message);
        ui.setModelStatus('error');
        ui.setModelStatusState('error');
      }
    }

    ui.updateStep('models', 'done', `${modelIds.length} models checked`);

    // Step 4: Load engine
    // `engineLoaded` tracks whether the engine actually came up — only then
    // do we flip the header to green "Ready" and unlock the Send button.
    // Previously the UI was forced to 'ok' unconditionally, which made the
    // header claim Ready even when `session` was still null (see bug report).
    let engineLoaded = false;
    if (modelStatuses[defaultId]?.valid) {
      ui.updateStep('loading', 'active', 'Loading...');
      try {
        // Pass the already-verified Blob to skip a second SHA-256 pass over
        // the 1.9 GB blob in getCachedBlob().
        await loadEngineFor(defaultId, modelStatuses[defaultId].blob);
        engineLoaded = !!session;          // loadEngineFor sets session on success
      } catch (err) {
        ui.updateStep('loading', 'error', err?.message ?? 'load failed');
        ui.setEngine('warn', 'Load failed');
      }
    } else {
      ui.updateStep('loading', 'error', 'Model not found');
      ui.setActiveModel(defaultId);
      ui.setEngine('warn', 'Select a model and download');
      ui.setModelStatusState('available');
      ui.setModelStatus('not downloaded — click Download');
    }

    // Step 5: Ready — only when the engine actually came up
    if (engineLoaded) {
      ui.updateStep('ready', 'done', 'Ready!');
      ui.setEngine('ok', 'Ready');
    } else {
      ui.updateStep('ready', 'error', 'Engine not ready');
      ui.setEngine('warn', 'Engine not ready — click Download');
    }

    // Hide loading after a moment
    setTimeout(() => {
      ui.hideLoading();
    }, 1000);

    console.log('[litert] init: done');
  } catch (err) {
    console.error('[litert] init failed:', err);
    ui.updateStep('ready', 'error', err.message);
    ui.setEngine('bad', `Error: ${err.message}`);
    setTimeout(() => {
      ui.hideLoading();
    }, 3000);
  }
})();

// ─── Model selection ──────────────────────────────────────────────────────

async function selectModel(modelId) {
  if (!MODELS[modelId]) return;

  // Tear down any existing engine before swapping.
  if (session) {
    await session.dispose();
    session = null;
    currentModelId = null;
    ui.clearMessages();
  }

  ui.setActiveModel(modelId);

  // Check if cached and valid
  let result;
  try {
    result = await validateModel(modelId);
  } catch (err) {
    console.debug(`[litert] Validation failed for ${modelId}:`, err.message);
    ui.setEngine('warn', 'Check cache failed — try download');
    ui.setModelStatusState('available');
    ui.setModelStatus('error checking cache — try download');
    return;
  }

  if (!result.valid) {
    if (result.exists) {
      ui.setEngine('warn', 'Model corrupted — re-download');
      ui.setModelStatusState('error');
      ui.setModelStatus('corrupted — click Re-download');
    } else {
      ui.setEngine('warn', 'Select a model and download');
      ui.setModelStatusState('available');
      ui.setModelStatus('not downloaded — click Download');
    }
    return;
  }

  await loadEngineFor(modelId, result.blob);
}

async function downloadSelected(modelId) {
  ui.setModelStatusState('downloading');
  ui.setModelStatus('downloading…');
  ui.setEngine('warn', 'Downloading model…');

  // Speed tracking state for ETA. EMA smooths the noisy per-chunk instantaneous
  // bytes/sec, so the displayed ETA doesn't jitter on every tick.
  let lastTs = performance.now();
  let lastBytes = 0;
  let avgBytesPerSec = null; // null until we have at least one full interval
  const EMA_ALPHA = 0.3;

  try {
    const blob = await downloadModel(modelId, {
      onProgress: ({ downloaded, total }) => {
        const now = performance.now();
        const dtMs = now - lastTs;
        if (dtMs > 0 && downloaded > lastBytes) {
          const instantBps = ((downloaded - lastBytes) / dtMs) * 1000;
          avgBytesPerSec = avgBytesPerSec == null
            ? instantBps
            : EMA_ALPHA * instantBps + (1 - EMA_ALPHA) * avgBytesPerSec;
        }
        lastTs = now;
        lastBytes = downloaded;

        const etaSeconds = total && avgBytesPerSec
          ? Math.max(0, (total - downloaded) / avgBytesPerSec)
          : null;

        ui.setProgress(downloaded, total, etaSeconds);
      },
      preferredStorage,
    });

    ui.setProgress(blob.size, blob.size);
    ui.setModelStatus(`cached · ${formatBytes(blob.size)}`);
    ui.setModelStatusState('cached');

    // Save model preference
    saveModelPreference(modelId);

    // Pass the blob straight to the engine
    await loadEngineFor(modelId, blob);
  } catch (err) {
    console.error('download failed:', err);
    ui.setModelStatusState('error');
    ui.setModelStatus(err?.message ?? String(err));
    ui.setEngine('bad', `Download error — ${err?.message ?? err}`);
  }
}

async function deleteSelected(modelId) {
  await deleteCached(modelId);
  if (session && currentModelId === modelId) {
    await session.dispose();
    session = null;
    currentModelId = null;
    ui.clearMessages();
    ui.setEngine('warn', 'Cache cleared — pick another model');
  }
  ui.setModelStatusState('available');
  ui.setModelStatus('not downloaded');
  if (localStorage.getItem(MODEL_KEY) === modelId) {
    localStorage.removeItem(MODEL_KEY);
  }
}

// ─── Load Engine ──────────────────────────────────────────────────────────

async function loadEngineFor(modelId, blobOverride = null) {
  const source = blobOverride ?? await getCachedBlob(modelId);
  if (!source) {
    ui.setModelStatusState('available');
    ui.setModelStatus('not downloaded');
    return;
  }

  const t0 = performance.now();
  const label = MODELS[modelId].label;

  // Update loading step
  ui.updateStep('loading', 'active', `Loading ${label}...`);
  ui.setEngine('warn', `Loading ${label}…`);
  ui.setActiveModel(modelId);
  ui.setModelStatusState('cached');
  ui.setModelStatus(`loading · ${label}…`);

  const tick = setInterval(() => {
    const s = ((performance.now() - t0) / 1000).toFixed(1);
    const elapsed = Math.round((performance.now() - t0) / 1000);
    ui.updateStep('loading', 'active', `${label} (${elapsed}s)`);
    ui.setEngine('warn', `Loading ${label}… (${s}s)`);
    ui.setModelStatus(`loading · ${label}… (${s}s)`);
  }, 500);

  try {
    // 90s cap on Engine.create. A 1.9 GB .litertlm load on WebGPU can take
    // tens of seconds; anything beyond ~90s is either a hang (e.g. the
    // Blob's underlying stream was already consumed elsewhere) or a
    // driver-side allocation failure — both should surface as an error
    // rather than an indeterminate "Loading…" state.
    const ENGINE_TIMEOUT_MS = 90_000;
    const engine = await Promise.race([
      loadEngine({ modelUrl: source, maxNumTokens: MAX_NUM_TOKENS }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`Engine.create did not complete within ${ENGINE_TIMEOUT_MS / 1000}s`)),
        ENGINE_TIMEOUT_MS,
      )),
    ]);
    session = new ChatSession(engine);
    currentModelId = modelId;

    ui.updateStep('loading', 'active', 'Setting up system prompt...');
    ui.setEngine('warn', 'Setting up system prompt…');
    ui.setModelStatus(`loading · ${label}… setting up`);
    await session.setConfig({
      systemPrompt: ui.getSystemPrompt(),
      outputSchema,
    });

    clearInterval(tick);
    const total = ((performance.now() - t0) / 1000).toFixed(1);
    ui.updateStep('loading', 'done', `${label} loaded in ${total}s`);
    ui.setEngine('ok', `${label} loaded in ${total}s`);
    ui.setModelStatusState('loaded');
    ui.setModelStatus(`${label} · loaded in ${total}s`);
  } catch (err) {
    clearInterval(tick);
    console.error('engine init failed:', err);
    ui.updateStep('loading', 'error', err.message);
    ui.setEngine('bad', `Engine error — ${err?.message ?? err}`);
    ui.setModelStatusState('error');
    ui.setModelStatus(err?.message ?? 'engine init failed');
    session = null;
  }
}

// ─── Output format (constrained decoding) ─────────────────────────────────

/**
 * Re-parse the Output Format textarea and apply the resulting JSON-Schema
 * to the current chat session. Empty / invalid input disables constrained
 * decoding (chat reverts to free-form). Updates the status indicator.
 */
async function applyOutputFormat(text) {
  const raw = (text ?? '').trim();
  if (!raw) {
    outputSchema = null;
    ui.setOutputFormatStatus({ state: 'off', message: 'Free-form' });
    if (session) {
      try { await session.setConfig({ outputSchema: null }); }
      catch (err) { console.warn('clear schema failed:', err); }
    }
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    outputSchema = null;
    ui.setOutputFormatStatus({ state: 'invalid', message: `Invalid JSON: ${err.message}` });
    if (session) {
      try { await session.setConfig({ outputSchema: null }); }
      catch (err) { console.warn('clear schema failed:', err); }
    }
    return;
  }

  try {
    assertValidLiteRtSchema(parsed);
  } catch (err) {
    outputSchema = null;
    ui.setOutputFormatStatus({ state: 'invalid', message: `Schema rejected: ${err.message}` });
    if (session) {
      try { await session.setConfig({ outputSchema: null }); }
      catch (err) { console.warn('clear schema failed:', err); }
    }
    return;
  }

  outputSchema = parsed;
  ui.setOutputFormatStatus({ state: 'on', message: 'Structured output: ON' });
  if (session) {
    try {
      await session.setConfig({ outputSchema: parsed });
    } catch (err) {
      console.warn('apply schema failed:', err);
      ui.setOutputFormatStatus({ state: 'invalid', message: `Apply failed: ${err.message}` });
    }
  }
}

// ─── Chat functions ──────────────────────────────────────────────────────

async function applySystemPrompt(text) {
  if (!session) return;
  try {
    await session.setConfig({
      systemPrompt: text,
      outputSchema,
    });
  } catch (err) {
    console.error('setConfig failed:', err);
    ui.appendError(`System prompt change failed: ${err?.message ?? err}`);
  }
}

async function applyPromptPreset(presetId) {
  const preset = getPrompt(presetId);
  if (!preset) return;
  ui.loadPromptText(preset.text);
  await applySystemPrompt(preset.text);
}

async function resetConversation() {
  if (!session) return;
  try {
    await session.setConfig({
      systemPrompt: ui.getSystemPrompt(),
      outputSchema,
    });
    ui.clearMessages();
  } catch (err) {
    console.error('reset failed:', err);
    ui.appendError(`Reset failed: ${err?.message ?? err}`);
  }
}

/** Tool toggle handler — only flips the auto-search boolean. The model
 *  no longer sees a search tool, so the chat session doesn't need to be
 *  rebuilt. */
async function onToolToggle(name, enabled) {
  if (name !== 'quran_search') return;
  toolsEnabled.quranSearch = !!enabled;
  saveToolPreference(name, toolsEnabled.quranSearch);
}

/**
 * Pull a JSON object out of an assistant reply. Handles three shapes:
 *   1. Pure JSON (constrained-decoded path) — `JSON.parse(text)` succeeds.
 *   2. Markdown-fenced JSON — model emits ```json\n{...}\n``` even when the
 *      schema asks for plain JSON; we strip the fence first.
 *   3. Prose with a leading JSON block — extract the first {...} span.
 *
 * Returns the parsed object or `null` when extraction fails.
 */
function extractJsonFromReply(text) {
  if (!text) return null;
  // Strip a leading Markdown ```json...``` or ```...``` fence (with or without
  // a language tag). Non-greedy so we don't eat more than one fence.
  const fenced = text.match(/```(?:[a-zA-Z][\w-]*\s*)?\n?([\s\S]*?)\n?```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); }
    catch { /* fall through to plain-parse */ }
  }
  // Look for the first balanced {...} or [...] span.
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const candidates = [firstBrace, firstBracket].filter((i) => i >= 0);
  if (candidates.length === 0) return null;
  const start = Math.min(...candidates);
  // Walk from `start` to the matching close, respecting nested braces/brackets
  // and quoted strings (very small bracket-balancer — sufficient for our JSON).
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch { return null; }
      }
    }
  }
  try { return JSON.parse(text); }
  catch { return null; }
}

/**
 * After the assistant emits a JSON-shaped reply, walk its `related_words`
 * array and run `executeQuranSearch` for each term, in parallel. Renders
 * results inline below the JSON in the same bubble.
 *
 * Gated by:
 *  - the auto-search toggle (Settings)
 *  - a successfully-parsed JSON with at least one non-empty related_word
 *
 * Always renders the Sources header so the user can see whether auto-search
 * attempted to run and, if it didn't, why. The header text reflects state:
 *   "Looking up…"     — running
 *   "No related terms" — JSON parsed but `related_words` is empty/absent
 *   "Sources · N found" — verses fetched (or attempted) for N terms
 *   "JSON parse failed" — reply didn't parse, raw text echoed for inspection
 */
async function autoSearchTerms(assistantEl, text) {
  if (!assistantEl) return;

  const parsed = extractJsonFromReply(text);
  if (!parsed) {
    // Reply wasn't JSON — surface the raw text so the user sees what the model said.
    const pre = document.createElement('pre');
    pre.className = 'raw-reply-fallback';
    pre.textContent = text;
    const content = assistantEl.querySelector('.message-content');
    if (content) content.append(pre);
    console.warn('[litert] autoSearchTerms: JSON.parse failed. Raw text was:\n', text);
    return;
  }

  const terms = (Array.isArray(parsed?.related_words) ? parsed.related_words : [])
    .map((w) => String(w?.term ?? '').trim())
    .filter(Boolean);

  if (terms.length === 0) {
    // No terms to look up — still surface a tiny section so the user knows
    // the post-extraction step ran and observed an empty array.
    ui.beginSources(assistantEl, ['(no related terms)']);
    ui.renderSources(assistantEl, [{
      term: '(no related terms)',
      result: { ok: true, total: 0, results: [] },
    }]);
    return;
  }

  ui.beginSources(assistantEl, terms);
  // Kick off the corpus lazy-load idempotently — the load promise is shared.
  void ensureQuranLoaded();
  const results = await Promise.all(
    terms.map(async (term) => {
      try {
        return { term, result: await executeQuranSearch({ query: term, limit: 8 }) };
      } catch (err) {
        return { term, result: { ok: false, error: err?.message ?? String(err) } };
      }
    }),
  );
  ui.renderSources(assistantEl, results);
}

async function sendMessage(text) {
  if (!session) { ui.setBusy(false); return; }

  const assistantEl = ui.appendStreamingMessage();
  const t0 = performance.now();
  ui.setEngine('warn', 'Thinking…');
  let jsonReply = null;
  try {
    for await (const chunk of session.sendStream(text)) {
      // chat.js yields plain string fragments again (v1 shape)
      if (chunk) {
        if (assistantEl.dataset.started !== 'true') {
          const firstToken = ((performance.now() - t0) / 1000).toFixed(1);
          ui.setEngine('ok', `First token in ${firstToken}s`);
        }
        ui.appendToMessage(assistantEl, chunk);
        // Track the reply text so we can attempt auto-search post-stream.
        // (Only relevant when outputSchema is set; we still parse regardless
        // — JSON.parse returns silently on free-form prose.)
        jsonReply = (jsonReply ?? '') + chunk;
      }
    }
    const total = ((performance.now() - t0) / 1000).toFixed(1);
    ui.setEngine('ok', `Reply complete · ${total}s`);

    // Auto-search: only when the toggle is on AND the model emitted a
    // constrained JSON reply (which we can parse for related_words).
    if (isAutoSearchEnabled() && jsonReply) {
      await autoSearchTerms(assistantEl, jsonReply);
    }
  } catch (err) {
    console.error('sendStream failed:', err);
    ui.appendError(`Generation error: ${err?.message ?? err}`);
    ui.setEngine('bad', `Error — ${err?.message ?? err}`);
  } finally {
    ui.finishStreaming(assistantEl);
    ui.setBusy(false);
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────

window.addEventListener('pagehide', () => { session?.dispose(); });