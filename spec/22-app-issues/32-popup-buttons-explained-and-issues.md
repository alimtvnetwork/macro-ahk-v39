# Issue 32: Popup Buttons — Explained & Known Issues

> Originally filed as Issue #35a — renumbered to slot 32 on 2026-04-22 to remove duplicate `35-` prefix collision.

**Version**: v1.0.5
**Date**: 2026-03-12
**Status**: Resolved (v1.16.2)

---

## Part 1: Button Reference Guide

### Top Row — Project Controls

| Button | ID | What it does |
|--------|-----|--------------|
| **▶ Run** | `btn-run-project` | Injects **all enabled scripts** from the active project into the current tab. Clears DOM markers first (clean slate), then calls `INJECT_SCRIPTS`, then tries to show the loop panel (`__loopShowPanel`). Same as Re-inject. |
| **⏹ Stop** | `btn-stop-project` | **Placeholder only** — logs "not yet implemented." Does nothing. |
| **🔀 Toggle** | `btn-toggle-project` | Toggles the active state of the project (visual only for now). Reloads popup. |
| **⌨ Keys** | `btn-shortcuts` | Opens `chrome://extensions/shortcuts` to configure keyboard shortcuts. |

### Actions & Status Panel

| Button | ID | What it does |
|--------|-----|--------------|
| **▶ Run** | (same as top) | Identical to the top-row Run button — injects all enabled scripts. |
| **🔁 Re-inject** | `btn-reinject-all` | Identical to Run. Removes DOM markers (`ahk-loop-script`, `ahk-combo-script`, `marco-auth-panel`, `marco-controller-marker`) → injects all enabled scripts → calls `__loopShowPanel()` → shows injection results panel. |
| **📋 Logs** | `btn-copy-logs` | Sends `GET_SESSION_LOGS` to background → copies session logs + errors as JSON to clipboard. Does **not** display logs in popup — clipboard only. |
| **💾 Export** | `btn-export` | Sends `EXPORT_LOGS_ZIP` to background → downloads a ZIP file containing logs + errors + database as `marco-export-YYYY-MM-DD.zip`. |

### Per-Script Row

| Element | What it does |
|---------|--------------|
| **Toggle switch** (green circle) | Sends `TOGGLE_SCRIPT` with the script's ID → flips `isEnabled` in storage. Disabled scripts are dimmed and skipped during injection. |
| **Reinject button** (per-script) | ⚠️ **DEAD BUTTON — no click handler is bound.** See Issue A below. |

### Debug Panel (bottom)

| Button | What it does |
|--------|--------------|
| **📋 Copy** | Copies all debug panel responses (Run, Re-inject, Logs, Export) to clipboard. |
| **🗑️ Clear** | Clears the debug log history and hides the panel. |

---

## Part 2: Known Issues

### Issue A: Per-Script "Reinject" Button Does Nothing

**Severity**: P1 — Confusing dead UI

**What happens**: Each script row has a "Reinject" button rendered in HTML:
```html
<button class="btn-small" data-script="macro-controller.js">Reinject</button>
```

**Root cause**: The button is rendered by `buildScriptRowHtml()` in `popup-scripts.ts` (line 181), but **no click handler is ever bound** to `.btn-small[data-script]` elements. Only toggle switches get event listeners in `bindToggleSwitches()`.

**Where the gap is**: `popup-scripts.ts:renderScriptRows()` calls `bindToggleSwitches(container)` after rendering, but there is no corresponding `bindReinjectButtons(container)` function.

**Expected behavior**: Clicking the per-script Reinject should:
1. Inject only that single script (not all scripts)
2. Show feedback (spinner → success/fail)
3. Log the action in the action status panel

**Fix needed**: Add a `bindReinjectButtons()` function in `popup-scripts.ts` that:
- Queries `.btn-small[data-script]`
- On click, sends `INJECT_SCRIPTS` with only that script's entry
- Shows per-button feedback

---

### Issue B: No UI Injected on Page After Script Runs

**Severity**: P2 — User cannot see any visual feedback on the target page

**What happens**: After clicking Run/Re-inject:
1. The popup shows "✅ Injected!" and the injection results panel shows success
2. Console shows `[Marco Controller v1.0.0] Loaded | Project: macro-ahk-v31`
3. But **no visible UI panel** appears on the target page

**Root cause (multiple factors)**:

1. **`__loopShowPanel` is only for macro-looping.js**: After injection, the popup calls `window.__loopShowPanel()`. This function is defined by macro-looping.js, NOT by macro-controller.js. If macro-looping is disabled (toggle off), `__loopShowPanel` doesn't exist → nothing happens.

2. **macro-controller.js auth panel may require conditions**: The controller script creates a `marco-auth-panel` element, but it may only render when certain conditions are met (valid session, correct URL pattern, etc.). On non-matching pages, no panel is shown by design.

3. **CSP interference**: The console shows a CSP violation warning (`unsafe-eval`). While marked as "report-only" (not blocking), this may affect some script behavior depending on the target site's CSP policy.

**Fix needed**:
- Macro-controller should expose a `__controllerShowPanel()` global for the popup to call after injection
- The popup `handleReinjectAll` should call both `__loopShowPanel()` and `__controllerShowPanel()`
- Consider adding a visual indicator on the page (e.g., a small floating badge) to confirm scripts are active

---

### Issue C: Toggle Field Name Mismatch (Fixed in v1.0.5)

**Severity**: P1 — Toggle had no effect

**What happened**: The popup sent `{ type: TOGGLE_SCRIPT, scriptId: "..." }` but the background handler destructured `{ id: "..." }`.

**Fix applied**: Changed popup to send `{ id: scriptId || scriptPath }`.

---

### Issue D: Per-Script Reinject Produces No Logs

**Severity**: P2 — Related to Issue A

**What happens**: Since the per-script Reinject button has no click handler (Issue A), clicking it produces no logs, no action status entry, and no debug panel output.

**Root cause**: Same as Issue A — no event listener bound.

---

## Part 3: Run vs Re-inject — Are They Different?

**No.** Currently `Run` and `Re-inject` execute the **exact same code path** (`handleReinjectAll`). Both:
1. Query the active tab
2. Remove DOM markers
3. Send `INJECT_SCRIPTS`
4. Call `__loopShowPanel()`
5. Render injection results

The only visual difference is the button label. In a future version, they could diverge:
- **Run** = inject without clearing markers (additive)
- **Re-inject** = clear markers first, then inject (clean slate)

But today they are identical.

---

## Done Checklist

- [x] All popup buttons documented with IDs and behavior
- [x] Issue A: Dead per-script Reinject button identified
- [x] Issue B: Missing page UI after injection root-caused
- [x] Issue C: Toggle field mismatch documented (already fixed)
- [x] Issue D: No logs from per-script Reinject explained
- [x] Fix Issue A: Add `bindReinjectButtons()` handler — ✅ Already implemented in `popup-scripts.ts`
- [x] Fix Issue B: Expose `__controllerShowPanel()` — ✅ Already implemented in `popup-panel-reveal.ts` (dual-world reveal)
