# 2026-05-25 — Plan Task Button RCA

**Symptom:** User clicks `🧠 Plan Task → Plan in N steps`. Either nothing visible happens, or a red **"❌ Plan prompt: editor not found"** toast appears even when the prompt was actually placed on the clipboard / injected.

## Reproduction

1. Open extension panel on any Lovable page.
2. Click `Prompts` → `🧠 Plan Task` → e.g. `Plan in 10 steps`.
3. Observe toasts.

## Root causes

### RC-1 (primary) — Double, contradictory toast

`standalone-scripts/macro-controller/src/ui/plan-task-ui.ts:50-55`

```ts
function injectPlanPrompt(n: number): void {
  const text = buildPlanTaskPrompt(n);
  const ok = pasteIntoEditor(text, getPromptsConfig(), adapterGetByXPath);
  if (ok) showPasteToast('🧠 Plan prompt injected (' + n + ' steps)', false);
  else showPasteToast('❌ Plan prompt: editor not found', true);
}
```

But `pasteIntoEditor` (`prompt-utils.ts:233-275`) **already** surfaces its own toast on every code path:

| Inner result | Inner toast |
|---|---|
| target found + injected | `✓ Prompt injected (N chars)` |
| no target → clipboard ok | `📋 Copied to clipboard — paste manually with Ctrl+V` |
| no target → clipboard fail | `❌ Could not paste or copy — editor target not found` |
| target found, inject threw | `⚠️ Inject failed — copied to clipboard, try Ctrl+V` |

When the editor target is missing, `pasteIntoEditor` returns `false` **synchronously** while the clipboard write is in flight. The caller then immediately fires the red `❌ Plan prompt: editor not found` toast, which:

- contradicts the success clipboard toast that lands ~1 frame later, and
- makes the user believe the action failed even though the prompt is on the clipboard.

### RC-2 — Hover-leave timeout collapses submenu mid-click

`plan-task-ui.ts:101` — `item.onmouseleave` waits 120 ms then forces `display:none` on the submenu. On narrow tracks the cursor briefly leaves `item` while transitioning between the trigger row and the first `Plan in N` row (1-px gap or border), which dismisses the menu before `mousedown` lands.

### RC-3 — `parseInt` missing radix (lint + edge case)

`plan-task-ui.ts:145` — `parseInt(inp.value)` accepts a leading `0` and falls back to octal in legacy engines. Lint flags this; functionally low-risk but should be `parseInt(inp.value, 10)`.

### RC-4 (minor) — `dropdown.style.display = 'none'` before `injectPlanPrompt`

The dropdown closes synchronously before the inject runs. If `pasteIntoEditor` throws synchronously the toast still fires, but the user has already lost the visual association.

## Fix plan (Step 2)

1. Remove the caller-side `showPasteToast(...)` pair from `injectPlanPrompt`. Trust the inner `pasteIntoEditor` toast. Add **only** a Plan-specific success toast (`🧠 Plan prompt: N steps`) **after** a confirmed `ok === true` — no failure toast (the inner one already exists).
2. Replace the `item.onmouseleave` 120 ms auto-close with an outside-click listener registered on `document` while the submenu is open. Removed on collapse.
3. `parseInt(inp.value, 10)` with `Number.isFinite` guard.
4. Close dropdown **after** `injectPlanPrompt` returns so the toast feels attached.

## Test plan (Step 3)

- `buildPlanTaskPrompt.test.ts` — snapshot 5/10/15/custom variants (ensure no `injectPlanPrompt` regressions).
- `plan-task-submenu.test.ts` (JSDOM) — clicking a preset triggers `pasteIntoEditor` once; no double toast.
- `e2e-plan-task.spec.ts` (Playwright) — open extension, click `Plan in 10 steps`, assert exactly one toast and clipboard content equals `buildPlanTaskPrompt(10)`.
