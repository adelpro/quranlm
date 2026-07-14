#!/usr/bin/env node
// Stream a Gemma .litertlm model from HuggingFace into public/models/.
// Pure-Node, no dependencies (uses built-in fetch + node:stream/promises).
//
// Usage:
//   node scripts/download-model.mjs                 # E2B (default, smaller)
//   node scripts/download-model.mjs --model=e4b     # E4B (larger, more capable)
//   node scripts/download-model.mjs --force         # re-download even if present
//
// If a URL 404s, verify the exact HuggingFace path and update MODELS below.

import { mkdir, stat, open } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// Editable: the two model URLs. Verify on https://huggingface.co/google
// before relying on them.
// ─────────────────────────────────────────────────────────────────────────────
const MODELS = {
  e2b: {
    url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm',
    filename: 'gemma-4-E2B-it-web.litertlm',
  },
  e4b: {
    url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm',
    filename: 'gemma-4-E4B-it-web.litertlm',
  },
};

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'e2b' },
    force: { type: 'boolean', default: false },
  },
});

const choice = MODELS[values.model];
if (!choice) {
  console.error(`Unknown model "${values.model}". Choose one of: ${Object.keys(MODELS).join(', ')}`);
  process.exit(2);
}

const dest = resolve(ROOT, 'public', 'models', choice.filename);

// ─────────────────────────────────────────────────────────────────────────────

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function fileSize(p) {
  try { return (await stat(p)).size; } catch { return null; }
}

async function headLength(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HEAD ${url} → HTTP ${res.status} ${res.statusText}`);
  }
  const len = res.headers.get('content-length');
  return len ? Number(len) : null;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '? MB';
  const mb = n / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function progressLine(downloaded, total, width = 32) {
  if (!total) return `Downloaded ${formatBytes(downloaded)}`;
  const pct = Math.min(1, downloaded / total);
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `[${bar}] ${(pct * 100).toFixed(1)}%  ${formatBytes(downloaded)} / ${formatBytes(total)}`;
}

async function download() {
  console.log(`Model URL: ${choice.url}`);
  console.log(`Dest:      ${dest}`);

  await mkdir(dirname(dest), { recursive: true });

  const total = await headLength(choice.url);
  if (total == null) {
    console.warn('Warning: server did not return Content-Length; progress will show bytes only.');
  } else {
    console.log(`Total:     ${formatBytes(total)}`);
  }

  if (!values.force && (await exists(dest))) {
    const localSize = await fileSize(dest);
    if (total && localSize === total) {
      console.log(`Already downloaded (${formatBytes(localSize)}). Use --force to re-download.`);
      return;
    }
    if (localSize) {
      console.log(`Existing file is ${formatBytes(localSize)} vs expected ${formatBytes(total ?? 0)}; re-downloading.`);
    }
  }

  const res = await fetch(choice.url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`GET ${choice.url} → HTTP ${res.status} ${res.statusText}`);
  }
  if (!res.body) throw new Error('Response had no body');

  // Track bytes downloaded while streaming to disk.
  let downloaded = 0;
  let lastPrint = Date.now();

  const tap = new Readable({
    read() {},
  });
  const reader = res.body.getReader();
  const pump = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) { tap.push(null); break; }
        downloaded += value.byteLength;
        const now = Date.now();
        if (now - lastPrint > 100) {
          process.stderr.write(`\r${progressLine(downloaded, total)}`);
          lastPrint = now;
        }
        tap.push(Buffer.from(value));
      }
    } catch (err) {
      tap.destroy(err);
    }
  })();

  await pipeline(tap, createWriteStream(dest));
  await pump;

  process.stderr.write('\n');

  const finalSize = await fileSize(dest);
  console.log(`✓ Saved ${formatBytes(finalSize ?? 0)} to ${dest}`);
}

download().catch((err) => {
  process.stderr.write('\n');
  console.error('Download failed:', err?.message ?? err);
  console.error('\nIf the URL 404s, verify the exact HuggingFace path:');
  console.error('  1. Visit https://huggingface.co/litert-community and find the model');
  console.error('  2. Copy the "resolve/main/<file>" URL');
  console.error('  3. Update MODELS at the top of scripts/download-model.mjs');
  process.exit(1);
});