/**
 * Platform account surface — account details + permanent deletion.
 *
 * NOTE: like billing.ts, these routes live at /api/account on the PLATFORM,
 * not under the AQUA engine's /api/aqua base — hence plain fetch with
 * same-origin cookies instead of the shared apiClient.
 */

export type AuthMethod = 'password' | 'google';

export interface AccountInfo {
  email: string;
  /** How this account must reauthenticate before deletion. */
  authMethod: AuthMethod;
  /** True when a Google reauthentication is already on the session and still valid. */
  reauthFresh: boolean;
  createdAt?: string;
}

export interface DeleteAccountResult {
  ok: boolean;
  /** Machine-readable failure code (PASSWORD_INCORRECT, REAUTH_REQUIRED, …). */
  error?: string;
  /** Human sentence, safe to render directly. */
  message?: string;
  authMethod?: AuthMethod;
}

const jsonHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };

export async function getAccount(): Promise<AccountInfo | null> {
  try {
    const res = await fetch('/api/account', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null; // logged out / older backend — the tab explains itself
    const body = (await res.json()) as { success?: boolean; account?: AccountInfo };
    return body?.account ?? null;
  } catch {
    return null;
  }
}

/**
 * Permanently delete the signed-in account.
 * @param password required for password accounts; ignored for Google accounts
 *                 (they must complete startGoogleReauth() first).
 */
export async function deleteAccount(password?: string): Promise<DeleteAccountResult> {
  try {
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: jsonHeaders,
      body: JSON.stringify(password ? { password } : {}),
    });

    let body: Partial<DeleteAccountResult> & { success?: boolean } = {};
    try {
      body = await res.json();
    } catch {
      /* empty body — fall through to the status-based message below */
    }

    if (res.ok && body?.success) return { ok: true };

    return {
      ok: false,
      error: body?.error ?? `HTTP_${res.status}`,
      message:
        body?.message ??
        "We couldn't delete your account just now. Please try again, or email support@aquiplex.ai.",
      authMethod: body?.authMethod,
    };
  } catch {
    return {
      ok: false,
      error: 'NETWORK',
      message: "Couldn't reach the server. Check your connection and try again.",
    };
  }
}

/**
 * Send a Google-signed-up user through a fresh OAuth round trip. This is a
 * full-page navigation (an OAuth consent screen can't run in an XHR); the
 * platform returns the browser to `returnTo` with ?deleteReauth=ok, and the
 * Account tab reopens itself and continues.
 */
export function startGoogleReauth(returnTo = '/aqua?settings=account'): void {
  window.location.href = `/auth/google/reauth?next=${encodeURIComponent(returnTo)}`;
}

export interface LogoutResult {
  ok: boolean;
  /** Human sentence, safe to render directly. */
  message?: string;
}

/**
 * End the current session on the SERVER.
 *
 * This is the platform's own mechanism — POST /api/account/logout runs the same
 * req.session.destroy() + clearCookie that GET /logout and the deletion route
 * already run (services/account/sessionLogout.service.js). It is a JSON call
 * rather than a navigation to /logout because the caller has to know whether
 * the session actually died before it claims the user is signed out, and has to
 * tear down client state BEFORE the page goes away.
 *
 * A missing or already-expired session is a SUCCESS: the desired end state is
 * "not signed in", and it is already true. Only a server that could not destroy
 * a live session, or an unreachable server, is a failure.
 */
export async function logoutSession(): Promise<LogoutResult> {
  try {
    const res = await fetch('/api/account/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: jsonHeaders,
      cache: 'no-store',
    });

    if (res.ok) return { ok: true };

    let body: { message?: string } = {};
    try { body = await res.json(); } catch { /* empty body */ }

    return {
      ok: false,
      message: body.message ?? "We couldn't sign you out just now. Please try again.",
    };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach the server. Check your connection and try again.",
    };
  }
}

/**
 * Remove everything about the signed-in account that this device wrote to disk:
 * the persisted zustand stores ('aqua-ui', 'aqua-settings',
 * 'aqua-conversation-overlay') and every sessionStorage marker.
 *
 * THIS IS THE WHOLE TEARDOWN FOR A LOGOUT, and deliberately no more. The
 * service worker caches hashed static assets and Google Fonts only — there is
 * no runtimeCaching rule for /api, so no response containing user data is ever
 * stored there. src/test/sessionIsolation.test.ts asserts that against
 * vite.config.ts, so if an API caching rule is ever added, that test fails and
 * whoever adds it has to extend this function.
 *
 * Best-effort throughout: a browser that blocks storage must never block the
 * redirect to /login.
 */
export function clearPersistedAppData(): void {
  try { localStorage.clear(); } catch { /* storage disabled */ }
  try { sessionStorage.clear(); } catch { /* storage disabled */ }
}

/**
 * Everything clearPersistedAppData() does, plus the PWA's cached shell and its
 * service worker.
 *
 * The extra two steps exist for ACCOUNT DELETION, where the account is gone and
 * leaving an installed app pointing at it is wrong. They are not part of logout:
 * unregistering the worker throws away the precached shell and makes the next
 * sign-in slower for no isolation benefit.
 */
export async function clearLocalAppData(): Promise<void> {
  clearPersistedAppData();

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* cache API unavailable */ }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* SW unavailable */ }
}
