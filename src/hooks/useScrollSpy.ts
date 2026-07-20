import { useEffect, useState } from 'react';

/**
 * Returns the id of the section most prominently in view, picked via
 * `IntersectionObserver`. Designed for in-page anchor navigation: the
 * caller passes the section ids it cares about and renders the active
 * one differently. Re-evaluates whenever the observer fires; no scroll
 * listener, no layout thrash.
 */
export function useScrollSpy(
  ids: string[],
  options?: { rootMargin?: string },
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Serialize ids into a stable key so the effect re-runs only when the
  // list itself changes — passing a fresh array on every render would
  // tear down and recreate the observer unnecessarily.
  const idsKey = ids.join('|');

  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Among the entries that just became visible, prefer the one with
        // the largest intersection ratio. If multiple become visible at
        // once, the most prominent one wins.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const next = visible[0]?.target.id;
        if (next) {
          setActiveId((current) => (current === next ? current : next));
        }
      },
      {
        // Bias toward the top of the viewport: a section is "active" once
        // it has crossed 30% from the top and before it has dropped below
        // 50% from the bottom. This makes the active section feel like it
        // tracks the viewport's upper-middle rather than its bottom.
        rootMargin: options?.rootMargin ?? '-30% 0px -50% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, options?.rootMargin]);

  return activeId;
}
