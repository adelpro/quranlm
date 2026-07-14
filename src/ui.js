// DOM rendering for the chat + model picker + download progress bar.
// No framework. Returns a controller object the caller uses to push updates.

/**
 * Mount the UI inside `root` and wire user actions to `handlers`.
 *
 * @param {HTMLElement} root
 * @param {{
 *   onSend: (text: string) => void,
 *   onCancel: () => void,
 *   onSystemPromptChange: (text: string) => void,
 *   onReset: () => void,
 *   onModelSelect: (modelId: string) => void,
 *   onDownload: (modelId: string) => void,
 *   onDelete: (modelId: string) => void,
 *   onPromptPreset: (presetId: string) => void,
 * }} handlers
 */
export function mountChat(root, handlers) {
  // ─── Status bar ────────────────────────────────────────────────────────
  const statusBar = el('header', { class: 'status-bar' });
  const webgpuEl = el('span', { id: 'status-webgpu', class: 'warn' }, 'WebGPU: checking…');
  const engineEl = el('span', { id: 'status-engine', class: 'warn' }, 'Engine: idle');
  const storageEl = el('span', { id: 'status-storage', class: 'muted' }, 'Storage: …');
  statusBar.append(webgpuEl, engineEl, storageEl);

  // ─── Model picker ──────────────────────────────────────────────────────
  const modelSelect = el('select', { id: 'model-select', 'aria-label': 'Choose model' });
  const modelLabel  = el('label', { for: 'model-select' }, 'Model');
  const modelStatus = el('span', { id: 'model-status', class: 'muted' }, '—');
  const downloadBtn = el('button', { type: 'button', id: 'download-btn', class: 'primary' }, 'Download');
  const deleteBtn   = el('button', { type: 'button', id: 'delete-btn',   class: 'danger' },  'Delete cache');

  const progressTrack = el('div', { class: 'progress-track', hidden: '' });
  const progressFill  = el('div', { class: 'progress-fill' });
  const progressText  = el('span', { class: 'progress-text' }, '0%');
  progressTrack.append(progressFill, progressText);

  const modelPicker = el('section', { class: 'model-picker' },
    modelLabel, modelSelect,
    el('div', { class: 'model-picker-row' }, modelStatus, deleteBtn, downloadBtn),
    progressTrack,
  );

  // ─── System prompt ─────────────────────────────────────────────────────
  const promptSelect = el('select', { id: 'prompt-select', 'aria-label': 'System prompt preset' });
  const promptLabel  = el('label', { for: 'prompt-select' }, 'Preset');

  const systemLabel = el('label', { for: 'system-prompt' }, 'System prompt');
  const systemPrompt = el('textarea', { id: 'system-prompt', rows: '6' });

  const systemSection = el('section', { class: 'system-prompt' },
    el('div', { class: 'system-prompt-row' }, promptLabel, promptSelect),
    systemLabel,
    systemPrompt,
  );

  // ─── Messages ──────────────────────────────────────────────────────────
  const messagesEl = el('main', { id: 'messages', class: 'messages', 'aria-live': 'polite' });

  // ─── Composer ──────────────────────────────────────────────────────────
  const inputEl = el('textarea', {
    id: 'input',
    rows: '2',
    placeholder: 'Type a message and press Enter…',
    'aria-label': 'Message',
  });
  const resetBtn  = el('button', { type: 'button', id: 'reset-btn',  class: 'danger',  disabled: '' }, 'Reset');
  const cancelBtn = el('button', { type: 'button', id: 'cancel-btn', disabled: '' }, 'Cancel');
  const sendBtn   = el('button', { type: 'submit', id: 'send-btn',   class: 'primary', disabled: '' }, 'Send');
  const composerEl = el('form', {
    id: 'composer',
    class: 'composer',
    autocomplete: 'off',
  }, inputEl, el('div', { class: 'composer-actions' }, resetBtn, cancelBtn, sendBtn));

  root.append(statusBar, modelPicker, systemSection, messagesEl, composerEl);

  // ─── State ─────────────────────────────────────────────────────────────
  let engineReady = false;
  /** @type {string|null} */
  let activeModelId = null;

  // ─── Helpers ───────────────────────────────────────────────────────────
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMessage({ role, content }) {
    const node = el('div', { class: `message message-${role}`, 'data-role': role });
    node.textContent = content;
    messagesEl.append(node);
    scrollToBottom();
    return node;
  }

  function appendError(message) {
    const node = el('div', { class: 'message message-error' });
    node.textContent = message;
    messagesEl.append(node);
    scrollToBottom();
    return node;
  }

  function appendStreamingMessage() {
    const node = el('div', { class: 'message message-assistant streaming', 'data-role': 'assistant' });
    messagesEl.append(node);
    scrollToBottom();
    return node;
  }

  function appendToMessage(node, chunk) {
    node.textContent += chunk;
    scrollToBottom();
  }

  function finishStreaming(node) {
    node?.classList.remove('streaming');
  }

  function setBusy(busy) {
    sendBtn.disabled     = busy || !engineReady;
    inputEl.disabled     = busy;
    cancelBtn.disabled   = !busy;
    systemPrompt.disabled = busy;
    resetBtn.disabled    = busy || !engineReady;
  }

  function showProgress(visible) {
    progressTrack.hidden = !visible;
    if (!visible) {
      progressFill.style.width = '0%';
      progressText.textContent = '0%';
    }
  }

  function setProgress(downloaded, total) {
    if (!total || total <= 0) {
      progressFill.style.width = '100%';
      progressText.textContent = formatBytes(downloaded);
      return;
    }
    const pct = Math.min(100, (downloaded / total) * 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${pct.toFixed(1)}% · ${formatBytes(downloaded)} / ${formatBytes(total)}`;
  }

  function formatBytes(n) {
    if (!Number.isFinite(n)) return '? MB';
    const mb = n / 1024 / 1024;
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
  }

  // ─── Events ────────────────────────────────────────────────────────────
  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || !engineReady) return;
    appendMessage({ role: 'user', content: text });
    inputEl.value = '';
    setBusy(true);
    handlers.onSend(text);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composerEl.requestSubmit();
    }
  });

  cancelBtn.addEventListener('click', () => handlers.onCancel());

  resetBtn.addEventListener('click', () => {
    if (!engineReady) return;
    if (!confirm('Reset conversation? This clears the message history.')) return;
    handlers.onReset();
  });

  let systemDebounce;
  systemPrompt.addEventListener('input', () => {
    clearTimeout(systemDebounce);
    systemDebounce = setTimeout(() => {
      if (engineReady) handlers.onSystemPromptChange(systemPrompt.value);
    }, 350);
  });

  modelSelect.addEventListener('change', () => {
    handlers.onModelSelect(modelSelect.value);
  });

  downloadBtn.addEventListener('click', () => {
    // Fall back to whatever the dropdown shows so the button stays usable
    // before init has finished (or if it never finishes).
    const id = activeModelId ?? modelSelect.value;
    if (!id) return;
    handlers.onDownload(id);
  });

  deleteBtn.addEventListener('click', () => {
    const id = activeModelId ?? modelSelect.value;
    if (!id) return;
    if (!confirm('Delete this cached model? You will need to re-download it.')) return;
    handlers.onDelete(id);
  });

  promptSelect.addEventListener('change', () => {
    handlers.onPromptPreset(promptSelect.value);
  });

  // ─── Public controller ─────────────────────────────────────────────────
  return {
    // Model picker
    setModels(entries) {
      modelSelect.replaceChildren();
      for (const m of entries) {
        const opt = el('option', { value: m.id }, `${m.label} — ${m.sublabel}`);
        modelSelect.append(opt);
      }
    },

    // ─── Prompts ────────────────────────────────────────────────────────
    setPrompts(entries, activeId) {
      promptSelect.replaceChildren();
      for (const p of entries) {
        const opt = el('option', { value: p.id }, p.label);
        promptSelect.append(opt);
      }
      if (activeId) {
        promptSelect.value = activeId;
        const p = entries.find((x) => x.id === activeId);
        if (p) systemPrompt.value = p.text;
      }
    },

    getActivePromptId() {
      return promptSelect.value;
    },

    /**
     * Replace the textarea with a preset's text. Caller is responsible for
     * pushing the new prompt to the engine via the regular change handler.
     */
    loadPromptText(text) {
      systemPrompt.value = text;
    },

    setActiveModel(modelId, modelLabelText) {
      activeModelId = modelId;
      if (modelSelect.value !== modelId) modelSelect.value = modelId;
      deleteBtn.hidden = false;
    },

    setModelStatus(state, label) {
      // state: 'available' | 'cached' | 'downloading' | 'error'
      modelStatus.textContent = label;
      modelStatus.className =
        state === 'cached'      ? 'ok'   :
        state === 'downloading' ? 'warn' :
        state === 'error'       ? 'bad'  :
                                   'muted';

      downloadBtn.disabled = state === 'cached' || state === 'downloading';
      deleteBtn.disabled   = state !== 'cached';
      modelSelect.disabled = state === 'downloading';
      showProgress(state === 'downloading');
    },

    setProgress,

    // Status bar
    setWebGPU(state, label) {
      webgpuEl.textContent = `WebGPU: ${label}`;
      webgpuEl.className = state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : 'warn';
    },

    setEngine(state, label) {
      engineEl.textContent = `Engine: ${label}`;
      engineEl.className  = state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : 'warn';
      engineReady = state === 'ok';
      setBusy(false);
    },

    setStorageBackend(label, isCrossOrigin) {
      storageEl.textContent = `Storage: ${label}`;
      storageEl.className = isCrossOrigin ? 'ok' : 'warn';
      storageEl.title = isCrossOrigin
        ? 'Models are stored in Cross-Origin Storage — shared across sites and hash-verified.'
        : 'Models are stored in the per-origin Cache API. Install the Cross-Origin Storage extension to enable cross-site dedup.';
    },

    // Messages — local helpers, hoisted into the mountChat closure so the
    // submit handler can call `appendMessage(...)` directly.
    appendMessage,
    appendError,
    appendStreamingMessage,
    appendToMessage,
    finishStreaming,

    setBusy,

    getSystemPrompt() {
      return systemPrompt.value;
    },

    clearMessages() {
      messagesEl.replaceChildren();
    },
  };
}

/**
 * Tiny element factory. `attrs` may include event handlers via `on*` keys.
 * @param {string} tag
 * @param {Record<string, string|boolean>} [attrs]
 * @param  {...(Node|string)} children
 */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}