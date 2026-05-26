#!/usr/bin/env bash
# Re-exec under bash if invoked via sh/dash
if [ -z "${BASH_VERSION:-}" ]; then
    if command -v bash >/dev/null 2>&1; then
        case "${0##*/}" in
            sh|dash|ash|ksh|mksh)
                exec bash -s -- "$@"
                ;;
        esac
        exec bash "$0" "$@"
    else
        printf '\033[31m Error: bash is required but not found.\033[0m\n' >&2
        exit 1
    fi
fi

# ─────────────────────────────────────────────────────────────────────
# Marco Extension — Unified installer (Linux / macOS)
#
# Conforms to the Generic Installer Behavior specification:
#   spec/14-update/01-generic-installer-behavior.md
# (resolution waterfall, versioned-repo discovery, fail-fast policy,
# exit codes). Any change to the resolution order, repo-discovery rules,
# or user-visible messages here MUST be mirrored in that spec — the spec
# is the contract that other repositories' installers (quick-install,
# release-install, error-manage, etc.) follow.
#
# Single installer — the version is auto-derived from the script's source
# URL when downloaded from a GitHub release page (so each release-page
# one-liner is implicitly pinned to that exact release). When run from
# raw.githubusercontent.com/.../main/ or from a clone, it falls back to
# resolving the GitHub `latest` release.
#
# Resolution order:
#   1. Explicit --version override (vX.Y.Z[-pre], or `latest`).
#   2. URL parsed from $BASH_SOURCE / $0 / $MARCO_INSTALLER_URL
#      — matching /releases/download/(vX.Y.Z)/.
#   3. GitHub Releases API → `latest`.
#
# Examples:
#   # Release-page one-liner (URL-pinned):
#   curl -fsSL https://github.com/alimtvnetwork/macro-ahk-v39/releases/download/v2.158.0/install.sh | bash
#
#   # From main (latest channel):
#   curl -fsSL https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v39/main/scripts/install.sh | bash
#
#   # Explicit override:
#   ./install.sh --version v2.150.0
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Shared installer contract (spec/14-update/01-…) ────────────────
# scripts/installer-constants.sh is generated from
# scripts/installer-contract.json by scripts/generate-installer-constants.mjs.
# When present beside this script it provides MARCO_DEFAULT_REPO,
# MARCO_VERSION_REGEX, MARCO_MAIN_BRANCH_SENTINEL, MARCO_EXIT_*, and the
# MARCO_API_BASE / MARCO_DOWNLOAD_BASE / MARCO_MAIN_BRANCH defaults
# (already env-var-aware via `: ${VAR:=…}`). When absent (curl-piped
# standalone install) the inline fallbacks below take over so install.sh
# remains a single self-sufficient file.
__CONST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || __CONST_DIR=""
if [ -n "${__CONST_DIR}" ] && [ -f "${__CONST_DIR}/installer-constants.sh" ]; then
    # shellcheck disable=SC1090,SC1091
    . "${__CONST_DIR}/installer-constants.sh"
fi
unset __CONST_DIR

REPO="${MARCO_DEFAULT_REPO:-alimtvnetwork/macro-ahk-v39}"
VERSION_REGEX="${MARCO_VERSION_REGEX:-^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$}"
# Sentinel returned by fetch_latest_version when the API responds 200 OK
# but reports zero releases. Triggers spec §2 step 5 main-branch fallback
# (AC-2) — distinct from a network/5xx failure which still exits 5.
MAIN_BRANCH_SENTINEL="${MARCO_MAIN_BRANCH_SENTINEL:-__MAIN_BRANCH__}"
# Default branch used by the main-branch fallback. Override per repo via
# MARCO_MAIN_BRANCH env var or via the shared contract.
MAIN_BRANCH="${MARCO_MAIN_BRANCH:-main}"
TMP_DIR=""
URL_PINNED=0
MAIN_FALLBACK=0
DRY_RUN=0
NO_SIBLING_DISCOVERY=0
ENABLE_SIBLING_DISCOVERY_FLAG=0   # set by --enable-sibling-discovery
SIBLING_DECISION="off"            # one of: off, skipped-strict, skipped-cli, on
SIBLING_DECISION_REASON=""        # human-readable reason, used in dry-run plan

# Test-mode endpoint overrides — production defaults match GitHub. The
# installer mock server (tests/installer/fixtures/mock-server.cjs) sets
# both to a single http://127.0.0.1:<port> base so curl/wget never leave
# the host. Spec §6: these MUST default to the real GitHub endpoints.
MARCO_API_BASE="${MARCO_API_BASE:-https://api.github.com}"
MARCO_DOWNLOAD_BASE="${MARCO_DOWNLOAD_BASE:-https://github.com}"

