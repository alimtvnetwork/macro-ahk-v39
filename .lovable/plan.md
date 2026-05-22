# Plan — Prompt Section Enhancements (Macro Controller UI)

Scope: enhancements to the prompt dropdown / prompt section inside `standalone-scripts/macro-controller/src/ui/`. Frontend/UI only — no backend changes.

## Steps (15)

1. **Audit current prompt dropdown structure.** Read `prompt-dropdown.ts`, `prompt-manager.ts`, `task-next-ui.ts`, `save-prompt-task-next.ts`, `prompt-cache.ts` to map the existing Task Next row, copy/paste header, load button, and CRUD (save/edit/delete) flow.
2. **Define the new header layout.** Decide the row of action buttons next to "Task Next": `[Task Next] [Plan Task] [Filter]`. Remove the standalone "icon to copy / icon to paste" header strip; relocate the Load button to the top of the prompt list (or just under the action row).
3. **Build the `Plan Task` submenu (mirror Task Next).** New file `ui/plan-task-ui.ts` exposing the same step-count dropdown (5, 10, 15, 20, 30, 40…) using the existing inline-accordion pattern from the Task Next fix.
4. **Author the canonical Plan prompt text.** Store in a single constant `PLAN_TASK_PROMPT_TEMPLATE` with `{N}` a placeholder. Proofread copy:
  > "  
  > ## **{N}** steps Plan
  >
  >
  > Please plan this task for **{N}** steps in the current situation. Do not execute anything in this turn — your only job is to list the steps. Write the {N} steps into `.lovable/plan.md` as a spec. Also scan the `.lovable/` folder for any memory or task sections; if pending tasks exist, append them to the pending list, then resolve them one by one and mark each as done. If anything is ambiguous, ask clarifying questions before starting.   
  >
  > ## Additional Instruction:
  >
  >
  > Additionally, before executing, check the task type and follow the relevant guidelines if they exist (skip silently if the file is missing):
  >
  > 1. **Coding tasks** (especially backend work in Golang, Python, PHP, or similar related to coding):
  >
  >    - Check for a coding guideline markdown file in the `.lovable/` folder (e.g. `.lovable/coding-guidelines.md`). If it exists, follow it.
  >
  >    - Also check for a `spec/coding-guidelines/` folder. If it exists, follow every guideline file within it. (create plans according to the guidelines, if more steps required let me know)
  >
  >    - If coding task and there is no `.lovable/coding-guidelines.md` file in the lovable and .lovable folder, please ask so that I can provide it.
  >
  > &nbsp;
  >
  > 2. **SEO tasks** (anything website/SEO-related):
  >
  >    - Check for `.lovable/seo-guidelines.md`. If it exists, follow it.
  >
  > Rule: always verify the file/folder exists first. If it doesn't exist, skip that guideline without complaining. If multiple guidelines apply, follow all of them; if they conflict, prefer the more specific one (folder-level spec over single `.lovable` file) and call out the conflict.  
  >
  > "
5. **Wire Plan Task click → inject prompt.** On step-count selection, build the prompt via the template and inject it through the same path Task Next uses (`prompt-injection.ts`).
6. **Add Filter button + menu.** New file `ui/prompt-filter-menu.ts`. Button sits to the right of Plan Task. Opens an inline accordion listing all prompt categories (derived from existing prompt metadata in `prompt-cache.ts`).
7. **Implement filter state.** Multi-select checkboxes; persist selection in the panel handler store (`_marcoPromptFilter: string[]`). Empty selection = show all. Apply filter when rendering the prompt list.
8. **Relocate the Load button.** Remove the old copy/paste header strip. Place a single `⟳ Load prompts` button at the top of the prompt list area (sticky above the list).
9. **Audit prompt CRUD.** Trace Save / Rename / Delete in `save-prompt.ts`, `save-prompt-dropdown.ts`, `prompt-manager.ts`. Reproduce the reported "CRUD does not work properly" issue (likely cache not refreshing after mutation, or stale DOM).
10. **Fix CRUD bugs.** Ensure every mutation: (a) writes to IndexedDB cache, (b) invalidates `_marcoPromptsLatest`, (c) re-renders the list, (d) preserves current filter selection.
11. **Styling pass.** Match existing dark-theme tokens. New buttons use the same height/padding/border-radius as the Task Next button. No custom colors — use existing CSS vars.
12. **Coding-guideline compliance.** Methods ≤8 lines; no variable mutation; simple boolean expressions; defensive `?.` / `??`. Use `RiseupAsiaMacroExt.Logger.error()` for any error path. (No `.lovable/coding-guideline.md` found — following standards already encoded in memory index.)
13. **Typecheck.** Run `bunx tsc --noEmit` in `standalone-scripts/macro-controller/`. Fix any errors.
14. **Manual smoke checklist (logged, not executed).** Open controller → click Task Next (inline accordion still works) → click Plan Task → pick 15 → verify prompt injected → click Filter → toggle categories → verify list filters → Save / Rename / Delete a prompt → verify list refreshes.
15. **Update memory + remaining-tasks log.** Append entry to `.lovable/memory/workflow/13-next-commands.md`; if new persistent patterns emerged (Plan Task template, filter store key), add a memory file and update `mem://index.md`.

## Notes

- No `.lovable/coding-guideline.md` exists; memory-index rules apply instead (CQ14 braces, no `unknown`, defensive access, namespace logger).
- No backend / Cloud changes. Pure controller UI.
- Reuses the inline-accordion pattern proven by the recent Task Next fix — no `position: fixed` flyouts.

## Open question

None blocking — all decisions inferable. Will ask only if step 9 reveals CRUD failure rooted outside the UI layer.