import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { Root } from '@/Root';
import { ChatPage } from '@/pages/ChatPage';
import { PrivacyPolicyPage } from '@/pages/PrivacyPolicyPage';
import { NotFoundPage, RouteError } from '@/components/feedback/RouteError';

const MindPage = lazy(() => import('@/pages/MindPage'));

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
          path: 'mind',
          element: (
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center text-sm text-foreground-secondary">
                  Opening the mind…
                </div>
              }
            >
              <MindPage />
            </Suspense>
          ),
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