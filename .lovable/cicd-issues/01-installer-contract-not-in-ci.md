# `check:installer-contract` not wired into installer-tests workflow

## Pipeline / Workflow
`.github/workflows/installer-tests.yml`

## Description
The drift detector `scripts/check-installer-contract.mjs` was added in v2.228.0 to enforce that `scripts/install.sh`, `scripts/install.ps1`, and the generated `installer-constants.{sh,ps1}` stay in sync with `scripts/installer-contract.json` (single source of truth for repo, semver regex, exit codes, flags, endpoints, sibling-discovery defaults, checksum settings, AC-IDs).

It runs locally and is correctly wired into `package.json` as `check:installer-contract`, but it was **not** invoked by the CI workflow. A future drift between the two installers (like the long-standing default-repo bug — `install.ps1` hardcoded to `macro-ahk-v29` while `install.sh` used `macro-ahk-v29`) could land on `main` without being caught.

## First Seen
2026-04-24 (introduced with the shared installer contract)

## Root Cause
The contract + drift detector were shipped in the same session as the AC-2 main-branch fallback work; the CI integration task was logged in `plan.md` (Pending #5) but never executed.

## Status
✅ **Resolved 2026-04-24**

## Fix applied
Two changes to `.github/workflows/installer-tests.yml`:

1. **Path triggers extended** so contract edits also fire CI:
   ```yaml
   - 'scripts/installer-contract.json'
   - 'scripts/installer-constants.*'
   - 'scripts/check-installer-contract.mjs'
   - 'scripts/generate-installer-constants.mjs'
   ```

2. **Drift step inserted before the test bundle** in the `linux` job so a contract mismatch fails fast (before pwsh-install + the four-suite bundle even start):
   ```yaml
   - name: Check installer contract drift
     run: node scripts/check-installer-contract.mjs
   ```

   No `npm ci` step needed — `check-installer-contract.mjs` uses only Node built-ins (`fs`, `path`, `os`, `url`).

   Not duplicated in the `windows-movefileex-e2e` job because the script is platform-agnostic (compares `installer-constants.{sh,ps1}` byte-for-byte against a re-generation from the JSON contract — no shell semantics involved). One run on Linux per push/PR is sufficient.

## Verification
- YAML parses (PyYAML safe_load OK; jobs: `linux`, `windows-movefileex-e2e`).
- Step order on `linux`: Checkout → Setup Node → Install pwsh → **Check installer contract drift** → Run installer test bundle.
- `node scripts/check-installer-contract.mjs` passes locally: `✓ installer-contract.json in sync with install.sh + install.ps1`.

## Prevention
- Every new "single source of truth" generator (like `installer-contract.json` → `installer-constants.{sh,ps1}`) MUST land with its CI step in the same PR.
- Memory rule added: see `mem://standards/contract-generators-need-ci`.

## References
- `scripts/installer-contract.json`
- `scripts/check-installer-contract.mjs`
- `scripts/generate-installer-constants.mjs`
- `.github/workflows/installer-tests.yml` (path triggers + drift step)
- `.lovable/plan.md` Pending #5 (closed 2026-04-24)
