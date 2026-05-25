---
name: next-commands
description: Persistent prioritized backlog of remaining tasks/commands — queried at end of every session per user preference; single source of truth for "what's left"
type: feature
---

# Next Commands — Persistent Task Backlog

This file is the **single source of truth** for remaining/pending tasks across
sessions. Per `.lovable/user-preferences` line 11:

> Always list remaining tasks at the end of each completed work session. If all
> tasks are done, find remaining items from memory and suggest next actions.

The AI MUST:
1. Read this file at the **end of every work session** and surface any
   `[ ]` (unchecked) items in its closing summary.
2. **Tick** (`[x]`) items as they complete.
3. **Append** new items as the user requests them or as they're discovered.
4. **Re-prioritize** by moving items between the priority sections.
5. Never delete a completed item — leave it ticked for traceability.

Trigger phrases the user may type to query this file:
- "what's next", "what's left", "remaining tasks", "next commands",
  "show backlog", "list tasks", "any pending work"

---

## P0 — Blocked / High Priority

- [x] **UI issue — prompt section near buttons** — 2026-05-22, fixed injected controller Prompts → Task Next panel: submenu now opens inline inside the dropdown/controller instead of fixed-positioning outside and colliding with nearby buttons.
- [x] **Test infra fix** — macro-controller has no vitest suite; item was stale (2026-05-22).
- [x] **Dashboard "scripts not available" — Phase 2b** — auto-attach scripts to project by URL condition shipped 2026-05-24 (v3.9.2). Root cause was `AutoInject: false` on macro-controller/lovable-owner-switch/lovable-user-add seeds; changed to `true` so they pass C4 and auto-attach. lovable-common remains dependency-only (resolved at injection-time).
- [x] **Error-swallow P1** — all 14 items cleared (2026-05-19)
- [x] **Error-swallow P2** — audit shows 0 active findings across src/ as of 2026-05-22

## P1 — Ready to Implement

- [ ] **Issue 114 — pro_0 Credit Balance Calculation** — spec written (`spec/22-app-issues/114-pro-zero-credit-balance-calculation.md`), 5 steps queued; target v3.11.0. Step 1 = pure calculator + 12 unit tests.
- [ ] **Release installer hardening v0.2** — SLSA provenance attestation via GitHub Attestations added to release workflow; minisign signing conditional on MINISIGN_SECRET_KEY secret — needs operator to add secret for full v0.2 completion
- [x] **Cross-Project Sync Phase 3** — ProjectGroup UI, drag-assign, sync notifications — completed 2026-05-22 (v9 migration, picker UI, handler wiring, drag-to-assign, cross-tab broadcast)
- [x] **TS Migration V2 Phase 02** — class architecture (S-046) — verified complete 2026-04-23 (v2.225.0)
- [x] **TS Migration V2 Phase 04** — performance & logging (S-047) — verified complete 2026-04-23 (v2.225.0)
- [x] **TS Migration V2 Phase 05** — JSON config pipeline (S-048) — verified + activity-log routing + 7 unit tests, 2026-04-23 (v2.225.0)
- [x] **Injection pipeline split — Step 9** — 2026-05-25, E2E `tests/e2e/e2e-21-injection-pipeline-split.spec.ts` shell (4 cases: stage ordering, preflight short-circuit, envelope shape, delegation spy). See `mem://workflow/14-injection-pipeline-split-session`.
- [x] **Recorder xpath batch — Step 10** — 2026-05-25, E2E `tests/e2e/e2e-22-recorder-xpath-batch.spec.ts` shell (4 cases: 8-rapid-coalesce, debounce single, flushNow serialization, single session resolve). See `mem://workflow/14-injection-pipeline-split-session`.

## P2 — Spec / Owner Pending

- [ ] **P Store** — owner spec pending (deferred — discuss-later mode per user)
- [x] **TS Migration V2 Phase 03** — React feasibility (S-051) — re-evaluated 2026-04-23, **NOT PROCEEDING** (UIManager 58 lines, UI total 15,223 lines under 20K threshold)

## Policy — Test With Features (active since 2026-05-25)

Every new feature or fix ships with matching tests: unit (Vitest) for pure logic, `@testing-library/react` for React components, Playwright E2E for cross-module flows. This is a standing policy, not a backlog item.

## Deferred — Do NOT auto-recommend (per user)

- [ ] **P Store** — owner spec pending (discuss-later mode per user)
- [ ] **Cross-Project Sync & Shared Library** — depends on P Store
- [ ] **Prompt Click E2E (Issues 52/53)** — deferred (manual Chrome testing)

## P3 — Optional Follow-ups (members panel, v2.216.0)

- [x] 2026-05-22 A. **"Load more" pagination** — panel now cycles 20 → 50 → 100; cache keyed per (wsId, limit); button renders only when `members.length < total` and a larger step exists; refresh clears every page-size variant.
- [x] B. **CSV export** — 2026-05-22, header `⬇ CSV` button downloads loaded members as `members-<slug>-YYYY-MM-DD.csv` (RFC4180 escaping, UTF-8 BOM for Excel)
- [x] C. **Click-to-copy** member email or user_id — 2026-05-22, email row + @username row now copy on click with toast preview
- [x] D. **Inline credit-share bar** — 2026-05-22, per-row % bar against loaded-members sum with color ramp (slate→cyan→emerald→amber)
- [x] 2026-05-22 E. **Auto-refresh** — new `credit-poll-events.ts` pub-sub; `loop-controls.refreshStatus` emits a tick after each workspace check; members panel subscribes on open, silently refetches at current `limit`, and unsubscribes on hide (with re-entrancy guard).

