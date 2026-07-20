import { useAtom, useAtomValue } from 'jotai';
import { listModels, type ModelEntry } from '../../data/models';
import { selectedModelIdRWAtom, modelStatusesAtom, type ModelStatus } from './model.atoms';

interface Props {
  disabled?: boolean;
}

const statusLabel: Record<ModelStatus, string> = {
  unknown: '—',
  missing: 'not cached',
  cached: 'cached',
  downloading: 'downloading…',
  error: 'error',
};

export function ModelPicker({ disabled = false }: Props) {
  const models = listModels();
  const [selected, setSelected] = useAtom(selectedModelIdRWAtom);
  const statuses = useAtomValue(modelStatusesAtom);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-text-secondary">Model</label>
      <select
        value={selected}
        disabled={disabled}
        onChange={(e) => setSelected(e.target.value as typeof selected)}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        {models.map((m: ModelEntry) => (
          <option key={m.id} value={m.id}>
            {m.label} · {m.sublabel} · {statusLabel[statuses[m.id] ?? 'unknown']}
          </option>
        ))}
      </select>
    </div>
  );
}