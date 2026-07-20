import { memo, useState } from 'react';
import type { QuranSearchResult } from '../../services/quran-search';

interface Entry {
  term: string;
  result: QuranSearchResult;
}

interface Props {
  entry: Entry;
}

function SourceGroupImpl({ entry }: Props) {
  const [open, setOpen] = useState(true);
  const { term, result } = entry;

  if (!result.ok) {
    return (
      <li className="border-t border-border py-1.5 first:border-t-0">
        <span className="text-[11px] text-error">⚠ {term}: {result.error}</span>
      </li>
    );
  }

  return (
    <li className="border-t border-border py-1.5 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="text-[11px] font-medium text-text">{term}</span>
        <span className="text-[11px] text-text-muted">
          {result.total} {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <ul className="mt-1 list-none p-0">
          {result.results.length === 0 && (
            <li className="text-[11px] text-text-muted">(no matching verses)</li>
          )}
          {result.results.map((v) => (
            <li key={`${v.sura_id}:${v.aya_id}`} className="border-t border-border/50 py-1.5 first:border-t-0">
              <div className="text-[10px] uppercase tracking-wide text-text-muted">
                {v.reference}
              </div>
              <div className="arabic mt-0.5 text-base text-text">{v.uthmani}</div>
              {v.standard && v.standard !== v.uthmani && (
                <div className="mt-0.5 text-[11px] text-text-secondary">{v.standard}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export const SourceGroup = memo(SourceGroupImpl);