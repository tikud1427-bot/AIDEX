"use strict";
/**
 * Logout + switch-account — session teardown and the post-login destination.
 *
 * Run: node --test tests/account/*.test.js   (root package)
 *
 * SPLIT FOR THE SAME REASON tests/platform/csrf.test.js IS SPLIT
 * -------------------------------------------------------------
 * index.js awaits a live Mongo connection before it listens, so the app cannot
 * be stood up in a test process, and stubbing mongoose far enough to boot
 * produces a fake app — green against a fake app is worth less than no result.
 * So the DECISIONS live in pure modules and are tested for real here; that they
 * are MOUNTED, in the right place, is asserted statically against the source.
 *
 * EVERY TEST BELOW FAILS UNDER THE DEFECT IT GUARDS. Where that is not obvious
 * the defect is named in a comment.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { endSession, SESSION_COOKIE_NAME } = require("../../services/account/sessionLogout.service");
const {
  safeNextPath,
  rememberPostLoginNext,
  takePostLoginNext,
  POST_LOGIN_NEXT_KEY,
} = require("../../middleware/redirectTarget");

const ROOT = path.join(__dirname, "..", "..");
const indexSrc = fs.readFileSync(path.join(ROOT, "index.js"), "utf8");
const routesSrc = fs.readFileSync(path.join(ROOT, "routes", "account", "account.routes.js"), "utf8");

// ── Test doubles ─────────────────────────────────────────────────────────────

function fakeRes() {
  const cleared = [];
  return { cleared, clearCookie: (name) => cleared.push(name) };
}

/** A request carrying a destroyable session, like express-session gives us. */
function fakeReq({ signedIn = true, destroyError = null } = {}) {
  const session = {
    destroy(cb) {
      session.destroyed = true;
      cb(destroyError);
    },
    destroyed: false,
  };
  if (signedIn) session.userId = "507f1f77bcf86cd799439011";
  return { session };
}

// ── Session teardown ─────────────────────────────────────────────────────────

describe("endSession — the server side of logout", () => {
  test("destroys the session record", async () => {
    const req = fakeReq();
    const res = await Promise.resolve(fakeRes());
    const out = await endSession(req, res);

    assert.equal(out.ok, true);
    assert.equal(out.hadSession, true);
    // THE defect: a "logout" that clears the cookie and leaves the server-side
    // record alive is client-side-only logout. The session must be gone.
    assert.equal(req.session.destroyed, true);
  });

  test("clears the session cookie the app actually sets", async () => {
    const res = fakeRes();
    await endSession(fakeReq(), res);
    assert.deepEqual(res.cleared, [SESSION_COOKIE_NAME]);
  });

  test("the cookie name matches the one express-session is configured with", () => {
    // Renaming the cookie in index.js without renaming it here would leave the
    // old cookie set on every logout, and nothing else would notice.
    const configured = indexSrc.match(/name:\s*"([^"]+)"/);
    assert.ok(configured, "could not find the session cookie name in index.js");
    assert.equal(SESSION_COOKIE_NAME, configured[1]);
  });

  test("an already-expired session logs out cleanly instead of erroring", async () => {
    // The case the SPA most needs a definitive answer for. A 401 here would
    // strand the client in a signed-in-looking UI it can never leave.
    const req = fakeReq({ signedIn: false });
    const out = await endSession(req, fakeRes());
    assert.equal(out.ok, true);
    assert.equal(out.hadSession, false);
  });

  test("a request with no session at all still succeeds and still clears the cookie", async () => {
    const res = fakeRes();
    const out = await endSession({}, res);
    assert.equal(out.ok, true);
    assert.equal(out.hadSession, false);
    assert.deepEqual(res.cleared, [SESSION_COOKIE_NAME]);
  });

  test("a store that cannot delete the record reports failure — it does not pretend", async () => {
    // Silence beats confident wrong: if the session may still be usable, the
    // client must not tell the user they are signed out.
    const out = await endSession(fakeReq({ destroyError: new Error("store offline") }), fakeRes());
    assert.equal(out.ok, false);
    assert.match(out.error, /store offline/);
  });

  test("logout is exposed on the API surface and is NOT gated on a live session", () => {
    assert.match(routesSrc, /router\.post\(\s*"\/logout"/,
      "POST /api/account/logout must exist for the SPA to call");
    const handler = routesSrc.slice(routesSrc.indexOf('router.post("/logout"'));
    const signature = handler.slice(0, handler.indexOf("{"));
    assert.ok(!signature.includes("requireLogin"),
      "gating logout on requireLogin turns an expired session into a 401 the client cannot act on");
  });
});

// ── Post-login destination ───────────────────────────────────────────────────

