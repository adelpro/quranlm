import { useAtomValue } from 'jotai';
import { activeStreamAtom, chatPhaseAtom } from './chat.atoms';

/**
 * The ONLY component that subscribes to `activeStreamAtom`. Static messages
 * never re-render at token cadence.
 */
export function StreamingMessage() {
  const stream = useAtomValue(activeStreamAtom);
  const phase = useAtomValue(chatPhaseAtom);

  if (!stream) {
    // Show thinking dots while the request is in flight but no chunks yet.
    if (phase === 'streaming') {
      return (
        <div className="flex items-start">
          <div
            role="status"
            aria-label="Generating response"
            className="rounded-lg border border-border bg-assistant-bg px-3 py-2.5 text-sm text-text-secondary"
          >
            <span className="thinking-dot" style={{ animationDelay: '0ms' }} />
            <span className="thinking-dot" style={{ animationDelay: '150ms' }} />
            <span className="thinking-dot" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="flex items-start">
      <div className="streaming-cursor max-w-[85%] whitespace-pre-wrap break-words rounded-lg border border-border bg-assistant-bg px-3 py-2 text-sm leading-relaxed text-text">
        {stream.content}
      </div>
    </div>
  );
}