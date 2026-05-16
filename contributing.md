# Contributing to Marco Chrome Extension

Thank you for your interest in contributing to Marco. This guide covers the
development workflow, coding standards, and pull-request requirements.

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- **PowerShell** 7+ (Windows build orchestration only)

### Setup

```bash
git clone https://github.com/alimtvnetwork/macro-ahk-v33.git
cd macro-ahk-v33
pnpm install
cd chrome-extension && pnpm install && cd ..
```

### First Build

```bash
pnpm run build:sdk              # 1. Marco SDK
pnpm run build:xpath            # 2. XPath utility
pnpm run build:macro-controller # 3. Macro Controller
pnpm run build:extension        # 4. Chrome extension
```

Load `chrome-extension/dist/` as an unpacked extension in `chrome://extensions` (Developer mode).

### Windows (PowerShell)

```powershell
.\run.ps1 -d    # Full pipeline: build all + deploy to Chrome profile
```

---

## Development Workflow

### 1. Create a Branch

Branch from the latest `main`. Use the correct prefix:

| Prefix | Purpose |
|--------|---------|
| `feature/<desc>` | New functionality |
| `bugfix/<desc>` | Non-urgent fix |
| `hotfix/<desc>` | Urgent production fix |
| `refactor/<desc>` | Code restructuring |
| `chore/<desc>` | Build, CI, or tooling |
| `docs/<desc>` | Documentation only |

Names are lowercase, hyphen-separated, 2-4 words (e.g. `feature/add-prompt-caching`).

### 2. Write Code

Follow the project coding standards (26 rules in `spec/02-coding-guidelines/engineering-standards.md`):

**TypeScript / React:**

- **Strict TypeScript** — no `any` unless absolutely necessary (document why).
- **Functional components** with hooks. No class components.
- **Named exports** preferred over default exports.
- **No magic strings** — use constants with prefixes: `ID_`, `SEL_`, `CLS_`, `MSG_` in SCREAMING_SNAKE_CASE.
- Use **semantic Tailwind tokens** (`bg-primary`, `text-foreground`) — never raw colors (`bg-blue-500`, `text-white`).
- Components go in `src/components/`, grouped by feature.
- Hooks go in `src/hooks/`.
- Keep files under ~200 lines. Extract when they grow.

**General:**

- **Positive conditionals** — `if ready` not `if !notReady`.
- **Boolean names** start with `is` or `has`.
- **Blank line before `return`** (except single-line bodies).
- **All errors include exact file path, missing item, and reasoning** — optimized for AI diagnosis.
- **Dark-only theme** — never add light mode or theme toggles.
- **ASCII-safe console output** — use `[OK]`, `[FAIL]`, `[WARN]`, `[INFO]` prefixes, no Unicode symbols in build output.
- **ESLint + SonarJS** — zero warnings, zero errors enforced.
- **BgLogTag imports** — any background module using BgLogTag must explicitly import it from `bg-logger`.

**Naming Conventions:**

| Item | Convention | Example |
|------|-----------|---------|
| Components | PascalCase | `WorkspaceDropdown.tsx` |
| Hooks | camelCase, `use` prefix | `useWorkspaceCredits.ts` |
| Utilities | camelCase | `formatCredits.ts` |
| Constants | UPPER_SNAKE_CASE with prefix | `ID_AUTH_PANEL`, `SEL_WORKSPACE_DROPDOWN` |
| CSS classes | kebab-case via Tailwind | `text-muted-foreground` |

**PowerShell (Build Scripts):**

- Use approved verbs (`Get-`, `Set-`, `Invoke-`).
- Parameters with `[CmdletBinding()]` and typed params.
- Verbose output behind `-Verbose` or project `-v` flag.

See [`spec/02-coding-guidelines/`](spec/02-coding-guidelines) for the full ruleset.

### 3. Run Checks Locally

Run these before pushing:

```bash
pnpm run lint                   # ESLint + SonarJS (zero warnings)
pnpm run test                   # Vitest test suite
pnpm run build:extension        # Full extension build with validation
pnpm run lint:macro             # Const reassignment lint for standalone scripts
```

