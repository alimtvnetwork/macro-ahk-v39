<#
.SYNOPSIS
  Unified installer for Marco Chrome Extension.

.DESCRIPTION
  Conforms to the Generic Installer Behavior specification:
  spec/14-update/01-generic-installer-behavior.md (resolution waterfall,
  versioned-repo discovery, fail-fast policy, exit codes). Any change to
  the resolution order, repo-discovery rules, or user-visible messages
  here MUST be mirrored in that spec — the spec is the contract that
  other repositories' installers (quick-install, release-install,
  error-manage, etc.) follow.

  Single installer script — the version is auto-derived from the script's
  source URL when downloaded from a GitHub release page (so each release-page
  one-liner is implicitly pinned to that exact version). When run from
  `raw.githubusercontent.com/.../main/` (or from a clone), it falls back to
  resolving the GitHub `latest` release.

  Resolution order:
    1. Explicit -Version override (must match v<major>.<minor>.<patch>[-pre]).
    2. URL parsed from $MyInvocation / $PSCommandPath / $env:MARCO_INSTALLER_URL
       — matching `/releases/download/(vX.Y.Z)/`.
    3. GitHub Releases API → `latest`.

.PARAMETER Version
  Override the resolved version. Must match v<major>.<minor>.<patch>[-pre].
  Pass `latest` to force the API fallback even when a URL pin is present.

.PARAMETER InstallDir
  Target directory. Default: $HOME\marco-extension

.PARAMETER Repo
  GitHub owner/repo. Default: alimtvnetwork/macro-ahk-v34

.EXAMPLE
  # From a release page — installs that exact release (URL-pinned):
  irm https://github.com/alimtvnetwork/macro-ahk-v34/releases/download/v2.158.0/install.ps1 | iex

.EXAMPLE
  # From main — installs the latest release:
  irm https://raw.githubusercontent.com/alimtvnetwork/macro-ahk-v34/main/scripts/install.ps1 | iex

.EXAMPLE
  & ./install.ps1 -Version v2.150.0
#>

param(
    [string]$Version = "",
    [string]$InstallDir = "",
    [string]$Repo = "",   # empty => fall back to shared-contract default below
    [switch]$DryRun,
    [switch]$NoSiblingDiscovery,
    [switch]$EnableSiblingDiscovery,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ── Shared installer contract (spec/14-update/01-…) ─────────────────
# scripts/installer-constants.ps1 is generated from
# scripts/installer-contract.json. When present beside this script it
# provides $script:MarcoDefaultRepo, $script:MarcoVersionRegex,
# $script:MarcoMainBranchSentinel, $script:MarcoExit*, the endpoint
# defaults, and the checksums settings. When absent (irm-piped standalone
# install) the inline fallbacks below take over so install.ps1 remains a
# single self-sufficient file.
# NOTE: $PSScriptRoot is empty when this script is piped through
# `irm <url> | iex` (no file on disk). Join-Path rejects an empty
# -Path with "Cannot bind argument to parameter 'Path' because it is
# an empty string", which is exactly the crash users hit when running
# the canonical one-liner. Guard every $PSScriptRoot use here.
$__constCandidate = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'installer-constants.ps1' } else { $null }
if ($__constCandidate -and (Test-Path -LiteralPath $__constCandidate)) {
    . $__constCandidate
}
Remove-Variable __constCandidate -ErrorAction SilentlyContinue

if (-not $script:MarcoDefaultRepo)        { $script:MarcoDefaultRepo        = 'alimtvnetwork/macro-ahk-v34' }
if (-not $script:MarcoVersionRegex)       { $script:MarcoVersionRegex       = '^v\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$' }
if (-not $script:MarcoMainBranchSentinel) { $script:MarcoMainBranchSentinel = '__MAIN_BRANCH__' }
if (-not $script:MarcoMainBranch)         { $script:MarcoMainBranch         = if ($env:MARCO_MAIN_BRANCH) { $env:MARCO_MAIN_BRANCH } else { 'main' } }

if ([string]::IsNullOrEmpty($Repo)) { $Repo = $script:MarcoDefaultRepo }

$script:VersionRegex = $script:MarcoVersionRegex

# ── Test-mode endpoint overrides (mirror of install.sh) ──────────────
# installer-constants.ps1 already seeds $env:MARCO_API_BASE etc. when
# they are unset; these locals just expose them under script-scoped
# names for the rest of the file.
$script:ApiBase      = if ($env:MARCO_API_BASE)      { $env:MARCO_API_BASE }      else { 'https://api.github.com' }
$script:DownloadBase = if ($env:MARCO_DOWNLOAD_BASE) { $env:MARCO_DOWNLOAD_BASE } else { 'https://github.com' }

# ── Sibling-discovery defaults (spec §4) ─────────────────────────────
# In-script fallbacks used when scripts/install.config.ps1 is absent
# (e.g. install.ps1 downloaded standalone via irm). Config file wins,
# env vars win over both, CLI flags win over everything, strict-mode
# lockout wins over CLI (spec §4 rule 6).
$script:SiblingDiscoveryEnabled   = if ($env:SIBLING_DISCOVERY_ENABLED)   { $env:SIBLING_DISCOVERY_ENABLED }   else { '0' }
$script:SiblingNamePattern        = if ($env:SIBLING_NAME_PATTERN)        { $env:SIBLING_NAME_PATTERN }        else { 'macro-ahk-v{N}' }
$script:SiblingProbeDepth         = if ($env:SIBLING_PROBE_DEPTH)         { [int]$env:SIBLING_PROBE_DEPTH }    else { 20 }
$script:SiblingParallelism        = if ($env:SIBLING_PARALLELISM)         { [int]$env:SIBLING_PARALLELISM }    else { 8 }
$script:SiblingProbeTimeoutSecs   = if ($env:SIBLING_PROBE_TIMEOUT_SECS)  { [int]$env:SIBLING_PROBE_TIMEOUT_SECS } else { 5 }
$script:SiblingDecision           = 'off'
$script:SiblingDecisionReason     = ''
$script:SiblingSelected           = ''

# Source the optional config file beside this script. Lookup order:
#   $env:MARCO_INSTALLER_CONFIG (explicit) → next to install.ps1.
$__cfgCandidate = if ($env:MARCO_INSTALLER_CONFIG) {
    $env:MARCO_INSTALLER_CONFIG
} elseif ($PSScriptRoot) {
    Join-Path $PSScriptRoot 'install.config.ps1'
} else {
    $null
}
if ($__cfgCandidate -and (Test-Path -LiteralPath $__cfgCandidate)) {
    . $__cfgCandidate
}
Remove-Variable __cfgCandidate -ErrorAction SilentlyContinue

# --- Logging helpers ---

