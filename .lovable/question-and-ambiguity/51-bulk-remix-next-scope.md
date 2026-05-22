# Q51 — Bulk Remix Next: target scope

**Context:** P3 backlog item says "Bulk Remix Next — toolbar button to remix every workspace's current project in sequence." Semantics of "every workspace's current project" are not defined; remix today operates on a single (projectId, workspaceId, currentName) tuple.

## The ambiguity

Each workspace can hold many projects. "Current project" is well-defined only for the active workspace (the one in the URL). For the other workspaces in `loopCreditState.perWorkspace`, there is no per-workspace "current project" stored anywhere in the extension.

## Options

### A. Bulk-iterate the open workspaces panel (rename: "Remix Next across selected projects")
Run Remix Next over every workspace row the user has already checked in the workspace panel, treating the user's checked selection as the input set. Each row already exposes `(projectId, workspaceId, projectName)` via `ws-context-menu` data, so no new data plumbing is needed.

- **Pros:** Reuses today's selection UX; no new state; matches the controller's existing "checked workspaces" mental model.
- **Cons:** Renames the feature; user must manually check items first.

### B. Active-workspace only (degenerate "bulk")
Just one project: the active workspace's current project. Toolbar button does the same thing as the existing Remix Next.

- **Pros:** Zero ambiguity.
- **Cons:** Not actually bulk; redundant button.

### C. Track last-visited project per workspace, then iterate all workspaces
Add a session map `Map<workspaceId, {projectId, projectName}>` populated whenever the user navigates into a project, then iterate every workspace that has an entry.

- **Pros:** Closest literal reading of the spec.
- **Cons:** Significant new state + lifecycle code; only works for workspaces the user has visited this session; surprising behavior (remixing projects the user isn't looking at).

## Recommendation

**Option A.** Cleanest fit with current data + UX, smallest blast radius, no new persistence. Reframe the backlog item as "Bulk Remix Next across checked workspaces" and add a button to the workspace panel header that runs Remix Next sequentially (fail-fast per `no-retry-policy`) for every checked row, recording each into the new remix-history pane.

## Decision

Pending. Skipping implementation this loop and moving to a different P3 instead.


## Resolution (2026-05-22)
Implemented Option A: `remix-bulk.actionBulkRemixNext()` iterates `getLoopWsCheckedIds()`, fetches `projects.list` per ws, prefers family-matched project (base name minus V-suffix) and falls back to first entry. Header dropdown gains `🚀 Bulk Remix Next` with live checked-count sublabel. Sequential per `no-retry-policy`; final toast = N/M succeeded.
