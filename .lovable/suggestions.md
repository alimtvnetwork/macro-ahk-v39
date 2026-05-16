# Suggestions

> Single source of truth. The previous tracker at `.lovable/memory/suggestions/01-suggestions-tracker.md` (S-001 … S-055) is preserved and remains the historical archive for IDs and completion notes. New suggestions land here.

---

## Active Suggestions

### Round-trip files (file:save → file:list → file:delete) and grouped-kv in the SDK self-test
- **Status:** ✅ Implemented — 2026-05-16 (verified against existing code)
- **Priority:** Medium
- **Description:** Extend `standalone-scripts/marco-sdk/src/self-test.ts` to exercise the file-storage and grouped-kv handlers with the same set/get/delete pattern as the new KV round-trip, so every project-scoped storage surface is health-checked on every page load.
- **Added:** 2026-04-20 (session v2.166.0)
- **Resolution:** `runFilesRoundTrip` (line 243) drives `files.save → files.list (must include) → files.read → files.delete → files.list (must NOT include)` and `runGkvRoundTrip` (line 326) drives `gkv:set → gkv:get → gkv:delete → gkv:get (cleared)` directly through the bridge. Each surface logs its own PASS/FAIL via `NamespaceLogger` under `sdkSelfTest:files-roundtrip` / `sdkSelfTest:gkv-roundtrip`.

### Surface latest sdkSelfTest + kv-roundtrip results in the popup
- **Status:** ✅ Implemented — 2026-05-16 (verified against existing code)
- **Priority:** Medium
- **Description:** Show ✅/❌ + last-run timestamp in the popup so users see SDK health without opening DevTools.
- **Added:** 2026-04-20
- **Resolution:** `src/components/popup/SdkSelfTestPanel.tsx` renders a 4-row grid (sync / KV / Files / GKV) with per-surface ✅/❌ + last-run timestamp, backed by `chrome.storage.local["marco_sdk_selftest"]` written by `src/background/handlers/sdk-selftest-handler.ts`. Wired into `src/pages/Popup.tsx` (lazy import, line 19; rendered line 209).

### Vitest tests for `assertBindable` + `BindError`
- **Status:** ✅ Implemented — 2026-04-22
- **Priority:** Medium
- **Description:** Cover INSERT / UPDATE / SELECT / DELETE column inference and verify the Proxy throws `BindError` on undefined params via `db.run`, `db.exec`, and `db.prepare(...).bind()`/.run() paths.
- **Added:** 2026-04-20
- **Resolution:** New file `src/test/regression/sqlite-bind-safety.test.ts` adds 20 tests across 3 describe blocks: `BindError` shape, `assertBindable` column inference (8 SQL shapes incl. INSERT, INSERT OR REPLACE, UPDATE, SELECT, DELETE, fallback, first-undefined, long-SQL truncation, null-vs-undefined), and `wrapDatabaseWithBindSafety` Proxy interception (run/exec/prepare/Statement.bind/Statement.run/pass-through). Full suite: 293 tests passing in CI via `pnpm run test`.

### Vitest tests for handler-guards regression suite
- **Status:** ✅ Implemented — 2026-04-24
- **Priority:** Medium
- **Description:** Call `handleKvGet`, `handleGkvList`, `handleFileSave`, `handleProjectApi` with payloads missing each required field; assert clean `{ isOk:false, errorMessage }` responses (no SQLite throw).
- **Added:** 2026-04-20
- **Resolution:** New file `src/test/regression/handler-guards.test.ts` adds **27 tests** across 4 describe blocks (kv-handler 9, grouped-kv-handler 7, file-storage-handler 7, project-api-handler 4). Strongest invariant verified: when a required field is missing, the underlying SQLite Database is **never touched** (no `prepare`/`run`/`exec` calls) — proven via call-tracking fake DbManager. Also verifies error-message shape (`[<op>]` prefix + `'<field>'` name) and edge cases (empty-string, non-string, both-missing ordering). Full suite: **478/478** passing in `npx vitest run`.

### Hook `BindError` into the global Errors panel reporter
- **Status:** Pending
- **Priority:** Low
- **Description:** Any future undefined-bind escape should auto-land in the Errors panel with column + SQL preview, not just the message-router log.
- **Added:** 2026-04-20

