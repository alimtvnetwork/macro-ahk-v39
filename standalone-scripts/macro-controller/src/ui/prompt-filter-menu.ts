/**
 * Prompt Filter Menu — Inline accordion with multi-select category checkboxes.
 *
 * Replaces the legacy single-pick chip bar. Selected categories are persisted
 * in module state; empty selection means "show all".
 */

import { cPanelFg, cPanelFgDim, cPrimary, cPrimaryLight, cBtnMenuHover, lDropdownRadius } from '../shared-state';
import type { PromptContext } from './prompt-loader';
import type { TaskNextDeps } from './task-next-ui';
import {
  getPromptCategoryFilterSet,
  togglePromptCategoryFilter,
  clearPromptCategoryFilterSet,
} from './prompt-loader';

interface RerenderFn { (ctx: PromptContext, deps: TaskNextDeps): void }

/** Render the Filter inline accordion into the container. */
export function renderFilterMenu(
  container: HTMLElement,
  categories: string[],
  ctx: PromptContext,
  taskNextDeps: TaskNextDeps,
  rerender: RerenderFn,
): void {
  const { item, sub } = buildShell(ctx, categories);
  appendClearRow(sub, ctx, taskNextDeps, rerender);
  for (const cat of categories) {
    sub.appendChild(buildCategoryRow(cat, ctx, taskNextDeps, rerender));
  }
  if (categories.length === 0) appendEmpty(sub);
  container.appendChild(item);
}

function buildShell(ctx: PromptContext, categories: string[]): { item: HTMLElement; sub: HTMLElement } {
  const item = document.createElement('div');
  item.style.cssText = 'border-bottom:1px solid rgba(124,58,237,0.3);';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;cursor:pointer;font-size:11px;color:' + cPrimaryLight + ';font-weight:600;';
  const activeCount = getPromptCategoryFilterSet().size;
  const label = activeCount > 0 ? '🔎 Filter (' + activeCount + ')' : '🔎 Filter';
  row.textContent = label + '  ';
  const arrow = document.createElement('span');
  arrow.textContent = '▸';
  arrow.style.cssText = 'font-size:10px;margin-left:4px;';
  row.appendChild(arrow);

  const sub = document.createElement('div');
  sub.setAttribute('data-prompt-filter-sub', '1');
  sub.style.cssText = 'display:none;position:static;margin:0 6px 6px 6px;background:rgba(0,0,0,0.18);border:1px solid ' + cPrimary + ';border-radius:' + lDropdownRadius + ';max-height:180px;overflow-y:auto;';
  item.appendChild(row);
  item.appendChild(sub);
  wireToggle(row, arrow, sub, ctx.promptsDropdown, categories.length);
  return { item, sub };
}

function wireToggle(row: HTMLElement, arrow: HTMLElement, sub: HTMLElement, dropdown: HTMLElement, count: number): void {
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
    if (count === 0) return;
    if (sub.style.display === 'none') show(); else hide();
  };
}

function keepInView(dropdown: HTMLElement, sub: HTMLElement): void {
  window.requestAnimationFrame(function() {
    const dr = dropdown.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    if (sr.bottom > dr.bottom) dropdown.scrollTop += Math.ceil(sr.bottom - dr.bottom + 6);
  });
}

function appendClearRow(sub: HTMLElement, ctx: PromptContext, deps: TaskNextDeps, rerender: RerenderFn): void {
  const it = document.createElement('div');
  it.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:10px;color:' + cPrimaryLight + ';border-bottom:1px solid rgba(124,58,237,0.2);';
  it.textContent = '✖ Clear all (show every category)';
  it.onmouseover = function() { (this as HTMLElement).style.background = cBtnMenuHover; };
  it.onmouseout = function() { (this as HTMLElement).style.background = 'transparent'; };
  it.onclick = function(e: Event) {
    e.stopPropagation();
    clearPromptCategoryFilterSet();
    rerender(ctx, deps);
  };
  sub.appendChild(it);
}

function buildCategoryRow(cat: string, ctx: PromptContext, deps: TaskNextDeps, rerender: RerenderFn): HTMLElement {
  const it = document.createElement('div');
  const isOn = getPromptCategoryFilterSet().has(cat.toLowerCase());
  it.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 12px;cursor:pointer;font-size:10px;color:' + cPanelFg + ';';
  const box = document.createElement('span');
  box.textContent = isOn ? '☑' : '☐';
  box.style.cssText = 'font-size:11px;color:' + cPrimary + ';';
  it.appendChild(box);
  const lbl = document.createElement('span');
  lbl.textContent = cat;
  it.appendChild(lbl);
  it.onmouseover = function() { (this as HTMLElement).style.background = cBtnMenuHover; };
  it.onmouseout = function() { (this as HTMLElement).style.background = 'transparent'; };
  it.onclick = function(e: Event) {
    e.stopPropagation();
    togglePromptCategoryFilter(cat.toLowerCase());
    rerender(ctx, deps);
  };
  return it;
}

function appendEmpty(sub: HTMLElement): void {
  const it = document.createElement('div');
  it.style.cssText = 'padding:8px 12px;font-size:10px;color:' + cPanelFgDim + ';text-align:center;';
  it.textContent = '(no categories defined yet)';
  sub.appendChild(it);
}
