# AQUIPLEX Platform — Request Forgery Protection

**Blueprint reference:** Epic E1 (Platform Safety) · PR-6
**Status:** landed
**Tree:** platform (`index.js`, `views/`, `middleware/`) — **not** the aqua engine
**Changes behaviour:** yes — unsafe requests now need a token or a matching origin

---

## The gap

The session cookie declared no `sameSite`, and no route checked where a
state-changing request came from. A cross-site form POST to `/login`, `/write`
or `/submit` carried the victim's session. A cross-origin POST to
`/api/aqua/chat` burned their credits. The admin password was compared with
`===`, and `/admin` was the only authentication surface with no rate limiter.

## Two mechanisms, one per surface

The platform serves two very different things from one origin, and forcing one
mechanism onto both would have meant touching the frontend — which has no test
runner, so a token rollout there could not have been verified.

| Surface | Mechanism | Why |
|---|---|---|
| EJS pages (`/login`, `/signup`, `/write`, legacy bundle routes) | synchroniser **token** | the server renders the form, so it can embed the token |
| JSON APIs (`/api/**` — SPA, billing, page scripts) | **Origin** enforcement | works with zero frontend change |

Both are **fail-closed for new routes** in their own space: a new page POST
needs a token, a new API POST needs a matching origin. Nothing has to remember
to opt in.

### Why Origin checking is enough for the API surface

CSRF requires a browser. Browsers always attach `Origin` to cross-origin
requests and to same-origin non-GET fetches. So:

- **neither `Origin` nor `Referer`** → not a browser (curl, server-to-server,
  native client) → cannot be a CSRF victim → **passes**
- **either header present** → must match our host (or `ALLOWED_ORIGINS`) →
  otherwise **403**

That rule is what makes this safe to switch on without breaking non-browser API
consumers. Blocking header-less requests would break real integrations to stop
an attack that requires a browser to exist.

## `sameSite: "lax"`, not `"strict"`

`strict` withholds the cookie on top-level navigations arriving from another
site — which breaks the Google OAuth callback: the user returns from
`accounts.google.com` and lands logged out. `lax` still blocks the cross-site
POST that CSRF depends on, which is the actual attack.

## What else changed

- **`crypto.timingSafeEqual` for the admin password.** `===` on a secret
  returns at the first differing byte, leaking the prefix to anyone who can
  measure response time across enough attempts. The comparison hashes both
  sides to a fixed width first — comparing raw buffers throws on a length
  mismatch, and that exception path leaks length, which is the same class of
  leak.
- **`authLimiter` on `/admin`.** It was the only auth surface without one:
  `/login`, `/signup` and `/auth/google` all had it.

## Recorded consequence — four legacy routes

`/generate-bundle`, `/submit`, `/bundle/save` and `/execute-step` have **no
caller in any view**. They are the retired marketplace surface. The token guard
now refuses them.

That is the correct outcome for a dead route — and if something external does
call them, it was doing so with **no CSRF protection at all**, which is exactly
the hole this closes. Asserted in the suite so it is a decision on the record
rather than a surprise 403 someone debugs in six months.

## Multipart caveat, stated because it would look like a bug

The guard runs before per-route `multer`, so `req.body` is not populated for
`multipart/form-data`. Those forms must send the token in the `x-csrf-token`
header. The only multipart route today is `/submit`, which has no caller.

## Testing — why it is split in two

`startServer()` awaits a live Mongo connection before it listens, so this app
cannot be stood up in a test process. `tests/platform/launchSafety.test.js`
already says why, and it has not changed: stubbing mongoose far enough to boot
produces a fake app, and green against a fake app is worth less than no result.

So the logic was deliberately put somewhere testable:

- **`middleware/csrf.js` is pure** — request-shaped object in, decision out. No
  database, no express, no network. That half gets real behavioural tests:
  tokens issued and reused, wrong tokens refused, another session's token
  refused, origins matched, header-less requests admitted, constant-time
  comparison.
- **The wiring** — mounted, in the right order, after the session, before the
  routes, after the webhook — can only be checked statically, in this
  directory's established style.

## Bite, measured

| Mutation | Failures |
|---|---|
| unmount the CSRF guard | 2 |
| unmount the origin guard | 2 |
| drop `sameSite` | 1 |
| restore the timing-unsafe admin compare | 1 |
| remove the `/admin` limiter | 1 |
| accept any token | 3 |
| accept any origin | 3 |
| strip the token from the login form | 2 |
| *(reverted)* | **0 — 50/50 pass** |

## Results

```
platform    50 / 0 fail    (from 16)
account     12 / 0 fail    (unchanged)
engine    1872 / 103 suites / 0 fail   — untouched by this PR
```

**Note on the account suite:** it fails on a tree with no platform
`node_modules` (`Cannot find module 'bcrypt'`). That is environmental, not a
regression — it fails identically on the unmodified tree, and passes 12/12 once
`npm install` has run at the repo root.

## Applying

This is a **platform** PR — its files land at the repo root, not under `aqua/`.
`apply-pr.sh` handles both now: it detects the target, verifies the matching
tree, and reports PR-6 in the state table.

```bash
bash apply-pr.sh ~/Downloads/PR6-request-forgery.tar.gz
```

No dependency change. If the platform's `node_modules` is not installed, run
`npm install` at the repo root once.
