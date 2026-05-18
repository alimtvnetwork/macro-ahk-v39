# Automator — Future Work Roadmap

**Last Updated**: 2026-04-15
**Active Codebase**: `marco-script-ahk-v7.latest/` (v7.23)
**Macro Controller**: v2.139.0
**Chrome Extension**: v2.139.0
**Detailed Plan**: `.lovable/plan.md`
**Suggestions Tracker**: `.lovable/memory/suggestions/01-suggestions-tracker.md`
**Completed Plans**: `.lovable/memory/workflow/completed/`
**Issue Write-Ups**: `/spec/22-app-issues/`
**Risk Report**: `.lovable/memory/workflow/03-reliability-risk-report.md`

---

## 🆕 Release Page CI/CD Hardening Plan — 8 Steps (queued)

**Trigger**: User reported that a release tag was created, but the GitHub Release page has no Chrome extension ZIP or other built ZIP assets, and the release-page changelog/notes did not update correctly.

**Status**: Plan written only. Awaiting `next` to implement Step 1.

**Root cause found from repo evidence**:
- A tag/source archive alone is not a real Marco release. The expected ZIPs/installers are uploaded only by `.github/workflows/release.yml` via `softprops/action-gh-release@v2` and `files: release-assets/*`.
- `.gitmap/release/v2.250.0.json` currently records `"assets": []`, which confirms the metadata/tag exists but does not prove built assets were uploaded.
- `release.yml` has a manual `workflow_dispatch` recovery path, but checkout currently uses the workflow ref/default branch, not necessarily the requested release tag. A manual replay can therefore build/upload assets and release notes from the wrong commit.
- Release notes currently pick `PREV_TAG=$(git tag --sort=-version:refname | ... | head -1)`. On a tag-triggered run, that can select the current tag as the "previous" tag, making the generated changelog range `${VER}..HEAD` empty or misleading.
- The workflow packages the Chrome extension from the correct folder (`chrome-extension/`, not `chrome-extension/dist/`), but it needs stronger required-asset verification before publishing so missing ZIPs cannot silently reach the Release page again.
- Memory updated: `mem://constraints/release-assets-publish-contract` now records that a Release is invalid until built ZIPs, installers, checksums, changelog, and release notes are uploaded.

### Step 1 — Fix release checkout/ref resolution

- Update `.github/workflows/release.yml` so every mode resolves one canonical release version/ref:
  - tag push: `refs/tags/vX.Y.Z`
  - release branch push: `release/vX.Y.Z`
  - workflow dispatch: validate the provided `vX.Y.Z` tag exists remotely and check out that exact tag/ref
- Add fail-fast errors with exact path/reason if the requested tag/ref is missing.
- Acceptance: manual replay for an existing tag builds the code from that tag, not the default branch head.

### Step 2 — Fix release-notes changelog range

- Exclude the current `${VER}` tag when selecting the previous release tag.
- Prefer the nearest lower SemVer tag (example: current `v2.250.0` should use `v2.249.5..HEAD`, not `v2.250.0..HEAD`).
- Add a fallback when no previous tag exists.
- Acceptance: generated `RELEASE_NOTES.md` includes the actual changes since the previous release and does not collapse to an empty range.

### Step 3 — Add required release-asset verification before publish

- Add a verification step after packaging and before `softprops/action-gh-release`.
- Required assets:
  - `marco-extension-${VER}.zip`
  - `macro-controller-${VER}.zip`
  - `marco-sdk-${VER}.zip`
  - `xpath-${VER}.zip`
  - `install.ps1`
  - `install.sh`
  - `VERSION.txt`
  - `changelog.md`
  - `checksums.txt`
  - `RELEASE_NOTES.md`
- `prompts-${VER}.zip` remains required only when `standalone-scripts/prompts/` exists.
- Validate non-empty files and minimum ZIP sizes where appropriate.
- Acceptance: the workflow fails before GitHub Release creation/update if any required artifact is missing or suspiciously small.

### Step 4 — Make Release page install/download instructions complete

- Ensure generated `RELEASE_NOTES.md` includes one-liners for:
  - Windows PowerShell pinned install: `irm https://github.com/${REPO}/releases/download/${VER}/install.ps1 | iex`
  - Linux/macOS Bash pinned install: `curl -fsSL https://github.com/${REPO}/releases/download/${VER}/install.sh | bash`
  - Latest-channel PowerShell and Bash one-liners from `raw.githubusercontent.com`.
- Add direct manual download guidance for `marco-extension-${VER}.zip` and the load-unpacked Chrome steps.
- Add a concise assets table listing every ZIP and installer.
- Acceptance: the GitHub Release body itself is enough to install or manually download every shipped artifact.

### Step 5 — Add a release-audit workflow for existing tags

- Create `.github/workflows/audit-releases.yml` with `workflow_dispatch` and a scheduled check.
- It should query GitHub Releases for `v*` tags and fail if a release is missing required built assets.
- It must distinguish GitHub auto source archives from real uploaded assets.
- Step summary should list each checked version and missing asset names.
- Acceptance: a release page with only source archives is reported as failed, not silently accepted.

### Step 6 — Update release documentation and RCA references

- Update `spec/21-app/02-features/chrome-extension/release-procedure.md` with the corrected manual replay behavior and the required asset list.
- Update `pipeline/03-release-workflow.md` to match the hardened workflow.
- Add/update a concise issue note under `.lovable/cicd-issues/` and index it in `.lovable/cicd-index.md` per project memory.
- Acceptance: docs explain exactly why the tag-only/source-archive state happened and how to recover it without creating another bad release.

### Step 7 — Validate without publishing a real release

- Run non-build/static checks only where possible:
  - YAML/schema inspection for new workflow structure.
  - Targeted script tests if a helper script is introduced.
  - Version/changelog/readme consistency checks after docs changes.
- Do not manually publish, push tags, or send CI notifications.
- Acceptance: local verification confirms the workflow text, asset list, and generated notes logic are internally consistent.

### Step 8 — Final version bump and changelog

- Bump the release version after all CI/CD fixes are complete.
- Ambiguity logged in `.lovable/question-and-ambiguity/49-release-version-bump-target.md`: current version is `v2.250.0`; a SemVer major bump is `v3.0.0`. Literal `v2.1.0` would be a downgrade and should not be used unless the user explicitly overrides.
- Update unified version references across manifest/constants/standalone instruction manifests.
- Add a top changelog entry summarizing the release-page CI/CD hardening.
- Update root `readme.md` pinned release references to the final version.
- Acceptance: `scripts/check-version-sync.mjs` and changelog/readme checks pass, then the user can release from Git.

### Remaining items

1. [ ] Step 1 — Fix release checkout/ref resolution.
2. [ ] Step 2 — Fix release-notes changelog range.
3. [ ] Step 3 — Add required release-asset verification before publish.
4. [ ] Step 4 — Make Release page install/download instructions complete.
5. [ ] Step 5 — Add release-audit workflow for existing tags.
6. [ ] Step 6 — Update release documentation and RCA references.
7. [ ] Step 7 — Validate without publishing a real release.
8. [ ] Step 8 — Final major version bump to `v3.0.0` unless explicitly overridden, plus changelog/readme updates.

---

## ✅ 2026-04-27 → 2026-05-16 — Open Lovable Tabs → Workspace Mapping (Closed)

