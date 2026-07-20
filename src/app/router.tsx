import { createBrowserRouter } from 'react-router-dom';
import { PageShell } from '../components/layout/PageShell';
import { Chat } from '../pages/Chat';
import { Settings } from '../pages/Settings';

export const router = createBrowserRouter([
  {
    element: <PageShell />,
    children: [
      { index: true, element: <Chat /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
