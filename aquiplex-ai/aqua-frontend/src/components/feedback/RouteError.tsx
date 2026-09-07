import { Compass, RotateCcw } from 'lucide-react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/**
 * Router-level fallbacks.
 *
 * The router had neither an errorElement nor a catch-all, so an unknown URL or
 * a thrown route error dropped the user onto React Router's built-in developer
 * page — stack trace, no styling, no way back. In production.
 *
 * `RouteError` is the root errorElement and renders standalone, because the
 * thing that failed may be the shell itself. `NotFoundPage` is a normal child
 * route, so a mistyped URL keeps the sidebar and stays navigable.
 *
 * Voice: say what happened and give the way out. No apology, no error codes,
 * no reassurance the user didn't ask for.
 */

function Fallback({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-background px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary">
        <Compass className="h-6 w-6 text-foreground-secondary" />
      </div>
      <div className="space-y-1">
        <h1 className="text-base font-semibold text-foreground">{title}</h1>
        <p className="max-w-sm text-sm leading-relaxed text-foreground-secondary">{body}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
    </div>
  );
}

export function RouteError() {
  const error = useRouteError();

  // A 404 that reaches the errorElement rather than the catch-all — treat it
  // as the same thing the user experienced: a wrong address.
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  if (import.meta.env.DEV) console.error('AQUA route error:', error);

  return (
    <div className="flex h-dvh w-full flex-col bg-background">
      <Fallback
        title="This screen didn’t load"
        body="Reloading usually clears it. Your conversations, files, and everything AQUA remembers are stored on the server, not in this tab."
      >
        <Button onClick={() => window.location.reload()}>
          <RotateCcw className="h-3.5 w-3.5" /> Reload
        </Button>
        <Button variant="outline" onClick={() => { window.location.href = '/aqua/'; }}>
          Back to chat
        </Button>
      </Fallback>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <Fallback
      title="There’s nothing at this address"
      body="The link may be out of date, or the conversation it pointed to was deleted."
    >
      <Button asChild>
        <Link to="/">Back to chat</Link>
      </Button>
    </Fallback>
  );
}