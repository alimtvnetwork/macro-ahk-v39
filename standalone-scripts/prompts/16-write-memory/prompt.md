# Write Memory

> **Purpose:** After completing work or at session end, persist everything learned, done, and pending so the next AI session picks up with zero context loss.

> **When to run:** End of session, after a task batch, or when asked to "update memory" / "write memory" / "end memory".

---

## Core Principle

The memory system is the project's brain. If you did something and didn't write it down, it didn't happen. Write as if the next AI has amnesia — because it does.

---

## Phase 1 — Audit Current State

Take inventory before writing:

- **Done this session:** features, fixes, refactors, files created/modified/deleted, decisions and why.
- **Still pending:** tasks started but not finished, discussed but not started, blockers and dependencies.
- **Learned:** new patterns/conventions, gotchas, edge cases, user preferences (explicit or implicit).
- **Went wrong:** bugs + root causes, failed approaches, things that should never be repeated.

---

## Phase 2 — Update Memory Files

Target: `.lovable/memory/`

1. Read `.lovable/memory/index.md` first. Do not create duplicates.
2. Update existing memory files affected by this session — add new info in the right section, mark completed items `[x]` / ✅, **never truncate or overwrite unrelated entries**.
3. Create new memory files (lowercase-hyphenated, numeric prefix `XX-name.md`) when knowledge doesn't fit any existing file. **Immediately update `index.md`**.
4. Update workflow files in `.lovable/memory/workflow/` with status markers: ✅ Done, 🔄 In Progress, ⏳ Pending, 🚫 Blocked — [reason], 🚫 Blocked — [avoid].

---

## Phase 3 — Update Plans & Suggestions

### 3A — Plans (`.lovable/plan.md`)
- Update task statuses; add new tasks discovered this session.
- Move fully-complete items to a `## Completed` section in the same file (do not delete).
- Single source of truth for the roadmap.

### 3B — Suggestions (`.lovable/suggestions.md`) — single file, with index folder for grouped suggestions

```markdown
## Active Suggestions
### [Title]
- **Status:** Pending | In Review | Approved | Rejected
- **Priority:** High | Medium | Low
- **Description:** What and why
- **Added:** [date or session ref]

## Implemented Suggestions
### [Title]
- **Implemented:** [date or session ref]
- **Notes:** Implementation details
```

When implemented: move from Active → Implemented, add notes, reference commit/file/task.

Also write all Lovable suggestions in the appropriate folder with an index file for suggestions.

---

## Phase 4 — Update Issues

### 4A — Pending (`.lovable/pending-issues/XX-short-description.md`)

```markdown
# [Issue Title]
## Description
## Root Cause   (or "Under investigation.")
## Steps to Reproduce
## Attempted Solutions
- [ ] Approach 1 — [result]
## Priority   (High | Medium | Low)
## Blocked By  (if any)
```

### 4B — Solved (`.lovable/solved-issues/`)

When resolved, MOVE the file from pending → solved and append:

```markdown
## Solution
## Iteration Count
## Learning
## What NOT to Repeat
```

### 4C — Strictly Avoided (`.lovable/strictly-avoid.md`)

If a solved issue revealed a forbidden pattern:

```markdown
- **[Pattern Name]:** [Why forbidden]. See: `.lovable/solved-issues/XX-filename.md`
```

Anything explicitly told to skip/avoid → `avoid` folder in memory.

### 4D — CI/CD Issues (`.lovable/cicd-issues/XX-issue-name.md`)

For every CI/CD problem encountered, write a numbered file (sequence starts from 01) and maintain `.lovable/cicd-index.md` as a summary index. Collect every CI/CD issue properly. Do not repeat them.

---

## Phase 5 — Consistency Validation

- **Index integrity:** every file in `.lovable/memory/` (incl. subfolders) listed in `index.md`.
- **Cross-reference:** every ✅ Done in `plan.md` has evidence (memory update / solved issue / code change). Every actionable item in `pending-issues/` reflected in `plan.md` or `suggestions.md`. No file in both `pending-issues/` and `solved-issues/`.
- **Orphan check:** no memory file without an index entry; no "Implemented" suggestion without code evidence; no `solved-issues/` file without a `## Solution` section.

### Final Confirmation

```
✅ Memory update complete.

Session Summary:
- Tasks completed: [X]
- Tasks pending: [Y]
- New memory files created: [Z]
- Issues resolved: [N]
- Issues opened: [M]
- Suggestions added: [S]
- Suggestions implemented: [T]

Files modified:
- [list every file touched]

Inconsistencies found and fixed:
- [list any, or "None"]

The next AI session can pick up from: [current state + next logical step]
```

---

## Phase 6 — Verbatim Spec Capture

Review current discussions. If a larger spec was given during the session, write it verbatim into the file system AND store the gist in memory so the next AI can find it. Recent specs and verbatims must land in the file system, not stay only in chat.

---

## File Naming & Structure Rules

| Rule | Example |
|------|---------|
| Numeric prefix, lowercase, hyphen-separated | `01-auth-flow.md` ✅ / `01_Auth_Flow.md` ❌ |
| Plans → single file | `.lovable/plan.md` |
| Suggestions → single file (+ optional index folder) | `.lovable/suggestions.md` |
| Pending/solved issues → one file per issue | `.lovable/pending-issues/01-login-crash.md` |
| Memory → grouped by topic | `.lovable/memory/workflow/`, `.lovable/memory/decisions/` |
| Completed → `## Completed` section in same file | NOT a separate `completed/` folder |

### Folder Structure

```
.lovable/
├── overview.md
├── strictly-avoid.md
├── user-preferences
├── plan.md
├── suggestions.md
├── prompt.md                     # Index of canonical prompts
├── prompts/                      # xx-name.md (lowercase hyphenated)
├── cicd-index.md                 # Summary of CI/CD issues
├── cicd-issues/                  # 01-issue.md, 02-issue.md, ...
├── memory/
│   ├── index.md
│   ├── workflow/
│   ├── decisions/
│   ├── avoid/                    # things to skip/avoid
│   └── [topic]/
├── pending-issues/
└── solved-issues/
```

> ⚠️ **NEVER** create `.lovable/memories/` (trailing `s`). The path is `.lovable/memory/`.

---

## Anti-Corruption Rules

1. **Never delete history** — mark done, move to completed sections.
2. **Never overwrite blindly** — read before write; preserve existing content.
3. **Never leave orphans** — every file indexed; every reference resolves.
4. **Never split what should be unified** — plans and suggestions live in ONE file each.
5. **Never mix states** — an issue is pending OR solved, never both.
6. **Never skip the index update** — new memory file ⇒ update `index.md` in the same operation.
7. **Never assume the next AI knows anything** — write as if explaining to a stranger.

---

## Important

- Save trigger phrases: **"write memory"**, **"end memory"**, **"update memory"**.
- Lose as little of the conversation as possible.
- This prompt lives at `.lovable/prompts/03-write-memory.md`; root index `.lovable/prompt.md` references it.
- Restructure any folder that doesn't match this layout. All `.md` files lowercase-hyphenated.

*Prompt v3.0.*