function Write-Step([string]$msg) { Write-Host " $msg" -ForegroundColor Cyan }
function Write-OK   ([string]$msg) { Write-Host " $msg" -ForegroundColor Green }
function Write-Warn ([string]$msg) { Write-Host " $msg" -ForegroundColor Yellow }
function Write-Err  ([string]$msg) { Write-Host " $msg" -ForegroundColor Red }
# Informational notice — used for non-fatal deferred-work messages
# (e.g. Windows sharing/lock cleanup that's been queued for reboot).
# Distinct from Write-Warn so users don't read it as a problem with the install.
function Write-Note ([string]$msg) { Write-Host " $msg" -ForegroundColor DarkCyan }

# --- Version resolution ---

function Test-VersionFormat([string]$v) {
    return $v -match $script:VersionRegex
}

function Get-VersionFromUrl {
    $candidates = @(
        $MyInvocation.MyCommand.Path,
        $PSCommandPath,
        $env:MARCO_INSTALLER_URL
    ) | Where-Object { $_ }

    foreach ($c in $candidates) {
        if ($c -match '/releases/download/(v\d+\.\d+\.\d+[^/]*)/') {
            return $matches[1]
        }
    }
    return $null
}

function Get-LatestVersion {
    Write-Step "Resolving latest release from $Repo (via $script:ApiBase)..."
    $url = "$script:ApiBase/repos/$Repo/releases/latest"

    # Two-stage probe (mirrors install.sh fetch_latest_version, spec §2 step 5 / AC-2):
    #   - 200 OK + tag_name           → return tag
    #   - 200 OK + missing tag_name   → return MainBranchSentinel
    #   - 404 (no releases at all)    → return MainBranchSentinel
    #   - 5xx / network failures      → exit 5
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -ErrorAction Stop
        $body = $null
        try { $body = $response.Content | ConvertFrom-Json -ErrorAction Stop } catch { $body = $null }
        if ($null -ne $body -and $body.PSObject.Properties['tag_name'] -and -not [string]::IsNullOrEmpty($body.tag_name)) {
            return $body.tag_name
        }
        # 200 OK + no tag → zero releases. Spec §2 step 5 / AC-2.
        $script:MainFallback = $true
        return $script:MarcoMainBranchSentinel
    }
    catch {
        $statusCode = $null
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
            try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = $null }
        }
        if ($statusCode -eq 404) {
            # 404 = "no published releases" per GitHub API. AC-2 fallback.
            $script:MainFallback = $true
            return $script:MarcoMainBranchSentinel
        }
        Write-Err "Failed to fetch latest release: $_"
        Write-Err "Spec §2.3: discovery-mode API failure exits 5."
        exit 5
    }
}

function Resolve-Version([string]$override) {
    # 1. Explicit override
    if ($override -ne "") {
        if ($override -ieq "latest") {
            return Get-LatestVersion
        }
        if (-not (Test-VersionFormat $override)) {
            Write-Err "Invalid -Version '$override'. Must match v<major>.<minor>.<patch>[-prerelease] or 'latest'."
            exit 3
        }
        return $override
    }

    # 2. URL-derived pin (release-page download)
    $fromUrl = Get-VersionFromUrl
    if ($fromUrl -and (Test-VersionFormat $fromUrl)) {
        Write-Step "Pinned to $fromUrl (derived from download URL)."
        return $fromUrl
    }

    # 3. Fallback: latest release via API
    return Get-LatestVersion
}

# --- Sibling-discovery decision (mirror of install.sh) -----------------
#
# Resolves whether sibling discovery should run for THIS invocation,
# combining (lowest → highest priority):
#   1. Built-in default (off)
#   2. install.config.ps1 / env $script:SiblingDiscoveryEnabled
#   3. -EnableSiblingDiscovery flag
#   4. -NoSiblingDiscovery flag
#   5. Strict-mode lockout (spec §4 rule 6 — overrides everything)
#
# Sets two script-scope globals consumed by the dry-run plan + Main:
#   $script:SiblingDecision        off | skipped-strict | skipped-cli | on
#   $script:SiblingDecisionReason  human-readable explanation
function Decide-SiblingDiscovery([bool]$isStrict) {
    $enabled = $script:SiblingDiscoveryEnabled -eq '1'
    if ($EnableSiblingDiscovery) { $enabled = $true }

    if ($isStrict) {
        if ($enabled) {
            $script:SiblingDecision = 'skipped-strict'
            $script:SiblingDecisionReason = 'enabled by config but locked out by strict mode (spec §4 rule 6)'
        } else {
            $script:SiblingDecision = 'off'
            $script:SiblingDecisionReason = 'disabled by config; strict mode would have blocked it anyway'
        }
        return
    }
    if ($NoSiblingDiscovery) {
        $script:SiblingDecision = 'skipped-cli'
        $script:SiblingDecisionReason = 'disabled by -NoSiblingDiscovery'
        return
    }
    if ($enabled) {
        $script:SiblingDecision = 'on'
        $script:SiblingDecisionReason = "enabled (pattern=$script:SiblingNamePattern, depth=$script:SiblingProbeDepth, parallelism=$script:SiblingParallelism)"
    } else {
        $script:SiblingDecision = 'off'
        $script:SiblingDecisionReason = 'disabled by config (set $env:SIBLING_DISCOVERY_ENABLED=1 or pass -EnableSiblingDiscovery)'
    }
}

# Splits "owner/name[-_]?v<N>" → owner / base / current N (defaults 1).
function Get-SiblingRepoParts([string]$repoName) {
    if ($repoName -notmatch '^([^/]+)/(.+)$') { return $null }
    $owner = $matches[1]
    $name  = $matches[2]
    if ($name -match '^(.+)[-_]v(\d+)$') {
        return @{ Owner = $owner; Base = $matches[1]; CurrentV = [int]$matches[2] }
    }
    if ($name -match '^(.+)v(\d+)$') {
        return @{ Owner = $owner; Base = $matches[1]; CurrentV = [int]$matches[2] }
    }
    return @{ Owner = $owner; Base = $name; CurrentV = 1 }
}

# Substitutes {N} (and optional {base}) into the configured pattern.
function Resolve-SiblingCandidateName([string]$base, [int]$n) {
    $out = $script:SiblingNamePattern
    $out = $out.Replace('{N}', "$n").Replace('{base}', $base)
    return $out
}