# ── Sibling-discovery defaults (spec §4) ────────────────────────────
# These are the in-script fallbacks used when scripts/install.config.sh
# is absent (e.g. when install.sh is downloaded standalone via curl).
# scripts/install.config.sh — when present — wins, and env vars win
# over both. CLI flags (--enable-sibling-discovery / --no-sibling-
# discovery) win over everything. Spec §4 rule 6 (strict-mode lockout)
# is enforced in decide_sibling_discovery() below — config CANNOT
# override it.
SIBLING_DISCOVERY_ENABLED="${SIBLING_DISCOVERY_ENABLED:-0}"
# NOTE: bash's ${VAR:=default} parameter-expansion form treats the FIRST `}`
# it sees as the closer of the expansion. A literal `macro-ahk-v{N}` default
# therefore parses as `macro-ahk-v{N` (the inner `}` is consumed). Assign
# via a temporary so the literal survives intact.
__SIBLING_NAME_PATTERN_DEFAULT='macro-ahk-v{N}'
SIBLING_NAME_PATTERN="${SIBLING_NAME_PATTERN:-${__SIBLING_NAME_PATTERN_DEFAULT}}"
unset __SIBLING_NAME_PATTERN_DEFAULT
SIBLING_PROBE_DEPTH="${SIBLING_PROBE_DEPTH:-20}"
SIBLING_PARALLELISM="${SIBLING_PARALLELISM:-8}"
SIBLING_PROBE_TIMEOUT_SECS="${SIBLING_PROBE_TIMEOUT_SECS:-5}"

# Source the optional config file beside this script. Found-and-sourced
# values still defer to env vars (each line in the config uses ${VAR:-…}).
# Lookup order: $MARCO_INSTALLER_CONFIG (explicit) → next to install.sh.
__INSTALLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || __INSTALLER_DIR=""
__CFG_CANDIDATE="${MARCO_INSTALLER_CONFIG:-${__INSTALLER_DIR}/install.config.sh}"
if [ -n "${__CFG_CANDIDATE}" ] && [ -f "${__CFG_CANDIDATE}" ]; then
    # shellcheck disable=SC1090
    . "${__CFG_CANDIDATE}"
fi
unset __INSTALLER_DIR __CFG_CANDIDATE

cleanup() {
    if [ -n "${TMP_DIR}" ] && [ -d "${TMP_DIR}" ]; then
        rm -rf "${TMP_DIR}"
    fi
}
trap cleanup EXIT

# ── Top-level fail-safe (ERR trap) ──────────────────────────────────
# `set -euo pipefail` is great for fail-fast but a bare exit leaves
# the user (especially when running `curl ... | bash`) with no idea
# WHICH line crashed or WHY. This trap dumps everything copy/pastable
# to stderr AND to a log file in $TMPDIR so the user can share it.
MARCO_CRASH_LOG="${TMPDIR:-/tmp}/marco-install-$(date -u +%Y%m%d-%H%M%S)-$$.log"
on_err() {
    local exit_code=$?
    local line_no=${1:-?}
    local cmd=${2:-?}
    {
        echo "=== Marco Installer Crash ==="
        echo "Timestamp:  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "Script:     install.sh"
        echo "Repo:       ${REPO:-?}"
        echo "Version:    ${VERSION_OVERRIDE:-${VERSION:-?}}"
        echo "InstallDir: ${INSTALL_DIR:-?}"
        echo "DryRun:     ${DRY_RUN:-0}"
        echo "Bash:       ${BASH_VERSION:-?}"
        echo "Uname:      $(uname -a 2>/dev/null || echo '?')"
        echo "PWD:        $(pwd)"
        echo "ExitCode:   ${exit_code}"
        echo ""
        echo "--- Failing command ---"
        echo "Line ${line_no}: ${cmd}"
        echo ""
        echo "--- Call stack (most recent call first) ---"
        local i=0
        while caller "$i" >/dev/null 2>&1; do
            caller "$i"
            i=$((i + 1))
        done
        echo ""
        echo "--- FUNCNAME chain ---"
        printf '  %s\n' "${FUNCNAME[@]:-(top-level)}"
    } | tee "${MARCO_CRASH_LOG}" >&2 || true
    printf '\n\033[31m============================================================\033[0m\n' >&2
    printf '\033[31m Marco installer crashed — log saved to:\033[0m\n  %s\n' "${MARCO_CRASH_LOG}" >&2
    printf '\033[31m============================================================\033[0m\n\n' >&2
    exit "${exit_code}"
}
trap 'on_err "${LINENO}" "${BASH_COMMAND}"' ERR



# ── Logging ─────────────────────────────────────────────────────────

step() { printf ' \033[36m%s\033[0m\n' "$*" >&2; }
ok()   { printf ' \033[32m%s\033[0m\n' "$*" >&2; }
warn() { printf ' \033[33m%s\033[0m\n' "$*" >&2; }
err()  { printf ' \033[31m%s\033[0m\n' "$*" >&2; }

# ── OS detection ────────────────────────────────────────────────────

detect_os() {
    local uname_out
    uname_out="$(uname -s)"
    case "${uname_out}" in
        Linux*|Darwin*) ;;
        MINGW*|MSYS*|CYGWIN*)
            err "Windows detected. Use the PowerShell installer instead:"
            err "  irm https://raw.githubusercontent.com/${REPO}/main/scripts/install.ps1 | iex"
            exit 1
            ;;
        *)
            err "Unsupported OS: ${uname_out}"
            exit 1
            ;;
    esac
}

# ── Version resolution ─────────────────────────────────────────────

is_valid_version() {
    [[ "$1" =~ $VERSION_REGEX ]]
}

