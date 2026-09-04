"use strict";
/**
 * AQUIPLEX platform — ending a signed-in session.
 *
 * THE MECHANISM IS NOT NEW
 * ------------------------
 * Two places already end a session, and both do exactly one thing:
 *
 *   index.js               GET /logout       → req.session.destroy() + clearCookie
 *   account.routes.js      POST /api/account/delete (already-gone branch)
 *                                            → req.session.destroy() + clearCookie
 *
 * This module is that same pair of calls, extracted so a THIRD caller — the
 * JSON endpoint the AQUA SPA needs — cannot drift from it, and so the behaviour
 * can be tested. index.js cannot be required in a test process (it awaits Mongo
 * before it listens; see tests/platform/launchSafety.test.js), so anything that
 * has to be proven has to live outside it. middleware/csrf.js set this pattern.
 *
 * WHY DESTROY AND NOT req.logout()
 * --------------------------------
 * passport stores its subject at `session.passport.user`, inside the very
 * session being destroyed. Once the session record is gone, deserializeUser has
 * nothing to read on any subsequent request, so req.user cannot be repopulated.
 * req.logout() would be a second, weaker mechanism whose signature changed
 * between passport 0.5 (sync) and 0.6 (callback-required) — calling it wrong
 * fails open. Destroy is complete on its own, and it is what the two existing
 * call sites already do.
 *
 * WHY CLEARING THE COOKIE STILL MATTERS AFTER DESTROY
 * ---------------------------------------------------
 * destroy() removes the SERVER-side record; the browser keeps sending the same
 * signed id until it expires. That id no longer authenticates anything, but
 * leaving it set means the next visitor on a shared machine carries a
 * recognisable identifier around. Both existing call sites clear it. So does this.
 */

/**
 * Must match `name:` in the express-session config in index.js.
 * tests/account/sessionLogout.test.js asserts that it does — if the cookie is
 * ever renamed there and not here, logout would leave the old cookie set.
 */
const SESSION_COOKIE_NAME = "aidex_session";

/**
 * End the caller's session.
 *
 * IDEMPOTENT BY DESIGN. A request with no session, an expired session, or a
 * session already destroyed by another tab is not an error: the caller's
 * desired end state is "not signed in", and that is already true. Reporting a
 * failure there would strand the client in a signed-in-looking UI it can never
 * leave — the exact trap this whole feature exists to remove.
 *
 * @param {object} req express request (may or may not carry a session)
 * @param {object} res express response
 * @returns {Promise<{ok: boolean, hadSession: boolean, error?: string}>}
 */
function endSession(req, res) {
  const hadSession = !!(req && req.session && (req.session.userId || req.session.user || req.session.passport));

  const clearCookie = () => {
    // Best effort: a response that has already been sent must not turn a
    // successful logout into a 500.
    try {
      if (res && typeof res.clearCookie === "function") res.clearCookie(SESSION_COOKIE_NAME);
    } catch {
      /* headers already sent — the session is destroyed either way */
    }
  };

  if (!req || !req.session || typeof req.session.destroy !== "function") {
    clearCookie();
    return Promise.resolve({ ok: true, hadSession: false });
  }

  return new Promise((resolve) => {
    req.session.destroy((err) => {
      clearCookie();
      if (err) {
        // A store that could not delete the record means the session may still
        // be usable. Say so — the client must not claim the user is signed out.
        resolve({ ok: false, hadSession, error: err.message || String(err) });
        return;
      }
      resolve({ ok: true, hadSession });
    });
  });
}

module.exports = { endSession, SESSION_COOKIE_NAME };