describe("safeNextPath — open-redirect containment", () => {
  test("keeps a same-origin absolute path", () => {
    assert.equal(safeNextPath("/aqua"), "/aqua");
    assert.equal(safeNextPath("/aqua?settings=account"), "/aqua?settings=account");
  });

  const HOSTILE = [
    ["protocol-relative", "//evil.com"],
    ["backslash protocol-relative", "/\\evil.com"],
    ["absolute https", "https://evil.com"],
    ["absolute http", "http://evil.com/aqua"],
    ["scheme-ish", "javascript:alert(1)"],
    ["bare relative", "evil.com"],
    ["header splitting", "/home\nLocation: https://evil.com"],
    ["empty", ""],
    ["not a string", 42],
    ["null", null],
  ];

  for (const [label, value] of HOSTILE) {
    test(`falls back rather than following ${label}`, () => {
      assert.equal(safeNextPath(value, "/home"), "/home");
    });
  }

  test("an over-long target is refused", () => {
    assert.equal(safeNextPath("/" + "a".repeat(600), "/home"), "/home");
  });

  test("safeReauthNext delegates here instead of re-deriving the rule", () => {
    // The local copy accepted "/\evil.com". Two sanitisers for one question
    // will disagree eventually, and the silent one is the dangerous one.
    assert.match(indexSrc, /function safeReauthNext\(next\)\s*\{\s*return safeNextPath\(next, "\/aqua"\);\s*\}/);
  });
});

describe("post-login destination — carried in the session", () => {
  test("remembers a sanitised target", () => {
    const req = { session: {} };
    rememberPostLoginNext(req, "/aqua", "/home");
    assert.equal(req.session[POST_LOGIN_NEXT_KEY], "/aqua");
  });

  test("a hostile target is never stored verbatim", () => {
    const req = { session: {} };
    rememberPostLoginNext(req, "//evil.com", "/home");
    assert.equal(req.session[POST_LOGIN_NEXT_KEY], "/home");
  });

  test("nothing is written when no next was asked for", () => {
    // Writing unconditionally would create a session for every anonymous
    // visitor to /login (saveUninitialized is false precisely to avoid that).
    const req = { session: {} };
    rememberPostLoginNext(req, undefined, "/home");
    assert.deepEqual(Object.keys(req.session), []);
  });

  test("the target is consumed exactly once", () => {
    const req = { session: { [POST_LOGIN_NEXT_KEY]: "/aqua" } };
    assert.equal(takePostLoginNext(req, "/home"), "/aqua");
    // A leftover target would silently redirect a later, unrelated login.
    assert.equal(takePostLoginNext(req, "/home"), "/home");
  });

  test("a target poisoned in the session store is re-sanitised on the way out", () => {
    const req = { session: { [POST_LOGIN_NEXT_KEY]: "//evil.com" } };
    assert.equal(takePostLoginNext(req, "/home"), "/home");
  });

  test("login still defaults to /home for everyone who did not ask", () => {
    assert.equal(takePostLoginNext({ session: {} }, "/home"), "/home");
  });
});

describe("post-login destination — wiring", () => {
  test("GET /login records ?next=", () => {
    assert.match(indexSrc, /app\.get\("\/login",[\s\S]{0,400}?rememberPostLoginNext\(req, req\.query\.next/);
  });

  test("POST /login redirects to the recorded target", () => {
    const handler = indexSrc.slice(indexSrc.indexOf('app.post("/login"'));
    const body = handler.slice(0, handler.indexOf('app.get("/auth/google"'));
    assert.match(body, /takePostLoginNext\(req, "\/home"\)/);
    assert.ok(!/res\.redirect\("\/home"\)/.test(body),
      "POST /login still hard-codes /home, so switch-account never returns to AQUA");
  });

  test("the Google callback consumes the target BEFORE passport runs", () => {
    // passport 0.6 regenerates the session inside req.logIn(). Reading the
    // target after authenticate() would find an empty session and silently
    // drop every OAuth switch-account back onto /home.
    //
    // Anchored on the ROUTE REGISTRATION, not on the bare path string: the
    // string "/auth/google/callback" appears first as the strategy's
    // callbackURL, and slicing from there measured the wrong block entirely.
    const m = indexSrc.match(/app\.get\(\s*\n\s*"\/auth\/google\/callback",([\s\S]*?)\n\);/);
    assert.ok(m, "could not locate the GET /auth/google/callback route registration");
    const block = m[1];

    const takeAt = block.indexOf("takePostLoginNext");
    const authAt = block.indexOf("passport.authenticate");
    assert.ok(takeAt !== -1, "the callback never consumes the switch-account target");
    assert.ok(authAt !== -1, "the callback no longer runs passport.authenticate");
    assert.ok(takeAt < authAt, "takePostLoginNext must run before passport.authenticate");
  });
});
