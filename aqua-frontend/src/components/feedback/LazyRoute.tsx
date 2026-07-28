import { Suspense } from 'react';

/**
 * Suspense boundary for the destinations outside the conversation. The chat
 * is the product and must never wait on code it doesn't need, so everything
 * else is code-split — and each split gets a fallback that says what is
 * loading rather than a bare spinner.
 *
 * Lives in its own file so router.tsx exports only the router.
 */
export function LazyRoute({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-sm text-foreground-secondary">{label}</div>
      }
    >
      {children}
    </Suspense>
  );
}
