/**
 * CSRF + same-origin protection — E1/PR-6
 *
 * WHY THIS SUITE IS SPLIT IN TWO
 * ------------------------------
 * `startServer()` awaits a live Mongo connection before it listens, so this app
 * cannot be stood up in a test process — the reasoning is spelled out at the
 * top of launchSafety.test.js and it has not changed. Stubbing mongoose far
 * enough to boot produces a fake app, and green against a fake app is worth
 * less than no result.
 *
 * So the logic was deliberately put somewhere testable. `middleware/csrf.js` is
 * pure: it takes a request-shaped object and returns a decision, with no
 * database, no express, and no network. That half gets REAL behavioural tests —
 * tokens issued, tokens rejected, origins matched, timing-safe comparison.
 *
 * The other half — that the guards are mounted, in the right order, before the
 * routes — can only be checked statically, in the established style of this
 * directory.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  attachCsrfToken, verifyCsrf, enforceSameOrigin, issueToken, safeEqual, SESSION_KEY,
} = require('../../middleware/csrf');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const view = (f) => fs.readFileSync(path.join(ROOT, 'views', f), 'utf8');
const at = (needle) => {
  const i = SRC.indexOf(needle);
  assert.ok(i > -1, `not found in index.js: ${needle}`);
  return i;
};

// ── Request/response doubles ─────────────────────────────────────────────────

function mkReq({ method = 'POST', path: p = '/write', session = {}, headers = {}, body = {} } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    method, path: p, session, body, headers: lower,
    get(name) { return lower[String(name).toLowerCase()]; },
  };
}

function mkRes() {
  const res = { statusCode: null, body: null, locals: {}, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const run = (mw, req, res) => {
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  return nexted;
};

// ── Token issuing ────────────────────────────────────────────────────────────

describe('csrf — token issuing', () => {
  test('a token is created once and then reused for the session', () => {
    const req = mkReq({ session: {} });
    const first = issueToken(req);
    assert.ok(first.length >= 32, 'token is too short to resist guessing');
    assert.equal(issueToken(req), first);
    assert.equal(req.session[SESSION_KEY], first);
  });

  test('different sessions get different tokens', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(issueToken(mkReq({ session: {} })));
    assert.equal(seen.size, 500, 'token collision');
  });

  test('no session means no token, and no crash', () => {
    const req = mkReq(); delete req.session;
    assert.equal(issueToken(req), '');
  });

  test('attachCsrfToken exposes it to EJS as csrfToken', () => {
    const req = mkReq({ session: {} }); const res = mkRes();
    assert.ok(run(attachCsrfToken, req, res));
    assert.equal(res.locals.csrfToken, req.session[SESSION_KEY]);
  });
});

// ── Token verification ───────────────────────────────────────────────────────

describe('csrf — verification on the form surface', () => {
  const guard = verifyCsrf();

  test('safe methods pass untouched', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      assert.ok(run(guard, mkReq({ method, session: {} }), mkRes()), `${method} was blocked`);
    }
  });

  test('a matching token in the body passes', () => {
    const session = {}; const token = issueToken(mkReq({ session }));
    assert.ok(run(guard, mkReq({ session, body: { _csrf: token } }), mkRes()));
  });

  test('a matching token in the x-csrf-token header passes — multipart routes need this', () => {
    const session = {}; const token = issueToken(mkReq({ session }));
    assert.ok(run(guard, mkReq({ session, headers: { 'x-csrf-token': token } }), mkRes()));
  });

  test('THE ATTACK: a cross-site POST with no token is refused', () => {
    const session = {}; issueToken(mkReq({ session }));
    const res = mkRes();
    assert.equal(run(guard, mkReq({ session }), res), false);
    assert.equal(res.statusCode, 403);
  });

  test('a wrong token is refused', () => {
    const session = {}; issueToken(mkReq({ session }));
    const res = mkRes();
    assert.equal(run(guard, mkReq({ session, body: { _csrf: 'not-the-token' } }), res), false);
    assert.equal(res.statusCode, 403);
  });

  test('a token from ANOTHER session is refused', () => {
    const victim = {}; issueToken(mkReq({ session: victim }));
    const attacker = {}; const attackerToken = issueToken(mkReq({ session: attacker }));
    const res = mkRes();
    assert.equal(run(guard, mkReq({ session: victim, body: { _csrf: attackerToken } }), res), false);
    assert.equal(res.statusCode, 403);
  });

  test('a session that never had a token issued is refused, not waved through', () => {
    const res = mkRes();
    assert.equal(run(guard, mkReq({ session: {}, body: { _csrf: 'anything' } }), res), false);
    assert.equal(res.statusCode, 403);
  });

  test('API paths are left to the origin guard, not double-checked here', () => {
    assert.ok(run(guard, mkReq({ path: '/api/aqua/chat', session: {} }), mkRes()));
  });

  test('the Razorpay webhook is exempt — HMAC-signed, cookieless, server-to-server', () => {
    assert.ok(run(guard, mkReq({ path: '/api/payment/webhook', session: {} }), mkRes()));
  });
});

// ── Same-origin on the API surface ───────────────────────────────────────────

describe('csrf — same-origin on the API surface', () => {
  const guard = enforceSameOrigin();
  const api = (headers) => mkReq({ path: '/api/aqua/chat', headers: { host: 'aquiplex.com', ...headers } });

  test('a same-origin request passes', () => {
    assert.ok(run(guard, api({ origin: 'https://aquiplex.com' }), mkRes()));
  });

  test('THE ATTACK: a cross-origin POST is refused', () => {
    const res = mkRes();
    assert.equal(run(guard, api({ origin: 'https://evil.example' }), res), false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'cross_origin_blocked');
  });

  test('Referer is used when Origin is absent', () => {
    assert.ok(run(guard, api({ referer: 'https://aquiplex.com/aqua' }), mkRes()));
    const res = mkRes();
    assert.equal(run(guard, api({ referer: 'https://evil.example/x' }), res), false);
  });

  test('a request with NEITHER header passes — it is not a browser and cannot be a CSRF victim', () => {
    // curl, server-to-server, native clients. Blocking these would break real
    // API consumers to stop an attack that requires a browser to exist.
    assert.ok(run(guard, api({}), mkRes()));
  });

  test('ALLOWED_ORIGINS admits an extra host', () => {
    const prev = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'https://app.aquiplex.com';
    try {
      assert.ok(run(guard, api({ origin: 'https://app.aquiplex.com' }), mkRes()));
    } finally {
      if (prev === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = prev;
    }
  });

  test('a malformed Origin is refused rather than parsed optimistically', () => {
    const res = mkRes();
    assert.equal(run(guard, api({ origin: 'not a url' }), res), false);
  });

  test('non-API paths are left to the token guard', () => {
    assert.ok(run(guard, mkReq({ path: '/write', headers: { origin: 'https://evil.example', host: 'aquiplex.com' } }), mkRes()));
  });
});

// ── Constant-time comparison ─────────────────────────────────────────────────

describe('csrf — safeEqual', () => {
  test('matches equal strings and rejects everything else', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false, 'differing lengths must not throw or pass');
    assert.equal(safeEqual('', ''), true);
    assert.equal(safeEqual(null, 'abc'), false);
    assert.equal(safeEqual('abc', undefined), false);
  });

  test('a length mismatch does not throw — the leak the hashing step exists to close', () => {
    assert.doesNotThrow(() => safeEqual('a', 'a'.repeat(1000)));
  });
});

// ── Wiring — static, for the reasons at the top ──────────────────────────────

describe('csrf — wiring in index.js', () => {
  test('the session cookie declares sameSite explicitly', () => {
    assert.match(SRC, /sameSite:\s*"lax"/);
  });

  test('all three guards are mounted', () => {
    assert.match(SRC, /app\.use\(attachCsrfToken\)/);
    assert.match(SRC, /app\.use\(enforceSameOrigin\(\)\)/);
    assert.match(SRC, /app\.use\(verifyCsrf\(\)\)/);
  });

  test('guards are mounted AFTER the session — both read it', () => {
    assert.ok(at('app.use(\n  session({') < at('app.use(attachCsrfToken)')
           || at('session({') < at('app.use(attachCsrfToken)'));
  });

  test('guards are mounted BEFORE the first route, so new routes are covered by default', () => {
    assert.ok(at('app.use(verifyCsrf())') < at('app.post("/login"'));
    assert.ok(at('app.use(enforceSameOrigin())') < at('app.post("/login"'));
  });

  test('guards are mounted AFTER the Razorpay webhook, whose raw body must stay untouched', () => {
    assert.ok(at('_webhookLog') < at('app.use(attachCsrfToken)'));
  });

  test('the admin password is compared in constant time', () => {
    assert.match(SRC, /safeEqual\(pass, adminPassword\)/);
    assert.ok(!/if \(pass === adminPassword\)/.test(SRC), 'the timing-unsafe compare is still present');
  });

  test('/admin is rate limited — it was the only auth surface without a limiter', () => {
    assert.match(SRC, /app\.get\("\/admin",\s*authLimiter,\s*requireAdmin/);
  });
});

// ── Wiring — the rendered surface ────────────────────────────────────────────

describe('csrf — every form carries a token', () => {
  for (const f of ['login.ejs', 'signup.ejs', 'write.ejs']) {
    test(`${f} renders a _csrf field`, () => {
      assert.match(view(f), /name="_csrf"/);
    });
  }

  test('the token field sits INSIDE the form, not merely somewhere on the page', () => {
    for (const f of ['login.ejs', 'signup.ejs', 'write.ejs']) {
      const s = view(f);
      const formAt = s.indexOf('<form');
      const closeAt = s.indexOf('</form>', formAt);
      const tokenAt = s.indexOf('name="_csrf"');
      assert.ok(tokenAt > formAt && tokenAt < closeAt, `${f}: token is outside the form`);
    }
  });

  test('page scripts can reach the token via a meta tag', () => {
    assert.match(view('partials/nav.ejs'), /name="csrf-token"/);
  });

  test('the one non-API fetch sends the token header', () => {
    assert.match(view('bundles.ejs'), /"x-csrf-token":/);
  });

  test('every view referencing csrfToken guards against it being undefined', () => {
    // These partials render on pages that may not have a session. An
    // unguarded `<%= csrfToken %>` would throw a 500 on those, turning a
    // security fix into an outage.
    for (const f of ['login.ejs', 'signup.ejs', 'write.ejs', 'partials/nav.ejs']) {
      const s = view(f);
      if (!s.includes('csrfToken')) continue;
      assert.match(s, /typeof csrfToken !== 'undefined'/, `${f} uses csrfToken unguarded`);
    }
  });
});

// ── Recorded consequence, not an accident ────────────────────────────────────

test('RECORDED: four legacy POST routes have no caller in any view', () => {
  // /generate-bundle, /submit, /bundle/save and /execute-step are part of the
  // retired marketplace surface. Nothing in views/ posts to them, so the token
  // guard now refuses them. That is the correct outcome for a dead route — and
  // if something external DOES call them, it was doing so with no CSRF
  // protection at all, which is precisely the hole this PR closes.
  //
  // Asserted so the situation is a decision on the record rather than a
  // surprise 403 someone debugs in six months.
  const viewsDir = path.join(ROOT, 'views');
  const all = fs.readdirSync(viewsDir, { recursive: true })
    .filter((f) => String(f).endsWith('.ejs'))
    .map((f) => fs.readFileSync(path.join(viewsDir, String(f)), 'utf8'))
    .join('\n');
  for (const route of ['/generate-bundle', '/submit', '/bundle/save', '/execute-step']) {
    assert.ok(!all.includes(`action="${route}"`), `${route} now has a form — give it a token`);
  }
});
