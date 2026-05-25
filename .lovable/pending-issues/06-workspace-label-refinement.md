# Issue 115 — Workspace Label Refinement (Cancel / Refill In / Expired For)

**Status:** ✅ COMPLETE — shipped in v3.12.0 (2026-05-25).
**Target version:** v3.12.1 (minor bump).
**Reference screenshots:** user-uploads image-10 (EXPIRED + EXPIRED (CANCELED)), image-11 (ABOUT TO REFILL), image-12 (ABOUT TO EXPIRE + EXPIRED).

---

## 1. Problem Summary

Current workspace row badges are verbose, duplicated, and use the wrong color semantics:

| Current display | Issue |
|---|---|
| `EXPIRED` + `EXPIRED (CANCELED)` (two red badges) | Duplicated; red implies error/focus. User wants a single muted "Cancel" label. |
| `EXPIRED` + `ABOUT TO EXPIRE` (two badges on the same row) | Duplicated; wastes horizontal space. |
| `ABOUT TO REFILL` (long text) | Too verbose; doesn't carry the actual time-to-refill. |
| (no refill filter) | User asked for a filter to surface refill-soon rows. |

Horizontal space in the workspace list is at a premium — every badge must be short.

---

## 2. Target Display Spec

### 2.1 Canceled (was: `EXPIRED` + `EXPIRED (CANCELED)`)
- Single badge: `Cancel`
- Color: gray/black background, white (or light-gray) text. **Muted, non-focused** — NOT red.
- Internal enum still distinguishes "expired-only" vs "expired-and-canceled" vs "fully-expired", but display collapses **all three** to `Cancel` when the workspace is dead (no refill possible).
- Tooltip on hover may show the internal reason ("Canceled on YYYY-MM-DD", "Fully expired", etc.).

### 2.2 Refill-Soon (was: `ABOUT TO REFILL`)
- Badge: `Refill 5d` (or `Refill 6d`, etc.) — format: `Refill {N}d` where N = days until refill.
- Color: unchanged (existing about-to-refill blue/cyan accent).
- **New filter chip** in the workspace toolbar: `Refill Soon` — when active, shows only workspaces with refill within the priority window (existing K=10 from `refill-priority-filter` memory).

### 2.3 Pro (unchanged)
- Badge: `PRO` — keep as-is for non-expired Pro workspaces.

### 2.4 About-to-Expire / Expired (was: `ABOUT TO EXPIRE` + `EXPIRED`)
- **Before expiry:** `Expire 5d` (format: `Expire {N}d`, N = days remaining).
- **After expiry:** `Expired 2d` (format: `Expired {N}d`, N = days since expiry).
- Single badge only — no stacked `ABOUT TO EXPIRE` + `EXPIRED` pair.
- Color: existing amber/red accents preserved.
- Internal state machine still tracks `about-to-expire | expired | fully-expired | canceled`; display layer chooses the right short string.

### 2.5 General Rules
- Max badge text length: **~10 chars**. No badge may wrap.
- Internal enum names stay descriptive (`STATUS_EXPIRED_CANCELED`, `STATUS_ABOUT_TO_REFILL`, etc.) — display is decoupled.

---

## 3. Ten-Step Implementation Plan

**Step 1 — Status enum & classifier consolidation**
Audit existing badge logic in `ws-list-renderer.ts` and any status-classifier helper. Introduce a single source-of-truth function `classifyWorkspaceDisplayStatus(ws) → { kind, label, tone, tooltip }` returning the **display** shape. Internal enum stays granular; display kinds are: `pro | refill-soon | expire-soon | expired | canceled | free | normal`.

**Step 2 — Display token map**
Add a const map `WORKSPACE_BADGE_DISPLAY` keyed by display kind → `{ label-template, tone-class }`. Tones map to existing Tailwind tokens (`bg-muted text-muted-foreground` for `canceled`, etc.). No raw colors in components.

**Step 3 — Cancel badge collapse**
Update classifier so `expired-canceled`, `fully-expired-canceled`, and `fully-expired` all return `kind: 'canceled'` with label `Cancel` and muted gray tone. Remove the stacked dual-badge render path for these states.