# --- §4 sibling-repo probing (PowerShell mirror) ----------------------
#
# Implements spec §4.2:
#   1. Parse current repo into owner/base + integer N.
#   2. Build $script:SiblingProbeDepth candidate names.
#   3. Issue parallel HEAD probes via Start-ThreadJob (PS 7+) or
#      sequential when ThreadJob is unavailable (PS 5.1 fallback).
#   4. Cap entire phase at $script:SiblingProbeTimeoutSecs wall-clock.
#   5. Pick highest-numbered candidate returning 200. 404 = skip,
#      anything else = inconclusive (skip, never retry).
# Best-effort: any failure here MUST NOT abort the install.
function Probe-VersionedSiblings {
    $script:SiblingSelected = ''
    $parts = Get-SiblingRepoParts $Repo
    if (-not $parts) { return }

    $candidates = @()
    for ($i = 1; $i -le $script:SiblingProbeDepth; $i++) {
        $candidates += Resolve-SiblingCandidateName $parts.Base ($parts.CurrentV + $i)
    }

    $hasThreadJob = (Get-Command Start-ThreadJob -ErrorAction SilentlyContinue) -ne $null
    $apiBase  = $script:ApiBase
    $owner    = $parts.Owner
    $timeout  = $script:SiblingProbeTimeoutSecs
    $maxPar   = $script:SiblingParallelism

    $results = @{}
    if ($hasThreadJob) {
        $jobs = @()
        foreach ($c in $candidates) {
            $jobs += Start-ThreadJob -ThrottleLimit $maxPar -ScriptBlock {
                param($u, $name)
                try {
                    $resp = Invoke-WebRequest -Uri $u -Method Head -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
                    [pscustomobject]@{ Name = $name; Status = [int]$resp.StatusCode }
                } catch {
                    $code = 0
                    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
                    [pscustomobject]@{ Name = $name; Status = $code }
                }
            } -ArgumentList "$apiBase/repos/$owner/$c", $c
        }
        Wait-Job -Job $jobs -Timeout $timeout | Out-Null
        foreach ($j in $jobs) {
            if ($j.State -eq 'Completed') {
                $r = Receive-Job -Job $j
                if ($r) { $results[$r.Name] = $r.Status }
            }
            Remove-Job -Job $j -Force -ErrorAction SilentlyContinue
        }
    } else {
        $deadline = (Get-Date).AddSeconds($timeout)
        foreach ($c in $candidates) {
            if ((Get-Date) -ge $deadline) { break }
            try {
                $resp = Invoke-WebRequest -Uri "$apiBase/repos/$owner/$c" -Method Head -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
                $results[$c] = [int]$resp.StatusCode
            } catch {
                if ($_.Exception.Response) { $results[$c] = [int]$_.Exception.Response.StatusCode } else { $results[$c] = 0 }
            }
        }
    }

    $best = $null; $bestN = 0
    foreach ($name in $results.Keys) {
        if ($results[$name] -ne 200) { continue }
        if ($name -match 'v(\d+)$') {
            $n = [int]$matches[1]
            if ($n -gt $bestN) { $bestN = $n; $best = $name }
        }
    }
    if ($best) {
        $script:SiblingSelected = "$owner/$best"
        Write-Warn "🔭 Newer sibling repo detected: $script:SiblingSelected"
        Write-Warn "   Continuing install of $Repo — re-run with -Repo $script:SiblingSelected to switch."
        Write-Warn "   Pass -NoSiblingDiscovery to suppress this probe."
    }
}

function Show-Help {
    @"
Usage: install.ps1 [-Version <ver>] [-InstallDir <path>] [-Repo <owner/repo>]
                   [-DryRun] [-NoSiblingDiscovery] [-EnableSiblingDiscovery]
                   [-Help]

Unified installer for Marco Chrome Extension.
Conforms to spec/14-update/01-generic-installer-behavior.md.

Options:
  -Version <ver>             Force vX.Y.Z[-pre] or 'latest'.
  -InstallDir <path>         Target directory (default: \$HOME\marco-extension).
  -Repo <o/r>                GitHub owner/repo override.
  -DryRun                    Resolve plan, print, exit 0 without installing.
  -NoSiblingDiscovery        Disable §4 sibling-repo probing (overrides config).
  -EnableSiblingDiscovery    Force-enable §4 sibling-repo probing (overrides
                             config; still blocked in strict mode per §4 rule 6).
  -Help                      Show this help and exit.

Configuration: scripts/install.config.ps1 (next to install.ps1) or
\$env:MARCO_INSTALLER_CONFIG. Env vars override the config file. CLI flags
override env vars. Strict mode always wins.
"@
}


function Resolve-InstallDir([string]$dir) {
    if ($dir -ne "") { return $dir }
    return Join-Path $HOME "marco-extension"
}

# --- Updater run identity (scopes every artifact this run creates) ---
#
# Every invocation of Main generates a unique RunId stamped into every
# temp dir, rotated path, and marker file we create. The cleanup sweeps
# use these stamps (plus a fixed JSON schema marker) to identify which
# files were created by *this updater* — never touching random `.old`
# files, third-party leftovers, or unrelated `delete-pending-*` paths
# that other tools might have written.
#
# Canonical artifact name patterns (this is the contract between create
# and sweep — keep in sync with Test-IsMarcoArtifact and the test suite):
#
#   Temp download dirs : marco-install-<runId>
#   Rotated install dir: .<leaf>.delete-pending-<runId>
#   Marker JSON files  : %LOCALAPPDATA%\Marco\pending-deletes\<rand>.txt
#                        with body { Schema: "marco-deferred-delete/v1",
#                                    OwnerSignature: "marco-installer", ... }
#
# RunId format: marco-<yyyyMMddHHmmss>-<6-char-rand>
$script:MarcoRunId = "marco-$((Get-Date).ToString('yyyyMMddHHmmss'))-$([guid]::NewGuid().ToString('N').Substring(0,6))"
$script:MarcoMarkerSchema = 'marco-deferred-delete/v1'
$script:MarcoOwnerSignature = 'marco-installer'

# --- Download ---

function Get-Asset([string]$version) {
    # Spec §2 step 5 / AC-2: when Get-LatestVersion returned the
    # main-branch sentinel, switch to the source tarball off the default
    # branch instead of a release ZIP. Discovery mode only.
    if ($version -eq $script:MarcoMainBranchSentinel) {
        return Get-MainBranchTarball
    }

    $assetName = "marco-extension-${version}.zip"
    $assetUrl = "$script:DownloadBase/$Repo/releases/download/$version/$assetName"

    # RunId-stamped temp dir — Find-MarcoUpdaterArtifacts can recognise
    # and reclaim this exact path if a future run finds it stranded
    # (e.g. previous run crashed mid-install before cleanup).
    $tmpDir = Join-Path $env:TEMP "marco-install-$script:MarcoRunId"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    $zipPath = Join-Path $tmpDir $assetName

    Write-Step "Downloading $assetName..."

    try {
        Invoke-WebRequest -Uri $assetUrl -OutFile $zipPath -UseBasicParsing
    }
    catch {
        Write-Err "Download failed: $_"
        Write-Err "URL: $assetUrl"
        Write-Err ""
        Write-Err "Release $version may have been retracted or the asset is missing."
        Remove-PathSafely -Path $tmpDir -Reason "failed-download cleanup" | Out-Null
        exit 4
    }

    Write-OK "Downloaded successfully."
    Test-Checksum -Version $version -AssetName $assetName -ZipPath $zipPath -TmpDir $tmpDir
    Test-Signature -Version $version -TmpDir $tmpDir
    return @{ ZipPath = $zipPath; TmpDir = $tmpDir }
}

