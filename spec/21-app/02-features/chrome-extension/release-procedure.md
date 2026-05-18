# Release Procedure (Chrome Extension)

> See also: `spec/22-app-issues/95-release-page-missing-built-assets-rca.md` for the
> RCA that motivated this document.

This document is the authoritative procedure for publishing a Marco Extension
release. Following any other path (notably the GitHub web UI's "Create release
from tag" wizard alone) will leave the Release page **without** the built
assets that users need.

## How releases work in this repo

Two GitHub Actions workflows must be understood:

| Workflow      | Triggers                                                | Output                                                                  |
|---------------|---------------------------------------------------------|-------------------------------------------------------------------------|
| `ci.yml`      | `push: main`, `pull_request: main`                      | Lint, tests, builds. **Workflow artifacts only** (1-day retention).     |
| `release.yml` | `push: release/**`, `push: tags: v*`, `create`, `release`, `workflow_dispatch`, `workflow_call` | A real **GitHub Release** with `marco-extension-{VER}.zip`, installer scripts, checksums, and `RELEASE_NOTES.md`. |
| `release-watcher.yml` | `push: main` touching `.gitmap/release/*.json` or release workflow files | Calls `release.yml` in-process for the descriptor tag, so recovery is gated by the actual asset build/upload. |

A green CI run is **necessary but not sufficient**. CI does not publish a
Release. Only `release.yml` does.

## Canonical publish flow

Run from a developer workstation that has push permissions:

1. Bump the version: `pnpm run version:minor` (or `patch` / `major`).
2. Commit and push to `main` so CI runs once: `git push origin main`.
3. Push the tag explicitly: `git push origin v$(node -p "require('./package.json').version")`.

Step 3 is what fires `release.yml`. Within ~5 minutes the Release page will
show all expected assets:

- `marco-extension-{VER}.zip`
- `macro-controller-{VER}.zip`, `marco-sdk-{VER}.zip`, `xpath-{VER}.zip`, `prompts-{VER}.zip`
- `install.sh`, `install.ps1`, `VERSION.txt`, `changelog.md`, `checksums.txt`

## Replaying a release that was published incorrectly

If a tag exists on GitHub but the Release page only shows the Source-code
archives (the symptom that produced Issue 95, and again at `v2.250.0` —
see `.lovable/cicd-issues/02-release-page-missing-built-assets.md`):

1. Open the **Actions** tab in GitHub.
2. Select the **Release Build** workflow.
3. Click **Run workflow**, choose the default branch, and supply the existing
   tag (e.g. `v2.192.0`) in the `version` input.
4. The workflow now:
   - validates that `refs/tags/{VERSION}` exists on the remote and aborts otherwise,
   - **checks out that exact tag** in every build job (`needs.setup.outputs.ref`),
   - regenerates `RELEASE_NOTES.md` using the previous-but-not-current tag,
   - runs a required-asset verification gate before publishing, and
   - uploads to the existing Release object via `softprops/action-gh-release@v2`
     (the action updates in place rather than creating a duplicate).

This is safe to repeat — the asset upload is idempotent.

A scheduled workflow (`.github/workflows/audit-releases.yml`, weekly + manual)
audits every published `v*` release and reports any missing assets.

The watcher must not use asynchronous `gh workflow run` as the recovery contract.
It calls `release.yml` via `workflow_call`, so a watcher run is not green until
the real Release Build has generated notes, verified required assets, and
uploaded them to the existing GitHub Release.


## Forbidden paths

- **Do NOT** use the GitHub web UI's "Draft a new release → Create new tag on
  publish" flow as the only publish mechanism. Tags created server-side via
  the Releases UI **do not** fire `push: tags` events for Actions, so
  `release.yml` will not run and the Release page will be artifact-less.
- **Do NOT** push only the merge commit to `main` and assume a tag will be
  inferred. CI will be green but no Release will exist.

## Verifying a release after publish

For any version `vX.Y.Z` you should be able to:

1. Visit `https://github.com/<org>/<repo>/releases/tag/vX.Y.Z` and see at
   minimum `marco-extension-X.Y.Z.zip` and `checksums.txt` listed under
   **Assets**.
2. Run the documented one-liners without 404s:
   - PowerShell: `irm https://github.com/<org>/<repo>/releases/download/vX.Y.Z/install.ps1 | iex`
   - Bash: `curl -fsSL https://github.com/<org>/<repo>/releases/download/vX.Y.Z/install.sh | bash`

If either step fails, treat the release as not-yet-published and replay it via
the `workflow_dispatch` path above.
