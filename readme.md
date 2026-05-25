<div align="center">

<img src="docs/assets/marco-logo.gif" alt="Marco Extension animated logo" width="160" height="160" />

# <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows8/windows8-original.svg" alt="Windows" width="28" height="28" align="center" /> Marco Chrome Extension

> **Browser automation for workspace management, credit monitoring, and AI-driven macro execution** — built as a Manifest V3 Chrome extension with a modular standalone script architecture.

&#x200B;<!-- Build & Release --> [![CI](https://img.shields.io/github/actions/workflow/status/alimtvnetwork/macro-ahk-v37/ci.yml?branch=main&label=CI&logo=github&style=flat-square)](https://github.com/alimtvnetwork/macro-ahk-v37/actions/workflows/ci.yml) <!-- Repo activity --> [![Issues](https://img.shields.io/github/issues/alimtvnetwork/macro-ahk-v37?style=flat-square&logo=github)](https://github.com/alimtvnetwork/macro-ahk-v37/issues) [![Pull Requests](https://img.shields.io/github/issues-pr/alimtvnetwork/macro-ahk-v37?style=flat-square&logo=github)](https://github.com/alimtvnetwork/macro-ahk-v37/pulls) [![Repo Size](https://img.shields.io/github/repo-size/alimtvnetwork/macro-ahk-v37?style=flat-square)](https://github.com/alimtvnetwork/macro-ahk-v37)
&#x200B;<!-- Community --> <!-- (intentionally empty — see mem://constraints/no-static-mockup-badges) --> <!-- Code-quality --> [![Security Issues](https://img.shields.io/github/issues-search/alimtvnetwork/macro-ahk-v37?query=is%3Aissue%20label%3Asecurity&label=security&style=flat-square&logo=github)](https://github.com/alimtvnetwork/macro-ahk-v37/issues?q=is%3Aissue+label%3Asecurity) [![Dependency PRs](https://img.shields.io/github/issues-pr-raw/alimtvnetwork/macro-ahk-v37?label=dependency%20PRs&style=flat-square&logo=dependabot)](https://github.com/alimtvnetwork/macro-ahk-v37/pulls?q=is%3Apr+label%3Adependencies) <!-- Stack & standards --> [![License](https://img.shields.io/github/license/alimtvnetwork/macro-ahk-v37?style=flat-square)](#license)

<img src="docs/assets/marco-extension-hero.png" alt="Marco Chrome Extension — Projects view inside the options page" width="820" />

</div>

---

## Install

Marco is a **Windows-first** project. The commands below auto-update to the **latest** release. Prefer a pinned version? Use the second block.

### 🪟 Windows · PowerShell (latest)

```powershell
irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v37/main/scripts/install.ps1 | iex
```

### 🐧 macOS · Linux · Bash (latest)

```bash
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v37/main/scripts/install.sh | bash
```

### 📌 Pinned version (`v3.11.1`)

```powershell
# Windows · PowerShell
irm https://github.com/alimtvnetwork/macro-ahk-v37/releases/download/v3.11.1/install.ps1 | iex
```

```bash
# macOS · Linux · Bash
curl -fsSL https://github.com/alimtvnetwork/macro-ahk-v37/releases/download/v3.11.1/install.sh | bash
```

**Pinned version:** `v3.11.1` &nbsp;•&nbsp; **Macro Controller:** `v3.11.1`

> **v2.243.0 release-asset fix (historical):** the previous release pipeline pointed at a legacy `chrome-extension/dist/` subfolder that no longer exists (the unpacked extension is built into `chrome-extension/` itself — see `vite.config.extension.ts` and `powershell.json → distDir`). That mismatch caused `marco-extension-{VER}.zip` to be silently absent from the GitHub Releases page. The workflow now zips `chrome-extension/` directly and fails fast if the extension zip is missing or `< 10 KiB`. RCA: [`mem://constraints/chrome-extension-dist-path`](.lovable/memory/constraints/chrome-extension-dist-path.md).

