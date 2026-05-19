# 08 — Troubleshooting: Common CI Failures

> Collected from real CI debugging sessions. Each entry includes the exact
> error signature, root cause, and fix.

---

## 1. Version Mismatch Detected

**Error signature:**
```
❌ Version mismatch detected:
   manifest.json version: 2.119.0
   instruction.ts (macro-controller): 2.117.0
   dist/instruction.json (macro-controller): 2.117.0
```

**Root cause:** Not all version files were updated during a bump. The project
has multiple files that carry the version string (see [06-versioning.md](06-versioning.md)).
Missing even one causes `check-version-sync.mjs` to fail.

**Common missed files:**
- `standalone-scripts/macro-controller/src/instruction.ts` (often forgotten)
- `standalone-scripts/macro-controller/dist/instruction.json` (stale build artifact)

**Fix:**
```bash
# Update all version files at once
sed -i 's/OLD_VERSION/NEW_VERSION/g' \
  src/shared/constants.ts \
  standalone-scripts/macro-controller/src/shared-state.ts \
  standalone-scripts/macro-controller/src/instruction.ts \
  standalone-scripts/marco-sdk/src/instruction.ts \
  standalone-scripts/xpath/src/instruction.ts

# Rebuild dist/instruction.json
node scripts/compile-instruction.mjs standalone-scripts/macro-controller
```

**Prevention:** Always use `pnpm run bump` or update all version files in one operation.

---

## 2. ESLint — `Cannot read properties of undefined (reading 'allowShortCircuit')`

**Error signature:**
```
TypeError: Error while loading rule '@typescript-eslint/no-unused-expressions':
Cannot read properties of undefined (reading 'allowShortCircuit')
```

**Root cause:** Version mismatch between `@typescript-eslint/eslint-plugin` and
`@typescript-eslint/parser`.

**Fix:**
```bash
pnpm update @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

---

## 3. `pnpm install` — Frozen Lockfile Failure

**Error signature:**
```
ERR_PNPM_FROZEN_LOCKFILE  Cannot install with frozen lockfile
```

**Root cause:** The lockfile (`pnpm-lock.yaml`) doesn't exist or is out of sync
with `package.json`. Common in CI when the lockfile isn't committed, or after
dependency changes.

**Fix (CI workflow):**
```yaml
- name: Install root dependencies
  run: pnpm install --no-frozen-lockfile
