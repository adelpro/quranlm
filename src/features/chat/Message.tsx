import { memo } from 'react';
import type { ChatMessage } from './chat.types';
import { SourceList } from '../quran/SourceList';

interface Props {
  message: ChatMessage;
}

function MessageImpl({ message }: Props) {
  const isUser = message.role === 'user';
  const isError = !!message.error;

  return (
    <div
      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
      role="article"
      aria-label={`${message.role} message`}
    >
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-user-bg border-border text-text'
            : isError
              ? 'bg-error/5 border-error/40 text-error'
              : 'bg-assistant-bg border-border text-text'
        }`}
      >
        {message.content}
        {message.cancelled && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-text-muted">
            · cancelled
          </span>
        )}
      </div>
      {!isUser && message.sources && message.sources.status !== 'idle' && (
        <SourceList sources={message.sources} />
      )}
    </div>
  );
}

export const Message = memo(MessageImpl);