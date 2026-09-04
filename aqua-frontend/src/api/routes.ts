/**
 * Platform routes the SPA has to navigate to by hand.
 *
 * These are NOT react-router routes. The router's basename is /aqua and it only
 * knows about the authenticated app; /login is a server-rendered EJS page that
 * lives outside it, so reaching it is always a full-page navigation.
 *
 * They live here because two places need them and had drifted into separate
 * string literals: the 401 interceptor in client.ts, and logout/switch-account
 * in sessionStore.ts. One rule, one derivation.
 */

/** The platform's authentication entry point — `app.get("/login")` in index.js. */
export const LOGIN_PATH = '/login';

/** Where the authenticated SPA lives — the router's basename. */
export const APP_PATH = '/aqua';

/**
 * The login URL that returns the browser to `to` once authentication succeeds.
 *
 * `?next=` is read by GET /login and kept in the session, so it survives the
 * Google OAuth round trip. The server re-sanitises it — see
 * middleware/redirectTarget.js — so this never has to be trusted.
 */
export function loginWithReturn(to: string = APP_PATH): string {
  return `${LOGIN_PATH}?next=${encodeURIComponent(to)}`;
}
