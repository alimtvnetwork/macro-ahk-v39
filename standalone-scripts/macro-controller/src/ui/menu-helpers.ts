import { cPanelBg, cPrimary, cSeparator, lDropdownRadius, lDropdownShadow } from '../shared-state';
import { resolveFlyoutPlacement } from './flyout-placement';
 
/**
 * MacroLoop Controller — Menu Helper Functions
 * Step 03b: Extracted from createUI() closure
 *
 * Pure DOM builder functions for dropdown menu items and submenus.
 */


/** Context holding closure-scoped menu references */
export interface MenuCtx {
  menuBtnStyle: string;
  menuDropdown: HTMLElement;
}

export function createMenuItem(ctx: MenuCtx, icon: string, label: string, title: string, onclick: () => void): HTMLElement {
  const item = document.createElement('button');
  item.style.cssText = ctx.menuBtnStyle;
  item.title = title || label;
  item.innerHTML = '<span style="font-size:12px;width:18px;text-align:center;">' + icon + '</span><span>' + label + '</span>';
  item.onmouseover = function() { item.style.background = 'rgba(139,92,246,0.2)'; };
  item.onmouseout = function() { item.style.background = 'transparent'; };
  item.onclick = function(e) {
    e.stopPropagation();
    ctx.menuDropdown.style.display = 'none';
    onclick();
  };
  return item;
}

export function createMenuSep(): HTMLElement {
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:' + cSeparator + ';margin:3px 8px;opacity:0.4;';
  return sep;
}

// CQ16: Extracted submenu show/hide context
interface SubmenuCtx {
  hideTimer: ReturnType<typeof setTimeout> | null;
  trigger: HTMLElement;
  subPanel: HTMLElement;
}

// CQ16: Extracted from createSubmenu closure
function showSub(ctx: SubmenuCtx): void {
  if (ctx.hideTimer) { clearTimeout(ctx.hideTimer); ctx.hideTimer = null; }
  const tRect = ctx.trigger.getBoundingClientRect();
  ctx.subPanel.style.top = tRect.top + 'px';
  ctx.subPanel.style.left = tRect.right + 'px';
  ctx.subPanel.style.display = 'block';
}

// CQ16: Extracted from createSubmenu closure
function scheduleSub(ctx: SubmenuCtx): void {
  if (ctx.hideTimer) { clearTimeout(ctx.hideTimer); ctx.hideTimer = null; }
  ctx.hideTimer = setTimeout(function() { ctx.subPanel.style.display = 'none'; }, 150);
}

export function createSubmenu(ctx: MenuCtx, icon: string, label: string): { el: HTMLElement; panel: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;';
  const subPanel = document.createElement('div');

  const trigger = document.createElement('button');
  trigger.style.cssText = ctx.menuBtnStyle + 'justify-content:space-between;';
  trigger.innerHTML = '<span style="display:flex;align-items:center;gap:4px;"><span style="font-size:12px;width:18px;text-align:center;">' + icon + '</span><span>' + label + '</span></span><span style="font-size:10px;opacity:0.6;">▸</span>';

  const subCtx: SubmenuCtx = { hideTimer: null, trigger: trigger, subPanel: subPanel };

  trigger.onmouseover = function() {
    trigger.style.background = 'rgba(139,92,246,0.2)';
    showSub(subCtx);
  };
  trigger.onmouseout = function() { trigger.style.background = 'transparent'; };
  trigger.onclick = function(e) { e.stopPropagation(); subPanel.style.display = subPanel.style.display === 'none' ? 'block' : 'none'; };

  subPanel.setAttribute('data-marco-submenu', label);
  subPanel.style.cssText = 'display:none;position:fixed;min-width:170px;background:' + cPanelBg + ';border:1px solid ' + cPrimary + ';border-radius:' + lDropdownRadius + ';z-index:100004;box-shadow:' + lDropdownShadow + ';padding:4px 0;';

  // Keep subPanel open while mouse is over it
  subPanel.onmouseover = function() { showSub(subCtx); };
  subPanel.onmouseout = function() { scheduleSub(subCtx); };

  wrapper.onmouseover = function() { showSub(subCtx); };
  wrapper.onmouseout = function() { scheduleSub(subCtx); };

  wrapper.appendChild(trigger);
  document.body.appendChild(subPanel);

  return { el: wrapper, panel: subPanel };
}
