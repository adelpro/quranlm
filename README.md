<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <img src="docs/quranlm-logo.svg" alt="QuranLM logo" width="160" height="160" />
</p>

<h1 align="center">QuranLM</h1>

<p align="center">
  <strong>A private, offline AI companion for the Quran.</strong><br />
  Ask, search, and explore — entirely in your browser, no server, no telemetry.
</p>

<p align="center">
  <a href="#prerequisites">Prerequisites</a> ·
  <a href="#setup">Setup</a> ·
  <a href="#install-cross-origin-storage-extension">Cross-Origin Storage</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

QuranLM is a browser-side AI companion for the Quran, built on top of
[LiteRT-LM](https://developers.google.com/edge/litert-lm/js) — Google's
in-browser LLM runtime powered by WebGPU. A Gemma model runs **entirely on
your device**: every prompt, every response, every Quran search happens
locally. Nothing leaves your machine, nothing is logged.

- **Offline-first**: download a model once, then chat and search with no
  network connection.
- **Private by design**: no backend, no telemetry, no analytics.
- **Quran-aware**: built-in client-side Quran search engine that the model
  can ground its answers in.
- **Streaming chat**: token-by-token responses with constrained-decoding
  support for structured output.
- **Cross-origin model sharing**: downloads can be deduplicated across sites
  via the [Cross-Origin Storage API](https://huggingface.co/blog/cross-origin-storage).

## Prerequisites

- **Node.js 20+** (for the dev server)
- **Chrome 113+ or Edge 113+** with WebGPU enabled
  - Chrome stable has WebGPU on by default
  - If you see `WebGPU: unsupported`, open `chrome://gpu` and check the
    WebGPU entry, or enable `chrome://flags/#enable-unsafe-webgpu` on older
    versions
- **Firefox users** also need the Cross-Origin Storage extension — see
  [Install Cross-Origin Storage extension](#install-cross-origin-storage-extension)
  below
- ~1–2 GB of free browser cache for the model file

## Setup

```bash
yarn install
yarn dev                         # opens http://localhost:5173
```

Then pick a model from the dropdown and click **Download**. The progress bar
streams bytes into the browser's Cache API or Cross-Origin Storage; once the
download finishes, the engine loads automatically and you can chat.

### Scripts

| Command | Description |
| --- | --- |
| `yarn dev` | Vite dev server with COOP/COEP headers. |
| `yarn typecheck` | `tsc --noEmit` over the whole project. |
| `yarn test` | Vitest unit tests (JSON extractor, etc.). |
| `yarn build` | Type-check, then build production bundle to `dist/`. |
| `yarn preview` | Serve `dist/` with the same COOP/COEP headers. |

### Models

| ID | Label | Size | SHA-256 | HuggingFace |
| --- | --- | --- | --- | --- |
| `e2b` | Gemma 4 E2B | 1.87 GB | `3a08e8d9…f35b5` | [litert-community/gemma-4-E2B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) |
| `e4b` | Gemma 4 E4B | 2.77 GB | `3904d826…4f57a0` | [litert-community/gemma-4-E4B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm) |

Each entry's SHA-256 comes from the HF LFS pointer for the file. After
download we re-hash the bytes in the browser and refuse to cache anything
that doesn't match — so a corrupted or tampered download is caught before the
engine ever sees it.

> **Note:** The supported model filenames look like
> `gemma-4-E*-it-web.litertlm` (not `gemma-3-*`). This naming follows the
> upstream [LiteRT-LM docs](https://developers.google.com/edge/litert-lm/js).
> If a model 404s, verify the URL on HuggingFace and update the `MODELS`
> table in [`src/data/models.ts`](src/data/models.ts).

### Storage tiers

Downloads go to two backends, in priority order:

1. **[Cross-Origin Storage](https://huggingface.co/blog/cross-origin-storage)**
   (`navigator.crossOriginStorage`) — proposed WICG API where files are
   looked up by SHA-256 and can be shared across sites. Not natively
   implemented in any browser yet, but extensions expose it today.
   See the install section below.
2. **Cache API** — works in every browser, but per-origin and per-quota.

The status bar shows which tier is active. If Cross-Origin Storage is
available, your model is shared with any other site that fetches the same
SHA-256 — download once, use everywhere.

## Install Cross-Origin Storage extension

The [Cross-Origin Storage API](https://huggingface.co/blog/cross-origin-storage)
is not built into any browser yet. To enable it on your machine, install the
official extension for your browser:

### Firefox

👉 **[Install for Firefox →](https://addons.mozilla.org/en-US/firefox/addon/cross-origin-storage/)**

1. Open the link above.
2. Click **Add to Firefox**.
3. Approve the permissions prompt.
4. Reload QuranLM.

### Chrome / Edge / Brave (Chromium-based)

👉 **[Install for Chrome →](https://chromewebstore.google.com/detail/cross-origin-storage/denpnpcgjgikjpoglpjefakmdcbmlgih)**

1. Open the link above.
2. Click **Add to Chrome**.
3. Confirm the permissions dialog.
4. Reload QuranLM.

### Verify it's working

After installing and reloading QuranLM:

1. Open the browser console.
2. Type `navigator.crossOriginStorage` and press Enter.
3. It should return an object (not `undefined`).

QuranLM's status bar will switch from **Cache API** to
**Cross-Origin Storage** as soon as the API is detected. Any model you
download afterwards will be deduplicated against any other site that asks
for the same SHA-256.

> Without this extension, QuranLM still works — it just falls back to the
> per-origin Cache API. With it, your model file is sharable across sites
> and survives clearing the browser cache.

## Architecture

```text
src/
  main.tsx                # createRoot + App mount
  App.tsx                 # Jotai Provider + layout
  index.css               # Tailwind v4 + design-token @theme

  app/
    store.ts              # explicit Jotai store
    engine.atoms.ts       # engineRefAtom + engineLifecycleAtom + webGpuStatusAtom
    useAppBootstrap.ts    # WebGPU → validate models → load

  components/
    layout/               # Header (brand + status pill), StatusBar, SettingsPanel, LoadingOverlay
    ui/                   # Button, StatusBadge, Toggle

  features/
    chat/                 # chat.atoms, MessageList, Message, StreamingMessage, Composer, useChat
    models/               # model.atoms, ModelPicker, ModelActions, DownloadProgress, StorageSelect, useDownload
    settings/             # settings.atoms, PromptSettings, OutputFormatEditor, ToolToggles
    quran/                # quran.atoms, SourceList, SourceGroup, useQuranSearch
    loading/              # loading.atoms, useStepTracker

  hooks/
    useEngine.ts          # engine lifecycle, model-switch serialization, debounced reconfigure

  services/               # framework-agnostic, pure async modules
    chat.ts               # ChatSession (liteRT wrapper)
    models.ts             # MODELS registry + download/cache/delete
    quran-search.ts       # in-process quran-search-engine wrapper
    cross-origin-storage.ts # WICG COS wrapper

  data/                   # frozen, framework-agnostic
    models.ts             # MODELS table (typed)
    prompts.ts            # PROMPTS table
    output-format.ts      # DEFAULT_OUTPUT_FORMAT JSON Schema

  lib/                    # pure utilities
    extract-json.ts       # pure brace-balancing JSON extractor (+ tests)
    format.ts             # formatBytes, formatEta
    timeout.ts            # withTimeout
```

### Design notes

- **Engine is held in a stable ref, never in React state.** WebGPU/WASM
  objects are multi-gigabyte; storing them in `useState` would re-render on
  every mutation. `engineRefAtom` is a `{ current: EngineRuntime | null }`
  container that hooks mutate directly. The observable lifecycle
  (loading / ready / error / disposing) is exposed via
  `engineLifecycleAtom` instead.
- **Streaming is rAF-batched.** Chunks from `ChatSession.sendStream()` are
  appended to a non-reactive buffer and flushed at most once per
  `requestAnimationFrame` into `activeStreamAtom`. Only `StreamingMessage`
  subscribes to that atom, so static messages never re-render at token
  cadence.
- **Tailwind v4 with `@theme inline`.** The legacy `:root` CSS variables
  still define the colors; Tailwind consumes them via
  `@theme inline { --color-bg: var(--bg); ... }` so utilities like `bg-bg`,
  `text-text-secondary`, `border-border` work directly.
- **No `React.StrictMode` initially.** The dev-mode mount/unmount cycle
  would create and tear down a multi-GB, non-abortable WebGPU engine twice
  per page load. Re-enable in [`src/main.tsx`](src/main.tsx) once the engine
  lifecycle is proven idempotent.
- **Cross-Origin Storage reads are NEVER hashed.** Calling `arrayBuffer()`
  on a WICG-stored File consumes the storage stream — `Engine.create` would
  then see an empty/closed Blob and hang on its second read. SHA verification
  runs only against freshly downloaded blobs and the Cache API path.

## Cross-origin isolation in production

`vite.config.ts` sets the right headers on `dev` and `preview` only.
Production hosts do not set them for you, so the deployed site is *not*
cross-origin-isolated and `SharedArrayBuffer` is unavailable. LiteRT-LM's
multi-threaded WASM build requires `SharedArrayBuffer`, so the engine
throws `SharedArrayBuffer is not defined` as soon as you try to load a
model.

The three headers below tell the browser to (a) isolate the page from any
window opened by another origin, (b) refuse to embed any cross-origin
resource that doesn't explicitly opt in, and (c) let *our* resources be
embedded by other cross-origin-isolated pages. Together they flip the page
into "cross-origin-isolated" mode, and `SharedArrayBuffer` becomes
available.

| Header | Value |
| --- | --- |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | `require-corp` |
| `Cross-Origin-Resource-Policy` | `cross-origin` |

### For Netlify and Cloudflare Pages

Both hosts read [`public/_headers`](public/_headers) and
[`public/_redirects`](public/_redirects) from the publish directory —
Vite copies them into `dist/` at build time. Both files are already in
this repo. Redeploy and you're done. (`_redirects` is unrelated to the
COOP/COEP issue but required so reloading `/settings` doesn't 404 — the
app uses client-side routing.)

If you want to verify locally first:

```bash
yarn build && yarn preview   # http://localhost:4173
curl -I http://localhost:4173 | grep -iE 'cross-origin'
```

You should see all three headers in the response.

### For Vercel

Vercel does not read `_headers`. Add a `vercel.json` at the repo root with
the same headers and an SPA-rewrite rule:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy",   "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Resource-Policy", "value": "cross-origin" }
      ]
    }
  ],
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### For GitHub Pages

GitHub Pages has no mechanism to set response headers. This app requires
`SharedArrayBuffer`, which is unreachable on GitHub Pages. Use Netlify or
Cloudflare Pages instead. If you must use GH Pages, put Cloudflare in
front of it and configure the headers on Cloudflare.

### For S3 + CloudFront, Firebase Hosting, or other custom hosts

Configure the three headers at the host layer:

- **CloudFront:** create a response-headers policy with the three
  headers and attach it to the cache behavior for `Default(*)` and
  `/assets/*`.
- **Firebase Hosting:** add a `headers` block to `firebase.json` with
  the three headers on `"source": "**"`, plus a `rewrites` block with
  `"source": "**", "destination": "/index.html"`.
- **Other hosts:** consult your host's docs for the equivalent of
  Netlify's `_headers` file.

### Verify in the browser

Open the deployed site, open DevTools → Console, and run:

```js
crossOriginIsolated                       // → true
typeof SharedArrayBuffer === 'function'   // → true
```

If the first is `false`, the headers didn't reach the response — check the
Network tab on the *document* request (the top-level `index.html`), not on
a sub-resource.

## Customizing the model

Add or edit entries in `MODELS` inside [`src/data/models.ts`](src/data/models.ts).
Each entry needs a unique `id`, `label`, `sublabel`, `url`, `filename`,
`sha256`, and `approxSize`. The picker, download progress, and status
messages are driven from that table.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `WebGPU: unsupported — …` | Use Chrome 113+; enable `chrome://flags/#enable-unsafe-webgpu`. |
| `HTTP 404 — …` when downloading | The HuggingFace URL has changed. Open the model page on HF, copy the `resolve/main/<file>` URL, and update `MODELS` in `src/data/models.ts`. |
| `Engine: error — Invalid magic number. Expected 'LITERTLM', got '<!DOCTYP'` | The model URL returned an HTML page (typically a 404). Same fix as above — update `MODELS`. |
| `SHA-256 mismatch for gemma-4-…` | The downloaded bytes don't match the declared hash. Either HF rotated the file (update `sha256` in `MODELS`) or the transfer was corrupted — retry the download. |
| `SharedArrayBuffer is not defined` | The COOP/COEP headers in `vite.config.ts` should fix this in dev/preview. For production, see the deployment section above. |
| Generation is very slow | Use the E2B model. Larger context (`maxNumTokens`) makes every turn slower. |
| Download keeps stalling | Check the network panel — HuggingFace sometimes rate-limits unauthenticated downloads. Refresh and retry. |
| `Storage: Cache API` and I want cross-origin dedup | Install the [Cross-Origin Storage extension](#install-cross-origin-storage-extension) and reload. The status bar will switch to green. |

## Experiments to try next

- Adjust `mainExecutorSettings.maxNumTokens` in `src/services/chat.ts`.
- Add markdown rendering for assistant replies.
- Add a streaming latency / tokens-per-second readout in the status bar.
- Plug a tool-calling schema into `preface.tools` once supported.
- Persist conversation history (currently cleared on page reload).

## API reference

The full API surface used here:

- `Engine.create({ model, mainExecutorSettings: { maxNumTokens } })`
- `engine.createConversation({ preface: { messages: [{ role: 'system', content }] }, enableConstrainedDecoding, preface: { tools: [...] } })`
- `conversation.sendMessageStreaming(text)` → `ReadableStream<Message>`
- `conversation.sendMessage(text)` → `Promise<Message>` (constrained path)
- `conversation.cancel()`
- `engine.delete()`

See <https://developers.google.com/edge/litert-lm/js> for the latest.

## License

QuranLM is released under the MIT License. Model weights remain under their
respective upstream licenses (Gemma Terms of Use for the bundled Gemma
builds).