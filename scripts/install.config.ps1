# ─────────────────────────────────────────────────────────────────────
# Marco Extension — Installer configuration (PowerShell mirror)
#
# This file is dot-sourced by scripts/install.ps1 on startup (if present)
# to provide repo-specific defaults. Conforms to spec/14-update/01-
# generic-installer-behavior.md §4 (sibling-repo discovery configuration).
#
# All values may be overridden by:
#   1. Environment variables of the same name
#      (e.g. $env:SIBLING_DISCOVERY_ENABLED = '1').
#   2. CLI flags (-EnableSiblingDiscovery, -NoSiblingDiscovery).
#
# Spec §4 rule 6: sibling discovery NEVER runs in strict mode, regardless
# of the value of SiblingDiscoveryEnabled here. Strict mode is when the
# script was downloaded from a release-asset URL OR -Version vX.Y.Z was
# passed (anything other than -Version latest).
#
# Forks/downstream consumers: copy this file, change the values, ship it
# alongside install.ps1. The installer's hardcoded fallbacks (in install.ps1
# under "── Sibling-discovery defaults ──") match the values here.
# ─────────────────────────────────────────────────────────────────────

# Master switch. Set to 1 to opt in to §4 sibling-repo probing in
# discovery mode. Default is 0 per spec §4.
if (-not $env:SIBLING_DISCOVERY_ENABLED) { $script:SiblingDiscoveryEnabled = '0' } else { $script:SiblingDiscoveryEnabled = $env:SIBLING_DISCOVERY_ENABLED }

# Pattern for sibling repo names. {N} = next sibling integer, {base} =
# the current repo's bare name. For this repo (macro-ahk-v31), siblings
# would be macro-ahk-v31, macro-ahk-v31, …
if (-not $env:SIBLING_NAME_PATTERN) { $script:SiblingNamePattern = 'macro-ahk-v{N}' } else { $script:SiblingNamePattern = $env:SIBLING_NAME_PATTERN }

# How many versions ahead to probe. Default per spec §4 = 20.
if (-not $env:SIBLING_PROBE_DEPTH) { $script:SiblingProbeDepth = 20 } else { $script:SiblingProbeDepth = [int]$env:SIBLING_PROBE_DEPTH }

# Parallel HEAD requests cap. Default per spec §4 = 8.
if (-not $env:SIBLING_PARALLELISM) { $script:SiblingParallelism = 8 } else { $script:SiblingParallelism = [int]$env:SIBLING_PARALLELISM }

# Per spec §4, the entire probe MUST cap total wall-clock time at 5 s.
if (-not $env:SIBLING_PROBE_TIMEOUT_SECS) { $script:SiblingProbeTimeoutSecs = 5 } else { $script:SiblingProbeTimeoutSecs = [int]$env:SIBLING_PROBE_TIMEOUT_SECS }
