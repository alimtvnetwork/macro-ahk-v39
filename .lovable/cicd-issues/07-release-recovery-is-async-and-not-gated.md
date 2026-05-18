# CI/CD Issue 07 — Release recovery is async and not gated, so source-only releases can remain published

## Pipeline / Workflow

`.github/workflows/release-watcher.yml` calling `.github/workflows/release.yml`

## Description

The GitHub Release page for `v3.2.0` still showed only GitHub's automatic
`Source code (zip)` and `Source code (tar.gz)` archives, with the body reduced
to `Release v3.2.0`. No built assets (`marco-extension-v3.2.0.zip`, standalone
ZIPs, installers, checksums, changelog, or `RELEASE_NOTES.md`) were attached.

## First Seen

- Reported: 2026-05-18, version `v3.2.0`
- Evidence: Release page asset count was 2, both source archives only.

## Root Cause

The previous watcher fix still used an asynchronous dispatch:

```bash
gh workflow run release.yml --ref "${WORKFLOW_REF}" -f version="${TAG}"
```

That only queues another workflow and then exits successfully. It does **not**
wait for `release.yml`, does **not** surface failures from the real asset build,
and does **not** guarantee the queued run uses the newly fixed workflow before
GitHub has indexed the just-pushed workflow changes. The result is a false-green
recovery path: the watcher can pass while the Release page remains source-only
and the release body remains the placeholder text created by external tooling.

The local descriptors also proved they are not a publish contract:
`.gitmap/release/v3.2.0.json` contained `"assets": []`. The descriptor records
that a release exists, but it does not upload or validate any assets.

## Status

✅ Resolved — 2026-05-18

## Fix

- Added `workflow_call` support to `.github/workflows/release.yml` with the same
  required `version` input as manual `workflow_dispatch`.
- Replaced the watcher's async `gh workflow run` step with an in-process reusable
  workflow call:
  `uses: ./.github/workflows/release.yml` and `version: ${{ needs.resolve-release.outputs.tag }}`.
- Added workflow-file changes to the watcher's path filters, so landing the fix
  on `main` immediately replays the latest descriptor (`.gitmap/release/latest.json`,
  currently `v3.2.0`) and updates the broken Release page.

Now the watcher job cannot go green independently of the actual asset build:
`release.yml` runs as a downstream job in the same workflow run, checks out the
target tag for packaging, generates `RELEASE_NOTES.md`, verifies every required
asset, and uploads to the existing GitHub Release in place.

## Prevention

- Release recovery is gated by the real build/upload job, not by an async queue
  request.
- A source-only GitHub Release cannot be considered recovered unless the called
  `release.yml` job completes successfully.
- `audit-releases.yml` remains the independent scheduled/manual detector for any
  existing `v*` release that lacks built assets.

## References

- `.github/workflows/release-watcher.yml`
- `.github/workflows/release.yml`
- `.gitmap/release/v3.2.0.json`
- Sibling RCAs: `02`, `03`, `04`, `05`, `06`