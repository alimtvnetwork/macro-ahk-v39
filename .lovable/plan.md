# Plan

**Active workstream:** **v3.10.0 — Refill Priority Filter + Button Overflow Fix + GitHub Open**.
Detailed 10-step plan: `.lovable/plans/v3.10.0-refill-priority-and-github-open.md`.
Specs:
- `spec/22-app-issues/refill-priority-filter/01-overview.md`
- `spec/22-app-issues/workspace-github-open/01-overview.md` (+ `02-api-sample.md`)

Status: planning complete (this turn). Implementation starts on next `next`.


All remaining items are **blocked on user input or deferred**:

- **P0 — Task 1.2** — E2E Chrome verification (manual smoke pass on installer build). *Blocked: manual Chrome testing avoided per user policy.*
- **P0 — Dashboard "scripts not available" Phase 2b** — ✅ shipped 2026-05-24 (v3.9.2). Root cause was `AutoInject: false` on macro-controller/lovable-owner-switch/lovable-user-add seeds; changed to `true` so they pass C4 and auto-attach to projects by default.
- **P1 — Release installer hardening v0.2** — SLSA + minisign signing. *Blocked on `MINISIGN_SECRET_KEY` GitHub secret.*
- **P2 — P Store spec** — deferred (discuss-later mode).
- **Deferred (do NOT auto-recommend)** — React component tests, E2E React UI verification, Prompt Click E2E (52/53), Cross-Project Sync & Shared Library (depends on P Store).

## Completed workstreams (recent)

### Prompt Section Enhancements (v?.?.?) — 2026-05-22
All 15 steps done: `Plan Task` inline submenu + template, `Filter` multi-select submenu, copy/paste hint removed, Load button moved, CRUD fixed via `rerenderPromptsDropdown()` helper, dark-theme tokens, typecheck clean.

### HTTP Fail-Fast Enforcement (v3.5.2)
All 10 steps complete. See `.lovable/plans/http-fail-fast-10-step.md`.
