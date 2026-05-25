# Plan

**Active workstream:** None — all current items blocked or deferred.

**Recently shipped:** **v3.10.0 — Refill Priority Filter + Button Overflow Fix + GitHub Open** (2026-05-24).
Detailed plan: `.lovable/plans/v3.10.0-refill-priority-and-github-open.md`.
Specs:
- `spec/22-app-issues/refill-priority-filter/01-overview.md`
- `spec/22-app-issues/workspace-github-open/01-overview.md` (+ `02-api-sample.md`)

---

## Remaining tasks (blocked or deferred)

### Blocked on user input / secrets
- **P1 — Release installer hardening v0.2** — SLSA + minisign signing. *Blocked on `MINISIGN_SECRET_KEY` GitHub secret.*
  - Plan: `.lovable/plans/release-installer.md`
  - Needs: `MINISIGN_SECRET_KEY` added to GitHub secrets so the release workflow can sign the installer.

### Blocked on user policy
- **P0 — Task 1.2** — E2E Chrome verification (manual smoke pass on installer build). *Blocked: manual Chrome testing avoided per user policy (`mem://preferences/deferred-workstreams`).*

### Deferred
- **P2 — P Store spec** — *Discuss-later mode per user instruction.*
- **Macro recorder phases / React component tests** — *Deferred per user policy.*
- **Prompt Click E2E (52/53)** — *Deferred.*
- **Cross-Project Sync & Shared Library** — *Depends on P Store.*

### In-memory audit not yet on active backlog
- **Idle loop perf audit (2026-04-25)** — ✅ All actionable items fixed (PERF-1..13). PERF-14/15 are Low/no-action. See `mem://performance/idle-loop-audit-2026-04-25`.

---

## Completed workstreams (recent)

### v3.10.2 — Refill Priority + GitHub Open (2026-05-24)
- Button row overflow hardened (`min-width:0`, `overflow:visible`)
- `REFILL_PRIORITY_WINDOW_DAYS = 10` + score/sort helper + 9 unit tests
- "Refill priority" filter toggle with `R Nd` inline badge (sky/amber/slate)
- GitHub repo open via right-click with `marco.kv` gitsync cache (negative-result memoization)
- Minor bump 3.9.3 → 3.10.0 + changelog + README pin

### Prompt Section Enhancements (v?.?.?) — 2026-05-22
All 15 steps done: `Plan Task` inline submenu + template, `Filter` multi-select submenu, copy/paste hint removed, Load button moved, CRUD fixed via `rerenderPromptsDropdown()` helper, dark-theme tokens, typecheck clean.

### HTTP Fail-Fast Enforcement (v3.5.2)
All 10 steps complete. See `.lovable/plans/http-fail-fast-10-step.md`.