**Trigger**: User asked for a Macro Controller panel that lists all open Lovable tabs and shows which workspace each tab is bound to, then asked for automatic per-tab workspace detection via the existing message bus.
**Status**: ✅ Implemented, hardened, documented. Spec: `spec/22-app-issues/111-open-tabs-workspace-mapping.md`. Memory: `mem://features/macro-controller/open-tabs-workspace-mapping` (written 2026-05-16, v2.249.0).
**Closed items**:
1. ✅ `mem://features/macro-controller/open-tabs-workspace-mapping` written (2026-05-16, v2.249.0).
2. ⏭ Page-responder unit test — deferred per `mem://preferences/deferred-workstreams` (React/component tests skipped).
3. ⏭ Relay 600 ms timeout test — deferred (same reason).
4. ✅ `LOVABLE_TAB_PATTERNS` deduped into `src/shared/lovable-tab-patterns.ts` (v2.249.0). All 5 consumers import it.
5. ✅ LOG-1 compliance: `emitProbeFailure()` classifies `NoTabId | NoReceiver | EmptyResponse | ProbeFailed | Exception` and logs via `logBgError(BgLogTag.OPEN_TABS, …)` with `Reason` + `ReasonDetail` (v2.248.0).

---


## 🆕 2026-04-25 — Idle Loop Audit Round 2 (recorded — no code changes yet)


**Trigger**: User asked to re-sweep the codebase for background loops/timers/intervals/observers running idly that could harm performance. Previous sweep yielded PERF-1..PERF-8, all fixed and verified in source.
**Status**: All PERF-1..8 fixes confirmed still present (hot-reload prod gate ✅, error-badge self-clearing interval ✅, auth-diag self-clearing interval ✅, redock generation token ✅, network-reporter re-injection guard + pagehide teardown ✅, popup visibility-pause ✅, toast queue SDK-miss bailout ✅).
**Memory**: `.lovable/memory/performance/idle-loop-audit-2026-04-25.md` (rewritten with full Round 2 findings).
**Method**: `rg` for `setInterval|setTimeout|MutationObserver|chrome.alarms|while(true)`; manually inspected every callsite; confirmed prior fixes; flagged only NEW issues with concrete failure modes.

### New findings — to fix later (each gets its own RCA before any change, per task-execution pattern)

| ID | Severity | File:line | Issue | Status |
|---|---|---|---|---|
| PERF-9  | High   | `standalone-scripts/macro-controller/src/loop-controls.ts:308-328` | Status-refresh interval drift on running↔stopped transitions. | ✅ Fixed (verified 2026-05-16) — `state.statusRefreshPeriodMs` tracked; clearInterval + reinstall on mismatch. |
| PERF-10 | High   | `src/hooks/use-token-watchdog.ts:177-189` | Token TTL polling kept ticking when Options tab hidden. | ✅ Fixed (verified 2026-05-16) — migrated to `useVisibilityPausedInterval`. |
| PERF-11 | Medium | `src/hooks/use-network-data.ts:53-58` | Network panel auto-refresh interval no visibility gate. | ✅ Fixed (verified 2026-05-16) — uses `useVisibilityPausedInterval`. |
| PERF-12 | Medium | `src/hooks/use-error-count.ts:65-106` | Error-count fallback poll ran while hidden. | ✅ Fixed (verified 2026-05-16) — visibilitychange listener pauses/resumes polling. |
| PERF-13 | Medium | `standalone-scripts/macro-controller/src/startup-persistence.ts:108-122` | MutationObserver too broad on SPA pages. | ✅ Fixed (verified 2026-05-16) — narrowed to `<main>`/`#root` scoped target, `childList`-only, `requestIdleCallback` debounce. |
| PERF-14 | Low    | `standalone-scripts/marco-sdk/src/notify.ts:173-180` | Dedup tick noted for completeness. | ✅ No-action (documented). |
| PERF-15 | Low    | `standalone-scripts/macro-controller/src/ui/countdown.ts:86-95` | 1 Hz countdown during hidden tab. | ✅ No-action (documented; self-stops when `!state.running`). |

### Confirmed clean — no action

- `src/background/keepalive.ts` — Uses `chrome.alarms` (30 s, MV3 idiomatic). Correct.
- `standalone-scripts/macro-controller/src/workspace-observer.ts` — Disconnects previous instance before re-installing; bounded retry (`WORKSPACE_OBSERVER_MAX_RETRIES`).
- `standalone-scripts/macro-controller/src/ui/redock-observer.ts` — PERF-4 generation-token cancellation working correctly.
- `standalone-scripts/payment-banner-hider/src/index.ts` — `MutationObserver` self-disconnects (`stopObserver()`) once banner is hidden. Correct.
- `src/content-scripts/home-screen/index.ts` — Observer scoped to workspace list only (`subtree: false`), debounced, teardown returned by `installRebuildObserver`.
- `src/lib/developer-guide-data.generated.ts:1728,1937` — Inside literal user-doc code snippets (template strings). Not executed.
- `src/background/handlers/library-handler.ts:398` — `while (true)` is a bounded slug-uniqueness search backed by an indexed SQLite query. Not a perf issue.
- `setTimeout` usages reviewed: all are one-shot or correctly tracked in refs.

### Next steps

**All PERF-9..15 items resolved as of 2026-05-16.** This audit block is closed; no further work queued from Round 2.

---

## 🆕 2026-04-24 — Project Import/Export E2E Audit (in progress)

**Spec**: `spec/30-import-export/` (3 docs: 01-rca, 02-erd, 03-test-plan).
**Diagrams**: `/mnt/documents/import-export-erd.mmd`, `/mnt/documents/import-export-flow.mmd`.
**Memory**: `.lovable/memory/architecture/project-import-export.md`, `.lovable/memory/architecture/prompt-pipeline.md`.

### Completed in this session
- ✅ Audited two parallel exporters; designated `src/lib/sqlite-bundle.ts` canonical, `src/lib/project-exporter.ts` deprecated.
- ✅ Documented real PascalCase SQLite schema (Projects/Scripts/Configs/Prompts/Meta) — does **not** match earlier user spec (no Dependencies/Variables/DatabaseInfo tables).
- ✅ Migrated all 14 `standalone-scripts/prompts/*/info.json` from camelCase to PascalCase keys.
- ✅ Updated `scripts/aggregate-prompts.mjs` to read PascalCase canonically with camelCase fallback + deprecation warning.
- ✅ Verified aggregator still produces 14 prompts (output shape unchanged).
- ✅ Wrote ERD + flow Mermaid diagrams for user review.

### Completed 2026-05-18
1. ✅ **E2E test suite** — 12 files / 59 cases (52 pass + 7 todo) at `src/test/import-export/*`. Setup-once via module-level promise in `setup-helpers.ts` (no globalSetup needed); cached `zipBytes`/`dbBytes`/`imported` shared across all parallel files. Total wall time ~8.7s locally.
2. ✅ **CI job `import-export-e2e`** — now `needs: [setup, derive-casing-matrix]`, runs `aggregate-prompts.mjs` before vitest, uploads forensic bundle artifact on failure.