version_from_url() {
    local candidate
    for candidate in "${BASH_SOURCE[0]:-}" "${0:-}" "${MARCO_INSTALLER_URL:-}"; do
        if [ -n "${candidate}" ] && [[ "${candidate}" =~ /releases/download/(v[0-9]+\.[0-9]+\.[0-9]+[^/]*)/ ]]; then
            echo "${BASH_REMATCH[1]}"
            return 0
        fi
    done
    return 1
}

fetch_latest_version() {
    step "Resolving latest release from github.com/${REPO}..."
    local url="${MARCO_API_BASE}/repos/${REPO}/releases/latest"
    local body_file="${TMP_DIR:-/tmp}/marco-latest-$$.json"
    local http_code="000"
    local fetcher=""

    # Two-stage probe: capture HTTP status separately from body so we can
    # distinguish (per spec §2 step 5 + §2.3):
    #   - 200 OK + tag_name        → return tag (happy path, AC-1/AC-7)
    #   - 200 OK + no tag_name     → return MAIN_BRANCH_SENTINEL (AC-2)
    #   - 404 (no releases at all) → return MAIN_BRANCH_SENTINEL (AC-2)
    #   - 5xx / network / no curl  → exit 5 (AC-8)
    if command -v curl >/dev/null 2>&1; then
        fetcher="curl"
        # -w writes status to stdout AFTER body goes to -o file. We do
        # NOT use -f here — we want the body even on non-2xx, AND we
        # need the actual code to differentiate 404 from 5xx.
        http_code="$(curl -sSL -o "${body_file}" -w '%{http_code}' \
            "${url}" 2>/dev/null || echo "000")"
    elif command -v wget >/dev/null 2>&1; then
        fetcher="wget"
        # wget --server-response prints "HTTP/1.x <code>" to stderr; capture
        # both stdout body and the last response code.
        local wget_stderr
        wget_stderr="$(wget -qO "${body_file}" --server-response "${url}" 2>&1 || true)"
        # Last "HTTP/" line wins (in case of redirects).
        http_code="$(printf '%s\n' "${wget_stderr}" \
            | awk '/^[[:space:]]*HTTP\// {code=$2} END {print (code ? code : "000")}')"
    else
        err "Neither curl nor wget found — cannot fetch latest release."
        exit 5
    fi

    case "${http_code}" in
        2*)
            # 200 OK — parse tag_name. Empty body or missing field means
            # the host knows the repo but reports zero releases.
            local tag=""
            if [ -s "${body_file}" ]; then
                tag="$(grep '"tag_name"' "${body_file}" | head -1 \
                    | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
            fi
            rm -f "${body_file}" 2>/dev/null || true
            if [ -n "${tag}" ]; then
                echo "${tag}"
                return 0
            fi
            # 200 OK with no tag → zero releases. Spec §2 step 5 / AC-2.
            MAIN_FALLBACK=1
            echo "${MAIN_BRANCH_SENTINEL}"
            return 0
            ;;
        404)
            # 404 on /releases/latest = "no published releases" per GitHub
            # API contract. Treat as zero-releases → main-branch fallback.
            rm -f "${body_file}" 2>/dev/null || true
            MAIN_FALLBACK=1
            echo "${MAIN_BRANCH_SENTINEL}"
            return 0
            ;;
        *)
            rm -f "${body_file}" 2>/dev/null || true
            err "Failed to determine latest version from GitHub API (HTTP ${http_code} via ${fetcher})."
            err "Spec §2.3: discovery-mode API failure exits 5."
            exit 5
            ;;
    esac
}

resolve_version() {
    local override="$1"

    # 1. Explicit override
    if [ -n "${override}" ]; then
        if [ "${override}" = "latest" ]; then
            fetch_latest_version
            return
        fi
        if ! is_valid_version "${override}"; then
            err "Invalid --version '${override}'. Must match v<major>.<minor>.<patch>[-prerelease] or 'latest'."
            exit 3
        fi
        echo "${override}"
        return
    fi

    # 2. URL-derived pin
    local from_url
    if from_url="$(version_from_url)" && is_valid_version "${from_url}"; then
        URL_PINNED=1
        step "Pinned to ${from_url} (derived from download URL)."
        echo "${from_url}"
        return
    fi

    # 3. Fallback to latest
    fetch_latest_version
}

# ── Download ────────────────────────────────────────────────────────

download() {
    local url="$1" dest="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL -o "${dest}" "${url}"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "${dest}" "${url}"
    else
        err "Neither curl nor wget found."
        exit 5
    fi
}

download_asset() {
    local version="$1"

    # Spec §2 step 5 / AC-2: when fetch_latest_version returned the
    # main-branch sentinel, switch to the source tarball off the default
    # branch instead of a release ZIP. Discovery mode only — strict mode
    # never reaches this branch (it would have exited 4 earlier).
    if [ "${version}" = "${MAIN_BRANCH_SENTINEL}" ]; then
        download_main_branch_tarball
        return $?
    fi

    local asset_name="marco-extension-${version}.zip"
    local asset_url="${MARCO_DOWNLOAD_BASE}/${REPO}/releases/download/${version}/${asset_name}"
    local archive_path="${TMP_DIR}/${asset_name}"

    step "Downloading ${asset_name}..."
    if ! download "${asset_url}" "${archive_path}"; then
        err "Download failed."
        err "URL: ${asset_url}"
        err ""
        err "Release ${version} may have been retracted or the asset is missing."
        exit 4
    fi

    ok "Downloaded successfully."
    verify_checksum "${version}" "${asset_name}" "${archive_path}"
    verify_signature "${version}"
    echo "${archive_path}"
}