Or on Windows:

```powershell
.\run.ps1 -q    # Quick build to verify extension compiles
```

### 4. Commit Messages

Format: `<type>(<scope>): <subject>`

| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Restructuring (no behavior change) |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling, dependency updates |
| `perf` | Performance improvement |
| `style` | Formatting (no logic change) |
| `build` | Build system or dependencies |

Rules:

- Subject <= 72 characters, imperative mood, no trailing period.
- One logical change per commit.
- No `WIP` commits — squash before opening a PR.

```
feat(workspace): add smart switching to skip depleted
fix(injection): resolve focus-steal on detached console
docs(readme): add build flag reference table
refactor(auth): extract waterfall into AuthBridge class
build(ps1): add -q quick mode flag
```

---

## Pull Request Requirements

### Before Opening

- [ ] Code compiles and all tests pass locally (`pnpm run test`).
- [ ] Self-reviewed the diff — no debug code, commented-out blocks, or orphan TODOs.
- [ ] Commit messages follow the `<type>(<scope>): <subject>` convention.
- [ ] New or changed behavior has corresponding tests.
- [ ] Documentation updated where applicable.
- [ ] No unrelated changes bundled into the PR.
- [ ] Version bumped (at least minor) if code changed — manifest, `constants.ts`, standalone scripts must stay in sync.

### PR Size Limits

| Metric | Target | Hard Limit |
|--------|--------|------------|
| Changed lines | <= 200 | <= 400 |
| Files changed | <= 5 | <= 10 |
| Commits | <= 3 | <= 5 |

PRs exceeding hard limits must be split before review. Exceptions: generated
code, migrations, or vendor updates (with justification).

### Description Template

```markdown
## What

One-sentence summary of the change.

## Why

Link to spec, issue, or business rationale.

## How to Test

1. Step-by-step manual verification.
2. Or: `pnpm run test`.

## Screenshots (if UI)

Before/after screenshots or screen recordings.
```

### Branch Rules

- Rebased onto current `main` before requesting review.
- No merge commits in the PR branch.

---

## Review Process

### Standard Flow

1. Author opens PR with the completed checklist.
2. Assign at least one reviewer with domain knowledge.
3. Reviewer approves or requests changes within **one business day**.
4. Author resolves all comments — nothing deferred.
5. Final approval required before merge.
6. Merge via **squash merge** (default).

### Critical Path Flow

Changes to authentication, injection pipeline, storage layers, CI/CD pipelines,
or the seeding system require:

- **Two approving reviews**, including the lead architect.
- Security-sensitive changes tagged for security review.
- Schema or storage changes require data-layer review.

### Review Etiquette

- Be specific: _"Rename `d` to `duration` for clarity"_ not _"naming is unclear."_
- Prefix with `nit:`, `suggestion:`, or `blocker:` to distinguish severity.
- Explain _why_ — link to a guideline or explain the risk.
- Acknowledge good work.

---

## CI Checks

All PRs must pass these automated gates before merge:

| Check | Tool | Blocks Merge |
|-------|------|:------------:|
| Lint | ESLint + SonarJS | Yes |
| Unit tests | Vitest | Yes |
| Build | Vite (extension + standalone) | Yes |
| Version sync | `check-version-sync.mjs` | Yes |
| Const reassign | `lint-const-reassign.mjs` | Yes |
| Storage PascalCase rewrite | `check-no-storage-pascalcase-rewrite.mjs` | Yes |

**No email or notification is sent for CI results** — check the Actions tab for status.

---

## Storage Migration Rules

> ⛔ **Phase 2c-storage v2 (PascalCase rewrite of `StoredProject` keys in `chrome.storage.local`) is permanently banned.** Do not propose, draft, or ship it. See `mem://constraints/no-storage-pascalcase-migration`.

### Banned