### Audit remaining 8 SQLite-backed handlers for handler-guards adoption
- **Status:** ✅ Implemented — 2026-04-20 (v2.167.0)
- **Priority:** Medium
- **Description:** Apply `handler-guards` everywhere a payload field reaches `db.run` / `db.exec` / `stmt.bind`.
- **Added:** 2026-04-20
- **Resolution:** 4 of 8 had no SQLite surface; 3 hardened (prompt-handler, library-handler, updater-handler); project-config already guarded.

### S-021 — Chrome Extension Test Coverage Expansion (carry-over)
- **Status:** 🚫 Deferred (per user 2026-04-23 — `mem://preferences/deferred-workstreams`)
- **Priority:** Medium
- **Description:** Deeper integration tests; target 900+ tests.
- **Added:** 2026-03-14

### S-055 — P Store Backend API Implementation (carry-over)
- **Status:** 🚫 Deferred — discuss-later mode (per user 2026-04-23)
- **Priority:** High
- **Description:** P Store frontend spec exists but no backend API. F-025 — 100% failure until backend exists.
- **Added:** 2026-04-05

---

## Implemented Suggestions

### TS Migration V2 — Phase 02 / 03 / 04 / 05 (S-046 / S-051 / S-047 / S-048)
- **Implemented:** 2026-04-23 — v2.225.0
- **Notes:** Phases 02, 04, 05 verified/implemented; Phase 03 re-evaluated and formally **NOT PROCEEDING** (UI 15,223 lines < 20K threshold). Phase 05 added activity-log routing in `shared-state.ts` and 7 vitest cases in `__tests__/config-validator.test.ts`. Snapshot test suite stabilized via `vi.setSystemTime` — full suite **445/445** passing. See `mem://workflow/14-session-2026-04-23-ts-migration-v2-cleared`.

### SDK self-test KV round-trip (set → get → verify-equals → delete → verify-cleared)
- **Implemented:** 2026-04-20 — v2.166.0
- **Notes:** `standalone-scripts/marco-sdk/src/self-test.ts` now logs a follow-up `[sdkSelfTest:kv-roundtrip] PASS/FAIL` line via `NamespaceLogger`. Split into `runSdkSelfTest` + helpers (`checkShape`, `checkMeta`, `checkKvListSync`) and `runKvRoundTrip` + helpers (`hasFullKvSurface`, `tryStep`, `verifyGetEquals`, `verifyGetCleared`, `reportRoundTrip`) to satisfy zero-warning lint policy.

### Global SQLite bind-safety net via `wrapDatabaseWithBindSafety`
- **Implemented:** 2026-04-20 — v2.165.0
- **Notes:** New `src/background/sqlite-bind-safety.ts` exports `assertBindable(sql, params)` + typed `BindError` (param index, inferred column name, SQL preview) and a Proxy wrapper applied at `db-manager.buildManager()` and `project-db-manager.getProjectDb()`. Replaces the cryptic sql.js "tried to bind a value of an unknown type (undefined)" with a precise diagnostic.

### Audit SQLite handlers for missing-field guards
- **Implemented:** 2026-04-20 — v2.164.0
- **Notes:** New `src/background/handlers/handler-guards.ts` (validators `requireProjectId` / `requireKey` / `requireSlug` / `requireField`, binders `bindOpt` / `bindReq`, `safeBind`). Refactored `kv-handler.ts`, `grouped-kv-handler.ts`, `file-storage-handler.ts`, `project-api-handler.ts`, `logging-handler.ts`, `user-script-log-handler.ts`, `error-handler.ts`. Returns `{ isOk:false, errorMessage }` instead of crashing sql.js.

### SDK runtime self-test (sync surface)
- **Implemented:** 2026-04-20 — v2.161.0–v2.163.0
- **Notes:** `runSdkSelfTest()` validates `RiseupAsiaMacroExt.Projects.RiseupMacroSdk` namespace, `.meta`, shape (13 sub-namespaces), and that `.kv.list()` returns a Promise without throwing. Logs `[sdkSelfTest] PASS — Projects.RiseupMacroSdk vX.Y.Z (5 checks)` via `NamespaceLogger`.

### Build-time check for relative spec/ markdown links
- **Implemented:** 2026-04-20
- **Notes:** Added validator that scans `spec/**.md` for relative links and fails the build when targets are missing. Prevents silent rot of cross-spec references.

### Spec 11/63 + developer-guide updates for `RiseupMacroSdk` self-namespace
- **Implemented:** 2026-04-20
- **Notes:** Documents the SDK as the self-registered namespace and the stub-vs-full distinction.
