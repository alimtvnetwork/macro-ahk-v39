# Issue 116 — Credit Totals Modal (☰ menu → "Credit Totals")

**Status:** 📋 Spec — not started
**Target version:** v3.13.0 → **v3.14.0** (minor bump)
**Owner:** macro-controller
**Related:** Issue 114 (`pro_0` credit balance), `mem://features/macro-controller/pro-zero-credit-balance`

---

## 1. Goal

Add a new entry to the hamburger (☰) menu — **"💰 Credit Totals"** — that opens a modal (same chrome as Projects / Rename / Changelog modals) summarising the user's credit position across **all workspaces** currently in the SQLite cache.

Three primary numbers, plus a per-workspace breakdown table.

## 2. UX

### 2.1 Menu placement

In `menu-builder.ts` after the **Projects** item (line 83), before the `AUTO ATTACH FILES` divider:

```
📂 Projects
💰 Credit Totals      ← NEW
─── AUTO ATTACH FILES ───
```

Tooltip: `"Sum credits used / remaining across all workspaces this billing cycle"`.

### 2.2 Modal layout

Reuse the existing modal shell pattern from `projects-modal.ts` (same backdrop, header, close button, scroll body, footer).

```
┌─────────────────────────────────────────────────┐
│  💰 Credit Totals                          [×]  │
├─────────────────────────────────────────────────┤
│  ┌──── This Billing Cycle ────┐                 │
│  │  Used:        12,340       │                 │
│  │  Remaining:    7,660       │                 │
│  │  Total grant: 20,000       │                 │
│  └────────────────────────────┘                 │
│                                                  │
│  ┌──── Free Daily Credits ────┐                 │
│  │  Today remaining: 3 / 5    │   (per-account) │
│  │  Resets at: 00:00 MYT      │                 │
│  └────────────────────────────┘                 │
│                                                  │
│  ┌──── Per-Workspace Breakdown ────┐            │
│  │ Name         Plan   Used  Rem  Tot  Status │ │
│  │ A0001 D3v001 pro_3   320   80  400  active │ │
│  │ A0002 D3v002 pro_0    45  ...  ...  active │ │
│  │ ...                                          │ │
│  └──────────────────────────────────────────────┘│
│                                                  │
│  Snapshot age: 2m ago    [↻ Refresh]   [Close]  │
└─────────────────────────────────────────────────┘
```

### 2.3 Aggregation rules (CRITICAL — defer to existing memories)

The numbers MUST be computed by a new pure function `aggregateCreditTotals(workspaces, today)` so it is unit-testable. Per-workspace input fields are read from the same SQLite row used by `ws-list-renderer.ts`.

| Bucket | Source field (per workspace) | Aggregation |
|---|---|---|
| **Used this cycle** | `total_billing_period_used` (pro_0) OR `subscription_used` (other plans) | SUM |
| **Remaining this cycle** | `total_remaining` (pro_0) OR `subscription_remaining` (other plans) | SUM |
| **Total grant this cycle** | `total_granted` (pro_0) OR `subscription_limit` (other plans) | SUM |
| **Free daily — today remaining** | `daily_remaining` from `grant_type_balances.daily` | MAX across workspaces (free daily is per-account, not per-workspace; if multiple values disagree we take the highest as the most fresh) |
| **Free daily — cap** | constant `5` | n/a |
| **Resets at** | next 00:00 in `Asia/Kuala_Lumpur` (Core: project timezone) | computed |

**Plan-specific gotcha (Issue 114):** for `pro_0` we MUST use the `total_*` fields, not the `subscription_*` aggregates. The classifier in `credit-parser.ts` already exposes `isPro0(workspace)` — reuse it; do NOT re-derive.

If a workspace row is missing a field, exclude it from that bucket sum and surface a warning row at the top of the modal: `⚠️ 3 of 48 workspaces missing credit data — refresh to retry`.

### 2.4 Refresh button

