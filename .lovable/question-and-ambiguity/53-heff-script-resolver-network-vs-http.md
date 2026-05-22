# 53 — HEFF: script-resolver candidate fallback on HTTP failure

**Context (layman):** When the extension looks up a script, it has a list of possible URLs to try (a "candidate list"). Today, if any candidate URL fails for any reason — including the server explicitly returning "Not Found" or "Method Not Allowed" — the resolver moves on to the next candidate. With the new HTTP fail-fast rule, we need to decide what counts as a "real" failure that should stop the whole resolver vs a "try the next candidate" failure.

**Concrete example:** Candidate A returns HTTP 405. Candidate B is a known-good URL. Should we:
- (A) Stop immediately, report "405 on candidate A", and never try B? — strict HEFF reading.
- (B) Try B, because A's failure is per-URL and not a server-wide problem? — current behaviour.
- (C) Treat only network errors (DNS, refused, timeout) as "try next"; treat any HTTP response (4xx/5xx) as "stop immediately". — hybrid.

## Options

### Option C — Network errors → try next; HTTP responses → stop (RECOMMENDED)

**Why:** A 4xx/5xx response means the server received and rejected the request — the server told us "no". Hammering the next URL with the same method/auth is exactly the fanout HEFF was created to prevent. Network errors (TypeError from fetch, ENOTFOUND, ETIMEDOUT) genuinely mean "this URL is unreachable", and falling through to the next candidate is appropriate.

**Pros:** Preserves the useful part of candidate fallback (legitimate URL outages). Kills the dangerous part (servers rate-limiting / blocking us). Matches the spec's spirit.

**Cons:** A flaky load balancer returning 503 on one node will not fall through to a healthy second URL. Mitigation: 5xx is rare in our usage; user can manually re-trigger.

### Option A — Strict: any failure stops the resolver

**Pros:** Simplest, lowest-risk implementation. Maximum compliance.

**Cons:** Breaks the resolver's existing value: if DNS for one candidate is broken, we lose the ability to fall through to a known-good URL. Will cause real user-visible regressions.

### Option B — Status quo: any failure tries next candidate

**Pros:** Zero behavioural change. Lowest implementation risk.

**Cons:** Direct violation of HEFF. Defeats the purpose of this entire plan.

## Recommendation

**Option C.** Implement by discriminating on error type at the catch site:

```ts
try { res = await fetch(url); if (!res.ok) throw new HttpFailFastError(...); }
catch (err) {
  if (err instanceof HttpFailFastError) throw err;   // stop the resolver
  continue;                                          // network error → try next candidate
}
```

**Decision:** D-1 in `.lovable/audits/http-callers-2026-05-22-step2-classification.md`. Will revisit if user prefers Option A.
