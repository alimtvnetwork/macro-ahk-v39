# CI/CD Issue 04 — Create event release ref does not enter release mode

## Pipeline / Workflow

`.github/workflows/release.yml` + `.github/workflows/release-watcher.yml`

## Symptom

Creating a `release/*` branch or a `vX.Y.Z` tag can leave the GitHub Release
page without built assets (`marco-extension-*.zip`, standalone ZIPs, installers,
`checksums.txt`, `RELEASE_NOTES.md`).

## First Seen

2026-05-18 while validating the v3.x release path after the descriptor watcher
was added.

## Root Cause

`release.yml` listened to `push` events for `release/**` branches and `v*` tags,
but did not listen to GitHub `create` events. Some GitHub / release-tooling
flows create refs server-side and emit `create` rather than a normal `push`, so
the release-mode pipeline never started for that entry path.

The secondary bug was in `release-watcher.yml`: when a push touched
`.gitmap/release/vX.Y.Z.json`, it always read `.gitmap/release/latest.json`.
If `latest.json` lagged or pointed at an older tag, the watcher could dispatch
the wrong release.

## Status

✅ Resolved — 2026-05-18 (v3.3.0)

## Fix

- Added `create` to `release.yml` triggers.
- Added create-event resolution for `tag` refs matching `v*` and branch refs
  matching `release/*`.
- Added a safe skip path for unrelated create events so the workflow does not
  accidentally publish non-release refs.
- Updated `release-watcher.yml` to prefer the changed
  `.gitmap/release/v*.json` descriptor before falling back to `latest.json`.

## Prevention

- `release.yml` now covers all intended release entry paths: release branch
  push, release branch create, tag push, tag create, and manual replay.
- `release-watcher.yml` no longer depends on `latest.json` being perfectly in
  sync when a versioned descriptor changes.

## References

- `.github/workflows/release.yml`
- `.github/workflows/release-watcher.yml`
- `changelog.md` v3.3.0