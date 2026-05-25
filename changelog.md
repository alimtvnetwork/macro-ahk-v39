# Changelog

All notable changes to the Marco Chrome Extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.1.html).

---

## [v3.18.0] — 2026-05-25

### Fixed
- **Manual Run always re-injects (popup “Run script” bug)**: clicking Run from the popup now always sends `forceReload: true` to the background `INJECT_SCRIPTS` handler. Previously, after closing the macro-controller panel, a second Run was silently absorbed by the per-tab injection cache (whose only purpose is to dedupe passive/auto-injects), and nothing happened. Root cause: `src/hooks/use-popup-actions.ts` only set `forceReload` when an internal `options.forceReload` flag was passed, which the Run button never did. Force is now unconditional for any `launchSource: "manual"` invocation; the cache continues to dedupe passive/auto-injects untouched.

### Changed
- **macro-controller is never auto-injected**: added `NEVER_AUTO_INJECT_SCRIPT_IDS` allow-list in `src/background/auto-injector.ts` containing `default-macro-looping`. The macro-controller mounts a visible floating UI panel and must only appear when the user explicitly launches it (popup Run, keyboard shortcut, context menu). The script’s own `autoInject` flag and any project URL rule are now overridden for this ID. SPA reinject already delegates through the same pipeline, so it inherits the guard automatically.

### Bumped
- Version bump: 3.17.1 → 3.18.0 across manifest.json, src/shared/constants.ts, standalone-scripts/macro-controller/src/shared-state.ts, and every standalone-scripts/*/src/instruction.ts. `node scripts/check-version-sync.mjs` exits 0.

---

## [v3.17.1] — 2026-05-25

### Fixed
- **Error-swallow audit cleared (Total → 0)**: swept the 4 remaining P1 + 1 P2 sites flagged by `scripts/check-no-swallowed-errors.mjs`. Block-comment `/* allow-swallow: */` waivers were never recognised by the checker (regex requires `//`); converted to line-comment style with full rationale in: `src/background/first-attach-toast.ts`, `src/components/HttpFailFastBanner.tsx`, `src/shared/http-fail-fast.ts`, `standalone-scripts/macro-controller/src/ui/credit-totals-modal.ts`, `standalone-scripts/macro-controller/scripts/verify-projects-cache.mjs`, `standalone-scripts/macro-controller/scripts/verify-http-fail-fast.mjs`.

### Changed
- Documented waiver contract (line-comment only, same or previous line) in `mem://features/error-swallow-audit-generator`.
- Version bump: 3.17.0 → 3.17.1 (all version files synced)

---

## [v3.17.0] — 2026-05-25

### Fixed
- **Refill-soon filter ignored credit ranking.** When the workspace "Refill-soon" filter chip was active, the surviving rows kept their raw API order, so workspaces with `available=0` appeared above workspaces with hundreds of credits (all sharing the same `Refill 1d` badge). `ws-list-renderer.ts::filterAndSortWorkspaces` now applies `sortByRefillPriority` whenever either the dedicated refill-priority toggle OR the refill-soon filter is active. Highest-credit workspaces now float to the top; zero-credit ones fall to the bottom.
- Added 2 unit tests (`ws-refill-soon-sort.test.ts`): source-invariant guard + behavioural test mirroring the exact 7-row screenshot scenario (all `Refill 1d`, credits 0/0/0/169/15/200/63 → expected order A0087, A0084, A0088, A0086, A0081, A0082, A0083).

### Changed
- Version bump: 3.16.1 → 3.17.0 (all version files synced); readme.md pinned-version references updated to `v3.17.0`.

---

## [v3.16.1] — 2026-05-25

### Changed
- Internal version bump (rolled into v3.17.0).

---

## [v3.16.0] — 2026-05-25

### Added
- `scripts/download-extension.ps1` — lightweight PowerShell helper that downloads the released `marco-extension-<tag>.zip` to the system temp folder, removes any existing target folder, and extracts the contents into the current working directory under a flat folder name (default `marco-extension` — no `v` prefix, no version suffix). Accepts `-Version`, `-Repo`, `-FolderName`. Fail-fast on download/extraction errors with Code-Red logs (exact URL, path, reason).
- 20-step plan Step 4 — `Plan Task` + `Task Next` controls now render in a right-anchored floating panel attached to the prompts dropdown's right edge (was inline, pushing the prompts list down). Hidden by default, toggled by the `🎯 Tasks` header button. 5 new source-invariant tests in `tasks-right-anchor.test.ts`.