### Follow-ups (queued, not in current task)
1. ✅ **Done 2026-05-18** — Rewired `ProjectDetailView.tsx`, `ProjectsList.tsx`, `ProjectsListView.tsx` (the actual current components — `ProjectEditor`/`ProjectsSection` from the original note no longer exist) to `exportProjectAsSqliteZip()`; deleted `src/lib/project-exporter.ts` + its test. `ProjectsListView` "Export JSON" button collapsed into the single canonical "Export" (DB zip) action.
2. ✅ **Done 2026-05-18** — Promoted `dependencies` + `variables` to first-class PascalCase tables (`Dependencies`, `Variables`). Bumped `CURRENT_FORMAT_VERSION` to `"6"` (kept `"4"`/`"5"` as `SUPPORTED_FORMAT_VERSIONS` for read-back). Per-project `SchemaVersion` bumped to 2 on every emit. Dual-write: legacy JSON blobs (`Projects.Dependencies`, `Projects.Settings.variables`) still emitted so v4/v5-only readers keep round-tripping; v6+ readers prefer the row tables when `SchemaVersion >= 2`. Updated `sqlite-bundle-contract.ts` + schema-drift CI, added `src/test/import-export/v6-row-tables.test.ts` (5 cases). All 70 E2E + 20 contract/roundtrip tests pass.
3. ✅ **Done 2026-05-18** — Added `PromptsCategory` + `PromptsToCategory` to the bundle schema (v6, optional tables). Exporter parses each prompt's `categories` (comma-separated, from the `PromptsDetails` view) — falls back to singular `category` — and dual-writes: junction rows for the full multi-category set AND the legacy singular `Prompts.Category` column (first category) so v4/v5 readers keep working. Importer joins the junction on read and rebuilds `category` as a comma-separated list. Added `src/test/import-export/v6-prompt-categories.test.ts` (5 cases). Schema-drift CI sees 9 tables, all green.
4. Add explicit `ImportStrictPascalCase` flag and gate the snake_case/camelCase fallback readers in `sqlite-bundle.ts:371-372` etc. behind `legacy=true`.
5. Extend the existing `casing-instruction-json` CI job (or add a sibling) to validate `standalone-scripts/prompts/*/info.json` PascalCase compliance.

---

## Current Status: v7.23 AHK + Extension v2.139.0 + Macro Controller v2.139.0 — Stable

All critical AHK features implemented. 44 issue write-ups documented. 26 engineering standards established. Chrome Extension at v2.139.0 with full React UI unification, session-bridge auth (unified `getBearerToken()` contract), SQLite bundles, User Script API, Context Menu, relative scaling, view transitions, hover micro-interactions, 7-stage injection pipeline with cache gate, 4-tier CSP fallback, and Cross-Project Sync (Phase 1 data layer + Phase 2 Library UI). Macro Controller at v2.139.0 with typed namespace API, centralized constants (Phase 1+2), zero ESLint warnings, and all Supabase references purged. All immediate workstream items complete.

### 2026-04-12 Session

- **ESLint Zero-Warning Achievement**:
  - **`no-explicit-any` elimination**: Reduced from 548 → 0 violations across entire `src/` codebase. Replaced with `unknown`, typed generics, `Record<string, unknown>`, and explicit interfaces.
  - **`no-restricted-types` cleanup**: Resolved 326 warnings for legitimate `unknown` boundary uses (catch clauses, `Record<string, unknown>`, type guards). Rule disabled globally as all uses were valid.
  - **Stale directive cleanup**: Removed 9 unused `eslint-disable` comments left over from type-safety improvements.
  - **Component splitting**: Extracted `useSchemaBuilder.ts` + `SchemaTableCard.tsx` from SchemaTab (548→155 lines), `useConfigDb.ts` + `ConfigSectionList.tsx` from ConfigDbTab (296→100 lines). Added targeted suppressions for 4 cohesive sub-components (GroupFormDialog, VersionRow, useLibraryLinkMap, ProjectEditor test).
  - **Final state**: 0 errors, 0 warnings across full `src/` ESLint SonarJS scan.

- **Test Suite Fix (21 → 0 failures)**:
  - Added missing `chrome.tabs.get()` to chrome mock — injection handler's early URL guard threw, returning empty results (14 failures).
  - Added missing `wakeBridge` to panel-builder auth mock (7 failures).
  - Added `setMockTabs` with required tab IDs in message-flow-integration injection flow `beforeEach` (1 failure).
  - **Final state**: 96 test files, 1080 tests — all passing.

### 2026-04-09 Session (continued)

- **Typed Namespace Refactor (v2.123.0)**:
  - Replaced dynamic `dualWrite`/`nsRead`/`nsCall` (string path + `split('.')` traversal) with compile-time typed `nsWrite<P>`/`nsReadTyped<P>`/`nsCallTyped<P>` backed by `NsPathMap` interface (30+ typed paths).
  - Eliminated all `Record<string, unknown>` casts from consumer call sites — cast is localized to single implementation function.
  - Dropped legacy `_windowKey` parameter from all call sites. Old functions kept as deprecated wrappers.
  - Updated 10 consumer files: `macro-looping.ts`, `startup.ts`, `credit-fetch.ts`, `loop-controls.ts`, `ui-updaters.ts`, `startup-idempotent-check.ts`, `startup-persistence.ts`, `startup-global-handlers.ts`, `panel-sections.ts`, `panel-controls.ts`, `menu-builder.ts`, `MacroController.ts`.
  - Fixed `sonarjs/cognitive-complexity` warning in `save-prompt.ts` by extracting `tryToolbarButtonFallback()` and `tryDirectFallback()`.
  - Fixed 9 migration bugs from T6: 4 broken `.catch(function)` calls, 2 broken import merges, 3 missing string quotes.

- **Constants Centralization Phase 1 (v2.124.0)**:
  - Created `constants.ts` — single source of truth for 56 hardcoded constants across 7 categories: DOM IDs (`ID_*`), CSS selectors (`SEL_*`), data attributes (`ATTR_*`), localStorage keys (`LS_*`), workspace/cache keys (`WS_*`), style IDs (`STYLE_*`), timing/limits, and shared strings.
  - Migrated 18 files to import from `constants.ts`. Eliminated 4 duplicate constant definitions (`ID_LOOP_WS_LIST`, `ATTR_DATA_ACTIVE`, `SEL_LOOP_WS_ITEM`, `MACRO_CONTROLLER`).
  - Moved 6 storage constants from `shared-state.ts` to `constants.ts` with re-exports for backward compatibility.
  - Config-derived runtime constants (`IDS`, `TIMING`, `CONFIG`) remain in `shared-state.ts` (resolved from `__MARCO_CONFIG__` at runtime).