- Renaming/rewriting persisted `StoredProject` keys from camelCase to PascalCase.
- Registering any migration with `version > MAX_ALLOWED_STORAGE_SCHEMA_VERSION` (currently `1`).
- Identifiers: `renameStorageKey`, `migrateStoredProjectKeys`, `pascalCaseStoredProject`.
- `chrome.storage.local.set({ PascalKey: ... })` for project payloads.

### Permitted

- Additive, backward-compatible schema changes (new optional fields).
- Bumping `CURRENT_STORAGE_SCHEMA_VERSION` **together with** `MAX_ALLOWED_STORAGE_SCHEMA_VERSION` for additive migrations.
- In-memory PascalCase compat snapshots (e.g. `compile-instruction` dual-emit); persisted shape stays camelCase.
- Read-side normalization: accept both shapes, always write camelCase.
- Destructive key changes only with a written RFC and explicit user sign-off.

### Enforcement

1. **Runtime** — `assertNoPascalCaseStorageMigration()` in `src/background/storage-migration.ts`.
2. **Test** — `src/background/__tests__/storage-migration-guard.test.ts`.
3. **CI** — `pnpm run check:no-storage-pascalcase-rewrite` (wired into `build` and `build:dev`).

---

## Release Process

Releases follow semantic versioning (`vMAJOR.MINOR.PATCH`):

1. Create a `release/v{VERSION}` branch from `main`.
2. Push the branch — CI automatically:
   - Runs tests and builds all standalone scripts + extension
   - Copies `readme.md` + `VERSION` into the extension dist
   - Zips `chrome-extension/dist/` and creates a GitHub Release
3. The release includes install scripts (`.ps1` and `.sh`) as downloadable assets.

> The `.release` folder must remain unmodified at all times.

### Version Sync

All version numbers must be identical across:

- `chrome-extension/src/manifest.json` -> `version`
- `chrome-extension/src/constants.ts` -> `EXTENSION_VERSION`
- `.gitmap/release/latest.json` -> `version`
- Standalone script `instruction.ts` files

The `check-version-sync.mjs` script validates this at build time.

---

## Adding a New Standalone Script

1. Create `standalone-scripts/{name}/src/index.ts` and `src/instruction.ts`
2. Add a TypeScript config: `tsconfig.{name}.json`
3. Add a Vite config: `vite.config.{name}.ts`
4. Add `build:{name}` script in root `package.json`
5. The build pipeline auto-discovers and deploys it

The `instruction.ts` is the sole manifest — it declares metadata, dependencies,
files, and injection behavior. No separate config files needed.

---

## Project Structure Rules

- **`chrome-extension/`** — MV3 extension code (background, content scripts, popup, options).
- **`standalone-scripts/`** — Injectable scripts, independent of React build.
- **`spec/`** — All documentation. One topic per folder, no duplicates.
- **`build/ps-modules/`** — PowerShell build modules.
- **`scripts/`** — Build helpers and install scripts.

Do not add backend server code (Node.js, Python, etc.) to the project — this is a client-side extension.

---

## Specs and Architecture

For significant features or architectural changes, create or update a
specification in [`spec/`](spec/) for review **before** implementation. The spec
directory follows a numeric hierarchy:

| Directory | Purpose |
|-----------|---------|
| `00-standards` | Project overviews |
| `01-app-issues` | Root cause analyses |
| `02-data-and-storage` | Storage layer specs |
| `06-coding-guidelines` | Engineering standards |
| `12-devtools-and-injection` | Developer guide and build pipeline |

Files use numbered prefixes: `01-name-of-file.md`.

---

## References

- [Engineering Standards](spec/02-coding-guidelines/engineering-standards.md)
- [Build Pipeline](spec/21-app/02-features/devtools-and-injection/developer-guide/03-build-pipeline.md)
- [Extension README](chrome-extension/readme.md)
- [Root README](readme.md)
- [CHANGELOG](changelog.md)
- [Version History](spec/00-overview/10-version-history-summary.md)

---

## Need Help?

- Check `spec/` for architecture docs and issue write-ups.
- Review [changelog.md](changelog.md) for recent changes.
- Look at existing code for patterns before introducing new ones.
