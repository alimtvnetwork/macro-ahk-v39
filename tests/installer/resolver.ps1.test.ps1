# ─────────────────────────────────────────────────────────────────────
# Marco Extension — install.ps1 Resolver Test Suite (AC-2 focus)
#
# Mirrors the AC-2 sub-tests in tests/installer/resolver.test.sh /
# tests/installer/mock-server.test.sh but targets scripts/install.ps1.
#
# Coverage:
#   AC-2a  200 OK + empty body (no tag_name)        → main-branch sentinel
#   AC-2b  200 OK + body without tag_name field     → main-branch sentinel
#   AC-2c  404 Not Found                            → main-branch sentinel
#   AC-2d  500 Internal Server Error                → exit 5
#   AC-2e  Network failure (no Response on Exception) → exit 5
#   AC-2f  200 OK + tag_name present                → returns tag
#
# Mechanism
# ---------
# Dot-sources install.ps1 with MARCO_INSTALLER_TEST_MODE=1 so its
# functions become available without auto-running Main. Then redefines
# Invoke-WebRequest in the script scope to a controllable mock so the
# suite never touches the network. exit-5 paths are caught via PowerShell
# trap that converts the exit into an exception we can assert on.
#
# Run:  pwsh -NoProfile -File tests/installer/resolver.ps1.test.ps1
# ─────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
$script:Pass = 0
$script:Fail = 0
$script:FailLines = @()

function Assert-Eq($name, $expected, $actual) {
    if ("$expected" -ceq "$actual") {
        Write-Host "  ✓ $name" -ForegroundColor Green
        $script:Pass++
    } else {
        Write-Host "  ✗ $name" -ForegroundColor Red
        Write-Host "      expected: $expected" -ForegroundColor DarkGray
        Write-Host "      actual:   $actual"   -ForegroundColor DarkGray
        $script:Fail++
        $script:FailLines += $name
    }
}

# Locate installer relative to this test file.
$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot  = Resolve-Path (Join-Path $scriptDir '..\..')
$installer = Join-Path $repoRoot 'scripts\install.ps1'
if (-not (Test-Path -LiteralPath $installer)) {
    Write-Host "✗ Installer not found at $installer" -ForegroundColor Red
    exit 2
}

# Dot-source under test mode so Main does NOT auto-run.
$env:MARCO_INSTALLER_TEST_MODE = '1'
. $installer

# ── Mocking layer ────────────────────────────────────────────────────
# Each test sets $script:MockBehavior to one of:
#   'tag'     — return 200 with { tag_name = 'v1.2.3' }
#   'empty'   — return 200 with {}
#   'no-tag'  — return 200 with { other_field = 'x' }
#   '404'     — throw with Response.StatusCode = 404
#   '500'     — throw with Response.StatusCode = 500
#   'network' — throw with no Response object (DNS/timeout-style failure)

function New-MockHttp404 {
    $resp = [pscustomobject]@{ StatusCode = 404 }
    $exc  = New-Object System.Exception("HTTP 404 Not Found")
    Add-Member -InputObject $exc -MemberType NoteProperty -Name Response -Value $resp -Force
    throw $exc
}
function New-MockHttp500 {
    $resp = [pscustomobject]@{ StatusCode = 500 }
    $exc  = New-Object System.Exception("HTTP 500 Internal Server Error")
    Add-Member -InputObject $exc -MemberType NoteProperty -Name Response -Value $resp -Force
    throw $exc
}
function New-MockNetwork {
    throw (New-Object System.Net.WebException("getaddrinfo: nodename nor servname provided"))
}

function Invoke-WebRequest {
    [CmdletBinding()] param([Parameter(ValueFromRemainingArguments=$true)]$ignored)
    switch ($script:MockBehavior) {
        'tag'     { return [pscustomobject]@{ Content = '{"tag_name":"v1.2.3"}' } }
        'empty'   { return [pscustomobject]@{ Content = '{}' } }
        'no-tag'  { return [pscustomobject]@{ Content = '{"other_field":"x"}' } }
        '404'     { New-MockHttp404 }
        '500'     { New-MockHttp500 }
        'network' { New-MockNetwork }
        default   { throw "MockBehavior not set: '$script:MockBehavior'" }
    }
}

# Capture exit codes from Get-LatestVersion without killing the test
# process. We wrap with a try/catch around a helper that re-throws on
# exit(); the installer calls `exit 5` directly so we shim that by
# overriding the exit invocation through a script-block runner.