- **Constants Centralization Phase 2 (v2.125.0)**:
  - Expanded `constants.ts` from 56 → 96 exported constants. Migrated 50 constants from 21 consumer files.
  - **CSS Fragments (21 constants)**: `CSS_SPAN_STYLE_COLOR`, `CSS_SPAN_COLOR` (deduplicated alias), `CSS_BAR_SEGMENT_TAIL`, `CSS_TRANSITION_TAIL`, `CSS_EASE_CLOSE`, `CSS_STYLE_WIDTH`, `CSS_BACKGROUND`, `CSS_FONT_SIZE`, `CSS_FONT_SIZE_9PX_COLOR`, `CSS_FONT_SIZE_11PX_FONT_WEIGHT_700_COLOR`, `CSS_BORDER_RADIUS_3PX_BACKGROUND`, `CSS_BORDER_1PX_SOLID_RGBA_255_255_255_0_08`, `CSS_PADDING_2PX_0`, `CSS_BORDER_PRIMARY`, `CSS_BORDER_PRIMARY_STRONG`, `CSS_BORDER_SOLID`, `CSS_LABEL_BLOCK`, `CSS_LABEL_SUFFIX`, `CSS_BORDER_RADIUS_COLOR`, `CSS_RGBA_124_58_237_0_15`, `CSS_WIDTH_100_PADDING_3PX_5PX_BORDER_1PX_SOL`, `CSS_BRIGHTNESS_1_3`.
  - **IndexedDB Constants (7)**: `DB_PROMPTS_CACHE_NAME`, `DB_PROMPTS_CACHE_VERSION`, `DB_PROMPTS_STORE`, `DB_PROMPTS_UI_STORE`, `DB_PROMPTS_JSON_COPY_KEY`, `DB_PROMPTS_HTML_COPY_KEY`, `DB_PROMPTS_UI_CACHE_KEY`.
  - **API Paths (2)**: `API_USER_WORKSPACES`, `API_USER_WORKSPACES_SLASH`.
  - **Timing/Limits (6)**: `DEFAULT_TOKEN_TTL_MS`, `MIN_CREDIT_CALL_GAP_MS`, `MAX_OVERLAY_ERRORS`, `MAX_SDK_ATTEMPTS`, `SDK_RETRY_DELAY_MS`, `MAX_UI_CREATE_RETRIES`.
  - **Storage Keys (2)**: `LS_TOKEN_SAVED_AT`, `LS_RENAME_PRESET_PREFIX`.
  - **Defaults (2)**: `DEFAULT_PRESET_NAME`, `DEFAULT_PASTE_XPATH`.
  - **Startup Labels (5)**: `LABEL_PROMPT_PREWARM`, `LABEL_WS_PREFETCH`, `LABEL_STARTUP_RETRY`, `LABEL_AUTH_AUTO_RESYNC`, `LABEL_LOG_MACROLOOP_V`.
  - **DOM IDs (1)**: `ID_MARCO_ERROR_OVERLAY`.
  - Consumer files updated: `credit-api.ts`, `log-activity-ui.ts`, `auth-recovery.ts`, `auth-resolve.ts`, `credit-balance.ts`, `credit-fetch.ts`, `rename-api.ts`, `workspace-rename.ts`, `startup.ts`, `startup-idempotent-check.ts`, and 11 UI modules (`js-executor`, `auth-diag-waterfall`, `bulk-rename-fields`, `hot-reload-section`, `panel-controls`, `panel-header`, `prompt-injection`, `save-prompt-task-next`, `settings-tab-panels`, `settings-ui`, `tools-sections-builder`, `prompt-cache`, `prompt-loader`, `error-overlay`).

### 2026-04-09 Session (earlier)

- **Error Logging Spec Implementation (T1–T5) — COMPLETE**:
  - **T1 — NamespaceLogger**: Created `marco-sdk/src/logger.ts` with `error()`, `warn()`, `info()`, `debug()`, `console()`, `stackTrace()` methods. Exposed on `RiseupAsiaMacroExt.Logger`. Always-capture stack traces via `captureStack()`.
  - **T2 — globals.d.ts typing**: Full `RiseupAsiaMacroExtNamespace` interface with typed `Logger` (6 methods), `Projects`, `RiseupAsiaProject`, `CookieBinding`, `MacroControllerNamespace` on `window`.
  - **T3 — Swallowed error fixes (S1–S16)**: All 16 swallowed errors across 8 files replaced with structured `NamespaceLogger.error()` calls including file path, missing item, and reasoning.
  - **T4 — `any` elimination**: All 11 `any` occurrences removed from `macro-controller/src/` (excluding `__tests__/`). Replaced with `unknown`, explicit types, or typed generics.
  - **T5 — Error-level log migration**: All 86 `log(msg, 'error')` calls migrated to `logError(fn, msg, error?)` across 33 files. Zero `log(*, 'error')` remaining.
- **Silent catch block fixes (48 blocks)**: All swallowed catch blocks in SDK + Controller now log via `logError()` + `showToast()` (controller) or `NamespaceLogger.error()` (SDK). Zero silent catches remaining.
- **Controller error-utils expansion**: Added `logDebug()`, `logConsole()`, `logStackTrace()` wrappers alongside `logError()`. Each delegates to `RiseupAsiaMacroExt.Logger` when available, falls back to console with `[RiseupAsia] [fn]` prefix.
- **API namespace explicit typing**: Replaced all `Record<string, unknown>` in `MacroControllerNamespace` with 8 explicit interfaces: `LoopApi`, `CreditsApi`, `AuthApi`, `WorkspaceApi`, `UiApi`, `ConfigApi`, `AutoAttachApi`, `MacroControllerInternal`. Zero `unknown` in API surface. `getNamespace()` uses typed casts instead of `Record<string, Record<string, unknown>>`.
- **SDK AuthTokenUtils extraction**: Moved pure token utilities from `macro-controller/src/auth-resolve.ts` to `marco-sdk/src/auth-token-utils.ts` as a static class. Exposed on `window.marco.authUtils`. Controller delegates at runtime with inline fallback.
- **Cross-Project Sync Phase 1 (data layer)**: Added 4 new SQLite tables, migration v7, 22 `LIBRARY_*` message types, library handler with sync engine, content hasher, and version manager.
- **Cross-Project Sync Phase 2 (Library UI)**: Built `LibraryView.tsx` with `AssetCard` grid, `SyncBadge`, `PromoteDialog`, `AssetDetailPanel`. Added "Library" sidebar entry. Full mock data in preview adapter.
- **Unit tests**: 45 tests across 3 files — library handler, content hasher, version manager.
- **CI/CD pipeline spec**: Updated to reflect all build steps including source map verification, axios version guard, lint steps, and release asset packaging.

### 2026-04-08 Session

- **Release CI hardening (v2.117.0)**: Fixed GitHub Actions failure when `pnpm-lock.yaml` is absent by falling back to `pnpm install --no-frozen-lockfile --lockfile=false` for root and `chrome-extension`. Added root + extension lint steps before tests. Release notes now explicitly include PowerShell/Bash install commands, manual unpacked-install steps, and `changelog.md` asset listing.

- **Rename Preset Persistence (v2.115.0)**: Added project-scoped IndexedDB KV store (`ProjectKvStore`) and `RenamePresetStore` for persistent rename configuration presets. Preset selector dropdown in bulk rename panel with Save/New/Delete. Auto-save on Apply, Close, and Cancel. Auto-load on panel open. Generic KV store is reusable by any plugin.
- **Spec Created**: `spec/21-app/02-features/macro-controller/ts-migration-v2/07-rename-persistence-indexeddb.md` — full spec for rename persistence with IndexedDB.
- **New Files**: `project-kv-store.ts` (generic KV), `rename-preset-store.ts` (preset CRUD).
- **Modified**: `bulk-rename.ts` (preset UI), `bulk-rename-fields.ts` (preset row builder), `workspace-rename.ts` (barrel exports).

### 2026-04-07 Session

- **Injection Pipeline Cache Gate**: Added IndexedDB-backed pipeline cache with HIT/MISS/FORCE states. On cache HIT, Stages 0–3 are skipped entirely. 3-layer invalidation: manifest version mismatch, automated rebuild, and manual `INVALIDATE_CACHE` message.
- **4-Tier CSP Fallback Chain**: Documented and aligned code with diagram — MAIN World Blob → USER_SCRIPT (Chrome 135+) → ISOLATED Blob → ISOLATED Eval. Updated spec and Mermaid diagram.
- **Force Run Support**: Added `forceReload` flag to context menu ("⚡ Force Run (bypass cache)") and shortcut handler (`force-run-scripts` command). Registered in `manifest.json` — users assign shortcut at `chrome://extensions/shortcuts`.
- **LLM Guide Updated**: `generate-llm-guide.ts` rewritten to reflect 7-stage + cache gate pipeline, 4-tier CSP fallback, `forceReload` parameter on `INJECT_SCRIPTS`, and pipeline cache documentation.
- **S-056 Completed**: Cross-Project Sync spec matured from DRAFT v1.0.0 → READY v2.0.0. Added conflict resolution rules, SQLite storage backend design with content hashing, and comprehensive edge case handling (14 acceptance criteria).
- **S-052 Completed**: Prompt click E2E verification checklist (7 tests) added to issue write-up #52. Covers fresh render, snapshot restore, MAIN world relay, save round-trip, error boundary, and action button isolation. Awaits manual Chrome execution.
- **ESLint**: Zero errors, zero warnings maintained throughout all changes.

