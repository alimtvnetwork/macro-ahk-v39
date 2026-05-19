/**
 * Panel Header — Title bar construction extracted from panel-builder.ts (Phase 5F)
 *
 * Builds the title row: title label, project name, workspace badge,
 * version span, auth badge, minimize/close buttons, and drag handlers.
 */

import {
  VERSION,
  cPrimaryLight,
  cNeutral500,
  tFontTiny,
  state,
} from '../shared-state';
import { log } from '../logging';
import {
  getLastTokenSource,
  refreshBearerTokenFromBestSource,
  resolveToken,
  updateAuthBadge,
} from '../auth';
import { showToast } from '../toast';
import { showAboutModal } from './about-modal';
import {
  startDragHandler,
  toggleMinimize,
} from './panel-layout';
import { destroyPanel, updateUI } from './ui-updaters';

import type { PanelBuilderDeps } from './panel-builder';
import type { PanelLayoutCtx } from './panel-layout';
import { logError } from '../error-utils';
import { CssFragment } from '../types';
import { getCurrentWorkspaceDisplayName, getTitleBarDisplayState } from './title-bar-display';
import { buildHeaderRemixSplitButton } from '../remix-dropdown';
import { extractProjectIdFromUrl } from '../workspace-detection';
import { getDisplayProjectName } from '../logging';
import { loopCreditState } from '../shared-state';
// ============================================
// Return type for buildTitleRow
// ============================================

export interface TitleRowResult {
  titleRow: HTMLElement;
  wsNameEl: HTMLElement;
  authBadge: HTMLElement;
  panelToggleSpan: HTMLElement;
}

// ============================================
// buildTitleRow — title bar with drag, auth, minimize/close
// ============================================

export function buildTitleRow(
  deps: PanelBuilderDeps,
  plCtx: PanelLayoutCtx,
): TitleRowResult {
  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:grab;user-select:none;padding:0 0 2px 0;flex-wrap:nowrap;white-space:nowrap;';
  titleRow.title = 'Drag to move, click to minimize/expand';

  const { elements, wsNameEl, authBadge, panelToggleSpan, hideBtn } = _buildTitleElements(deps, plCtx);
  _setupTitleDragHandlers(titleRow, plCtx, hideBtn, panelToggleSpan);
  _assembleTitleRow(titleRow, elements);

  return { titleRow, wsNameEl, authBadge, panelToggleSpan };
}

function _buildTitleElements(deps: PanelBuilderDeps, plCtx: PanelLayoutCtx) {
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:bold;color:#E0E0E0;font-size:14px;flex-shrink:0;white-space:nowrap;transform:translateY(-2px);';
  title.textContent = 'TS Macro';

  const wsNameEl = buildWorkspaceNameBadge(deps);

  const versionSpan = document.createElement('span');
  versionSpan.style.cssText = CssFragment.FontSize + tFontTiny + ';color:' + cPrimaryLight + ';margin-right:4px;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;';
  versionSpan.textContent = 'v' + VERSION;
  versionSpan.title = 'Click to see About info';
  versionSpan.onclick = function(e: Event) { e.stopPropagation(); showAboutModal(); };

  const authBadge = buildAuthBadge();

  const remixSplit = buildHeaderRemixSplitButton(function () {
    const projectId = extractProjectIdFromUrl();
    const wsId = loopCreditState.currentWs ? loopCreditState.currentWs.id : '';
    if (!projectId || !wsId) return null;
    return {
      projectId,
      workspaceId: wsId,
      currentProjectName: getDisplayProjectName(),
    };
  });

  // v3.4.3 (task 10) — Settings (gear) button removed from workspace section per spec 113.
  // The Macro Settings modal exposed credits/grace-period fields the user cannot modify.

  const panelToggleSpan = document.createElement('span');
  panelToggleSpan.style.cssText = CssFragment.FontSize + tFontTiny + ';color:' + cNeutral500 + ';cursor:pointer;margin-right:4px;white-space:nowrap;flex-shrink:0;';
  panelToggleSpan.textContent = plCtx.panelState === 'minimized' ? '[ + ]' : '[ - ]';
  panelToggleSpan.title = 'Minimize / Expand panel';
  panelToggleSpan.onclick = function(e: Event) { e.stopPropagation(); toggleMinimize(plCtx); };
  plCtx.panelToggleSpan = panelToggleSpan;

  const hideBtn = document.createElement('span');
  hideBtn.style.cssText = CssFragment.FontSize + tFontTiny + ';color:' + cNeutral500 + ';cursor:pointer;white-space:nowrap;flex-shrink:0;';
  hideBtn.textContent = '[ x ]';
  hideBtn.title = 'Close and fully remove controller (re-inject to restore)';
  hideBtn.onclick = function(e: Event) { e.stopPropagation(); destroyPanel(); };

  return {
    elements: { title, wsNameEl, versionSpan, remixSplit, authBadge, panelToggleSpan, hideBtn },
    wsNameEl, authBadge, panelToggleSpan, hideBtn,
  };
}

function _setupTitleDragHandlers(titleRow: HTMLElement, plCtx: PanelLayoutCtx, hideBtn: HTMLElement, panelToggleSpan: HTMLElement): void {
  titleRow.onpointerdown = function(e: PointerEvent) {
    if (e.target === hideBtn || e.target === panelToggleSpan) return;
    startDragHandler(plCtx, e);
  };
  titleRow.onpointerup = function(e: PointerEvent) {
    if (e.target === hideBtn || e.target === panelToggleSpan) return;
    const dx = Math.abs(e.clientX - plCtx.dragStartPos.x);
    const dy = Math.abs(e.clientY - plCtx.dragStartPos.y);
    if (dx < 5 && dy < 5) { toggleMinimize(plCtx); }
  };
}

