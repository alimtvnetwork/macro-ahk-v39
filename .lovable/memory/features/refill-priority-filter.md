---
name: Refill Priority Filter
description: Score = max(0, K - daysToRefill) * available; K=REFILL_PRIORITY_WINDOW_DAYS=10; descending sort filter + inline "R Nd" badge
type: feature
---

# Refill Priority Filter (v3.10.0)

**Constant:** `REFILL_PRIORITY_WINDOW_DAYS = 10` in
`standalone-scripts/macro-controller/src/constants.ts`.

**Score formula:**
```
urgency = max(0, K - daysToRefill)
score   = urgency * availableCredits
```
Sort **descending** by `score`. Tie-break: ascending `daysToRefill`, then
descending `available`. Workspaces with no refill date → `score = -1`
(bottom).

**Filter UI:** new row in `ws-filter-menu.ts` with id
`loop-ws-refill-priority-filter`, icon ⏳, label "Refill priority",
hint "urgency × credits". Default OFF. Pure sort — does NOT hide rows.

**Badge:** inline `R Nd` chip next to `.loop-ws-name` whenever
`0 ≤ daysToRefill ≤ K`. Color tiers per spec
`spec/22-app-issues/refill-priority-filter/01-overview.md` §4.

**Spec:** `spec/22-app-issues/refill-priority-filter/01-overview.md`
**Plan:** `.lovable/plans/v3.10.0-refill-priority-and-github-open.md`
