# 49 — Release hardening final version target

## Original task text

User asked to plan release-page CI/CD fixes, then said the last task should bump
the major version, "let's make it two point one".

## Ambiguity

The repository is currently at `v2.250.0`. A SemVer **major** bump from
`2.250.0` is `3.0.0`, while `2.1.0` would be a downgrade and would sort behind
the existing release tags.

## Options considered

### Option A — Treat "major version" as authoritative: bump `2.250.0` → `3.0.0`

**Pros**
- Correct SemVer interpretation of a major bump.
- Avoids downgrading below already-published `2.250.0`.
- Keeps GitHub tag sorting and installer latest-version resolution sane.

**Cons**
- Does not literally match the phrase "two point one".

### Option B — Treat "two point one" literally: bump to `2.1.0`

**Pros**
- Matches the spoken phrase literally.

**Cons**
- Invalid as a forward release from `2.250.0`; it is a downgrade.
- Risks GitHub/latest release ordering problems.
- Conflicts with the project's unified versioning policy.

### Option C — Use `2.251.0`

**Pros**
- Safe forward version.

**Cons**
- It is a minor bump, not the requested major bump.

## Recommendation / chosen assumption

Proceed with **Option A** in the implementation plan: final task bumps
`2.250.0` → `3.0.0`, unless the user explicitly overrides before Step 8.