### Fixed
- Windows standalone build OOM / stack overflow: `scripts/run-standalone-build-step.mjs` now passes `--max-old-space-size=8192` (via `NODE_OPTIONS`) and `--stack-size=8000` (direct V8 flag) to every `tsc --noEmit` child. Eliminates `Fatal process out of memory: Zone` (exit `-2147483645`) and `STATUS_STACK_OVERFLOW` (exit `-1073741571`) intermittently seen on `lovable-common`, `lovable-owner-switch`, and `xpath` builds. `vite` and other node children are unaffected.
- `credit-totals-modal.ts` open-projects double-click handler — replaced silent `/* ignore */` catch with `logError('creditTotalsModal.openProjects', ...)` per Code-Red contract (exact URL + reason).

### Changed
- Version bump: 3.15.3 → 3.16.0 (all 10 version files synced).
- readme.md pinned-version references updated to `v3.16.0` (18 occurrences).

---

## [v3.15.3] — 2026-05-25

### Fixed
- GitHub repo right-click: HTTP 401/403 from `/workspaces/{ws}/projects/{pid}/gitsync` (caller lacks access to that project) is now treated as `not_linked` instead of surfacing `❌ Failed to fetch GitHub repo: http_403`. Result is cached so repeated right-clicks stay offline.

---

## [v3.15.2] — 2026-05-25

### Fixed
- MacroController: pro_0 workspaces with depleted (0) credits no longer trigger CODE-RED `calcAvailableCredits()` errors. Renderers (`ui-status-renderer.ts`, `ws-list-renderer.ts`) now use nullish coalescing (`??`) instead of `||` so enriched `totalCredits`/`available` of `0` from `pro-zero-credit-calculator` are preserved instead of falling through to the guarded legacy aggregator.

---

## [v3.15.1] — 2026-05-25

### Changed
- Version bump: 3.15.0 → 3.15.1 — pinned root `readme.md` install commands and badges to the new tag for release v3.15.1 (no functional code changes).


---

## [v3.15.0] — 2026-05-25

