# CI/CD Issue 08 — Stale release tag cannot contain recovery fixes

## Pipeline / Workflow

`.github/workflows/release-watcher.yml` calling `.github/workflows/release.yml`

## Description

The `v3.4.2` GitHub Release page still contained only GitHub's automatic
`Source code (zip)` and `Source code (tar.gz)` archives. It did not contain the
required built assets: `marco-extension-v3.4.2.zip`, standalone plugin ZIPs,
installer scripts, checksums, `VERSION.txt`, `changelog.md`, or release notes.

## First Seen

- Reported: 2026-05-19, version `v3.4.2`
- Evidence: release page screenshot shows exactly two assets, both source
  archives, and body text reduced to `Release v3.4.2`.

## Root Cause

The release recovery path still treated the existing tag as both:

1. the **publish target** (`v3.4.2`), and
2. the **source tree to build** (`refs/tags/v3.4.2`).

That is wrong after a broken release has already been cut. A Git tag is
immutable release source. If `v3.4.2` was created before the workflow/test fix
landed, then replaying `release.yml` against `refs/tags/v3.4.2` re-runs the old
broken source forever. The same-version fix on `main` never participates in the
asset build, so tests/build can fail before `softprops/action-gh-release` runs,
leaving the existing Release page source-only.

Earlier fixes made the watcher call the current workflow logic, but not the
current fixed source tree. The missing contract was: recovery must be allowed to
build from a fixed source ref while uploading assets to the already-published
tag.

After that was fixed, the live GitHub API still showed `v3.4.2` with **zero**
uploaded assets. The remaining operational gap was that descriptor/watch-based
recovery and reusable `release.yml` recovery still run the full release pipeline
before upload. If any pre-upload lint/test/build gate fails, the already-created
Release page remains empty again. For an already-broken latest release, recovery
must be self-contained: build only the assets needed for the Release page,
upload them directly with `gh release upload --clobber`, edit the release body,
then verify the live GitHub asset list.

## Status

✅ Resolved — 2026-05-19

## Fix

- Added optional `source_ref` to `release.yml` for `workflow_dispatch` and
  `workflow_call`.
- `release.yml` now separates:
  - `ref` = source checkout/build ref, and
  - `publish_tag` = GitHub Release tag that receives uploaded assets.
- Added a post-upload GitHub API verification step after `action-gh-release` so
  the workflow fails if the live Release page is still missing any required
  uploaded asset.
- `release-watcher.yml` now compares the descriptor tag commit with current
  `main` commit. If they differ, it calls `release.yml` with
  `source_ref=<current fixed commit>` while keeping `version=vX.Y.Z` as the
  upload target.
- Touched `.gitmap/release/v3.4.2.json` with an `assetRecovery` marker to force
  the watcher path to replay `v3.4.2` after this fix lands.
- Fixed descriptor selection in `release-watcher.yml` so when both
  `.gitmap/release/v3.4.2.json` and `latest.json` are changed, the concrete
  `v*.json` descriptor wins instead of being overwritten by the first candidate.
- Added `.github/workflows/recover-v3-4-2-release-assets.yml`, a direct one-shot
  recovery workflow triggered by this fix. It builds the extension and plugin
  ZIPs from fixed `main`, copies `install.ps1` / `install.sh`, generates
  checksums and release notes, uploads all assets with `gh release upload
  --clobber`, edits the existing `v3.4.2` Release body, and verifies the live
  GitHub Release asset list.
- Asset names, `VERSION.txt`, checksums, release notes, and `action-gh-release`
  still use the target tag (`v3.4.2`), so the existing Release page is repaired
  in place instead of requiring another version bump.

## Prevention

- Recovery must not require a broken immutable tag to contain its own fix.
- The workflow must distinguish build source from publish target.
- Successful workflow completion must be based on the live GitHub Release asset
  list, not only local `release-assets/` files.
- When the latest release is already source-only, use a direct recovery workflow
  or manual `workflow_dispatch`; do not rely only on indirect descriptor replay.
- Recovery for an already-published empty Release page must not depend on the
  full release pipeline's unrelated pre-upload gates; upload repair assets first,
  then audit the live page.
- Re-running Release Watcher after this change can repair existing source-only
  releases by rebuilding from fixed `main` and uploading to the existing tag.

## References

- `.github/workflows/release.yml`
- `.github/workflows/release-watcher.yml`
- `.github/workflows/recover-v3-4-2-release-assets.yml`
- `.gitmap/release/v3.4.2.json`
- Prior RCAs: `02`, `03`, `04`, `05`, `06`, `07`