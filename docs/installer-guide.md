# Installer Guide — `install.sh` & `install.ps1`

> User-facing reference for the unified Marco / Macro-Controller installer. For the **normative** behavior contract that other repos must conform to, see [`spec/14-update/01-generic-installer-behavior.md`](../spec/14-update/01-generic-installer-behavior.md). For the cross-language source of truth, see [`scripts/installer-contract.json`](../scripts/installer-contract.json).

---

## 1. Quick start

| Goal | Command |
|---|---|
| Pinned to a release (recommended) | `curl -fsSL https://github.com/alimtvnetwork/macro-ahk-v31/releases/download/v2.228.0/install.sh \| bash` |
| Latest release (auto-resolve) | `curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.sh \| bash` |
| Force a specific version | `… \| bash -s -- --version v2.150.0` |
| Custom directory | `… \| bash -s -- --dir ~/tools/marco-extension` |
| Preview without installing | `… \| bash -s -- --dry-run` |

PowerShell mirrors the same surface (`irm … | iex`, `-Version`, `-InstallDir`, `-DryRun`, …). See §3.

---

## 1a. Copy-paste recipes

Drop-in commands for the most common scenarios. Replace `v2.228.0` with the version you want.

### Recipe A — Strict pinned version (recommended for production / CI)

Downloads the installer **from the release itself**, which auto-pins via URL self-detection (no `--version` flag needed). Sibling discovery and main-branch fallback are disabled in this mode — you get exactly that release or **exit 4**.

**Bash (Linux / macOS / Git-Bash):**
```bash
curl -fsSL https://github.com/alimtvnetwork/macro-ahk-v31/releases/download/v2.228.0/install.sh | bash
```

**PowerShell (Windows):**
```powershell
irm https://github.com/alimtvnetwork/macro-ahk-v31/releases/download/v2.228.0/install.ps1 | iex
```

> Use this in `Dockerfile`, `Makefile`, GitHub Actions, etc. Reproducible across rebuilds.

---

### Recipe B — Discovery mode, latest release

Auto-resolves to the newest published release via the GitHub Releases API. Falls back to a `main`-branch tarball if the repo has zero releases.

**Bash:**
```bash
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.sh | bash
```

**PowerShell:**
```powershell
irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.ps1 | iex
```

> Best for first-time users and casual installs.

---

### Recipe C — Dry run (preview without installing)

Resolves the version, prints the plan (URL, target dir, checksum source), and **exits 0 without touching disk**. Safe to run anywhere.

**Bash — pinned dry-run:**
```bash
curl -fsSL https://github.com/alimtvnetwork/macro-ahk-v31/releases/download/v2.228.0/install.sh | bash -s -- --dry-run
```

**Bash — discovery dry-run:**
```bash
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.sh | bash -s -- --dry-run
```

**PowerShell — pinned dry-run:**
```powershell
& ([scriptblock]::Create((irm https://github.com/alimtvnetwork/macro-ahk-v31/releases/download/v2.228.0/install.ps1))) -DryRun
```

**PowerShell — discovery dry-run:**
```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.ps1))) -DryRun
```

> The `& ([scriptblock]::Create(...))` wrapper is required to pass parameters to a script piped from `irm`. The simpler `irm ... | iex` form cannot accept arguments.

---

### Recipe D — Custom install directory

Override the default (`~/marco-extension` on Unix, `$HOME\marco-extension` on Windows).

**Bash:**
```bash
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.sh | bash -s -- --dir /opt/marco-extension
```

**PowerShell:**
```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.ps1))) -InstallDir 'D:\Tools\marco-extension'
```

---

### Recipe E — Pinned version + custom dir + dry run (full belt-and-suspenders)

**Bash:**
```bash
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.sh \
  | bash -s -- --version v2.228.0 --dir /opt/marco-extension --dry-run
```

**PowerShell:**
```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.ps1))) `
    -Version v2.228.0 -InstallDir 'D:\Tools\marco-extension' -DryRun
```

---

### Recipe F — Air-gapped / mirror

Point the installer at an internal GitHub Enterprise or HTTP mirror.

**Bash:**
```bash
MARCO_API_BASE=https://ghe.corp.example/api/v3 \
MARCO_DOWNLOAD_BASE=https://ghe.corp.example \
  curl -fsSL https://ghe.corp.example/raw/alimtvnetwork/macro-ahk-v31/main/scripts/install.sh | bash
