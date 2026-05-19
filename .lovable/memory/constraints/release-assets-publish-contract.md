---
name: release assets publish contract
description: A GitHub Release is valid only when release.yml uploads built ZIP assets, installers, checksums, and notes; source-code archives/tags alone are invalid.
type: constraint
---
## Rule

A `v*` tag or GitHub's auto-generated **Source code (zip/tar.gz)** archives do
not count as a Marco release.

A release is valid only after `.github/workflows/release.yml` has uploaded all
required built assets to the GitHub Release page:

- `marco-extension-{VER}.zip`
- `macro-controller-{VER}.zip`
- `marco-sdk-{VER}.zip`
- `xpath-{VER}.zip`
- `prompts-{VER}.zip` when prompts exist
- `install.ps1`
- `install.sh`
- `VERSION.txt`
- `changelog.md`
- `checksums.txt`
- `RELEASE_NOTES.md` or equivalent body content

## Root cause pattern

The recurring symptom is a tag/release page with only GitHub source archives and
no built ZIPs. That means the release publication contract did not run to
completion. Known causes:

1. Tag/release created from GitHub UI or metadata tooling without a successful
   `release.yml` run.
2. `workflow_dispatch` runs against the default branch instead of checking out
   the requested tag, so assets/notes can come from the wrong commit.
3. Release notes use the current tag as the "previous tag" when the workflow is
   running on that tag, making the changelog range `${VER}..HEAD` weak or empty.
4. Release metadata files such as `.gitmap/release/*.json` are not authoritative
   because `assets: []` does not publish or verify anything by itself.
5. Recovery dispatches that only queue `release.yml` asynchronously are not
   authoritative because the watcher can pass before asset packaging/upload
   succeeds.
6. A stale immutable tag cannot contain fixes made after that tag was cut.
   Recovery must separate the build source ref from the publish target tag, or
   it will keep rebuilding the same broken tag source and never reach upload.

## Required CI/CD behavior

- `workflow_dispatch` must validate that the requested `v*` tag exists and must
  check out that exact ref before building assets.
- Release notes must compute the previous tag by excluding the current version
  tag from the candidate list.
- The release workflow must verify every required asset exists and is non-empty
  before calling `softprops/action-gh-release`.
- The release body must include one-line install commands for Windows
  PowerShell and Linux/macOS Bash, plus direct download/install guidance for
  the Chrome-extension ZIP.
- A separate release-audit job should detect any existing `v*` GitHub Release
  that has only source archives or is missing required built assets.
- Descriptor-based recovery should call the canonical release workflow via
  `workflow_call`, so the watcher run is gated by the actual build/upload job.
- Descriptor-based recovery may pass a fixed `source_ref` while keeping
  `version=vX.Y.Z` as the upload target, so an already-published source-only
  release can be repaired in place without another version bump.

## Operator rule

If a tag exists but the Release page has no built ZIPs, do not bump another
version first. Re-run **Release Build** via `workflow_dispatch` for that exact
tag, then confirm the Release page contains the built ZIPs and checksums.