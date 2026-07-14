import { defineConfig } from 'vite';

// SharedArrayBuffer is required by some LiteRT-LM builds; the COOP/COEP
// pair is the only reliable way to make it available in the browser.
const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export default defineConfig({
  server: { headers: crossOriginHeaders },
  preview: { headers: crossOriginHeaders },
});