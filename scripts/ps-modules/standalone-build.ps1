<#
.SYNOPSIS
    Parallel standalone script compilation pipeline.

.DESCRIPTION
    Discovers standalone script projects under standalone-scripts/,
    compiles their assets (LESS, templates, instruction.ts) and TypeScript
    bundles. Supports PARALLEL execution via PowerShell jobs for faster builds.
#>

<#
.SYNOPSIS
    Builds a single standalone script project (LESS, templates, instruction, TS).
.DESCRIPTION
    Handles all sub-steps for one project: LESS compilation, template
    compilation, instruction.ts -> instruction.json, and npm run build:<name>.
    Designed to run both inline and inside a Start-Job scriptblock.
.PARAMETER ScriptDirPath
    Full path to the standalone script folder (e.g. standalone-scripts/macro-controller).
.PARAMETER ScriptName
    The folder name (e.g. "macro-controller").
.PARAMETER RootDir
    The repository root directory.
.OUTPUTS
    Hashtable with keys: Name, Success, Output (array of log lines).
#>
function Build-StandaloneScript([string]$ScriptDirPath, [string]$ScriptName, [string]$RootDir, [string]$BuildMode = "production") {
    $output = @()
    $success = $true

    # ── instruction.ts -> instruction.json ──
    # Compile this before asset steps so LESS/templates can use the declared
    # artifact filenames from instruction.json on a fresh checkout.
    $srcDir = Join-Path $ScriptDirPath "src"
    $instructionTs = Join-Path $srcDir "instruction.ts"
    if (Test-Path $instructionTs) {
        $scriptDistDir = Join-Path $ScriptDirPath "dist"
        if (-not (Test-Path $scriptDistDir)) { New-Item -ItemType Directory -Path $scriptDistDir -Force | Out-Null }
        $compileInstrScript = Join-Path $RootDir "scripts\compile-instruction.mjs"
        if (Test-Path $compileInstrScript) {
            $output += "  Compiling instruction.ts -> instruction.json"
            $instrResult = node $compileInstrScript "standalone-scripts/$ScriptName" 2>&1
            if ($LASTEXITCODE -ne 0) {
                $output += "  [WARN] instruction.ts compilation failed"
                foreach ($line in $instrResult) { $output += "    $line" }
            } else {
                $output += "  [OK] instruction.json compiled"
            }
        }
    }

    # ── TypeScript -> JS (direct Node runner; no nested npm/pnpm run) ──
    # Run BEFORE LESS/templates: cached-build wipes dist/ on cache HIT and
    # restores from snapshot, so any pre-build assets would be lost. By
    # running asset compilation AFTER, the assets always overlay dist/
    # regardless of cache HIT or MISS. (instruction.json is hashed via
    # instruction.ts so it is correctly part of the cache key.)
    Push-Location $RootDir
    $previousBuildMode = $env:BUILD_MODE
    try {
        $env:BUILD_MODE = $BuildMode
        $output += "  Building TypeScript bundle (mode: $BuildMode)..."
        $cachedBuildScript = Join-Path $RootDir "scripts\cached-build.mjs"
        $standaloneBuildStepScript = "scripts/run-standalone-build-step.mjs"
        $buildResult = & node $cachedBuildScript "--name=$ScriptName" "--mode=$BuildMode" "--" "node" $standaloneBuildStepScript "--project=$ScriptName" "--mode=$BuildMode" 2>&1
        $buildExitCode = $LASTEXITCODE
        if ($buildExitCode -ne 0) {
            $output += "  [FAIL] build:$ScriptName failed (exit $buildExitCode)"
            foreach ($line in $buildResult) { $output += "    $line" }
            $success = $false
        } else {
            $output += "  [OK] build:$ScriptName complete ($BuildMode)"
        }
    } finally {
        $env:BUILD_MODE = $previousBuildMode
        Pop-Location
    }

    # ── LESS -> CSS (post-bundle: overlays dist/ after cache restore) ──
    $lessDir = Join-Path $ScriptDirPath "less"
    if (Test-Path $lessDir) {
        $lessIndex = Join-Path $lessDir "index.less"
        if (Test-Path $lessIndex) {
            $scriptDistDir = Join-Path $ScriptDirPath "dist"
            if (-not (Test-Path $scriptDistDir)) { New-Item -ItemType Directory -Path $scriptDistDir -Force | Out-Null }
            $cssOutName = "$ScriptName.css"
            $instrJsonPath = Join-Path $scriptDistDir "instruction.json"
            if (Test-Path $instrJsonPath) {
                $instrJson = Get-Content $instrJsonPath -Raw | ConvertFrom-Json
                if ($instrJson.assets -and $instrJson.assets.css -and $instrJson.assets.css.Count -gt 0) {
                    $cssOutName = $instrJson.assets.css[0].file
                }
            }
            $cssOut = Join-Path $scriptDistDir $cssOutName
            $output += "  Compiling LESS -> $cssOutName"
            $compileLessScript = Join-Path $RootDir "scripts\compile-less.mjs"
            $lessResult = node $compileLessScript $lessIndex $cssOut 2>&1
            if ($LASTEXITCODE -ne 0) {
                $output += "  [FAIL] LESS compilation failed"
                foreach ($line in $lessResult) { $output += "    $line" }
                $success = $false
            } else {
                $output += "  [OK] LESS compiled"
            }
        }
    }

    # ── Templates -> JSON (post-bundle: overlays dist/ after cache restore) ──
    $tplDir = Join-Path $ScriptDirPath "templates"
    if (Test-Path $tplDir) {
        $scriptDistDir = Join-Path $ScriptDirPath "dist"
        if (-not (Test-Path $scriptDistDir)) { New-Item -ItemType Directory -Path $scriptDistDir -Force | Out-Null }
        $compileScript = Join-Path $RootDir "scripts\compile-templates.mjs"
        if (Test-Path $compileScript) {
            $tplOut = Join-Path $scriptDistDir "templates.json"
            $instrJsonPath = Join-Path $scriptDistDir "instruction.json"
            if (Test-Path $instrJsonPath) {
                $instrJson = Get-Content $instrJsonPath -Raw | ConvertFrom-Json
                if ($instrJson.assets -and $instrJson.assets.templates -and $instrJson.assets.templates.Count -gt 0) {
                    $tplOut = Join-Path $scriptDistDir $instrJson.assets.templates[0].file
                }
            }
            $output += "  Compiling templates -> templates.json"
            $tplResult = node $compileScript $tplDir $tplOut 2>&1
            if ($LASTEXITCODE -ne 0) {
                $output += "  [FAIL] Template compilation failed"
                foreach ($line in $tplResult) { $output += "    $line" }
                $success = $false
            } else {
                $output += "  [OK] Templates compiled"
            }
        }
    }

    return @{
        Name    = $ScriptName
        Success = $success
        Output  = $output
    }
}

