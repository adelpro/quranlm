# LiteRT-LM Web Experiment

A minimal [Vite](https://vitejs.dev/) + vanilla-JS playground for [LiteRT-LM](https://developers.google.com/edge/litert-lm/js) — Google's browser-side LLM runtime, powered by WebGPU. A Gemma model runs entirely in your browser, no server.

The app ships with a model picker, in-browser downloads with a progress bar, and a streaming chat UI — everything needed to start experimenting.

## Prerequisites

- **Node.js 20+** (for the dev server and optional CLI download script)
- **Chrome 113+ or Edge 113+** with WebGPU enabled
  - Chrome stable has WebGPU on by default
  - If you see `WebGPU: unsupported`, open `chrome://gpu` and check the WebGPU entry, or enable `chrome://flags/#enable-unsafe-webgpu` on older versions
- ~1–2 GB of free browser cache for the model file

## Setup

```bash
yarn install
yarn dev                         # opens http://localhost:5173
```

Then pick a model from the dropdown and click **Download**. The progress bar streams bytes into the browser's Cache API; once the download finishes, the engine loads automatically and you can chat.

### Models

| ID | Label | Size | SHA-256 | HuggingFace |
| --- | --- | --- | --- | --- |
| `e2b` | Gemma 4 E2B | 1.87 GB | `3a08e8d9…f35b5` | [litert-community/gemma-4-E2B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) |
| `e4b` | Gemma 4 E4B | 2.77 GB | `3904d826…4f57a0` | [litert-community/gemma-4-E4B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm) |

Each entry's SHA-256 comes from the HF LFS pointer for the file. After download we re-hash the bytes in the browser and refuse to cache anything that doesn't match — so a corrupted or tampered download is caught before the engine ever sees it.

> **Note:** The supported model filenames look like `gemma-4-E*-it-web.litertlm` (not `gemma-3-*`). This naming follows the upstream [LiteRT-LM docs](https://developers.google.com/edge/litert-lm/js). If a model 404s, verify the URL on HuggingFace and update the `MODELS` table in [`src/models.js`](src/models.js).

### Storage tiers

Downloads go to two backends, in priority order:

1. **[Cross-Origin Storage](https://huggingface.co/blog/cross-origin-storage)** (`navigator.crossOriginStorage`) — proposed WICG API where files are looked up by SHA-256 and can be shared across sites. Not natively implemented in any browser yet, but [a Chrome extension](https://chromewebstore.google.com/detail/cross-origin-storage/denpnpcgjgikjpoglpjefakmdcbmlgih) exposes it today.
2. **Cache API** — works in every browser, but per-origin and per-quota.

The status bar shows which tier is active. If Cross-Origin Storage is available, your model is shared with any other site that fetches the same SHA-256 — download once, use everywhere.

### Alternative: download from the command line

If you'd rather pre-fetch the model file with curl/wget (or want to inspect it locally), the in-app downloader is optional — you can also point the Node script at one of the URLs:

```bash
node scripts/download-model.mjs              # E2B (default)
node scripts/download-model.mjs --model=e4b  # E4B
```

This script writes to `public/models/` (git-ignored). The default app path still uses the in-browser Cache API, so this script is mostly useful as a reference / offline cache.

## Project layout

```text
src/
  models.js  — model registry + browser cache + streaming download
  chat.js    — LiteRT wrapper (Engine + Conversation)
  ui.js      — DOM rendering: chat + model picker + progress bar
  main.js    — bootstrap, lifecycle
  styles.css
scripts/
  download-model.mjs — CLI fallback for downloading models
index.html
vite.config.js
```

## Customizing the model

Add or edit entries in `MODELS` inside [`src/models.js`](src/models.js). Each entry needs a unique `id`, `label`, `sublabel`, `url`, `filename`, and (optional) `approxSize`. The picker, download progress, and status messages are driven from that table.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `WebGPU: unsupported — …` | Use Chrome 113+; enable `chrome://flags/#enable-unsafe-webgpu`. |
| `HTTP 404 — …` when downloading | The HuggingFace URL has changed. Open the model page on HF, copy the `resolve/main/<file>` URL, and update `MODELS` in `src/models.js`. |
| `Engine: error — Invalid magic number. Expected 'LITERTLM', got '<!DOCTYP'` | The model URL returned an HTML page (typically a 404). Same fix as above — update `MODELS`. |
| `SHA-256 mismatch for gemma-4-…` | The downloaded bytes don't match the declared hash. Either HF rotated the file (update `sha256` in `MODELS`) or the transfer was corrupted — retry the download. |
| `SharedArrayBuffer is not defined` | The COOP/COEP headers in `vite.config.js` should fix this — make sure you're not loading the page from `file://`. |
| Generation is very slow | Use the E2B model. Larger context (`maxNumTokens`) makes every turn slower. |
| Download keeps stalling | Check the network panel — HuggingFace sometimes rate-limits unauthenticated downloads. Refresh and retry. |
| `Storage: Cache API` and I want cross-origin dedup | Install the [Cross-Origin Storage extension](https://chromewebstore.google.com/detail/cross-origin-storage/denpnpcgjgikjpoglpjefakmdcbmlgih) and reload. The status bar will switch to green. |

## Experiments to try next

- Adjust `mainExecutorSettings.maxNumTokens` in `src/chat.js`
- Add markdown rendering for assistant replies
- Add a streaming latency / tokens-per-second readout in the status bar
- Plug a tool-calling schema into `preface.messages` once supported
- Persist conversation history (currently cleared on page reload)
- Serve the built bundle (`yarn build && yarn preview`) from GitHub Pages

## API reference

The full API surface used here:

- `Engine.create({ model, mainExecutorSettings: { maxNumTokens } })`
- `engine.createConversation({ preface: { messages: [{ role: 'system', content }] } })`
- `conversation.sendMessageStreaming(text)` → `ReadableStream<Message>`
- `conversation.cancel()`
- `engine.delete()`

See <https://developers.google.com/edge/litert-lm/js> for the latest.
