# Plan

**Active workstream:** P1 — Release installer hardening v0.2 (blocked on `MINISIGN_SECRET_KEY`).

**Recently shipped:** **v3.12.0 — Workspace Label Refinement** (2026-05-25).

---

## `next` command convention (MANDATORY)

When the user says `next`:
1. Actually DO the next task this turn — never just announce or delegate it. No "say next for step X" stubs.
2. After completing it, list remaining tasks as a flat numbered list `1. 2. 3. 4.` — simple sequential integers, no `Step 7`, no decimals, no roman numerals.
3. Keep the sequence stable: when item 1 finishes, old item 2 becomes new item 1. Don't renumber arbitrarily.
4. If all tasks appear done, search prior chat/memory for leftover work and propose it as new numbered items.

---

## Remaining tasks (blocked or deferred)

### Completed — Issue 114 (5 steps, v3.11.1) ✅
Spec: `spec/22-app-issues/114-pro-zero-credit-balance-calculation.md`
- [x] Step 1 — Pure calculator module + 12 unit tests
- [x] Step 2 — Wire calculator into pro-zero-credit-summary.ts + retire legacy branch for pro_0
- [x] Step 3 — Renderers consume enriched fields (status bar, hover card, Copy-JSON)
- [x] Step 4 — E2E harness + 6 fixtures
- [x] Step 5 — v3.11.1 bump, changelog, README, memory

### Blocked on user input / secrets
- **P1 — Release installer hardening v0.2** — SLSA + minisign signing. *Blocked on `MINISIGN_SECRET_KEY` GitHub secret.*
  - Plan: `.lovable/plans/release-installer.md`
  - Needs: `MINISIGN_SECRET_KEY` added to GitHub secrets so the release workflow can sign the installer.

### Deferred
- **P2 — P Store spec** — *Discuss-later mode per user instruction.*
- **Cross-Project Sync & Shared Library** — *Depends on P Store.*
- **Prompt Click E2E (52/53)** — *Deferred.*

### In-memory audit not yet on active backlog
- **Idle loop perf audit (2026-04-25)** — ✅ All actionable items fixed (PERF-1..13). PERF-14/15 are Low/no-action. See `mem://performance/idle-loop-audit-2026-04-25`.

---

## Completed workstreams (recent)

### Issue 113 — Workspace tooltip + Members popup + Settings removal (2026-05-25)
- Native `title=` tooltips stripped from `ws-list-renderer.ts` (3 call sites); single shared `<div>` hover card via `ws-hover-card.ts`.
- Compact layout: workspace name + plan pill; credits bar; refill + expiry rows; collapsible priority rules `<details>`.
- Color-coded credit health (`--success` / `--warning` / `--destructive`) and lifecycle tone mapping.
- Settings (gear) button + `settings-modal.ts` imports removed from panel header; dead UI eliminated.
- Members panel promoted from inline list to popup (reuse Rename chrome): header, member rows with avatar/name/email/role/`⋯` menu, Add/Remove/Promote mutations with cache invalidation.
- 10 steps complete. See `spec/22-app-issues/113-workspace-tooltip-and-members-popup.md`.

### v3.12.0 — Workspace Label Refinement (2026-05-25)
- Unified workspace badge system: all `expired*` variants collapse to muted gray `Cancel`; `about-to-expire` → `Expire Nd` (amber) / `Expired Nd` (red); `about-to-refill` → `Refill Nd` / `Refill today` (sky).
- Single `classifyFromStatus` + `resolveBadgeStyle` shared by row list and hover card; duplicate pill maps removed.
- Refill-soon filter chip added to workspace toolbar.
- 28 tests (classifier, tone resolver, composition, chip).
- Issue 115 complete; 10 steps done.

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