```

---

## 4. ESLint — `max-lines-per-function` Warnings

**Error signature:**
```
warning  Function 'MyComponent' has too many lines (166). Maximum allowed is 50
```

**Root cause:** Function exceeds the configured line limit. Limits vary by directory:

| Directory | Max Lines |
|-----------|-----------|
| Default (src/) | 25 |
| React components (`src/components/`, `src/pages/`) | 50 |
| Background/hooks/lib | 40 |
| Standalone scripts | 50 |
| Tests | unlimited |

**Fix options (in order of preference):**
1. **Refactor** — extract sub-components or helper functions
2. **Eslint-disable** — for justified cases (factories, DOM builders):
   ```typescript
   // eslint-disable-next-line max-lines-per-function -- factory returning store with N async methods
   export function myFactory() {
   ```

**Gotcha:** The standalone-scripts override (`standalone-scripts/**/src/**/*.ts`)
must exclude `__tests__/` to avoid overriding the test exemption:
```javascript
{
  files: ["standalone-scripts/**/src/**/*.ts"],
  ignores: ["standalone-scripts/**/src/__tests__/**"],
  rules: { "max-lines-per-function": ["warn", { max: 50 }] },
}
```

---

## 5. ESLint — `sonarjs/cognitive-complexity` Warnings

**Error signature:**
```
warning  Refactor this function to reduce its Cognitive Complexity from 27 to the 15 allowed
```

**Root cause:** Function has too many branches, nested conditions, or loops.

**Fix options:**
1. **Extract helpers** — break conditional blocks into named functions
2. **Eslint-disable** — for build plugins, config resolvers:
   ```typescript
   writeBundle() { // eslint-disable-line sonarjs/cognitive-complexity -- build plugin with filesystem branching
   ```

---

## 6. ESLint — `sonarjs/no-duplicate-string`

**Error signature:**
```
warning  Define a constant instead of duplicating this literal 4 times
```

**Root cause:** Same string literal appears 4+ times in a file. Common with
log message prefixes or interpolation fragments like `'", section: "'`.

**Fix options:**
1. **Extract constant**: `const LOG_TAG = '[ModuleName]';`
2. **File-level disable** (for log format strings that resist extraction):
   ```typescript
   /* eslint-disable sonarjs/no-duplicate-string -- log format strings */
   ```

**Important:** `eslint-disable-next-line` does NOT work for this rule — the
warning is reported on the first occurrence but applies file-wide. Use
block-level `/* eslint-disable */` at the top of the file instead.

---

## 7. ESLint — Unused `eslint-disable` Directives

**Error signature:**
```
warning  Unused eslint-disable directive (no problems were reported from 'max-lines-per-function')
```

**Root cause:** A previous config change or refactor made the disable unnecessary.
Often happens after adjusting ESLint config overrides.

**Fix:**
```bash
npx eslint . --fix
```

The `--fix` flag automatically removes unused disable directives.

---

## 8. `ERR_UNKNOWN_FILE_EXTENSION` — Node.js `.ts` Import

**Error signature:**
```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"
```

**Root cause:** A build script tries to `import` a `.ts` file directly with
Node.js, which doesn't support TypeScript natively. Usually happens when
`instruction.ts` is imported at runtime instead of the compiled `instruction.json`.

**Fix:** Ensure the build pipeline compiles `.ts` → `.json` first:
```bash
node scripts/compile-instruction.mjs standalone-scripts/{name}
# Then import from dist/instruction.json, not src/instruction.ts
```

---

## 9. Standalone Script `dist/` Missing or Stale

**Error signature (from `check-standalone-dist.mjs`):**
```
❌ Missing dist for macro-controller: dist/macro-looping.js not found
```

**Root cause:** The standalone script wasn't built before the extension build.
The extension build expects all standalone `dist/` folders to already exist.

**Fix:** Follow the correct build order:
```bash
pnpm run build:sdk
pnpm run build:xpath
pnpm run build:macro-controller
pnpm run build:extension    # This one copies from the others
```

---

## 10. `pnpm-workspace.yaml` — Windows Store Path in CI

**Error signature:**
```
ERR_PNPM_STORE_DIR  The store directory is not accessible
```

**Root cause:** Local development on Windows may create a `pnpm-workspace.yaml`
with a Windows-specific `storeDir` path (e.g. `D:\pnpm-store`). If committed,
this breaks Linux CI runners.

**Fix (in CI workflow):**
```yaml
rm -f pnpm-workspace.yaml
```

**Prevention:** Add `pnpm-workspace.yaml` to `.gitignore` for subdirectories,
or never commit workspace configs with absolute paths.

---

## 12. PowerShell `Push-Location` — Extension Directory Not Found

**Error signature:**
```
Push-Location: ...\pnpm-config.ps1:19
Line |
  19 |      Push-Location $script:ExtensionDir
     |      ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     | Cannot find path '...\chrome-extension' because it does not exist.
```

**Root cause:** The `extensionDir` path configured in `powershell.json` does not
exist at runtime. This typically happens when:
- The repo was cloned without the Chrome extension subfolder
- `extensionDir` points to a path that was moved or renamed
- Working in a subdirectory repo (e.g., `macro-ahk-v35`) where the extension is at root (`"extensionDir": "."`)

**Fix:**
1. Check `powershell.json` — verify `extensionDir` matches your actual layout
2. See [01-architecture.md#powershelljson-configuration-schema](01-architecture.md#powershelljson-configuration-schema) for path semantics
3. Common layouts:
   - Extension at repo root: `"extensionDir": "."`
   - Extension in subfolder: `"extensionDir": "chrome-extension"`

**Prevention:** The `run.ps1` startup guard validates `$ExtensionDir` before any
`Push-Location` calls. Ensure `powershell.json` is committed and kept in sync
with repo structure changes.

---

## 11. ESLint — `react-refresh/only-export-components` False Positive

**Error signature:**
```
warning  Fast refresh only works when a file only exports components.
         Use a new file to share constants or functions between components
```

**Root cause:** A component file also exports non-component values (constants,
utility functions, types). React Refresh requires files to export only components
for hot module replacement to work correctly.

**Common scenario:** Removing an `eslint-disable` directive for this rule causes
the warning to reappear. Adding it back with a different comment style may also
trigger "unused directive" warnings if the export pattern changes.

**Fix:**
```typescript
// eslint-disable-next-line react-refresh/only-export-components -- shared constants used by sibling modules
export { MyComponent, MY_CONSTANT, helperFunction };
```

**Important:** If you remove the directive and the warning returns, you must
re-add it — the warning is real, not a false positive.

---

## General Debugging Checklist

When CI fails unexpectedly:

1. **Read the exact error** — copy the full error message, not just the step name
2. **Check which step failed** — lint, test, or build?
3. **Run locally first** — `pnpm run lint`, `pnpm run test`, `pnpm run build:extension`
4. **Check version sync** — `node scripts/check-version-sync.mjs`
5. **Check for stale artifacts** — rebuild standalone scripts if `dist/` is outdated
6. **Check dependency versions** — `pnpm ls` for version conflicts
