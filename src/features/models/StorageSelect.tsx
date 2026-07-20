import { useAtom, useAtomValue } from 'jotai';
import { preferredStorageAtom, effectiveStorageAtom } from './model.atoms';
import { isCrossOriginStorageAvailable } from '../../services/cross-origin-storage';

interface Props {
  disabled?: boolean;
}

export function StorageSelect({ disabled = false }: Props) {
  const [pref, setPref] = useAtom(preferredStorageAtom);
  const effective = useAtomValue(effectiveStorageAtom);
  const cosAvailable = isCrossOriginStorageAvailable();

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-text-secondary">Storage</label>
      <select
        value={pref}
        disabled={disabled}
        onChange={(e) => setPref(e.target.value as typeof pref)}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        <option value="cache">Cache API</option>
        <option value="cross-origin" disabled={!cosAvailable}>
          Cross-Origin Storage{!cosAvailable ? ' (not available)' : ''}
        </option>
      </select>
      <p className="text-[11px] text-text-muted">
        Active: <span className="font-medium text-text">{effective}</span>
      </p>
    </div>
  );
}