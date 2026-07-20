import type { ReactNode } from 'react';

interface Props {
  /** Section anchor — both the nav link target and the scroll-spy id. */
  id: string;
  /** Position in the page (0, 1, 2, …) used to stagger the entrance animation. */
  index: number;
  /** Card heading, e.g. "Model". */
  title: string;
  /** Optional 1-line description shown below the title in muted small text. */
  description?: string;
  children: ReactNode;
}

/**
 * One settings group. Renders as a white card with a thin border,
 * a header (title + optional description), and a gap-4 vertical stack
 * for the existing widgets. The `--i` CSS variable drives the
 * `card-reveal` keyframe delay so the four cards fade in one after
 * the other on first mount.
 */
export function SettingsCard({ id, index, title, description, children }: Props) {
  return (
    <section
      id={id}
      className="card-reveal rounded-lg border border-border bg-surface p-6 md:p-8"
      style={{ ['--i' as string]: index }}
    >
      <header className="mb-5">
        <h2 className="m-0 text-lg font-semibold tracking-tight text-text">{title}</h2>
        {description && (
          <p className="mt-1.5 m-0 text-sm leading-relaxed text-text-secondary">
            {description}
          </p>
        )}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
