// Entry point. Boots the app: checks WebGPU → lists models → lets the user
// pick one (downloading if needed) → loads the engine → wires the chat UI.

import { checkWebGPUSupport, loadEngine, ChatSession } from './chat.js';
import { mountChat } from './ui.js';
import {
  MODELS,
  isCached,
  getCachedBlob,
  downloadModel,
  deleteCached,
  backendLabel,
  isCrossOriginStorageAvailable,
} from './models.js';
import { PROMPTS, DEFAULT_PROMPT_ID, listPrompts, getPrompt } from './prompts.js';

const MAX_NUM_TOKENS = 8192;

const appEl = document.getElementById('app');

const ui = mountChat(appEl, {
  onSend: (text) => { void sendMessage(text); },
  onCancel: () => session?.cancel(),
  onSystemPromptChange: (text) => { void applySystemPrompt(text); },
  onReset: () => { void resetConversation(); },
  onModelSelect: (id) => { void selectModel(id); },
  onDownload: (id) => { void downloadSelected(id); },
  onDelete: (id) => { void deleteSelected(id); },
  onPromptPreset: (id) => { void applyPromptPreset(id); },
});

/** @type {ChatSession | null} */
let session = null;
/** @type {string|null} */
let currentModelId = null;

// Populate the dropdown immediately so the UI isn't empty while WebGPU is
// being probed.
ui.setModels(Object.values(MODELS));
ui.setStorageBackend(backendLabel(), isCrossOriginStorageAvailable());
ui.setPrompts(listPrompts(), DEFAULT_PROMPT_ID);

(async function init() {
  console.log('[litert] init: start');
  try {
    const gpu = await checkWebGPUSupport();
    console.log('[litert] WebGPU:', gpu);
    if (!gpu.supported) {
      ui.setWebGPU('bad', `unsupported — ${gpu.reason}`);
      ui.setEngine('bad', 'disabled');
      // Still allow browsing models — they might work on another machine.
      for (const m of Object.values(MODELS)) {
        const cached = await isCached(m.id);
        ui.setActiveModel(m.id);
        ui.setModelStatus(cached ? 'cached' : 'available',
          cached ? 'cached (engine disabled)' : 'not downloaded');
      }
      return;
    }
    ui.setWebGPU('ok', 'supported');

    // Pick a sensible default model (prefer the cached one).
    let defaultId = Object.keys(MODELS)[0];
    for (const m of Object.values(MODELS)) {
      if (await isCached(m.id)) { defaultId = m.id; break; }
    }
    console.log('[litert] default model:', defaultId);

    for (const m of Object.values(MODELS)) {
      ui.setActiveModel(m.id);
      const cached = await isCached(m.id);
      ui.setModelStatus(cached ? 'cached' : 'available',
        cached ? 'cached · click to load' : 'not downloaded');
    }

    await selectModel(defaultId);
    console.log('[litert] init: done');
  } catch (err) {
    // Any uncaught error in the boot sequence ends up here and gets
    // surfaced in the status bar instead of vanishing into the console.
    console.error('[litert] init failed:', err);
    ui.setEngine('bad', `init failed — ${err?.message ?? err}`);
  }
})();

/**
 * Select a model: if cached, load the engine immediately; otherwise prompt
 * the user to download.
 */
async function selectModel(modelId) {
  if (!MODELS[modelId]) return;

  // Tear down any existing engine first.
  if (session) {
    await session.dispose();
    session = null;
    currentModelId = null;
    ui.clearMessages();
  }

  ui.setActiveModel(modelId);
  const cached = await isCached(modelId);
  if (!cached) {
    ui.setEngine('warn', 'pick a model & download');
    ui.setModelStatus('available', 'not downloaded — click Download');
    return;
  }

  await loadEngineFor(modelId);
}

/**
 * Stream a download into the Cache API, updating the progress bar,
 * then load the engine.
 */