## P3 — Optional Follow-ups (canceled-credit override, v2.215.0)

- [x] **Include `about-to-expire` (past_due) in the override** — 2026-05-22, added to `shouldApplyCanceledOverride` in workspace-status.ts
- [x] **Add a debug log** — 2026-05-22, already present in credit-parser.ts `applyLifecycleOverrides` as `lifecycle override [kind] <ws>: available X → Y (billing X → 0, rollover X → 0)`
- [x] **Add config flag** `enableCanceledCreditOverride` — 2026-05-22, added to SettingsOverrides (default true); credit-parser.ts skips overrides when set to false

## P3 — Optional Follow-ups (project-remix dropdown, v2.217.0)

- [x] 2026-05-22 — **Bulk Remix Next** — new `remix-bulk.ts` iterates checked workspace rows; per-ws fetches `projects.list`, picks family-matched or first project, resolves next V-suffix via `resolveNextName`, submits remix, records into history. Sequential per `no-retry-policy`; final toast summarises N/M succeeded. Header dropdown adds `🚀 Bulk Remix Next` with live checked-count sublabel. Resolves Q51 (Option A). Polished 2026-05-22: per-workspace progress toast `[i/N] WsName…` + `window.confirm()` safeguard when ≥4 workspaces checked.
- [x] 2026-05-22 — **Remix history pane** — new `remix-history.ts` (in-memory ring, MAX_HISTORY_ENTRIES=50, session-only); `recordRemix()` invoked from `remix-modal.ts` (mode='manual') and `remix-dropdown.ts` Remix Next (mode='next'); header dropdown gains `📜 Remix history` item → `showRemixHistoryPanel()` (KL-formatted timestamps, Clear button).
- [x] 2026-05-22 — **Lowercase v separator config** — added `remix.nextVCasing` ('preserve' | 'upper' | 'lower') in `remix-config.ts`; `resolveNextName`/`buildName` accept casing param; Remix Next passes `cfg.nextVCasing`. Default 'preserve' (existing behavior unchanged).
- [x] 2026-05-22 — **Open in current tab option** — added `remix.openInCurrentTab` config flag + `openRemixRedirect()` helper in `remix-config.ts`; both `remix-modal.ts` and `remix-dropdown.ts` (Remix Next) now route through it. Default false (new tab).

## P3 — Optional Follow-ups (settings modal, v2.218.0)

- [x] 2026-05-22 — **Expose more keys** — added Settings → General toggles for `enableCanceledCreditOverride`, `enableWorkspaceStatusLabels`, `enableWorkspaceHoverDetails`; persisted via `saveSettingsOverrides`; lifecycle resolver honors user override over JSON config.
- [x] 2026-05-22 — **Export/import overrides** — Settings footer now has `⬇ Export` (downloads `marco-settings-overrides-<ts>.json`) and `⬆ Import` (file picker, validates `kind`, persists via `saveSettingsOverrides`).
- [x] 2026-05-22 — **Per-workspace overrides** — extended `SettingsOverrides.perWorkspace: Record<wsId, {expiryGracePeriodDays?, refillWarningThresholdDays?}>` with sanitizer; new `getWorkspaceLifecycleConfigFor(wsId)` resolver (per-ws → global override → JSON → constant); `credit-parser.applyLifecycleOverrides` now resolves per-row.
- [x] 2026-05-22 — **Per-workspace overrides — editor UI** — Settings → General now shows a "Per-Workspace Lifecycle Overrides" section: list of existing entries (wsId + grace + refill + remove ✕) plus an Add row. Each change persists immediately via `saveSettingsOverrides` (independent of footer Save), with toast feedback and fail-fast error handling.

---

## Recently Completed (last 30 days — for context)

- [x] 2026-05-22 — Prompt section overhaul (controller dropdown): added `🧠 Plan Task` inline submenu (Plan-in-N-steps prompt template), `🔎 Filter` inline submenu with multi-select category checkboxes (replaces single-pick chip bar), removed copy/paste hint text from header, fixed prompt CRUD so SAVE now invalidates cache + reloads + re-renders via new `rerenderPromptsDropdown()` shared helper.
- [x] 2026-05-22 — plan.md stale entry removed (Prompt Section Enhancements shipped; `.lovable/plan.md` is now out of date and should be refreshed when next feature plan is written).

- [x] 2026-04-23 — v2.225.0 — TS Migration V2 backlog cleared (Phases 02, 03, 04, 05); test suite stabilized at 445/445 passing (frozen Date.now() in ws-hover-card snapshot tests); home-screen feature (14 modules) wired into content-script entry; MacroController bridge `CreditsApi.getState()` exposed
- [x] v2.218.0 — Settings cog button + modal (chrome.storage.local override for grace/refill thresholds)
- [x] v2.217.0 — Project remix dropdown (header split-button + right-click) with auto-V-suffix Remix Next + collision pre-check
- [x] v2.216.0 — Workspace members right-click panel (top-20 by credits used)
- [x] v2.215.0 — Subscription section + status-changed-at + canceled-credit override
- [x] v2.214.0 — Workspace lifecycle pill + rich hover card phases 1-6
- [x] Configurable `expiryGracePeriodDays` + `refillWarningThresholdDays`

---

## How to add a new item

When the user requests something new, append to the appropriate priority
section as `- [ ] **Title** — one-line description (blocking notes)`.

When picking up work, move the item to `in_progress` in the loop-local task
tracker, do the work, then return here and tick it `[x]`.
