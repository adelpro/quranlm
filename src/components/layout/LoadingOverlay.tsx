import { useAtom, useAtomValue } from 'jotai';
import { loadingStepsAtom, loadingOverlayVisibleAtom } from '../../features/loading/loading.atoms';
import { engineLifecycleAtom } from '../../app/engine.atoms';
import { Button } from '../ui/Button';

export function LoadingOverlay() {
  const steps = useAtomValue(loadingStepsAtom);
  const [visible, setVisible] = useAtom(loadingOverlayVisibleAtom);
  const lifecycle = useAtomValue(engineLifecycleAtom);

  // Auto-show whenever we re-enter the loading sequence (model switch).
  // The bootstrap is responsible for the initial show; this effect handles
  // later model switches via the picker.
  // (We don't auto-hide here — the bootstrap controls that on success.)

  if (!visible) return null;

  const allDone = steps.every((s) => s.phase === 'complete');
  const hasError = steps.some((s) => s.phase === 'error') || lifecycle.phase === 'error';

  let title = 'Starting up…';
  let subtitle = 'Each step below runs once on first load.';
  if (hasError) {
    title = 'Something went wrong';
    subtitle =
      lifecycle.phase === 'error' && 'message' in lifecycle
        ? lifecycle.message
        : 'See the failed step below for details.';
  } else if (allDone) {
    title = 'Ready';
    subtitle = 'Engine loaded — you can close this panel.';
  }

  return (
    <div
      role="status"
      aria-label="Loading"
      className="absolute inset-0 z-20 flex items-center justify-center bg-bg/85 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="mb-1 text-base font-semibold text-text m-0">{title}</h2>
            <p className="mb-4 text-xs text-text-secondary m-0">{subtitle}</p>
          </div>
          {allDone && (
            <Button variant="secondary" size="sm" onClick={() => setVisible(false)}>
              Close
            </Button>
          )}
        </div>
        <ol className="flex flex-col gap-2">
          {steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <Dot phase={s.phase} />
              <span className={s.phase === 'pending' ? 'text-text-muted' : 'text-text'}>
                {s.label}
              </span>
              {s.detail && (
                <span className="ml-auto text-[11px] text-text-muted truncate max-w-[60%]">
                  {s.detail}
                </span>
              )}
            </li>
          ))}
        </ol>
        {hasError && (
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => setVisible(false)}>
              Dismiss
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ phase }: { phase: 'pending' | 'active' | 'complete' | 'error' }) {
  if (phase === 'complete') {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ok text-white text-[10px]">
        ✓
      </span>
    );
  }
  if (phase === 'error') {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-error text-white text-[10px]">
        ✕
      </span>
    );
  }
  if (phase === 'active') {
    return (
      <span className="block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    );
  }
  return <span className="block h-4 w-4 rounded-full bg-surface-3" />;
}