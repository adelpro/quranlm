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
  const webgpuEl = el('span', { id: 'status-webgpu', class: 'warn' }, 'WebGPU: checking…');
  const engineEl = el('span', { id: 'status-engine', class: 'warn' }, 'Engine: idle');

  // Storage is now an interactive selector. The "Cross-Origin Storage"
  // option is disabled when the extension is not detected.
  const storageSelect = el('select', {
    id: 'storage-select',
    class: 'storage-select',
    'aria-label': 'Storage backend',
  });
  const storageInfoBtn = el('button', {
    type: 'button',
    class: 'storage-info',
    'aria-label': 'About storage backends',
    title: 'About storage backends',
  }, 'ⓘ');
  const storageEl = el('span', { id: 'status-storage', class: 'muted' },
    el('span', { class: 'storage-key' }, 'Storage:'),
    storageSelect,
    storageInfoBtn,
  );

  // Popover that explains the two backends.
  const popover = el('div', { class: 'popover', role: 'dialog', hidden: '' });
  const popoverTitle = el('h3', { class: 'popover-title' });
  const popoverBody = el('div', { class: 'popover-body' });
  const popoverClose = el('button', { type: 'button', class: 'popover-close', 'aria-label': 'Close' }, '×');

  function renderPopover(crossOriginAvailable) {
    popoverTitle.textContent = 'Storage backends';
    popoverBody.replaceChildren(
      el('p', { class: 'popover-lead' },
        'Models live in your browser. Pick the backend that matches your setup.'),
      el('div', { class: 'popover-block' },
        el('h4', {}, 'Cache API'),
        el('p', {}, 'Built into every browser. Per-origin, per-quota. Every site that uses the same model downloads its own copy.'),
        el('p', { class: 'popover-meta ok' }, '✓ Always available.'),
      ),
      el('div', { class: 'popover-block' },
        el('h4', {},
          'Cross-Origin Storage ',
          el('span', { class: 'badge-experimental' }, 'experimental'),
        ),
        el('p', {}, 'Proposed W3C API. Files are keyed by SHA-256, shared across sites, and verified by the browser on write. Cross-site dedup, larger pooled quota, no per-origin rate limits on Hugging Face.'),
        crossOriginAvailable
          ? el('p', { class: 'popover-meta ok' }, '✓ Chrome extension detected — option unlocked.')
          : el('p', { class: 'popover-meta warn' },
            'Extension not detected — option is disabled.',
            el('br'),
            el('a', {
              href: 'https://chromewebstore.google.com/detail/cross-origin-storage/denpnpcgjgikjpoglpjefakmdcbmlgih',
              target: '_blank',
              rel: 'noopener',
            }, 'Install Chrome extension →'),
          ),
        el('p', { class: 'popover-meta dim' },
          'Native browser support is in the W3C proposal pipeline. Firefox / Safari adoption depends on each vendor.'),
      ),
      el('p', { class: 'popover-foot' },
        'Switching backends does not migrate existing models — they stay where they were downloaded. New downloads go to the selected backend.'),
    );
  }

  function openPopover(crossOriginAvailable) {
    renderPopover(crossOriginAvailable);
    popover.replaceChildren(popoverTitle, popoverClose, popoverBody);
    popover.hidden = false;
  }
  function closePopover() {
    popover.hidden = true;
  }
  storageInfoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover.hidden) openPopover(currentCrossOriginAvailable);
    else closePopover();
  });
  popoverClose.addEventListener('click', closePopover);
  document.addEventListener('click', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && e.target !== storageInfoBtn) {
      closePopover();
    }
  });

  // Track availability so the popover renders the right state without
  // re-querying navigator every click.
  let currentCrossOriginAvailable = false;

  const statusBar = el('header', { class: 'status-bar' }, webgpuEl, engineEl, storageEl);
  statusBar.append(popover);

  // ─── Model picker ──────────────────────────────────────────────────────
  const modelSelect = el('select', { id: 'model-select', 'aria-label': 'Choose model' });
  const modelLabel = el('label', { for: 'model-select' }, 'Model');
  const modelStatus = el('span', { id: 'model-status', class: 'muted' }, '—');
  const downloadBtn = el('button', { type: 'button', id: 'download-btn', class: 'primary' }, 'Download');
  const deleteBtn = el('button', { type: 'button', id: 'delete-btn', class: 'danger' }, 'Delete cache');

  const progressTrack = el('div', { class: 'progress-track', hidden: '' });
  const progressFill = el('div', { class: 'progress-fill' });
  const progressText = el('span', { class: 'progress-text' }, '0%');
  progressTrack.append(progressFill, progressText);

  const modelPicker = el('section', { class: 'model-picker' },
    modelLabel, modelSelect,
    el('div', { class: 'model-picker-row' }, modelStatus, deleteBtn, downloadBtn),
    progressTrack,
  );

  // ─── System prompt (with preset dropdown) ──────────────────────────────
  const promptSelect = el('select', { id: 'prompt-select', 'aria-label': 'System prompt preset' });
  const promptLabel = el('label', { for: 'prompt-select' }, 'Preset');
  const systemLabel = el('label', { for: 'system-prompt' }, 'System prompt');
  const systemPrompt = el('textarea', { id: 'system-prompt', rows: '6' });
  const systemSection = el('section', { class: 'system-prompt' },
    el('div', { class: 'system-prompt-row' }, promptLabel, promptSelect),
    systemLabel, systemPrompt,
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
  const resetBtn = el('button', { type: 'button', id: 'reset-btn', class: 'danger', disabled: '' }, 'Reset');
  const cancelBtn = el('button', { type: 'button', id: 'cancel-btn', disabled: '' }, 'Cancel');
  const sendBtn = el('button', { type: 'submit', id: 'send-btn', class: 'primary', disabled: '' }, 'Send');
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
    const thinking = el('span', { class: 'thinking-dots', 'aria-label': 'Thinking' },
      el('span'), el('span'), el('span'),
    );
    const node = el('div', {
      class: 'message message-assistant streaming',
      'data-role': 'assistant',
    }, thinking);
    messagesEl.append(node);
    scrollToBottom();
    return node;
  }

  function appendToMessage(node, chunk) {
    // First chunk: replace the thinking indicator with actual content.
    if (!node.dataset.started) {
      node.dataset.started = 'true';
      node.replaceChildren();
    }
    node.textContent += chunk;
    scrollToBottom();
  }

  function finishStreaming(node) {
    node?.classList.remove('streaming');
  }

  function setBusy(busy) {
    sendBtn.disabled = busy || !engineReady;
    inputEl.disabled = busy;
    cancelBtn.disabled = !busy;
    systemPrompt.disabled = busy;
    resetBtn.disabled = busy || !engineReady;
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

  storageSelect.addEventListener('change', () => {
    if (handlers.onStorageBackendChange) {
      handlers.onStorageBackendChange(storageSelect.value);
    }
  });

  // ─── Public controller ─────────────────────────────────────────────────
  return {
    setModels(entries) {
      modelSelect.replaceChildren();
      for (const m of entries) {
        const opt = el('option', { value: m.id }, `${m.label} — ${m.sublabel}`);
        modelSelect.append(opt);
      }
    },

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
     * Replace the textarea with a preset's text.
     */
    loadPromptText(text) {
      systemPrompt.value = text ?? '';
    },

    setActiveModel(modelId) {
      activeModelId = modelId;
      if (modelSelect.value !== modelId) modelSelect.value = modelId;
    },

    setModelStatus(label) {
      modelStatus.textContent = label;
    },

    setModelStatusState(state) {
      // state: 'available' | 'cached' | 'loaded' | 'downloading' | 'error'
      modelStatus.dataset.state = state;
      modelStatus.classList.toggle('is-loaded', state === 'loaded');

      // Update the Download button label and styling per state so the user
      // can tell at a glance whether re-downloading is needed.
      downloadBtn.classList.remove('btn-primary', 'btn-ghost', 'btn-danger', 'btn-success-static');
      switch (state) {
        case 'available':
          downloadBtn.textContent = 'Download';
          downloadBtn.classList.add('btn-primary');
          downloadBtn.disabled = false;
          break;
        case 'cached':
          downloadBtn.textContent = 'Re-download';
          downloadBtn.classList.add('btn-ghost');
          downloadBtn.disabled = true;
          break;
        case 'loaded':
          downloadBtn.textContent = '✓ Loaded';
          downloadBtn.classList.add('btn-success-static');
          downloadBtn.disabled = true;
          break;
        case 'downloading':
          downloadBtn.textContent = 'Downloading…';
          downloadBtn.disabled = true;
          break;
        case 'error':
          downloadBtn.textContent = 'Retry download';
          downloadBtn.classList.add('btn-danger');
          downloadBtn.disabled = false;
          break;
      }

      deleteBtn.disabled = !(state === 'cached' || state === 'loaded');
      modelSelect.disabled = state === 'downloading';
      showProgress(state === 'downloading');
    },

    setProgress,

    setWebGPU(state, label) {
      webgpuEl.textContent = `WebGPU: ${label}`;
      webgpuEl.className = state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : 'warn';
    },

    setEngine(state, label) {
      engineEl.textContent = `Engine: ${label}`;
      engineEl.className = state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : 'warn';
      engineReady = state === 'ok';
      setBusy(false);
    },

    setStorageBackend(label, isCrossOrigin) {
      // Kept for backwards compatibility with old callers — just updates the
      // title attribute on the chip without touching the select.
      storageEl.title = isCrossOrigin
        ? 'Models are stored in Cross-Origin Storage — shared across sites and hash-verified.'
        : 'Models are stored in the per-origin Cache API. Install the Cross-Origin Storage extension to enable cross-site dedup.';
    },

    /**
     * Populate the storage selector with the currently-available backends.
     * The Cross-Origin Storage option is disabled (and labeled "extension not
     * installed") when `crossOriginAvailable` is false.
     * @param {{ crossOriginAvailable: boolean, preferred?: 'cache'|'cross-origin' }} opts
     */
    // In ui.js - Update setStorageAvailability to show the current selection
    setStorageAvailability({ crossOriginAvailable, preferred = 'cache' }) {
      currentCrossOriginAvailable = !!crossOriginAvailable;
      storageSelect.replaceChildren();

      // Cache API — always available.
      storageSelect.append(el('option', { value: 'cache' }, 'Cache API'));

      // Cross-Origin Storage — disabled without the extension.
      const crossLabel = crossOriginAvailable
        ? 'Cross-Origin Storage'
        : 'Cross-Origin Storage (extension not installed)';
      const crossOpt = el('option', { value: 'cross-origin' }, crossLabel);
      if (!crossOriginAvailable) crossOpt.disabled = true;
      storageSelect.append(crossOpt);

      // Pick the active one based on preference
      const active = (preferred === 'cross-origin' && crossOriginAvailable) ? 'cross-origin' : 'cache';
      storageSelect.value = active;

      // Show status color
      storageEl.className = crossOriginAvailable ? 'ok' : 'warn';

      // Update the display to show current selection
      const selectedLabel = storageSelect.options[storageSelect.selectedIndex]?.text || 'Cache API';
      storageEl.title = `Current storage: ${selectedLabel}`;

      renderPopover(crossOriginAvailable);
    },

    getStorageBackend() {
      return storageSelect.value;
    },

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
 * Tiny element factory.
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