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
import { DEFAULT_PROMPT_ID, listPrompts, getPrompt } from './prompts.js';

const MAX_NUM_TOKENS = 8192;
const STORAGE_KEY = 'litert-storage-backend';

const appEl = document.getElementById('app');

// Load stored preference or default to cross-origin if available
function loadStoredStoragePreference() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'cache' || stored === 'cross-origin') {
    return stored;
  }
  // Default to cross-origin if available, otherwise cache
  return isCrossOriginStorageAvailable() ? 'cross-origin' : 'cache';
}

let preferredStorage = loadStoredStoragePreference();

const ui = mountChat(appEl, {
  onSend: (text) => { void sendMessage(text); },
  onCancel: () => session?.cancel(),
  onSystemPromptChange: (text) => { void applySystemPrompt(text); },
  onReset: () => { void resetConversation(); },
  onModelSelect: (id) => { void selectModel(id); },
  onDownload: (id) => { void downloadSelected(id); },
  onDelete: (id) => { void deleteSelected(id); },
  onPromptPreset: (id) => { void applyPromptPreset(id); },
  onStorageBackendChange: (id) => { setPreferredStorage(id); },
});

/** @type {ChatSession | null} */
let session = null;
/** @type {string|null} */
let currentModelId = null;

function setPreferredStorage(id) {
  if (id !== 'cache' && id !== 'cross-origin') return;
  preferredStorage = id;
  localStorage.setItem(STORAGE_KEY, id);
  console.log('[litert] storage backend:', id);
}

// Populate the dropdowns immediately so the UI isn't empty while WebGPU is
// being probed.
ui.setModels(Object.values(MODELS));
ui.setStorageAvailability({
  crossOriginAvailable: isCrossOriginStorageAvailable(),
  preferred: preferredStorage
});
ui.setPrompts(listPrompts(), DEFAULT_PROMPT_ID);

