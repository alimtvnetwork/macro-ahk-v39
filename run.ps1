# Marco Chrome Extension — Build & Deploy Script
# Version: 2.02.0
# Modular orchestrator — functions live in build/ps-modules/*.ps1
# Configure via powershell.json — see spec/03-imported-spec/12-powershell-integration/
#
# USAGE:  .\run.ps1 [flags]
# HELP:   .\run.ps1 -h

param(
    [Alias('b')][switch]$buildonly,
    [Alias('s')][switch]$skipbuild,
    [Alias('p')][switch]$skippull,
    [Alias('f')][switch]$force,
    [Alias('i')][switch]$installonly,
    [Alias('r')][switch]$rebuild,
    [Alias('d')][switch]$deploy,
    [Alias('pr')][string]$profile = "",
    [Alias('e')][string]$browser = "chrome",
    [Alias('w')][switch]$watch,
    [Alias('dm')][switch]$directmode,
    [Alias('h')][switch]$help,
    [Alias('v')][switch]$verboseMode,
    [Alias('pf')][switch]$preflight,
    [Alias('dl')][switch]$downloadchrome,
    [Alias('k')][switch]$killbrowser,
    [Alias('nsm')][switch]$nosourcemap,
    [Alias('q')][switch]$quick,
    [Alias('u')][switch]$uninstall,
    [Alias('ri')][switch]$reinstall,
    [Alias('y')][switch]$yes,
    [Alias('ro')][switch]$reportonly,
    [switch]$strict,
    [Parameter(ValueFromRemainingArguments = $true)]$ExtraArgs
)

# POSIX-style "--yes" support (PowerShell param() only matches single-dash)
if ($ExtraArgs) {
    foreach ($a in $ExtraArgs) {
        if ($a -is [string] -and ($a -ieq '--yes' -or $a -ieq '--y')) { $yes = $true }
        if ($a -is [string] -and ($a -ieq '--report-only' -or $a -ieq '--reportonly' -or $a -ieq '--ro')) { $reportonly = $true }
    }
}

if ($quick) { $skippull = $true; $nosourcemap = $true }
if ($rebuild) { $force = $true; $installonly = $true }

$ErrorActionPreference = "Stop"

# ============================================================================
# PATH & CONFIG
# ============================================================================
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($ScriptDir)) { $ScriptDir = Get-Location }

# Load modules (with preflight validation)
$moduleDirCandidates = @(
    (Join-Path $ScriptDir "scripts\ps-modules"),
    (Join-Path $ScriptDir "build\ps-modules")
)

$modulesDir = $null
foreach ($candidate in $moduleDirCandidates) {
    if (Test-Path $candidate) {
        $modulesDir = $candidate
        break
    }
}
if (-not $modulesDir) {
    Write-Host "ERROR: PowerShell modules directory not found." -ForegroundColor Red
    Write-Host "Checked paths:" -ForegroundColor Red
    foreach ($candidate in $moduleDirCandidates) { Write-Host "  - $candidate" -ForegroundColor Red }
    exit 1
}

$requiredModules = @(
    "utils.ps1",
    "pnpm-config.ps1",
    "browser-profiles.ps1",
    "browser-deploy.ps1",
    "preflight.ps1",
    "standalone-build.ps1",
    "extension-build.ps1",
    "watch.ps1",
    "uninstall.ps1",
    "help.ps1"
)

