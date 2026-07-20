import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScrollSpy } from '../../hooks/useScrollSpy';

const SECTIONS = [
  { id: 'models', label: 'Models' },
  { id: 'prompt', label: 'Prompts' },
  { id: 'output', label: 'Output format' },
  { id: 'tools', label: 'Tools' },
] as const;

/**
 * In-page navigation for the settings page.
 *
 * - On `md+` screens: sticky 220 px vertical rail with a 2 px accent
 *   indicator on the active item.
 * - On small screens: a horizontal, scrollable pill row that lets the
 *   user tap-jump to a section.
 *
 * Active state is driven by `useScrollSpy` so the indicator tracks the
 * section currently centered in the viewport. Clicking a link smooths-
 * scrolls to its anchor and updates the URL hash without a navigation.
 */
export function SettingsNav() {
  const navigate = useNavigate();
  const activeId = useScrollSpy(SECTIONS.map((s) => s.id));

  function go(e: MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Reflect the active anchor in the URL without triggering a route
    // change — `replace: true` keeps the back stack clean.
    navigate(`#${id}`, { replace: true });
  }

  return (
    <nav
      aria-label="Settings sections"
      className="shrink-0 md:sticky md:top-6 md:w-56 md:self-start"
    >
      <div className="flex flex-row gap-1 overflow-x-auto pb-2 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mb-2 hidden shrink-0 rounded-md px-2 py-1.5 text-left text-xs font-medium text-text-secondary transition-colors hover:text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent md:inline-flex"
        >
          ← Back to chat
        </button>
        {SECTIONS.map((s) => {
          const isActive = activeId === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => go(e, s.id)}
              aria-current={isActive ? 'true' : undefined}
              className={`relative inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-accent md:rounded-none md:py-2 md:pl-4 ${
                isActive
                  ? 'font-medium text-text'
                  : 'text-text-secondary hover:text-text'
              }`}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/2 hidden h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent md:block"
                />
              )}
              {s.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
