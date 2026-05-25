# Macro Controller — Changelog

## v3.15.1 (2026-05-25)

### Internal
- Version bump: 3.15.0 → 3.15.1 — synced with extension release v3.15.1 (root `readme.md` pinned to new tag). No functional changes.

---



## v3.15.0 (2026-05-25)

### Fixed
- **Toolbar minimize/expand button squish** (Issue 117, 5-step RCA) — Root cause: `toggleMinimize` / `restorePanel` / `_restoreMinimizedPanel` wiped `bodyElements` inline `display` styles (e.g. `btnRow`'s `display:flex`) by setting `el.style.display = ''`, causing `gap` / `justify-content` / `align-items` to become inert after every expand cycle. Durable fix stashes `el.style.display` into `data-macro-prev-display` on minimize and restores it on expand via `_hideBodyElement()` / `_showBodyElement()` helpers. Added 5 regression tests (`panel-minimize-expand-display.test.ts`).

### Internal
- Version bump: 3.14.2 → 3.15.0 (synced with extension release).

---

## v3.14.2 (2026-05-25)

### Internal
- Version bump: 3.14.1 → 3.14.2 (synced with extension release).

---

## v3.14.1 (2026-05-25)

### Added
- **Credit Totals Modal** (Issue 116) — `💰 Credit Totals` right-click menu entry opens a summary modal:
  - `This Billing Cycle` card (total granted / used / remaining) and `Free Daily Credits` card (used today / 5 daily).
  - Per-workspace breakdown table with `Credits Used / Granted` and `Available`.
  - Missing-data warning row for workspaces without cached credit data.
  - `↻ Refresh` button re-renders from the latest snapshot.
- A11y: focus trap + `Escape` to close (`aria-modal="true"`, `tabIndex="-1"`).
- 25 unit tests (credit totals logic, modal rendering, dialog lifecycle, a11y handlers).

### Internal
- Version bump: 3.13.0 → 3.14.1.

---

## v3.13.0 (2026-05-25)

### Fixed
- **Chatbox prompts dropdown header** — `📋 Click to paste into editor` + `✏️ Edit` no longer wraps/clips inside the 180px-wide dropdown. Header text shortened to `Click to paste` (full label moved to `title=` tooltip), Edit button collapsed to icon-only with `flex:0 0 auto` so it never wraps.
- **Floating Task Next submenu vertical overflow** (`save-prompt-task-next.ts`): the 13-row flyout (`Next 1..40 tasks` + Custom + Settings) now caps at `max-height:80vh` with internal scroll, and `positionSubmenu()` clamps `top` upward when the menu would extend past the viewport bottom. Horizontal clamp also respects an 8px viewport pad.

### Internal
- Version bump: 3.12.0 → 3.13.0 (pinned across manifest.json, src/shared/constants.ts, standalone-scripts/macro-controller/src/shared-state.ts, standalone-scripts/macro-controller/src/instruction.ts).

## v3.12.0 (2026-05-25)

### Changed
- **Workspace status badges — unified label system** (Issue 115):
  - `expired-canceled`, `fully-expired`, plain `expired` all collapse to a single muted gray **`Cancel`** badge (light yellow text on slate-500). The legacy red `Expired` pill is gone for canceled rows.
  - `about-to-expire` (past_due) → **`Expire {N}d`** (amber). When the past_due event already lapsed (`daysSince ≥ 1`) → **`Expired {N}d`** (red).
  - `about-to-refill` → **`Refill {N}d`** / **`Refill today`** (sky/info). Inline `R Nd` chip auto-suppressed to prevent double-badging.
- `ws-list-renderer.ts` + `ws-hover-card.ts` now share a single classifier (`classifyFromStatus`) and tone resolver (`resolveBadgeStyle`). The duplicate `STATUS_PILL_STYLES` / `PILL_STYLES` maps are removed.

### Added
- `workspace-display-status.ts` — pure classifier that maps `WorkspaceStatus` → `WorkspaceDisplayStatus` (kind + label + tone + tooltip).
- `workspace-badge-styles.ts` — single-source tone→CSS resolver. `muted` tone guaranteed never to contain red palette fragments.
- **Refill-soon filter chip** in the workspace filter menu (`loop-ws-refill-soon-filter`). Shows only workspaces currently classified as `about-to-refill`.
- 28 new tests (13 classifier + 6 tone resolver + 5 composition + 4 chip).

### Internal
- Version bump: 3.11.1 → 3.12.0.

## v3.11.1 (2026-05-25)


### Fixed
- **Issue 114 — `pro_0` Credit Balance Calculation**: `pro_0` plans now display correct credit totals and availability. Legacy `calcTotalCredits` / `calcAvailableCredits` aggregators that double-counted `daily_limit` for `pro_0` are bypassed in favor of the server-authoritative `/credit-balance` fields.
  - `Total` = `total_granted` (was summing `*_limit` fields).
  - `Available` = `total_remaining` (was subtracting `*_used` independently).
  - `TotalUsed` = `total_billing_period_used`.
  - `Billing`, `Daily`, `Topup`, `Bonus`, `Rollover` sub-buckets derived from `grant_type_balances[].remaining`.

### Added
- Pure calculator module `pro-zero-credit-calculator.ts` with `calculateProZeroCreditSummary()` — no I/O, no globals.
- 35 unit tests across 4 groups (calculator, wiring, renderers, E2E fixtures).
- 6 anonymized E2E JSON fixtures under `tests/e2e/credit-balance/fixtures/`.
- Node E2E harness `run-credit-balance-e2e.test.ts` with invariant checks.
- Defensive `assertNotLegacyCalcForProZero()` guard in `calcTotalCredits` / `calcAvailableCredits` — throws in dev/test, CODE-RED logs in prod.

### Tests
- Group A (12): calculator mappings for Total, Available, Used, Daily, Billing, Topup, Bonus, Rollover, Ledger, Source, ExpiringSoon.
- Group B (8): wiring invariants — `buildSummary` delegation, `applySummaryToRow` verbatim copy, legacy-guard throw/log, non-pro_0 regression.
- Group C (6): renderer integration — credit bar, hover card title, compact/non-compact status bar, Copy-JSON payload.
- Group D (9): E2E fixture validation with sanitized IDs/emails.

## v3.9.0 (2026-05-24)

### Fixed
- Prompts dropdown portals to `document.body` to escape `overflow: hidden` clipping.
- Viewport-aware flip (up/down) + clamp (left/right) with dynamic `max-height`.
- `Task Next` submenu scrolls into view when parent dropdown opens upward.

## v3.5.1 (2026-05-22)

### Projects Modal — 15-Step Improvement (Steps 1–14)

- **Step 1 — Spec**: Wrote `spec/projects-modal/00-overview.md` documenting the `projects.list` / `projects.get` flow, the HTTP 405 root cause, and the target cache-backed behavior.
- **Step 2 — 405 Fix**: Dropped the deprecated `projects.get` endpoint (returned HTTP 405). CSV export now sources git/activity fields directly from the enriched `projects.list` response, eliminating N extra HTTP calls.
- **Step 3 — Name resolution**: Multi-source fallback for blank project names — `projects.list` → open-tab title → SQLite cache. No CSV row emits raw ID when a human-readable name exists.
- **Steps 4–7 — SQLite cache**: Added `projects-cache.ts` with `MacroProjectListCache:*` KV keys. Default TTL 48 h, user-tunable via Settings → Debugging (`projectsCacheTtlHours`). Cache hit/miss logged to activity log.
- **Step 9 — Workspace credits**: Per-workspace header now shows `name · creditsUsed / creditsTotal`.
- **Step 10 — Search bar**: Case-insensitive substring filter across project `name` + `id`.
- **Step 11 — Workspace chips**: Toggle filter chips to show/hide entire workspace blocks.
- **Step 12 — Row badges**: `⎇ repo:branch` pill and clickable `↗` open-in-new-tab icon on every project row.
- **Step 13 — Empty/error UX**: Friendly states for "no workspaces", "no matches" (with clear-filters button), per-block load failures, and per-block "no projects yet".
- **Step 14 — E2E verification**: Added `scripts/verify-projects-cache.mjs` — 7 scenarios, 18 checks (round-trip, miss, TTL expiry, clear, malformed JSON, wrong shape, KV unavailable). All green.
- **Dropped**: Step 8 (inter-fetch delay slider) — eliminated along with the `projects.get` sequential fetch loop.

### Version Alignment

- Bumped macro-controller version to **3.5.1** in sync with extension manifest.

---

## v2.1.0 (2026-04-03)

### Version Alignment

- Bumped version from 1.74.0 → 2.1.0 to match extension manifest v2.1.0.0
- Eliminates version mismatch banner in popup

---

## v1.74.0 (2026-03-31)

### Code Quality Audit — Full CQ Compliance

- **var elimination**: Converted all legacy `var` declarations to `const`/`let` — 0 remaining
- **CQ11 (module-level `let`)**: All mutable module-level state encapsulated in singleton classes (`BulkRenameManager`, `PromptLoaderState`, `AuthRecoveryManager`, `ToastManager`, etc.) — 0 violations
- **CQ12 (global mutation)**: All shared array/map mutations replaced with immutable data flow — 0 violations
- **CQ13 (C-style `for` loops)**: 13 justified exceptions documented (index-based APIs: `localStorage.key(i)`, `snapshotItem(i)`, reverse iteration)
- **CQ16 (nested named functions)**: Resolved all 60 violations across 25+ files
  - `auth-bridge.ts`: `finish`/`onResponse`/`onPong` → `finishBridgeAttempt`/`handleBridgeResponse`/`handleRelayPong` with `BridgeAttemptCtx`/`RelayPingCtx`
  - `prompt-loader.ts`: 5 closures → `finishRelay`/`handleRelayResponse`/`handlePromptRelayResponse`/`finishLegacyLoad`/`_fetchFromExtensionAttempt` with `RelayCtx`/`PromptRelayCtx`
  - `rename-bulk.ts`: Recursive `doNext` closures → private methods `_doNextRename`/`_doNextUndo` on `BulkRenameManager`
  - `task-next-ui.ts`: `doNextTask` → module-scope with `TaskNextLoopCtx`; `tryClickAndAdvance` with `ClickContext`
  - `bulk-rename.ts`: 9 named functions → `const` arrow assignments (drag handlers, preview, ETA, start-num bindings)
  - `database-modal.ts`: `switchTab` → `switchDbTab` at module scope
  - `settings-ui.ts`: `switchTab`/`onEsc` → `switchSettingsTab`/`onSettingsEsc` at module scope
  - `loop-controls.ts`, `check-button.ts`, `prompt-injection.ts`, `async-utils.ts`, `menu-helpers.ts`, `menu-builder.ts`, `startup-global-handlers.ts`, `prompt-dropdown.ts`, `save-prompt-dropdown.ts`: Various nested helpers extracted to module scope with context interfaces
  - `hot-reload-section.ts`, `save-prompt.ts`, `section-auth-diag.ts`, `section-ws-history.ts`, `panel-controls.ts`, `ws-dialog-detection.ts`, `ws-move.ts`, `startup-persistence.ts`, `startup-token-gate.ts`, `macro-looping.ts`: Final 12 closures converted
  - `auth-diag-waterfall.ts` (`renderWaterfall`), `database-json-migrate.ts` (`checkDone`), `save-prompt-prompt-list.ts` (`updateStyles`), `save-prompt-task-next.ts` (`positionSubmenu`), `settings-tab-panels.ts` (`makeToggle`): Last 5 nested functions → `const` assignments
- **Type safety**: 4 `any` (3 test, 1 facade) and 2 `as unknown as` (SDK window access) — all justified
- **`Record<string, any>`**: 0 remaining

### Audit Report

- Full audit documented in `.lovable/memory/audit/macro-controller-cq-audit-2026-03-31.md`
- Compliance: CQ11/CQ12 100%, CQ13 100% (exceptions documented), CQ16 100% (all 60/60 fixed) ✅
- Version bump: 1.73.0 → 1.74.0

---

## v1.73.0 (2026-03-28)

### Performance Audit (MC-01 → MC-08, EXT-01 → EXT-03)

- **MC-01**: Replaced all hot-path `innerHTML` assignments with `textContent` for XSS safety and performance
- **MC-02**: Converted `element.style.cssText` bulk assignments to individual `style.*` properties where applicable
- **MC-03**: Replaced `setInterval` countdown timer with `requestAnimationFrame` for smoother rendering
- **MC-04**: Narrowed `MutationObserver` scope — `childList: true` on main container without `subtree`
- **MC-05**: Added conditional polling — diagnostics and status updates pause when tab is hidden or panel collapsed
- **MC-06**: Replaced `querySelector` lookups with cached `getElementById` where IDs exist
- **MC-07**: Deduplicated repeated DOM style strings into shared constants
- **MC-08**: Reduced macro controller bundle size by 12% (389 KB → 344 KB)
- **EXT-01**: Removed `framer-motion` dependency (0 KB saved in bundle, replaced with native CSS transitions)
- **EXT-02**: Tree-shook unused Radix UI subpath imports
- **EXT-03**: Lazy-loaded `MonacoCodeEditor` via `React.lazy()` + `Suspense` to defer ~2 MB Monaco bundle

### Type System Cleanup

- Eliminated **all** `as unknown as` double-casts (111 → 0) across the entire codebase
- Added index signatures to `XPathConfig`, `TimingConfig`, `TaskNextSettings`, and `LogManagerConfig` interfaces
- Changed `CreditManager.getState()` return type from `Record<string, unknown>` to `LoopCreditState`
- Added `taskNextDeps?` to `PanelBuilderDeps` interface (was accessed via double-cast)
- Replaced `resolve._timer` monkey-patch in auth recovery with a proper `Map<resolve, timer>`
- Added `MarcoSDK` interface to `globals.d.ts` for typed `window.marco` access
- Replaced `this as unknown as HTMLElement` patterns with direct element references
- Explicit `ThemePreset` construction in `resolvePreset()` schema v1 fallback (no more structural cast)
- Final audit: 0 `as unknown as`, 1 justified `as any` (class→facade window assignment)

### UIManager Registration & Bootstrap Refactor

- **Fixed**: `MacroController: UIManager not registered` error — `UIManager` was defined but never instantiated
- Wired up `new UIManager()` → `setCreateFn()` → `mc.registerUI()` in `macro-looping.ts`
- Refactored `bootstrap()` in `startup.ts` to use `mc.ui.create()` instead of `deps.createUI()`
- Removed `createUI` and `destroyPanel` from bootstrap dependency injection — UIManager now owns full lifecycle

### Housekeeping

- Archived completed performance audit specs to `spec/archive/`
- Version bump: 1.72.0 → 1.73.0 (all components synchronized)
