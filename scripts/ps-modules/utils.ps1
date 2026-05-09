<#
.SYNOPSIS
    General-purpose utility functions for the build pipeline.

.DESCRIPTION
    Provides formatting, command detection, path refresh, version parsing,
    and pnpm command helpers used throughout the build & deploy script.
#>

<#
.SYNOPSIS
    Formats a Stopwatch elapsed time as a human-readable string.
.PARAMETER Stopwatch
    A running or stopped System.Diagnostics.Stopwatch instance.
.OUTPUTS
    String — e.g. "2m 3.1s" or "14.2s"
#>
function Format-ElapsedTime($Stopwatch) {
    $elapsed = $Stopwatch.Elapsed
    if ($elapsed.TotalMinutes -ge 1) {
        return "{0:N0}m {1:N1}s" -f [Math]::Floor($elapsed.TotalMinutes), $elapsed.Seconds
    } else {
        return "{0:N1}s" -f $elapsed.TotalSeconds
    }
}

<#
.SYNOPSIS
    Tests whether a CLI command is available on PATH.
.PARAMETER Command
    The command name to check (e.g. "node", "pnpm").
.OUTPUTS
    Boolean — $true if the command exists.
#>
function Test-Command($Command) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try { 
        $result = Get-Command $Command -ErrorAction SilentlyContinue
        return $null -ne $result
    }
    catch { return $false }
    finally { $ErrorActionPreference = $oldPreference }
}

<#
.SYNOPSIS
    Refreshes the current session's PATH from Machine + User environment.
.DESCRIPTION
    Needed after winget/npm installs new tools so they become immediately available.
#>
function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + 
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

<#
.SYNOPSIS
    Installs Node.js LTS via winget.
.DESCRIPTION
    Exits with code 1 if winget is unavailable or installation fails.
#>
function Install-NodeJS {
    Write-Host "  Attempting to install Node.js via winget..." -ForegroundColor Yellow
    if (-not (Test-Command "winget")) {
        Write-Host "ERROR: winget not available. Install Node.js manually: https://nodejs.org/" -ForegroundColor Red
        exit 1
    }
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Failed to install Node.js" }
    Refresh-Path
    Write-Host "  [OK] Node.js installed" -ForegroundColor Green
}

<#
.SYNOPSIS
    Installs pnpm globally via npm.
#>
<#
.SYNOPSIS
    Installs pnpm globally via npm, with pnpm-only npm_config_* env vars
    stripped so npm does not warn about Unknown config keys read from .npmrc.
#>
function Install-Pnpm {
    Write-Host "  Installing pnpm globally..." -ForegroundColor Yellow

    # Strip pnpm-only env vars for the duration of this npm call so npm
    # does not emit "Unknown env config" warnings.
    $pnpmOnlyKeys = @(
        'npm_config_node_linker',
        'npm_config_store_dir',
        'npm_config_virtual_store_dir',
        'npm_config_symlink',
        'npm_config_package_import_method',
        'npm_config_verify_deps_before_run',
        'npm_config_ignore_workspace',
        'npm_config__jsr_registry',
        'npm_config_npm_globalconfig'
    )
    $savedEnv = @{}
    foreach ($key in $pnpmOnlyKeys) {
        $val = [Environment]::GetEnvironmentVariable($key)
        if ($null -ne $val) {
            $savedEnv[$key] = $val
            [Environment]::SetEnvironmentVariable($key, $null)
        }
    }

    try {
        npm install -g pnpm 2>&1 | Where-Object { $_ -notmatch 'npm warn Unknown' }
        if ($LASTEXITCODE -ne 0) { throw "Failed to install pnpm" }
    } finally {
        foreach ($key in $savedEnv.Keys) {
            [Environment]::SetEnvironmentVariable($key, $savedEnv[$key])
        }
    }

    Refresh-Path
    Write-Host "  [OK] pnpm installed" -ForegroundColor Green
}