(async function init() {
  console.log('[litert] init: start');
  try {
    const gpu = await checkWebGPUSupport();
    console.log('[litert] WebGPU:', gpu);
    if (!gpu.supported) {
      ui.setWebGPU('bad', `unsupported — ${gpu.reason}`);
      ui.setEngine('bad', 'disabled');
      for (const m of Object.values(MODELS)) {
        try {
          const cached = await isCached(m.id);
          ui.setActiveModel(m.id);
          ui.setModelStatus(cached ? 'cached (engine disabled)' : 'not downloaded');
          ui.setModelStatusState(cached ? 'cached' : 'available');
        } catch (err) {
          ui.setModelStatus('error checking cache');
          ui.setModelStatusState('error');
        }
      }
      return;
    }
    ui.setWebGPU('ok', 'supported');

    // Pick a sensible default model (prefer the cached one).
    let defaultId = Object.keys(MODELS)[0];
    for (const m of Object.values(MODELS)) {
      try {
        const cached = await isCached(m.id);
        if (cached) {
          defaultId = m.id;
          break;
        }
      } catch (err) {
        console.debug(`[litert] Could not check cache for ${m.id}:`, err.message);
      }
    }
    console.log('[litert] default model:', defaultId);

    // Update UI for all models
    for (const m of Object.values(MODELS)) {
      ui.setActiveModel(m.id);
      try {
        const cached = await isCached(m.id);
        ui.setModelStatus(cached ? 'cached · click to load' : 'not downloaded');
        ui.setModelStatusState(cached ? 'cached' : 'available');
      } catch (err) {
        console.debug(`[litert] Could not check cache for ${m.id}:`, err.message);
        ui.setModelStatus('error checking cache');
        ui.setModelStatusState('error');
      }
    }

    // Try to select the default model (if cached)
    try {
      const cached = await isCached(defaultId);
      if (cached) {
        await selectModel(defaultId);
      } else {
        ui.setEngine('warn', 'pick a model & download');
        ui.setModelStatusState('available');
      }
    } catch (err) {
      console.debug(`[litert] Could not load default model:`, err.message);
      ui.setEngine('warn', 'pick a model & download');
    }

    console.log('[litert] init: done');
  } catch (err) {
    console.error('[litert] init failed:', err);
    ui.setEngine('warn', `init partially failed — ${err?.message ?? err}`);
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

  // Check if cached - with proper error handling
  let cached = false;
  try {
    cached = await isCached(modelId);
  } catch (err) {
    console.debug(`[litert] Cache check failed for ${modelId}:`, err.message);
    // Continue - maybe it's not cached yet
  }

  if (!cached) {
    ui.setEngine('warn', 'pick a model & download');
    ui.setModelStatusState('available');
    ui.setModelStatus('not downloaded — click Download');
    return;
  }

  await loadEngineFor(modelId);
}

/**
 * Stream a download into the Cache API, updating the progress bar,
 * then load the engine.
 */
async function downloadSelected(modelId) {
  ui.setModelStatusState('downloading');
  ui.setModelStatus('starting download…');
  ui.setEngine('warn', 'downloading model…');

  try {
    const blob = await downloadModel(modelId, {
      onProgress: ({ downloaded, total }) => {
        ui.setProgress(downloaded, total);
        ui.setModelStatus(
          total
            ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
            : `${formatBytes(downloaded)}`,
        );
      },
      preferredStorage,
    });

    ui.setProgress(blob.size, blob.size);
    ui.setModelStatus(`cached · ${formatBytes(blob.size)}`);
    ui.setModelStatusState('cached');

    // Pass the blob straight to the engine
    await loadEngineFor(modelId, blob);
  } catch (err) {
    console.error('download failed:', err);
    ui.setModelStatusState('error');
    ui.setModelStatus(err?.message ?? String(err));
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
  ui.setModelStatusState('available');
  ui.setModelStatus('not downloaded');
}

/**
 * Load the LiteRT Engine for the given (cached) model.
 * If `blobOverride` is supplied (e.g. just-downloaded bytes), use that
 * directly instead of re-fetching from storage.
 */
async function loadEngineFor(modelId, blobOverride = null) {
  const source = blobOverride ?? await getCachedBlob(modelId);
  if (!source) {
    ui.setModelStatusState('available');
    ui.setModelStatus('not downloaded');
    return;
  }

  // The first-time engine init can take several seconds (model parse, shader
  // compile, accelerator registration). Tick the elapsed time so the user
  // sees the page isn't frozen.
  const t0 = performance.now();
  const label = MODELS[modelId].label;
  ui.setEngine('warn', `warming up ${label}…`);
  ui.setActiveModel(modelId);
  ui.setModelStatusState('cached');
  ui.setModelStatus(`loading · ${label}…`);

  const tick = setInterval(() => {
    const s = ((performance.now() - t0) / 1000).toFixed(1);
    ui.setEngine('warn', `warming up ${label}… (${s}s)`);
    ui.setModelStatus(`loading · ${label}… (${s}s)`);
  }, 250);

  try {
    const engine = await loadEngine({ modelUrl: source, maxNumTokens: MAX_NUM_TOKENS });
    session = new ChatSession(engine);
    currentModelId = modelId;

    ui.setEngine('warn', 'injecting system prompt…');
    ui.setModelStatus(`loading · ${label}… injecting prompt`);
    await session.setSystemPrompt(ui.getSystemPrompt());

    clearInterval(tick);
    const total = ((performance.now() - t0) / 1000).toFixed(1);
    ui.setEngine('ok', `ready · ${label} · ${total}s`);
    ui.setModelStatusState('loaded');
    ui.setModelStatus(`${label} · loaded in ${total}s`);
  } catch (err) {
    clearInterval(tick);
    console.error('engine init failed:', err);
    ui.setEngine('bad', `error — ${err?.message ?? err}`);
    ui.setModelStatusState('error');
    ui.setModelStatus(err?.message ?? 'engine init failed');
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
  const t0 = performance.now();
  ui.setEngine('warn', 'thinking…');
  try {
    for await (const chunk of session.sendStream(text)) {
      if (assistantEl.dataset.started !== 'true') {
        const firstToken = ((performance.now() - t0) / 1000).toFixed(1);
        ui.setEngine('ok', `decoding · first token ${firstToken}s`);
      }
      ui.appendToMessage(assistantEl, chunk);
    }
    const total = ((performance.now() - t0) / 1000).toFixed(1);
    ui.setEngine('ok', `ready · ${MODELS[currentModelId ?? '']?.label ?? ''} · replied in ${total}s`);
  } catch (err) {
    console.error('sendStream failed:', err);
    ui.appendError(`Generation error: ${err?.message ?? err}`);
    ui.setEngine('bad', `error — ${err?.message ?? err}`);
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