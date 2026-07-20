import { Provider } from 'jotai';
import { RouterProvider } from 'react-router-dom';
import { appStore } from './app/store';
import { router } from './app/router';

/**
 * Composition order matters: the Jotai Provider MUST wrap everything
 * that reads or writes atoms — including every route under
 * `RouterProvider` and `useAppBootstrap()` invoked from the route
 * tree. If `useSetAtom` outside the Provider writes to Jotai's
 * DEFAULT store while the components inside read from `appStore`,
 * the two never see each other (the classic "engine loaded but UI
 * says idle" bug).
 */
export function App() {
  return (
    <Provider store={appStore}>
      <RouterProvider router={router} />
    </Provider>
  );
}
