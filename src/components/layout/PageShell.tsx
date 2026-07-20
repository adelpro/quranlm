import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { StatusBar } from './StatusBar';
import { LoadingOverlay } from './LoadingOverlay';
import { useAppBootstrap } from '../../app/useAppBootstrap';

/**
 * Shared app chrome that wraps every route. Runs the cold-start bootstrap
 * exactly once on first mount via `useAppBootstrap()`. Each route is
 * responsible for its own scrolling layout — Chat fits inside main with
 * its own overflow-hidden column, Settings takes the whole main as a
 * scrollable page.
 */
export function PageShell() {
  useAppBootstrap();

  return (
    <>
      <Header />
      <main className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <Outlet />
      </main>
      <StatusBar />
      <LoadingOverlay />
    </>
  );
}
