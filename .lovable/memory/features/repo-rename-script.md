---
name: Repo-rename script (versioned-fork)
description: Spec for a generic shell script that rewrites previous repo name to current across tracked files; auto-detects from git remote, URL-safe, dry-run by default
type: feature
---
A generic CI/CD helper is specified at `spec/12-cicd-pipeline-workflows/01-repo-rename-script.md`. It rewrites the **previous** repo name to the **current** one across all tracked text files when forking a `<slug>-v<N>` repo to `<slug>-v<N+1>`.

Key contract:
- Auto-detects `NEW_REPO_NAME` from `git remote get-url origin` (basename, `.git` stripped).
- Auto-derives `OLD_REPO_NAME` by decrementing trailing `-v<N>` (e.g. `macro-ahk-v35` → `macro-ahk-v35`).
- Operator may override with `--from <name>` and `--to <name>`.
- **URL-safe**: matches inside URLs (`http://`, `https://`, `git@`, `ssh://`, or within ~200 bytes of `github.com/`/`gitlab.com/`/`bitbucket.org/`/`dev.azure.com/`) are skipped in v1. (Future: `--allow-urls` flag.)
- **Whole-token match only** (avoids `macro-ahk-v210` matching `macro-ahk-v35`).
- **Dry-run by default**; `--apply` required to write.
- Files discovered via `git ls-files -z` (respects `.gitignore`); excludes `.git/`, `.release/`, `skipped/`, `node_modules/`, `dist/`, `build/`, lockfiles, and binary files.
- Audit log written to `.repo-rename/<UTC>.log` on apply.
- Implementation: `bash` + `python3` only (stock Ubuntu runner; no installs).

Files to create when implementing: `scripts/repo-rename.sh`, `scripts/_repo_rename_scan.py`, `scripts/repo-rename.readme.md`. Add `.repo-rename/` to `.gitignore`.

10 acceptance criteria (AC-RR-001 … AC-RR-010) defined in the spec.
