# HTTP Error Fail-Fast (HEFF)

**Status:** Normative · **Owner:** Error-Management spec · **Related:** `mem://constraints/http-error-fail-fast`, `mem://constraints/no-retry-policy`, `mem://constraints/webhook-fail-fast`

## 1. Intent

Any HTTP failure (4xx or 5xx) during scripted, batched, or automated execution MUST halt the enclosing loop on the first occurrence. No retry. No backoff. No fanout across remaining items. The agent reports the failure and waits.

## 2. Triggering statuses

- `404 Not Found`
- `405 Method Not Allowed`
- `401 Unauthorized` / `403 Forbidden`
- `429 Too Many Requests`
- `5xx` server errors
- Any non-2xx/3xx response from an automation script

## 3. Required actions on trigger

1. **Abort** the current `for`/`while`/`Promise.all`/batch immediately. Pending iterations MUST NOT execute.
2. **Suppress** any queued heavy follow-up (additional fetches, DB writes, builds, screenshots).
3. **Emit** a single failure report with the shape in §5.
4. **Yield** control back to the user. Do not propose a retry plan unprompted.

## 4. Prohibited reactions

- Recursive retry, exponential backoff, jitter, or "retry-once-on-X" wrappers
- Iterating the failing operation across remaining projects/repos/IDs
- Swapping methods (e.g., GET→POST) to "see if that works"
- Silent swallowing (`catch {}`) or downgrading to `console.warn`

## 5. Failure report shape

```
HTTP <status> on <METHOD> <full-url>
Body: <≤500-char snippet | null>
Reason: <one-sentence diagnosis>
Loop halted. Awaiting user instruction.
```

## 6. Scope

Applies to ALL agent-driven HTTP calls: project scans, Git checks, dashboard auto-attach probes, token/auth checks, webhook senders (already covered by `webhook-fail-fast`), `curl`/`fetch`/`psql` in `code--exec`, and CI smoke tests run by the agent.

## 7. Rationale

Repeated 4xx/5xx fanout has historically triggered Lovable platform throttling and account blocks. The cheapest defense is hard-stop on the first failure.

## 8. Cross-references

- `.lovable/memory/constraints/http-error-fail-fast.md`
- `.lovable/memory/constraints/no-retry-policy.md`
- `.lovable/memory/constraints/webhook-fail-fast.md`
- `.lovable/strictly-avoid.md` (mirror entry)
