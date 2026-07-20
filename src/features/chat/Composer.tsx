import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useAtomValue } from 'jotai';
import { chatPhaseAtom, chatBusyAtom } from './chat.atoms';
import { engineReadyAtom } from '../../app/engine.atoms';
import { Button } from '../../components/ui/Button';
import { useChat } from './useChat';

export function Composer() {
  const ready = useAtomValue(engineReadyAtom);
  const busy = useAtomValue(chatBusyAtom);
  const phase = useAtomValue(chatPhaseAtom);
  const { send, cancel } = useChat();
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea up to a max height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    await send(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Submit on Enter, allow newline on Shift+Enter. Respect IME composition.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  }

  const placeholder = !ready
    ? 'Load a model in Settings to start chatting…'
    : busy
      ? phase === 'cancelling'
        ? 'Cancelling…'
        : 'Streaming… (press Esc to cancel)'
      : 'Type a message…';

  return (
    <div className="flex items-end gap-2 border-t border-border bg-surface py-3">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={!ready || busy}
        rows={1}
        className="flex-1 resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
      />
      {busy ? (
        <Button variant="danger" size="md" onClick={cancel}>
          Cancel
        </Button>
      ) : (
        <Button variant="primary" size="md" onClick={onSend} disabled={!ready || !draft.trim()}>
          Send
        </Button>
      )}
    </div>
  );
}