# Fetch the source tarball from the configured main branch. Used as the
# spec §2 step 5 / AC-2 fallback when the release host is reachable but
# reports zero releases. NOT subject to checksums.txt (the file lives in
# releases, not in branches), and NOT subject to exit 4 — a missing main
# branch is a network/tooling problem and exits 5 (spec §2.3).
download_main_branch_tarball() {
    local archive_name="${REPO##*/}-${MAIN_BRANCH}.tar.gz"
    local archive_url="${MARCO_DOWNLOAD_BASE}/${REPO}/archive/refs/heads/${MAIN_BRANCH}.tar.gz"
    local archive_path="${TMP_DIR}/${archive_name}"

    step "Downloading main-branch tarball (${MAIN_BRANCH})..."
    if ! download "${archive_url}" "${archive_path}"; then
        err "Main-branch tarball download failed."
        err "URL: ${archive_url}"
        err ""
        err "Spec §2.3: discovery-mode network failure exits 5."
        exit 5
    fi

    ok "Downloaded successfully."
    echo "${archive_path}"
}


# ── Checksum verification (spec/14-update §7.1, §8 rule 2) ──────────
#
# Downloads checksums.txt from the same release as the asset and
# compares its SHA-256 line for ${asset_name} to the locally computed
# digest of ${archive_path}.
#
# Behavior:
#   - Match            → log success, continue install.
#   - Mismatch         → exit 6 (per §3 + §8 rule 2).
#   - checksums.txt    → soft-warn + continue (older releases predating
#     missing            v0.2 hardening did not ship checksums.txt;
#                        gating on it would break legacy reinstalls).
#   - No sha256 tool   → soft-warn + continue with a remediation hint
#                        so the user can install coreutils/Perl manually.
#
# All output goes through the same step/err helpers so the install log
# remains scannable. The checksum line is intentionally NOT logged in
# full — it would dwarf surrounding output. We log "verified" + asset.
verify_checksum() {
    local version="$1" asset_name="$2" archive_path="$3"
    local checksums_url="${MARCO_DOWNLOAD_BASE}/${REPO}/releases/download/${version}/checksums.txt"
    local checksums_path="${TMP_DIR}/checksums.txt"

    step "Verifying SHA-256 of ${asset_name}..."

    if ! download "${checksums_url}" "${checksums_path}" 2>/dev/null; then
        warn "checksums.txt not found at ${checksums_url}"
        warn "Skipping checksum verification (older release predating v0.2 hardening)."
        return 0
    fi

    local expected
    expected="$(grep " \\*\\?${asset_name}\$" "${checksums_path}" | awk '{print $1}' | head -1)"
    if [ -z "${expected}" ]; then
        warn "checksums.txt does not list ${asset_name} — skipping verification."
        return 0
    fi

    local actual
    actual="$(compute_sha256 "${archive_path}")"
    if [ -z "${actual}" ]; then
        warn "No SHA-256 tool found (sha256sum / shasum / openssl). Skipping verification."
        warn "Install coreutils, perl, or openssl to enable integrity checks."
        return 0
    fi

    if [ "${expected}" = "${actual}" ]; then
        ok "Checksum verified (${asset_name})."
        return 0
    fi

    err "Checksum MISMATCH for ${asset_name}"
    err "  expected: ${expected}"
    err "  actual:   ${actual}"
    err "  source:   ${checksums_url}"
    err ""
    err "The downloaded archive does not match the published SHA-256."
    err "Refusing to install — possible mirror tampering or corruption."
    exit 6
}

# Compute SHA-256 of a file using whichever tool is available. Echoes
# the lowercase hex digest, or an empty string if no tool exists.
compute_sha256() {
    local path="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "${path}" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "${path}" | awk '{print $1}'
    elif command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 "${path}" | awk '{print $NF}'
    else
        echo ""
    fi
}