```

**PowerShell:**
```powershell
$env:MARCO_API_BASE      = 'https://ghe.corp.example/api/v3'
$env:MARCO_DOWNLOAD_BASE = 'https://ghe.corp.example'
irm https://ghe.corp.example/raw/alimtvnetwork/macro-ahk-v31/main/scripts/install.ps1 | iex
```

---

## 2. Resolution order (how the version is decided)

The installer picks **exactly one** version using this waterfall — the first source that resolves wins:

1. **Explicit `--version` / `-Version` flag.** Must match `^v\d+\.\d+\.\d+(-pre)?$` or be the literal `latest`.
2. **URL self-detection** — if the script was downloaded from `…/releases/download/<vX.Y.Z>/install.sh`, that version is implicitly pinned. This is **strict mode** (see §6).
3. **GitHub Releases API → `latest`** — used when piped from `raw.githubusercontent.com/.../main/` and no `--version` was passed.
4. **Sibling-repo discovery** _(opt-in, discovery mode only)_ — probes `macro-ahk-v31`, `…-v25`, … in parallel for a higher-numbered repo. Off by default. Run with `--enable-sibling-discovery` or `SIBLING_DISCOVERY_ENABLED=1`.
5. **Main-branch tarball fallback** — when the API responds **200 OK with zero releases** or **404 Not Found** for `/releases/latest`, the installer downloads `archive/refs/heads/main.tar.gz` and records the version as `<branch>@HEAD`. You'll see the `🌿 Discovery mode — main branch (no releases found)` banner.

> ⚠️ **Network failures during discovery (5xx, DNS error, no curl) → exit 5.** The installer never silently falls through to `main` if the user might have wanted a real release.

---

## 3. CLI reference

### `install.sh` (Linux / macOS / Git-Bash)

| Flag | Type | Purpose |
|---|---|---|
| `--version <ver>`, `-v` | string | Force a specific version (`vX.Y.Z[-pre]`) or `latest`. |
| `--dir <path>`, `-d` | string | Target directory. Default: `~/marco-extension`. |
| `--repo <owner/repo>`, `-r` | string | Override owner/repo. Default from `installer-contract.json`. |
| `--dry-run` | switch | Resolve the plan, print it, exit 0 without installing. |
| `--no-sibling-discovery` | switch | Disable §4 sibling-repo probing (overrides config). |
| `--enable-sibling-discovery` | switch | Force-enable sibling-repo probing (overrides config; ignored in strict mode). |
| `--help`, `-h` | switch | Print usage and exit 0. |

### `install.ps1` (Windows PowerShell 5.1+ / PowerShell 7+)

| Parameter | Type | Purpose |
|---|---|---|
| `-Version <ver>` | string | Force a specific version. |
| `-InstallDir <path>` | string | Target directory. Default: `$HOME\marco-extension`. |
| `-Repo <owner/repo>` | string | Override owner/repo. |
| `-DryRun` | switch | Resolve the plan, print it, exit 0. |
| `-NoSiblingDiscovery` | switch | Disable sibling-repo probing. |
| `-EnableSiblingDiscovery` | switch | Force-enable sibling-repo probing. |
| `-Help` | switch | Print usage. |

---

## 4. Environment variables

These environment variables are honored by **both** installers:

| Variable | Default | Purpose |
|---|---|---|
| `MARCO_API_BASE` | `https://api.github.com` | GitHub API base. Override for air-gapped mirrors or local mock-server. |
| `MARCO_DOWNLOAD_BASE` | `https://github.com` | Release-asset base. Override for mirrors. |
| `MARCO_MAIN_BRANCH` | `main` | Branch used by the main-branch tarball fallback. |
| `MARCO_INSTALLER_URL` | _(none)_ | Override URL self-detection (used by package wrappers). |
| `MARCO_INSTALLER_CONFIG` | next to script | Path to `install.config.{sh,ps1}`. |
| `SIBLING_DISCOVERY_ENABLED` | `0` | Set to `1` to opt-in to sibling-repo probing. |
| `SIBLING_NAME_PATTERN` | `macro-ahk-v{N}` | Sibling-repo naming pattern. `{N}` = next integer. |
| `SIBLING_PROBE_DEPTH` | `20` | How many versions ahead to probe. |
| `SIBLING_PARALLELISM` | `8` | Parallel HEAD-request cap. |
| `SIBLING_PROBE_TIMEOUT_SECS` | `5` | Wall-clock cap for the entire probe. |

> **Defaults are also kept in [`scripts/installer-contract.json`](../scripts/installer-contract.json).** A CI drift detector (`scripts/check-installer-contract.mjs`) ensures the two installers cannot disagree.

---

