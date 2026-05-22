# 21-app · Chrome Extension

App-specific Chrome extension specs that build on the generic baseline in `spec/26-chrome-extension-generic/`.

## Subfolders

| Folder | Scope |
| --- | --- |
| `home-screen-modification/` | Options-page Home view layout, widgets, and interaction rules. |
| `standalone-scripts-types/` | Type contracts for the standalone-script registry (Recorder, Replay, Credit Monitor, etc.). |

## Relationship to the generic spec

- The generic spec (`spec/26-chrome-extension-generic/`) defines reusable MV3 patterns — manifest, message relay, storage tiers, release pipeline.
- This folder captures **only** the deltas that are specific to the Marco product: UI surfaces, feature wiring, and registered scripts.
- When a rule applies to every MV3 extension, it belongs in `26-`, not here.

## Conventions

- One feature per subfolder; each subfolder owns a `readme.md` and numbered spec files.
- Cross-reference the generic spec by relative path, never by duplication.
- Follow `spec/01-spec-authoring-guide/` for numbering, frontmatter, and exception handling.