function Invoke-LatestVersionCaptured {
    # Run in a child pwsh process so `exit 5` doesn't kill us.
    $bootstrap = @"
`$env:MARCO_INSTALLER_TEST_MODE = '1'
. '$installer'
function Invoke-WebRequest { param([Parameter(ValueFromRemainingArguments=`$true)]`$ignored)
    switch ('$($script:MockBehavior)') {
        'tag'     { return [pscustomobject]@{ Content = '{"tag_name":"v1.2.3"}' } }
        'empty'   { return [pscustomobject]@{ Content = '{}' } }
        'no-tag'  { return [pscustomobject]@{ Content = '{"other_field":"x"}' } }
        '404'     {
            `$resp = [pscustomobject]@{ StatusCode = 404 }
            `$exc  = New-Object System.Exception('HTTP 404')
            Add-Member -InputObject `$exc -MemberType NoteProperty -Name Response -Value `$resp -Force
            throw `$exc
        }
        '500'     {
            `$resp = [pscustomobject]@{ StatusCode = 500 }
            `$exc  = New-Object System.Exception('HTTP 500')
            Add-Member -InputObject `$exc -MemberType NoteProperty -Name Response -Value `$resp -Force
            throw `$exc
        }
        'network' { throw (New-Object System.Net.WebException('DNS failure')) }
    }
}
try { Get-LatestVersion } catch { Write-Host "EXCEPTION:`$_" }
"@
    $out = & pwsh -NoProfile -NoLogo -Command $bootstrap 2>&1
    return @{ ExitCode = $LASTEXITCODE; Output = ($out -join "`n") }
}

# ── Tests ────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "▸ AC-2a — 200 OK + empty body → main-branch sentinel" -ForegroundColor Cyan
$script:MockBehavior = 'empty'
$r = Invoke-LatestVersionCaptured
Assert-Eq 'AC-2a exit code'             '0'              $r.ExitCode
Assert-Eq 'AC-2a returns sentinel'      $true            ($r.Output -match '__MAIN_BRANCH__')

Write-Host ""
Write-Host "▸ AC-2b — 200 OK + no tag_name field → main-branch sentinel" -ForegroundColor Cyan
$script:MockBehavior = 'no-tag'
$r = Invoke-LatestVersionCaptured
Assert-Eq 'AC-2b exit code'             '0'              $r.ExitCode
Assert-Eq 'AC-2b returns sentinel'      $true            ($r.Output -match '__MAIN_BRANCH__')

Write-Host ""
Write-Host "▸ AC-2c — 404 Not Found → main-branch sentinel" -ForegroundColor Cyan
$script:MockBehavior = '404'
$r = Invoke-LatestVersionCaptured
Assert-Eq 'AC-2c exit code'             '0'              $r.ExitCode
Assert-Eq 'AC-2c returns sentinel'      $true            ($r.Output -match '__MAIN_BRANCH__')

Write-Host ""
Write-Host "▸ AC-2d — 500 Internal Server Error → exit 5" -ForegroundColor Cyan
$script:MockBehavior = '500'
$r = Invoke-LatestVersionCaptured
Assert-Eq 'AC-2d exit code'             '5'              $r.ExitCode
Assert-Eq 'AC-2d spec §2.3 mentioned'   $true            ($r.Output -match 'Spec §2\.3')

Write-Host ""
Write-Host "▸ AC-2e — Network failure (no Response) → exit 5" -ForegroundColor Cyan
$script:MockBehavior = 'network'
$r = Invoke-LatestVersionCaptured
Assert-Eq 'AC-2e exit code'             '5'              $r.ExitCode
Assert-Eq 'AC-2e spec §2.3 mentioned'   $true            ($r.Output -match 'Spec §2\.3')

Write-Host ""
Write-Host "▸ AC-2f — 200 OK + tag_name → returns tag" -ForegroundColor Cyan
$script:MockBehavior = 'tag'
$r = Invoke-LatestVersionCaptured
Assert-Eq 'AC-2f exit code'             '0'              $r.ExitCode
Assert-Eq 'AC-2f returns tag'           $true            ($r.Output -match 'v1\.2\.3')
Assert-Eq 'AC-2f no sentinel emitted'   $false           ($r.Output -match '__MAIN_BRANCH__')

# ── Summary ──────────────────────────────────────────────────────────

Write-Host ""
Write-Host "─────────────────────────────────────────────────────"
Write-Host (" Passed: {0}" -f $script:Pass) -ForegroundColor Green
if ($script:Fail -gt 0) {
    Write-Host (" Failed: {0}" -f $script:Fail) -ForegroundColor Red
    foreach ($l in $script:FailLines) { Write-Host "   - $l" -ForegroundColor Red }
    exit 1
}
Write-Host " All AC-2 ps1 tests passed." -ForegroundColor Green
exit 0
