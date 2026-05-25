# Workspace Detection Specification

**Last Updated**: 2026-02-25 (v7.17)

## Overview

The MacroLoop and ComboSwitch controllers must display the **current workspace name** (e.g., "P07 D2V7 Orinmax's Lovable v5") — never the project name (e.g., "macro-ahk-v37").

---

## Source Priority (MacroLoop) — 2-Tier Hierarchy (v7.17)

> **Note**: The mark-viewed API (formerly Tier 1) was **removed in v7.17**. Detection is now XPath-only.

1. **Tier 1 — Project Dialog DOM** (`detectWorkspaceViaProjectDialog`): Clicks `ProjectButtonXPath` to open the project dialog → waits up to 1500ms → reads workspace name from `WorkspaceNameXPath` (uses `getAllByXPath` + iterate-and-validate since v7.10.2) → validates against known workspaces → closes dialog. **Primary detection method.**
2. **Tier 2 — Default**: Falls back to `perWorkspace[0]` (first workspace). **Last resort only.**

### Manual Check Button — XPath-Only (v7.17)

`runCheck()` performs pure XPath-based detection:

1. Clear `state.workspaceName` to force fresh detection
2. If no workspaces loaded, attempt credit fetch — but **proceed to XPath detection regardless of API result** (even on 401)
3. Click `ProjectButtonXPath` → read workspace name from dialog XPath
4. Validate via `isKnownWorkspaceName()` (if workspace list available)
5. Check progress bar XPath for busy/idle status
6. Refresh credits via `syncCreditStateFromApi()` → `updateUI()`

**Guard**: Only executable when loop is stopped OR countdown ≤ 10 seconds.

**No `mark-viewed` API call. No `workspaceFromApi` flag.** Pure DOM operation.

## Source Priority (ComboSwitch) — 2-Tier Hierarchy (v7.17)

> **Note**: Same as MacroLoop — mark-viewed API removed.

1. **Tier 1 — Project Dialog DOM** (`detectWorkspaceViaProjectDialogCombo`): Clicks `ProjectButtonXPath` → reads `WorkspaceNameXPath` → validates → closes dialog.
2. **Tier 2 — Default**: Falls back to `perWs[0]` (last resort only).
3. **Transfer dialog DOM**: During active combo switch, reads workspace name from COMBO1 dialog text — authoritative for that operation.

---

## Token Expiry Handling (v7.17)

When the credit API (`GET /user/workspaces`) returns 401 or 403:
1. `markBearerTokenExpired('loop')` is called immediately
2. UI shows "Bearer Token 🔴 EXPIRED — replace token!" with recovery buttons
3. XPath detection proceeds normally — workspace detection does NOT depend on credit API

---

## Critical Rule: DOM-Discovered Names Must Be Validated

**Rule**: Any name obtained from DOM scraping (observer, XPath, auto-discovery, project dialog) MUST be validated against the known workspace list before being set as `state.workspaceName`.

**Validation function**: `isKnownWorkspaceName(name)` — checks exact and partial (case-insensitive) matches against `loopCreditState.perWorkspace`.

**Exception**: If no workspace list is loaded yet (`perWorkspace.length === 0`), XPath detection still runs — the raw workspace name is set without validation and will be validated on next credit fetch.

---

## Known Pitfalls and Prevention

| Pitfall | Prevention | Issue Reference |
|---------|-----------|-----------------|
| DOM observer picks up project name instead of workspace name | `isKnownWorkspaceName()` validation on all DOM-sourced names | [`/spec/22-app-issues/01`](../../../22-app-issues/01-workspace-name-shows-project-name.md) |
| API detection fallback preserves invalid workspace name | `isKnownWorkspaceName()` validation on all "keep existing" fallback paths | [`/spec/22-app-issues/03`](../../../22-app-issues/03-progress-bar-missing-granted-stale-workspace.md) |
| Credit API returns 401 → detection aborts | `runCheck()` falls through to XPath regardless of API status (v7.17 fix) | plan.md v7.17 RCA |
| Reverse DOM lookup matches random body text (e.g., "Preview") | Replaced with explicit project dialog click → XPath read | v7.9.25 |
| `LoopControlsXPath` points to wrong DOM node | Controller injection fails silently; updated from `div[2]` to `div[3]` (v7.17) | plan.md v7.17 RCA |

---

## Acceptance Criteria

1. The yellow status bar text in MacroLoop MUST show a workspace name from the workspace list, never a project name.
2. If no workspace is detected yet, the field should be empty (not a random nav text).
3. After `fetchLoopCredits` + `autoDetectLoopCurrentWorkspace` completes, the workspace name MUST match the XPath-detected workspace.
4. Project dialog MUST be opened and workspace name read from XPath before defaulting.
5. DOM observer mutations that don't match any known workspace MUST be silently ignored with a debug log.
6. Check button MUST work even when credit API returns 401/403 (token expired).
7. **V2 Phase 01**: The workspace name set by API response (via `fetchLoopCredits` → `syncCreditStateFromApi` → `autoDetectLoopCurrentWorkspace` Tier 1 match) is **authoritative**. DOM detection (`detectWorkspaceViaProjectDialog`) and `perWs[0]` fallback MUST NOT override an API-sourced name when `state.workspaceFromApi === true`. Ref: `spec/21-app/02-features/macro-controller/ts-migration-v2/01-initialization-fix.md`.
8. **V2 Phase 01**: UI (`createUI()`) MUST NOT render before workspace data has been fetched or a 5s timeout has elapsed. Ref: `startup.ts` bootstrap flow.
9. **V2 Phase 01**: `ensureProjectDialogOpen()` MUST return `false` if `loopCreditState.perWorkspace` is empty (workspaces not yet loaded).

---

## Debugging Guidance

- Check "Activity Log" for lines containing `Opening project dialog` to see if dialog detection triggered.
- If workspace name is blank, check if `fetchLoopCredits` completed successfully (look for "Credit API: display updated").
- If workspace name is wrong, verify `autoDetectLoopCurrentWorkspace` log shows `✅ Workspace detected from project dialog`.
- Check `WorkspaceNameXPath` freshness if dialog fallback fails (look for "WorkspaceNameXPath not found after").
- If "Bearer Token 🔴 EXPIRED" shows, paste a new token or use "🍪 Cookie" recovery button.