## 5. Checksum verification (SHA-256)

Every release published since **v2.227.0** ships a `checksums.txt` file alongside the installer asset. The installer fetches it from the same release, computes the SHA-256 of the downloaded zip, and compares.

### What you'll see

| Outcome | Console output | Action |
|---|---|---|
| ✅ Match | `✓ checksum OK (sha256=abcd1234…)` | Install continues. |
| ❌ Mismatch | `✗ checksum MISMATCH — expected <hex>, got <hex>` | Install aborts with **exit 6**. **Do not retry blindly.** Re-download the installer (the upstream artifact may have been replaced) and report the URL to the maintainer if it persists. |
| ⚠️ Missing `checksums.txt` | `⚠ checksums.txt not found in release — skipping integrity check (back-compat)` | Install continues. Legacy releases (pre-v2.227.0) ship without checksums; this is intentional back-compat. |
| ⚠️ No SHA-256 tool found | Bash: `⚠ no sha256sum/shasum/openssl available — skipping integrity check`<br>PowerShell: covered by built-in `Get-FileHash`, never triggers | Install continues. Install `coreutils` or `openssl` to enable verification. |

### Hashing tools used

- **Bash**: `sha256sum` → `shasum -a 256` → `openssl dgst -sha256` (first available wins)
- **PowerShell**: `Get-FileHash -Algorithm SHA256` (built into PowerShell 5.1+)

### Format

`checksums.txt` follows the standard coreutils format — one entry per line:

```
abcd1234…  marco-extension-v2.228.0.zip
ef567890…  install.sh
```

The installer matches by the **filename of the downloaded asset** (the second column), not by line order.

---

## 6. Exit codes

All exit codes are declared in [`scripts/installer-contract.json`](../scripts/installer-contract.json) and enforced by `check-installer-contract.mjs`.

| Code | Name | Spec | Meaning | Typical fix |
|---|---|---|---|---|
| **0** | `ok` | §8.1 | Success. Includes successful `--dry-run`. | — |
| **1** | `preflight` | §8.1 | Bash / PowerShell missing, unreadable script, dangerous shell environment. | Install Bash or upgrade to PowerShell 5.1+. |
| **3** | `bad_version_arg` | §8.1 | `--version` did not match the semver regex or `latest`. | Use `vX.Y.Z` or `vX.Y.Z-pre`, e.g. `--version v2.228.0`. |
| **4** | `missing_artifact` | §8.1 | **Strict mode:** the requested release exists but the zip asset isn't attached. | Pick a version where the asset exists, or contact the release author. |
| **5** | `network_or_tooling` | §8.1 | API unreachable, `curl` / `Invoke-WebRequest` failed, no networking tool installed. | Check network, proxy, DNS. Install `curl` or `wget`. |
| **6** | `invalid_archive` | §8.1 | Checksum mismatch, corrupt zip/tar, or unzip failure. | **Re-download** — do not retry blindly with the same artifact. |

Exit codes 2 and 7+ are intentionally unused so future spec revisions can assign them without breaking existing scripts.

---

## 7. Strict mode vs. discovery mode

| Property | Strict mode | Discovery mode |
|---|---|---|
| **Trigger** | URL contains `/releases/download/<vX.Y.Z>/` **OR** `--version vX.Y.Z` | Piped from `…/main/scripts/install.sh` and no `--version` passed |
| **Sibling discovery** | **Always disabled** (spec §4 rule 6) | Honored if `SIBLING_DISCOVERY_ENABLED=1` or `--enable-sibling-discovery` |
| **Main-branch fallback** | **Disabled** — missing release → exit 4 | Enabled — zero releases → tarball fallback (exit 0) |
| **Network error in resolution** | Exit 5 | Exit 5 (no silent fallback to `main`) |

`--version latest` counts as **discovery mode** even with the explicit flag — it forces the API lookup but keeps fallbacks alive.

---

## 8. Warnings glossary

| Warning | Meaning | Severity |
|---|---|---|
| `🌿 Discovery mode — main branch (no releases found)` | The repo has zero releases; falling back to a `main` tarball. | Info |
| `⚠ checksums.txt not found in release — skipping integrity check` | Legacy release (pre-v2.227.0). | Low |
| `⚠ no sha256sum/shasum/openssl available — skipping integrity check` | Verification tool missing. | Low — install one for security. |
| `⚠ Sibling discovery returned no candidates within 5s` | Sibling probe timed out or no higher-numbered repo exists. | Info |
| `⚠ Continuing install of <repo> — re-run with --repo <sibling> to switch` | A sibling was found but you didn't ask to switch. | Info |
| `⚠ Pass --no-sibling-discovery to suppress this probe` | UX hint when sibling probing ran in discovery mode. | Info |
| `⚠ Removing previous install at <dir>` | An existing install was replaced. Files outside the install dir are untouched. | Info |
| `⚠ Some files could not be deleted — scheduled for next reboot` (Windows) | Chrome held a file lock; deletion deferred. | Low — reboot to finalize. |