### 2026-04-06 Hotfix

- Fixed click-injection ordering bug: if any script in the resolved chain has CSS, the injector now preserves full dependency order sequentially instead of executing non-CSS deps out of order.
- Added marco-sdk as an explicit macro-controller dependency so `window.marco` toast/auth APIs are guaranteed on manual inject.
- Fixed manual-run dependency recovery so `xpath` is forced ahead of `macro-looping` even when stored project metadata or popup ordering is stale.
- Improved session log read failures to print the exact missing OPFS path: `session-logs/session-<id>`.
- Fixed false-positive injection success by restoring macro-controller startup recovery hooks and re-registering the controller singleton in `api.mc`.
- Fixed cross-database `Sessions` lookups that caused repeated `no such table: Sessions` errors in error/user-script logging paths.
- Blocked built-in scripts from falling back to stale embedded storage code when bundled recovery fails.
- Unified extension/runtime script version to `2.98.0`. 

---

## 🛡️ Priority 0 — Logging & Diagnostics Enforcement (always-on, applies to every new feature)

> **Source of truth**: `mem://standards/verbose-logging-and-failure-diagnostics`, `mem://standards/error-logging-requirements`, `mem://constraints/file-path-error-logging-code-red.md`, `mem://standards/error-logging-via-namespace-logger.md`.
> **Build-time guard**: `scripts/check-failure-log-schema.mjs` (wired into `build:extension`) — fails the build if any new `logFailure()`/`buildFailureReport()` callsite omits `SourceFile`/`Phase`/`Error` or constructs a `FailureReport` literal directly.
> **Runtime fixtures**: `src/background/recorder/__tests__/__fixtures__/failure-report-fixtures.ts` + `failure-report-fixtures.test.ts` (56 tests, 5 scenarios — Replay zero-matches, primary drift, variable missing, Record no-target, JS-inline threw) pin the required-field schema and verbose vs non-verbose payload contract.
> **Subsystem coverage attested**:
> - **Recorder/Replay DOM steps** — `failure-logger.ts` + fixtures.
> - **JS-inline steps (StepKindId 4)** — `js-step-diagnostics.ts` (`buildJsStepFailureReport`, `runJsStepWithDiagnostics`) emits `Reason: "JsThrew"`, `Variables` with every `Vars`/`Row` key (sensitive masked), and captured `LogLines` as `JsLog` rows. Tests in `__tests__/js-step-diagnostics.test.ts` (18 tests).

These rules apply to **every** future feature that emits a failure log, captures DOM context, or runs a recorder/replay step. Treat them like lint rules — a PR that violates any of them is incomplete.

### LOG-1 — Failure-log schema is mandatory (every new emitter)

| | |
|---|---|
| **Owner** | Author of any feature that adds a new `logFailure(...)` / `buildFailureReport(...)` callsite, OR a new failure-emitting subsystem (recorder phase, JS step sandbox, data-source loader, network reporter, injection guard, etc.). |
| **Rule** | Every failure log MUST be produced via `buildFailureReport` / `logFailure` — never an object literal. Every callsite MUST pass `Phase`, `Error`, and `SourceFile`; `Selectors` or `EvaluatedAttempts` MUST be populated for selector failures; `Variables` MUST be populated for variable/data failures. `null` is acceptable for unknown sub-fields, but the keys themselves MUST exist. |
| **Acceptance criteria** | 1. `node scripts/check-failure-log-schema.mjs` passes (already wired into `build:extension`). 2. New emitter has at least one fixture in `__fixtures__/failure-report-fixtures.ts` covering its scenario, in **both** `Verbose: true` and `Verbose: false` modes. 3. New emitter is referenced by at least one test asserting `REQUIRED_REPORT_FIELDS` presence. 4. PR description lists the new `SourceFile` value(s) so reviewers can grep. |
| **Definition of done** | All four boxes ticked + `bunx vitest run src/background/recorder/__tests__/failure-report-fixtures.test.ts` green. |

### LOG-2 — Verbose toggle must gate payload, never classification

| | |
|---|---|
| **Owner** | Anyone touching `failure-logger.ts`, `verbose-logging.ts`, the `Settings → Debugging → Verbose failure logging` toggle, or any code that reads `resolveVerboseLogging(...)`. |
| **Rule** | The verbose flag MUST gate ONLY: (a) `DomContext.OuterHtml` / `DomContext.Text`, (b) top-level `CapturedHtml`, (c) raw form values inside `FormSnapshot.Values`. It MUST NOT change `Reason`, `ReasonDetail`, `Selectors`, `Variables`, or any field-name metadata. Persisted toggle lives in `ExtensionSettings.verboseLogging` (`chrome.storage.local`); every `GET_SETTINGS`/`SAVE_SETTINGS` MUST mirror it into `setVerboseLogging(null, …)` so the in-memory store stays in sync. |
| **Acceptance criteria** | 1. New code reads via `resolveVerboseLogging(projectId)` — no hard-coded `true`/`false`. 2. Fixture for the new emitter compares `Verbose.Reason === NonVerbose.Reason`, same for `ReasonDetail`/`Selectors`/`Variables`. 3. If a new bulky payload field is added, it is documented as verbose-gated in the field's TSDoc and excluded from non-verbose snapshots. 4. The settings round-trip test (`settings-handler-verbose.test.ts`) is extended if a new persisted knob is added. |
| **Definition of done** | All four boxes ticked + `bunx vitest run src/background/recorder/__tests__/verbose-logging.test.ts src/background/handlers/__tests__/settings-handler-verbose.test.ts` green. |

### LOG-3 — File-path / "what was missing" / "why" — CODE RED

| | |
|---|---|
| **Owner** | Anyone adding a `throw new Error(...)`, `Logger.error(...)`, or hard-fail return in a code path that touches files, paths, storage keys, manifest entries, instruction registries, or chrome.storage. |
| **Rule** | Per `mem://constraints/file-path-error-logging-code-red.md`: every hard error MUST include (a) the **exact** path/key/identifier, (b) **what** was missing or invalid, (c) **why** the code expected it. Stack traces are not a substitute. Optimised for AI consumption — a pasted error must be enough for ChatGPT/Claude to RCA without source access. |
| **Acceptance criteria** | 1. New error messages include all three (path, missing-thing, reason) — verified by reviewer. 2. New errors emit through `RiseupAsiaMacroExt.Logger.error(...)` (or `console.error(formatFailureReport(...))` for recorder reports) — never bare `console.log` / silent `catch {}`. 3. Stack traces from build chunks (`chunk-*.js`, `assets/*.js`) are filtered per `mem://preferences/stack-trace-filtering`. |
| **Definition of done** | Reviewer signs off + grep shows zero new bare `catch {}` or `console.log(error)` calls in the diff. |

### LOG-4 — Diagnostics export must include any new failure source

