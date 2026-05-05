# ─────────────────────────────────────────────────────────────────────
# Marco Extension — Installer configuration
#
# This file is sourced by scripts/install.sh on startup (if present) to
# provide repo-specific defaults. Conforms to spec/14-update/01-generic-
# installer-behavior.md §4 (sibling-repo discovery configuration).
#
# All values may be overridden by:
#   1. Environment variables of the same name (e.g. SIBLING_DISCOVERY_ENABLED=1).
#   2. CLI flags (--enable-sibling-discovery, --no-sibling-discovery).
#
# Spec §4 rule 6: sibling discovery NEVER runs in strict mode, regardless
# of the value of SIBLING_DISCOVERY_ENABLED here. Strict mode is when the
# script was downloaded from a release-asset URL OR --version <semver> was
# passed (anything other than --version latest).
#
# Forks/downstream consumers: copy this file, change the values, ship it
# alongside install.sh. The installer's hardcoded fallbacks (in install.sh
# under "── Sibling-discovery defaults ──") match the values here.
# ─────────────────────────────────────────────────────────────────────

# Master switch. Set to 1 to opt in to §4 sibling-repo probing in
# discovery mode. Default is 0 per spec §4: "Sibling discovery is off by
# default. A project enables it by setting two configuration values…".
SIBLING_DISCOVERY_ENABLED="${SIBLING_DISCOVERY_ENABLED:-0}"

# Pattern for sibling repo names. The {N} placeholder is the version
# number (2, 3, 4, …); {base} is the current repo's bare name (the part
# after owner/). For this repo (macro-ahk-v29), siblings would be
# macro-ahk-v29, macro-ahk-v29, … so the pattern is:
#
# NOTE: bash's ${VAR:=default} parameter-expansion form treats the FIRST `}`
# it sees as the closer of the expansion, so a literal `macro-ahk-v{N}` would
# silently truncate to `macro-ahk-v{N`. Assign via a temporary so the literal
# survives intact.
__SIBLING_NAME_PATTERN_DEFAULT='macro-ahk-v{N}'
SIBLING_NAME_PATTERN="${SIBLING_NAME_PATTERN:-${__SIBLING_NAME_PATTERN_DEFAULT}}"
unset __SIBLING_NAME_PATTERN_DEFAULT

# How many versions ahead to probe. Default per spec §4 = 20.
SIBLING_PROBE_DEPTH="${SIBLING_PROBE_DEPTH:-20}"

# Parallel HEAD requests cap. Default per spec §4 = 8.
SIBLING_PARALLELISM="${SIBLING_PARALLELISM:-8}"

# Per spec §4, the entire probe MUST cap total wall-clock time at 5 s.
SIBLING_PROBE_TIMEOUT_SECS="${SIBLING_PROBE_TIMEOUT_SECS:-5}"