# ── Signature verification (spec §7.1.5, AC-24/25/26) ──────────────
#
# Optional v0.3 hardening: when the release ships a
# `checksums.txt.minisig` and the operator has provisioned a minisign
# public key via $MARCO_MINISIGN_PUBKEY, verify the signature over the
# already-fetched checksums.txt. The signature gates the checksum file
# itself — combined with the existing SHA-256 check (AC-21/22), this
# extends end-to-end integrity from "matches mirror" to "matches what
# the release signer produced".
#
# Strictness matches AC-23: soft-warn + continue when ANY precondition
# is missing (pubkey unset, .minisig 404, or `minisign` CLI absent),
# hard-abort (exit 6) only on an actual signature mismatch.
verify_signature() {
    local version="$1"
    local pubkey="${MARCO_MINISIGN_PUBKEY:-}"
    local sig_file="${MARCO_SIGNATURE_FILE:-checksums.txt.minisig}"
    local sig_url="${MARCO_DOWNLOAD_BASE}/${REPO}/releases/download/${version}/${sig_file}"
    local sig_path="${TMP_DIR}/${sig_file}"
    local checksums_path="${TMP_DIR}/checksums.txt"

    if [ -z "${pubkey}" ]; then
        return 0
    fi
    if [ ! -f "${checksums_path}" ]; then
        warn "Signature verification skipped: checksums.txt was not downloaded."
        return 0
    fi
    if ! download "${sig_url}" "${sig_path}" 2>/dev/null; then
        warn "Signature file not found at ${sig_url}"
        warn "Skipping signature verification (release predates v0.3 signing)."
        return 0
    fi
    if ! command -v minisign >/dev/null 2>&1; then
        warn "minisign CLI not found — skipping signature verification."
        warn "Install minisign (https://jedisct1.github.io/minisign/) to enable v0.3 signature checks."
        return 0
    fi

    step "Verifying minisign signature of checksums.txt..."
    if minisign -V -P "${pubkey}" -m "${checksums_path}" -x "${sig_path}" >/dev/null 2>&1; then
        ok "Signature verified (checksums.txt)."
        return 0
    fi

    err "Signature MISMATCH for checksums.txt"
    err "  source: ${sig_url}"
    err "  pubkey: \${MARCO_MINISIGN_PUBKEY} (first 16 chars: ${pubkey:0:16}…)"
    err ""
    err "The release's checksums.txt does not validate against the configured public key."
    err "Refusing to install — possible mirror tampering or wrong key."
    exit 6
}


# ── Install ─────────────────────────────────────────────────────────

install_extension() {
    local archive_path="$1" install_dir="$2" version="$3"

    step "Installing to ${install_dir}..."

    if [ -d "${install_dir}" ]; then
        rm -rf "${install_dir}"
    fi
    mkdir -p "${install_dir}"

    # Spec §2 step 5 / AC-2: main-branch fallback ships a .tar.gz that
    # extracts to <repo>-<branch>/... — a single wrapper directory that
    # we strip so the install dir layout matches a release ZIP.
    case "${archive_path}" in
        *.tar.gz|*.tgz)
            if ! command -v tar >/dev/null 2>&1; then
                err "tar not found — required for main-branch tarball install."
                exit 6
            fi
            # --strip-components=1 collapses the wrapper dir.
            tar -xzf "${archive_path}" -C "${install_dir}" --strip-components=1
            ;;
        *)
            if command -v unzip >/dev/null 2>&1; then
                unzip -qo "${archive_path}" -d "${install_dir}"
            else
                err "unzip not found. Install via apt/brew and retry."
                exit 6
            fi
            ;;
    esac

    local file_count
    file_count="$(find "${install_dir}" -type f | wc -l | tr -d ' ')"
    if [ "${file_count}" -eq 0 ]; then
        err "Extraction produced no files in ${install_dir}"
        exit 6
    fi

    if [ ! -f "${install_dir}/manifest.json" ] && \
       ! find "${install_dir}" -maxdepth 3 -name manifest.json -print -quit | grep -q .; then
        err "manifest.json not found — archive may be corrupted."
        exit 6
    fi

    # On main-branch fallback the "version" string is the sentinel — write
    # a human-meaningful tag instead so downstream tools see something useful.
    local recorded_version="${version}"
    if [ "${version}" = "${MAIN_BRANCH_SENTINEL}" ]; then
        recorded_version="${MAIN_BRANCH}@HEAD"
    fi
    echo "${recorded_version}" > "${install_dir}/VERSION"
    ok "Installed ${file_count} files to ${install_dir}"
}

resolve_install_dir() {
    local dir="$1"
    if [ -n "${dir}" ]; then
        echo "${dir}"
    else
        echo "${HOME}/marco-extension"
    fi
}

# ── Args ────────────────────────────────────────────────────────────

parse_args() {
    VERSION_OVERRIDE=""
    INSTALL_DIR=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --version|-v)                 VERSION_OVERRIDE="$2"; shift 2 ;;
            --dir|-d)                     INSTALL_DIR="$2";      shift 2 ;;
            --repo|-r)                    REPO="$2";             shift 2 ;;
            --dry-run)                    DRY_RUN=1;             shift   ;;
            --no-sibling-discovery)       NO_SIBLING_DISCOVERY=1; shift  ;;
            --enable-sibling-discovery)   ENABLE_SIBLING_DISCOVERY_FLAG=1; shift ;;
            --help|-h)
                cat <<EOF
Usage: install.sh [--version <ver>] [--dir <path>] [--repo <owner/repo>]
                  [--dry-run] [--no-sibling-discovery] [--enable-sibling-discovery]

Unified installer for Marco Chrome Extension.
Conforms to spec/14-update/01-generic-installer-behavior.md.

When run from a GitHub release-page download URL, the version is auto-derived
from that URL (URL-pinned). Otherwise falls back to GitHub 'latest'.

Options:
  --version <ver>             Force a specific version (vX.Y.Z[-pre]) or 'latest'.
  --dir <path>                Target directory (default: ~/marco-extension)
  --repo <o/r>                GitHub owner/repo override
  --dry-run                   Resolve the plan, print it, exit 0 without installing.
  --no-sibling-discovery      Disable §4 sibling-repo probing (overrides config).
  --enable-sibling-discovery  Force-enable §4 sibling-repo probing (overrides config,
                              still blocked in strict mode per spec §4 rule 6).

