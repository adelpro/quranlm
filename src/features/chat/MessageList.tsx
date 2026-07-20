import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { messagesAtom } from './chat.atoms';
import { Message } from './Message';
import { StreamingMessage } from './StreamingMessage';

export function MessageList() {
  const messages = useAtomValue(messagesAtom);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto py-3"
    >
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center text-text-muted text-sm">
          Ask anything — pick a model in Settings to start.
        </div>
      )}
      <div className="flex flex-col gap-3">
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        <StreamingMessage />
      </div>
    </div>
  );
}