**Step 4 — Refill-soon badge with day count**
Compute `daysToRefill` (already exists in `refill-priority-filter`). Render label `Refill {N}d`. If N is 0, show `Refill today`. Cap at 99d.

**Step 5 — Expire-soon / expired badge with day count**
Compute `daysUntilExpiry` (positive → `Expire {N}d`) or `daysSinceExpiry` (positive → `Expired {N}d`). Single badge replaces the old dual-badge pair. Tooltip retains full ISO date.

**Step 6 — Remove duplicate badges from renderer**
Strip the old render paths in `ws-list-renderer.ts` (and any matching `ui-status-renderer.ts` chip) that pushed two badges per row. Each row now renders **at most one** status badge plus the existing plan badge (`PRO`/`FREE`).

**Step 7 — Refill-Soon filter chip**
Add a new toolbar filter chip `Refill Soon` next to existing `All` / `Pro` filters. Wire it to filter rows where `classifyWorkspaceDisplayStatus(ws).kind === 'refill-soon'`. Persist filter choice in existing workspace-filter state (same store as Pro filter).

**Step 8 — Tests (15 tests planned — see §4)**
Add unit + component tests covering classifier, badge rendering, filter behavior, edge cases. All must pass alongside existing 1988-test suite.

**Step 9 — Version, changelog, README**
Bump `v3.11.1 → v3.12.0` across `manifest.json`, `src/shared/constants.ts`, every `standalone-scripts/*/instruction.ts`. Run `check-version-sync.mjs`. Add changelog entry in both root `changelog.md` and `standalone-scripts/macro-controller/changelog.md`. Pin version in root `readme.md`.

**Step 10 — Memory & docs update**
- Create `mem://features/macro-controller/workspace-badge-display` documenting the display-kind contract and the 10-char rule.
- Update `mem://index.md` Core/Memories.
- Mark Issue 115 done in `.lovable/plan.md`.

---

## 4. Test Plan (15 tests)

**Classifier (Step 1, 5 tests)**
1. `classifyWorkspaceDisplayStatus` returns `canceled` for `STATUS_EXPIRED_CANCELED`.
2. Returns `canceled` for `STATUS_FULLY_EXPIRED` (collapsed).
3. Returns `canceled` for `STATUS_FULLY_EXPIRED_CANCELED`.
4. Returns `refill-soon` when `daysToRefill ≤ 10` and plan is `PRO`.
5. Returns `expire-soon` vs `expired` correctly across the expiry boundary.

**Badge labels (Step 4–5, 4 tests)**
6. Refill badge renders `Refill 5d` for 5 days.
7. Refill badge renders `Refill today` for 0 days.
8. Expire badge renders `Expire 3d` before expiry.
9. Expired badge renders `Expired 2d` two days after expiry.

**Renderer / dedup (Step 6, 3 tests)**
10. A canceled workspace renders exactly **one** status badge (the gray `Cancel`).
11. An about-to-expire workspace renders exactly **one** status badge (no stacked `EXPIRED`).
12. Cancel badge uses muted tone class (no `bg-destructive`/red token).

**Filter (Step 7, 2 tests)**
13. `Refill Soon` filter shows only workspaces classified as `refill-soon`.
14. `Refill Soon` filter coexists with `Pro` filter (intersection behavior).

**E2E / regression (Step 8, 1 test)**
15. End-to-end fixture replay of the three reference screenshots (image-10/11/12) produces the expected badge labels and counts.

---

## 5. Out of Scope

- Changing the underlying status enum names or storage shape.
- Touching `pro_0` credit calculation (shipped in v3.11.1).
- Any change to icons, plan badges (`PRO`/`FREE`), or row layout beyond badge text/color.

---

## Remaining Tasks (project-wide)

- [x] **Issue 115** — Workspace label refinement ✅ Shipped v3.12.1.
- [ ] **P1 — Release installer hardening v0.2** — Blocked on `MINISIGN_SECRET_KEY`.
- [ ] **P2 — P Store / Cross-Project Sync / Prompt Click E2E** — Deferred.
- [ ] **PERF-14 / PERF-15** — Low severity, deferred.

All 10 steps complete. See changelog.md and `mem://features/macro-controller/workspace-badge-display`.