<#
.SYNOPSIS
    Returns the drive root (e.g. "D:\") for a given path.
.PARAMETER Path
    A file system path (relative or absolute).
#>
function Get-DriveRoot([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    try {
        $resolved = (Resolve-Path $Path -ErrorAction Stop).Path
        return [System.IO.Path]::GetPathRoot($resolved)
    } catch {
        return [System.IO.Path]::GetPathRoot($Path)
    }
}

<#
.SYNOPSIS
    Extracts the major version number from a Node.js version string.
.PARAMETER Version
    Version string like "v22.5.1".
.OUTPUTS
    Int — the major version (e.g. 22). Returns 0 on parse failure.
#>
function Get-NodeMajorVersion([string]$Version) {
    try {
        $normalized = $Version.TrimStart('v', 'V').Trim()
        return [int](($normalized -split '\.')[0])
    } catch { return 0 }
}

<#
.SYNOPSIS
    Extracts the major version number from a pnpm version string.
.PARAMETER Version
    Version string like "9.15.0".
#>
function Get-PnpmMajorVersion([string]$Version) {
    try { return [int](($Version.Trim() -split '\.')[0]) }
    catch { return 0 }
}

<#
.SYNOPSIS
    Forces pnpm dependency checks into non-interactive build-safe mode.
.DESCRIPTION
    pnpm v10/v11 can fail Windows builds with ERR_PNPM_IGNORED_BUILDS when a
    script-triggered dependency-status check spawns `pnpm install` without the
    flags from our configured install command. Environment config is inherited
    by those child pnpm processes, so set both pnpm_config_* (v11+) and
    npm_config_* (v10 compatibility) before any install/run command executes.
#>
function Set-PnpmNonInteractiveEnvironment {
    $settings = @{
        "verify_deps_before_run" = "false"
        "confirm_modules_purge" = "false"
        "strict_dep_builds" = "false"
        "dangerously_allow_all_builds" = "true"
    }

    foreach ($name in $settings.Keys) {
        $value = $settings[$name]
        [Environment]::SetEnvironmentVariable("pnpm_config_$name", $value, "Process")
        [Environment]::SetEnvironmentVariable("npm_config_$name", $value, "Process")
    }
}

<#
.SYNOPSIS
    Injects --ignore-workspace into a pnpm command if not already present.
.DESCRIPTION
    Prevents pnpm workspace resolution from leaking parent-level dependencies
    into the extension build (path configured via powershell.json -> extensionDir).
.PARAMETER BaseCommand
    The raw pnpm command string from powershell.json.
#>
function Get-EffectivePnpmCommand([string]$BaseCommand) {
    if ([string]::IsNullOrWhiteSpace($BaseCommand)) { return $BaseCommand }

    $cmd = $BaseCommand.Trim()
    $isPnpmInstallCommand = $cmd -match '^(pnpm(?:\.cmd|\.exe)?)\s+install(\s|$)'
    $isPnpmRunCommand = $cmd -match '^(pnpm(?:\.cmd|\.exe)?)\s+run\s+'
    $workspaceConfigPath = if ([string]::IsNullOrWhiteSpace($script:ExtensionDir)) { "pnpm-workspace.yaml" } else { Join-Path $script:ExtensionDir "pnpm-workspace.yaml" }
    $hasProjectWorkspaceConfig = Test-Path $workspaceConfigPath -PathType Leaf

    if (($isPnpmInstallCommand -or $isPnpmRunCommand) -and (-not $hasProjectWorkspaceConfig) -and $cmd -notmatch '(^|\s)--ignore-workspace(\s|$)') {
        if ($isPnpmInstallCommand) {
            $cmd = $cmd -replace '^(pnpm(?:\.cmd|\.exe)?)\s+install', 'pnpm --ignore-workspace install'
        } else {
            $cmd = $cmd -replace '^(pnpm(?:\.cmd|\.exe)?)\s+run\s+', 'pnpm --ignore-workspace run '
        }
    }
    return $cmd
}

<#
.SYNOPSIS
    Builds the effective pnpm install command with version-specific flags.
.PARAMETER BaseCommand
    The raw install command.
.PARAMETER Major
    The pnpm major version (adds --dangerously-allow-all-builds for v10+).
#>
function Get-EffectivePnpmInstallCommand([string]$BaseCommand, [int]$Major) {
    $cmd = Get-EffectivePnpmCommand $BaseCommand
    $isPnpmInstall = $cmd -match '^(pnpm(?:\.cmd|\.exe)?)\s+(.+\s)?install(\s|$)'
    if ($Major -ge 10 -and $isPnpmInstall -and $cmd -notmatch 'dangerously-allow-all-builds') {
        $cmd = "$cmd --dangerously-allow-all-builds"
    }
    return $cmd
}

<#
.SYNOPSIS
    Executes a package.json script without invoking pnpm run.
.DESCRIPTION
    Bypasses pnpm's runDepsStatusCheck path, which can spawn `pnpm install`
    before scripts and fail on Windows with ERR_PNPM_IGNORED_BUILDS.
#>
function Invoke-PackageScriptDirect([string]$PackageDir, [string]$ScriptName) {
    $packageJsonPath = Join-Path $PackageDir "package.json"
    if (-not (Test-Path $packageJsonPath -PathType Leaf)) {
        Write-Host "  [FAIL] package.json missing for direct script execution" -ForegroundColor Red
        Write-Host "    Path: $packageJsonPath" -ForegroundColor Red
        Write-Host "    Missing item: package.json" -ForegroundColor Red
        Write-Host "    Reason: Cannot bypass pnpm run without package script metadata." -ForegroundColor Yellow
        return 2
    }

    try {
        $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    } catch {
        Write-Host "  [FAIL] package.json parse failed" -ForegroundColor Red
        Write-Host "    Path: $packageJsonPath" -ForegroundColor Red
        Write-Host "    Missing item: valid JSON" -ForegroundColor Red
        Write-Host "    Reason: $($_.Exception.Message)" -ForegroundColor Yellow
        return 2
    }

    $scriptProperty = $packageJson.scripts.PSObject.Properties[$ScriptName]
    if ($null -eq $scriptProperty -or [string]::IsNullOrWhiteSpace($scriptProperty.Value)) {
        Write-Host "  [FAIL] package script missing" -ForegroundColor Red
        Write-Host "    Path: $packageJsonPath" -ForegroundColor Red
        Write-Host "    Missing item: scripts.$ScriptName" -ForegroundColor Red
        Write-Host "    Reason: Configured build command targets a script that package.json does not define." -ForegroundColor Yellow
        return 2
    }

    $scriptCommand = [string]$scriptProperty.Value
    $binPath = Join-Path $PackageDir "node_modules/.bin"
    $oldPath = $env:Path
    $oldLifecycleEvent = $env:npm_lifecycle_event
    $oldPackageName = $env:npm_package_name

    Push-Location $PackageDir
    try {
        $env:Path = "$binPath$([IO.Path]::PathSeparator)$oldPath"
        $env:npm_lifecycle_event = $ScriptName
        $env:npm_package_name = if ($packageJson.name) { [string]$packageJson.name } else { "package" }
        if ($IsWindows -or $env:OS -eq "Windows_NT") {
            & cmd.exe /d /s /c $scriptCommand
        } else {
            & /bin/sh -c $scriptCommand
        }
        return $LASTEXITCODE
    } finally {
        $env:Path = $oldPath
        $env:npm_lifecycle_event = $oldLifecycleEvent
        $env:npm_package_name = $oldPackageName
        Pop-Location
    }
}

<#
.SYNOPSIS
    Resolves a path relative to the script directory.
.PARAMETER Path
    A relative or absolute path. If "." or empty, returns $ScriptDir.
#>
function Resolve-RelativePath($Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path -eq ".") {
        return $script:ScriptDir
    }
    if ($Path -match '^[A-Za-z]:' -or $Path -match '^\\\\') {
        return $Path -replace '/', '\'
    }
    return Join-Path $script:ScriptDir $Path
}

<#
.SYNOPSIS
    Defensive guard: aborts with a clear error if $script:ExtensionDir is missing.
.DESCRIPTION
    Mirrors the startup guard in run.ps1 but runs at the point of use (e.g. before
    Push-Location inside ps-modules). This catches the case where the startup
    guard was bypassed — for example when powershell.json was edited after script
    load, when a stale build/ps-modules copy is dot-sourced, or when $script:
    scope didn't propagate as expected.
.PARAMETER CallerName
    Name of the calling function (for error context).
#>
function Assert-ExtensionDirExists {
    param([string]$CallerName = "ps-module")

    $configuredValue = if ($null -ne $script:Config -and $null -ne $script:Config.extensionDir) {
        $script:Config.extensionDir
    } else { "<unset>" }

    if ([string]::IsNullOrWhiteSpace($script:ExtensionDir)) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "  EXTENSION DIR GUARD FAILURE ($CallerName)" -ForegroundColor Red
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "ERROR: `$script:ExtensionDir is null or empty." -ForegroundColor Red
        Write-Host "  powershell.json -> extensionDir: '$configuredValue'" -ForegroundColor Gray
        Write-Host "  Script dir:                      '$script:ScriptDir'" -ForegroundColor Gray
        Write-Host "Fix: set 'extensionDir' in powershell.json to '.' (repo root) or a valid sub-folder." -ForegroundColor Yellow
        exit 1
    }

    if (-not (Test-Path $script:ExtensionDir -PathType Container)) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "  EXTENSION DIR GUARD FAILURE ($CallerName)" -ForegroundColor Red
        Write-Host "========================================" -ForegroundColor Red
        Write-Host "ERROR: Extension directory does not exist:" -ForegroundColor Red
        Write-Host "  $script:ExtensionDir" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Configuration source:" -ForegroundColor Gray
        Write-Host "  powershell.json -> extensionDir: '$configuredValue'" -ForegroundColor Gray
        Write-Host "  Script dir:                      '$script:ScriptDir'" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Resolution:" -ForegroundColor Cyan
        Write-Host "  1. Open powershell.json and verify 'extensionDir'." -ForegroundColor White
        Write-Host "  2. For this repo (extension at root), use:  `"extensionDir`": `".`"" -ForegroundColor White
        Write-Host "  3. If you edited powershell.json mid-run, re-run .\run.ps1." -ForegroundColor White
        Write-Host "  4. If a stale build/ps-modules exists, delete it so scripts/ps-modules is used." -ForegroundColor White
        Write-Host ""
        exit 1
    }
}