| | |
|---|---|
| **Owner** | Anyone introducing a new failure-log table, OPFS file, IndexedDB store, or chrome.storage key that holds diagnostic data. |
| **Rule** | Per `mem://features/log-diagnostics-export`: the human-readable ZIP bundle is the canonical "send this to support" artefact. Every new diagnostic surface MUST be added to the bundle producer **in the same PR** that adds the surface — no "we'll wire it next sprint". The bundle MUST keep the `logs.txt` headline format and append the new source as a clearly labelled section. |
| **Acceptance criteria** | 1. Bundle producer code lists the new source. 2. A bundle integration test loads a fixture that includes the new source and asserts it lands in the unzipped output. 3. The `verbose` snapshot map (`snapshotVerboseLoggingStore()`) is included so debuggers can tell whether captured payloads are full or truncated. |
| **Definition of done** | Bundle test green; manual export from a dev build shows the new section. |

### LOG-5 — Recorder/Replay step contracts (form snapshots, selector traces, XPath)

| | |
|---|---|
| **Owner** | Anyone adding a new `RecordedStepKind`, a new selector strategy, or a new replay phase. |
| **Rule** | New step kinds that touch a DOM target MUST: (a) capture an XPath via `xpathOfElement` and store it on the `DomContext`, (b) capture a `FormSnapshot` if the target is inside a form (always field names+types; values only when verbose), (c) when failing, emit a `FailureReport` whose `Selectors` includes every attempted strategy with `Matched`/`MatchCount`/`FailureReason`. New selector strategies MUST extend `AttemptStrategy`, populate `EvaluatedAttempt.Strategy`, and add a row to `SelectorReplayTracePanel`. |
| **Acceptance criteria** | 1. New step kind has unit tests in `src/background/recorder/__tests__/` covering capture + replay + failure paths. 2. `SelectorReplayTracePanel` renders the new strategy without "Unknown" fallbacks. 3. `FormSnapshotBadge` appears on the trace row when applicable. 4. Sensitive-field masking regex still applies (`password|secret|token|otp|pin|cvv|ssn|credit`). |
| **Definition of done** | All four boxes ticked + manual smoke run of record→replay→fail flow shows the new step in the trace panel. |

### LOG-6 — Test-fixture parity (verbose × non-verbose)

| | |
|---|---|
| **Owner** | Anyone adding a fixture or scenario to `__fixtures__/failure-report-fixtures.ts`. |
| **Rule** | Every scenario MUST be exposed as a `FixtureBundle = { NonVerbose, Verbose }` built via `buildFailureReport` (never literals). Both modes MUST go through the schema test loop (`for (const mode of ["NonVerbose", "Verbose"] as const)`). |
| **Acceptance criteria** | 1. New fixture appears in `allFixtures()`. 2. The 48-test baseline grows by exactly 12 tests per new scenario (4 schema assertions × 2 modes + 4 reason/format assertions). 3. No fixture leaves a detached jsdom node — `beforeEach(() => { document.body.innerHTML = ""; })` is honoured. |
| **Definition of done** | Test count grows monotonically; `bunx vitest run` stays green. |

### How to apply LOG-1..6 to a new feature (checklist)

```
[ ] Failure emitter goes through buildFailureReport / logFailure (LOG-1)
[ ] Verbose toggle resolved via resolveVerboseLogging(...) — no hard-coded bool (LOG-2)
[ ] Hard errors carry path + what + why (LOG-3)
[ ] Diagnostics bundle producer updated in same PR (LOG-4)
[ ] New step/strategy wired through trace panel + form-snapshot path (LOG-5)
[ ] Fixture bundle (NonVerbose + Verbose) added; schema loop covers it (LOG-6)
[ ] `node scripts/check-failure-log-schema.mjs` passes
[ ] `bunx vitest run src/background/recorder/__tests__/failure-report-fixtures.test.ts` passes
```

> **Enforcement**: PRs touching failure-log surfaces MUST paste the checklist into the description with each box ticked. Reviewers reject the PR if any box is unticked without a written waiver linked from `.lovable/memory/suggestions/`.

---

## Remaining Backlog

### Priority 0: Standalone Scripts — Global Instruction Types (2026-04-24)

Spec: `spec/21-app/01-chrome-extension/standalone-scripts-types/01-overview.md`
Draft types: `standalone-scripts/types/instruction/` (one type per file, awaiting Q1–Q5 sign-off).

| Task | Description | Status |
|------|-------------|--------|
| **0.1** — Review Q1–Q5 | Decide enum-vs-`as const`, optional-vs-required `xpaths`, `EmptySettings` naming, field renames, runtime base class. | Awaiting reviewer |
| **0.2** — Wire `compile-instruction.mjs` | Emit legacy keys (`world`, `isIife`, `inject`) for one release while runtime migrates. | Blocked on 0.1 |
| **0.3** — Migrate `payment-banner-hider/src/instruction.ts` | Import `ProjectInstruction<EmptySettings>`; delete local interface. | Blocked on 0.1 |
| **0.4** — Migrate `xpath/src/instruction.ts` | Same as 0.3; introduce `XPathRegistry` for the script's own selectors. | Blocked on 0.1 |
| **0.5** — Migrate `marco-sdk/src/instruction.ts` | Same as 0.3; shared `ProjectInstruction` re-export removed. | Blocked on 0.1 |
| **0.6** — Migrate `macro-controller/src/instruction.ts` | Add `MacroControllerSettings` type next to controller; pass to `ProjectInstruction<MacroControllerSettings>`. | Blocked on 0.1 |
| **0.7** — Logger `unknown` cleanup | Replace `unknown` in `riseup-namespace.d.ts` with `CaughtError` / `ReadonlyArray<JsonValue>`. | Independent |
| **0.8** — ESLint `id-denylist` rule | Ban `fn`, `cb`, `el`, `msg`, `cfg`, `ctx`, `obj`, `arr`, `str`, `num`, `tmp`, `val` repo-wide. | Independent |
| **0.9** — ESLint `consistent-type-definitions` | Scope `["error", "type"]` to `standalone-scripts/types/instruction/` first; widen later. | Independent |
| **0.10** — `.d.ts` `unknown` lint coverage | Extend the no-`unknown` ESLint rule to `.d.ts` files under `standalone-scripts/types/`. | Independent |
| **0.11** — `PaymentBannerHider` class refactor | External CSS file, no `!important`, no error swallowing, single-class entry; consume `XPathRegistry` from migrated instruction. | Blocked on 0.3 |
| **0.12** — Standalone-script scaffolder CLI | `pnpm new:standalone <name>` generates `instruction.ts`, vite/tsconfig, dist gitignore, CI build/e2e jobs, registry entries — using the new types. | Blocked on 0.1 |
| **0.13** — Banner-hider RCA follow-up | RCA at `spec/03-error-manage/01-error-resolution/03-retrospectives/2026-04-24-payment-banner-hider-rca.md`. 7 new memory standards (`pre-write-check`, `no-css-important`, `no-error-swallowing`, `no-type-casting`, `class-based-standalone-scripts`, `standalone-scripts-css-in-own-file`, `blank-line-before-return`) — registered in `mem://index`. | Memory updated; lint rules pending in 0.8 |
| **0.14** — Banner-hider runtime enums | Add `BannerLifecyclePhase` and `BannerEventName` to `standalone-scripts/types/runtime/enums/`. Replace every magic string in the rewritten `index.ts`. | Blocked on 0.11 |
| **0.15** — Typed DOM helpers in SDK | Add `RiseupAsiaMacroExt.Dom.queryHtmlElement(selector): HTMLElement \| undefined` and `queryAllHtmlElements(...)` so callsites never need `as HTMLElement`. | Blocked on 0.7 |
| **0.16** — `RiseupAsiaMessage<TPayload>` discriminated type | Replace every `as unknown as Message` cast with a typed dispatcher keyed on `kind: BannerEventName`-style enums. | Blocked on 0.15 |