$missingModules = @()
foreach ($mod in $requiredModules) {
    $modPath = Join-Path $modulesDir $mod
    if (-not (Test-Path $modPath -PathType Leaf)) { $missingModules += $mod }
}
if ($missingModules.Count -gt 0) {
    Write-Host "ERROR: Missing required ps-modules in ${modulesDir}:" -ForegroundColor Red
    foreach ($m in $missingModules) { Write-Host "  - $m" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Restore scripts/ps-modules from git and retry." -ForegroundColor Yellow
    exit 1
}

foreach ($mod in $requiredModules) { . (Join-Path $modulesDir $mod) }

# Load configuration
$ConfigPath = Join-Path $ScriptDir "powershell.json"
if (-not (Test-Path $ConfigPath)) {
    Write-Host "ERROR: powershell.json not found at: $ConfigPath" -ForegroundColor Red
    exit 1
}
try { $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json }
catch { Write-Host "ERROR: Failed to parse powershell.json: $_" -ForegroundColor Red; exit 1 }

# Resolve config values
$ProjectName     = if ($Config.projectName) { $Config.projectName } else { "Chrome Extension" }
$RootDir         = Resolve-RelativePath $Config.rootDir
$ExtensionDir    = Resolve-RelativePath $Config.extensionDir
$DistDir         = if ($Config.distDir) { $Config.distDir } else { "dist" }

# ============================================================================
# STARTUP GUARD: Validate ExtensionDir exists
# ============================================================================
$ExtensionDirMissing = [string]::IsNullOrWhiteSpace($ExtensionDir)
$ExtensionDirNotADir = (-not $ExtensionDirMissing) -and (-not (Test-Path $ExtensionDir -PathType Container))
if ($ExtensionDirMissing -or $ExtensionDirNotADir) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  STARTUP GUARD FAILURE" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    if ($ExtensionDirMissing) {
        Write-Host "ERROR: Extension directory is null or empty after resolving 'extensionDir'." -ForegroundColor Red
    } else {
        Write-Host "ERROR: Extension directory does not exist:" -ForegroundColor Red
        Write-Host "  $ExtensionDir" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Configuration source:" -ForegroundColor Gray
    Write-Host "  powershell.json:                 $ConfigPath" -ForegroundColor Gray
    Write-Host "  powershell.json -> extensionDir: '$($Config.extensionDir)'" -ForegroundColor Gray
    Write-Host "  Script dir:                      $ScriptDir" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Resolution steps:" -ForegroundColor Cyan
    Write-Host "  1. Open powershell.json and verify 'extensionDir'." -ForegroundColor White
    Write-Host "  2. For this repo (extension at root), use:  `"extensionDir`": `".`"" -ForegroundColor White
    Write-Host "  3. For a sub-folder layout, ensure that folder exists relative to:" -ForegroundColor White
    Write-Host "     $ScriptDir" -ForegroundColor DarkGray
    Write-Host "  4. If you edited powershell.json mid-run, re-run .\run.ps1." -ForegroundColor White
    Write-Host ""
    exit 1
}

$BuildCommand    = if ($Config.buildCommand) { $Config.buildCommand } else { "npm run build" }
$DevCommand      = if ($Config.devCommand) { $Config.devCommand } else { "npm run dev" }
$InstallCommand  = if ($Config.installCommand) { $Config.installCommand } else { "npm install" }
$CleanPaths      = if ($Config.cleanPaths) { $Config.cleanPaths } else { @("dist", "node_modules") }
$DefaultProfile  = if ($Config.defaultProfile) { $Config.defaultProfile } else { "Default" }
$BrowserExePathOverride = if ($Config.browserExePath) { $Config.browserExePath } else { "" }
$ChromeUserDataDir = if ($Config.chromeUserDataDir) { $Config.chromeUserDataDir } else { "$env:LOCALAPPDATA\Google\Chrome\User Data" }
$EdgeUserDataDir   = if ($Config.edgeUserDataDir) { $Config.edgeUserDataDir } else { "$env:LOCALAPPDATA\Microsoft\Edge\User Data" }
$TargetProfile     = if ($profile -ne "") { $profile } else { $DefaultProfile }
$CheckNode       = if ($null -ne $Config.prerequisites -and $null -ne $Config.prerequisites.node) { $Config.prerequisites.node } else { $true }
$CheckPnpm       = if ($null -ne $Config.prerequisites -and $null -ne $Config.prerequisites.pnpm) { $Config.prerequisites.pnpm } else { $false }
$UsePnp          = if ($null -ne $Config.usePnp) { $Config.usePnp } else { $false }
$PnpmStorePath   = if ($Config.pnpmStorePath) { $Config.pnpmStorePath } else { "E:/.pnpm-store" }
$RequiredPackages = if ($Config.requiredPackages) { @($Config.requiredPackages) } else { @("vite", "tailwindcss", "autoprefixer") }
$NodeMajor       = 0
$PnpmMajor       = 0
$EffectiveInstallCommand = $InstallCommand
$EffectiveBuildCommand   = $BuildCommand
$EffectiveNodeLinker     = if ($UsePnp) { "pnp" } else { "isolated" }

$TotalStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$StepTimes = @{}

# ============================================================================
# EARLY EXITS: -dl, -h, -uninstall, -reinstall
# ============================================================================
if ($downloadchrome) { Download-ChromeForTesting; exit 0 }
if ($help) { Show-Help; exit 0 }

if ($uninstall -or $reinstall) {
    # --report-only forces dry mode and implies -y (nothing is deleted, so no
    # destructive prompt is required). It is also incompatible with -reinstall
    # because there would be nothing to "reinstall" from.
    if ($reportonly) {
        if ($reinstall) {
            Write-Host ""
            Write-Host "  [error]   --report-only cannot be combined with -reinstall (dry run does not delete anything)." -ForegroundColor Red
            exit 1
        }
        $yes = $true
    }
    if (-not $yes) {
        $action = if ($reinstall) { "UNINSTALL + REINSTALL" } else { "UNINSTALL" }
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "  CONFIRM: $action" -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "  This will remove dist/, node_modules, build caches, standalone-scripts" -ForegroundColor Gray
        Write-Host "  dist/ + node_modules, generated metadata, and test artifacts." -ForegroundColor Gray
        Write-Host "  Source files, .git, .lovable, .release, spec/, and scripts/ are preserved." -ForegroundColor Gray
        if ($reinstall) {
            Write-Host "  Then .\run.ps1 will be relaunched with no flags." -ForegroundColor Gray
        }
        Write-Host ""
        $reply = Read-Host "  Proceed? Type 'y' or 'yes' to continue (anything else aborts)"
        if ($reply -inotmatch '^(y|yes)$') {
            Write-Host "  [abort] Uninstall cancelled by user." -ForegroundColor Red
            exit 1
        }
    }
    # ----- PHASE 1/2: UNINSTALL -----
    if ($reinstall) {
        Write-Host ""
        Write-Host "########################################" -ForegroundColor Magenta
        Write-Host "#  REINSTALL  ::  PHASE 1/2  ->  UNINSTALL" -ForegroundColor Magenta
        Write-Host "########################################" -ForegroundColor Magenta
    }
    if ($reportonly) {
        Write-Host ""
        Write-Host "########################################" -ForegroundColor DarkCyan
        Write-Host "#  UNINSTALL  ::  REPORT-ONLY (dry run)" -ForegroundColor DarkCyan
        Write-Host "#  No files will be deleted." -ForegroundColor DarkCyan
        Write-Host "########################################" -ForegroundColor DarkCyan
    }
    $phase1Sw = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-Uninstall -DryRun:$reportonly | Out-Null
    $phase1Sw.Stop()

    if ($uninstall -and -not $reinstall) {
        $TotalStopwatch.Stop()
        Write-Host "  Total time: $(Format-ElapsedTime $TotalStopwatch)" -ForegroundColor DarkGray
        exit 0
    }

    # ----- PHASE 2/2: FRESH BUILD via .\run.ps1 (no flags) -----
    Write-Host ""
    Write-Host "########################################" -ForegroundColor Cyan
    Write-Host "#  REINSTALL  ::  PHASE 1/2 COMPLETE" -ForegroundColor Cyan
    Write-Host "#    duration : $(Format-ElapsedTime $phase1Sw)" -ForegroundColor DarkCyan
    Write-Host "#  Handing off to PHASE 2/2  ->  .\run.ps1 (no flags)" -ForegroundColor Cyan
    Write-Host "########################################" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [reinstall] Phase 2 plan:" -ForegroundColor Cyan
    Write-Host "    1. Git pull         (latest sources)" -ForegroundColor Gray
    Write-Host "    2. Prerequisites    (node + pnpm)"     -ForegroundColor Gray
    Write-Host "    3. Build            (deps + standalone + extension)" -ForegroundColor Gray
    Write-Host "    4. Deploy           (skipped without -d)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  [reinstall] Launching child run.ps1 in 1s..." -ForegroundColor Cyan
    Start-Sleep -Seconds 1

    $selfPath = $MyInvocation.MyCommand.Path
    $phase2Sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $selfPath
    $childExit = $LASTEXITCODE
    $phase2Sw.Stop()

    Write-Host ""
    Write-Host "########################################" -ForegroundColor Magenta
    Write-Host "#  REINSTALL  ::  COMPLETE" -ForegroundColor Magenta
    Write-Host "#    Phase 1/2 (uninstall)  : $(Format-ElapsedTime $phase1Sw)" -ForegroundColor DarkMagenta
    Write-Host "#    Phase 2/2 (build)      : $(Format-ElapsedTime $phase2Sw)" -ForegroundColor DarkMagenta
    if ($childExit -eq 0) {
        Write-Host "#    Status                 : OK (exit 0)" -ForegroundColor Green
    } else {
        Write-Host "#    Status                 : FAIL (exit $childExit)" -ForegroundColor Red
    }
    Write-Host "########################################" -ForegroundColor Magenta
    Write-Host ""
    exit $childExit
}