async function downloadSelected(modelId) {
  ui.setModelStatus('downloading', 'starting download…');
  ui.setEngine('warn', 'downloading model…');

  try {
    const blob = await downloadModel(modelId, {
      onProgress: ({ downloaded, total }) => {
        ui.setProgress(downloaded, total);
        ui.setModelStatus('downloading',
          total ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : `${formatBytes(downloaded)}`);
      },
    });

    ui.setProgress(blob.size, blob.size);
    ui.setModelStatus('cached', `cached · ${formatBytes(blob.size)}`);

    // Pass the blob straight to the engine — don't re-fetch from storage,
    // since the Cross-Origin Storage write may have silently failed.
    await loadEngineFor(modelId, blob);
  } catch (err) {
    console.error('download failed:', err);
    ui.setModelStatus('error', err?.message ?? String(err));
    ui.setEngine('bad', `download error — ${err?.message ?? err}`);
  }
}

async function deleteSelected(modelId) {
  await deleteCached(modelId);
  if (session && currentModelId === modelId) {
    await session.dispose();
    session = null;
    currentModelId = null;
    ui.clearMessages();
    ui.setEngine('warn', 'cache cleared — pick another model');
  }
  ui.setModelStatus('available', 'not downloaded');
}

/**
 * Load the LiteRT Engine for the given (cached) model.
 * If `blobOverride` is supplied (e.g. just-downloaded bytes), use that
 * directly instead of re-fetching from storage — avoids a round-trip
 * through Cross-Origin Storage that may have failed silently on write.
 */
async function loadEngineFor(modelId, blobOverride = null) {
  const source = blobOverride ?? await getCachedBlob(modelId);
  if (!source) {
    ui.setModelStatus('available', 'not downloaded');
    return;
  }

  ui.setEngine('warn', `loading ${MODELS[modelId].label}…`);
  try {
    const engine = await loadEngine({ modelUrl: source, maxNumTokens: MAX_NUM_TOKENS });
    session = new ChatSession(engine);
    currentModelId = modelId;
    await session.setSystemPrompt(ui.getSystemPrompt());
    ui.setEngine('ok', `ready · ${MODELS[modelId].label}`);
  } catch (err) {
    console.error('engine init failed:', err);
    ui.setEngine('bad', `error — ${err?.message ?? err}`);
    session = null;
  }
}

async function applySystemPrompt(text) {
  if (!session) return;
  try {
    await session.setSystemPrompt(text);
  } catch (err) {
    console.error('setSystemPrompt failed:', err);
    ui.appendError(`System prompt change failed: ${err?.message ?? err}`);
  }
}

async function applyPromptPreset(presetId) {
  const preset = getPrompt(presetId);
  if (!preset) return;
  // Replace the textarea content and push to the engine.
  ui.loadPromptText(preset.text);
  await applySystemPrompt(preset.text);
}

async function resetConversation() {
  if (!session) return;
  try {
    await session.setSystemPrompt(ui.getSystemPrompt());
    ui.clearMessages();
  } catch (err) {
    console.error('reset failed:', err);
    ui.appendError(`Reset failed: ${err?.message ?? err}`);
  }
}

async function sendMessage(text) {
  if (!session) { ui.setBusy(false); return; }
  const assistantEl = ui.appendStreamingMessage();
  try {
    for await (const chunk of session.sendStream(text)) {
      ui.appendToMessage(assistantEl, chunk);
    }
  } catch (err) {
    console.error('sendStream failed:', err);
    ui.appendError(`Generation error: ${err?.message ?? err}`);
  } finally {
    ui.finishStreaming(assistantEl);
    ui.setBusy(false);
  }
}

window.addEventListener('pagehide', () => { session?.dispose(); });

// ─────────────────────────────────────────────────────────────────────────────
function formatBytes(n) {
  if (!Number.isFinite(n)) return '? MB';
  const mb = n / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}