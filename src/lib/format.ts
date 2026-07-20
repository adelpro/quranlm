// ─── Display formatters ────────────────────────────────────────────────
// Shared helpers for byte counts and durations in the UI.

/**
 * Format a byte count as a human-readable string (e.g. "1.48 GB", "47 MB").
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '?';
  const mb = n / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

/**
 * Format a remaining-time estimate for download ETA display.
 * Returns '' when the value is not usable (unknown total, zero speed, etc.)
 * so callers can append the result unconditionally and hide it cleanly.
 */
export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 1) return '<1 sec left';

  if (seconds < 60) {
    return `~${Math.round(seconds)} sec left`;
  }

  const totalMin = seconds / 60;
  if (totalMin < 60) {
    return `~${Math.round(totalMin)} min left`;
  }

  const hours = Math.floor(totalMin / 60);
  const mins = Math.round(totalMin - hours * 60);
  return mins === 0 ? `~${hours} hr left` : `~${hours} hr ${mins} min left`;
}