### Priority 1: E2E Verification (Blocked — Manual)

| Task | Description | Status |
|------|-------------|--------|
| **Task 1.2** — E2E Chrome Verification | Load extension in Chrome, verify popup/options/CRUD/injection/context menu/import-export. S-052 checklist ready. | Blocked (requires manual Chrome testing) |

### Priority 2: Test Coverage

| Task | Description | Status |
|------|-------------|--------|
| **Task 2.2** — React Component Tests (S-021) | Unit tests for PopupApp, OptionsApp, ProjectsSection, ProjectEditor, DiagnosticsPanel. Target: 900+ tests | Ready |

### Priority 3: P Store — Project & Script Store

A marketplace for discovering, searching, and importing projects/scripts from a remote store API. Configurable store URL in Settings, search with caching, import flow. **Not ready — owner will fine-tune spec first.**

Spec folder: `spec/05-chrome-extension/82-pstore-project-store/`

### Priority 4: Cross-Project Sync — Phase 3 (In Progress)

Phase 1 (data layer) and Phase 2 (Library UI) complete. Remaining: ProjectGroup management UI, drag-to-assign projects, sync notifications, and E2E testing.

Spec: `spec/21-app/02-features/misc-features/cross-project-sync.md`

### Priority 5: Release Installer Hardening (v0.2)

The unified installer (`scripts/install.{ps1,sh}`) auto-derives the pinned version from its release-asset download URL and falls back to GitHub `latest` when no URL context is present (e.g., fetched from `raw.githubusercontent.com/.../main/` or run from a clone). v0.2 hardening, in priority order:

1. **Built-in checksum verification** — installer fetches `checksums.txt` from the same release and verifies the ZIP's SHA256 before extracting (~15 LOC per script).
2. **Authenticode-signed `install.ps1`** + GPG-signed `install.sh` released alongside `.sig` files.
3. **SLSA build provenance** for end-user audit of the GitHub Action that produced assets.

Memory: `.lovable/memory/features/release-installer.md`

---

## Completed Work (Summary)

| Area | Highlights |
|------|-----------|
| **AHK Layer** | E2E tests (22 suites, 150+ cases), XPath self-healing, config schema validation, hot-reload, token expiry UI |
| **Extension Releases** | v1.0–v2.119.0: injection, SQLite, auth, context menu, scaling, React unification, view transitions, cache gate, force run, cross-project sync |
| **Macro Controller** | v2.125.0: typed namespace API (`NsPathMap` + `nsWrite`/`nsReadTyped`/`nsCallTyped`), centralized `constants.ts` (96 constants in 2 phases, 21 consumer files migrated), error logging T1–T5 complete |
| **React UI Unification** | All 12 steps complete — content scripts moved, message client migrated, version bumped |
| **Immediate Workstream** | Swagger API Explorer, Storage Browser (4 categories), Prompt Seeding, Overflow Menus, Project Files Panel, ZIP Export/Import |
| **Injection Pipeline** | 7-stage + cache gate, 4-tier CSP fallback (MAIN Blob → USER_SCRIPT → ISOLATED Blob → ISOLATED Eval), Force Run (context menu + shortcut) |
| **Cross-Project Sync** | Phase 1: data layer (4 tables, migration v7, 22 message types, sync engine). Phase 2: Library UI (AssetCard, SyncBadge, PromoteDialog). 45 unit tests. |
| **UI Polish** | Tailwind hover micro-interactions (Task 4.1), direction-aware view transitions (Task 4.2) |
| **Build & Docs** | Build verification (Task 2.1), CDP injection docs (Task 3.1), AI onboarding checklist (Task 3.2), LLM guide updated |
| **Code Quality** | ESLint 1390 → 0 issues (0 errors, 0 warnings), SonarJS integration, TS migration v2 (6 phases), error logging T1–T5 complete (86 log migrations, 48 silent catches fixed, 548 `any` eliminated, 8 explicit API interfaces), typed namespace refactor (30+ paths), constants centralization Phase 1+2 (96 constants, 21 consumer files), `logError`/`logDebug`/`logConsole`/`logStackTrace` helpers, component splitting (SchemaTab, ConfigDbTab) |
| **Test Suite** | 1080 tests across 96 files — all passing. Injection handler, pipeline benchmark, message-flow integration, and panel-builder tests fixed. |
| **Specs Matured** | S-056 Cross-Project Sync (READY v2.0.0), S-052 Prompt Click verification checklist, error logging & type safety spec |
| **Issues Resolved** | #76–#90: cookie binding, hot-reload, globals migration, auth bridge, injection pipeline, IndexedDB cache, prompt click fix |

---

## Next Task Selection

| # | Task | Effort | Impact | Blocker |
|---|------|--------|--------|---------|
| 1 | **Task 2.2** — React component tests | Medium | High — catches UI regressions | None |
| 2 | **Task 1.2** — E2E Chrome verification | Low | High — validates real-world usage | Manual Chrome required |
| 3 | **Cross-Project Sync** — Shared asset library | High | High — new feature | Spec ready |
| 4 | **P Store** — Project marketplace | High | High — new feature | Owner spec pending |

**Recommended next**: Task 2.2 (React component tests) — no blockers, highest actionable impact.

---

## 🔥 Performance Audit — Idle / Background Loops (deep dive 2026-04-25)

> **Trigger**: User asked "are we running any loop in background that could harm performance — root-cause it and write it down so we don't forget."
> **Scope swept**: `src/`, `standalone-scripts/`, `chrome-extension/` for `setInterval`, `requestAnimationFrame`, `while(true)`, `for(;;)`, zero-delay `setTimeout`. 43 hits triaged.
> **Verdict**: 1 critical, 4 high, 3 medium leaks/wastes. Several "looks scary" hits are actually correctly bounded — listed under ✅ for completeness.

### 🔴 CRITICAL — fix first

| # | File | Issue | Why it harms perf | Root cause |
|---|---|---|---|---|
| **PERF-1** | `src/background/hot-reload.ts:34` + `vite.config.extension.ts:516` | **Hot-reload polls `build-meta.json` every 1 second forever — in PRODUCTION builds too.** Wakes the MV3 service worker every second, defeats Chrome's SW idle suspension, runs a `fetch()` + `JSON.parse()` per tick, fights the keepalive heuristics, and on shared/laptop machines visibly drains battery. | SW never sleeps → constant CPU/IO + extra "Marco extension was reloaded" logs. Also disables the very SW lifecycle the rest of the code (e.g. `keepalive`) tiptoes around. | `generateBuildMeta()` is wired unconditionally inside `defineConfig(({ mode }) => …)` — `isDev` is computed but never gates the plugin. So `dist/build-meta.json` ships in release ZIPs, and `startHotReload()` (called from `service-worker-main.ts:131`) sees the file present and starts the 1 s loop. The polling is also unkillable — no `clearInterval` and no stop API. |

**Fix sketch**: gate `generateBuildMeta()` behind `isDev` in `vite.config.extension.ts`, *and* in `hot-reload.ts` short-circuit if `chrome.runtime.getManifest().version_name?.includes('dev')` is false (defense in depth), *and* capture the interval ID + expose `stopHotReload()` for unit cleanliness.

### 🟠 HIGH — leaked / unbounded intervals