# Fetch the source tarball from the configured main branch. Spec §2
# step 5 / AC-2 fallback when the release host is reachable but reports
# zero releases. NOT subject to checksums.txt (the file lives in
# releases, not in branches), and NOT subject to exit 4 — a missing main
# branch is a network/tooling problem and exits 5 (spec §2.3).
function Get-MainBranchTarball {
    $branch = $script:MarcoMainBranch
    $repoLeaf = ($Repo -split '/')[-1]
    $archiveName = "$repoLeaf-$branch.tar.gz"
    $archiveUrl  = "$script:DownloadBase/$Repo/archive/refs/heads/$branch.tar.gz"

    $tmpDir = Join-Path $env:TEMP "marco-install-$script:MarcoRunId"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    $archivePath = Join-Path $tmpDir $archiveName

    Write-Step "Downloading main-branch tarball ($branch)..."
    try {
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
    }
    catch {
        Write-Err "Main-branch tarball download failed: $_"
        Write-Err "URL: $archiveUrl"
        Write-Err ""
        Write-Err "Spec §2.3: discovery-mode network failure exits 5."
        Remove-PathSafely -Path $tmpDir -Reason "failed-mainbranch-download cleanup" | Out-Null
        exit 5
    }

    Write-OK "Downloaded successfully."
    return @{ ZipPath = $archivePath; TmpDir = $tmpDir }
}

# --- Checksum verification (spec/14-update §7.1, §8 rule 2) ---
#
# Mirrors install.sh's verify_checksum: fetches checksums.txt from the
# same release, finds the line for $AssetName, compares its SHA-256 to
# Get-FileHash on the local archive.
#   - Match    → continue.
#   - Mismatch → exit 6.
#   - Missing  → soft-warn, continue (back-compat with pre-v0.2 releases).
function Test-Checksum {
    param(
        [string]$Version,
        [string]$AssetName,
        [string]$ZipPath,
        [string]$TmpDir
    )

    $checksumsUrl = "$script:DownloadBase/$Repo/releases/download/$Version/checksums.txt"
    $checksumsPath = Join-Path $TmpDir "checksums.txt"

    Write-Step "Verifying SHA-256 of $AssetName..."

    try {
        Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsPath -UseBasicParsing -ErrorAction Stop
    }
    catch {
        Write-Warn "checksums.txt not found at $checksumsUrl"
        Write-Warn "Skipping checksum verification (older release predating v0.2 hardening)."
        return
    }

    $expected = $null
    foreach ($line in Get-Content -LiteralPath $checksumsPath) {
        # sha256sum format: "<hex>  <name>" or "<hex>  *<name>" (binary mode)
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$' -and $matches[2] -eq $AssetName) {
            $expected = $matches[1].ToLowerInvariant()
            break
        }
    }
    if (-not $expected) {
        Write-Warn "checksums.txt does not list $AssetName — skipping verification."
        return
    }

    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath).Hash.ToLowerInvariant()

    if ($expected -eq $actual) {
        Write-OK "Checksum verified ($AssetName)."
        return
    }

    Write-Err "Checksum MISMATCH for $AssetName"
    Write-Err "  expected: $expected"
    Write-Err "  actual:   $actual"
    Write-Err "  source:   $checksumsUrl"
    Write-Err ""
    Write-Err "The downloaded archive does not match the published SHA-256."
    Write-Err "Refusing to install — possible mirror tampering or corruption."
    Remove-PathSafely -Path $TmpDir -Reason "checksum-mismatch cleanup" | Out-Null
    exit 6
}


# --- Signature verification (spec §7.1.5, AC-24/25/26) ---
#
# Optional v0.3 hardening mirror of install.sh verify_signature. Verifies
# checksums.txt against checksums.txt.minisig using the minisign CLI and
# the public key in $env:MARCO_MINISIGN_PUBKEY. Soft-skips when any
# precondition is missing (matches AC-23 / Test-Checksum policy);
# hard-aborts (exit 6) only on an actual signature mismatch.
function Test-Signature {
    param(
        [string]$Version,
        [string]$TmpDir
    )

    $pubkey = $env:MARCO_MINISIGN_PUBKEY
    if ([string]::IsNullOrEmpty($pubkey)) {
        return
    }

    $sigFile = if ($script:MarcoSignatureFile) { $script:MarcoSignatureFile } else { 'checksums.txt.minisig' }
    $checksumsPath = Join-Path $TmpDir 'checksums.txt'
    if (-not (Test-Path -LiteralPath $checksumsPath)) {
        Write-Warn "Signature verification skipped: checksums.txt was not downloaded."
        return
    }

    $sigUrl = "$script:DownloadBase/$Repo/releases/download/$Version/$sigFile"
    $sigPath = Join-Path $TmpDir $sigFile
    try {
        Invoke-WebRequest -Uri $sigUrl -OutFile $sigPath -UseBasicParsing -ErrorAction Stop
    }
    catch {
        Write-Warn "Signature file not found at $sigUrl"
        Write-Warn "Skipping signature verification (release predates v0.3 signing)."
        return
    }

    $minisign = Get-Command minisign -ErrorAction SilentlyContinue
    if (-not $minisign) {
        Write-Warn "minisign CLI not found — skipping signature verification."
        Write-Warn "Install minisign (https://jedisct1.github.io/minisign/) to enable v0.3 signature checks."
        return
    }

    Write-Step "Verifying minisign signature of checksums.txt..."
    & $minisign.Source -V -P $pubkey -m $checksumsPath -x $sigPath *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Signature verified (checksums.txt)."
        return
    }

    $pubkeyPrefix = if ($pubkey.Length -ge 16) { $pubkey.Substring(0, 16) } else { $pubkey }
    Write-Err "Signature MISMATCH for checksums.txt"
    Write-Err "  source: $sigUrl"
    Write-Err "  pubkey: `$env:MARCO_MINISIGN_PUBKEY (first 16 chars: $pubkeyPrefix…)"
    Write-Err ""
    Write-Err "The release's checksums.txt does not validate against the configured public key."
    Write-Err "Refusing to install — possible mirror tampering or wrong key."
    Remove-PathSafely -Path $TmpDir -Reason "signature-mismatch cleanup" | Out-Null
    exit 6
}


