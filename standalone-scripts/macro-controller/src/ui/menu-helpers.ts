import { cPanelBg, cPrimary, cSeparator, lDropdownRadius, lDropdownShadow } from '../shared-state';
import { resolveFlyoutPlacement } from './flyout-placement';
 
/**
 * MacroLoop Controller — Menu Helper Functions
 * Step 03b: Extracted from createUI() closure
 *
 * Pure DOM builder functions for dropdown menu items and submenus.
 */

const ATTR_ARIA_EXPANDED = 'aria-expanded';

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
  reflowHandler: (() => void) | null;
}

function positionSub(ctx: SubmenuCtx): void {
  const tRect = ctx.trigger.getBoundingClientRect();
  const sRect = ctx.subPanel.getBoundingClientRect();
  const placement = resolveFlyoutPlacement(
    tRect,
    { width: sRect.width, height: sRect.height },
    { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
  );
  ctx.subPanel.style.top = placement.top + 'px';
  ctx.subPanel.style.left = placement.left + 'px';
  ctx.subPanel.setAttribute('data-marco-placement-h', placement.horizontal);
  ctx.subPanel.setAttribute('data-marco-placement-v', placement.vertical);
}

// Step A4: auto-flip placement — opens right by default, flips left near the
// right edge; opens down by default, flips up near the bottom edge.
// Step A5: recompute on scroll/resize while open; tear down on close.
function showSub(ctx: SubmenuCtx): void {
  if (ctx.hideTimer) { clearTimeout(ctx.hideTimer); ctx.hideTimer = null; }
  ctx.subPanel.style.visibility = 'hidden';
  ctx.subPanel.style.display = 'block';
  positionSub(ctx);
  ctx.subPanel.style.visibility = 'visible';
  if (!ctx.reflowHandler) {
    let raf = 0;
    const handler = (): void => {
      if (raf) { return; }
      raf = window.requestAnimationFrame(function() {
        raf = 0;
        if (ctx.subPanel.style.display !== 'none') { positionSub(ctx); }
      });
    };
    ctx.reflowHandler = handler;
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
  }
}

function hideSub(ctx: SubmenuCtx): void {
  ctx.subPanel.style.display = 'none';
  if (ctx.reflowHandler) {
    window.removeEventListener('scroll', ctx.reflowHandler, true);
    window.removeEventListener('resize', ctx.reflowHandler);
    ctx.reflowHandler = null;
  }
}

function scheduleSub(ctx: SubmenuCtx): void {
  if (ctx.hideTimer) { clearTimeout(ctx.hideTimer); ctx.hideTimer = null; }
  ctx.hideTimer = setTimeout(function() { hideSub(ctx); }, 150);
}

export function createSubmenu(ctx: MenuCtx, icon: string, label: string): { el: HTMLElement; panel: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;';
  const subPanel = document.createElement('div');

  const trigger = document.createElement('button');
  trigger.style.cssText = ctx.menuBtnStyle + 'justify-content:space-between;';
  trigger.innerHTML = '<span style="display:flex;align-items:center;gap:4px;"><span style="font-size:12px;width:18px;text-align:center;">' + icon + '</span><span>' + label + '</span></span><span style="font-size:10px;opacity:0.6;">▸</span>';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute(ATTR_ARIA_EXPANDED, 'false');

  const subCtx: SubmenuCtx = { hideTimer: null, trigger: trigger, subPanel: subPanel, reflowHandler: null };

  trigger.onmouseover = function() {
    trigger.style.background = 'rgba(139,92,246,0.2)';
    showSub(subCtx);
    trigger.setAttribute(ATTR_ARIA_EXPANDED, 'true');
  };
  trigger.onmouseout = function() { trigger.style.background = 'transparent'; };
  trigger.onclick = function(e) {
    e.stopPropagation();
    const open = subPanel.style.display === 'none' || subPanel.style.display === '';
    if (open) { showSub(subCtx); } else { hideSub(subCtx); }
    trigger.setAttribute(ATTR_ARIA_EXPANDED, open ? 'true' : 'false');
  };
  trigger.onkeydown = function(e) {
    if (e.key === 'Escape') { hideSub(subCtx); trigger.setAttribute(ATTR_ARIA_EXPANDED, 'false'); trigger.focus(); }
  };

  subPanel.setAttribute('data-marco-submenu', label);
  subPanel.setAttribute('role', 'menu');
  subPanel.setAttribute('aria-label', label);
  subPanel.style.cssText = 'display:none;position:fixed;min-width:170px;background:' + cPanelBg + ';border:1px solid ' + cPrimary + ';border-radius:' + lDropdownRadius + ';z-index:100004;box-shadow:' + lDropdownShadow + ';padding:4px 0;';
  subPanel.onkeydown = function(e) {
    if (e.key === 'Escape') { hideSub(subCtx); trigger.setAttribute(ATTR_ARIA_EXPANDED, 'false'); trigger.focus(); }
  };

  subPanel.onmouseover = function() { showSub(subCtx); };
  subPanel.onmouseout = function() { scheduleSub(subCtx); };

  wrapper.onmouseover = function() { showSub(subCtx); };
  wrapper.onmouseout = function() { scheduleSub(subCtx); };

  wrapper.appendChild(trigger);
  document.body.appendChild(subPanel);

  return { el: wrapper, panel: subPanel };
}
