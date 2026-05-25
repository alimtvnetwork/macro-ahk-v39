---
name: error-swallow-audit-generator
description: How the error-swallow audit works, what counts as a valid waiver, and where waivers must be placed
type: feature
---

Build wiring (2026-04-27):
- `package.json` script `audit:error-swallow` runs the generator standalone.
- `build` and `build:dev` chain it after `verify-worktree-fresh` and before `vite build`, so `public/error-swallow-audit.json` is regenerated on every production/dev build.
- Failure of the generator fails the build (fail-fast, matches `mem://constraints/no-retry-policy`).

Waiver contract (CRITICAL — 2026-05-25):
- The CI checker `scripts/check-no-swallowed-errors.mjs` recognises ONLY line-comment waivers: `// allow-swallow: <reason>`.
- Block-comment style (`/* allow-swallow: ... */`) is **NOT** recognised — the regex is `/\/\/\s*allow-swallow\s*:/`.
- The waiver must appear on the **same line** as the offending `catch {`/`.catch(()=>{})` OR on the **line immediately above**. Any further away does NOT waive.
- Pattern that works:
  ```ts
  try { ... } catch { /* intentionally empty */ } // allow-swallow: <reason>
  ```
  or
  ```ts
  // allow-swallow: <reason>
  } catch { /* intentionally empty */ }
  ```
- Current state (2026-05-25): `Total: 0  P0: 0  P1: 0  P2: 0` after sweep. Any new swallow surfaces immediately in CI and in Options ▸ Error-swallow audit.