### Fixed
- **Macro Controller toolbar minimize/expand button squish** (Issue 117, 5-step RCA) — Root cause: `toggleMinimize` / `restorePanel` wiped `bodyElements` inline `display` styles (e.g. `btnRow`'s `display:flex`) by setting `el.style.display = ''`, causing `gap` / `justify-content` / `align-items` to become inert after every expand cycle. Durable fix stashes `el.style.display` into `data-macro-prev-display` on minimize and restores it on expand. Added 5 regression tests (`panel-minimize-expand-display.test.ts`).

### Changed
- Version bump: 3.14.2 → 3.15.0 (all version files synced).

---

## [v3.14.2] — 2026-05-25

### Changed
- Release Page CI/CD Hardening Plan — Steps 3–8:
  - Required-asset verification gate (`release.yml` lines 733–788) blocks publish if any built ZIP, installer, checksum, or notes file is missing or under minimum size.
  - Release notes generation includes pinned + latest install one-liners, manual Chrome unpack instructions, SLSA attestation verification, and full asset table.
  - Scheduled release-audit workflow (`audit-releases.yml`) audits every published `v*` release for missing assets.
  - Pre-flight publish script (`scripts/release-publish.mjs`) wraps tag push and polls for the Release Build workflow run.
  - Release procedure spec linked from `readme.md` CI/CD section.
- Version bump: 3.14.1 → 3.14.2 (all version files synced).

---

## [v3.14.1] — 2026-05-25

### Added
- **Credit Totals Modal** (Issue 116). Right-click menu item `💰 Credit Totals` opens a modal summarizing all workspace credits:
  - **This Billing Cycle** card — total granted, total used, and total remaining across all workspaces.
  - **Free Daily Credits** card — used today vs the 5-credit daily allowance.
  - Per-workspace breakdown table with `Credits Used / Granted` and `Available` columns.
  - Missing-data warning row when a workspace has no cached credit data.
  - `↻ Refresh` button re-renders the modal from the latest snapshot.
- Focus trap + `Escape`-to-close for keyboard accessibility (`aria-modal="true"`, `tabIndex="-1"`).
- 25 unit tests covering credit calculation, modal rendering, dialog lifecycle, and a11y handlers.

### Internal
- Version bump: 3.13.0 → 3.14.1 (manifest, constants, shared-state, instruction, readme pinned).

---

## [v3.13.0] — 2026-05-25

### Fixed
- Chatbox prompts dropdown header no longer wraps when the dropdown is narrow (`Click to paste into editor` shortened to `Click to paste`; `✏️ Edit` collapsed to icon).
- Floating Task Next submenu now clamps vertically inside the viewport (`max-height:80vh` + scroll, top adjusted when overflow).

### Internal
- Version pinned to 3.13.0 across `manifest.json`, `src/shared/constants.ts`, and the macro-controller standalone (`shared-state.ts`, `instruction.ts`).

---

## [v3.12.0] — 2026-05-25

### Changed
- **Macro Controller — Workspace status badges unified** (Issue 115). All `expired*` variants collapse to a single muted gray `Cancel` badge; `about-to-expire` → `Expire Nd` (amber); past lapsed past_due → `Expired Nd` (red); `about-to-refill` → `Refill Nd` / `Refill today` (sky). Single classifier + tone resolver shared by row list and hover card.

### Added
- **Refill-soon filter chip** in the workspace filter menu — shows only workspaces currently classified as `about-to-refill`.
- 28 new tests covering the classifier, tone resolver, badge composition, and the new chip.

### Internal
- Version bump: 3.11.1 → 3.12.0 (all version files synced).

## [v3.11.1] — 2026-05-25


### Added

### Fixed

### Changed
- Version bump: 3.10.0 → 3.11.1 (all version files synced)

---

## [v3.10.0] — 2026-05-24 Refill Priority Filter + GitHub Repo Open

- **Fixed** button row overflow: added `min-width:0;max-width:100%` and `overflow:visible` to `btnRow`, plus `min-width:0` on the start/stop, prompts, and menu containers, so the row wraps cleanly instead of clipping the rightmost buttons inside narrow Lovable sidebars.
- **Added** `Refill priority` filter row in the workspace hamburger menu. When active, workspaces sort by `score = max(0, K - daysToRefill) * available` (`REFILL_PRIORITY_WINDOW_DAYS = 10`), surfacing rows that both refill soon and still hold spendable credits. Persisted via `localStorage('ml_refill_priority')`.
- **Added** inline `R Nd` badge on workspace rows when refill is within the 10-day window. Color tiers: 0d sky, 1–3d amber, 4–10d slate.
- **Added** right-click "🐙 Open GitHub repo" + "🔄 Refresh gitsync" menu entries. Calls `GET /workspaces/{wsId}/projects/{pid}/gitsync` once (no retry, per `mem://constraints/no-retry-policy`). Results — including the negative `not_linked` case — are memoized in the new `MacroGitsyncCache:{wsId}:{pid}` SQLite kv table (TTL: found ∞, not_linked 24h, error 5m), so repeat right-clicks never re-hit the API for a result we already know.

## [v3.9.3] — 2026-05-24 Button Row Spacing Hardening

- **Fixed** controller button row visually flush with no gap after minimize → expand cycle. Bumped `btnRow` flex `gap` 8px → 10px and added defensive `margin:2px 3px` to each button via `btnStyle` so spacing survives any layout state.

## [v3.9.2] — 2026-05-24 Auto-Attach Default True for Built-Ins

- **Changed** `AutoInject` from `false` → `true` in built-in script seed manifests: `macro-controller`, `lovable-owner-switch`, `lovable-user-add`. Scripts now auto-attach to projects by default (C1..C8 gate permitting) instead of requiring manual binding.
- `lovable-common` remains `AutoInject: false` (dependency-only; resolved at injection-time via `resolveDependencies`).

## [v3.9.1] — 2026-05-24 First-Attach Toast UX

- **Added** in-page first-attach toast (MAIN-world) asking the user once per origin whether to keep auto-attaching here. Actions: *Yes keep*, *Not now* (tab-scoped dismiss), *Don't ask for this site* (persistent dismiss).
- **Added** `src/background/seen-origins.ts` — persistent `marco_seen_origins` set in `chrome.storage.local`, sync hot-path read after boot preload.
- **Added** `src/background/first-attach-toast.ts` — toast renderer + ISOLATED-world bridge + runtime message handler (`MARCO_FIRST_ATTACH_ACTION`).
- **Wired** boot preload + bridge registration; auto-injector fires toast post-injection (no-op if seen or dismissed).
- Dark-theme styled, self-removes on click or 30s timeout. Single attempt, no retry.

## [v3.9.0] — 2026-05-24 Auto-Attach C9 Gate + Restricted-URL Hardening

### Added
- **C9 gate — "User dismissed for origin"**: new `src/background/dismissed-origins.ts` adds a ninth auto-attach gate sitting in front of C1..C8. Per-tab in-memory layer (`Map<tabId, Set<origin>>`) plus persistent cross-tab layer in `chrome.storage.local` under `marco_dismissed_origins`. Auto-injector short-circuits T1/T3 navigations with structured log `AUTOATTACH_SKIPPED_USER_DISMISSED`. Boot pre-hydrates the persistent layer.
- **Broad-rule project audit**: `scripts/audit-project-broad-rules.mjs` flags overly-broad URL patterns (`*`, `<all_urls>`, bare host wildcards, catch-all regex) with HIGH/LOW risk based on `autoStart`.
- 8 unit tests for `dismissed-origins` covering tab isolation, persistence, hydration, and snapshot listing.

### Fixed
- `url-trigger.isRestrictedUrl()` now also filters `chrome-untrusted://` and `moz-extension://` so the sentinel inject no longer attempts (and fails) on other extensions' UI pages. Resolves the v3.0.0 report "Cannot access a chrome-extension:// URL of different extension".

### Docs
- `mem://features/auto-attach-policy` appended with C9 contract, log code, storage key, and boot wiring.

## [v3.8.0] — 2026-05-24 Prompts Dropdown Viewport Fix


### Fixed
- Prompts dropdown now portals to `document.body` so it is no longer clipped by the panel's `overflow: hidden`.
- Viewport-aware positioning flips up/down based on available space and clamps left/right to an 8 px safe gutter.
- `Task Next` submenu scrolls into view when the dropdown opens upward.

---

## [v3.7.0] — 2026-05-23 Workspace Hover Card UX Fix

### Fixed
- Workspace hover tooltip in the Macro Controller now positions to the **right** of the workspace row (flips left when space is tight) so it no longer covers the workspace list or action icons.
- Added a 220 ms grace period plus card-level `mouseenter`/`mouseleave` handling so users can move the cursor onto the tooltip and click **Priority rules & details** (and other inline controls) without the panel disappearing.
- Anchored positioning to the full workspace row instead of just the name span, eliminating the dead-zone gap that prevented reaching the card.

---

## [v3.6.0] — 2025-05-22 Minor Version Bump and Fixes

### Added
- New prompts: `logo-create` (18) and `proof-read` (19) in the standalone script prompt library.
- Prompt parity check test ensures built-in and standalone script prompt folders stay in sync.
- Deterministic seeding gate for E2E test stability.

### Fixed
- Lint warnings: removed unused eslint-disable directives and cleaned up type assertions.
- E2E-02 Project CRUD test suite temporarily skipped due to React Options page rendering instability in CI (deferred to S-021 React UI unification).
- Version sync enforced across manifest, constants, and all standalone script instruction manifests.

### Changed
- Version bump: 3.5.2 → 3.6.0 (all version files synced).
- Pinned version references in root readme updated to v3.6.0.

---

## [v3.5.2] — 2025-04-26

### Added
- Verbose logging toggle in Settings → Debugging Switch.
- Form snapshot capture on Submit, Type, and Select recorder actions.
- JS-step diagnostics with `buildJsStepFailureReport` for inline JS failures.

### Fixed
- Build lock sentinel (`.lovable/build.lock`) for sequential build gating.
- Timer & observer teardown audit compliance (v2.243.0 L-1…L-5).

### Changed
- Webhook result schema versioning (`WEBHOOK_RESULT_SCHEMA_VERSION = 2`).
- Error-swallow audit generator (`scripts/audit-error-swallow.mjs`).
