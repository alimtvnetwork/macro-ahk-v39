# AUTO-GENERATED — DO NOT EDIT BY HAND
# Source: scripts/installer-contract.json
# Regenerate: node scripts/generate-installer-constants.mjs
# Schema: 1.0.0

$script:MarcoDefaultRepo         = 'alimtvnetwork/macro-ahk-v33'
$script:MarcoVersionRegex        = '^v\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$'
$script:MarcoMainBranchSentinel  = '__MAIN_BRANCH__'

# Endpoints (env vars take precedence)
if (-not $env:MARCO_API_BASE)      { $env:MARCO_API_BASE      = 'https://api.github.com' }
if (-not $env:MARCO_DOWNLOAD_BASE) { $env:MARCO_DOWNLOAD_BASE = 'https://github.com' }
if (-not $env:MARCO_MAIN_BRANCH)   { $env:MARCO_MAIN_BRANCH   = 'main' }

# Exit codes
Set-Variable -Scope Script -Option ReadOnly -Force -Name 'MarcoExitOk' -Value 0  # §8.1
Set-Variable -Scope Script -Option ReadOnly -Force -Name 'MarcoExitPreflight' -Value 1  # §8.1
Set-Variable -Scope Script -Option ReadOnly -Force -Name 'MarcoExitBadVersionArg' -Value 3  # §8.1
Set-Variable -Scope Script -Option ReadOnly -Force -Name 'MarcoExitMissingArtifact' -Value 4  # §8.1
Set-Variable -Scope Script -Option ReadOnly -Force -Name 'MarcoExitNetworkOrTooling' -Value 5  # §8.1
Set-Variable -Scope Script -Option ReadOnly -Force -Name 'MarcoExitInvalidArchive' -Value 6  # §8.1

# Checksums
$script:MarcoChecksumsFile = 'checksums.txt'
$script:MarcoChecksumsAlgo = 'SHA-256'

# Signing (v0.3, opt-in)
$script:MarcoSignatureFile = 'checksums.txt.minisig'
if (-not $env:MARCO_MINISIGN_PUBKEY) { $env:MARCO_MINISIGN_PUBKEY = '' }

