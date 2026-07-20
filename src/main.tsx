import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// NOTE: React.StrictMode is currently DISABLED in dev — the dev-mode
// mount/unmount cycle would create and tear down a multi-GB, non-abortable
// WebGPU engine twice on every page load. See the migration plan §8 for
// the full rationale. Re-enable once the engine lifecycle is proven
// idempotent.
const useStrict = false;

const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('Missing #app root element');
const root = createRoot(rootEl);
root.render(useStrict ? <StrictMode><App /></StrictMode> : <App />);