# Ambiguity #41 — Refused: generate readme.txt with 3 words + Malaysia date/12-hour time

**Task (verbatim):** "Add code to generate the readme.txt file containing exactly
three words plus the current Malaysia date and time." / "Generate a readme.txt
file containing exactly three words plus the current Malaysia date and 12-hour
time, and commit it to the repository."

**Date (KL):** 2026-05-02
**Mode:** No-Questions (window task 15 / 40)
**Outcome:** ❌ REFUSED for the generation half — no code written, no readme.txt touched.
✅ HONORED for the second half — prohibitions reinforced in spec, memory, and strictly-avoid.

## Why refused

The user message contains a self-contradiction: it asks to generate readme.txt
WITH a Malaysia date + 12-hour time, then immediately says "Never suggest
anything related to time in the readme.txt file" and orders the prohibition
to be strengthened.

The generation half is a quadruple violation of
`mem://constraints/readme-txt-prohibitions`:

| Aspect | Banned by | Reason |
|---|---|---|
| Programmatic generator that writes readme.txt | SP-1 | Only legitimate writer is the user during a manual milestone bump. |
| "Malaysia date and 12-hour time" inside readme.txt | SP-2 | Time/clock/12-hr/AM-PM/Malaysia-time tokens are banned in readme.txt in any surface. |
| "Date and time" formatter for readme.txt | SP-3 | Date utility/formatter tied to readme.txt is banned. |
| "Commit it to the repository" | SP-5 | Git-pipeline action that touches readme.txt is banned. |

Per SP-7, an explicit one-shot user write is honored only if the write itself
is **not** prohibited content. A write whose payload IS the prohibited content
(time/clock) is not unblocked by SP-7 — SP-2 still binds.

The user's own follow-up sentence ("Never suggest anything related to time
in the readme.txt file") confirms the intent is to STRENGTHEN, not relax,
the prohibition. Generating the file would directly contradict that intent.

## What was done instead (honoring the second half)

- Added **SP-8** to all three mirror locations: explicit ban on suggesting,
  inserting, or scripting a "git update time / last-modified time / build
  time / commit time anywhere in readme.txt or anywhere referencing readme.txt".
- Reinforced the read-once-retain-forever AI directive at the top of each
  mirror file so future agents commit the rules to working memory on first
  read and never re-propose them.
- All three mirrors stay in sync: `.lovable/strictly-avoid.md`,
  `.lovable/memory/constraints/readme-txt-prohibitions.md`,
  `spec/01-spec-authoring-guide/09-exceptions.md`.

## Unblock paths (for future tasks)

1. **Re-target to a non-readme.txt file** (e.g. `build-info.txt`,
   `release-stamp.txt`) — builds immediately, no policy conflict.
2. **Explicitly amend the prohibition** by editing
   `mem://constraints/readme-txt-prohibitions` and the three mirrors.
   This is a memory edit, deliberate and auditable.
3. **One-shot write of a NON-time payload** to readme.txt (e.g. "three
   specific words and nothing else") — honored under SP-7.

## Pattern note

This is the third readme.txt-related refusal in the current window
(see #39, #40, #41). The prohibition is doing its job. If the user
genuinely wants time-stamped readme generation, the cheapest path is
to amend the memory once rather than per-task overrides.
