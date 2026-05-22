/**
 * Remix Dropdown — v2.217.0
 *
 * Reusable split-button entry point for the project-remix flow. Two actions:
 *   • Remix       — opens the configuration modal (RemixModal).
 *   • Remix Next  — runs the auto-name resolver, then submits immediately.
 *
 * The dropdown itself is rendered by callers (panel-header split button or
 * ws-context-menu submenu). This module exposes only the two action
 * handlers + the reusable dropdown menu builder used by the header.
 */

import { cPanelBg, cPanelFg, cPanelBorder, cPrimaryLight, lDropdownRadius } from './shared-state';
import { showRemixModal } from './remix-modal';
import { getRemixConfig, openRemixRedirect } from './remix-config';
import { fetchWorkspaceProjectNames, submitRemix } from './remix-fetch';
import { resolveNextName } from './remix-name-resolver';
import { showToast } from './toast';
import { logError } from './error-utils';
import { log } from './logging';

const HEADER_DROPDOWN_ID = 'marco-remix-header-dropdown';

export interface RemixActionContext {
  projectId: string;
  workspaceId: string;
  currentProjectName: string;
}

/** "Remix" — open the manual configuration modal. */
export function actionRemixManual(ctx: RemixActionContext): void {
  showRemixModal({
    projectId: ctx.projectId,
    workspaceId: ctx.workspaceId,
    currentProjectName: ctx.currentProjectName,
  });
}

/** "Remix Next" — resolve next name + submit immediately. */
export async function actionRemixNext(ctx: RemixActionContext): Promise<void> {
  if (!ctx.projectId || !ctx.workspaceId) {
    showToast('Remix Next unavailable — missing project or workspace id', 'warn');
    return;
  }
  const cfg = getRemixConfig();
  showToast('🔀 Resolving next name…', 'info');
  try {
    const existing = await fetchWorkspaceProjectNames(ctx.workspaceId);
    const { name, collisionsResolved } = resolveNextName(ctx.currentProjectName, existing, {
      nextSuffixSeparator: cfg.nextSuffixSeparator,
      maxCollisionIncrements: cfg.maxCollisionIncrements,
      nextVCasing: cfg.nextVCasing,
    });
    log('[RemixNext] resolved "' + ctx.currentProjectName + '" → "' + name + '"'
      + (collisionsResolved > 0 ? ' (+' + collisionsResolved + ' collision skips)' : ''), 'info');
    showToast('🔀 Remixing → "' + name + '"…', 'info');
    const result = await submitRemix({
      projectId: ctx.projectId,
      workspaceId: ctx.workspaceId,
      projectName: name,
      includeHistory: cfg.defaultIncludeHistory,
      includeCustomKnowledge: cfg.defaultIncludeCustomKnowledge,
    });
    showToast('✅ Remixed → "' + name + '"', 'success');
    if (result.redirectUrl) {
      openRemixRedirect(result.redirectUrl);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('RemixNext', 'Remix Next failed for "' + ctx.currentProjectName + '": ' + msg);
    showToast('❌ Remix Next failed: ' + msg, 'error');
  }
}

/* ------------------------------------------------------------------ */
/*  Header split-button + dropdown                                     */
/* ------------------------------------------------------------------ */

function removeHeaderDropdown(): void {
  const old = document.getElementById(HEADER_DROPDOWN_ID);
  if (old) old.remove();
}

function buildDropdownItem(label: string, sublabel: string, onClick: () => void): HTMLElement {
  const item = document.createElement('div');
  item.style.cssText = 'padding:7px 10px;cursor:pointer;font-size:11px;color:' + cPanelFg
    + ';display:flex;flex-direction:column;gap:1px;border-bottom:1px solid rgba(148,163,184,0.10);';
  item.innerHTML = '<span style="font-weight:600;">' + label
    + '</span><span style="font-size:9px;color:#94a3b8;">' + sublabel + '</span>';
  item.onmouseenter = function (): void { item.style.background = 'rgba(0,122,204,0.18)'; };
  item.onmouseleave = function (): void { item.style.background = 'transparent'; };
  item.onclick = function (e: MouseEvent): void {
    e.stopPropagation();
    removeHeaderDropdown();
    onClick();
  };
  return item;
}

/**
 * Show the header dropdown anchored beneath an arrow element. Used by the
 * panel-header split button. The ws-context-menu uses its own item flow
 * and does not call this.
 */
export function showHeaderRemixDropdown(anchorEl: HTMLElement, ctx: RemixActionContext): void {
  removeHeaderDropdown();
  const rect = anchorEl.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.id = HEADER_DROPDOWN_ID;
  dd.style.cssText = [
    'position:fixed',
    'top:' + (rect.bottom + 4) + 'px',
    'left:' + Math.max(8, rect.right - 180) + 'px',
    'z-index:100001',
    'min-width:180px',
    'background:' + cPanelBg,
    'color:' + cPanelFg,
    'border:1px solid ' + cPrimaryLight,
    'border-radius:' + lDropdownRadius,
    'box-shadow:0 6px 16px rgba(0,0,0,0.55)',
    'overflow:hidden',
  ].join(';') + ';';

  dd.appendChild(buildDropdownItem('🔀 Remix…', 'Open configuration popup', function () {
    actionRemixManual(ctx);
  }));
  dd.appendChild(buildDropdownItem('⏭️ Remix Next', 'Auto-increment to next V suffix', function () {
    void actionRemixNext(ctx);
  }));

  // Last item — drop the bottom border.
  const last = dd.lastElementChild as HTMLElement | null;
  if (last) last.style.borderBottom = 'none';

  document.body.appendChild(dd);
  setTimeout(function () {
    document.addEventListener('click', removeHeaderDropdown, { once: true });
  }, 10);
}

/**
 * Build the split-button (label + ▾ arrow) that opens the header dropdown.
 * Caller appends the returned element to the panel header.
 */
export function buildHeaderRemixSplitButton(getCtx: () => RemixActionContext | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:inline-flex;align-items:stretch;border:1px solid ' + cPanelBorder
    + ';border-radius:4px;overflow:hidden;margin-right:4px;line-height:1;';

  const main = document.createElement('button');
  main.type = 'button';
  main.title = 'Remix this project';
  main.style.cssText = 'background:rgba(0,122,204,0.18);color:#bae6fd;border:none;padding:2px 7px;'
    + 'font-size:10px;font-weight:600;cursor:pointer;border-right:1px solid ' + cPanelBorder + ';';
  main.textContent = '🔀 Remix';
  main.onclick = function (e: Event): void {
    e.stopPropagation();
    const ctx = getCtx();
    if (!ctx) { showToast('Remix unavailable — project/workspace not detected', 'warn'); return; }
    actionRemixManual(ctx);
  };

  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.title = 'More remix options';
  arrow.style.cssText = 'background:rgba(0,122,204,0.10);color:#bae6fd;border:none;padding:2px 5px;'
    + 'font-size:10px;cursor:pointer;';
  arrow.textContent = '▾';
  arrow.onclick = function (e: Event): void {
    e.stopPropagation();
    const ctx = getCtx();
    if (!ctx) { showToast('Remix unavailable — project/workspace not detected', 'warn'); return; }
    showHeaderRemixDropdown(arrow, ctx);
  };

  wrap.appendChild(main);
  wrap.appendChild(arrow);
  return wrap;
}
