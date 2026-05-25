# Ambiguity 01 — Credit Totals upgrade + Macro/Prompts UX

**Logged:** 2026-05-25 (No-Questions Mode active)
**Source request:** User voice-style message asking for drag-drop / sorting / filtering / project-count / colour / fonts / CSV in the Credit Totals modal, plus Macro no-autorun + Plan Task RCA + Prompts panel layout fix.

---

## A1 — "Drag-drop feature" — drag what, to where?

**Recommendation:** Drag to **reorder workspace rows inside the Credit Totals modal** (persisted per-user via `chrome.storage.local`, key `creditTotalsRowOrder`). Manual order is cleared when the user picks a column sort, with a confirmation chip ("Sorted — clear manual order?").

**Pros:** Matches the screenshot (a table), aligns with existing per-row UX, no cross-window contracts to invent.
**Cons:** Doesn't help if user actually meant "drag a workspace row onto another panel/tab to move/copy something".
**Alternatives:**
  a. Drag rows between workspaces (move projects) — too risky without spec.
  b. Drag-resize columns — useful but smaller win.

## A2 — "More colorful on the numbers"

**Recommendation:** Tonal per-column tint using existing tokens — **Used = amber**, **Rem = green** (cyan when ≤5 to flag near-empty), **Total = muted blue**. Keep monospaced/tabular-nums. Plan badge already uses tone classifier.

**Pros:** Reuses palette, no new tokens, signals semantics at a glance.
**Cons:** May clash with very-low-credit highlighting; mitigated by switching Rem→cyan threshold.
**Alternatives:** Full rainbow (rejected — overload), data-bar inside cells (rejected — extra layout).

## A3 — "Filter all kinds we have on the workspace side"

**Recommendation:** Port the **exact** chip set from the panel: All / Refill-soon / Pro / Free / Members-only / Search. Reuse `workspace-refill-priority.ts` predicates verbatim.

**Pros:** Single source of truth, zero divergence.
**Cons:** Some chips may be redundant in modal context.

## A4 — "Double-click a workspace → see projects + project count"

**Recommendation:** Add a `PROJECTS` count column (cached via `projects-cache.ts`) and double-click a row to expand an inline sub-panel listing each project (name + last-modified, lazy-loaded). Esc / click again collapses.

**Pros:** Keeps modal as single source; lazy load keeps it fast.
**Cons:** First expand may pay a fetch cost; mitigated by cache.

## A5 — "Bigger fonts"

**Recommendation:** Bump base font 10→12px, header 9→11px. Tabular nums preserved.

## A6 — "Plan Next dropdown not on right-hand side"

**Recommendation:** Move the **Task Next + Plan Task** combo out of the prompts list, render as a right-anchored dropdown attached to the prompts panel's right edge.

## A7 — "Macro should NOT auto-execute. Other scripts MAY."

**Recommendation:** Introduce `autoStartAllowed` flag flipped only by an explicit user gesture (click on Check / ▶ / a panel button). Loop engine entry hard-blocks programmatic start with CODE-RED log. Dashboard + payment-banner-hider scripts continue auto-running unchanged.

## A8 — "Plan Task button doesn't work properly"

**Likely RCA (to be confirmed in Step 1):**
  1. Submenu `onmouseleave` 120ms timeout closes the panel before the click registers when the cursor crosses a 1-px border.
  2. Clicking from a page without a Lovable editor (e.g. dashboard) silently fails because the toast appears after dropdown close.
  3. `parseInt(inp.value)` missing radix (works in browsers but flagged by lint).

Fix in Step 2 — full plan in `.lovable/plans/credit-totals-and-macro-ux-20-step.md`.
