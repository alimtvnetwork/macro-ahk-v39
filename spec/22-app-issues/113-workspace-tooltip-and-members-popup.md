# 113 — Workspace tooltip + Members popup + Settings-button removal

## Audit (task 02) — call sites

| Surface | Producer | Consumer / entry point |
|---------|----------|------------------------|
| Custom hover card | `ws-hover-card.ts` (`attachWorkspaceHoverCard`, `hideWorkspaceHoverCard`) — pulls content from `status-explainer.ts` | `ws-list-renderer.ts:38` attaches per row |
| **Native browser tooltip** (the second tooltip) | `ws-list-renderer.ts:419` `buildLoopTooltipText(ws)` → `ws-list-renderer.ts:428` `row.title = tooltip` | Browser renders automatically on hover after ~500 ms — overlaps the custom card |
| Inline status chip tooltip | `ws-list-renderer.ts:358` `title="' + tip + '"` on status span | Same row — adds a third native tooltip on the inner chip |
| Tier badge tooltip | `ws-list-renderer.ts:389` `title="' + tip + '"` on tier badge | Same row |
| Settings (gear) button | `settings-button.ts` `buildSettingsButton()` → opens `settings-modal.ts` `showSettingsModal()` | `ui/panel-header.ts:96` mounts it in the panel header |
| Members list | `ws-members-panel.ts` `showWsMembersPanel(wsId, wsName, x, y)` | `ws-context-menu.ts:145` — fired from right-click menu, anchored at click coords |

**Root cause of "two tooltips"**: the custom hover card (`ws-hover-card.ts`) was added to *replace* the native `title=` attribute, but `row.title = tooltip` plus two more inner `title="…"` attributes were never removed. The browser still renders its built-in OS tooltip on hover, layered over the custom card.

**Fix for task 04**: strip the three `row.title` / inner `title="…"` writes in `ws-list-renderer.ts`. The custom hover card already carries the same data (and more). Keep `buildLoopTooltipText()` available only if `ws-hover-card.ts` consumes it as a fallback (it currently does not — it builds its own content via `status-explainer.ts`).



**Status**: ✅ Complete (2026-05-25)
**Area**: `standalone-scripts/macro-controller/src/`
**Related files** (audit pass):
- `ws-hover-card.ts` (457 lines) — primary hover tooltip; suspected first of the duplicate pair
- `status-explainer.ts` (183 lines) — secondary tooltip ("Priority — letter, top wins" explainer); suspected duplicate
- `ws-members-panel.ts` (292 lines) — current Members list; to be promoted to a Rename-style popup
- `ws-members-fetch.ts` — already wired to `marco.api.memberships.search(wsId)` with 5-min cache and `clearMembersCache(wsId)`
- `settings-button.ts` (24 lines) + `settings-modal.ts` (311 lines) — Macro Settings (credits/grace-period). User reports it is non-functional UI; to be removed from the workspace section.
- `workspace-rename.ts` — popup chrome to reuse for the Members panel

## Problem

When hovering the workspace in the Macro Controller script row:

1. **Two tooltips** render simultaneously — the credits/status card AND the priority-letter explainer. The user wants **one**.
2. The single remaining tooltip is too tall/wide. Each fact occupies its own line, including the 3-line Credits block (available / daily / used).
3. The "Priority — letter, top wins" content is always-visible noise; should be **collapsed** by default.
4. **Refill** and **Expires** dates — the most actionable facts — are buried below lower-value rows.
5. Layout is monochrome; lacks color signal for healthy / low / exhausted credits and near-expiry.
6. A **Settings (gear) button** opens a Macro Settings modal exposing credit/grace-period fields the user cannot modify in practice. Dead UI.
7. **Show Members** renders an inline list. Should be a real popup panel (Rename-style) with **Add member**, **Remove member**, **Promote to Owner**.

## Target — tooltip

Single tooltip, ~280px wide, 3 zones:

```text
┌──────────────────────────────────────────┐
│ ● Workspace Name              [Pro plan] │
├──────────────────────────────────────────┤
│ Credits  142 avail / 50 daily / 8 used   │
│ Refill   in 3d (May 22)                  │
│ Expires  in 27d (Jun 15)                 │
├──────────────────────────────────────────┤
│ ▸ Priority rules                         │
└──────────────────────────────────────────┘
```

Color rules (HSL tokens from `index.css`):
| State | Token | Trigger |
|-------|-------|---------|
| healthy | `--success` | available ≥ 50% of daily |
| low | `--warning` | 10%–50% of daily, OR refill/expiry within 24h |
| exhausted | `--destructive` | <10% of daily OR expired |
| info chip | `--accent` | plan label |

Expanded `<details>` reveals the existing letter/top-wins explainer text verbatim — no information removed.

## Target — Members popup

Reuse the Rename panel chrome (`workspace-rename.ts`) — same anchor, animation, dismissal, dark theme.

Sections:
1. Header: "Members — &lt;Workspace&gt;" + close `×`
2. Rows: initials avatar · display_name · email · role chip · `⋯` menu (Promote to Owner · Remove)
3. Footer: `+ Add member` → expands to email input + role select + Send invite

## API contract (to confirm in task 03)

| Action | Method + path (relative to `CREDIT_API_BASE`) | Status |
|--------|----------------------------------------------|--------|
| List | `GET /workspaces/{wsId}/memberships/search?status=active&limit=20` | already wired in `ws-members-fetch.ts` via `marco.api.memberships.search` |
| Invite | `POST /workspaces/{wsId}/memberships/invite` body `{ email, role }` | confirm in SDK |
| Remove | `DELETE /workspaces/{wsId}/memberships/{userId}` | confirm in SDK |
| Promote | `PATCH /workspaces/{wsId}/memberships/{userId}` body `{ role: "owner" }` | confirm in SDK |

Fail-fast (no retry/backoff per `mem://constraints/no-retry-policy`). Errors surface via toast. After any mutation: call `clearMembersCache(wsId)` then re-fetch.

## Out of scope

- Backend; consume existing endpoints only.
- Restyling of other Macro Controller surfaces.
- Editing credit/grace-period values (user confirmed not modifiable).

## Acceptance

- Hovering the workspace renders exactly one tooltip element in the DOM.
- Tooltip width ≤ 320px; visible facts ≤ 5 rows before expansion.
- Credits row uses one of `--success | --warning | --destructive` for the available number.
- Refill + Expires rows present with relative + absolute date.
- Priority rules content lives inside `<details>` (closed by default).
- Settings (gear) button no longer rendered in the workspace section; `settings-modal.ts` import removed from that surface.
- Members trigger opens a popup (not an inline list). Add / Remove / Promote all hit the documented endpoints and invalidate the cache on success.
- Vitest coverage exercises tooltip structure + members panel dispatch.
