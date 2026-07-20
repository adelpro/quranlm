import { MessageList } from '../features/chat/MessageList';
import { Composer } from '../features/chat/Composer';

export function Chat() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <MessageList />
      <Composer />
    </div>
  );
}
