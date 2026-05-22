---
name: HTTP error fail-fast (no retry, no fanout)
description: On any HTTP 4xx/5xx (especially 404/405) during scripted/automated execution, STOP immediately. Do not retry, do not loop, do not run heavy follow-up ops. Report the exact status + URL + reason and wait for user input.
type: constraint
---

# HTTP Error Fail-Fast Policy

## Hard rules

1. **STOP on first HTTP failure.** If a request returns 4xx or 5xx (esp. 404, 405, 401, 403, 429, 5xx), abort the current loop/batch immediately. Do not advance to the next iteration.
2. **No retry, no backoff, no fanout.** Never re-issue the same call. Never iterate the same failing call across many resources/projects (Git checks, API enumeration, dashboard scrape, etc.). Fanning out 4xx/5xx can trigger Lovable rate limits / blocks.
3. **No heavy follow-up.** Do not start additional network, build, or DB-heavy work after a failure until the user acknowledges.
4. **Mandatory failure report.** Write a single, clear message containing:
   - HTTP status code (e.g., `HTTP 405`)
   - Method + full URL
   - Response body snippet (≤500 chars) or `null`
   - Suspected reason in one sentence
   - Explicit line: `Loop halted. Awaiting user instruction.`
5. **Then stop and wait.** Surface to the user. Do NOT propose a retry plan unprompted.

## Applies to

- Project-scanning scripts (Git checks, repo enumeration, dashboard auto-attach probes)
- Webhook callers (already governed by `webhook-fail-fast`)
- Token/auth probes
- Any `curl`, `fetch`, `psql`, or test harness loop

## Why

Repeated 4xx/5xx fanout has historically caused Lovable platform throttling and blocks. One failure = stop, report, wait.

## Cross-refs

- `mem://constraints/no-retry-policy` — sequential fail-fast (general)
- `mem://constraints/webhook-fail-fast` — webhook single-attempt rule
- `spec/03-error-manage/01-error-resolution/` — error resolution guide
