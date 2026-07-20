// Modern, minimalist UI for the chat application
// No framework. Returns a controller object the caller uses to push updates.

import { formatBytes, formatEta } from './utils/format.js';

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
 *   onStorageBackendChange: (id: string) => void,
 *   onOutputFormatChange?: (text: string) => void,
 *   onToolToggle?: (name: string, enabled: boolean) => void,
 * }} handlers
 */
export function mountChat(root, handlers) {
  // ─── Loading Overlay ───────────────────────────────────────────────────
  const loadingOverlay = el('div', { class: 'loading-overlay', id: 'loading-overlay', hidden: '' });

  const loadingHeader = el('div', { class: 'loading-header' },
    el('span', { class: 'loading-spinner' }),
    el('span', { class: 'loading-title' }, 'Loading...')
  );

  const loadingSteps = el('div', { class: 'loading-steps' });

  const stepsContainer = el('div', { class: 'steps-container' });
  const loadingToggle = el('button', {
    class: 'loading-toggle',
    'aria-label': 'Toggle steps',
    type: 'button'
  }, '▼');

  const stepsList = el('div', { class: 'steps-list' });

  let stepsExpanded = true;

  loadingToggle.addEventListener('click', () => {
    stepsExpanded = !stepsExpanded;
    stepsList.hidden = !stepsExpanded;
    loadingToggle.textContent = stepsExpanded ? '▲' : '▼';
  });

  stepsContainer.append(loadingToggle, stepsList);
  loadingSteps.append(stepsContainer);
  loadingOverlay.append(loadingHeader, loadingSteps);

  // ─── Header ────────────────────────────────────────────────────────────
  // modelBadge doubles as a "Download a model" affordance: clicking it opens
  // the settings drawer and focuses the Download button (which lives inside
  // the otherwise-collapsed panel).
  const modelBadge = el('button', {
    type: 'button',
    class: 'model-badge',
    'aria-label': 'Open settings and download a model',
  }, 'Loading…');
  const headerLeft = el('div', { class: 'header-left' },
    el('h1', { class: 'app-title' }, 'Gemma Chat'),
    modelBadge,
  );

  // Simple SVG gear icon
  const gearSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>`;

  const settingsBtn = el('button', { class: 'icon-btn', 'aria-label': 'Settings' });
  settingsBtn.innerHTML = gearSvg;

  const headerRight = el('div', { class: 'header-right' }, settingsBtn);
  const header = el('header', { class: 'chat-header' }, headerLeft, headerRight);

  // ─── Status Bar (below header) ────────────────────────────────────────
  const statusDot = el('span', { class: 'status-dot' });
  const statusText = el('span', { class: 'status-text' }, 'Initializing…');
  const statusBar = el('div', { class: 'status-bar' }, statusDot, statusText);

  // ─── Settings panel (collapsible) ─────────────────────────────────────
  const settingsPanel = el('div', { class: 'settings-panel', hidden: '' });

  // Model selector row
  const modelSelect = el('select', { id: 'model-select', class: 'model-select' });
  const modelRow = el('div', { class: 'settings-row' },
    el('label', { for: 'model-select' }, 'Model'),
    modelSelect,
  );

  // Storage selector row
  const storageSelect = el('select', { id: 'storage-select', class: 'storage-select' });
  const storageRow = el('div', { class: 'settings-row' },
    el('label', { for: 'storage-select' }, 'Storage'),
    storageSelect,
  );

  // System prompt row
  const promptSelect = el('select', { id: 'prompt-select', class: 'prompt-select' });
  const systemPrompt = el('textarea', {
    id: 'system-prompt',
    class: 'system-prompt-input',
    rows: '3',
    placeholder: 'System prompt…',
  });
  const promptRow = el('div', { class: 'settings-row settings-row--prompt' },
    el('label', { for: 'prompt-select' }, 'Preset'),
    promptSelect,
    systemPrompt,
  );

  // Model status & actions
  const modelStatus = el('span', { class: 'model-status-text' });
  const downloadBtn = el('button', { class: 'btn btn-primary btn-sm', id: 'download-btn' }, 'Download');
  const deleteBtn = el('button', { class: 'btn btn-danger btn-sm', id: 'delete-btn' }, 'Delete');
  const modelActions = el('div', { class: 'model-actions' },
    modelStatus,
    downloadBtn,
    deleteBtn,
  );

  // Progress bar with text above
  const progressInfo = el('span', { class: 'progress-info', hidden: '' });
  const progressFill = el('div', { class: 'progress-fill' });
  const progressTrack = el('div', { class: 'progress-track', hidden: '' }, progressFill);
  const progressContainer = el('div', { class: 'progress-container' },
    progressInfo,
    progressTrack,
  );

  settingsPanel.append(
    modelRow,
    storageRow,
    promptRow,
    modelActions,
    progressContainer,
  );

  // ─── Messages ──────────────────────────────────────────────────────────
  const messagesEl = el('main', { id: 'messages', class: 'messages', 'aria-live': 'polite' });

  // ─── Composer ──────────────────────────────────────────────────────────
  const inputEl = el('textarea', {
    id: 'input',
    class: 'composer-input',
    rows: '1',
    placeholder: 'Ask something…',
    'aria-label': 'Message',
  });

  const cancelBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    id: 'cancel-btn',
    disabled: '',
  }, '✕');

  const sendBtn = el('button', {
    type: 'submit',
    class: 'btn btn-primary btn-icon',
    id: 'send-btn',
    disabled: '',
    'aria-label': 'Send',
  }, '→');

  const composerActions = el('div', { class: 'composer-actions' }, cancelBtn, sendBtn);

  const resetBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    id: 'reset-btn',
  }, '↻ New');

  const composerFooter = el('div', { class: 'composer-footer' }, resetBtn, composerActions);

  const composerEl = el('form', {
    id: 'composer',
    class: 'composer',
    autocomplete: 'off',
  }, inputEl, composerFooter);

  // ─── Assemble ──────────────────────────────────────────────────────────
  root.append(loadingOverlay, header, statusBar, settingsPanel, messagesEl, composerEl);

  // ─── State ─────────────────────────────────────────────────────────────
  let engineReady = false;
  /** @type {string|null} */
  let activeModelId = null;
  let settingsOpen = false;

  // ─── Output format section ─────────────────────────────────────────────
  // A single editable JSON-Schema textarea. When non-empty + valid, the next
  // chat reply is constrained to that shape (via LiteRT-LM's
  // enableConstrainedDecoding). When empty / invalid, chat reverts to
  // free-form prose.
  const outputFormatHeader = el('div', { class: 'settings-section-header' }, 'Output format');
  const outputFormatTextarea = el('textarea', {
    id: 'output-format',
    class: 'system-prompt-input output-format-input',
    rows: '10',
    spellcheck: 'false',
  });
  const outputFormatStatus = el('span', { class: 'model-status-text', id: 'output-format-status' });
  const outputFormatRow = el('div', { class: 'settings-row settings-row--prompt' },
    el('label', { for: 'output-format' }, 'JSON'),
    outputFormatTextarea,
  );
  const outputFormatFooter = el('div', { class: 'model-actions' }, outputFormatStatus);

  const outputFormatDivider = el('hr', { class: 'settings-divider' });
  settingsPanel.append(
    outputFormatDivider,
    outputFormatHeader,
    outputFormatRow,
    outputFormatFooter,
  );

  // ─── Tools section (Quran search tool) ─────────────────────────────────
  const toolsHeader = el('div', { class: 'settings-section-header' }, 'Tools');

  const quranToggle = el('input', {
    type: 'checkbox',
    id: 'tool-quran-search',
  });
  const quranToggleLabel = el('label', { class: 'tool-toggle', for: 'tool-quran-search' },
    quranToggle,
    'Auto-search Quran terms after extraction',
  );
  const quranToggleRow = el('div', { class: 'settings-row' }, quranToggleLabel);

  const quranStatus = el('span', { class: 'model-status-text', id: 'tool-quran-search-status' });
  const toolsFooter = el('div', { class: 'model-actions' }, quranStatus);

  const toolsDivider = el('hr', { class: 'settings-divider' });
  settingsPanel.append(
    toolsDivider,
    toolsHeader,
    quranToggleRow,
    toolsFooter,
  );

  // ─── Step management ───────────────────────────────────────────────────
  const steps = [];

  function addStep(id, label) {
    const step = { id, label, status: 'pending', detail: '' };
    steps.push(step);
    renderSteps();
    return step;
  }

  function updateStep(id, status, detail = '') {
    const step = steps.find(s => s.id === id);
    if (step) {
      step.status = status;
      if (detail) step.detail = detail;
      renderSteps();
    }
  }

  function renderSteps() {
    const total = steps.length;
    const done = steps.filter(s => s.status === 'done').length;
    const active = steps.find(s => s.status === 'active');
    const hasError = steps.some(s => s.status === 'error');

    // Update header
    const title = loadingHeader.querySelector('.loading-title');
    if (hasError) {
      title.textContent = '❌ Error loading';
      loadingOverlay.classList.add('error');
    } else if (done === total) {
      title.textContent = '✅ Ready to chat!';
      loadingOverlay.classList.add('complete');
      setTimeout(() => {
        loadingOverlay.classList.add('fade-out');
        setTimeout(() => {
          loadingOverlay.hidden = true;
          loadingOverlay.classList.remove('fade-out');
          document.body.style.overflow = '';
        }, 500);
      }, 1000);
    } else {
      title.textContent = active ? `⏳ ${active.label}` : '⏳ Loading...';
      loadingOverlay.classList.remove('complete', 'error');
    }

    // Update toggle text
    loadingToggle.textContent = stepsExpanded ? '▲' : '▼';

    // Render steps
    stepsList.replaceChildren();
    for (const step of steps) {
      const icons = { pending: '⬜', active: '⏳', done: '✅', error: '❌' };
      const colors = { pending: '', active: 'active', done: 'done', error: 'error' };

      const stepEl = el('div', {
        class: `loading-step ${colors[step.status]}`,
        'data-status': step.status
      });

      const icon = el('span', { class: 'step-icon' }, icons[step.status] || '⬜');
      const label = el('span', { class: 'step-label' }, step.label);
      const detail = step.detail ? el('span', { class: 'step-detail' }, step.detail) : null;

      stepEl.append(icon, label);
      if (detail) stepEl.append(detail);
      stepsList.append(stepEl);
    }

    // Update progress count
    stepsContainer.setAttribute('data-progress', `${done}/${total}`);
  }

  // ─── Toggle settings ──────────────────────────────────────────────────
  function setSettingsOpen(open) {
    settingsOpen = open;
    settingsPanel.hidden = !open;
  }

  settingsBtn.addEventListener('click', () => {
    setSettingsOpen(!settingsOpen);
  });

  // Open settings and surface the Download button. Used when the user clicks
  // the model badge in the header — a natural anchor for "go fix this".
  function openSettingsAndFocusDownload() {
    if (!settingsOpen) setSettingsOpen(true);
    modelActions.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => downloadBtn.focus({ preventScroll: true }), 50);
  }

  modelBadge.addEventListener('click', openSettingsAndFocusDownload);

  // The status bar (sub-header) is also clickable, but ONLY when the label
  // invites a download. For other states ("Ready", "Thinking…", etc.) the
  // click is a no-op so the bar doesn't feel like a perpetual settings
  // shortcut. The `data-actionable` attribute is toggled by `setStatus` below.
  function openSettingsIfActionable() {
    if (statusBar.dataset.actionable === 'true') {
      openSettingsAndFocusDownload();
    }
  }
  statusBar.addEventListener('click', openSettingsIfActionable);
  statusBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openSettingsIfActionable();
    }
  });

  // ─── Helpers ───────────────────────────────────────────────────────────
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMessage({ role, content }) {
    const avatar = role === 'user' ? 'U' : 'A';
    const node = el('div', {
      class: `message message-${role}`,
      'data-role': role,
    },
      el('div', { class: 'message-avatar' }, avatar),
      el('div', { class: 'message-content' }, content),
    );
    messagesEl.append(node);
    scrollToBottom();
    return node;
  }

  function appendError(message) {
    const node = el('div', { class: 'message message-error' },
      el('span', { class: 'error-icon' }, '⚠️'),
      el('span', {}, message),
    );
    messagesEl.append(node);
    scrollToBottom();
    return node;
  }

  function appendStreamingMessage() {
    const thinking = el('span', { class: 'thinking-dots' },
      el('span'), el('span'), el('span'),
    );
    const node = el('div', {
      class: 'message message-assistant streaming',
      'data-role': 'assistant',
    },
      el('div', { class: 'message-avatar' }, 'A'),
      el('div', { class: 'message-content' }, thinking),
    );
    messagesEl.append(node);
    scrollToBottom();
    return node;
  }

  function appendToMessage(node, chunk) {
    const content = node.querySelector('.message-content');
    if (!node.dataset.started) {
      node.dataset.started = 'true';
      content.replaceChildren();
      const cursor = document.createTextNode('▍');
      content.appendChild(cursor);
    }
    const cursor = content.lastChild;
    if (cursor && cursor.nodeType === Node.TEXT_NODE && cursor.textContent === '▍') {
      content.insertBefore(document.createTextNode(chunk), cursor);
    } else {
      content.textContent += chunk;
    }
    scrollToBottom();
  }

  function finishStreaming(node) {
    node?.classList.remove('streaming');
    const content = node?.querySelector('.message-content');
    if (content) {
      const lastChild = content.lastChild;
      if (lastChild && lastChild.nodeType === Node.TEXT_NODE && lastChild.textContent === '▍') {
        content.removeChild(lastChild);
      }
    }
  }

  function setBusy(busy) {
    sendBtn.disabled = busy || !engineReady;
    inputEl.disabled = busy;
    cancelBtn.disabled = !busy;
    resetBtn.disabled = busy || !engineReady;
  }

  function setAllDisabled(disabled) {
    const elements = [
      modelSelect, downloadBtn, deleteBtn, inputEl, sendBtn, cancelBtn, resetBtn,
      promptSelect, storageSelect, systemPrompt, settingsBtn
    ];
    for (const el of elements) {
      if (el) el.disabled = disabled;
    }
  }

  function showProgress(visible) {
    progressTrack.hidden = !visible;
    progressInfo.hidden = !visible;
    if (!visible) {
      progressFill.style.width = '0%';
      progressInfo.textContent = '';
    }
  }

  function setProgress(downloaded, total, etaSeconds) {
    if (!total || total <= 0) {
      progressFill.style.width = '100%';
      progressInfo.textContent = formatBytes(downloaded);
      return;
    }
    const pct = Math.min(100, (downloaded / total) * 100);
    progressFill.style.width = `${pct}%`;
    const eta = formatEta(etaSeconds);
    const base = `${pct.toFixed(0)}% · ${formatBytes(downloaded)} / ${formatBytes(total)}`;
    progressInfo.textContent = eta ? `${base} · ${eta}` : base;
  }

  // ─── Events ────────────────────────────────────────────────────────────
  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || !engineReady) return;
    appendMessage({ role: 'user', content: text });
    inputEl.value = '';
    inputEl.style.height = 'auto';
    setBusy(true);
    handlers.onSend(text);
  });

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 120)}px`;
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
    if (!confirm('Start a new conversation?')) return;
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
    const id = activeModelId ?? modelSelect.value;
    if (!id) return;
    handlers.onDownload(id);
  });

  deleteBtn.addEventListener('click', () => {
    const id = activeModelId ?? modelSelect.value;
    if (!id) return;
    if (!confirm('Delete this cached model?')) return;
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

  // ─── Output format event handler ───────────────────────────────────────
  let outputFormatDebounce = null;
  outputFormatTextarea.addEventListener('input', () => {
    clearTimeout(outputFormatDebounce);
    outputFormatDebounce = setTimeout(() => {
      handlers.onOutputFormatChange?.(outputFormatTextarea.value);
    }, 350);
  });

  // ─── Tool toggle event handler ─────────────────────────────────────────
  quranToggle.addEventListener('change', () => {
    handlers.onToolToggle?.('quran_search', quranToggle.checked);
  });

  // ─── Extraction-sources rendering helpers ───────────────────────────────
  // Called by main.js once the JSON extraction finishes and the parallel
  // `executeQuranSearch` calls return. Renders a single `.extraction-sources`
  // block at the bottom of the assistant message with one collapsible
  // `.term-block` per term.
  function beginSources(assistantEl, terms) {
    if (!assistantEl || !terms?.length) return;
    let section = assistantEl.querySelector('.extraction-sources');
    if (!section) {
      section = el('div', { class: 'extraction-sources', 'data-state': 'loading' });
      assistantEl.querySelector('.message-content').append(section);
    }
    section.replaceChildren();
    section.append(
      el('div', { class: 'sources-header' },
        el('span', { class: 'sources-icon' }, '🕌'),
        el('span', { class: 'sources-title' },
          `Looking up ${terms.length} term${terms.length === 1 ? '' : 's'}…`),
      ),
    );
  }

  function renderSources(assistantEl, results) {
    if (!assistantEl || !Array.isArray(results)) return;
    const section = assistantEl.querySelector('.extraction-sources');
    if (!section) return;
    section.dataset.state = 'ready';
    section.replaceChildren();
    const ok = results.filter((r) => r.result?.ok);
    const bad = results.filter((r) => !r.result?.ok);
    section.append(
      el('div', { class: 'sources-header' },
        el('span', { class: 'sources-icon' }, '🕌'),
        el('span', { class: 'sources-title' },
          `Sources · ${ok.length} of ${results.length} term${results.length === 1 ? '' : 's'} found`),
      ),
    );
    if (bad.length > 0) {
      const errs = el('div', { class: 'sources-errors' });
      for (const b of bad) {
        errs.append(el('div', { class: 'term-error' },
          `${b.term}: ${b.result?.error ?? 'search failed'}`));
      }
      section.append(errs);
    }
    for (const { term, result } of results) {
      if (!result?.ok) continue;
      const block = el('div', { class: 'term-block' });
      const header = el('div', { class: 'term-header', tabindex: '0', role: 'button' },
        el('span', { class: 'term-name' }, term),
        el('span', { class: 'term-count' },
          result.results.length === 0
            ? 'No verses'
            : `${result.results.length} of ${result.total} verses`),
        el('span', { class: 'term-caret' }, '▸'),
      );
      const verses = el('div', { class: 'term-verses', hidden: '' });
      if (result.results.length === 0) {
        verses.append(el('div', { class: 'term-empty' }, 'No matching verses.'));
      } else {
        for (const v of result.results) {
          verses.append(
            el('div', { class: 'verse' },
              el('div', { class: 'verse-ref' }, v.reference),
              el('div', { class: 'verse-text', lang: 'ar', dir: 'rtl' }, v.uthmani ?? ''),
              el('div', { class: 'verse-meta' },
                `${v.matchType ?? ''} · score ${v.matchScore ?? ''}`),
            ),
          );
        }
      }
      const toggle = () => {
        verses.hidden = !verses.hidden;
        header.dataset.open = verses.hidden ? '' : 'true';
        header.querySelector('.term-caret').textContent = verses.hidden ? '▸' : '▾';
      };
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      block.append(header, verses);
      section.append(block);
    }
  }

  // ─── Public controller ─────────────────────────────────────────────────
  return {
    // Loading overlay methods
    showLoading() {
      loadingOverlay.hidden = false;
      loadingOverlay.classList.remove('fade-out', 'complete', 'error');
      document.body.style.overflow = 'hidden';
      setAllDisabled(true);
    },

    hideLoading() {
      loadingOverlay.classList.add('fade-out');
      document.body.style.overflow = '';
      setTimeout(() => {
        loadingOverlay.hidden = true;
        loadingOverlay.classList.remove('fade-out');
        setAllDisabled(false);
      }, 500);
    },

    addSteps(stepDefs) {
      steps.length = 0;
      for (const def of stepDefs) {
        addStep(def.id, def.label);
      }
      renderSteps();
    },

    updateStep(id, status, detail = '') {
      updateStep(id, status, detail);
    },

    // Model methods
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

    loadPromptText(text) {
      systemPrompt.value = text ?? '';
    },

    setActiveModel(modelId) {
      activeModelId = modelId;
      if (modelSelect.value !== modelId) modelSelect.value = modelId;
      const model = modelSelect.options[modelSelect.selectedIndex]?.text || modelId;
      modelBadge.textContent = model.split(' — ')[0] || modelId;
    },

    setModelStatus(label) {
      modelStatus.textContent = label;
    },

    setModelStatusState(state) {
      modelStatus.dataset.state = state;
      modelStatus.classList.toggle('is-loaded', state === 'loaded');

      downloadBtn.classList.remove('btn-primary', 'btn-ghost', 'btn-success');
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
          downloadBtn.classList.add('btn-success');
          downloadBtn.disabled = true;
          break;
        case 'downloading':
          downloadBtn.textContent = 'Downloading…';
          downloadBtn.disabled = true;
          break;
        case 'error':
          downloadBtn.textContent = 'Retry';
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
      const dotColors = { ok: '#22c55e', bad: '#ef4444', warn: '#f59e0b' };
      statusDot.style.background = dotColors[state] || '#6b7280';
      statusBar.className = `status-bar status-${state}`;
      this.setStatus(label);
    },

    setEngine(state, label) {
      const dotColors = { ok: '#22c55e', bad: '#ef4444', warn: '#f59e0b' };
      statusDot.style.background = dotColors[state] || '#6b7280';
      statusBar.className = `status-bar status-${state}`;
      engineReady = state === 'ok';
      setBusy(false);
      this.setStatus(label);
    },

    setStatus(label) {
      let displayText = label;

      if (label && label.includes('supported')) {
        displayText = '✅ WebGPU ready';
      } else if (label && label.includes('unsupported')) {
        displayText = '❌ WebGPU not available';
      } else if (label && label.includes('checking')) {
        displayText = '⏳ Checking WebGPU…';
      } else if (label && label.includes('warming up')) {
        displayText = '⏳ ' + label.replace('warming up', 'Loading');
      } else if (label && label.includes('ready')) {
        displayText = '✅ ' + label;
      } else if (label && label.includes('error')) {
        displayText = '❌ ' + label;
      } else if (label && label.includes('thinking')) {
        displayText = '🤔 ' + label;
      } else if (label && label.includes('decoding')) {
        displayText = '💬 ' + label;
      } else if (label && label.includes('downloading')) {
        displayText = '⬇️ ' + label;
      } else if (label && label.includes('injecting')) {
        displayText = '📝 ' + label;
      } else if (label && label.includes('disabled')) {
        displayText = '⛔ ' + label;
      }

      statusText.textContent = displayText;

      // Toggle the actionable hint: the bar's click handler only does
      // anything when its label invites the user to fix something
      // (typically: download a model). The CSS picks up data-actionable
      // to show cursor + hover + focus affordances.
      const isActionable = !!displayText && /(not ready|click download|not downloaded)/i.test(displayText);
      statusBar.dataset.actionable = isActionable ? 'true' : '';
      statusBar.tabIndex = isActionable ? 0 : -1;
    },

    setStorageAvailability({ crossOriginAvailable, preferred = 'cache' }) {
      storageSelect.replaceChildren();
      storageSelect.append(el('option', { value: 'cache' }, 'Cache'));

      const crossLabel = crossOriginAvailable ? 'Cross-Origin' : 'Cross-Origin (disabled)';
      const crossOpt = el('option', { value: 'cross-origin' }, crossLabel);
      if (!crossOriginAvailable) crossOpt.disabled = true;
      storageSelect.append(crossOpt);

      const active = (preferred === 'cross-origin' && crossOriginAvailable) ? 'cross-origin' : 'cache';
      storageSelect.value = active;
    },

    getStorageBackend() {
      return storageSelect.value;
    },

    getModelId() {
      return activeModelId ?? modelSelect.value;
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

    // ─── Output format controller methods ────────────────────────────────
    setOutputFormat(text) {
      // Don't fire the change handler during programmatic assignment.
      clearTimeout(outputFormatDebounce);
      outputFormatTextarea.value = text ?? '';
    },

    getOutputFormat() {
      return outputFormatTextarea.value;
    },

    /**
     * Show the validation/apply status of the output-format JSON.
     * @param {{ state: 'on' | 'off' | 'invalid', message?: string }} status
     */
    setOutputFormatStatus({ state, message }) {
      outputFormatStatus.dataset.state = state;
      outputFormatStatus.textContent = message ?? '';
    },

    // ─── Tools controller methods ─────────────────────────────────────────
    setToolsAvailability({ quranSearch }) {
      if (quranSearch) quranToggle.checked = !!quranSearch.enabled;
    },

    setToolStatus(name, { status, detail }) {
      if (name !== 'quran_search') return;
      quranStatus.dataset.state = status;
      quranStatus.textContent =
        status === 'idle'    ? 'Quran data: loads on first extraction' :
        status === 'loading' ? '⏳ Loading Quran data…' :
        status === 'ready'   ? '✅ Quran data ready' :
        status === 'error'   ? `❌ ${detail ?? 'load failed'}` :
                               '';
    },

    beginSources,
    renderSources,
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