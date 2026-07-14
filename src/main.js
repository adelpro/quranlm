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
  validateModel,
  backendLabel,
  isCrossOriginStorageAvailable,
} from './models.js';
import { DEFAULT_PROMPT_ID, listPrompts, getPrompt } from './prompts.js';

const MAX_NUM_TOKENS = 8192;
const STORAGE_KEY = 'litert-storage-backend';
const MODEL_KEY = 'litert-selected-model';

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

// Populate the dropdowns immediately
ui.setModels(Object.values(MODELS));
ui.setStorageAvailability({
  crossOriginAvailable: isCrossOriginStorageAvailable(),
  preferred: preferredStorage
});
ui.setPrompts(listPrompts(), DEFAULT_PROMPT_ID);

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
    if (modelStatuses[defaultId]?.valid) {
      ui.updateStep('loading', 'active', 'Loading...');
      await loadEngineFor(defaultId);
    } else {
      ui.updateStep('loading', 'error', 'Model not found');
      ui.setActiveModel(defaultId);
      ui.setEngine('warn', 'Select a model and download');
      ui.setModelStatusState('available');
      ui.setModelStatus('not downloaded — click Download');
    }

    // Step 5: Ready
    ui.updateStep('ready', 'done', 'Ready!');
    ui.setEngine('ok', 'Ready');

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

  // Tear down any existing engine first.
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

  await loadEngineFor(modelId);
}

async function downloadSelected(modelId) {
  ui.setModelStatusState('downloading');
  ui.setModelStatus('starting download…');
  ui.setEngine('warn', 'Downloading model…');

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
    const engine = await loadEngine({ modelUrl: source, maxNumTokens: MAX_NUM_TOKENS });
    session = new ChatSession(engine);
    currentModelId = modelId;

    ui.updateStep('loading', 'active', 'Setting up system prompt...');
    ui.setEngine('warn', 'Setting up system prompt…');
    ui.setModelStatus(`loading · ${label}… setting up`);
    await session.setSystemPrompt(ui.getSystemPrompt());

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

// ─── Chat functions ──────────────────────────────────────────────────────

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
  ui.setEngine('warn', 'Thinking…');
  try {
    for await (const chunk of session.sendStream(text)) {
      if (assistantEl.dataset.started !== 'true') {
        const firstToken = ((performance.now() - t0) / 1000).toFixed(1);
        ui.setEngine('ok', `First token in ${firstToken}s`);
      }
      ui.appendToMessage(assistantEl, chunk);
    }
    const total = ((performance.now() - t0) / 1000).toFixed(1);
    ui.setEngine('ok', `Reply complete · ${total}s`);
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatBytes(n) {
  if (!Number.isFinite(n)) return '? MB';
  const mb = n / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}