import { Provider } from 'jotai';
import { appStore } from './app/store';
import { AppShell } from './app/AppShell';

/**
 * The Provider MUST wrap everything that uses Jotai atoms — including
 * `useAppBootstrap`. If `useAppBootstrap` is called outside the Provider,
 * its `useSetAtom(engineLifecycleAtom)` writes to Jotai's DEFAULT store
 * while the components inside read from `appStore`, and the two never
 * see each other (the classic "engine loaded but UI says idle" bug).
 */
export function App() {
  return (
    <Provider store={appStore}>
      <AppShell />
    </Provider>
  );
}