import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { Root } from '@/Root';
import { ChatPage } from '@/pages/ChatPage';
import { PrivacyPolicyPage } from '@/pages/PrivacyPolicyPage';
import { NotFoundPage, RouteError } from '@/components/feedback/RouteError';
import { LazyRoute } from '@/components/feedback/LazyRoute';

const MindPage = lazy(() => import('@/pages/MindPage'));
const ProjectsPage = lazy(() => import('@/pages/ProjectsPage'));
const MemoryPage = lazy(() => import('@/pages/MemoryPage'));


export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Root />,
      // Without this, any thrown route error renders React Router's built-in
      // developer page — unstyled, with a stack trace and no way back.
      errorElement: <RouteError />,
      children: [
        { index: true, element: <ChatPage /> },
        { path: 'c/:conversationId', element: <ChatPage /> },

        {
          path: 'projects',
          element: <LazyRoute label="Looking for your projects…"><ProjectsPage /></LazyRoute>,
        },
        {
          path: 'memory',
          element: <LazyRoute label="Reading what AQUA remembers…"><MemoryPage /></LazyRoute>,
        },
        {
          path: 'mind',
          element: <LazyRoute label="Opening the mind…"><MindPage /></LazyRoute>,
        },

        {
          path: 'privacy',
          element: <PrivacyPolicyPage />,
        },

        // Catch-all lives inside the shell on purpose: a mistyped or stale URL
        // should leave the sidebar in place so the next click is obvious.
        {
          path: '*',
          element: <NotFoundPage />,
        },
      ],
    },
  ],
  { basename: '/aqua' }
);