# ============================================================================
# BANNER
# ============================================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  $ProjectName - Build & Deploy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($verboseMode) {
    Write-Host "Configuration:" -ForegroundColor Gray
    Write-Host "  Script Dir:    $ScriptDir" -ForegroundColor Gray
    Write-Host "  Extension Dir: $ExtensionDir" -ForegroundColor Gray
    Write-Host "  Dist Dir:      $DistDir" -ForegroundColor Gray
    Write-Host "  Browser:       $browser" -ForegroundColor Gray
    Write-Host "  Profile:       $TargetProfile" -ForegroundColor Gray
    Write-Host ""
}

# ============================================================================
# STEP 1: GIT PULL
# ============================================================================
$stepWatch = [System.Diagnostics.Stopwatch]::StartNew()
if (-not $skippull) {
    Write-Host "[1/4] Pulling latest changes from git..." -ForegroundColor Yellow
    Push-Location $RootDir
    try {
        if (Test-Path ".git") {
            git remote prune origin 2>&1 | Out-Null
            git pull 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  [WARN] git pull failed -- attempting fetch + reset..." -ForegroundColor Yellow
                git fetch origin 2>&1 | Out-Null
                $currentBranch = (git rev-parse --abbrev-ref HEAD 2>$null)
                if ($currentBranch) {
                    git reset --hard "origin/$currentBranch" 2>&1 | Out-Host
                    if ($LASTEXITCODE -eq 0) { Write-Host "  [OK] Recovered via fetch + reset" -ForegroundColor Green }
                    else { Write-Host "  [WARN] Recovery failed, continuing with local state..." -ForegroundColor Yellow }
                }
            } else { Write-Host "  [OK] Git pull complete" -ForegroundColor Green }
        } else { Write-Host "  Skipping (not a git repository)" -ForegroundColor Gray }
    } finally { Pop-Location }
} else { Write-Host "[1/4] Skipping git pull (-p)" -ForegroundColor Gray }
$stepWatch.Stop(); $StepTimes["Git Pull"] = $stepWatch.Elapsed
Write-Host "  Time: $(Format-ElapsedTime $stepWatch)" -ForegroundColor DarkGray
Write-Host ""

# ============================================================================
# STEP 2: PREREQUISITES
# ============================================================================
$stepWatch = [System.Diagnostics.Stopwatch]::StartNew()
Remove-PnpNodeOptions
Set-PnpmNonInteractiveEnvironment
Write-Host "[2/4] Checking prerequisites..." -ForegroundColor Yellow

if ($CheckNode) {
    if (-not (Test-Command "node")) { Install-NodeJS }
    $nodeVersion = node --version 2>&1
    $NodeMajor = Get-NodeMajorVersion $nodeVersion
    $SupportedMajors = @(18, 20, 22)

    if ($SupportedMajors -contains $NodeMajor) {
        Write-Host "  [OK] Node.js: $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Node.js: $nodeVersion (v$NodeMajor not a tested LTS)" -ForegroundColor Yellow
        if ($NodeMajor -lt $SupportedMajors[0]) { Write-Host "  ERROR: Too old. Upgrade to v22 LTS." -ForegroundColor Red; exit 1 }
        if ($strict) { Write-Host "  ERROR: Strict mode -- only v$($SupportedMajors -join '/') allowed." -ForegroundColor Red; exit 1 }
    }
}

