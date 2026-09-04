/**
 * LIFECYCLE RIG — Phase 5, as close to the real thing as this environment allows.
 *
 * Run:  node tests/account/lifecycleRig.js
 *
 * Deliberately NOT named *.test.js: it needs express + express-session on the
 * path and stands up a listening server, so it must not be swept into the
 * discovering unit battery. It is a manual verification you can re-run.
 *
 * WHAT IS REAL HERE
 *   middleware/csrf.js                        mounted, unmodified
 *   middleware/redirectTarget.js              mounted, unmodified
 *   services/account/sessionLogout.service.js reached through the real router
 *   routes/account/account.routes.js          the SHIPPED router, unmodified
 *   express-session + MemoryStore             real cookies over real HTTP
 *
 * WHAT IS NOT
 *   index.js is not booted — it awaits a Mongo connection before it listens.
 *   The session config and the requireLogin/guard ORDER below are transcribed
 *   from index.js; that the shipped file still matches is pinned separately by
 *   the static assertions in tests/account/sessionLogout.test.js. Mongo is
 *   never connected, and nothing exercised here touches the User model.
 *
 * This proves the round trip: a real cookie is issued, the real router destroys
 * the real session, the real Set-Cookie clears it, and a subsequent request to
 * a requireLogin-guarded path is rejected.
 */
const express = require("express");
const session = require("express-session");
const assert = require("node:assert/strict");

const { attachCsrfToken, verifyCsrf, enforceSameOrigin } = require("./middleware/csrf");
const { rememberPostLoginNext, takePostLoginNext } = require("./middleware/redirectTarget");
const accountRoutes = require("./routes/account/account.routes");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// —— transcribed from index.js ——
app.use(session({
  secret: "rig-only",
  resave: false,
  saveUninitialized: false,
  name: "aidex_session",
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, secure: false, sameSite: "lax" },
}));
app.use(attachCsrfToken);
app.use(enforceSameOrigin());
app.use(verifyCsrf());

function requireLogin(req, res, next) {
  const isLoggedIn = (req.session && req.session.userId) || (req.user && req.user._id);
  if (!isLoggedIn) {
    if (req.originalUrl.startsWith("/api/") || req.xhr) return res.status(401).json({ error: "Login required" });
    return res.redirect("/login");
  }
  next();
}
function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.userId) return res.redirect("/home");
  next();
}

app.get("/login", redirectIfLoggedIn, (req, res) => {
  rememberPostLoginNext(req, req.query.next, "/home");
  // login.ejs embeds res.locals.csrfToken in a hidden _csrf field; the rig
  // exposes it the same way so the POST below carries a real token.
  res.type("html").send(`<form action=/login method=POST><input name=_csrf value="${res.locals.csrfToken}"></form>`);
});

app.post("/login", (req, res) => {
  const destination = takePostLoginNext(req, "/home");
  req.session.user = { _id: req.body.uid, email: req.body.email };
  req.session.userId = req.body.uid;
  req.session.save(() => res.redirect(destination));
});

// The engine surface the SPA calls. Identity bridge as in index.js.
app.get("/api/aqua/conversations", requireLogin, (req, res) =>
  res.json({ success: true, owner: String(req.session.userId) }));

app.use("/api/account", accountRoutes);           // ← the SHIPPED router
app.get("/logout", (req, res) => req.session.destroy(() => { res.clearCookie("aidex_session"); res.redirect("/"); }));

// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "http://127.0.0.1:PORT";
let jar = "";

function capture(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const [pair] = c.split(";");
    const [name, value] = pair.split("=");
    if (name.trim() !== "aidex_session") continue;
    jar = value === "" ? "" : pair.trim();
  }
  return res;
}

async function req(base, path, opts = {}) {
  const res = await fetch(base + path, {
    redirect: "manual",
    ...opts,
    headers: {
      Origin: base,
      ...(jar ? { Cookie: jar } : {}),
      ...(opts.headers || {}),
    },
  });
  return capture(res);
}

