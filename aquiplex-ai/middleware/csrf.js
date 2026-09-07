/**
 * AQUIPLEX platform — CSRF and same-origin protection
 * Blueprint E1/PR-6
 *
 * THE GAP THIS CLOSES
 * -------------------
 * The session cookie had no explicit `sameSite`, and no route verified that a
 * state-changing request originated from our own pages. A cross-site form POST
 * to `/login`, `/write` or `/submit` carried the victim's session, and a
 * cross-origin POST to `/api/aqua/chat` burned their credits.
 *
 * TWO MECHANISMS, ONE PER SURFACE — deliberately not one for both
 * --------------------------------------------------------------
 * The platform serves two very different things from one origin:
 *
 *   EJS pages        server-rendered forms → a synchroniser TOKEN works,
 *                    because the server renders the form and can embed it
 *
 *   JSON APIs        consumed by the Vite SPA and by inline page scripts →
 *                    ORIGIN enforcement works without touching the frontend
 *                    at all, which matters because the frontend has no test
 *                    runner and a token rollout there could not be verified
 *
 * Both are fail-closed for NEW routes in their own space: a new POST page
 * route needs a token, a new POST API route needs a matching Origin. Nothing
 * has to remember to opt in.
 *
 * WHY ORIGIN CHECKING IS ENOUGH FOR THE API SURFACE
 * -------------------------------------------------
 * CSRF requires a browser. Browsers always attach `Origin` to cross-origin
 * requests and to same-origin non-GET fetches. A request with NEITHER `Origin`
 * NOR `Referer` is not a browser — it is curl, a server-to-server call, or a
 * native client — and it cannot be a CSRF victim, so it passes. A request that
 * HAS one and does not match ours is rejected. That rule is what makes this
 * safe to enable without breaking non-browser API consumers.
 */
const crypto = require("crypto");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TOKEN_BYTES = 32;
const SESSION_KEY = "_csrfToken";

/**
 * Paths exempt from BOTH mechanisms.
 *
 * The Razorpay webhook is mounted before the body parsers so its raw body stays
 * verifiable; it authenticates with an HMAC signature, carries no cookie, and
 * is called server-to-server. A CSRF token would be meaningless and an Origin
 * check would reject a legitimate caller.
 */
const EXEMPT_PREFIXES = ["/api/payment/webhook"];

const isExempt = (p) => EXEMPT_PREFIXES.some((e) => p === e || p.startsWith(e + "/"));

/** Constant-time compare that cannot leak length via early return. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, so both sides are hashed to a
  // fixed width first. Comparing raw strings would leak length through the
  // exception path — the same class of leak this module exists to close.
  const ah = crypto.createHash("sha256").update(ab).digest();
  const bh = crypto.createHash("sha256").update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

/** Issue (or reuse) this session's token. Returns '' when there is no session. */
function issueToken(req) {
  if (!req.session) return "";
  if (!req.session[SESSION_KEY]) {
    req.session[SESSION_KEY] = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  }
  return req.session[SESSION_KEY];
}

/**
 * Makes the token available to EJS as `csrfToken` on every rendered page.
 * Mount after the session middleware and before the routes.
 */
function attachCsrfToken(req, res, next) {
  res.locals.csrfToken = issueToken(req);
  next();
}

/** Where a submitted token may live. Never the query string — URLs leak. */
function submittedToken(req) {
  return (
    req.get?.("x-csrf-token") ||
    req.headers?.["x-csrf-token"] ||
    (req.body && typeof req.body._csrf === "string" ? req.body._csrf : "") ||
    ""
  );
}

/**
 * Verify a token on unsafe requests to NON-API paths (the EJS form surface).
 *
 * Multipart routes note: this runs before per-route `multer`, so `req.body`
 * is not populated for `multipart/form-data`. Those forms must send the token
 * in the `x-csrf-token` header. Called out here because the failure would
 * otherwise look like a mysterious 403 on one route.
 */
function verifyCsrf(options = {}) {
  const skip = options.skip || ((req) => req.path.startsWith("/api/"));
  return function csrfGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (isExempt(req.path) || skip(req)) return next();

    const expected = req.session && req.session[SESSION_KEY];
    if (!expected) {
      // No token was ever issued for this session — the request cannot have
      // come from a page we rendered.
      return res.status(403).send("Invalid or missing form token. Reload the page and try again.");
    }
    if (!safeEqual(submittedToken(req), expected)) {
      return res.status(403).send("Invalid or missing form token. Reload the page and try again.");
    }
    return next();
  };
}

/** Hosts we consider our own, beyond the request's own Host header. */
function allowedHosts() {
  const extra = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try { return new URL(s).host; } catch { return s; }
    });
  return new Set(extra);
}

/**
 * Enforce same-origin on unsafe requests to API paths.
 *
 * A request with neither Origin nor Referer is not a browser and cannot be a
 * CSRF victim — it passes. One that carries either header must match our host.
 */
function enforceSameOrigin(options = {}) {
  const only = options.only || ((req) => req.path.startsWith("/api/"));
  return function originGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (isExempt(req.path) || !only(req)) return next();

    const origin = req.get?.("origin") || req.headers?.origin || "";
    const referer = req.get?.("referer") || req.headers?.referer || "";
    if (!origin && !referer) return next(); // not a browser

    const host = req.get?.("host") || req.headers?.host || "";
    const permitted = allowedHosts();
    permitted.add(host);

    const claimed = (() => {
      try { return new URL(origin || referer).host; } catch { return null; }
    })();

    if (claimed && permitted.has(claimed)) return next();
    return res.status(403).json({ error: "cross_origin_blocked", message: "Request origin is not allowed." });
  };
}

module.exports = {
  attachCsrfToken,
  verifyCsrf,
  enforceSameOrigin,
  issueToken,
  safeEqual,
  SESSION_KEY,
  EXEMPT_PREFIXES,
  SAFE_METHODS,
};