Configuration:
  Sibling-discovery defaults are read from scripts/install.config.sh (next to
  install.sh) or \$MARCO_INSTALLER_CONFIG. Env vars (SIBLING_DISCOVERY_ENABLED,
  SIBLING_NAME_PATTERN, SIBLING_PROBE_DEPTH, SIBLING_PARALLELISM) override the
  config file. CLI flags above override env vars. Strict mode always wins —
  sibling discovery is unconditionally skipped when the script was URL-pinned
  or invoked with --version <semver>.
EOF
                exit 0
                ;;
            *)
                err "Unknown option: $1"
                err "Run with --help for usage."
                exit 3
                ;;
        esac
    done
}

# ── Sibling-discovery decision (spec §4) ─────────────────────────────
# Resolves whether sibling discovery should run for THIS invocation,
# combining (in priority order, lowest → highest):
#   1. Built-in default (off)
#   2. install.config.sh / env var SIBLING_DISCOVERY_ENABLED
#   3. --enable-sibling-discovery flag
#   4. --no-sibling-discovery flag
#   5. Strict-mode lockout (spec §4 rule 6 — overrides everything)
#
# Sets two globals consumed by the dry-run plan + future probe call:
#   SIBLING_DECISION         off | skipped-strict | skipped-cli | on
#   SIBLING_DECISION_REASON  human-readable explanation
#
# Args: $1 = is_strict (1 if URL-pinned or explicit --version semver, 0 otherwise)
decide_sibling_discovery() {
    local is_strict="$1"
    local enabled="${SIBLING_DISCOVERY_ENABLED:-0}"

    # CLI --enable-sibling-discovery flips the config to on.
    if [ "${ENABLE_SIBLING_DISCOVERY_FLAG}" -eq 1 ]; then
        enabled=1
    fi

    # Spec §4 rule 6 — strict mode unconditionally disables discovery.
    if [ "${is_strict}" -eq 1 ]; then
        if [ "${enabled}" -eq 1 ]; then
            SIBLING_DECISION="skipped-strict"
            SIBLING_DECISION_REASON="enabled by config but locked out by strict mode (spec §4 rule 6)"
        else
            SIBLING_DECISION="off"
            SIBLING_DECISION_REASON="disabled by config; strict mode would have blocked it anyway"
        fi
        return 0
    fi

    # Discovery mode: honor --no-sibling-discovery first.
    if [ "${NO_SIBLING_DISCOVERY}" -eq 1 ]; then
        SIBLING_DECISION="skipped-cli"
        SIBLING_DECISION_REASON="disabled by --no-sibling-discovery"
        return 0
    fi

    if [ "${enabled}" -eq 1 ]; then
        SIBLING_DECISION="on"
        SIBLING_DECISION_REASON="enabled (pattern=${SIBLING_NAME_PATTERN}, depth=${SIBLING_PROBE_DEPTH}, parallelism=${SIBLING_PARALLELISM})"
    else
        SIBLING_DECISION="off"
        SIBLING_DECISION_REASON="disabled by config (set SIBLING_DISCOVERY_ENABLED=1 or pass --enable-sibling-discovery)"
    fi
}

# ── §4 sibling-repo probing ─────────────────────────────────────────
#
# Implements spec/14-update/01-generic-installer-behavior.md §4.2.
# Called only after decide_sibling_discovery() sets SIBLING_DECISION=on.
#
# Strategy:
#   1. Parse the current REPO into ${owner}/${base}, deriving the
#      current sibling integer N from the trailing -v<N> (defaults to 1
#      if no suffix is present).
#   2. Build SIBLING_PROBE_DEPTH candidate names by substituting {N}
#      (and the optional {base} placeholder) in SIBLING_NAME_PATTERN
#      for N+1 .. N+SIBLING_PROBE_DEPTH.
#   3. Issue parallel HEAD probes via `xargs -P SIBLING_PARALLELISM`
#      against ${MARCO_API_BASE}/repos/${owner}/<candidate>. Each child
#      writes one "<repo> <status>" line to a per-job tempfile when it
#      finishes — readers never see partial lines.
#   4. Cap the entire phase at SIBLING_PROBE_TIMEOUT_SECS wall-clock
#      via a background sentinel that SIGTERMs the xargs group on expiry
#      (spec §4 rule 3 — slow host MUST NOT block install).
#   5. Pick the highest-numbered repo that returned 200. 404 = definitive
#      negative (skip silently). 5xx / network error = inconclusive
#      (skip with a note, never retry — spec §4 rules 4 + 5).
#
# Sets SIBLING_SELECTED to "owner/repo" on success, empty otherwise.
# Sibling discovery is best-effort: any internal failure here MUST NOT
# abort the install — the caller falls through to the resolved version.
SIBLING_SELECTED=""

