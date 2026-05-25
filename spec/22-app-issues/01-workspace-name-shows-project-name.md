# Issue 01: Workspace Name Shows Project Name

**Version**: v7.9.16
**Date**: 2026-02-22
**Status**: Resolved

---

## Issue Summary

### What happened

The MacroLoop controller's status bar (yellow highlighted text) intermittently displayed the **project name** (e.g., "macro-ahk-v37") instead of the **workspace name** (e.g., "P07 D2V7 Orinmax's Lovable v5").

### Where it happened

- **Feature**: MacroLoop controller — workspace name display in status bar
- **Files**: `marco-script-ahk-v7.latest/macro-looping.js`
- **Functions**: `autoDiscoverWorkspaceNavElement()`, `startWorkspaceObserver()`, `fetchWorkspaceName()`, `fetchWorkspaceNameFromNav()`

### Symptoms and impact

- The yellow-highlighted name in the status bar showed "macro-ahk-v37" (the project name) instead of the actual workspace name.
- This was intermittent: sometimes the API-based detection would correct it, sometimes it would not (depending on timing).
- Caused confusion about which workspace the project was actually in.
- "Focus Current" could fail because it tried to match the project name against the workspace list.

### How it was discovered

User reported that the highlighted section sometimes shows the project name instead of the workspace name. Screenshot showed "macro-ahk-v37" highlighted in yellow in the MacroLoop controller status bar.

---

## Root Cause Analysis

### Direct cause

`autoDiscoverWorkspaceNavElement()` scans the top-left nav area for text elements and picks the first candidate. On Lovable.dev, the **project name** appears in the nav area alongside (or instead of) the workspace name. The function has no way to distinguish between a project name and a workspace name — it just picks the first visible text element with `y < 80`.

### Contributing factors

1. **No validation**: DOM-discovered names were blindly set as `state.workspaceName` without checking if the name actually corresponds to a known workspace.
2. **Race condition**: The workspace observer starts immediately on init (line ~3374), while `fetchLoopCredits` + `autoDetectLoopCurrentWorkspace` runs 2 seconds later. The observer sets the wrong name first; the API may or may not correct it depending on timing and network speed.
3. **Observer clobbering**: Even when the API correctly set the workspace name, subsequent DOM mutations could trigger the observer to overwrite it with the project name again.

### Triggering conditions

- The project name appears in the nav area before the workspace name element.
- The workspace list hasn't loaded yet when the observer first fires.
- SPA re-renders cause the observer to re-read the nav element and overwrite the API-detected name.

### Why the existing spec did not prevent it

The spec (`spec.md`) did not include any rule requiring DOM-discovered names to be validated against a known workspace list. The "Known-Good State Wins" principle (v7.9.2) protected against API fallbacks clobbering user-driven changes, but did not address DOM observers setting invalid names in the first place.

---

## Fix Description

### What was changed in the spec

1. Created `/spec/21-app/02-features/macro-controller/workspace-detection.md` with explicit rules for workspace name detection.
2. Added **Critical Rule**: "DOM-Discovered Names Must Be Validated" — any name from DOM scraping must pass `isKnownWorkspaceName()` before being accepted.
3. Added acceptance criteria that the status bar MUST show a workspace name from the workspace list, never a project name.

### The new rules or constraints added

- **Validation gate**: All DOM-based workspace name setters (`fetchWorkspaceName`, `fetchWorkspaceNameFromNav`, `startWorkspaceObserver` init read, observer mutation callback) must call `isKnownWorkspaceName(name)` and reject names that don't match.
- **Graceful fallback**: If no workspaces are loaded yet, names are allowed through (the API will correct later). If workspaces are loaded and the name doesn't match, it is silently ignored with a debug log.

### Why the fix resolves the root cause

The project name "macro-ahk-v37" does not appear in the workspace list (workspaces have names like "P07 D2V7 Orinmax's Lovable v5"). By validating against the list, the observer will reject "macro-ahk-v37" and leave `state.workspaceName` empty until the API correctly identifies the workspace.

### Config changes or defaults affected

None. The fix is entirely in JS logic.

### Logging or diagnostics required

- New log messages: `"not a known workspace — skipping"` and `"not a known workspace — ignoring"` at debug level when a DOM-discovered name is rejected.

---

## Iterations History

**Iteration 1 (final)**: Added `isKnownWorkspaceName()` validation function that checks exact and partial case-insensitive matches against `loopCreditState.perWorkspace`. Applied the validation gate to all four DOM-based name detection paths. Resolved on first attempt.

---

## Prevention and Non-Regression

### Prevention rule

> **RULE**: Never set `state.workspaceName` from a DOM source without first validating the name against the loaded workspace list via `isKnownWorkspaceName()`. Only API-based detection (`autoDetectLoopCurrentWorkspace`) is exempt because it matches by `workspace_id`, not by scraped text.

### Acceptance criteria / test scenarios

1. Load MacroLoop controller on a project with multiple workspaces. The status bar should show the correct workspace name (from API), not the project name.
2. Trigger SPA navigation (e.g., switch pages). The status bar should not flash the project name.
3. If WorkspaceNavXPath points to the project name element, the status bar should remain empty until the API detects the correct workspace.

### Guardrails

- The `isKnownWorkspaceName()` function is called in 4 locations. If any new DOM-based workspace detection is added, it MUST also use this function.

### References to spec sections updated

- `/spec/21-app/02-features/macro-controller/workspace-detection.md` — "Critical Rule: DOM-Discovered Names Must Be Validated"
- `/spec/21-app/02-features/macro-controller/workspace-detection.md` — "Known Pitfalls and Prevention" table

---

## TODO and Follow-Ups

1. [ ] Monitor logs for `"not a known workspace"` messages to verify the fix catches all cases in production.
2. [ ] Consider adding the same validation to `combo.js` if similar issues arise (currently ComboSwitch uses `__wsCurrentName` from Transfer dialog DOM, which is reliable).

---

## Done Checklist

- [x] Spec updated under `/spec/21-app/02-features/macro-controller/workspace-detection.md`
- [x] Issue write-up created under `/spec/22-app-issues/01-workspace-name-shows-project-name.md`
- [x] Memory updated with summary and prevention rule
- [x] Acceptance criteria updated
- [x] Iterations recorded (single iteration)
