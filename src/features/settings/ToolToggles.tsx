import { useAtom } from 'jotai';
import { toolsEnabledAtom } from './settings.atoms';
import { Toggle } from '../../components/ui/Toggle';

interface Props {
  disabled?: boolean;
}

export function ToolToggles({ disabled = false }: Props) {
  const [tools, setTools] = useAtom(toolsEnabledAtom);
  return (
    <div className="flex flex-col gap-2">
      <Toggle
        checked={tools.quranSearch}
        onChange={(v) => setTools({ ...tools, quranSearch: v })}
        label="Auto-search Quran for related terms after each assistant reply"
        disabled={disabled}
      />
      <p className="text-[11px] text-text-muted m-0">
        When enabled, structured JSON replies with `related_words[]` are searched against the in-browser Quran corpus.
      </p>
    </div>
  );
}