import { memo } from 'react';
import type { SourceState } from '../chat/chat.types';
import { SourceGroup } from './SourceGroup';

interface Props {
  sources: SourceState;
}

function SourceListImpl({ sources }: Props) {
  if (sources.status === 'idle') return null;

  let title: string;
  let body: React.ReactNode;

  if (sources.status === 'loading') {
    title = `Looking up ${sources.terms.length} term${sources.terms.length === 1 ? '' : 's'}…`;
    body = (
      <ul className="m-0 list-none p-0 text-[11px] text-text-muted">
        {sources.terms.map((t) => (
          <li key={t} className="truncate">
            · {t}
          </li>
        ))}
      </ul>
    );
  } else if (sources.status === 'parse-error') {
    title = 'JSON parse failed — raw reply:';
    body = (
      <pre className="m-0 mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-[11px] text-text-secondary">
        {sources.rawText}
      </pre>
    );
  } else {
    const ok = sources.entries.filter((e) => e.result.ok);
    const total = ok.reduce((sum, e) => sum + (e.result.ok ? e.result.total : 0), 0);
    title =
      total === 0
        ? `Sources · no matches for ${sources.entries.length} term${sources.entries.length === 1 ? '' : 's'}`
        : `Sources · ${total} verse${total === 1 ? '' : 's'} across ${ok.length} term${ok.length === 1 ? '' : 's'}`;
    body = (
      <ul className="m-0 list-none p-0">
        {sources.entries.map((e) => (
          <SourceGroup key={e.term} entry={e} />
        ))}
      </ul>
    );
  }

  return (
    <section className="mt-1.5 w-full max-w-[85%] rounded-md border border-border bg-surface-2 p-2.5">
      <h4 className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h4>
      {body}
    </section>
  );
}

export const SourceList = memo(SourceListImpl);