probe_versioned_siblings() {
    SIBLING_SELECTED=""
    local owner base current_v
    if ! parse_repo_for_siblings "${REPO}"; then
        return 0
    fi
    owner="${__SIB_OWNER}"
    base="${__SIB_BASE}"
    current_v="${__SIB_CURRENT_V}"

    if ! command -v curl >/dev/null 2>&1; then
        return 0    # HEAD probe needs curl; no-op rather than fail
    fi

    local probe_dir
    probe_dir="$(mktemp -d -t marco-sibling.XXXXXX)" || return 0
    local results_file="${probe_dir}/results"
    : > "${results_file}"

    run_sibling_probe_batch "${owner}" "${base}" "${current_v}" "${results_file}" "${probe_dir}"
    pick_highest_sibling "${owner}" "${results_file}"
    rm -rf "${probe_dir}" 2>/dev/null || true
}

# Splits ${REPO} = owner/name into owner + base + current N.
# Recognises a trailing "-v<N>" / "_v<N>" / "v<N>" suffix; absent → N=1.
# Sets globals __SIB_OWNER, __SIB_BASE, __SIB_CURRENT_V on success.
parse_repo_for_siblings() {
    local repo="$1"
    case "${repo}" in
        */*) __SIB_OWNER="${repo%%/*}"; local name="${repo#*/}" ;;
        *) return 1 ;;
    esac
    if [[ "${name}" =~ ^(.+)[-_]v([0-9]+)$ ]]; then
        __SIB_BASE="${BASH_REMATCH[1]}"
        __SIB_CURRENT_V="${BASH_REMATCH[2]}"
    elif [[ "${name}" =~ ^(.+)v([0-9]+)$ ]]; then
        __SIB_BASE="${BASH_REMATCH[1]}"
        __SIB_CURRENT_V="${BASH_REMATCH[2]}"
    else
        __SIB_BASE="${name}"
        __SIB_CURRENT_V=1
    fi
    return 0
}

# Substitutes {N} (and optional {base}) into SIBLING_NAME_PATTERN.
sibling_candidate_name() {
    local base="$1" n="$2" out="${SIBLING_NAME_PATTERN}"
    out="${out//\{N\}/${n}}"
    out="${out//\{base\}/${base}}"
    echo "${out}"
}

# Fans out parallel HEAD requests via xargs -P, capped by a wall-clock
# sentinel. Children write atomic single-line "<repo> <status>" records.
run_sibling_probe_batch() {
    local owner="$1" base="$2" current_v="$3" results_file="$4" probe_dir="$5"
    local i candidate
    local listfile="${probe_dir}/candidates"
    : > "${listfile}"
    for ((i = 1; i <= SIBLING_PROBE_DEPTH; i++)); do
        candidate="$(sibling_candidate_name "${base}" "$((current_v + i))")"
        printf '%s\n' "${candidate}" >> "${listfile}"
    done

    export MARCO_API_BASE results_file owner
    # Background sentinel terminates the xargs group if total elapsed
    # exceeds SIBLING_PROBE_TIMEOUT_SECS — guarantees spec §4 rule 3.
    ( sleep "${SIBLING_PROBE_TIMEOUT_SECS}"; pkill -P $$ -f 'sibling-probe-one' 2>/dev/null || true ) &
    local watchdog=$!
    # Each xargs child is a self-contained `bash -c` that does ONE
    # curl HEAD probe and appends "<repo> <status>" atomically. Inlining
    # the body avoids the bash function-export quirk where `bash -c`
    # children don't inherit functions reliably across all distros.
    xargs -P "${SIBLING_PARALLELISM}" -I {} -a "${listfile}" \
        bash -c '
            # marker tag for the watchdog pkill -f match: sibling-probe-one
            candidate="$1"
            status="$(curl -fsS -o /dev/null -w "%{http_code}" --max-time 4 \
                -I "${MARCO_API_BASE}/repos/${owner}/${candidate}" 2>/dev/null || echo 000)"
            printf "%s %s\n" "${candidate}" "${status}" >> "${results_file}"
        ' sibling-probe-one {} 2>/dev/null || true
    kill "${watchdog}" 2>/dev/null || true
    wait "${watchdog}" 2>/dev/null || true
    unset MARCO_API_BASE results_file owner
}

# (Inlined into run_sibling_probe_batch — kept here for reference + tests.)
sibling_probe_one_inline() {
    local candidate="$1"
    local status
    status="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 4 \
        -I "${MARCO_API_BASE}/repos/${owner}/${candidate}" 2>/dev/null || echo 000)"
    printf '%s %s\n' "${candidate}" "${status}" >> "${results_file}"
}

# Picks the highest-numbered candidate that responded 200. 404 = skip,
# anything else (5xx, 000 = network/timeout) = inconclusive, also skip.
pick_highest_sibling() {
    local owner="$1" results_file="$2"
    [ -s "${results_file}" ] || return 0
    local best="" best_n=0 line repo status n
    while read -r repo status; do
        [ "${status}" = "200" ] || continue
        if [[ "${repo}" =~ v([0-9]+)$ ]]; then
            n="${BASH_REMATCH[1]}"
            if [ "${n}" -gt "${best_n}" ]; then
                best_n="${n}"
                best="${repo}"
            fi
        fi
    done < "${results_file}"
    if [ -n "${best}" ]; then
        SIBLING_SELECTED="${owner}/${best}"
        warn "🔭 Newer sibling repo detected: ${SIBLING_SELECTED}"
        warn "   Continuing install of ${REPO} — re-run with --repo ${SIBLING_SELECTED} to switch."
        warn "   Pass --no-sibling-discovery to suppress this probe."
    fi
}