> Jump straight to your platform: **[🪟 Install on Windows (PowerShell)](#-install-on-windows-powershell)** &nbsp;•&nbsp; **[🐧 Install on Linux / macOS (Bash)](#-install-on-linux--macos-bash)** &nbsp;•&nbsp; **[Full Quick Start](#quick-start)**

---

## About Marco

Marco started as a small itch. **Alim** wanted to automate a few repetitive things on Chrome using **AutoHotkey** — just keystrokes and clicks at first. One script led to another, and soon he was recording flows, parameterizing them, and wiring them into proper programs. What began as a Windows-only AHK helper grew into a full browser-side automation runtime: a Manifest V3 Chrome extension with a modular standalone-script architecture, deterministic XPath replay, credit-aware loop control, and an AutoHotkey sidecar that still drives the Windows side.

In short: Marco is the project that came out of taking "let me just automate this one thing" seriously.

---

## Quick Start

Pick your platform — each section is a self-contained install path with the recommended one-liner, flags, and a link to the deeper reference.

### 🪟 Install on Windows (PowerShell)

**Recommended path.** Open **PowerShell** (Win + X → "Windows PowerShell" or "Terminal") and run:

```powershell
irm https://github.com/alimtvnetwork/macro-ahk-v37/releases/download/v3.11.1/install.ps1 | iex
```

- 🔒 Pinned to `v3.11.1` — see [Pinned to a specific release](#-pinned-to-a-specific-release) to change versions
- 🌊 Want auto-update? Use the [latest channel](#-latest-channel-auto-update) one-liner
- 📁 Custom install folder? See [Custom Directory Install](#custom-directory-install)
- 🚩 Full flag list, exit codes, checksum behavior → [Installer Options](#installer-options)

### 🐧 Install on Linux / macOS (Bash)

Open your terminal and run:

```bash
curl -fsSL https://github.com/alimtvnetwork/macro-ahk-v37/releases/download/v3.11.1/install.sh | bash
```

- 🔒 Pinned to `v3.11.1` — see [Pinned to a specific release](#-pinned-to-a-specific-release) for other tags
- 🌊 Auto-update channel → [latest channel](#-latest-channel-auto-update)
- 📁 Custom install folder? See [Custom Directory Install](#custom-directory-install)
- 🚩 Full flag list, exit codes, checksum behavior → [Installer Options](#installer-options)

---

### One-Liner Install (all variants)

The unified installer auto-derives the pinned version from its download URL. Use a **release-asset URL** to pin to that exact release, or use **`raw.githubusercontent.com/.../main/`** for the auto-update channel.

#### 🔒 Pinned to a specific release

```powershell
# PowerShell (Windows) — replace v3.11.1 with any released tag
irm https://github.com/alimtvnetwork/macro-ahk-v37/releases/download/v3.11.1/install.ps1 | iex
```

```bash
# Bash (Linux / macOS)
curl -fsSL https://github.com/alimtvnetwork/macro-ahk-v37/releases/download/v3.11.1/install.sh | bash
```

#### 🌊 Latest channel (auto-update)

```powershell
irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v37/main/scripts/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v37/main/scripts/install.sh | bash
```

#### Override the resolved version

```powershell
& { $Version = "v2.220.0"; irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v37/main/scripts/install.ps1 | iex }
```

```bash
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v37/main/scripts/install.sh | bash -s -- --version v2.220.0
```

### Custom Directory Install

**Windows (PowerShell):**

```powershell
.\install.ps1 -InstallDir "D:\marco-extension"
```

**Linux / macOS:**

```bash
./install.sh --dir ~/marco-extension
```

### Installer Options

> 📘 **Full reference:** [`docs/installer-guide.md`](docs/installer-guide.md) — CLI flags, exit codes, checksum behavior, warnings glossary, and troubleshooting.

The installers (`install.ps1`, `install.sh`) conform to the [Generic Installer Behavior spec](spec/14-update/01-generic-installer-behavior.md). Behavior is determined by **how the installer was invoked**, not by build-time stamping. Both installers read shared defaults from [`scripts/installer-contract.json`](scripts/installer-contract.json) (CI-enforced — they cannot drift).

#### Strict mode vs Discovery mode

| Mode | Triggered when | Banner shown | API call? | Sibling discovery? |
|------|----------------|--------------|-----------|--------------------|
| 🔒 **Strict** | The script was downloaded from a `releases/download/vX.Y.Z/` URL **OR** invoked with `--version vX.Y.Z` (any explicit semver) | `🔒 Strict mode — pinned to vX.Y.Z` | No — installs that exact version, never falls back | **Never** (locked out by spec §4 rule 6) |
| 🌊 **Discovery** | No version override **and** no release-asset URL hint, **OR** `--version latest` | `🌊 Discovery mode — resolved vX.Y.Z` | Yes — `GET /repos/{owner}/{repo}/releases/latest` | Optional, off by default — opt in via config (see below) |

**Strict mode is fail-fast.** If the pinned release ZIP is missing, the installer exits 4 — it will *not* silently fall back to a different version, the main branch, or a sibling repo. Discovery mode tolerates more (latest API + optional sibling probing + main-branch fallback once §4 lands).

#### Common flags

**Windows (PowerShell — `install.ps1`):**

| Flag | Description | Example |
|------|-------------|---------|
| `-Version` | Pin a specific release (`vX.Y.Z[-pre]`) or `latest` | `-Version v3.11.1` |
| `-InstallDir` | Custom install directory | `-InstallDir D:\marco-extension\v3.6.1` |
| `-Repo` | Override GitHub `owner/repo` | `-Repo alimtvnetwork/macro-ahk-v37` |
| `-Help` | Print usage and exit 0 | `-Help` |

**Linux / macOS (Bash — `install.sh`):**

| Flag | Short | Description | Example |
|------|-------|-------------|---------|
| `--version <ver>` | `-v` | Force a specific version (`vX.Y.Z[-pre]`) or `latest`. Anything else exits 3. | `--version v3.11.1` |
| `--dir <path>` | `-d` | Target directory (default: `~/marco-extension`) | `--dir ~/marco-extension/v3.11.1` |
| `--repo <o/r>` | `-r` | Override GitHub `owner/repo` | `--repo alimtvnetwork/macro-ahk-v37` |
| `--dry-run` | — | Resolve the install plan, print it, exit 0 — **nothing is downloaded or extracted**. Useful for CI smoke tests and debugging. | `--dry-run --version v3.11.1` |
| `--no-sibling-discovery` | — | Disable §4 sibling-repo probing for this run (overrides `install.config.sh`). Strict mode would skip it anyway. | `--no-sibling-discovery` |
| `--enable-sibling-discovery` | — | Force-enable sibling probing for this run. **Still blocked by strict mode** (spec §4 rule 6). | `--enable-sibling-discovery` |
| `--help` | `-h` | Print full usage with the spec link, then exit 0 | `--help` |

#### Exit codes

The installer follows a fixed exit-code contract (see [spec §3](spec/14-update/01-generic-installer-behavior.md) and [`installer-contract.json`](scripts/installer-contract.json)):

| Code | Meaning | When it fires |
|------|---------|---------------|
| `0` | Success | Install completed, or `--dry-run` / `--help` finished cleanly |
| `1` | Preflight failure | OS detection failed, missing required tools (e.g. `unzip`), or unhandled error |
| `3` | Invalid `--version` argument | Anything that doesn't match `vX.Y.Z[-prerelease]` or the literal `latest` |
| `4` | Targeted release asset missing (strict mode only) | The pinned ZIP returns 404. Installer **never** falls back. |
| `5` | Network or tooling error | API unreachable in discovery mode, or neither `curl` nor `wget` is on `PATH` |
| `6` | Invalid archive or **checksum mismatch** | ZIP extracted to no files, `manifest.json` missing, or SHA-256 doesn't match `checksums.txt` |

Code `2` is reserved for future use. CI scripts can rely on these — they're covered by [`tests/installer/resolver.test.sh`](tests/installer/resolver.test.sh) (46 cases) and [`tests/installer/mock-server.test.sh`](tests/installer/mock-server.test.sh) (62 cases). Drift between the two installers is prevented by [`scripts/check-installer-contract.mjs`](scripts/check-installer-contract.mjs).

#### Checksum verification (since v2.227.0)

Every release ships a `checksums.txt` file. The installer fetches it from the same release, computes SHA-256 of the downloaded zip, and aborts on mismatch with **exit 6**.

| Outcome | What you see | Action |
|---|---|---|
| ✅ Match | `✓ checksum OK (sha256=…)` | Install continues |
| ❌ Mismatch | `✗ checksum MISMATCH — expected …, got …` | **Exit 6.** Re-download — do not retry blindly. |
| ⚠️ Missing `checksums.txt` | `⚠ checksums.txt not found — skipping integrity check` | Continues (back-compat with pre-v2.227.0 releases) |
| ⚠️ No SHA tool (Bash only) | `⚠ no sha256sum/shasum/openssl available — skipping` | Continues. Install `coreutils` to enable. |

Bash uses `sha256sum` → `shasum -a 256` → `openssl dgst -sha256` (first available wins). PowerShell uses the built-in `Get-FileHash`. See [`docs/installer-guide.md` §5](docs/installer-guide.md#5-checksum-verification-sha-256) for the full rundown.

#### Main-branch fallback (since v2.226.0)

In **discovery mode**, if the GitHub API responds `200 OK` with zero releases (or `404 Not Found` for `/releases/latest`), the installer falls back to `archive/refs/heads/<MAIN_BRANCH>.tar.gz` and records the version as `<branch>@HEAD`. You'll see the `🌿 Discovery mode — main branch (no releases found)` banner. **Network failures (5xx, DNS error) still exit 5** — the installer never silently falls through to `main` if the user might have wanted a real release.

#### Sibling-repo discovery (advanced)

When the project ships successive major rewrites in sibling repos (e.g. `macro-ahk-v37` → `macro-ahk-v37` → `macro-ahk-v37`), discovery mode can optionally probe ahead and pick the newest. Defaults live in [`scripts/install.config.sh`](scripts/install.config.sh) and are **off by default**:

```bash
SIBLING_DISCOVERY_ENABLED=0          # opt-in
SIBLING_NAME_PATTERN="macro-ahk-v{N}"
SIBLING_PROBE_DEPTH=20
SIBLING_PARALLELISM=8
SIBLING_PROBE_TIMEOUT_SECS=5
```

Override priority (lowest → highest):

1. Built-in defaults (off)
2. `scripts/install.config.sh` next to the installer (or `$MARCO_INSTALLER_CONFIG`)
3. Environment variables of the same name
4. `--enable-sibling-discovery` CLI flag
5. `--no-sibling-discovery` CLI flag
6. **Strict-mode lockout — beats everything** (spec §4 rule 6)

Use `--dry-run` to inspect the resolved decision without installing — the plan prints `Sibling discovery: <state> — <reason>`.

#### Examples

```bash
# Preview what would happen with the latest release — no network writes:
curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v37/main/scripts/install.sh \
  | bash -s -- --dry-run

# Pin a specific version into a custom directory:
./install.sh --version v3.11.1 --dir ~/marco-extension/v3.11.1

# Force-enable sibling-repo discovery for this one run:
./install.sh --enable-sibling-discovery

# Print full usage and the spec link:
./install.sh --help
```

### Manual Install

1. Download `marco-extension-v{VERSION}.zip` from [Releases](https://github.com/alimtvnetwork/macro-ahk-v37/releases)
2. Extract to a folder (e.g., `D:\marco-extension\v3.11.1`)
3. Open `chrome://extensions` (or `edge://extensions`)
4. Enable **Developer mode** (toggle in top-right)
5. Click **Load unpacked** and select the extracted folder

Works in **Chrome**, **Edge**, **Brave**, **Arc**, and other Chromium browsers.

---

## Companion Repositories

Marco ships alongside an AutoHotkey sidecar that drives keyboard/mouse automation on Windows. Clone it next to this repo:

```bash
git clone https://github.com/alimtvnetwork/macro-ahk-v37 "macro-ahk-v37"
```

Or use the package.json script:

```bash
pnpm clone:ahk
```

This creates a `macro-ahk-v37/` folder containing the AHK v2 scripts that pair with the Chrome extension's macro controller.

See `docs/extension-architecture.md` §11 "Companion repositories" for integration details, version coupling, and required folder layout.

---

## What It Does

Marco is a Chrome extension that automates workspace management workflows through injectable scripts. It operates by injecting standalone JavaScript modules into web pages, controlled by a popup UI and a background service worker.

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Script Injection Engine** | Injects IIFE-compiled scripts into page context (MAIN world) with dependency resolution and load ordering |
| **Macro Controller** | Core automation controller — XPath utilities, auth panel, token resolution, UI overlays |
| **Credit Monitoring** | Real-time credit balance checking with workspace-level tracking and retry-on-refresh policy |
| **Workspace Management** | Automated workspace switching, transfer dialogs, and multi-workspace operations |
| **Loop Engine** | Configurable automation loops with delay, retry, and condition-based stopping |
| **AI Prompt System** | Dual-cache prompt management with IndexedDB storage, manual-load model, and normalization |
| **Auth Bridge** | Zero-network JWT resolution waterfall with 2-step recovery and token caching |
| **Session Logging** | Dual-layer logging to SQLite + Origin Private File System with diagnostics export |
| **Self-Healing Storage** | Two-stage builtin script guard that detects and repairs corrupted script storage |
| **Build-Aware Cache** | Injection cache invalidation tied to build version, preventing runtime drift |

### Script Architecture

The extension uses a **declarative, instruction-driven** architecture. Each standalone script defines its own `instruction.ts` manifest that declares:

- Script metadata (name, version, description)
- Dependencies and load order
- CSS, templates, and configuration files
- Injection world (MAIN or ISOLATED)

Scripts are compiled to **IIFE bundles** (no module imports at runtime) and injected in dependency order: CSS → configs → templates → JS.

### Default Scripts

| Script | Purpose | Default |
|--------|---------|---------|
| **Marco SDK** | Shared SDK providing `require()`, messaging, and utility functions | Always loaded |
| **XPath** | XPath query utilities for DOM element selection | Enabled |
| **Macro Controller** | Core controller — auth, UI, credit checking, workspace automation | Enabled |

---

## Features In Detail

### Popup UI

The popup provides real-time control over script injection and diagnostics:

| Control | What It Does |
|---------|--------------|
| **Run** | Clears DOM markers, injects all enabled scripts from the active project |
| **Toggle** | Enables/disables the active project (persists across sessions) |
| **Per-Script Toggle** | Enable/disable individual scripts — state persists across restarts |
| **Re-inject** | Clears existing injections, re-injects all enabled scripts fresh |
| **Logs** | Copies session logs + errors as JSON to clipboard |
| **Export** | Downloads ZIP with logs, errors, and SQLite database |
| **Auth Diagnostics** | Real-time token status with contextual help tooltips |

### Options Page

Full-featured settings UI with:

- Hash-based deep linking (e.g., `#activity`)
- Direction-aware slide-and-fade view transitions
- Activity log viewer with filtering
- Script configuration management
- Advanced automation (chains & scheduling)

### Injection Diagnostics

Granular visual feedback per script:

| Badge | Meaning |
|-------|---------|
| Disabled | Script toggled off by user |
| Missing | Script file not found in storage |
| Injected | Successfully injected into page |
| Failed | Injection error (check debug panel) |

### Authentication

- **Zero-network resolution** — JWTs resolved from local storage waterfall before any network calls
- **2-step recovery** — Auth Bridge attempts cached token, then page extraction
- **Extension context invalidation** — Detected and explained via help tooltips when extension reloads

### Logging & Export

- **SQLite persistence** — Unlimited storage with structured queries
- **OPFS fallback** — Origin Private File System for crash-resilient writes
- **Diagnostics ZIP** — Human-readable `logs.txt` + raw data for debugging
- **Error synchronization** — Error counts broadcast across extension contexts in real-time

---

## Architecture

### Extension Lifecycle (6 Phases)

```
1. Install + Bootstrap     → Manifest loading, SQLite init
2. Seeding                 → seed-manifest.json → chrome.storage.local
3. Script Pre-caching      → Parallelized fetch of all script files
4. Injection               → Dependency resolution → CSS → configs → templates → JS
5. Runtime                 → Auth bridge, credit monitoring, loop engine
6. Export / Cleanup        → Diagnostics ZIP, session teardown
```

### Message Relay (3-Tier)

```
Page Scripts (MAIN world)
    ↕ window.postMessage
Content Scripts (ISOLATED world)
    ↕ chrome.runtime.sendMessage
Background Service Worker
    ↕ chrome.storage.local
Popup / Options UI
```

### Storage Layers

| Layer | Capacity | Purpose |
|-------|----------|---------|
| SQLite (Extension) | Unlimited | Persistent logs, diagnostics |
| chrome.storage.local | 10 MB | Script metadata, settings, state |
| IndexedDB | Unlimited | Prompt cache (dual JSON/text) |
| OPFS | Unlimited | Crash-resilient log writes |

#### Storage Migration Policy

> ⛔ **Phase 2c-storage v2 is permanently banned.** Rewriting `StoredProject` keys in `chrome.storage.local` from camelCase to PascalCase would break ~50+ downstream consumers and is blocked at three layers.

**Banned behavior** (never ship):
- Renaming/rewriting persisted `StoredProject` keys (e.g. `name` → `Name`, `urlPatterns` → `UrlPatterns`).
- Any migration with `version > MAX_ALLOWED_STORAGE_SCHEMA_VERSION` (currently `1`).
- Helpers named `renameStorageKey`, `migrateStoredProjectKeys`, `pascalCaseStoredProject`, or equivalents.
- `chrome.storage.local.set({ PascalKey: ... })` writes against project payloads.

**Enforcement layers:**
1. **Runtime guard** — `assertNoPascalCaseStorageMigration()` in `src/background/storage-migration.ts` throws before any out-of-range migration executes.
2. **CI check** — `pnpm run check:no-storage-pascalcase-rewrite` (wired into `build` + `build:dev`) scans `src/` and `standalone-scripts/` for violations.
3. **Memory rule** — `mem://constraints/no-storage-pascalcase-migration` blocks the agent from re-proposing it.

**Permitted migration behavior:**
- Additive, backward-compatible changes only (new optional fields, new top-level keys).
- Bump `CURRENT_STORAGE_SCHEMA_VERSION` **and** `MAX_ALLOWED_STORAGE_SCHEMA_VERSION` together when adding a new migration.
- Identity-only PascalCase compat snapshots emitted *in-memory* (e.g. `compile-instruction` dual-emit) are fine — the persisted shape must remain camelCase.
- Read-side normalization (accept both shapes, write camelCase) is fine.
- Deletions/renames of persisted keys require a written RFC and explicit user sign-off.

### Performance Optimizations

- **DomCache** with TTL for repeated DOM queries
- **Merged MutationObservers** — single observer, multiple handlers
- **API call deduplication** via `CreditAsyncState`
- **Dirty-flag UI updates** — `updateUILight()` skips unchanged elements
- **Batched localStorage writes** via `LogFlushState`

---

## Build Pipeline

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+

### Development

```bash
pnpm install
pnpm run dev
```

Load `chrome-extension/` (at the repo root, **not** `dist/`) as an unpacked extension in Developer mode.

### Production Build (Full Pipeline)

```bash
pnpm run build:sdk              # 1. Marco SDK (IIFE)
pnpm run build:xpath            # 2. XPath utility
pnpm run build:macro-controller # 3. Macro Controller (includes LESS, templates, prompts)
pnpm run build:extension        # 4. Chrome extension (copies all artifacts)
```

### Build Commands

| Command | What It Does |
|---------|-------------|
| `pnpm run build:sdk` | Compile Marco SDK → IIFE bundle + `.d.ts` |
| `pnpm run build:xpath` | Compile XPath utility → IIFE bundle |
| `pnpm run build:macro-controller` | Compile Macro Controller → IIFE + CSS + templates + prompts |
| `pnpm run build:extension` | Build Chrome extension (validates + copies all standalone scripts) |
| `pnpm run check:manifest` | Validate **source** `manifest.json` (version sync, permissions, CSP must allow Wasm) |
| `pnpm run check:built-csp` | Validate **built** `chrome-extension/manifest.json` CSP + print reload checklist |
| `pnpm run build:prompts` | Aggregate prompt `.md` files → `macro-prompts.json` |
| `pnpm run build:macro-less` | Compile LESS → CSS |
| `pnpm run build:macro-templates` | Compile HTML templates → `templates.json` |
| `pnpm run test` | Run test suite (Vitest) |
| `pnpm run lint` | ESLint with SonarJS (zero warnings enforced) |

### Build via PowerShell (Windows)

```powershell
.\run.ps1 -d     # Full deploy pipeline: build all + deploy to Chrome profile
.\run.ps1         # Production build (no source maps)
```

The `run.ps1` orchestrator is modular — 8 dot-sourced modules in `build/ps-modules/`:

| Module | Purpose |
|--------|---------|
| `utils.ps1` | Version parsing, pnpm helpers |
| `preflight.ps1` | Dynamic import/require scanning |
| `standalone-build.ps1` | Parallel standalone builds via `Start-Job` |
| `extension-build.ps1` | Extension build + manifest validation |
| `browser.ps1` | Profile detection, extension deployment |
| `watch.ps1` | FileSystemWatcher with debounce |

### Built Extension Layout (`chrome-extension/`)

The build pipeline emits the load-unpacked artifact directly to `./chrome-extension/` at the repo root (per `powershell.json → distDir = "chrome-extension"`). This is the folder you point Chrome's **Load unpacked** at — *not* `dist/`, which is reserved for the Lovable preview / web-app build.

```
chrome-extension/
├── projects/
│   ├── scripts/
│   │   ├── marco-sdk/
│   │   │   ├── marco-sdk.js
│   │   │   └── instruction.json
│   │   ├── xpath/
│   │   │   ├── xpath.js
│   │   │   └── instruction.json
│   │   └── macro-controller/
│   │       ├── macro-looping.js
│   │       ├── macro-looping.css
│   │       ├── macro-looping-config.json
│   │       ├── macro-theme.json
│   │       ├── templates.json
│   │       └── instruction.json
│   └── seed-manifest.json
├── prompts/
│   └── macro-prompts.json
├── manifest.json                 # Built MV3 manifest (CSP-validated post-build)
├── readme.md
├── VERSION
└── ...
```

---

## MV3 CSP & sql.js (`'wasm-unsafe-eval'`)

The extension uses **sql.js** (a WebAssembly build of SQLite) as its
session/log store. Under Manifest V3 the default Content Security Policy
applied to `extension_pages` is:

```
script-src 'self'; object-src 'self'
```

That default **forbids `WebAssembly.instantiate()`** — the browser will
fetch `sql-wasm.wasm` successfully (HTTP 200, correct byte length) and
then refuse to compile it with:

```
CompileError: WebAssembly.instantiate(): Compiling or instantiating
WebAssembly module violates the following Content Security policy
directive ... "script-src 'self'".
```

Symptoms: the popup boots into the `BootFailureBanner` with
`Failed step: db-init` and a misleading "WASM is corrupted" hint, even
though the WASM is fine.

The fix is one line in `manifest.json` — add `'wasm-unsafe-eval'` to the
`script-src` directive of `extension_pages`:

```json
"content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

This is the modern (Chrome 95+) MV3-blessed directive specifically for
Wasm; **do not** use `'unsafe-eval'` (rejected by Web Store review) or
the legacy `'wasm-eval'` (Chrome-only, undocumented).

### Verifying after each manifest change

Two independent guards live in this repo and run on every build, and you
can also run them by hand any time you touch `manifest.json`:

```bash
# 1. Source-manifest preflight — runs BEFORE Vite, fails the build if
#    the source manifest's CSP is missing or doesn't allow Wasm.
pnpm run check:manifest

# 2. Build the extension. The pipeline ends with check:built-csp, which
#    re-validates chrome-extension/manifest.json AFTER Vite has rewritten
#    path fields, then prints a 4-step reload-and-verify checklist.
pnpm run build:extension

# 3. Manual re-validation against the built artifact.
pnpm run check:built-csp
```

Both checks emit a CODE RED block (exact path, what's missing, why) and
exit 1 on failure. CI also runs the dedicated
`verify-built-manifest-csp` job against the uploaded
`chrome-extension/` artifact, with a `grep` fallback so the regression
is caught even if the Node validator itself is broken. Any future
browser-based smoke test must declare `needs: verify-built-manifest-csp`
so we never burn browser-runner minutes on a build that can't boot.

### One-time browser confirmation

After running `pnpm run build:extension`, follow the printed checklist:

1. Open `chrome://extensions`
2. Find **Marco Macro Extension** vX.Y.Z, click the reload icon
3. Open the extension popup (toolbar icon)
4. Confirm the `BootFailureBanner` is **gone** — no `WASM load (wasm)`
   failure, no CSP `CompileError`. If the banner is still there, open
   *Inspect views → service worker → Console* on `chrome://extensions`
   for the actual error.

---

## Adding a New Script

1. Create `standalone-scripts/{name}/src/index.ts` and `src/instruction.ts`
2. Add `build:{name}` script in root `package.json`
3. Add TypeScript config (`tsconfig.{name}.json`)
4. Add Vite config (`vite.config.{name}.ts`)
5. The build pipeline auto-discovers and deploys it

The `instruction.ts` is the **sole manifest** — no separate configuration files needed. It declares script metadata, dependencies, files, and injection behavior in a single TypeScript file that compiles to `instruction.json`.

### Dynamic Script Loading

At runtime, scripts can load other scripts dynamically:

```typescript
await RiseupAsiaMacroExt.require("Project.Script");
```

---

## CI/CD Release Pipeline

Creating or pushing a `release/*` branch (e.g., `release/v3.11.1`) or creating a
`v*` tag automatically enters release mode and:

1. Installs dependencies with pnpm; if `pnpm-lock.yaml` is absent it falls back to `pnpm install --no-frozen-lockfile --lockfile=false`
2. Runs root ESLint and `chrome-extension` ESLint
3. Runs the full test suite
4. Builds standalone scripts (SDK → XPath → Macro Controller)
5. Builds the Chrome extension
6. Copies `readme.md`, `VERSION`, and `changelog.md` into the release asset set
7. Zips `chrome-extension/` into `marco-extension-v{VERSION}.zip`
8. Generates categorized release notes from commit history with Bash + PowerShell install commands
9. Creates or updates the GitHub Release page with all assets attached

If `.gitmap/release/latest.json` changes or the release workflow itself is
fixed, **Release Watcher** calls the canonical **Release Build** workflow
in-process. The watcher only passes after the actual asset build/upload passes,
so a release page with only GitHub source archives is still a failed release.

**No email or notification is sent** — check the [Releases page](https://github.com/alimtvnetwork/macro-ahk-v37/releases) for status.

### Re-running CI lint

If the **`Preflight · ESLint (Standalone Scripts)`** job fails or shows
stale warnings, follow the step-by-step guide:
[`docs/ci/rerun-standalone-lint.md`](docs/ci/rerun-standalone-lint.md).
It covers re-running the job on the latest commit, verifying the SHA
via the diagnostics step, reproducing the lint locally, and clearing
the GitHub Actions cache (UI + `gh` CLI) when warnings persist.

### Release Assets

| Asset | Description |
|-------|-------------|
| `marco-extension-v{VER}.zip` | Chrome extension — load unpacked in `chrome://extensions` |
| `macro-controller-v{VER}.zip` | Standalone macro controller scripts |
| `marco-sdk-v{VER}.zip` | Marco SDK |
| `xpath-v{VER}.zip` | XPath utility scripts |
| `install.ps1` | PowerShell installer (Windows) |
| `install.sh` | Bash installer (Linux/macOS) |
| `VERSION.txt` | Version identifier |
| `changelog.md` | Full project changelog |

### Release Install Commands

**Windows (PowerShell)**

```powershell
irm https://github.com/alimtvnetwork/macro-ahk-v37/releases/download/v{VER}/install.ps1 | iex
```

**Linux / macOS**

```bash
curl -fsSL https://github.com/alimtvnetwork/macro-ahk-v37/releases/download/v{VER}/install.sh | bash
```

---

## Project Structure

A monorepo with three primary trees: **runtime code** (extension + standalone scripts), **specifications** (`spec/` — v3.5.0 layout), and **build/CI tooling**.

```
.
├── src/                            # Chrome extension source (popup, options, background, content scripts)
│   ├── background/                 # MV3 service worker, seeder, injection diagnostics
│   ├── content/                    # Content-script injection pipeline (ISOLATED world)
│   ├── pages/                      # React popup + options UI (shadcn/ui)
│   ├── components/                 # Shared UI components
│   ├── lib/                        # Platform adapter, auth bridge, utilities
│   ├── shared/                     # Cross-context constants (incl. EXTENSION_VERSION)
│   └── test/                       # Unit + regression tests (Vitest)
│
├── chrome-extension/               # Built MV3 extension — load unpacked from here
│   └── (generated by `pnpm run build:extension`; git-ignored output)
│
├── standalone-scripts/             # Injectable IIFE bundles, each with its own instruction.ts
│   ├── marco-sdk/                  # Shared SDK (require, messaging, utilities)
│   ├── xpath/                      # XPath query utilities
│   ├── macro-controller/           # Core automation controller (largest module)
│   │   ├── src/                    # TypeScript source (class-based modules)
│   │   ├── less/                   # LESS stylesheets → CSS
│   │   ├── templates/              # HTML templates → templates.json
│   │   └── dist/                   # Compiled IIFE + assets + instruction.json
│   └── prompts/                    # AI prompt markdown files
│
├── spec/                           # 📚 Specification tree — Spec Authoring Guide v3.5.0 layout
│   ├── 00-overview.md              # Master index of the entire spec tree
│   ├── 01-spec-authoring-guide/    # ───── FOUNDATIONS (slots 01–20, universal) ─────
│   ├── 02-coding-guidelines/       # 26 engineering rules (TS, Go, PHP, Rust, C#, AI-opt, CI/CD)
│   ├── 03-error-manage/            # Error management patterns + AppError package
│   ├── 04-database-conventions/    # Schema patterns
│   ├── 05-split-db-architecture/   # SQLite organization
│   ├── 06-seedable-config-architecture/
│   ├── 07-design-system/           # Design tokens, UI standards
│   ├── 08-docs-viewer-ui/          # 🟡 stub
│   ├── 09-code-block-system/       # 🟡 stub
│   ├── 10-research/                # 🟡 stub
│   ├── 11-powershell-integration/  # PowerShell installer + integration specs
│   ├── 12-cicd-pipeline-workflows/ # CI/CD specs (incl. repo-rename script)
│   ├── 14-update/                  # 🟡 stub — update mechanism
│   ├── 17-consolidated-guidelines/ # 🟡 stub
│   │   #  Slots 13, 15, 16, 18, 19, 20 reserved for future foundations.
│   │
│   ├── 21-app/                     # ─────────── APP TIER (slots 21+) ───────────
│   │   ├── 00-overview.md          #   App-tree master index
│   │   ├── 01-chrome-extension/    #   Chrome extension specs (architecture, build, messaging)
│   │   ├── 02-features/            #   Other app features
│   │   │   ├── devtools-and-injection/
│   │   │   └── misc-features/
│   │   ├── 03-data-and-api/        #   Data schemas, API samples, DB join specs
│   │   ├── 04-design-diagrams/     #   Mermaid diagrams, visual design
│   │   ├── 05-prompts/             #   AI prompt samples & folder structure
│   │   └── 06-tasks/               #   Roadmap, task breakdowns
│   │
│   ├── 22-app-issues/              # Bug reports, RCAs (103 entries, 0 numbering collisions ✅)
│   ├── 26-macro-controller/        # Macro Controller specs (promoted to top-level)
│   │
│   ├── 99-archive/                 # ─────────── ARCHIVE (frozen historical) ───────────
│   │   ├── governance-history/     #   Original spec-index, reorganization plans
│   │   ├── duplicates/             #   Stale duplicate folders preserved for traceability
│   │   ├── imported-error-management/
│   │   ├── imported-misc/
│   │   ├── imported-powershell-integration/
│   │   ├── wordpress/
│   │   └── 01-overview-legacy/
│   │
│   ├── validation-reports/         # Time-stamped audits (e.g., reorganization-audit, deepdive)
│   ├── .spec-folder-registry.json  # Authoritative folder list — protects sparse dirs from auto-cleanup
│   └── 99-consistency-report.md    # Root-level structural health report
│
├── scripts/                        # 🛠️  Build helpers, validators & install scripts
│   ├── install.ps1 / install.sh    # Unified installer (auto-derives version from URL)
│   ├── compile-instruction.mjs     # instruction.ts → instruction.json
│   ├── aggregate-prompts.mjs       # Prompt .md → macro-prompts.json
│   ├── check-version-sync.mjs      # Version consistency validation
│   ├── check-axios-version.mjs     # Pin axios to safe-list versions
│   ├── check-no-pnpm-dlx-less.mjs  # CI preflight (blocks the broken pnpm-dlx-less invocation) <!-- preflight-allow-line -->
│   ├── spec-folder-guard.mjs       # Spec auto-cleanup safeguard (npm: check:spec-folders)
│   └── ... (validators, repo-rename, etc.)
│
├── build/
│   └── ps-modules/                 # PowerShell build modules (utils, preflight, build, browser, watch)
│
├── pipeline/                       # Build & validation pipeline documentation (overview, scripts, gotchas)
├── memory/                         # In-extension memory/context utilities
├── .lovable/                       # Lovable AI memory & plan
│   ├── memory/                     #   Persistent project memory (always-loaded index + per-topic files)
│   ├── plan.md                     #   Authoritative roadmap / backlog
│   └── suggestions.md              #   Canonical suggestions tracker
│
├── docs/                           # Long-form architecture docs (extension-architecture.md, etc.)
├── tests/                          # Top-level integration / Playwright E2E
├── public/                         # Static assets served by the Lovable preview
├── changelog.md                    # Project changelog (per-version entries)
├── readme.md                       # This file
├── manifest.json                   # MV3 source manifest (version-synced with constants.ts)
├── package.json                    # Workspace scripts (build:*, check:*, test, lint)
├── run.ps1                         # PowerShell orchestrator (-d = full deploy)
└── .github/workflows/              # CI/CD pipelines (release.yml, ci.yml)
```

> **Spec-tree layout authority:** `spec/01-spec-authoring-guide/` is the source of truth. Slots **01–20 are reserved for foundations only** (no app-specific content). App content lives at slot **21+**. The `.spec-folder-registry.json` + `pnpm run check:spec-folders` guards against auto-cleanup pruning sparse folders. Validation reports under `spec/validation-reports/` document migrations and audits.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Extension UI** | React 18, TypeScript 5, Tailwind CSS v3, shadcn/ui |
| **Build System** | Vite 5, LESS, PowerShell (Windows orchestration) |
| **Standalone Scripts** | TypeScript → IIFE bundles (ES2020 target) |
| **Storage** | SQLite (sql.js), IndexedDB, chrome.storage.local, OPFS |
| **Testing** | Vitest, Playwright (E2E) |
| **Linting** | ESLint + SonarJS (zero warnings enforced) |
| **CI/CD** | GitHub Actions |
| **Spec governance** | Authoring Guide v3.5.0, folder-guard safeguard, time-stamped validation reports |

---

## Engineering Standards

The project enforces strict engineering standards (26 rules documented in `spec/02-coding-guidelines/engineering-standards.md`):

- **Zero ESLint warnings/errors** — SonarJS plugin enforced across all code
- **All errors include exact file path, missing item, and reasoning** — optimized for AI-assisted diagnosis
- **Unified versioning** — manifest, `constants.ts`, and standalone scripts always in sync
- **ASCII-safe console output** — no Unicode symbols in build output
- **Dark-only theme** — no light mode, no toggle
- **Constant naming convention** — `ID_`, `SEL_`, `CLS_`, `MSG_` prefixes in SCREAMING_SNAKE_CASE

---

## Troubleshooting

### `vite:load-fallback` ENOENT — module cannot be loaded

**Symptom.** A development build fails partway through with output similar to:

```
[plugin vite:load-fallback]
ENOENT: no such file or directory, open
  '.../src/background/recorder/step-library/result-webhook.ts'
    at async Object.load (vite/dist/node/chunks/dep-*.js:...)
    at async PluginDriver.hookFirstAndGetPlugin (rollup/...)
error during build
error: script "build:dev" exited with code 1
```

`vite:load-fallback` is the **last-resort** plugin in Vite's pipeline that
reads a source file from disk after every other resolver has run. An ENOENT
here means Rollup *thinks* the file should exist (because some module
imported it) but the actual disk read failed. There are exactly three causes
worth checking, in order:

| # | Root cause | How to confirm | Fix |
|---|------------|----------------|-----|
| 1 | **The file really is missing** (deleted, renamed, never committed) | `ls src/background/recorder/step-library/result-webhook.ts` | Restore from git history, or update the importer if the rename was intentional. |
| 2 | **An importer points at a stale path** (typo, wrong alias, drift after refactor) | `rg "result-webhook" src` and inspect every match | Correct the import specifier; prefer the `@/…` alias form. |
| 3 | **Stale Vite/TS cache** holding a fingerprint of an old file location while the file on disk is fine | The file exists on disk and the importer paths look correct, but the build still fails | Run the cache-clear step below. |

### Built-in guards (run automatically before every build)

Both `pnpm run build` and `pnpm run build:dev` are wired through two
fail-fast guards so the failure surface is clear *before* Vite starts:

1. **`scripts/prebuild-clean-and-verify.mjs`**
   - Deletes `node_modules/.vite`, `node_modules/.vite-temp`,
     `node_modules/.cache`, and any `*.tsbuildinfo` files.
   - Verifies every expected file in
     `src/background/recorder/step-library/` is present and non-empty.
   - Exits non-zero with **exact path · missing item · reason** if anything
     is wrong.
2. **`scripts/check-result-webhook.mjs`**
   - Confirms `result-webhook.ts` exists, is non-empty, and exposes its
     required named exports (`dispatchWebhook`).
   - Confirms every known importer of the module still exists.

### Manual cache clear (when to run it)

You should not normally need to clear caches by hand — the prebuild guard
does it for you. Run a manual clear only when:

- You **switched git branches** with very different dependency or source
  trees and the next build fails with an ENOENT against a file that
  obviously exists on disk.
- You **renamed or moved a file** that other modules import, and a
  subsequent build still references the old path.
- You **interrupted a previous build** (Ctrl+C, crashed terminal) and the
  partial cache may now be inconsistent.
- A teammate reports the same ENOENT that you cannot reproduce — clearing
  ensures both of you are starting from the same state.

Manual command:

```bash
rm -rf node_modules/.vite node_modules/.vite-temp node_modules/.cache \
       tsconfig*.tsbuildinfo dist
pnpm run build:dev
```

### Reproduction helper

If the ENOENT recurs, use the bundled repro entry point — it prints the
resolved path for `result-webhook` *before* invoking the same dev build:

```bash
pnpm run repro:build
# → scripts/repro-build-error.mjs
```

The same helper is exposed as a **"Reproduce build error"** button in the
extension's *Diagnostics* view, which copies the command to your clipboard
and displays the resolved import path.

### When to escalate

If all three of the following are true, treat it as a real bug rather than
a cache issue and open an issue:

- `pnpm run prebuild:clean-verify` succeeds.
- `pnpm run check:result-webhook` succeeds.
- `pnpm run repro:build` still fails with `vite:load-fallback` ENOENT.

Attach the full output of `repro:build` (it includes the resolved absolute
path, file size, mtime, and importer presence checks) to the issue.

---

## Author


<div align="center">

### [Md. Alim Ul Karim](https://www.google.com/search?q=alim+ul+karim)

**[Creator & Lead Architect](https://alimkarim.com)** | [Chief Software Engineer](https://www.google.com/search?q=alim+ul+karim), [Riseup Asia LLC](https://riseup-asia.com)

</div>

A system architect with **20+ years** of professional software engineering experience across enterprise, fintech, and distributed systems. His technology stack spans **.NET/C# (18+ years)**, **JavaScript (10+ years)**, **TypeScript (6+ years)**, and **Golang (4+ years)**.

Recognized as a **top 1% talent at Crossover** and one of the top software architects globally. He is also the **Chief Software Engineer of [Riseup Asia LLC](https://riseup-asia.com/)** and maintains an active presence on **[Stack Overflow](https://stackoverflow.com/users/361646/alim-ul-karim)** (2,452+ reputation, member since 2010) and **LinkedIn** (12,500+ followers).

|  |  |
|---|---|
| **Website** | [alimkarim.com](https://alimkarim.com/) · [my.alimkarim.com](https://my.alimkarim.com/) |
| **LinkedIn** | [linkedin.com/in/alimkarim](https://linkedin.com/in/alimkarim) |
| **Stack Overflow** | [stackoverflow.com/users/361646/alim-ul-karim](https://stackoverflow.com/users/361646/alim-ul-karim) |
| **Google** | [Alim Ul Karim](https://www.google.com/search?q=Alim+Ul+Karim) |
| **Role** | Chief Software Engineer, [Riseup Asia LLC](https://riseup-asia.com) |

### Riseup Asia LLC

[Top Leading Software Company in WY (2026)](https://riseup-asia.com)

|  |  |
|---|---|
| **Website** | [riseup-asia.com](https://riseup-asia.com/) |
| **Facebook** | [riseupasia.talent](https://www.facebook.com/riseupasia.talent/) |
| **LinkedIn** | [Riseup Asia](https://www.linkedin.com/company/105304484/) |
| **YouTube** | [@riseup-asia](https://www.youtube.com/@riseup-asia) |

---

## License

This project is proprietary software owned by Riseup Asia LLC. All rights reserved.
