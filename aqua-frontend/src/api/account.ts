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


/**
 * End the current server-side session.
 *
 * Logout is intentionally idempotent: an already-expired session is still a
 * successful logout from the user's point of view. The endpoint is also
 * deliberately unauthenticated so an expired session can always be cleaned up.
 */
export interface LogoutSessionResult {
  ok: boolean;
  message?: string;
}

export async function logoutSession(): Promise<LogoutSessionResult> {
  try {
    const res = await fetch('/api/account/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    let body: { success?: boolean; message?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* empty/non-JSON body — fall through to the status */
    }

    if (res.ok && body?.success !== false) return { ok: true };

    return {
      ok: false,
      message: body?.message ?? "We couldn't sign you out. Please try again.",
    };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach the server. Check your connection and try again.",
    };
  }
}

/**
 * Remove client-side state that can belong to the signed-in account.
 *
 * Keep this synchronous because signOut deliberately performs the teardown
 * before navigating. The persisted Zustand stores and the small session-scoped
 * UI markers are all browser storage; the in-memory stores are reset separately
 * by resetAllStores().
 */
export function clearPersistedAppData(): void {
  try { localStorage.clear(); } catch { /* storage disabled */ }
  try { sessionStorage.clear(); } catch { /* storage disabled */ }
}

/**
 * Wipe every trace of the account from THIS device after a successful
 * deletion: persisted zustand stores ('aqua-ui', 'aqua-settings',
 * 'aqua-conversation-overlay'), any session state, the PWA's cached shell,
 * and its service worker. Everything is best-effort — a browser that blocks
 * one of these must never block the redirect to /login.
 */
export async function clearLocalAppData(): Promise<void> {
  try { localStorage.clear(); } catch { /* storage disabled */ }
  try { sessionStorage.clear(); } catch { /* storage disabled */ }

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