# --- Reboot-safe delete (Windows MoveFileEx + scheduled-task fallback) ---
#
# Windows file deletion fails with ERROR_SHARING_VIOLATION / ACCESS_DENIED
# when another process (typically Chrome holding the loaded extension's
# .dll/.json files, or AV scanning fresh extracted files) has an open
# handle. Rather than abort the install, we:
#
#   1. Try Remove-Item normally.
#   2. On failure, rename each locked path to a sibling
#      ".delete-pending-<rand>" so the original name is freed for the new
#      install to reuse atomically.
#   3. Schedule the renamed path for deletion via MoveFileEx with
#      MOVEFILE_DELAY_UNTIL_REBOOT (the documented Windows mechanism the
#      OS itself uses for in-use system files). Records to
#      HKLM\...\Session Manager\PendingFileRenameOperations.
#   4. As a defense-in-depth fallback (no SeRestorePrivilege, or non-admin
#      session), drop a marker file at
#      $env:LOCALAPPDATA\Marco\pending-deletes\<rand>.txt that a future
#      installer run will pick up and retry.
#
# On non-Windows platforms, this is a thin wrapper around Remove-Item.
#
# Spec: spec/14-update/01-generic-installer-behavior.md §5 (cleanup)
$script:DeferredDeleteCount = 0
$script:DeferredDeleteRebootRequired = $false

function Test-IsWindowsPlatform {
    # PS 5.1 (Windows-only) lacks $IsWindows. PS 7+ defines it on every OS.
    if (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) {
        return [bool]$IsWindows
    }
    return $true
}

function Add-MoveFileExType {
    if ('Marco.Win32.NativeMethods' -as [type]) { return }
    Add-Type -Namespace 'Marco.Win32' -Name 'NativeMethods' -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
public static extern bool MoveFileEx(string lpExistingFileName, string lpNewFileName, uint dwFlags);
public const uint MOVEFILE_REPLACE_EXISTING = 0x1;
public const uint MOVEFILE_COPY_ALLOWED     = 0x2;
public const uint MOVEFILE_DELAY_UNTIL_REBOOT = 0x4;
'@ -ErrorAction Stop
}

function Register-PendingDeleteMarker([string]$path, [string]$reason) {
    # Last-resort fallback when MoveFileEx itself errors. A marker file
    # records the path AND a fixed schema/owner stamp so the sweep can
    # tell our markers apart from anything else that happens to live in
    # %LOCALAPPDATA%\Marco\pending-deletes\ (defense in depth — we own
    # the directory, but third-party tools and old script versions could
    # still drop files there).
    try {
        $markerDir = Join-Path $env:LOCALAPPDATA "Marco\pending-deletes"
        New-Item -ItemType Directory -Path $markerDir -Force -ErrorAction SilentlyContinue | Out-Null
        $marker = Join-Path $markerDir ("$(Get-Random).txt")
        @{
            Schema         = $script:MarcoMarkerSchema
            OwnerSignature = $script:MarcoOwnerSignature
            RunId          = $script:MarcoRunId
            Path           = $path
            Reason         = $reason
            ScheduledAt    = (Get-Date).ToString('o')
            Pid            = $PID
        } | ConvertTo-Json | Set-Content -Path $marker -Encoding UTF8
    } catch {
        # Marker is informational — never block the install on it.
    }
}

function Invoke-DelayedDelete([string]$path, [string]$reason) {
    # Schedule $path for deletion at next reboot. Returns $true if
    # scheduling succeeded, $false otherwise. Either way the install is
    # already complete — this is purely cleanup, so we never raise an
    # error or change exit status from here.
    if (-not (Test-IsWindowsPlatform)) {
        # POSIX: locked files don't block deletion. Just remove.
        try { Remove-Item -Path $path -Recurse -Force -ErrorAction Stop } catch { }
        return $true
    }

    try {
        Add-MoveFileExType
        $flags = [Marco.Win32.NativeMethods]::MOVEFILE_DELAY_UNTIL_REBOOT
        # Per MSDN: passing $null as the destination tells Windows to
        # delete (rather than rename) on next reboot.
        $ok = [Marco.Win32.NativeMethods]::MoveFileEx($path, $null, $flags)
        if ($ok) {
            $script:DeferredDeleteCount++
            $script:DeferredDeleteRebootRequired = $true
            # Informational, not a warning — the install succeeded; OS
            # will sweep this path on next reboot. No user action needed.
            Write-Note "Cleanup deferred to next reboot (file locked by another process):"
            Write-Host "    $path" -ForegroundColor DarkGray
            Write-Host "    Reason: $reason" -ForegroundColor DarkGray
            return $true
        }
        $errCode = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        # MoveFileEx couldn't queue (typically missing SeRestorePrivilege
        # on a non-elevated session). Drop a marker file so the next
        # installer run sweeps it. Still informational — install is fine.
        Write-Note "Cleanup queued for next install run (Win32 $errCode, marker written):"
        Write-Host "    $path" -ForegroundColor DarkGray
        Register-PendingDeleteMarker -path $path -reason "$reason (MoveFileEx err=$errCode)"
        $script:DeferredDeleteCount++
        return $false
    } catch {
        Write-Note "Cleanup queued for next install run (marker fallback):"
        Write-Host "    $path" -ForegroundColor DarkGray
        Register-PendingDeleteMarker -path $path -reason "$reason (exception: $($_.Exception.Message))"
        $script:DeferredDeleteCount++
        return $false
    }
}

