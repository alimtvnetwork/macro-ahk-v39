# Refill Priority Filter + Button Overflow Fix

**Status:** Draft (planning) — `.lovable/plan.md` 10-step plan
**Targets:** Macro Controller workspace list (`ws-list-renderer.ts`,
`ws-filter-menu.ts`, `ws-hover-card.ts`) and panel button row (`panel-controls.ts`).
**Version target:** `v3.10.0` (minor bump per user instruction).

---

## 1. Problem statements

### 1A. Panel button row overflow

The panel container `#marco-ui` uses `overflow:hidden` (panel-builder.ts L127).
The button row (`Check / ▶ / Credits / Prompts / ⚠ / ☰`) renders inside that
clip box. When the panel auto-sizes (minimize → expand or narrow Lovable
sidebar dock) the rightmost buttons get **clipped** and the labels appear
crippled. Symptom screenshot: buttons flush together with no visible gap and
the menu/error toggle disappearing past the right edge.

### 1B. "About to refill" priority sort filter

Users want to triage workspaces by *refill urgency × remaining spend power*.
A workspace with **few days to refill but lots of credits** should bubble to
the top — because if it doesn't get used in time, the unused credits expire
at the refill boundary.

### 1C. Compact "refill in Nd" badge in the workspace row

Existing rows already render an "about-to-refill" status pill but only as
a label. Users want a tiny inline badge **next to the workspace name**
showing the remaining days: `R 2d`, `R 1d`, `R 0d` (today).

---

## 2. UX — button row overflow fix

- Bump `btnRow` flex `gap` from 8px → 10px (already shipped in v3.9.3).
- Add `margin:2px 3px` defensively on `btnStyle` (already shipped in v3.9.3).
- **NEW for v3.10.0** — replace the panel's `overflow:hidden` with
  `overflow:hidden;overflow:clip` only for the *resize boundary* and let the
  button row escape via a CSS contain trick: give `btnRow` its own
  `min-width:0` + `flex-shrink:1` only on container wrappers (not buttons)
  so buttons never overflow the container. Concretely:
  - Panel `ui.style.overflow` stays `hidden` (geometry contract).
  - `btnRow` gains `min-width:0;max-width:100%;overflow:visible`.
  - Each wrapper (`startStopWrap`, `promptsContainer`, `menuContainer`)
    keeps `flex:0 0 auto` but adds `min-width:0` so the children's
    intrinsic content width drives wrapping rather than clipping.
- Acceptance: at panel widths 320px, 380px, 460px, 600px the full button
  row is visible (wraps to 2 rows when needed) with no clipping.

---

## 3. UX — refill priority filter

### 3.1 Filter menu entry

Add a new row to the filter popover (`ws-filter-menu.ts`):

| Field | Value |
|---|---|
| `id` | `loop-ws-refill-priority-filter` |
| icon | `⏳` |
| label | `Refill priority` |
| hint | `urgency × credits` |
| default | OFF |

### 3.2 Sort formula

```
K = REFILL_PRIORITY_WINDOW_DAYS   // const, default = 10
urgency = max(0, K - daysToRefill)  // clamp at 0; past-refill rows = 0 urgency
score = urgency * available_credits
```

Sort **descending** by `score`. Tie-breaker: ascending `daysToRefill`, then
descending `available`.

- Workspaces with no refill date (`nextRefillAt` and `billingPeriodEndAt`
  both empty) are pushed to the bottom (`score = -1` sentinel).
- The filter does **not hide** any workspaces by itself (it's purely a
  sort), so it composes with `Free only`, `Rollover`, `Billing`, etc.

### 3.3 Constant

Add to `standalone-scripts/macro-controller/src/constants.ts`:

```ts
/** Refill Priority Filter — urgency window in days.
 *  Score = max(0, K - daysToRefill) * availableCredits; K = this constant. */
export const REFILL_PRIORITY_WINDOW_DAYS = 10;
```

---

## 4. UX — inline `R Nd` badge

Render next to `.loop-ws-name` (after the workspace pill) when
`daysToRefill >= 0 && daysToRefill <= REFILL_PRIORITY_WINDOW_DAYS`:

- `R 0d` (refills today) — fg `#bae6fd`, bg `rgba(2,132,199,0.25)`
- `R 1d`–`R 3d`         — fg `#fde68a`, bg `rgba(180,83,9,0.25)`
- `R 4d`–`R 10d`        — fg `#94a3b8`, bg `rgba(71,85,105,0.25)`

Always visible (not only when the priority filter is on) so users can scan
urgency at a glance. Hidden when `daysToRefill` cannot be computed.

---

## 5. Non-regressions

- `Focus current` filter still works.
- The existing `about-to-refill` status pill in the hover card and row is
  unchanged.
- `ws-hover-card-compact.test.ts` snapshots remain valid (the inline `R Nd`
  badge lives on the row, not in the hover card).
- No new HTTP calls — sort/filter is pure client-side over cached
  `loopCreditState.workspaces`.
