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

- [ ] **UI issue — prompt section near buttons** — User reports clicking the prompt section near buttons does not open properly. Screenshot appears to show Lovable platform chatbox prompt picker, which is not editable from this project. **Blocked on clarification:** identify which extension component (Options, popup, injected panel) has the issue, or confirm this is platform-side.
- [x] **Test infra fix** — macro-controller has no vitest suite; item was stale (2026-05-22).
- [ ] **Task 1.2** — E2E Chrome verification (manual smoke pass on installer build)
- [ ] **Dashboard "scripts not available" — Phase 2b** — auto-attach scripts to project by URL condition. Phase 1 (diagnostic log + Unbound badge) and Phase 2a (heal bindings on save in `handleSaveProject`) shipped. Phase 2b needs user-confirmed source for per-script URL matches (seed-manifest `TargetUrls` per source project vs project's own `targetUrls`). See `.lovable/question-and-ambiguity/20-dashboard-scripts-not-available-and-auto-attach.md`.
- [x] **Error-swallow P1** — all 14 items cleared (2026-05-19)
- [x] **Error-swallow P2** — audit shows 0 active findings across src/ as of 2026-05-22

## P1 — Ready to Implement

- [x] **Cross-Project Sync Phase 3** — ProjectGroup UI, drag-assign, sync notifications — completed 2026-05-22 (v9 migration, picker UI, handler wiring, drag-to-assign, cross-tab broadcast)
- [ ] **Release installer hardening v0.2** — SLSA provenance attestation via GitHub Attestations added to release workflow; minisign signing conditional on MINISIGN_SECRET_KEY secret — needs operator to add secret for full v0.2 completion
- [x] **TS Migration V2 Phase 02** — class architecture (S-046) — verified complete 2026-04-23 (v2.225.0)
- [x] **TS Migration V2 Phase 04** — performance & logging (S-047) — verified complete 2026-04-23 (v2.225.0)
- [x] **TS Migration V2 Phase 05** — JSON config pipeline (S-048) — verified + activity-log routing + 7 unit tests, 2026-04-23 (v2.225.0)

## P2 — Spec / Owner Pending

- [ ] **P Store** — owner spec pending (deferred — discuss-later mode per user)
- [x] **TS Migration V2 Phase 03** — React feasibility (S-051) — re-evaluated 2026-04-23, **NOT PROCEEDING** (UIManager 58 lines, UI total 15,223 lines under 20K threshold)

## Deferred — Do NOT auto-recommend (per user, 2026-04-23)

- [ ] **React component tests (target 900+)** — skip in `next` rotation
- [ ] **E2E React UI verification (Step 10)** — manual Chrome testing avoided (closed via 74 Playwright CI tests, 2026-04-22)
- [ ] **Prompt Click E2E (Issues 52/53)** — manual Chrome testing avoided
- [ ] **Cross-Project Sync & Shared Library** — depends on P Store

## P3 — Optional Follow-ups (members panel, v2.216.0)

- [ ] A. **"Load more" pagination** if `has_more=true` (raise 20 → 50 → 100)
- [x] B. **CSV export** — 2026-05-22, header `⬇ CSV` button downloads loaded members as `members-<slug>-YYYY-MM-DD.csv` (RFC4180 escaping, UTF-8 BOM for Excel)
- [x] C. **Click-to-copy** member email or user_id — 2026-05-22, email row + @username row now copy on click with toast preview
- [x] D. **Inline credit-share bar** — 2026-05-22, per-row % bar against loaded-members sum with color ramp (slate→cyan→emerald→amber)
- [ ] E. **Auto-refresh** when the workspace credit poll cycle runs

## P3 — Optional Follow-ups (canceled-credit override, v2.215.0)

- [x] **Include `about-to-expire` (past_due) in the override** — 2026-05-22, added to `shouldApplyCanceledOverride` in workspace-status.ts
- [x] **Add a debug log** — 2026-05-22, already present in credit-parser.ts `applyLifecycleOverrides` as `lifecycle override [kind] <ws>: available X → Y (billing X → 0, rollover X → 0)`
- [x] **Add config flag** `enableCanceledCreditOverride` — 2026-05-22, added to SettingsOverrides (default true); credit-parser.ts skips overrides when set to false

## P3 — Optional Follow-ups (project-remix dropdown, v2.217.0)

- [ ] **Bulk Remix Next** — toolbar button to remix every workspace's current project in sequence
- [ ] **Remix history pane** — log of all remixes performed this session (name, source, dest workspace, timestamp)
- [ ] **Lowercase v separator config** — let user pin `v` casing regardless of input ("foo-V2" → "foo-v3")
- [ ] **Open in current tab option** — modal toggle "open in this tab" instead of new tab

## P3 — Optional Follow-ups (settings modal, v2.218.0)

- [ ] **Expose more keys** — add toggles for `enableWorkspaceStatusLabels` + `enableWorkspaceHoverDetails` to the same modal
- [ ] **Export/import overrides** — JSON download + paste-to-import for sharing settings
- [ ] **Per-workspace overrides** — let grace/refill be tuned per workspace ID, not just globally

---

## Recently Completed (last 30 days — for context)

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
