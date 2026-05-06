# Chrome Extension — Installation Scripts Specification

**Version**: v1.1
**Date**: 2026-04-09
**Breaking change from v0.2**: Replaced the local `Install-Extension.ps1` (git-pull + profile-detect + watch mode) with a lightweight GitHub-release downloader (`install.ps1` / `install.sh`).

---

## Purpose

Two installer scripts (`install.ps1` for Windows, `install.sh` for macOS/Linux) that:

1. Fetch the latest (or pinned) release from GitHub
2. Download the `marco-extension-<version>.zip` asset
3. Extract to a local directory (`$HOME/marco-extension`)
4. Print Chrome/Edge/Brave load-unpacked instructions

The scripts are hosted in the repo at `scripts/install.ps1` and `scripts/install.sh` and served via `raw.githubusercontent.com` for one-liner installation.

---

## One-Liner Installation

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.ps1 | iex
```

### macOS / Linux (Bash)

```bash
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.sh | bash
```

---

## PowerShell Script (`install.ps1`)

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-Version` | string | `""` (latest) | Install a specific version (e.g. `v2.116.1`) |
| `-InstallDir` | string | `$HOME\marco-extension` | Target extraction directory |
| `-Repo` | string | `alimtvnetwork/macro-ahk-v31` | GitHub `owner/repo` |

### Execution Flow

```
irm ... | iex
    │
    ▼
1. Resolve version
    ├── If -Version provided → use it
    └── Otherwise → GET /repos/{repo}/releases/latest → tag_name
    │
    ▼
2. Resolve install directory
    ├── If -InstallDir provided → use it
    └── Otherwise → $HOME\marco-extension
    │
    ▼
3. Download asset
    │  URL: github.com/{repo}/releases/download/{version}/marco-extension-{version}.zip
    │  Saved to: $env:TEMP\marco-install-{random}\
    │
    ▼
4. Extract and install
    ├── Remove existing install dir (clean install)
    ├── Expand-Archive to install dir
    ├── Verify file count > 0
    └── Verify manifest.json exists (Chrome extension marker)
    │
    ▼
5. Write VERSION marker file
    │
    ▼
6. Clean up temp directory
    │
    ▼
7. Print install summary with load-unpacked instructions
```

### Key Implementation Details

- **`$ProgressPreference = "SilentlyContinue"`** — Prevents slow/hanging `Invoke-WebRequest` progress bars (critical for `irm | iex` reliability)
- **`$ErrorActionPreference = "Stop"`** — Any unhandled error terminates the script
- **Temp cleanup in `finally`** — Temp directory is always removed, even on failure
- **VERSION marker** — `$resolvedVersion` written to `$installDir/VERSION` for later version checks
- **Nested manifest check** — If `manifest.json` isn't at root, searches one level deep (zip may contain a subdirectory)

### Logging Helpers

| Function | Color | Purpose |
|----------|-------|---------|
| `Write-Step` | Cyan | Progress steps |
| `Write-OK` | Green | Success messages |
| `Write-Err` | Red | Error messages |

### Output Example

```
 Marco Extension installer
 github.com/alimtvnetwork/macro-ahk-v31

 Fetching latest release...
 Downloading marco-extension-v2.116.1.zip (v2.116.1)...
 Downloaded successfully.
 Installing to C:\Users\User\marco-extension...
 Installed 42 files to C:\Users\User\marco-extension

 Install summary
  Version:     v2.116.1
  Install dir: C:\Users\User\marco-extension

  ----------------------------------------------------------
  To load in Chrome / Edge / Brave:

  1. Open chrome://extensions (or edge://extensions)
  2. Enable 'Developer mode' (toggle in top-right)
  3. Click 'Load unpacked'
  4. Select: C:\Users\User\marco-extension
  ----------------------------------------------------------

  To update later, re-run this script — it replaces the folder.

  Example with custom directory:
    .\install.ps1 -InstallDir "D:\marco-extension"

 Done!
```

### Error Handling

| Error | Behavior |
|-------|----------|
| No releases found | Exit with error + manual download URL |
| Download failed (network/404) | Exit with error, show attempted URL |
| Extraction produced 0 files | Exit with error |
| manifest.json missing | Warning (non-fatal) — may still be valid |
| Any unhandled error | Caught in `Main`, prints manual download fallback |

---

## Bash Script (`install.sh`)

### Parameters (CLI flags)

| Flag | Default | Description |
|------|---------|-------------|
| `--version <ver>` | latest | Install a specific version |
| `--dir <path>` | `$HOME/marco-extension` | Target extraction directory |
| `--repo <o/r>` | `alimtvnetwork/macro-ahk-v31` | GitHub `owner/repo` |
| `--help` | — | Print usage |

### Usage

```bash
# Latest version
curl -fsSL .../install.sh | bash

# Pinned version
curl -fsSL .../install.sh | bash -s -- --version v2.116.1

# Custom directory
curl -fsSL .../install.sh | bash -s -- --dir /opt/marco
```

### Key Implementation Details

- **Re-exec guard** — If `$BASH_VERSION` is empty (e.g. `sh`), re-execs with `bash`
- **`trap cleanup EXIT`** — Temp directory always cleaned up
- **`curl` with `wget` fallback** — Uses whichever is available
- **`unzip` required** — Exits with clear error if missing
- **OS detection** — Rejects Windows (MINGW/MSYS/CYGWIN) with pointer to PowerShell installer
- **Same verification** as PowerShell: file count > 0, VERSION marker written

### Logging Helpers

| Function | Color | Purpose |
|----------|-------|---------|
| `step` | Cyan | Progress steps |
| `ok` | Green | Success messages |
| `err` | Red | Error messages |

---

## Source Map Policy

Release ZIP files **never contain source maps** (`.js.map` files). This is enforced at build time in the release workflow:

1. Build produces the extension in `dist/`
2. **Source map removal step** deletes any `*.map` files from `dist/` before packaging
3. The release workflow logs: `Removed N source map files`

See: [Sourcemap Strategy](mem://architecture/sourcemap-strategy). _(Release Workflow doc planned at `spec/21-app/pipeline/03-release-workflow.md` — not yet authored.)_

---

## Checksums

All release assets include a `checksums.txt` with SHA256 hashes, generated in the release workflow:

```bash
sha256sum * > checksums.txt
```

---

## Relationship to CI/CD

The release workflow (`.github/workflows/release.yml`) automatically:

1. Builds the extension
2. Removes source maps
3. Creates `marco-extension-{version}.zip`
4. Generates SHA256 checksums
5. Uploads to GitHub Release assets alongside `install.ps1` and `install.sh`
6. Generates release notes with installation commands

The installers download from these release assets. The one-liner URLs use `raw.githubusercontent.com` to fetch the script from `main` branch, ensuring users always get the latest installer logic.

---

## Acceptance Criteria

- [x] One-liner `irm ... | iex` downloads and extracts the extension
- [x] One-liner `curl ... | bash` downloads and extracts the extension
- [x] Latest version auto-detected from GitHub Releases API
- [x] Pinned version supported via `-Version` / `--version`
- [x] Custom install directory via `-InstallDir` / `--dir`
- [x] Clean install (removes previous directory)
- [x] manifest.json verification (PowerShell)
- [x] VERSION marker file written
- [x] Clear load-unpacked instructions printed
- [x] No source maps in release ZIP
- [x] Temp directory always cleaned up
- [x] SHA256 checksums generated for all assets
- [x] OS detection in bash (rejects Windows with PS1 pointer)
