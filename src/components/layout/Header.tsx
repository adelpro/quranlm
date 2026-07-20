import { useAtomValue } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import { selectedModelIdRWAtom } from '../../features/models/model.atoms';
import { MODELS } from '../../data/models';
import { engineLifecycleAtom } from '../../app/engine.atoms';

/**
 * App header. Shows the brand, a model-status pill (always a shortcut
 * to /settings) and a contextual right-side icon:
 *
 *  - On `/`         → gear icon, navigates to `/settings`.
 *  - On `/settings` → back arrow, navigates to `/`.
 *
 * The model-status pill is visible on both routes so the user can always
 * see which model is loaded and jump into settings in one tap.
 */
export function Header() {
  const modelId = useAtomValue(selectedModelIdRWAtom);
  const lifecycle = useAtomValue(engineLifecycleAtom);
  const navigate = useNavigate();
  const location = useLocation();
  const onSettings = location.pathname.startsWith('/settings');

  const modelLabel = MODELS[modelId]?.label ?? modelId;
  const isReady = lifecycle.phase === 'ready';

  return (
    <header className="flex items-center justify-between py-2 shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-text m-0">
          LiteRT-LM
        </h1>
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="cursor-pointer rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-accent hover:bg-surface-3 hover:text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          title="Open settings"
        >
          {modelLabel} {isReady ? '· ready' : '· not loaded'}
        </button>
      </div>
      <div className="flex items-center gap-2">
        {onSettings ? (
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Back to chat"
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label="Open settings"
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
