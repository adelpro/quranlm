import { useAtomValue } from 'jotai';
import { downloadProgressAtom } from './model.atoms';
import { formatBytes, formatEta } from '../../lib/format';
import { Button } from '../../components/ui/Button';
import { useDownload } from './useDownload';
import { selectedModelIdRWAtom } from './model.atoms';

export function DownloadProgress() {
  const dl = useAtomValue(downloadProgressAtom);
  const selected = useAtomValue(selectedModelIdRWAtom);
  const { cancelDownload } = useDownload();
  if (!dl) return null;

  const percent =
    dl.total && dl.total > 0
      ? Math.min(100, Math.round((dl.downloaded / dl.total) * 100))
      : null;
  const speedMB = dl.speedBps > 0 ? (dl.speedBps / 1024 / 1024).toFixed(2) : null;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 p-2.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium text-text">
          {dl.phase === 'fetching' && 'Downloading…'}
          {dl.phase === 'verifying' && 'Verifying SHA-256…'}
          {dl.phase === 'storing' && 'Storing…'}
          {dl.phase === 'done' && 'Done'}
          {dl.phase === 'error' && `Error — ${dl.error ?? 'unknown'}`}
          {dl.phase === 'cancelled' && 'Cancelled'}
        </span>
        {(dl.phase === 'fetching' || dl.phase === 'verifying' || dl.phase === 'storing') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => cancelDownload(selected)}
            aria-label="Cancel download"
          >
            ✕
          </Button>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-surface-3">
        <div
          className={`h-full transition-all ${
            dl.phase === 'error'
              ? 'bg-error'
              : dl.phase === 'done'
                ? 'bg-ok'
                : 'bg-accent'
          }`}
          style={{ width: `${percent ?? 4}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-text-muted">
        <span>
          {formatBytes(dl.downloaded)}
          {dl.total ? ` / ${formatBytes(dl.total)}` : ''}
          {percent !== null && ` · ${percent}%`}
        </span>
        <span>
          {speedMB && `${speedMB} MB/s`}
          {dl.etaS !== undefined && ` · ${formatEta(dl.etaS)}`}
        </span>
      </div>
    </div>
  );
}