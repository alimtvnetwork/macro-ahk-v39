# Repo-Rename Script (Versioned Fork Migration)

**Version:** 1.0.0
**Updated:** 2026-04-22
**Status:** Specified — implementation pending
**AI Confidence:** High
**Ambiguity:** Low

---

## Keywords

`cicd` · `script` · `repo-rename` · `versioned-fork` · `find-replace` · `shell` · `git` · `automation` · `pre-release`

---

## Background

The team's release workflow frequently spawns a **next-version fork** of an
existing repository. Example pattern:

| Previous repo | New repo |
|---------------|----------|
| `macro-ahk-v29` | `macro-ahk-v29` |
| `acme-tool-v3` | `acme-tool-v4` |
| `marco-ext-v9` | `marco-ext-v10` |

After forking, **every in-tree reference to the old repo name must be
rewritten** to the new repo name — in source code, configs, docs,
package metadata, CI workflows, etc. Doing this by hand is slow and
error-prone (one missed string → broken release URL or stale changelog
heading). This spec defines a **generic shell-based renamer** that does
the rewrite in one command.

> **Important scope clarification (from the requirement author):**
> - Only the **bare repo name** is rewritten (e.g. `macro-ahk-v29` → `macro-ahk-v29`).
> - **URLs are NOT rewritten** in v1. Any string containing `http://`,
>   `https://`, `git@`, or `ssh://` directly before/around the repo name
>   must be skipped. (URLs may be added in a later opt-in flag — see
>   "Future extensions".)

---

## Goals

1. **Zero hand-editing**: one command rewrites every occurrence of the
   old repo name to the new one across the working tree.
2. **Auto-detect the new name** from `git remote get-url origin` so the
   operator never types it.
3. **Auto-derive the previous name** by decrementing the trailing
   `-v<N>` segment (e.g. `…-v22` → `…-v21`). Operator may override.
4. **Generic**: works for any repo whose name matches the
   `<slug>-v<N>` pattern. No project-specific code.
5. **Safe by default**: dry-run is the default mode. Destructive
   rewriting requires `--apply`.
6. **URL-safe**: never touch a match that is part of a URL.
7. **Reversible**: every run leaves a single audit log
   (`.repo-rename/<timestamp>.log`) with file path + line + before/after.

---

## Non-Goals (v1)

- Rewriting **URLs** (GitHub URLs, clone URLs, badge image URLs, etc.).
- Renaming the local Git remote (`git remote set-url`).
- Pushing, tagging, or any network operation.
- Rewriting binary files.
- Touching files inside `.git/`, `node_modules/`, `dist/`, `build/`,
  `.release/`, `skipped/`, or any path matched by `.gitignore`.
- Case-insensitive matching (the repo slug is treated as case-sensitive
  to avoid corrupting unrelated tokens like `MACRO-AHK-V21` headings —
  see "Edge cases").

---

## Inputs

| Source | Variable | Required | How resolved |
|--------|----------|----------|--------------|
| `git remote get-url origin` | `NEW_REPO_NAME` | Yes (auto) | basename of remote URL, `.git` suffix stripped |
| Decrement of `NEW_REPO_NAME` | `OLD_REPO_NAME` | Yes (auto) | trailing `-v(\d+)` → `-v($1 - 1)` |
| `--from <name>` | `OLD_REPO_NAME` | No (override) | CLI arg |
| `--to <name>` | `NEW_REPO_NAME` | No (override) | CLI arg |
| `--apply` | dry-run flag | No | absence = dry-run |
| `--include <glob>` | extra include patterns | No | repeatable |
| `--exclude <glob>` | extra exclude patterns | No | repeatable |
| `--allow-urls` | URL-rewrite opt-in | No | reserved for future |

### Auto-detection algorithm (must match exactly)

```text
1. raw = `git remote get-url origin`
2. strip a trailing ".git" if present
3. take the basename (last path segment after final "/" or ":")
4. NEW_REPO_NAME = that basename
5. if NEW_REPO_NAME matches /^(.+)-v(\d+)$/i:
       slug = $1
       n    = integer($2)
       if n <= 1: ERROR "cannot derive previous version from -v1 or -v0"
       OLD_REPO_NAME = "${slug}-v$((n-1))"
   else:
       ERROR "repo name does not match `<slug>-v<N>` pattern; pass --from explicitly"
6. assert OLD_REPO_NAME != NEW_REPO_NAME
```

CLI overrides (`--from`, `--to`) take precedence over auto-detection.
If both overrides are given, step 1–5 is skipped entirely.

---

## URL-safety rule (CRITICAL)

A match `M` of `OLD_REPO_NAME` at byte offset `i` in line `L` must be
**skipped** if any of the following are true:

1. The substring `L[max(0,i-8):i]` contains `://` (e.g. `https://`,
   `http://`, `ssh://`, `git://`).
2. The substring `L[max(0,i-5):i]` contains `git@` (SSH form
   `git@github.com:org/repo-v21`).
