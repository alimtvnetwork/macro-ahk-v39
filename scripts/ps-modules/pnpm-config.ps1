<#
.SYNOPSIS
    pnpm store, PnP mode, and NODE_OPTIONS configuration.

.DESCRIPTION
    Handles cross-drive store detection, .npmrc generation, PnP loader
    injection into NODE_OPTIONS, and cleanup of stale PnP references.
#>

<#
.SYNOPSIS
    Sets the pnpm content-addressable store path for the extension project.
.DESCRIPTION
    Runs inside $ExtensionDir with --ignore-workspace to avoid workspace leakage.
#>
function Configure-PnpmStore {
    Assert-ExtensionDirExists -CallerName "Configure-PnpmStore"

    Write-Host "  Configuring pnpm store: $script:PnpmStorePath" -ForegroundColor Gray

    Push-Location $script:ExtensionDir
    try {
        pnpm --ignore-workspace config set --location=project store-dir $script:PnpmStorePath 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  WARNING: Failed to set pnpm store path" -ForegroundColor Yellow
        } else {
            Write-Host "  [OK] pnpm store -> $($script:PnpmStorePath)" -ForegroundColor Green
        }
    } finally {
        Pop-Location
    }
}

<#
.SYNOPSIS
    Configures the node linker mode (PnP vs isolated) and writes .npmrc.
.DESCRIPTION
    Detects cross-drive scenarios (project on C:, store on E:) and Node v24+
    incompatibilities, falling back to isolated linker when needed. Generates
    .npmrc with the correct settings and only writes if content changed.
#>
function Configure-PnpMode {
    Assert-ExtensionDirExists -CallerName "Configure-PnpMode"

    $projectDrive = Get-DriveRoot $script:ExtensionDir
    $storeDrive = Get-DriveRoot $script:PnpmStorePath
    $isCrossDrive = -not [string]::IsNullOrWhiteSpace($projectDrive) -and -not [string]::IsNullOrWhiteSpace($storeDrive) -and ($projectDrive -ne $storeDrive)

    if (-not $script:UsePnp -or $script:NodeMajor -ge 24 -or $isCrossDrive) {
        $script:EffectiveNodeLinker = "isolated"

        if ($script:UsePnp) {
            $fallbackReason = if ($script:NodeMajor -ge 24 -and $isCrossDrive) {
                "Node v$($script:NodeMajor) / cross-drive store"
            } elseif ($script:NodeMajor -ge 24) {
                "Node v$($script:NodeMajor)"
            } else {
                "cross-drive store"
            }
            Write-Host "  NOTE: Falling back to node-linker=isolated ($fallbackReason)." -ForegroundColor Yellow
        }
    } else {
        $script:EffectiveNodeLinker = "pnp"
        Write-Host "  Enabling pnpm Plug'n'Play (PnP) mode..." -ForegroundColor Gray
    }

    $npmrcPath = Join-Path $script:ExtensionDir ".npmrc"

    if ($isCrossDrive) {
        $npmrcContent = @(
            "node-linker=$($script:EffectiveNodeLinker)",
            "symlink=true",
            "package-import-method=copy",
            "virtual-store-dir=node_modules/.pnpm",
            "verify-deps-before-run=false",
            "confirm-modules-purge=false"
        ) -join "`n"
    } elseif ($script:EffectiveNodeLinker -eq "pnp") {
        $npmrcContent = @(
            "node-linker=pnp",
            "symlink=false",
            "package-import-method=auto",
            "verify-deps-before-run=false",
            "confirm-modules-purge=false"
        ) -join "`n"
    } else {
        $npmrcContent = @(
            "node-linker=isolated",
            "symlink=true",
            "package-import-method=auto",
            "verify-deps-before-run=false",
            "confirm-modules-purge=false"
        ) -join "`n"
    }

    $hasNpmrcBefore = Test-Path $npmrcPath
    $existingNpmrcContent = if ($hasNpmrcBefore) { Get-Content $npmrcPath -Raw } else { "" }
    $normalizedExisting = $existingNpmrcContent -replace "`r`n", "`n"
    $normalizedTarget = $npmrcContent -replace "`r`n", "`n"
    $isNpmrcChanged = $normalizedExisting -ne $normalizedTarget

    if ($isNpmrcChanged) {
        Set-Content -Path $npmrcPath -Value $npmrcContent -Force
        $npmrcState = if ($hasNpmrcBefore) { "updated" } else { "created" }
        Write-Host "  [OK] pnpm linker configured: $($script:EffectiveNodeLinker)$(if ($isCrossDrive) { ' (copy mode)' }) (.npmrc $npmrcState)" -ForegroundColor Green
    } else {
        Write-Host "  [OK] pnpm linker unchanged: $($script:EffectiveNodeLinker)$(if ($isCrossDrive) { ' (copy mode)' })" -ForegroundColor Green
    }
}

<#
.SYNOPSIS
    Removes stale PnP --require options from NODE_OPTIONS.
.DESCRIPTION
    Prevents conflicts when switching between PnP and isolated linker modes.
#>
function Remove-PnpNodeOptions {
    $hasNodeOptions = -not [string]::IsNullOrWhiteSpace($env:NODE_OPTIONS)
    if (-not $hasNodeOptions) { return }

    $cleanedNodeOptions = $env:NODE_OPTIONS -replace '(?i)\s*--require(?:=|\s+)(?:"[^"]*\.pnp\.cjs"|''[^'']*\.pnp\.cjs''|[^\s]+\.pnp\.cjs)\s*', ' '
    $env:NODE_OPTIONS = $cleanedNodeOptions.Trim()
}

<#
.SYNOPSIS
    Injects the PnP loader (.pnp.cjs) into NODE_OPTIONS if PnP mode is active.
.DESCRIPTION
    Only runs when UsePnp is true AND the effective linker is "pnp" AND
    the .pnp.cjs manifest exists in the extension directory.
#>
function Configure-PnpNodeOptions {
    if (-not $script:UsePnp -or $script:EffectiveNodeLinker -ne "pnp") { return }

    $pnpManifestPath = Join-Path $script:ExtensionDir ".pnp.cjs"
    $hasPnpManifest = Test-Path $pnpManifestPath
    if (-not $hasPnpManifest) { return }

    Remove-PnpNodeOptions

    $resolvedPnpManifestPath = (Resolve-Path $pnpManifestPath).Path
    $pnpManifestForNode = $resolvedPnpManifestPath -replace '\\', '/'
    $pnpRequireOption = "--require=$pnpManifestForNode"
    $hasNodeOptions = -not [string]::IsNullOrWhiteSpace($env:NODE_OPTIONS)
    if ($hasNodeOptions) {
        $env:NODE_OPTIONS = "$pnpRequireOption $($env:NODE_OPTIONS)"
    } else {
        $env:NODE_OPTIONS = $pnpRequireOption
    }

    if ($script:verbose) {
        Write-Host "  [OK] PnP loader enabled via NODE_OPTIONS" -ForegroundColor Green
    }
}