`↻ Refresh` re-runs the existing `credit-api.ts` fetch for every workspace currently visible (NOT all 438 — use the filtered list). Sequential, no retry/backoff (per `mem://constraints/no-retry-policy`). On completion, recompute totals and update the modal in place.

## 3. Files (planned)

| File | Action |
|---|---|
| `standalone-scripts/macro-controller/src/credit-totals.ts` | NEW — pure aggregator `aggregateCreditTotals()` + types |
| `standalone-scripts/macro-controller/src/ui/credit-totals-modal.ts` | NEW — modal renderer (shell copied from `projects-modal.ts`) |
| `standalone-scripts/macro-controller/src/ui/menu-builder.ts` | EDIT — add `createMenuItem('💰', 'Credit Totals', …)` after Projects |
| `standalone-scripts/macro-controller/src/__tests__/credit-totals.test.ts` | NEW — Vitest for aggregator (≥6 cases: empty, pro_0-only, mixed, missing fields, daily MAX, reset time MYT) |
| `standalone-scripts/macro-controller/src/__tests__/credit-totals-modal.test.ts` | NEW — render snapshot + refresh-button wiring |
| `standalone-scripts/macro-controller/changelog.md` | EDIT — v3.14.0 entry |
| `changelog.md` (root) | EDIT — v3.14.0 entry |
| `readme.md` (root) | EDIT — bump pinned version to v3.14.0 in install/badges |
| `manifest.json` | EDIT — `"version": "3.14.0"` |
| `src/shared/constants.ts` | EDIT — `EXTENSION_VERSION = "3.14.0"` |
| `standalone-scripts/macro-controller/src/shared-state.ts` | EDIT — `VERSION = '3.14.0'` |
| `standalone-scripts/macro-controller/src/instruction.ts` | EDIT — `Version: "3.14.0"` |

## 4. Non-goals
- No network fetch of credits at modal open (uses last cached snapshot; refresh is opt-in).
- No CSV export from this modal (separate issue if requested).
- No per-day historical chart.
- No "what-if" projections.

## 5. Risk
Low — additive only. Worst case: aggregator returns 0s if no workspaces cached (modal shows `—`), menu item is harmless if clicked before any sync.

---

# Five-task execution plan

The user will type `next` after each task. Each task ships with its own tests (per `mem://preferences/test-with-features`).

1. **Task 1 — Aggregator core**
   Create `credit-totals.ts` with `aggregateCreditTotals(workspaces, now)` returning `{ used, remaining, granted, freeDailyRemaining, freeDailyCap, resetAtMyt, missingCount }`. Write `credit-totals.test.ts` (≥6 cases).

2. **Task 2 — Modal shell**
   Create `credit-totals-modal.ts` exporting `showCreditTotalsModal()`. Copy modal chrome from `projects-modal.ts`. Render three summary cards + per-workspace table using the aggregator. Add `credit-totals-modal.test.ts` for render + close behavior.

3. **Task 3 — Menu wiring + refresh button**
   Edit `menu-builder.ts` to insert the `💰 Credit Totals` entry after `📂 Projects`. Wire the `↻ Refresh` button to re-fetch credits for the currently filtered workspace list (sequential, no retry). Manual smoke check via screenshot.

4. **Task 4 — Edge cases + a11y polish**
   Missing-field warning row, empty-state ("No workspaces cached — open the panel and let it sync"), `aria-label`s on buttons, ESC-to-close, focus trap. Update tests.

5. **Task 5 — Version bump + changelogs + README pin**
   Bump 3.13.0 → **3.14.0** in all 4 pinned sites (`manifest.json`, `src/shared/constants.ts`, `shared-state.ts`, `instruction.ts`). Add v3.14.0 entries to both `changelog.md` files. Update root `readme.md` to pin v3.14.0 in install instructions/badges. Verify with `grep -rn "3\.13\.0"` returns empty in pinned files.