<#
.SYNOPSIS
    Discovers and builds all standalone scripts in parallel.
.DESCRIPTION
    Scans standalone-scripts/ for folders with src/ subdirectories,
    launches parallel PowerShell jobs for each, and collects results.
    Falls back to sequential build if parallel jobs fail.
.PARAMETER RootDir
    The repository root directory.
.OUTPUTS
    Int — number of successfully built scripts. Throws on fatal failure.
#>
function Build-AllStandaloneScripts([string]$RootDir, [string]$BuildMode = "production") {
    Write-Host "  Building standalone scripts (parallel, mode: $BuildMode)..." -ForegroundColor Yellow

    $standaloneDir = Join-Path $RootDir "standalone-scripts"

    # Clear shared TypeScript / Vite caches exactly once before fan-out.
    # Removing node_modules caches inside each parallel job is unsafe: one job
    # can delete .vite/.cache while another job is running tsc/vite, producing
    # intermittent marco-sdk/xpath failures with little or no inner diagnostic.
    $tsBuildInfo = Join-Path $RootDir "tsconfig.macro.build.tsbuildinfo"
    if (Test-Path $tsBuildInfo) { Remove-Item $tsBuildInfo -Force -ErrorAction SilentlyContinue }
    $nodeCacheDir = Join-Path $RootDir "node_modules/.cache"
    if (Test-Path $nodeCacheDir) { Remove-Item $nodeCacheDir -Recurse -Force -ErrorAction SilentlyContinue }
    $viteCacheDir = Join-Path $RootDir "node_modules/.vite"
    if (Test-Path $viteCacheDir) { Remove-Item $viteCacheDir -Recurse -Force -ErrorAction SilentlyContinue }

    $scriptDirs = Get-ChildItem -Path $standaloneDir -Directory -ErrorAction SilentlyContinue | Where-Object {
        Test-Path (Join-Path $_.FullName "src")
    }

    if ($scriptDirs.Count -eq 0) {
        Write-Host "  [INFO] No standalone scripts with src/ found" -ForegroundColor Gray
        return 0
    }

    # ── Launch parallel jobs ──
    $jobs = @()
    $thisModulePath = $PSCommandPath

    foreach ($dir in $scriptDirs) {
        $scriptName = $dir.Name
        $scriptPath = $dir.FullName
        Write-Host "    [START] $scriptName ($BuildMode)" -ForegroundColor DarkCyan

        $job = Start-Job -ScriptBlock {
            param($ModulePath, $ScriptDirPath, $ScriptName, $RootDir, $Mode)
            . $ModulePath
            Build-StandaloneScript -ScriptDirPath $ScriptDirPath -ScriptName $ScriptName -RootDir $RootDir -BuildMode $Mode
        } -ArgumentList $thisModulePath, $scriptPath, $scriptName, $RootDir, $BuildMode

        $jobs += $job
    }

    # ── Wait and collect results ──
    $allResults = @()
    $failedScripts = @()
    $timeout = 120  # seconds per job

    foreach ($job in $jobs) {
        $result = Receive-Job -Job $job -Wait -AutoRemoveJob -ErrorAction SilentlyContinue
        if ($null -eq $result) {
            # Job failed entirely — fallback info
            $failedScripts += "unknown (job $($job.Id))"
            continue
        }
        $allResults += $result

        # Print collected output
        Write-Host "    [$($result.Name)]" -ForegroundColor $(if ($result.Success) { "Green" } else { "Red" })
        foreach ($line in $result.Output) {
            $color = "DarkCyan"
            if ($line -match '\[OK\]') { $color = "Green" }
            elseif ($line -match '\[FAIL\]') { $color = "Red" }
            elseif ($line -match '\[WARN\]') { $color = "Yellow" }
            Write-Host "      $line" -ForegroundColor $color
        }

        if (-not $result.Success) {
            $failedScripts += $result.Name
        }
    }

    # ── Report ──
    $builtCount = ($allResults | Where-Object { $_.Success }).Count

    if ($failedScripts.Count -gt 0) {
        throw "FATAL: Standalone script(s) failed to build: $($failedScripts -join ', '). Fix the build error(s) above."
    }

    if ($builtCount -gt 0) {
        Write-Host "  [OK] $builtCount standalone script(s) compiled (parallel)" -ForegroundColor Green
    }

    return $builtCount
}

