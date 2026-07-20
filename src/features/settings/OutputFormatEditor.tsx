import { useAtom, useAtomValue } from 'jotai';
import { outputFormatJsonAtom, parsedOutputSchemaAtom } from './settings.atoms';

interface Props {
  disabled?: boolean;
}

export function OutputFormatEditor({ disabled = false }: Props) {
  const [json, setJson] = useAtom(outputFormatJsonAtom);
  const parsed = useAtomValue(parsedOutputSchemaAtom);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-text-muted m-0">
        Optional JSON Schema for constrained decoding. Leave empty for free-form.
      </p>
      <textarea
        value={json}
        disabled={disabled}
        onChange={(e) => setJson(e.target.value)}
        rows={10}
        className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-xs font-mono text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      />
      {parsed.state === 'invalid' && (
        <p className="text-[11px] text-error">⚠ {parsed.message}</p>
      )}
      {parsed.state === 'valid' && (
        <p className="text-[11px] text-ok">✓ Valid LiteRT-LM schema — constrained decoding enabled.</p>
      )}
      {parsed.state === 'off' && (
        <p className="text-[11px] text-text-muted">Schema disabled — chat will be free-form.</p>
      )}
    </div>
  );
}