| # | File:line | Issue | Root cause |
|---|---|---|---|
| **PERF-2** | `standalone-scripts/macro-controller/src/ui/panel-controls.ts:393` | `setInterval(…, 5000)` to refresh the error-badge count is **fire-and-forget** — the returned ID is discarded. Every panel re-bootstrap (SPA nav, redock, theme swap) layers another 5 s timer on top, all writing to the same DOM badge. After N navigations on a long Lovable session this is N concurrent intervals. | Closure-style helper `function buildErrorBadge()` returns the button but never the timer handle; no `WeakRef`/teardown hook tied to panel lifecycle. |
| **PERF-3** | `standalone-scripts/macro-controller/src/ui/section-auth-diag.ts:179` | Same pattern — `setInterval(…, 10_000)` for the auth-diag refresh, ID discarded. Re-mounting the diagnostics section stacks duplicates. The visibility guard inside the callback prevents UI work but **does not stop the timer or the closure-held DOM refs** (memory leak when old panels are GC-orphaned). | Builder function `buildAuthDiagSection()` has no return-side teardown contract. |
| **PERF-4** | `standalone-scripts/macro-controller/src/ui/redock-observer.ts:24,39` | `RedockState.pollTimer` field + setter exist but **no code path ever assigns to it**. The actual polling is delegated to `pollUntil(...)` (lines 72-81) whose timer is internal and **cannot be cancelled** by `resetRedockState()`. So calling `resetRedockState()` during teardown leaves an orphan interval running until its `timeoutMs` (`pollMs * maxAttempts`) elapses — could be many minutes per re-bootstrap. | Refactor to `pollUntil` left the cancellation API stranded. Dead `pollTimer` accessor is the smell. |
| **PERF-5** | `src/content-scripts/network-reporter.ts:300,305` | `setInterval(flushBuffer, FLUSH_INTERVAL_MS)` runs **on every page** — content_scripts match `<all_urls>`. The interval has no clearInterval anywhere, no visibility-guard, no idle backoff. On a tab the user opened and forgot, this keeps ticking + serializing buffered network events forever. Multiplied by N background tabs = real CPU. | `initNetworkReporter()` is called at module top-level (line 305) with no lifecycle hook. Designed as "fire once at document_start" without considering long-lived tabs. |

### 🟡 MEDIUM — wasteful but bounded

| # | File:line | Issue | Root cause |
|---|---|---|---|
| **PERF-6** | `src/components/popup/InjectionCopyButton.tsx:206` | 15 s `chrome.runtime.sendMessage({ type: "GET_ACTIVE_ERRORS" })` poll while popup is open. Popup is short-lived so this is bounded, but it duplicates `use-error-count.ts` which already pushes via `ERROR_COUNT_CHANGED` broadcast. Net effect: SW gets 2 wake-ups per error change instead of 1. | Component was added before the broadcast existed and never refactored to subscribe. |
| **PERF-7** | `src/popup/hooks/usePopupData.ts:123` | 30 s poll fans out 4 `sendMessage` calls (`GET_STATUS`, `GET_HEALTH_STATUS`, `GET_ACTIVE_PROJECT`, `GET_ACTIVE_ERRORS`) **even when the popup tab is hidden** (popup can be detached into a window). No `document.hidden` guard like `DiagnosticsPanel.tsx` has (line 103). | Hook predates the visibility-pause pattern adopted in `DiagnosticsPanel`. |
| **PERF-8** | `standalone-scripts/macro-controller/src/toast.ts:211` (`queueDrainTimer`) | Drain timer self-stops only when queue empties **and** the SDK has loaded. If `getNotify()` keeps returning `null` (SDK never injects on a non-target tab), the interval ticks forever at `TOAST_QUEUE_POLL_MS` doing nothing useful. | `drainQueue()` early-returns when `notify === null` without arming a kill-switch or backoff. |

### ✅ Verified safe (no action — documenting so we don't re-flag them)

- `src/background/handlers/library-handler.ts:398` — `while (true)` is a slug-uniqueness search bounded by SQLite `SELECT`; one DB roundtrip per iteration, terminates on first miss.
- `standalone-scripts/marco-sdk/src/notify.ts:175` (`_dedupTimer`) — self-clears when `_recentToasts` map empties (line 178). ✅
- `standalone-scripts/macro-controller/src/loop-controls.ts:122,123,301` — all paired with explicit `clearInterval` in `stopLoop()` / `stopStatusRefresh()`.
- `standalone-scripts/macro-controller/src/startup-token-gate.ts:82` — bounded by `timeoutMs` with `finishTokenGate()` clearing the timer.
- `standalone-scripts/macro-controller/src/ui/countdown.ts:86` — paired with `stopCountdownTick()`; also self-stops when `state.running` becomes false.
- `standalone-scripts/{marco-sdk,macro-controller}/src/{utils,async-utils}.ts` `pollUntil` — timer cleared on success or `timeoutMs` expiry.
- `src/options/sections/DiagnosticsPanel.tsx:98` — gold-standard pattern: visibility-pause + cleanup on unmount.
- `src/hooks/use-network-data.ts`, `use-error-count.ts`, `use-token-watchdog.ts` — all paired with cleanup in `useEffect` return.

### Suggested execution order (when user greenlights)

1. **PERF-1** (production hot-reload) — highest user-visible impact, single-file fix.
2. **PERF-5** (network-reporter on every tab) — second biggest battery/CPU win.
3. **PERF-2 / PERF-3 / PERF-4** — macro-controller leak trio; introduce a shared "panel teardown registry" so builders can register `clearInterval` callbacks once and re-bootstrap is idempotent.
4. **PERF-6 / PERF-7 / PERF-8** — quality-of-life polish.

> 📌 **Do not touch yet** — user asked to record findings only. Per `mem://workflow/task-execution-pattern`, each PERF-* item gets its own RCA file in `spec/22-app-issues/` before code changes.

---

## Engineering Principles (Summary)

1. Root Cause Analysis First
2. Known-Good State Wins
3. UI Sync Completeness
4. Side Effect Awareness
5. API-First, DOM-Fallback
6. No Direct resp.json()
7. SQLite Schema Consistency
8. Issue Write-Up Mandatory
9. NEVER change code without discussing with user first
10. **Logging & Diagnostics Enforcement** — every new failure surface obeys LOG-1..6 above (schema, verbose-gating, code-red errors, diagnostics bundle, recorder contracts, fixture parity).

Full list: `/spec/02-coding-guidelines/engineering-standards.md` (26 standards)

---

### Follow-up: error-swallowing audit scanner

The Options → **Error Audit** page (`src/components/options/ErrorSwallowAuditView.tsx`)
consumes `public/error-swallow-audit.json`. The file is not yet generated;
build a scanner that emits the documented JSON contract (see the page's
empty-state). Suggested location: `scripts/audit-error-swallow.mjs`,
classifying findings into P0/P1/P2 per `mem://standards/error-logging-requirements.md`.

### Follow-up: shrink the swallowed-errors baseline (177 entries)

`scripts/check-no-swallowed-errors.baseline.json` allow-lists 177
pre-existing empty-catch / promise-noop sites so the new
`check:no-swallowed-errors` guard can run green in CI from day 1.
Each entry has a `"reason": "TODO: ..."` placeholder. Sweep these
in priority order (P0/P1 from the error-swallowing audit page,
once the scanner from the previous follow-up lands) and remove
entries from the baseline as fixes ship. Final goal: empty
`entries: []` array and pass `npm run check:no-swallowed-errors:strict`.