3. The substring `L[max(0,i-200):i]` contains `github.com/`,
   `gitlab.com/`, `bitbucket.org/`, or `dev.azure.com/` between the
   start of any URL prefix and the match.

> Rationale: the requirement author explicitly excluded URLs from v1.
> The 200-byte left-window covers `https://github.com/<org>/<repo>`
> patterns where the host and the slug are on the same line.

If `--allow-urls` is passed (future), all three rules are bypassed.

---

## File selection

### Discovery

Use `git ls-files -z` (NUL-separated) so the rename only touches
**tracked files**. This is the simplest, fastest, and most accurate
filter — it automatically respects `.gitignore`, never recurses into
`node_modules`, and never touches build artifacts.

If the working tree is not a git repo, fall back to `find . -type f`
with the hard-coded exclude list below.

### Hard-coded excludes (always applied, even with `git ls-files`)

| Path/pattern | Reason |
|--------------|--------|
| `.git/**` | repo metadata |
| `.release/**` | read-only release archive (memory rule) |
| `skipped/**` | read-only archive (memory rule) |
| `node_modules/**` | dependency cache |
| `dist/**`, `build/**`, `out/**` | build output |
| `*.lock`, `*.lockb`, `package-lock.json`, `bun.lock`, `bun.lockb` | dependency lockfiles |
| `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.ico`, `*.pdf`, `*.zip`, `*.gz`, `*.woff`, `*.woff2`, `*.ttf`, `*.otf` | binary |
| `.repo-rename/**` | the script's own log directory |

The script must additionally **detect binary files at read time** using
the standard "first 8 KB contains a NUL byte" heuristic and skip them.

---

## Output

### Dry-run (default)

```
╔══════════════════════════════════════════════════╗
║   REPO RENAME — DRY RUN (no files changed)      ║
╠══════════════════════════════════════════════════╣
║  From: macro-ahk-v29                             ║
║  To:   macro-ahk-v29                             ║
║  Source: auto-detected from git remote           ║
╚══════════════════════════════════════════════════╝

readme.md:14
  - # macro-ahk-v29
  + # macro-ahk-v29

package.json:3
  - "name": "macro-ahk-v29",
  + "name": "macro-ahk-v29",

… (URL-safety) skipped 3 matches inside URLs:
  readme.md:42  https://github.com/alimtvnetwork/macro-ahk-v29
  …

Summary:
  Files scanned:        842
  Files with matches:    17
  Replacements planned:  41
  URL matches skipped:    3
  Binary files skipped: 124

Re-run with --apply to write changes.
```

### Apply mode (`--apply`)

Same display, plus:

- Files are rewritten **in place** (atomic temp file + rename).
- A timestamped log is written to `.repo-rename/<UTC>.log` containing
  every replacement (file, line, before, after) and every URL skip.
- Final exit code: `0` if at least one replacement was made, `0` if
  zero matches found (idempotent), `1` on any I/O error, `2` on bad
  CLI args.

---

## Implementation requirements

### Language: POSIX shell (`bash`) + standard utilities

- Must run on a stock GitHub Actions Ubuntu runner with no installs.
- Allowed tools: `bash`, `git`, `grep`, `sed`, `awk`, `python3` (for
  the URL-safety check, since pure `sed` cannot reliably handle the
  200-byte lookbehind).
- Forbidden: `perl`, `ripgrep` (not preinstalled everywhere), Node.js,
  Go, Rust.

### File location

```
scripts/repo-rename.sh           # the script
scripts/repo-rename.readme.md    # one-page user docs
.repo-rename/                    # auto-created log dir (gitignored)
```

Add `.repo-rename/` to `.gitignore` on first run if missing.

### Script skeleton (informative — implementer chooses exact form)

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Parse CLI flags: --from, --to, --apply, --include, --exclude
# 2. If --from / --to missing, run auto-detection (git remote get-url)
# 3. Build file list via `git ls-files -z` minus hard-coded excludes
# 4. For each file:
#    a. Skip if binary (NUL byte in first 8 KB)
#    b. Stream through python3 helper that:
#       - finds every byte offset of OLD_REPO_NAME
#       - applies URL-safety rule per match
#       - emits a JSONL diff record per non-skipped match
# 5. Print human-readable diff to stdout
# 6. If --apply, replay the JSONL through an in-place rewriter
#    (atomic: write to "$f.tmp" then mv)
# 7. Write log to .repo-rename/<UTC>.log
```

### Python helper contract

```
python3 scripts/_repo_rename_scan.py \
    --file <path> --old <name> --new <name> [--apply]