function Invoke-DelayedRename([string]$source, [string]$destination, [string]$reason) {
    # Schedule a rename of $source → $destination at next reboot using
    # MoveFileEx with MOVEFILE_DELAY_UNTIL_REBOOT. This is the Windows-
    # documented mechanism for displacing a locked file when even
    # in-process Rename-Item fails (e.g. the file is held with
    # FileShare.None). The destination uses the canonical
    # `.<leaf>.delete-pending-marco-<runid>` pattern so a future sweep
    # (or our own marker-driven cleanup) can attribute and remove it.
    #
    # Returns $true if scheduling succeeded, $false otherwise. Failure
    # falls back to scheduling the original path for delete and writing
    # a marker — never raises.
    if (-not (Test-IsWindowsPlatform)) {
        try { Rename-Item -LiteralPath $source -NewName (Split-Path -Leaf $destination) -Force -ErrorAction Stop } catch { }
        return $true
    }

    try {
        Add-MoveFileExType
        $flags = [Marco.Win32.NativeMethods]::MOVEFILE_DELAY_UNTIL_REBOOT -bor `
                 [Marco.Win32.NativeMethods]::MOVEFILE_REPLACE_EXISTING
        $ok = [Marco.Win32.NativeMethods]::MoveFileEx($source, $destination, $flags)
        if ($ok) {
            $script:DeferredDeleteCount++
            $script:DeferredDeleteRebootRequired = $true
            Write-Note "Cleanup deferred to next reboot (locked file will be rotated on boot):"
            Write-Host "    $source" -ForegroundColor DarkGray
            Write-Host "    -> $destination" -ForegroundColor DarkGray
            Write-Host "    Reason: $reason" -ForegroundColor DarkGray
            # Drop a marker so the next install run knows to sweep the
            # rotated path (it'll exist after reboot under the canonical
            # pattern, ready for normal Remove-Item).
            Register-PendingDeleteMarker -path $destination -reason "$reason (scheduled via MoveFileEx rename-on-reboot)"
            return $true
        }
        $errCode = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Note "Could not schedule rename-on-reboot (Win32 $errCode); falling back to delete-on-reboot:"
        Write-Host "    $source" -ForegroundColor DarkGray
        return (Invoke-DelayedDelete -path $source -reason "$reason (rename-on-reboot err=$errCode)")
    } catch {
        Write-Note "Could not schedule rename-on-reboot (exception); falling back to delete-on-reboot:"
        Write-Host "    $source" -ForegroundColor DarkGray
        return (Invoke-DelayedDelete -path $source -reason "$reason (rename-on-reboot exception: $($_.Exception.Message))")
    }
}

function Test-IsSharingViolation($exception) {
    # Classify whether a Remove-Item failure was a Windows sharing/lock
    # error (file in use by another process) vs. a real problem (perms,
    # missing path, IO fault). Sharing violations are normal during
    # self-replace and should be reported as informational notices.
    if ($null -eq $exception) { return $false }
    $hresult = 0
    try { $hresult = [int]$exception.HResult } catch { }
    # 0x80070020 ERROR_SHARING_VIOLATION (32)
    # 0x80070021 ERROR_LOCK_VIOLATION    (33)
    # 0x80070005 ERROR_ACCESS_DENIED     (5)  — often masks a sharing violation
    if ($hresult -eq -2147024864 -or $hresult -eq -2147024863 -or $hresult -eq -2147024891) {
        return $true
    }
    $msg = "$($exception.Message)"
    return ($msg -match 'being used by another process' -or
            $msg -match 'sharing violation' -or
            $msg -match 'access[ -]?denied' -or
            $msg -match 'cannot access the file')
}

function Remove-PathSafely {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [string]$Reason = "cleanup"
    )

    if (-not (Test-Path -LiteralPath $Path)) { return }

    # 1. Best case — nothing locked.
    $firstException = $null
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        return
    } catch {
        $firstException = $_.Exception
    }

    # 2. Some descendants may have deleted; only the locked tail remains.
    if (-not (Test-Path -LiteralPath $Path)) { return }

    if (-not (Test-IsWindowsPlatform)) {
        # On POSIX, the failure was real (perms, etc.) — surface as a
        # warning but never abort: cleanup is non-fatal by contract.
        Write-Warn "Cleanup skipped for ${Path}: $($firstException.Message)"
        return
    }

    # On Windows, classify: sharing/lock errors are expected during
    # self-replace and get the informational treatment. Other errors
    # (corrupt FS, denied by policy) get a warning but still don't fail.
    $isLock = Test-IsSharingViolation $firstException
    if (-not $isLock) {
        Write-Warn "Cleanup encountered a non-lock error for ${Path}: $($firstException.Message)"
        Write-Note "  → still attempting deferred-delete fallback so the install isn't blocked."
    }

    # 3. Rename out of the way so the original name is free for reuse,
    #    then schedule the renamed path for reboot-safe deletion. The
    #    rotated leaf is stamped with the current RunId so a future
    #    sweep can attribute it to this updater (vs. random `.old` files
    #    or unrelated `.delete-pending-*` paths).
    $parent = Split-Path -Parent $Path
    $leaf   = Split-Path -Leaf   $Path
    $rotated = Join-Path $parent ".$leaf.delete-pending-$script:MarcoRunId"

    try {
        Rename-Item -LiteralPath $Path -NewName (Split-Path -Leaf $rotated) -Force -ErrorAction Stop
    } catch {
        # If even in-process rename fails (e.g. file held with
        # FileShare.None), ask the kernel to perform the rename at next
        # reboot via MoveFileEx + MOVEFILE_DELAY_UNTIL_REBOOT. This still
        # produces the canonical `.<leaf>.delete-pending-marco-<runid>`
        # destination so post-reboot sweeps can attribute & clean it up.
        Write-Note "Could not rotate locked path in-process; scheduling rename-on-reboot:"
        Write-Host "    $Path" -ForegroundColor DarkGray
        Write-Host "    -> $rotated" -ForegroundColor DarkGray
        Invoke-DelayedRename -source $Path -destination $rotated -reason $Reason | Out-Null
        return
    }

    Invoke-DelayedDelete -path $rotated -reason $Reason | Out-Null
}

# --- Install ---

function Install-Extension([string]$zipPath, [string]$installDir) {
    Write-Step "Installing to $installDir..."

    # Rename-then-replace pattern: if Chrome (or AV) has files in the
    # current install dir locked, Remove-PathSafely renames it out of the
    # way and schedules deletion for next reboot. The new extraction
    # always lands in a fresh empty dir at the original path, so the
    # re-install succeeds even with the extension actively loaded.
    if (Test-Path -LiteralPath $installDir) {
        Remove-PathSafely -Path $installDir -Reason "replace previous install at $installDir"
    }
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $installDir -Force

    $fileCount = (Get-ChildItem -Path $installDir -File -Recurse | Measure-Object).Count
    if ($fileCount -eq 0) {
        Write-Err "Extraction produced no files in $installDir"
        exit 6
    }

    $manifest = Join-Path $installDir "manifest.json"
    if (-not (Test-Path $manifest)) {
        $nested = Get-ChildItem -Path $installDir -Filter "manifest.json" -Recurse | Select-Object -First 1
        if (-not $nested) {
            Write-Err "manifest.json not found — archive may be corrupted."
            exit 6
        }
    }

    Write-OK "Installed $fileCount files to $installDir"
}

function Write-InstallSummary([string]$version, [string]$installDir, [bool]$urlPinned) {
    Write-Host ""
    Write-Step "Install summary"
    $pinNote = if ($urlPinned) { " (pinned via release URL)" } else { "" }
    Write-Host "  Version:     $version$pinNote"
    Write-Host "  Install dir: $installDir"
    Write-Host ""
    Write-Host "  ----------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  To load in Chrome / Edge / Brave:" -ForegroundColor White
    Write-Host ""
    Write-Host "  1. Open chrome://extensions (or edge://extensions)"
    Write-Host "  2. Enable 'Developer mode' (toggle in top-right)"
    Write-Host "  3. Click 'Load unpacked'"
    Write-Host "  4. Select: $installDir"
    Write-Host "  ----------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    if ($urlPinned) {
        Write-Warn "URL-pinned install — re-running this exact one-liner reinstalls $version."
        Write-Host "  For auto-update, use the install.ps1 from raw.githubusercontent.com/.../main/." -ForegroundColor DarkGray
    } else {
        Write-Host "  To update later, re-run this script — it replaces the folder." -ForegroundColor DarkGray
    }

    if ($script:DeferredDeleteCount -gt 0) {
        Write-Host ""
        # Informational — install completed successfully. The locked
        # files are a normal consequence of replacing a loaded extension
        # while Chrome (or AV) holds handles open; Windows handles the
        # eventual cleanup. Exit code remains 0.
        Write-Note "Install completed successfully. $script:DeferredDeleteCount path(s) had locked files; cleanup deferred."
        if ($script:DeferredDeleteRebootRequired) {
            Write-Host "  Locked items were rotated aside and will be removed at next reboot (Windows MoveFileEx)." -ForegroundColor DarkGray
            Write-Host "  No action needed — your new install is live now." -ForegroundColor DarkGray
        } else {
            Write-Host "  Cleanup markers were written to %LOCALAPPDATA%\Marco\pending-deletes\." -ForegroundColor DarkGray
            Write-Host "  They'll be swept automatically on the next install run (or after closing Chrome)." -ForegroundColor DarkGray
        }
    }
}

# --- Updater-artifact identification ---
#
# Tells whether a given path or marker file is something *this updater*
# created (vs. a random `.old` file, a third-party `delete-pending-*`
# directory, or any other unrelated leftover). Both sweeps consult these
# helpers before touching anything — scoping cleanup to the files we
# actually own.

# Anchored regexes for the canonical leaf-name shapes we create.
# Kept as script-scope constants so the test suite can lint them.
$script:MarcoArtifactLeafPatterns = @(
    # Temp download dir
    '^marco-install-marco-\d{14}-[0-9a-f]{6}$',
    # Rotated install dir (leading dot, original leaf, RunId suffix)
    '^\..+\.delete-pending-marco-\d{14}-[0-9a-f]{6}$',
    # Future: gitmap-style update scratch space (reserved for the
    # in-place updater the spec calls for; recognised eagerly so the
    # sweep is forward-compatible without a script bump)
    '^gitmap-update-marco-\d{14}-[0-9a-f]{6}(?:-.+)?$',
    # Future: per-file backup of in-place replacements
    '^.+\.old\.marco-\d{14}-[0-9a-f]{6}$'
)

function Test-IsMarcoArtifactLeaf([string]$leaf) {
    if ([string]::IsNullOrEmpty($leaf)) { return $false }
    foreach ($pattern in $script:MarcoArtifactLeafPatterns) {
        if ($leaf -match $pattern) { return $true }
    }
    return $false
}

function Test-IsMarcoArtifact([string]$path) {
    # True iff the leaf name matches one of the canonical updater
    # patterns. Path doesn't have to exist — sweepers call this *before*
    # deciding to touch it.
    if ([string]::IsNullOrEmpty($path)) { return $false }
    return Test-IsMarcoArtifactLeaf (Split-Path -Leaf $path)
}

function Test-IsMarcoMarker($entry) {
    # Validates a parsed marker JSON object. Requires both the schema
    # AND the owner-signature stamps that Register-PendingDeleteMarker
    # writes. Anything missing either is treated as foreign and left
    # untouched.
    if ($null -eq $entry) { return $false }
    if ($entry.Schema -ne $script:MarcoMarkerSchema) { return $false }
    if ($entry.OwnerSignature -ne $script:MarcoOwnerSignature) { return $false }
    return $true
}

function Find-MarcoUpdaterArtifacts {
    # Enumerates stranded updater artifacts under known roots.
    # Strict: only paths whose leaf matches one of the canonical
    # patterns are returned. Returns an array of FileSystemInfo objects.
    if (-not (Test-IsWindowsPlatform)) { return @() }
    $roots = @()
    if ($env:TEMP)         { $roots += $env:TEMP }
    if ($env:LOCALAPPDATA) { $roots += (Join-Path $env:LOCALAPPDATA 'Marco') }

    $found = @()
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        # Top-level only — we don't recurse arbitrary trees looking for
        # `.old` files (would be too broad). Rotated install-dirs live
        # next to their original install dir, which the caller passes
        # explicitly via Find-MarcoArtifactsAt.
        try {
            $entries = Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue
            foreach ($e in $entries) {
                if (Test-IsMarcoArtifactLeaf $e.Name) { $found += $e }
            }
        } catch { }
    }
    return $found
}

function Find-MarcoArtifactsAt([string]$dir) {
    # Sibling-aware lookup: scans $dir for rotated `.<leaf>.delete-pending-<runId>`
    # entries (these live next to the install dir, not in TEMP).
    if (-not (Test-IsWindowsPlatform)) { return @() }
    if ([string]::IsNullOrEmpty($dir) -or -not (Test-Path -LiteralPath $dir)) { return @() }
    $found = @()
    try {
        $entries = Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue
        foreach ($e in $entries) {
            if (Test-IsMarcoArtifactLeaf $e.Name) { $found += $e }
        }
    } catch { }
    return $found
}

# --- Sweep prior pending-delete markers (best-effort, never blocks install) ---

function Invoke-PendingDeleteSweep {
    if (-not (Test-IsWindowsPlatform)) { return }
    $markerDir = Join-Path $env:LOCALAPPDATA "Marco\pending-deletes"
    if (-not (Test-Path -LiteralPath $markerDir)) { return }
    $markers = Get-ChildItem -LiteralPath $markerDir -File -Filter '*.txt' -ErrorAction SilentlyContinue
    if (-not $markers) { return }
    $cleared = 0
    $skippedForeign = 0
    foreach ($m in $markers) {
        try {
            $entry = Get-Content -LiteralPath $m.FullName -Raw -ErrorAction Stop | ConvertFrom-Json
            # Strict ownership check — refuse to act on markers that
            # weren't written by this updater (no schema, no owner sig,
            # or wrong values). Leave them alone for whoever owns them.
            if (-not (Test-IsMarcoMarker $entry)) {
                $skippedForeign++
                continue
            }
            # Belt-and-braces: even if the marker is ours, also verify
            # the recorded path's leaf matches our canonical pattern.
            # Catches old marker schema versions or tampered entries.
            if ($entry.Path -and -not (Test-IsMarcoArtifact $entry.Path)) {
                $skippedForeign++
                continue
            }
            if ($entry.Path -and (Test-Path -LiteralPath $entry.Path)) {
                try {
                    Remove-Item -LiteralPath $entry.Path -Recurse -Force -ErrorAction Stop
                    Remove-Item -LiteralPath $m.FullName -Force -ErrorAction SilentlyContinue
                    $cleared++
                } catch {
                    # Still locked — leave the marker for the next run.
                }
            } else {
                # Path already gone (reboot consumed the MoveFileEx queue) — drop the marker.
                Remove-Item -LiteralPath $m.FullName -Force -ErrorAction SilentlyContinue
                $cleared++
            }
        } catch {
            # Corrupt JSON — only discard if it's safe to assume it's ours
            # (lives in our markerDir AND we can't parse it). Anything
            # parseable but unowned is left alone above.
            Remove-Item -LiteralPath $m.FullName -Force -ErrorAction SilentlyContinue
        }
    }
    if ($cleared -gt 0) {
        Write-Step "Swept $cleared deferred-delete marker(s) from prior installs."
    }
    if ($skippedForeign -gt 0) {
        Write-Note "Skipped $skippedForeign unowned marker(s) in pending-deletes/ (not created by this updater)."
    }
}

# --- Sweep stranded updater artifacts (rotated dirs left behind by crashed runs) ---

function Invoke-StaleArtifactSweep([string]$installDir) {
    # Looks for canonical updater artifacts under TEMP, LOCALAPPDATA\Marco,
    # and beside the install dir. Only deletes paths whose leaf matches
    # one of the patterns in $script:MarcoArtifactLeafPatterns — never
    # generic `.old` or `delete-pending-*` paths from other tools.
    #
    # Runs at startup so a previous run that crashed before MoveFileEx
    # queued its rotated dir for reboot-deletion still gets cleaned up.
    if (-not (Test-IsWindowsPlatform)) { return }
    $candidates = @()
    $candidates += Find-MarcoUpdaterArtifacts
    if ($installDir) {
        $parent = Split-Path -Parent $installDir
        if ($parent) { $candidates += Find-MarcoArtifactsAt $parent }
    }
    if ($candidates.Count -eq 0) { return }
    $cleared = 0
    $deferred = 0
    foreach ($c in $candidates) {
        # Defense in depth: re-validate before touching.
        if (-not (Test-IsMarcoArtifactLeaf $c.Name)) { continue }
        try {
            Remove-Item -LiteralPath $c.FullName -Recurse -Force -ErrorAction Stop
            $cleared++
        } catch {
            # Still locked — Remove-PathSafely will defer it again.
            Remove-PathSafely -Path $c.FullName -Reason "stale updater artifact from prior run"
            $deferred++
        }
    }
    if ($cleared -gt 0) {
        Write-Step "Swept $cleared stale updater artifact(s) from prior runs."
    }
    if ($deferred -gt 0) {
        Write-Note "$deferred prior-run artifact(s) still locked; deferred to next reboot."
    }
}

# --- Main ---

function Main {
    if ($Help) { Show-Help; return $null }

    Write-Host ""
    Write-Host " Marco Extension installer" -ForegroundColor White
    Write-Host " github.com/$Repo" -ForegroundColor DarkGray
    Write-Host ""

    Invoke-PendingDeleteSweep

    $urlPinned = ($Version -eq "") -and ($null -ne (Get-VersionFromUrl))

    $resolvedVersion = Resolve-Version $Version
    $resolvedDir = Resolve-InstallDir $InstallDir

    # Per spec §2.1 / §2.2 — banner identifying mode + version.
    # Strict mode = URL-pinned OR explicit semver -Version (NOT 'latest').
    $isExplicitPin = ($Version -ne '' -and $Version -ine 'latest')
    $isStrict = $urlPinned -or $isExplicitPin
    $isMainFallback = ($resolvedVersion -eq $script:MarcoMainBranchSentinel)
    if ($isStrict) {
        Write-Step "🔒 Strict mode — pinned to $resolvedVersion"
    } elseif ($isMainFallback) {
        Write-Step "🌿 Discovery mode — main branch (no releases found)"
    } else {
        Write-Step "🌊 Discovery mode — resolved $resolvedVersion"
    }

    # Spec §4 — resolve sibling-discovery decision now that we know strict-ness.
    Decide-SiblingDiscovery $isStrict

    if ($DryRun) {
        Write-Host ""
        Write-Step "Dry run — plan:"
        Write-Host "  Version:     $resolvedVersion"
        Write-Host "  Install dir: $resolvedDir"
        Write-Host "  Repo:        $Repo"
        Write-Host "  Sibling discovery: $script:SiblingDecision — $script:SiblingDecisionReason"
        Write-Host ""
        Write-OK "Dry run complete — nothing installed."
        return @{ DryRun = $true; Version = $resolvedVersion; InstallDir = $resolvedDir; UrlPinned = $urlPinned }
    }

    # Now that we know the install dir, sweep canonical-pattern stale
    # artifacts from prior runs (rotated `.delete-pending-marco-*` next
    # to it, plus TEMP/`marco-install-marco-*` leftovers).
    Invoke-StaleArtifactSweep -installDir $resolvedDir

    # Spec §4 — actual sibling probing runs only when decision=on.
    if ($script:SiblingDecision -eq 'on') {
        try { Probe-VersionedSiblings } catch { Write-Note "Sibling probe skipped: $_" }
    }

    $result = Get-Asset $resolvedVersion

    try {
        Install-Extension $result.ZipPath $resolvedDir
    }
    finally {
        Remove-PathSafely -Path $result.TmpDir -Reason "post-install temp cleanup"
    }

    # Mirror install.sh: main-branch fallback records "<branch>@HEAD"
    # instead of the sentinel to keep VERSION human-readable.
    $recordedVersion = if ($isMainFallback) { "$script:MarcoMainBranch@HEAD" } else { $resolvedVersion }
    $recordedVersion | Set-Content (Join-Path $resolvedDir "VERSION")

    return @{ InstallDir = $resolvedDir; Version = $recordedVersion; UrlPinned = $urlPinned }
}

# Test-harness guard: when $env:MARCO_INSTALLER_TEST_MODE is "1", the
# test driver dot-sources this file purely to load function definitions
# (Remove-PathSafely, Invoke-DelayedDelete, Test-IsMarcoMarker, etc.)
# without performing a real install. Skips Main + the final summary.
if ($env:MARCO_INSTALLER_TEST_MODE -ne '1') {
    $installResult = Main
    if ($null -ne $installResult -and -not $installResult.DryRun) {
        Write-InstallSummary $installResult.Version $installResult.InstallDir $installResult.UrlPinned
        Write-Host ""
        Write-OK "Done!"
        Write-Host ""
    }
}
