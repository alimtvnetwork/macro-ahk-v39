# Session 2026-04-24 — Installer contract + AC-2 main-branch fallback + Payment-banner-hider RCA + write-memory v3

## What happened

### 1. Shared installer contract (cross-language source of truth)
- Added `scripts/installer-contract.json` — single source of truth (repo, semver regex, exit codes 0–6, flags, endpoints, sibling-discovery defaults, checksum settings, AC-IDs).
- New `scripts/generate-installer-constants.mjs` emits `installer-constants.{sh,ps1}` consumed (opt-in, with inline fallbacks preserved for curl-piped standalone installs) by both installers.
- New `scripts/check-installer-contract.mjs` drift detector: verifies generated files in sync, every `exit N` declared, every CLI flag declared, default-repo strings agree.
- **Long-standing bug fixed:** `install.ps1` was hardcoded to `macro-ahk-v31` while `install.sh` used `macro-ahk-v31`.
- Suite status: drift detector ✓, resolver **46/46**, mock-server **62/62**, vitest **484/484**.
- Version → **v2.228.0**.

### 2. AC-2 — main-branch fallback in `install.sh`
- `fetch_latest_version()` now distinguishes `200+empty` / `404` (→ `__MAIN_BRANCH__` sentinel + 🌿 banner, exit 0) from `5xx`/network (→ exit 5 unchanged).
- New `download_main_branch_tarball()` fetches `archive/refs/heads/<MAIN_BRANCH>.tar.gz`; `install_extension()` handles tar.gz with `--strip-components=1`.
- VERSION file records `<branch>@HEAD`.
- Mock server: `MOCK_ZERO_RELEASES=1|404` + new tarball route + ustar `buildFakeTarGz()`.
- AC-2 added (12 new assertions, 2 sub-cases).
- Spec §2.2 rule 2 + AC-2 row updated.
- **`install.ps1` mirror is still pending** (plan.md #4).

### 3. Installer hardening v0.2 — SHA-256 checksum verification
- `install.sh` `verify_checksum()` + `install.ps1` `Test-Checksum` fetch `checksums.txt` from same release, compare SHA-256, exit 6 on mismatch, soft-warn on missing/no-tool.
- 3 new ACs (AC-21/22/23) + 12 assertions.

### 4. Documentation
- New `docs/installer-guide.md` — resolver order, CLI/env vars, exit codes, checksum behavior, troubleshooting.
- New §1a "Copy-paste recipes" — six scenarios across Bash and PowerShell (strict pinned, discovery, dry-run, custom dir, combined, air-gapped/mirror).
- `readme.md` updated with linked guide, checksum subsection, main-branch fallback subsection, refreshed exit-codes table.

### 5. Payment-banner-hider RCA (documentation only — refactor NOT executed)
- Created `spec/22-app-issues/98-payment-banner-hider-violation-rca.md` — maps 8 violations to existing standards + acceptance criteria.
- Created `mem://rca/01-2026-04-24-payment-banner-hider-violations` — verbatim violation table + the rule going forward.
- Created `mem://standards/no-unjustified-raf` — `requestAnimationFrame` is default-deny without a justifying comment.
- Updated `.lovable/plan.md`:
  - Pending #1 — refactor task (High).
  - New "🔍 Review items" section R1–R11 — every guideline that was violated, plus where the rule lives, plus how to verify enforcement.

### 6. Write-memory protocol v3.0 (this session)
- New `.lovable/prompts/03-write-memory.md` — adds CI/CD issues folder + verbatim spec capture rules.
- New `.lovable/cicd-index.md` + `.lovable/cicd-issues/01-installer-contract-not-in-ci.md` — first CI/CD issue logged (drift detector not wired into `installer-tests.yml`).
- RCA file renamed `2026-04-24-…` → `01-2026-04-24-…` to match numeric-prefix convention.

## What is pending

See `.lovable/plan.md` Pending #1–#5 and the Review items R1–R11. The single highest-priority item is the **payment-banner-hider refactor** (per Issue 98 RCA). The user has explicitly NOT yet approved the refactor — only the documentation step.

## What was learned

- "Single source of truth" generators MUST land with their CI enforcement step in the same PR; otherwise the contract erodes silently. (See `.lovable/cicd-issues/01-...`.)
- Verbatim user specs need to live in the file system (spec tree + memory pointer), not just chat history. Codified in v3 write-memory.
- The 8 banner-hider violations all came from skipping `mem://standards/pre-write-check`. The standards index already had every rule. The fix is procedural, not new rules.

## Files touched this session (summary)
- `scripts/installer-contract.json` (new)
- `scripts/generate-installer-constants.mjs` (new)
- `scripts/check-installer-contract.mjs` (new)
- `scripts/install.sh`, `scripts/install.ps1` (refactored)
- `scripts/installer-constants.sh`, `scripts/installer-constants.ps1` (generated)
- `tests/installer/mock-server.test.sh`, `tests/installer/resolver.test.sh` (extended)
- `docs/installer-guide.md` (new)
- `readme.md` (updated)
- `spec/22-app-issues/98-payment-banner-hider-violation-rca.md` (new)
- `.lovable/memory/rca/01-2026-04-24-payment-banner-hider-violations.md` (renamed from undated form)
- `.lovable/memory/standards/no-unjustified-raf.md` (new)
- `.lovable/plan.md` (updated)
- `.lovable/prompts/03-write-memory.md` (new — this protocol)
- `.lovable/prompt.md` (index updated)
- `.lovable/cicd-index.md` (new)
- `.lovable/cicd-issues/01-installer-contract-not-in-ci.md` (new)
- `.lovable/memory/workflow/15-session-2026-04-24-installer-contract-and-banner-hider-rca.md` (this file)
- `.lovable/memory/index.md` (updated)
