# Step 2 — Needs-Guard Classification & Step-4 Work Order

**Source audit:** `.lovable/audits/http-callers-2026-05-22.md`
**Rule:** `mem://constraints/http-error-fail-fast`
**Status:** Step 2 of `.lovable/plans/http-fail-fast-10-step.md`. No code modified.

## Key finding from re-reading the shared client

`standalone-scripts/lovable-common/src/api/lovable-http.ts:62` already throws `LovableApiError(status, endpoint, bodyText)` on any non-2xx via `readBodyOrThrow`. This is **most of the contract** — it just needs to be (a) renamed/aliased so the HEFF report shape (§5 of spec) is emitted, and (b) callers must not catch+swallow it.

That means Step 3's helper is mostly a **rebrand + standardised report formatter** around the existing `LovableApiError`, NOT a new HTTP stack. Lower risk than originally scoped.

## Classification of P1 (Needs-guard) sites

| File:Line | Route | Reason |
|-----------|-------|--------|
| `standalone-scripts/lovable-common/src/api/lovable-http.ts:62` | **W-Shared** | Already throws on non-2xx. Add HEFF-shaped `toString()` to error class; emit via shared `reportHttpFailure()`. |
| `src/background/handlers/config-auth-handler.ts:697` | **W-Inplace** | Service-worker context; cannot import `lovable-common`. Wrap with local `httpFailFast()`. Auth-specific: 401 must NOT trigger token refresh loop (already governed by `unified-auth-contract`). |
| `src/background/wasm-integrity.ts:114` | **W-Inplace** | Boot-critical. Already fails integrity check on bad response; just emit HEFF report instead of generic error. |
| `src/background/db-manager.ts:109,234` | **W-Inplace** | WASM HEAD + GET. Add status report; HEAD 405 must NOT fall back to GET (current code may). Verify. |
| `src/background/hot-reload.ts:82` | **W-Inplace** | Polled. On first 4xx/5xx, **stop the poll** (do not keep polling). Critical. |
| `src/background/handlers/updater-handler.ts:268,293` | **W-Inplace** | Manifest + asset fetch. Already single calls. |
| `src/background/handlers/prompt-handler.ts:431` | **W-Inplace** | One call per prompt resolution. |
| `src/background/remote-config-fetcher.ts:115` | **W-Inplace** | Single call; emit HEFF on non-2xx. |
| `src/background/recorder/step-library/result-webhook.ts:531` | **W-Inplace** | Already governed by `webhook-fail-fast`. Re-route through HEFF reporter only (keep single-attempt). |
| `src/components/options/ErrorSwallowAuditView.tsx:161` | **W-Inplace (UI)** | React component fetching local asset. Surface status in existing error state. |
| `src/components/options/ScriptBundleDetailView.tsx:386` | **W-Inplace (UI)** | User-triggered update-URL probe. Surface status in panel. |
| `scripts/print-quality-badges.mjs:149` | **W-Inplace (Node)** | Build script. On first 4xx/5xx → `process.exit(1)`. No fallthrough to next badge. |
| `src/background/boot.ts:250` | **Defer** | Already has graceful fallback ("assuming no buildId"). Document expected behaviour; no change needed. |

**W-Shared = 1** · **W-Inplace = 11** · **Defer = 1** · **Total P1 = 13** (matches audit).

## Step-4 work order (P0 only)

Ordered by blast radius. Each item must keep its existing happy-path behaviour; only the failure path changes.

| # | Site | Action | Risk |
|---|------|--------|------|
| 4.1 | `src/background/manifest-seeder.ts:399-410` | **Remove** `for (attempt 1..MAX_RETRIES)` retry loop. Single attempt + HEFF throw. `MAX_RETRIES` constant deleted. | Med — boot path. Verify no test depends on retry. |
| 4.2 | `src/background/manifest-seeder.ts:167,401` | Inside `for (project)` / `for (scriptDef)` loops, catch HEFF throw and `break` outer loop. Surface failure via `Logger.error`. | Med — partial-seed state. Acceptable per HEFF: stop & report. |
| 4.3 | `src/background/boot.ts:343-352` | Replace `Promise.all(stableScripts.map(fetch))` with sequential `for...of` + `break` on first non-2xx. | Low — pre-cache step; failure already non-fatal. |
| 4.4 | `src/background/cache-warmer.ts:47-75` | Replace `Promise.allSettled` with sequential warm; first 4xx/5xx aborts remaining warms. Cached items so far are kept. | Low — warm cache; degradation acceptable. |
| 4.5 | `src/background/builtin-script-guard.ts:213,236,268` | Inside `for (scriptName)` add `break` on first non-2xx. Two-stage recovery contract preserved: stage-1 break halts stage-2 attempt for that script only? **Decision:** halt for ALL remaining scripts (per HEFF). | Med — affects self-healing. Document degradation. |
| 4.6 | `src/background/script-resolver.ts:82,88` | Distinguish: **network error** → try next candidate (current behaviour); **HTTP 4xx/5xx response** → HEFF throw, no next candidate. | High — candidate fallback is core to resolver. Add discriminator on `err instanceof TypeError` (fetch network) vs `HttpFailFastError`. |
| 4.7 | `src/background/handlers/script-info-handler.ts:98,144,193` | Single-call per request; just add HEFF wrap. Verify the handler is not invoked in a loop from `script-resolver.ts` without a break. | Low. |

## Decision log

- **D-1 (4.6):** Candidate fallback in `script-resolver.ts` remains for network errors only. A definitive 4xx/5xx response from any candidate halts the resolver — the server told us "no". Matches HEFF intent (a 405 should never cause us to hammer the next URL).
- **D-2 (4.5):** Self-healing script guard halts ALL remaining repairs on first HTTP failure, not just the current script's stage-2. Repair is best-effort; partial repair is acceptable; storm-causing repair is not.
- **D-3 (4.1):** `MAX_RETRIES` in `manifest-seeder.ts` is deleted, not kept at 1. Constant removal makes the no-retry policy visible in code review.

## Open questions (logged, not blocking)

Logged per **No-Questions Mode** to `.lovable/question-and-ambiguity/`:

→ Will append `04-heff-script-resolver-network-vs-http.md` documenting D-1 alternative (treat all failures uniformly) with pros/cons + recommendation = current choice.

## Out of scope (still)

- `marco-sdk` user-script HTTP surface
- `httpRequest()` XHR wrapper internals (Step 3 adds a status assertion only)
- `network-reporter.ts` interception
- Page-owned templated `fetch` in `project-namespace-builder.ts` (P1 follow-up after Step 5)

---

**Step 2 status:** complete. Step 3 will create the shared helper + `HttpFailFastError` class (small, ~80 LOC × 2 modules) and the report formatter.
