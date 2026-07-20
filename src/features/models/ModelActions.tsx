import { useSetAtom, useAtomValue } from 'jotai';
import { Button } from '../../components/ui/Button';
import {
  modelStatusesAtom,
  selectedModelIdRWAtom,
  modelOperationIdAtom,
} from './model.atoms';
import { engineLifecycleAtom } from '../../app/engine.atoms';
import { deleteCached } from '../../services/models';
import { useDownload } from './useDownload';
import { appStore } from '../../app/store';
import type { ModelId } from '../../data/models';

interface Props {
  disabled?: boolean;
}

export function ModelActions({ disabled = false }: Props) {
  const modelId = useAtomValue(selectedModelIdRWAtom);
  const statuses = useAtomValue(modelStatusesAtom);
  const lifecycle = useAtomValue(engineLifecycleAtom);
  const setOpId = useSetAtom(modelOperationIdAtom);
  const { download, cancelDownload } = useDownload();

  async function onDownload() {
    setOpId((id) => id + 1);
    try {
      await download(modelId);
    } catch {
      // Errors are surfaced via downloadProgressAtom; nothing else to do.
    }
  }

  async function onDelete() {
    if (!confirm(`Delete cached copy of ${modelId}? You'll need to re-download to chat.`)) return;
    await deleteCached(modelId);
    // Refresh status.
    appStore.set(modelStatusesAtom, { ...appStore.get(modelStatusesAtom), [modelId]: 'missing' });
    if (lifecycle.phase === 'ready' && lifecycle.modelId === modelId) {
      // Tear down engine so the user is forced to re-load.
      appStore.set(engineLifecycleAtom, { phase: 'idle' });
    }
  }

  const status = statuses[modelId] ?? 'unknown';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'cached' && status !== 'downloading' && (
        <Button variant="primary" size="sm" onClick={onDownload} disabled={disabled}>
          Download {modelId}
        </Button>
      )}
      {status === 'downloading' && (
        <Button variant="danger" size="sm" onClick={() => cancelDownload(modelId as ModelId)}>
          Cancel download
        </Button>
      )}
      {status === 'cached' && (
        <Button variant="secondary" size="sm" onClick={onDelete} disabled={disabled}>
          Delete cache
        </Button>
      )}
    </div>
  );
}