# ── Summary ─────────────────────────────────────────────────────────

print_install_summary() {
    local version="$1" install_dir="$2"
    local pin_note=""
    if [ "${URL_PINNED}" -eq 1 ]; then
        pin_note=" (pinned via release URL)"
    fi
    echo ""
    step "Install summary"
    printf '  Version:     %s%s\n' "${version}" "${pin_note}" >&2
    printf '  Install dir: %s\n' "${install_dir}" >&2
    echo ""
    echo "  ----------------------------------------------------------"
    echo "  To load in Chrome / Edge / Brave:"
    echo ""
    echo "  1. Open chrome://extensions (or edge://extensions)"
    echo "  2. Enable 'Developer mode' (toggle in top-right)"
    echo "  3. Click 'Load unpacked'"
    echo "  4. Select: ${install_dir}"
    echo "  ----------------------------------------------------------"
    echo ""
    if [ "${URL_PINNED}" -eq 1 ]; then
        warn "URL-pinned install — re-running this exact one-liner reinstalls ${version}."
        printf '  \033[90mFor auto-update, use install.sh from raw.githubusercontent.com/.../main/.\033[0m\n'
    else
        printf '  \033[90mTo update later, re-run this script \xe2\x80\x94 it replaces the folder.\033[0m\n'
    fi
}

# ── Main ────────────────────────────────────────────────────────────

main() {
    echo ""
    echo " Marco Extension installer"
    printf ' \033[90mgithub.com/%s\033[0m\n' "${REPO}"
    echo ""

    parse_args "$@"
    detect_os

    local version install_dir archive_path
    # NOTE: resolve_version runs in a $(…) subshell, so any URL_PINNED=1 it
    # sets is lost on return. Re-probe version_from_url here so the strict-
    # vs-discovery banner — and the "(pinned via release URL)" summary tag —
    # reflect the URL pin in the parent shell. Spec §2.1.
    if [ -z "${VERSION_OVERRIDE}" ] && version_from_url >/dev/null 2>&1; then
        URL_PINNED=1
    fi
    version="$(resolve_version "${VERSION_OVERRIDE}")"
    install_dir="$(resolve_install_dir "${INSTALL_DIR}")"

    # Per spec §2.1 / §2.2 — banner identifying mode + version on first line.
    # Strict mode = URL-pinned OR explicit semver --version (NOT 'latest').
    # Main-branch fallback (AC-2) gets its own 🌿 banner.
    local mode_banner
    local is_explicit_pin=0
    if [ -n "${VERSION_OVERRIDE}" ] && [ "${VERSION_OVERRIDE}" != "latest" ]; then
        is_explicit_pin=1
    fi
    if [ "${version}" = "${MAIN_BRANCH_SENTINEL}" ]; then
        MAIN_FALLBACK=1
        mode_banner="🌿 Discovery mode — main branch (no releases found)"
    elif [ "${URL_PINNED}" -eq 1 ] || [ "${is_explicit_pin}" -eq 1 ]; then
        mode_banner="🔒 Strict mode — pinned to ${version}"
    else
        mode_banner="🌊 Discovery mode — resolved ${version}"
    fi
    step "${mode_banner}"

    # Per spec §4 — resolve sibling-discovery decision now that we know
    # whether this invocation is strict (so rule 6 can lock it out).
    local is_strict=0
    if [ "${URL_PINNED}" -eq 1 ] || [ "${is_explicit_pin}" -eq 1 ]; then
        is_strict=1
    fi
    decide_sibling_discovery "${is_strict}"

    # Per spec §5 — --dry-run prints the plan and exits 0 without installing.
    if [ "${DRY_RUN}" -eq 1 ]; then
        echo ""
        step "Dry run — plan:"
        printf '  Version:     %s\n' "${version}"
        printf '  Install dir: %s\n' "${install_dir}"
        printf '  Repo:        %s\n' "${REPO}"
        printf '  Sibling discovery: %s — %s\n' "${SIBLING_DECISION}" "${SIBLING_DECISION_REASON}"
        echo ""
        ok "Dry run complete — nothing installed."
        exit 0
    fi

    # Per spec §4 — actual sibling probing runs only when decision=on
    # and we're not in a dry-run. Best-effort; never aborts the install.
    if [ "${SIBLING_DECISION}" = "on" ]; then
        probe_versioned_siblings || true
    fi

    TMP_DIR="$(mktemp -d)"
    archive_path="$(download_asset "${version}")"
    install_extension "${archive_path}" "${install_dir}" "${version}"

    print_install_summary "${version}" "${install_dir}"

    echo ""
    ok "Done!"
    echo ""
}

# Test-mode guard (per tests/installer/resolver.test.sh):
#   When MARCO_INSTALLER_TEST_MODE=1, this script can be sourced to expose its
#   functions without auto-running main(). Tests rely on this to exercise
#   resolve_version / parse_args / is_valid_version in isolation.
if [ "${MARCO_INSTALLER_TEST_MODE:-0}" != "1" ]; then
    main "$@"
fi