/** Read this session's CSRF token the way the login page hands it to a browser. */
async function csrfToken(base, path = "/login") {
  const res = await req(base, path);
  const html = await res.text();
  const m = html.match(/name=_csrf value="([^"]*)"/);
  return m ? m[1] : "";
}

const steps = [];
function step(name, fn) { steps.push([name, fn]); }

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  void ORIGIN;

  // ── 1. Sign in as User A ──────────────────────────────────────────────────
  step("login as User A issues a session cookie", async () => {
    const token = await csrfToken(base);
    const res = await req(base, "/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-csrf-token": token },
      body: "uid=userA&email=chhanda%40example.com",
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/home");
    assert.ok(jar.startsWith("aidex_session="), "no session cookie was issued");
  });

  step("User A can read the authenticated engine surface", async () => {
    const res = await req(base, "/api/aqua/conversations");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).owner, "userA");
  });

  // ── 2. Log out through the shipped route ──────────────────────────────────
  let cookieBeforeLogout;
  step("POST /api/account/logout succeeds and reports it ended a live session", async () => {
    cookieBeforeLogout = jar;
    const res = await req(base, "/api/account/logout", { method: "POST" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.hadSession, true);
  });

  step("the response clears the session cookie", async () => {
    assert.equal(jar, "", "aidex_session was not cleared by Set-Cookie");
  });

  step("the authenticated surface is unreachable afterwards", async () => {
    const res = await req(base, "/api/aqua/conversations");
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Login required" });
  });

  step("REPLAYING User A's old cookie does not restore the session", async () => {
    // The real test of server-side invalidation: the browser is made to send
    // the exact cookie it held while signed in. If the record still existed,
    // this would come back 200 and logout would have been theatre.
    const res = await fetch(base + "/api/aqua/conversations", {
      redirect: "manual",
      headers: { Origin: base, Cookie: cookieBeforeLogout },
    });
    assert.equal(res.status, 401);
  });

  step("logout is idempotent — a second call on a dead session still succeeds", async () => {
    const res = await req(base, "/api/account/logout", { method: "POST" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.hadSession, false);
  });

  step("a cross-origin logout is refused by the existing CSRF guard", async () => {
    const res = await fetch(base + "/api/account/logout", {
      method: "POST",
      redirect: "manual",
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "cross_origin_blocked");
  });

  // ── 3. Switch account: /login?next=/aqua → User B lands in AQUA ───────────
  step("switch-account lands the NEXT account back in AQUA", async () => {
    jar = "";
    const token = await csrfToken(base, "/login?next=%2Faqua");
    const res = await req(base, "/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-csrf-token": token },
      body: "uid=userB&email=priya%40example.com",
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/aqua");
  });

  step("the engine surface now answers for User B, never User A", async () => {
    const res = await req(base, "/api/aqua/conversations");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).owner, "userB");
  });

  step("the switch-account target is consumed, not sticky", async () => {
    // A leftover target would silently redirect the NEXT, unrelated login.
    await req(base, "/api/account/logout", { method: "POST" });
    jar = "";
    const token = await csrfToken(base);
    const res = await req(base, "/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-csrf-token": token },
      body: "uid=userC&email=c%40example.com",
    });
    assert.equal(res.headers.get("location"), "/home");
  });

  step("an off-origin ?next= is never followed", async () => {
    await req(base, "/api/account/logout", { method: "POST" });
    jar = "";
    const token = await csrfToken(base, "/login?next=%2F%5Cevil.com");
    const res = await req(base, "/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-csrf-token": token },
      body: "uid=userD&email=d%40example.com",
    });
    assert.equal(res.headers.get("location"), "/home");
  });

  step("the pre-existing GET /logout still works", async () => {
    const res = await req(base, "/logout");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
    const after = await req(base, "/api/aqua/conversations");
    assert.equal(after.status, 401);
  });

  let failed = 0;
  for (const [name, fn] of steps) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
  }
  console.log(`\n${steps.length - failed}/${steps.length} lifecycle steps passed`);
  server.close();
  process.exit(failed ? 1 : 0);
})();
