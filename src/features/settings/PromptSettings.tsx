import { useAtom } from 'jotai';
import { systemPromptIdAtom, systemPromptTextAtom } from './settings.atoms';
import { getPrompt, listPrompts } from '../../data/prompts';
import { useEffect } from 'react';

interface Props {
  disabled?: boolean;
}

export function PromptSettings({ disabled = false }: Props) {
  const [promptId, setPromptId] = useAtom(systemPromptIdAtom);
  const [text, setText] = useAtom(systemPromptTextAtom);
  const prompts = listPrompts();

  // Sync preset selection into text when the user picks a preset (but not
  // on every render — only when promptId actually changes from a user click).
  useEffect(() => {
    if (promptId !== 'custom') {
      const preset = getPrompt(promptId);
      if (preset) {
        // Only overwrite if the user hasn't heavily diverged — but the
        // simplest contract is: picking a preset always loads its text.
        setText(preset.text);
      }
    }
  }, [promptId, setText]);

  return (
    <div className="flex flex-col gap-2">
      <select
        value={promptId}
        disabled={disabled}
        onChange={(e) => setPromptId(e.target.value as typeof promptId)}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        {prompts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <textarea
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-xs font-mono text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        placeholder="System prompt — leave empty for free-form chat."
      />
    </div>
  );
}