if ($CheckPnpm) {
    if (-not (Test-Command "pnpm")) { Install-Pnpm }
    $pnpmVersion = pnpm --version 2>&1
    Write-Host "  [OK] pnpm: $pnpmVersion" -ForegroundColor Green
    $PnpmMajor = Get-PnpmMajorVersion $pnpmVersion
    $EffectiveInstallCommand = Get-EffectivePnpmInstallCommand $InstallCommand $PnpmMajor
    $EffectiveBuildCommand = Get-EffectivePnpmCommand $BuildCommand
    if ($force -and $EffectiveInstallCommand -match 'install' -and $EffectiveInstallCommand -notmatch '--force') {
        $EffectiveInstallCommand = "$EffectiveInstallCommand --force"
    }
    Configure-PnpmStore
    Configure-PnpMode
} else {
    if (-not (Test-Command "npm")) { Write-Host "  ERROR: npm not found." -ForegroundColor Red; exit 1 }
    Write-Host "  [OK] npm found" -ForegroundColor Green
}

$stepWatch.Stop(); $StepTimes["Prerequisites"] = $stepWatch.Elapsed
Write-Host "  Time: $(Format-ElapsedTime $stepWatch)" -ForegroundColor DarkGray
Write-Host ""

# ============================================================================
# PREFLIGHT CHECK (-pf)
# ============================================================================
if ($preflight) {
    $passed = Invoke-PreflightCheck
    $TotalStopwatch.Stop()
    Write-Host "  Time: $(Format-ElapsedTime $TotalStopwatch)" -ForegroundColor DarkGray
    exit $(if ($passed) { 0 } else { 1 })
}

# ============================================================================
# STEP 3: BUILD
# ============================================================================
$stepWatch = [System.Diagnostics.Stopwatch]::StartNew()

if (-not $skipbuild) {
    Push-Location $ExtensionDir
    try {
        # Force clean
        if ($force) {
            Write-Host "[3/4] FORCE MODE: Cleaning build artifacts..." -ForegroundColor Magenta
            $allCleanPaths = @($CleanPaths + @(".pnpm", ".pnp.loader.mjs", "pnpm-lock.yaml")) | Select-Object -Unique
            foreach ($cleanPath in $allCleanPaths) {
                if (Test-Path $cleanPath) { Remove-Item -Recurse -Force $cleanPath -ErrorAction SilentlyContinue }
            }
            Write-Host "  [OK] Clean complete" -ForegroundColor Magenta
            Write-Host ""
        }

        # Install extension dependencies
        Install-ExtensionDependencies

        # Manifest version info
        $manifestJsonPath = Join-Path $ExtensionDir "manifest.json"
        if (Test-Path $manifestJsonPath) {
            $rawManifest = Get-Content $manifestJsonPath -Raw | ConvertFrom-Json
            $displayVersion = if ($rawManifest.version_name) { $rawManifest.version_name } else { $rawManifest.version }
            Write-Host "  [INFO] Version: $displayVersion [$($rawManifest.version)]" -ForegroundColor Cyan
        }

        # Aggregate prompts
        $aggregateScript = Join-Path $RootDir "scripts\aggregate-prompts.mjs"
        if (Test-Path $aggregateScript) {
            Write-Host "  Aggregating prompts..." -ForegroundColor Yellow
            Push-Location $RootDir
            try {
                $aggregateResult = node $aggregateScript 2>&1
                if ($LASTEXITCODE -ne 0) { throw "FATAL: Prompt aggregation failed." }
                Write-Host "  [OK] Prompts aggregated" -ForegroundColor Green
            } finally { Pop-Location }
        }

        # Root-level deps for standalone builds
        Install-RootBuildDependencies $RootDir

        # Build standalone scripts IN PARALLEL
        # -d (deploy) = development mode (inline source maps); default = production (no source maps)
        $standaloneBuildMode = if ($deploy) { "development" } else { "production" }
        Push-Location $RootDir
        try { Build-AllStandaloneScripts $RootDir $standaloneBuildMode }
        finally { Pop-Location }

        # Verify standalone dist artifacts
        $artifactsOk = Test-StandaloneDistArtifacts $RootDir
        if (-not $artifactsOk) { exit 3 }

        # Node.js build guards (parallel)
        Write-Host "  Running build guards..." -ForegroundColor Gray
        Push-Location $RootDir
        try {
            $guardScripts = @(
                "scripts/check-standalone-dist.mjs",
                "scripts/check-legacy-sync.mjs",
                "scripts/check-sdk-dist-freshness.mjs",
                "scripts/check-xpath-dist-freshness.mjs"
            )
            $guardJobs = @()
            foreach ($gs in $guardScripts) {
                $guardJobs += Start-Job -ScriptBlock {
                    param($Dir, $Script)
                    Set-Location $Dir
                    $output = node $Script 2>&1
                    @{ Script = $Script; ExitCode = $LASTEXITCODE; Output = ($output | Out-String) }
                } -ArgumentList $RootDir, $gs
            }

            $guardFailed = @()
            foreach ($gj in $guardJobs) {
                $gr = Receive-Job -Job $gj -Wait -AutoRemoveJob -ErrorAction SilentlyContinue
                if ($null -ne $gr -and $gr.ExitCode -ne 0) {
                    $guardFailed += $gr.Script
                    Write-Host "  [FAIL] $($gr.Script)" -ForegroundColor Red
                    if ($gr.Output) { Write-Host $gr.Output -ForegroundColor DarkGray }
                } elseif ($null -ne $gr) {
                    if ($gr.Output -and $gr.Output.Trim().Length -gt 0) { Write-Host $gr.Output.Trim() }
                }
            }

            if ($guardFailed.Count -gt 0) {
                Write-Host "  [FAIL] Build guard(s) failed: $($guardFailed -join ', ')" -ForegroundColor Red
                exit 3
            }
            Write-Host "  [OK] All build guards passed" -ForegroundColor Green
        } finally { Pop-Location }

        # Build extension
        Build-Extension
    }
    finally { Pop-Location }
} else {
    Write-Host "[3/4] Skipping build (-s)" -ForegroundColor Gray
}