```

- Reads `--file` as bytes.
- For each match of `--old`:
  - Apply the three URL-safety rules above.
  - If safe, emit `{"file": …, "line": N, "col": C, "before": "…", "after": "…"}` to stdout.
  - If unsafe, emit `{"file": …, "line": N, "skipped": "url"}`.
- With `--apply`, also rewrite the file atomically, replacing only the
  safe matches.
- Exit `0` on success, `1` on read/write error.

The Python helper is **internal** — users only ever invoke
`scripts/repo-rename.sh`.

---

## Edge cases the implementer MUST handle

| # | Case | Required behavior |
|---|------|-------------------|
| 1 | Repo name appears as a substring of a longer token (e.g. `macro-ahk-v210` when renaming `macro-ahk-v29`) | Match must be **whole token**: the byte before the match must not be `[A-Za-z0-9_-]` AND the byte after must not be `[A-Za-z0-9_-]`. |
| 2 | Same line contains both a URL match (skip) and a non-URL match (rewrite) | Each match evaluated independently; only the URL match is skipped. |
| 3 | New name appears in a URL but old name does not | No-op. Do not rewrite. |
| 4 | Repo name in CHANGELOG.md heading like `## [v21]` | Only matches that contain the full slug (`macro-ahk-v29`) are touched. Bare `v21` headings are left alone. |
| 5 | Operator is on `-v1` repo | Auto-derivation fails with a clear error. Operator must pass `--from` explicitly. |
| 6 | `git remote get-url origin` fails (no remote) | Hard error. Must pass `--from` and `--to` explicitly. |
| 7 | `OLD_REPO_NAME == NEW_REPO_NAME` | Hard error: "from and to are identical". |
| 8 | File ends without trailing newline | Preserve the original final-byte state. |
| 9 | File uses CRLF line endings | Preserve the original line endings. |
| 10 | Symlinks | Skip — never follow, never rewrite. |

---

## Acceptance criteria

| ID | Criterion |
|----|-----------|
| AC-RR-001 | Running `scripts/repo-rename.sh` with no args in a repo whose remote is `…/macro-ahk-v29` shows a dry-run with `From: macro-ahk-v29` / `To: macro-ahk-v29`. |
| AC-RR-002 | Running with no args in a repo whose remote is `…/some-tool-v1` exits non-zero with a clear "cannot derive previous version" error. |
| AC-RR-003 | URL strings (`https://github.com/org/macro-ahk-v29`, `git@github.com:org/macro-ahk-v29.git`) are reported as URL skips and never rewritten. |
| AC-RR-004 | A line containing both `macro-ahk-v29` (bare) and `https://github.com/org/macro-ahk-v29` is partially rewritten — only the bare token changes. |
| AC-RR-005 | `macro-ahk-v210` is **not** matched when renaming `macro-ahk-v29` (whole-token rule). |
| AC-RR-006 | Binary files, lockfiles, files under `.git/`, `.release/`, `skipped/`, `node_modules/`, `dist/`, `build/` are skipped. |
| AC-RR-007 | `--apply` produces an audit log under `.repo-rename/<UTC>.log` with one line per change and one line per URL skip. |
| AC-RR-008 | Re-running `--apply` on an already-renamed repo is a no-op (zero matches, exit 0). |
| AC-RR-009 | The script runs on a stock Ubuntu runner with only `bash`, `git`, `python3` available — no `pip install`, no Node.js. |
| AC-RR-010 | Dry-run is the default; `--apply` is the only way to mutate files. |

---

## Future extensions (NOT in v1)

| Flag | Behavior |
|------|----------|
| `--allow-urls` | Bypass the URL-safety rule and rewrite repo names inside URLs as well. |
| `--update-remote` | After rewrite, run `git remote set-url origin <new-url>` (requires confirmation). |
| `--commit` | Stage and commit the rewrite as a single conventional commit (`chore: rename macro-ahk-v29 → macro-ahk-v29`). |
| `--from-major <N> --to-major <M>` | Bulk version bump for repos that don't follow `-v<N>`. |
| GitHub Action wrapper | `actions/repo-rename@v1` calling the same script under the hood. |

---

## Cross-references

| Reference | Location |
|-----------|----------|
| CI/CD module overview | `./00-overview.md` |
| Validation-script conventions | `../../pipeline/04-validation-scripts.md` |
| Coding-guidelines linter pack (sibling pattern) | `../02-coding-guidelines/12-cicd-integration/00-overview.md` |
| Skipped/release folders policy | `mem://constraints/skipped-folders` |
| Spec authoring guide v3.2.0 | `../01-spec-authoring-guide/00-overview.md` |

---

## Done checklist (for implementer)

- [ ] `scripts/repo-rename.sh` created and `chmod +x`
- [ ] `scripts/_repo_rename_scan.py` created
- [ ] `scripts/repo-rename.readme.md` created
- [ ] `.repo-rename/` added to `.gitignore`
- [ ] All 10 acceptance criteria verified with fixture cases under `scripts/_tests/repo-rename/`
- [ ] No `pip install` required; runs on stock Ubuntu
- [ ] Dry-run output matches the format in this spec
- [ ] Audit log format matches the JSONL contract above