<#
.SYNOPSIS
    Verifies that all required standalone dist artifacts exist and are valid.
.DESCRIPTION
    Checks each project in the standaloneArtifacts config for the presence
    and minimum size of its dist/ output files.
.PARAMETER RootDir
    The repository root directory.
.OUTPUTS
    Boolean — $true if all artifacts are present and valid.
#>
function Test-StandaloneDistArtifacts([string]$RootDir) {
    Write-Host "  Verifying standalone dist artifacts..." -ForegroundColor Gray
    $standaloneDir = Join-Path $RootDir "standalone-scripts"
    $requiredArtifacts = @{
        "marco-sdk"        = @("marco-sdk.js")
        "macro-controller" = @("macro-looping.js", "macro-looping.css")
        "xpath"            = @("xpath.js")
    }
    $guardFailed = $false

    foreach ($project in $requiredArtifacts.Keys) {
        $distPath = Join-Path $standaloneDir "$project/dist"
        if (-not (Test-Path $distPath)) {
            Write-Host "  [FAIL] $project/dist/ does not exist" -ForegroundColor Red
            $guardFailed = $true
            continue
        }
        foreach ($file in $requiredArtifacts[$project]) {
            $filePath = Join-Path $distPath $file
            if (-not (Test-Path $filePath)) {
                Write-Host "  [FAIL] $project/dist/$file is missing" -ForegroundColor Red
                $guardFailed = $true
            } elseif ((Get-Item $filePath).Length -lt 100) {
                Write-Host "  [FAIL] $project/dist/$file is suspiciously small ($((Get-Item $filePath).Length) bytes)" -ForegroundColor Red
                $guardFailed = $true
            }
        }
    }

    if ($guardFailed) {
        Write-Host "  [FAIL] Standalone dist artifacts missing or stale." -ForegroundColor Red
        return $false
    }

    Write-Host "  [OK] All standalone dist artifacts verified" -ForegroundColor Green
    return $true
}