$stepWatch.Stop(); $StepTimes["Build"] = $stepWatch.Elapsed
Write-Host "  Time: $(Format-ElapsedTime $stepWatch)" -ForegroundColor DarkGray
Write-Host ""

# ============================================================================
# STEP 4: DEPLOY
# ============================================================================
$stepWatch = [System.Diagnostics.Stopwatch]::StartNew()

if ($deploy -or $directmode) {
    Write-Host "[4/4] Deploying to $browser profile..." -ForegroundColor Yellow

    if ($verboseMode) {
        Write-Host "  Available profiles:" -ForegroundColor Gray
        $profiles = Get-AvailableProfiles
        foreach ($p in $profiles) {
            $marker = if ($p.Folder -eq $TargetProfile -or $p.Name -eq $TargetProfile) { "-> " } else { "   " }
            Write-Host "  $marker$($p.Folder): $($p.Name)" -ForegroundColor Gray
        }
        Write-Host ""
    }

    $profileFolder = Find-ProfileFolder $TargetProfile
    if (-not $profileFolder -and -not $directmode) {
        Write-Host "  ERROR: Profile '$TargetProfile' not found" -ForegroundColor Red
        $profiles = Get-AvailableProfiles
        foreach ($p in $profiles) { Write-Host "    $($p.Folder) -> $($p.Name)" -ForegroundColor Gray }
        exit 1
    }

    Deploy-Extension -ProfileFolder $(if ($directmode) { "Direct" } else { $profileFolder })
} else {
    Write-Host "[4/4] Skipping deploy (use -d to deploy)" -ForegroundColor Gray
}

$stepWatch.Stop(); $StepTimes["Deploy"] = $stepWatch.Elapsed
Write-Host ""

# ============================================================================
# WATCH MODE
# ============================================================================
if ($watch) { Start-WatchMode }