function _assembleTitleRow(titleRow: HTMLElement, els: Record<string, HTMLElement>): void {
  titleRow.appendChild(els.title);
  const titleSpacer = document.createElement('div');
  titleSpacer.style.cssText = 'flex:1;';
  titleRow.appendChild(titleSpacer);
  titleRow.appendChild(els.wsNameEl);
  titleRow.appendChild(els.versionSpan);
  titleRow.appendChild(els.remixSplit);
  titleRow.appendChild(els.settingsBtn);
  titleRow.appendChild(els.authBadge);
  titleRow.appendChild(els.panelToggleSpan);
  titleRow.appendChild(els.hideBtn);
}

// ============================================
// Project name badge builder (title bar)
// Displays project name from API or DOM — click to re-detect workspace
// ============================================

 
function buildWorkspaceNameBadge(deps: PanelBuilderDeps): HTMLElement {
  const wsNameEl = document.createElement('div');
  wsNameEl.id = 'loop-title-ws-name';
  wsNameEl.style.cssText = CssFragment.FontSize + tFontTiny + ';color:#fbbf24;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;cursor:pointer;border-bottom:1px dotted rgba(251,191,36,0.4);transition:color 0.15s;margin-right:4px;';
  const titleBarState = getTitleBarDisplayState();
  wsNameEl.title = titleBarState.title;
  wsNameEl.style.opacity = titleBarState.opacity;

  if (titleBarState.text !== '⟳ detecting…') {
    wsNameEl.textContent = titleBarState.text;
  } else {
    const wsShimmer = document.createElement('span');
    wsShimmer.className = 'marco-skeleton';
    wsShimmer.setAttribute('data-skeleton', 'ws-name');
    wsShimmer.style.cssText = 'display:inline-block;width:80px;height:10px;border-radius:3px;vertical-align:middle;';
    wsNameEl.appendChild(wsShimmer);
  }

  wsNameEl.onmouseenter = function() { wsNameEl.style.color = '#fde68a'; };
  wsNameEl.onmouseleave = function() { wsNameEl.style.color = '#fbbf24'; };
  wsNameEl.onclick = function(e: Event) {
    e.stopPropagation();
    wsNameEl.textContent = '⏳ detecting…';
    wsNameEl.style.color = '#9ca3af';
    const token = resolveToken();
    state.workspaceFromApi = false;
    deps.autoDetectLoopCurrentWorkspace(token).then(function() {
      const nextTitleBarState = getTitleBarDisplayState();
      wsNameEl.style.color = nextTitleBarState.color;
      wsNameEl.style.opacity = nextTitleBarState.opacity;
      wsNameEl.textContent = nextTitleBarState.text;
      wsNameEl.title = nextTitleBarState.title;
      const ws = getCurrentWorkspaceDisplayName();
      if (ws) {
        log('Title bar: ✅ Workspace re-detected: "' + ws + '"', 'success');
        showToast('Workspace: ' + ws, 'success');
      }
      updateUI();
    }).catch(function(e: unknown) {
      logError('switchWorkspace', 'Workspace switch failed', e);
      showToast('❌ Workspace switch failed', 'error');
      wsNameEl.style.color = '#f87171';
      wsNameEl.textContent = '❌ failed';
      setTimeout(function() {
        const fallbackTitleBarState = getTitleBarDisplayState();
        wsNameEl.style.color = fallbackTitleBarState.color;
        wsNameEl.style.opacity = fallbackTitleBarState.opacity;
        wsNameEl.textContent = fallbackTitleBarState.text;
        wsNameEl.title = fallbackTitleBarState.title;
      }, 2000);
    });
  };

  return wsNameEl;
}

// ============================================
// Auth badge builder
// ============================================

function buildAuthBadge(): HTMLElement {
  const authBadge = document.createElement('span');
  authBadge.id = 'loop-auth-badge';
  authBadge.style.cssText = 'font-size:8px;margin-right:8px;cursor:pointer;vertical-align:middle;transition:opacity 0.2s;';
  authBadge.textContent = '🔴';
  authBadge.title = 'Auth: no token — click to refresh';
  authBadge.addEventListener('click', function() {
    authBadge.style.opacity = '0.4';
    authBadge.title = 'Refreshing token…';
    log('Auth badge clicked — triggering manual token refresh', 'check');
    refreshBearerTokenFromBestSource(function(token: string, source: string) {
      authBadge.style.opacity = '1';
      if (token) {
        log('Auth badge refresh: ✅ Token resolved from ' + source, 'success');
        updateAuthBadge(true, source);
        showToast('🟢 Token refreshed (' + source + ')', 'success');
      } else {
        logError('Auth badge refresh', '❌ No token found');
        updateAuthBadge(false, 'none');
        showToast('🔴 Token refresh failed — please log in', 'warn');
      }
    });
  });
  const currentToken = resolveToken();
  if (currentToken) {
    authBadge.textContent = '🟢';
    authBadge.title = 'Auth: token available (' + (getLastTokenSource() || 'cached') + ') — click to refresh';
  }
  return authBadge;
}
