---
name: Auto-attach policy (autoStart + body marker)
description: Auto-attach scripts to projects ONLY when project.autoStart is true; use a DOM body marker to detect if a script is already injected on the page
type: feature
---

# Auto-attach Policy

## Rule 1 — Gated by `autoStart` flag

Auto-attaching library scripts to a project happens **only when** the project has `autoStart === true` (project-level flag on `StoredProject`/`ProjectSettings`).

- If `autoStart` is **absent or false** → never auto-attach. User adds scripts manually.
- If `autoStart` is **true** → on project save/create/load, iterate the library and attach any script whose declared `UrlMatches` (from its `instruction.json`) matches `project.url`, and that is not already in `project.scripts`.

This replaces the earlier "always auto-attach if URL matches" default. The flag must be respected as the hard gate.

## Rule 2 — Body marker for "already injected" detection

Before injecting a script into a page, the Chrome extension MUST check the page `<body>` for a marker attribute and skip if present. After successful injection, it MUST stamp the marker.

### Marker shape

Use a single `data-*` attribute on `document.body`:

```
data-marco-injected="<scriptId1>,<scriptId2>,..."
```

- Read: `document.body.getAttribute('data-marco-injected')?.split(',').includes(scriptId)`
- Write (after successful inject): append `scriptId` to the CSV, dedup, re-set the attribute.
- Treat `<body>` as a plain DOM object — no global JS variables, no `window.*` flags (pages can wipe those; attributes survive SPA route changes within the same document).

### Why body attribute (not window global or sentinel div)

- Pages cannot trivially "forget" a body attribute across their own re-renders (React commits don't strip unknown `data-*` on `<body>`).
- Sentinel `<div id="__marco_sentinel__">` already exists for **project applicability hints** (see `src/content-scripts/sentinel-reader.ts`) — that is a different concern (does the extension apply here?). The body marker answers "is THIS script already running here?".
- `window.__marco_injected` would be wiped by SPA route changes that remount the JS context.

## Rule 3 — No silent failures (cross-ref)

If `autoStart === true` and a project URL matches but the bound script is missing from the library, log a FATAL error via `persistInjectionError` tagged `SCRIPT_MISSING_FATAL`. See `mem://standards/no-silent-failures.md`.

## Implementation checkpoints

1. `StoredProject` / `ProjectSettings` — add/confirm `autoStart?: boolean` field.
2. Auto-attach pass in project save flow — gate entirely on `project.autoStart === true`.
3. Injection pipeline (`src/background/auto-injector.ts` + content-script runner) — read body marker before injection; stamp marker after.
4. Diagnostics — log skip-due-to-marker as INFO (not silent), log skip-due-to-autoStart-off as INFO.

## Related

- `mem://standards/no-silent-failures.md`
- `mem://features/new-tab-no-url-guard`
- `src/content-scripts/sentinel-reader.ts` (separate concern: project applicability)