# ============================================================================
# SUMMARY
# ============================================================================
$TotalStopwatch.Stop()
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  $ProjectName -- Build Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Version
$builtManifestPath = Join-Path (Join-Path $ExtensionDir $DistDir) "manifest.json"
$sourceManifestPath = Join-Path $ExtensionDir "manifest.json"
$summaryManifestPath = if (Test-Path $builtManifestPath) { $builtManifestPath } else { $sourceManifestPath }
$summaryVersion = "unknown"
$summaryVersionName = $null
if (Test-Path $summaryManifestPath) {
    try {
        $summaryManifest = Get-Content $summaryManifestPath -Raw | ConvertFrom-Json
        $summaryVersion = $summaryManifest.version
        if ($summaryManifest.version_name) {
            $summaryVersionName = $summaryManifest.version_name
        }
    } catch {}
}
if ($summaryVersionName) {
    Write-Host "  Version:     $summaryVersionName [$summaryVersion]" -ForegroundColor White
} else {
    Write-Host "  Version:     $summaryVersion" -ForegroundColor White
}

# Sourcemaps (extension)
if ($nosourcemap) {
    Write-Host "  Sourcemaps:  DISABLED (extension)" -ForegroundColor Yellow
} else {
    Write-Host "  Sourcemaps:  ENABLED (extension)" -ForegroundColor Green
}

# Standalone scripts build mode
if (-not $skipbuild) {
    $smMode = if ($deploy) { "development" } else { "production" }
    $smStatus = if ($deploy) { "INLINE (dev)" } else { "NONE (prod)" }
    $smColor = if ($deploy) { "Green" } else { "Yellow" }
    Write-Host "  Standalone:  mode=$smMode | sourcemaps=$smStatus" -ForegroundColor $smColor
}

# Deploy status
if ($deploy -or $directmode) {
    Write-Host "  Deploy:      YES" -ForegroundColor Green
    if ($script:LastDeployTarget) { Write-Host "  Target:      $($script:LastDeployTarget)" -ForegroundColor White }
    if ($script:LastDeployMode) { Write-Host "  Method:      $($script:LastDeployMode)" -ForegroundColor Green }
    if ($script:LastDeployNote) { Write-Host "  Note:        $($script:LastDeployNote)" -ForegroundColor Gray }
    if ($script:LastDeployPath) { Write-Host "  Dist path:   $($script:LastDeployPath)" -ForegroundColor Gray }
} else {
    Write-Host "  Deploy:      SKIPPED (use -d to deploy)" -ForegroundColor Yellow
}

# Git pull
if ($skippull) {
    Write-Host "  Git pull:    SKIPPED" -ForegroundColor Gray
} else {
    Write-Host "  Git pull:    YES" -ForegroundColor Green
}

# Build
if ($skipbuild) {
    Write-Host "  Build:       SKIPPED" -ForegroundColor Gray
} else {
    Write-Host "  Build:       YES" -ForegroundColor Green
}

# Flags used
$activeFlags = @()
if ($quick)       { $activeFlags += "-q (quick)" }
if ($force)       { $activeFlags += "-f (force)" }
if ($nosourcemap) { $activeFlags += "-nsm" }
if ($skippull)    { $activeFlags += "-p" }
if ($skipbuild)   { $activeFlags += "-s" }
if ($deploy)      { $activeFlags += "-d" }
if ($directmode)  { $activeFlags += "-dm" }
if ($watch)       { $activeFlags += "-w" }
if ($verboseMode)     { $activeFlags += "-v" }
if ($activeFlags.Count -gt 0) {
    Write-Host "  Flags:       $($activeFlags -join ', ')" -ForegroundColor Gray
} else {
    Write-Host "  Flags:       (none)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  Step Timing:" -ForegroundColor Yellow
foreach ($step in $StepTimes.GetEnumerator()) {
    Write-Host "    $($step.Key): $("{0:N1}s" -f $step.Value.TotalSeconds)" -ForegroundColor Gray
}
Write-Host "  Total: $(Format-ElapsedTime $TotalStopwatch)" -ForegroundColor Cyan

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not $deploy -and -not $directmode) {
    Write-Host "TIP: Use -d to deploy to Chrome, or -dm for direct loading" -ForegroundColor Yellow
    Write-Host "     .\run.ps1 -d              # Deploy to default profile" -ForegroundColor Gray
    Write-Host "     .\run.ps1 -d -pr 'Work'   # Deploy to 'Work' profile" -ForegroundColor Gray
    Write-Host "     .\run.ps1 -dm              # Direct mode (dev)" -ForegroundColor Gray
    Write-Host ""
}

exit 0
