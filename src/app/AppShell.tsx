import { useAppBootstrap } from './useAppBootstrap';
import { Header } from '../components/layout/Header';
import { StatusBar } from '../components/layout/StatusBar';
import { SettingsPanel } from '../components/layout/SettingsPanel';
import { LoadingOverlay } from '../components/layout/LoadingOverlay';
import { MessageList } from '../features/chat/MessageList';
import { Composer } from '../features/chat/Composer';

/**
 * Lives INSIDE the Jotai Provider so all `useSetAtom` / `useAtomValue` calls
 * resolve to `appStore`. See `App.tsx` for the rationale.
 */
export function AppShell() {
  useAppBootstrap();

  return (
    <>
      <Header />
      <main className="flex flex-1 flex-col overflow-hidden">
        <MessageList />
        <Composer />
      </main>
      <StatusBar />
      <SettingsPanel />
      <LoadingOverlay />
    </>
  );
}