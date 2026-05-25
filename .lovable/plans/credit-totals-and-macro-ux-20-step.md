# 20-Step Plan — Credit Totals upgrade + Macro/Prompts UX fixes

**Trigger:** User request 2026-05-25 — Credit Totals modal needs drag-drop, sort, filter, double-click → projects, project-count column, bigger fonts, more colorful numbers, hover rows, CSV button in modal. Prompts panel Next-task list misplaced (should be right-side dropdown). Macro Controller must NOT auto-execute (other scripts like dashboard/payment-skip MAY). Plan Task button broken — full RCA required. Every fix ships with unit + E2E tests (per `mem://preferences/test-with-features`).

Ambiguities logged: `.lovable/question-and-ambiguity/01-credit-totals-and-macro-ux.md`.

---

## Step 1 — RCA: Plan Task button

Identify why clicking `🧠 Plan Task` (or any of its N-step children) appears to do nothing. Inspect `ui/plan-task-ui.ts` injection path (`pasteIntoEditor` → editor XPath resolution → `getPromptsConfig()` source). Confirm failure modes:
- a) Clicked from dashboard (no editor on page) → silent loss because submenu closes before toast.
- b) `item.onmouseleave` 120ms timeout collapses submenu mid-click.
- c) Custom-step `parseInt` missing radix.

Output: `.lovable/audits/2026-05-25-plan-task-rca.md` listing exact root cause(s) + reproduction steps.

## Step 2 — Fix: Plan Task button

Apply minimal fixes for each RCA finding from Step 1. Keep behaviour identical when used correctly; add a non-collapsing safety so the dropdown stays open until a real outside-click. Add explicit `parseInt(v, 10)`.

## Step 3 — Test: Plan Task

Unit tests for `buildPlanTaskPrompt(n)` (5/10/15/custom). Component tests for `renderPlanTaskSubmenu` mouse-leave timer + click propagation. E2E test that clicking `Plan in 10 steps` from the prompts dropdown injects the canonical prompt into the editor.

## Step 4 — Move "Plan Task" + "Task Next" to right-side dropdown

Per UX request, the **Next** task list shown in the screenshot is currently inside the **current** prompts panel — relocate the Task-Next + Plan-Task combo to a right-anchored dropdown attached to the panel's right edge so the prompts list stays focused. Update `ui/panel-sections.ts` + `ui/task-next-ui.ts` mount points.

## Step 5 — Macro Controller no-autorun guard

Macro Controller (loop engine + auto-cycle) must require an explicit user gesture to start; other scripts (dashboard, payment-banner-hider) MAY continue to auto-run. Add an `autoStartAllowed` flag wired to user-action only and a sentinel guard at `loop-engine.ts` entry. Hard-error if any code path triggers a loop without the gesture (with CODE-RED log per memory).

## Step 6 — Test: no-autorun

Vitest unit covering the guard (rejects programmatic start, accepts user-gesture start). E2E that loads the extension on `lovable.dev`, waits 10s, and asserts no macro cycle started.

## Step 7 — Credit Totals modal: bigger fonts + colourful numbers

Bump base font from 10/9px → 12/11px. Colour-code numeric columns: Used → amber, Rem → green (cyan if ≤5), Total → muted blue, Plan badge → existing tone classifier. Use existing tokens, no inline hex.

## Step 8 — Credit Totals: row hover + zebra striping

Add `:hover` background + alternating row tint. Pure CSS via existing token vars.

## Step 9 — Credit Totals: sortable columns

Click column header to sort asc/desc (Workspace, Plan, Used, Rem, Total). Persist last sort in `chrome.storage.local` per memory `data-storage-layers`. Re-sort idempotent; preserve drag order if user has manually reordered (Step 10) — sorting clears manual order with a confirmation chip.

## Step 10 — Credit Totals: drag-drop row reorder

Drag-handle on each row (left margin grip) using native HTML5 DnD. Persist order in `chrome.storage.local` under `creditTotalsRowOrder` (array of workspace IDs). Reorder is independent per-user; survives refresh. Drag during sort prompts user to clear sort first.

## Step 11 — Credit Totals: filter chips

Port the workspace-side filter set (All / Refill-soon / Pro / Free / Members-only / Search) into the modal. Reuse `workspace-refill-priority.ts` predicates; no duplicate logic.

## Step 12 — Credit Totals: project-count column + double-click → projects panel

Add `PROJECTS` column showing count (cached via `projects-cache.ts`). Double-click a row opens an inline projects sub-panel listing project names + last-modified, lazy-loaded.

## Step 13 — Credit Totals: CSV export button in modal footer

Move/duplicate existing CSV export (`log-csv-export.ts` pattern) into the modal footer next to Refresh/Close. Exports current filtered + sorted view.

## Step 14 — Tests: Credit Totals (unit)

Vitest: sort comparator, drag-reorder reducer, filter predicates, CSV builder shape, colour-class resolver.

## Step 15 — Tests: Credit Totals (component / DOM)

JSDOM tests for: hover class toggling, header-click sort cycle, double-click projects expand, drag-drop reorder persistence write.

## Step 16 — Tests: Credit Totals (E2E)

Playwright E2E: open modal → sort by Rem asc → drag row 3 above row 1 → filter "Refill-soon" → CSV download contains exactly those rows in that order.

## Step 17 — Fix Prompts panel layout regressions

Address the screenshot bug: when Next-task list is open, it overlaps the prompts panel + Errors badge. Reanchor + z-index + max-height with scroll.

## Step 18 — Lint + zero-warning ESLint pass

Run full standalone lint + extension lint. Fix any new `max-lines-per-function` / `sonarjs/cognitive-complexity` violations introduced by Steps 4–13.

## Step 19 — Audit pass: no-autorun, no-retry, error-logging memories

Re-grep for `setInterval`/`setTimeout`/auto-fetch added in this batch; ensure every one is gated, teardown-paired, and CODE-RED-logged on path errors. Update plan + memory if new patterns emerged.

## Step 20 — Version bump + changelog + readme pin

Bump minor: **v3.15.3 → v3.16.0**. Update `manifest.json`, `src/shared/constants.ts`, all 6 `instruction.ts`, `shared-state.ts`, root `readme.md` pin (all 18 occurrences), root `changelog.md`, `standalone-scripts/macro-controller/changelog.md`. List every Step-1..19 fix under Added/Fixed/Changed.

---

## Pending items carried in

1. P1 — Release installer hardening v0.2 (blocked on `MINISIGN_SECRET_KEY`).
2. P2 — P Store / Cross-Project Sync / Prompt Click E2E (deferred).