---

## 9. Troubleshooting

### "Exit 6 — checksum MISMATCH"
1. **Don't retry the same URL** — the artifact may have been replaced or tampered with.
2. Re-fetch the installer fresh (`curl … | bash` again — the installer file itself isn't cached).
3. Open the release page in a browser and confirm the artifact's published SHA-256 matches what your installer computed.
4. If the upstream `checksums.txt` is wrong, the release author needs to republish.

### "Exit 5 — fetch_latest_version: HTTP 503"
- GitHub API outage or rate limit. Retry in a few minutes.
- Behind a corporate proxy? Set `HTTPS_PROXY` and confirm `curl https://api.github.com` works.
- Air-gapped? Mirror the repo and override `MARCO_API_BASE` / `MARCO_DOWNLOAD_BASE`.

### "Exit 5 — no curl/wget found"
Install one. The installer prefers `curl`, falls back to `wget`. Bash builtins are not used (no fetch primitive).

### "Exit 4 — release exists but asset is missing"
You hit strict mode (URL-pinned or explicit `--version vX.Y.Z`) and the release page doesn't have the zip attached. The installer **deliberately refuses to fall back** in strict mode. Either:
- Pick a different version that has the asset.
- Drop the `--version` flag to get the latest published release.

### "Exit 3 — Invalid --version 'X'"
The version must match `^v\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$` or be the literal `latest`. Examples:
- ✅ `v2.228.0`, `v2.228.0-rc.1`, `latest`
- ❌ `2.228.0` (missing `v`), `v2.228` (incomplete), `main`, `head`

### "🌿 Discovery mode — main branch" but I expected a release
- The repo has no published releases yet.
- You forgot to set `--version vX.Y.Z` if you wanted a specific one.
- Check `https://api.github.com/repos/<owner>/<repo>/releases/latest` — a 404 here triggers the fallback.

### Sibling discovery picked the wrong repo
- Pass `--no-sibling-discovery` (or `-NoSiblingDiscovery` on PowerShell) to suppress.
- Or pass `--repo <owner>/<exact-repo>` to pin.

### Windows: install dir locked by Chrome
- The installer schedules a delayed delete via `MoveFileEx(MOVEFILE_DELAY_UNTIL_REBOOT)` and continues.
- Quit Chrome and re-run, or accept the deferred cleanup and reboot.

### Mock-server / test mode
For local testing without hitting GitHub:
```bash
MARCO_API_BASE=http://127.0.0.1:38394 \
MARCO_DOWNLOAD_BASE=http://127.0.0.1:38394 \
  bash scripts/install.sh --dry-run
```
See [`tests/installer/fixtures/mock-server.cjs`](../tests/installer/fixtures/mock-server.cjs).

---

## 10. Verifying the installer itself

Both installers are open source and small (~800 lines each). To audit before piping into your shell:

```bash
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.sh -o install.sh
less install.sh                       # Read it
sha256sum install.sh                  # Compare against the published hash
bash install.sh --dry-run             # Preview without changes
bash install.sh                       # Run for real
```

The same applies to `install.ps1`:

```powershell
irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v31/main/scripts/install.ps1 -OutFile install.ps1
Get-FileHash install.ps1 -Algorithm SHA256
.\install.ps1 -DryRun
.\install.ps1
```

---

## 11. Cross-references

- [`spec/14-update/01-generic-installer-behavior.md`](../spec/14-update/01-generic-installer-behavior.md) — Normative behavior contract (acceptance criteria AC-1 through AC-23).
- [`spec/14-update/01-generic-installer-behavior.md#13-shared-installer-contract-cross-language-source-of-truth`](../spec/14-update/01-generic-installer-behavior.md) §13 — Shared contract pattern.
- [`scripts/installer-contract.json`](../scripts/installer-contract.json) — Single source of truth (flags, exit codes, defaults).
- [`scripts/check-installer-contract.mjs`](../scripts/check-installer-contract.mjs) — CI drift detector.
- [`tests/installer/`](../tests/installer/) — `mock-server.test.sh` (62 cases) and `resolver.test.sh` (46 cases).
