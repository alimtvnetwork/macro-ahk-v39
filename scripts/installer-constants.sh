#!/usr/bin/env bash
# AUTO-GENERATED — DO NOT EDIT BY HAND
# Source: scripts/installer-contract.json
# Regenerate: node scripts/generate-installer-constants.mjs
# Schema: 1.0.0

# Defaults — env vars override; set only when not already set so that
# install.sh's parameter expansion ${VAR:-fallback} keeps working.

MARCO_DEFAULT_REPO="alimtvnetwork/macro-ahk-v33"
MARCO_VERSION_REGEX='^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$'
MARCO_MAIN_BRANCH_SENTINEL="__MAIN_BRANCH__"

# Endpoints
: "${MARCO_API_BASE:=https://api.github.com}"
: "${MARCO_DOWNLOAD_BASE:=https://github.com}"
: "${MARCO_MAIN_BRANCH:=main}"

# Exit codes (read-only)
readonly MARCO_EXIT_OK=0  # §8.1: Successful install or successful --dry-run.
readonly MARCO_EXIT_PREFLIGHT=1  # §8.1: Bash/PowerShell missing, unreadable script, etc.
readonly MARCO_EXIT_BAD_VERSION_ARG=3  # §8.1: --version / -Version did not match the semver regex or 'latest'.
readonly MARCO_EXIT_MISSING_ARTIFACT=4  # §8.1: Strict mode: the requested release exists but the asset (zip) is not attached.
readonly MARCO_EXIT_NETWORK_OR_TOOLING=5  # §8.1: API unreachable, curl/Invoke-WebRequest failed, or required tooling missing.
readonly MARCO_EXIT_INVALID_ARCHIVE=6  # §8.1: Checksum mismatch, corrupt zip/tar, or unzip failure.

# Checksums
MARCO_CHECKSUMS_FILE="checksums.txt"
MARCO_CHECKSUMS_ALGO="SHA-256"

# Signing (v0.3, opt-in)
MARCO_SIGNATURE_FILE="checksums.txt.minisig"
: "${MARCO_MINISIGN_PUBKEY:=}"

