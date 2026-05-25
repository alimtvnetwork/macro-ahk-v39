/**
 * Plan Task UI — Inline accordion mirror of Task Next, but injects a
 * "plan this task in N steps" prompt instead of running a multi-task loop.
 *
 * Single source of truth for the Plan Task prompt template.
 */

import { cPanelFg, cPrimary, cPrimaryLight, cBtnMenuHover, lDropdownRadius } from '../shared-state';
import { pasteIntoEditor, showPasteToast } from './prompt-utils';
import type { PromptContext } from './prompt-loader';
import { getPromptsConfig } from './prompt-loader';
import { getByXPath } from '../xpath-utils';

const PLAN_TASK_STEP_COUNTS = [5, 10, 15, 20, 30, 40];

/** Build the canonical Plan Task prompt for N steps. */
export function buildPlanTaskPrompt(n: number): string {
  return [
    '## **' + n + '** steps Plan',
    '',
    'Please plan this task for **' + n + '** steps in the current situation. ' +
      'Do not execute anything in this turn — your only job is to list the steps. ' +
      'Write the ' + n + ' steps into `.lovable/plan.md` as a spec. ' +
      'Also scan the `.lovable/` folder for any memory or task sections; ' +
      'if pending tasks exist, append them to the pending list, then resolve them one by one and mark each as done. ' +
      'If anything is ambiguous, ask clarifying questions before starting.',
    '',
    '## Additional Instruction',
    '',
    'Before executing, check the task type and follow the relevant guidelines if they exist (skip silently if the file is missing):',
    '',
    '1. **Coding tasks** (especially Golang, Python, PHP, or other backend):',
    '   - Check for `.lovable/coding-guidelines.md`. If present, follow it.',
    '   - Also check `spec/coding-guidelines/`. If present, follow every file inside.',
    '   - If this is a coding task and neither location has guidelines, ask me to provide one.',
    '',
    '2. **SEO tasks** (website/SEO-related):',
    '   - Check for `.lovable/seo-guidelines.md`. If present, follow it.',
    '',
    'Rule: verify the file/folder exists first. If it does not, skip that guideline silently. ' +
      'If multiple guidelines apply, follow all of them; if they conflict, prefer the folder-level spec and call out the conflict.',
  ].join('\n');
}

function adapterGetByXPath(xpath: string): Element | null {
  const node = getByXPath(xpath);
  return node instanceof Element ? node : null;
}

function injectPlanPrompt(n: number): void {
  const text = buildPlanTaskPrompt(n);
  const outcome = pasteIntoEditor(text, getPromptsConfig(), adapterGetByXPath);
  // Success ('injected') and clipboard-fallback ('clipboard') already toast from prompt-utils.
  // Only show a caller-side toast on hard failure.
  if (outcome === 'failed') showPasteToast('❌ Plan prompt: injection failed', true);
}

/** Render the Plan Task inline accordion into the container. */
export function renderPlanTaskSubmenu(container: HTMLElement, ctx: PromptContext): void {
  const { item, sub } = buildShell(ctx);
  appendPresetSteps(sub, ctx.promptsDropdown);
  appendCustomStepRow(sub, ctx.promptsDropdown);
  container.appendChild(item);
}

function buildShell(ctx: PromptContext): { item: HTMLElement; sub: HTMLElement } {
  const item = document.createElement('div');
  item.style.cssText = 'border-bottom:1px solid rgba(124,58,237,0.3);';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;cursor:pointer;font-size:11px;color:' + cPrimaryLight + ';font-weight:600;';
  row.textContent = '🧠 Plan Task';
  const arrow = document.createElement('span');
  arrow.textContent = '▸';
  arrow.style.cssText = 'font-size:10px;margin-left:4px;';
  row.appendChild(arrow);

  const sub = document.createElement('div');
  sub.setAttribute('data-plan-task-sub', '1');
  sub.style.cssText = 'display:none;position:static;margin:0 6px 6px 6px;background:rgba(0,0,0,0.18);border:1px solid ' + cPrimary + ';border-radius:' + lDropdownRadius + ';';
  item.appendChild(row);
  item.appendChild(sub);
  wireShellToggle(row, arrow, sub, ctx.promptsDropdown);
  return { item, sub };
}

function wireShellToggle(row: HTMLElement, arrow: HTMLElement, sub: HTMLElement, dropdown: HTMLElement): void {
  const show = function(): void {
    row.style.background = cBtnMenuHover;
    arrow.textContent = '▾';
    sub.style.display = 'block';
    keepInView(dropdown, sub);
  };
  const hide = function(): void {
    row.style.background = 'transparent';
    arrow.textContent = '▸';
    sub.style.display = 'none';
  };
  row.onclick = function(e: Event) {
    e.stopPropagation();
    if (sub.style.display === 'none') show(); else hide();
  };
  // RC-3 fix: do NOT auto-collapse on mouseleave. Outside-click handler in prompts-dropdown.ts
  // already closes the parent dropdown (and therefore this sub) when the user clicks away.
  // The previous 120ms timeout raced with preset clicks that crossed the panel border.
}

function keepInView(dropdown: HTMLElement, sub: HTMLElement): void {
  window.requestAnimationFrame(function() {
    const dr = dropdown.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    if (sr.bottom > dr.bottom) dropdown.scrollTop += Math.ceil(sr.bottom - dr.bottom + 6);
  });
}

function appendPresetSteps(sub: HTMLElement, dropdown: HTMLElement): void {
  for (const n of PLAN_TASK_STEP_COUNTS) {
    const it = document.createElement('div');
    it.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:10px;color:' + cPanelFg + ';';
    it.textContent = 'Plan in ' + n + ' steps';
    it.onmouseover = function() { (this as HTMLElement).style.background = cBtnMenuHover; };
    it.onmouseout = function() { (this as HTMLElement).style.background = 'transparent'; };
    it.onclick = function(e: Event) {
      e.stopPropagation();
      injectPlanPrompt(n);
      dropdown.style.display = 'none';
    };
    sub.appendChild(it);
  }
}

function appendCustomStepRow(sub: HTMLElement, dropdown: HTMLElement): void {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 12px;border-top:1px solid rgba(124,58,237,0.2);';
  const lbl = document.createElement('span');
  lbl.textContent = 'Custom:';
  lbl.style.cssText = 'font-size:10px;color:' + cPrimaryLight + ';';
  row.appendChild(lbl);
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '1'; inp.max = '999'; inp.placeholder = '#';
  inp.style.cssText = 'width:50px;padding:3px 5px;background:rgba(0,0,0,0.3);border:1px solid rgba(124,58,237,0.3);border-radius:4px;color:' + cPanelFg + ';font-size:10px;';
  inp.onclick = function(e: Event) { e.stopPropagation(); };
  row.appendChild(inp);
  const go = document.createElement('span');
  go.textContent = '▶'; go.title = 'Plan';
  go.style.cssText = 'cursor:pointer;font-size:11px;color:' + cPrimary + ';';
  go.onclick = function(e: Event) {
    e.stopPropagation();
    const n = parseInt(inp.value, 10);
    if (!n || n < 1 || n > 999) { showPasteToast('⚠️ Enter 1–999', true); return; }
    injectPlanPrompt(n);
    dropdown.style.display = 'none';
  };
  inp.onkeydown = function(e: KeyboardEvent) { if (e.key === 'Enter') { e.stopPropagation(); go.click(); } };
  row.appendChild(go);
  sub.appendChild(row);
}
