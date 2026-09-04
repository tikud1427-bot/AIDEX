"use strict";
/**
 * AQUIPLEX platform — where a user lands after authenticating.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN index.js
 * ---------------------------------------------------
 * `startServer()` awaits a live Mongo connection before it listens, so index.js
 * cannot be required in a test process (the reasoning is spelled out at the top
 * of tests/platform/launchSafety.test.js). middleware/csrf.js established the
 * answer: put the decision somewhere pure, test the decision for real, and
 * assert the wiring statically. This is the same shape.
 *
 * WHAT IT IS FOR
 * --------------
 * "Switch account" in the AQUA sidebar ends the current session and sends the
 * browser to /login?next=/aqua. Without a next, POST /login always lands on
 * /home — so switching accounts dumped the user on the workspace dashboard and
 * made them find their way back to the product they were already using.
 *
 * The intent is carried in the SESSION, not through the login form. That is
 * deliberate: the Google round trip leaves our origin entirely, and threading a
 * query parameter through views/login.ejs, the form action and the OAuth
 * consent URL would touch three surfaces to achieve what one session key does.
 *
 * SECURITY: THIS IS AN OPEN-REDIRECT SURFACE
 * ------------------------------------------
 * Anything reaching res.redirect() from user input is one. Only a same-origin
 * ABSOLUTE PATH is ever returned; everything else collapses to the fallback:
 *
 *   //evil.com          protocol-relative — a full cross-origin navigation
 *   /\evil.com          browsers normalise the backslash to `/`, so this is
 *                       protocol-relative too. safeReauthNext() (index.js) did
 *                       NOT cover this case; it now delegates here rather than
 *                       leaving two sanitisers that disagree about the same
 *                       question — the silent disagreement is the dangerous one.
 *   https://evil.com    absolute
 *   evil.com            relative — resolves against the current directory
 *   /home\n...          header splitting
 */

/** Session key holding the path to return to once authentication succeeds. */
const POST_LOGIN_NEXT_KEY = "postLoginNext";

/** Redirect targets a caller may not override, whatever `next` says. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Reduce an untrusted `next` to a safe same-origin path.
 *
 * @param {unknown} next     candidate, usually req.query.next
 * @param {string}  fallback used whenever `next` is not a safe local path
 * @returns {string} an absolute path beginning with a single "/"
 */
function safeNextPath(next, fallback = "/home") {
  if (typeof next !== "string") return fallback;
  if (next.length === 0 || next.length > 512) return fallback;
  if (CONTROL_CHARS.test(next)) return fallback;

  // Must be an absolute path on THIS origin.
  if (next[0] !== "/") return fallback;
  // "//host" and "/\host" both navigate off-origin once the browser is done
  // normalising them.
  if (next[1] === "/" || next[1] === "\\") return fallback;

  return next;
}

/**
 * Remember where to return after authentication. Writing to the session is
 * what makes express-session persist it for an anonymous visitor
 * (saveUninitialized is false), so no extra save() is needed here.
 */
function rememberPostLoginNext(req, next, fallback = "/home") {
  if (!req || !req.session) return null;
  if (next === undefined || next === null || next === "") return null;
  const target = safeNextPath(next, fallback);
  req.session[POST_LOGIN_NEXT_KEY] = target;
  return target;
}

/**
 * Read and CONSUME the remembered target. Single-use on purpose: a stale
 * target must not silently redirect a later, unrelated login.
 *
 * Re-sanitises on the way out. The value was sanitised on the way in, but a
 * session store is persistent shared state and this costs nothing.
 */
function takePostLoginNext(req, fallback = "/home") {
  if (!req || !req.session) return fallback;
  const raw = req.session[POST_LOGIN_NEXT_KEY];
  delete req.session[POST_LOGIN_NEXT_KEY];
  return safeNextPath(raw, fallback);
}

module.exports = {
  POST_LOGIN_NEXT_KEY,
  safeNextPath,
  rememberPostLoginNext,
  takePostLoginNext,
};
