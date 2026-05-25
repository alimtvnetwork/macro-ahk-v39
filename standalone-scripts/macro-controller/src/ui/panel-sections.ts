/**
 * Panel Sections — Tools master section and panel assembly extracted from panel-builder.ts (Phase 5F)
 *
 * Builds the tools & logs master collapsible, workspace history, auth diagnostics,
 * workspace dropdown, hot-reload section, and the final panel assembly + record indicator.
 */

import {
  IDS,
  cSectionBg,
  cNeutral400,
  tFont,
  tFontSm,
  tFontMicro,
  cPrimaryLight,
  cPrimaryGlowS,
  cPrimaryGlowSub,
  trFast,
  
} from '../shared-state';
import { log, logSub, getDisplayProjectName, getWsHistoryKey } from '../logging';
import {
  getLastTokenSource,
  getLastBridgeOutcome,
  getSessionCookieNames,
  recoverAuthOnce,
  refreshBearerTokenFromBestSource,
  resolveToken,
  wakeBridge,
} from '../auth';
import { setRecordRefreshOutcome } from '../auth';
import { showToast } from '../toast';
import { nsWrite } from '../api-namespace';
import { buildWsDropdownSection } from './ws-dropdown-builder';
import { buildToolsSections } from './tools-sections-builder';
import {
  createCollapsibleSection,
  createWsHistorySection,
  createAuthDiagRow,
  recordRefreshOutcome,
} from './sections';
import { showSettingsDialog } from './settings-ui';
import { buildHotReloadSection, checkAndRestoreReinjectState } from './hot-reload-section';
import { createOpenTabsSection } from './section-open-tabs';
import { injectSkeletonStyles, createStatusSkeleton } from './skeleton';
import { getPromptsConfig, sendToExtension } from './prompt-manager';
import { registerKeyboardHandlers } from './keyboard-handlers';
import {
  createPanelLayoutCtx,
  createResizeHandle,
  enableFloating,
  loadPanelGeometry,
  restorePanel,
  setupDragListeners,
  setupResizeListeners,
} from './panel-layout';
import { getWorkspaceHistory } from '../workspace-observer';

import type { PanelBuilderDeps } from './panel-builder';

import type { TaskNextDeps } from './task-next-ui';
import type { SettingsDeps } from './settings-ui';
import type { PanelLayoutCtx } from './panel-layout';

// ============================================
// Return types
// ============================================

export interface StatusBarResult {
  status: HTMLElement;
  infoRow: HTMLElement;
}

export interface ToolsMasterResult {
  toolsSection: HTMLElement;
  wsDropSection: HTMLElement;
  authDiagRow: HTMLElement;
  jsBody: HTMLElement;
  settingsDeps: SettingsDeps;
}


// ============================================
// buildStatusBar — status + info row
// ============================================

export function buildStatusBar(): StatusBarResult {
  const status = document.createElement('div');
  status.id = IDS.STATUS;
  status.style.cssText = 'font-family:' + tFont + ';font-size:' + tFontSm + ';padding:4px 6px;background:' + cSectionBg + ';border-radius:4px;color:' + cNeutral400 + ';';
  // Show shimmer skeleton instead of "Initializing..." text
  status.appendChild(createStatusSkeleton());

  const infoRow = document.createElement('div');
  infoRow.style.cssText = 'font-size:' + tFontMicro + ';color:' + cPrimaryLight + ';padding:2px 6px;background:' + cSectionBg + ';border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  infoRow.textContent = '1. Open Dialog -> 2. Check Credit -> 3. Double-Confirm -> 4. Delegate | Ctrl+Alt+Up/Down | Ctrl+Up/Down (Move) | Ctrl+Alt+H to hide';

  return { status, infoRow };
}

// ============================================
// buildToolsMasterSection — tools & logs collapsible + sub-sections
// ============================================

export function buildToolsMasterSection(
  deps: PanelBuilderDeps,
  btnStyle: string,
  taskNextDeps: TaskNextDeps,
): ToolsMasterResult {
  const toolsSections = buildToolsSections({
    btnStyle, updateProjectButtonXPath: deps.updateProjectButtonXPath,
    updateProgressXPath: deps.updateProgressXPath,
    updateWorkspaceXPath: deps.updateWorkspaceXPath,
    executeJs: deps.executeJs, navigateLoopJsHistory: deps.navigateLoopJsHistory,
  });

  const wsHistoryResult = createWsHistorySection({
    getWorkspaceHistory: getWorkspaceHistory,
    getDisplayProjectName: getDisplayProjectName,
    getWsHistoryKey: getWsHistoryKey,
  });

  const authDiagResult = _buildAuthDiagnostics();
  const wsDropSection = _buildWsDropdown(deps).wsDropSection;
  const { toolsCol, settingsDeps } = _buildToolsCollapsible(deps, btnStyle, taskNextDeps, toolsSections, wsHistoryResult);

  return { toolsSection: toolsCol.section, wsDropSection, authDiagRow: authDiagResult.row, jsBody: toolsSections.jsBody, settingsDeps };
}

function _buildAuthDiagnostics(): { row: HTMLElement; updateAuthDiagRow: () => void } {
  const authDiagResult = createAuthDiagRow({
    getLastTokenSource: function() { return getLastTokenSource(); },
    resolveToken: resolveToken,
    recoverAuthOnce: recoverAuthOnce,
    getSessionCookieNames: getSessionCookieNames,
    getLastBridgeOutcome: getLastBridgeOutcome,
    refreshFromBestSource: refreshBearerTokenFromBestSource,
    wakeBridge: wakeBridge,
  });
  nsWrite('_internal.updateAuthDiag', authDiagResult.updateAuthDiagRow);
  setRecordRefreshOutcome(recordRefreshOutcome);
  return { row: authDiagResult.row, updateAuthDiagRow: authDiagResult.updateAuthDiagRow };
}

function _buildWsDropdown(deps: PanelBuilderDeps): { wsDropSection: HTMLElement } {
  return buildWsDropdownSection({
    populateLoopWorkspaceDropdown: deps.populateLoopWorkspaceDropdown,
    updateWsSelectionUI: deps.updateWsSelectionUI,
    renderBulkRenameDialog: deps.renderBulkRenameDialog,
    getRenameHistory: deps.getRenameHistory,
    undoLastRename: deps.undoLastRename,
    updateUndoBtnVisibility: deps.updateUndoBtnVisibility,
    fetchLoopCreditsWithDetect: deps.fetchLoopCreditsWithDetect,
    autoDetectLoopCurrentWorkspace: deps.autoDetectLoopCurrentWorkspace,
    getLoopWsFreeOnly: deps.getLoopWsFreeOnly,
    setLoopWsFreeOnly: deps.setLoopWsFreeOnly,
    getLoopWsCompactMode: deps.getLoopWsCompactMode,
    setLoopWsCompactMode: deps.setLoopWsCompactMode,
    getLoopWsExpiredWithCredits: deps.getLoopWsExpiredWithCredits,
    setLoopWsExpiredWithCredits: deps.setLoopWsExpiredWithCredits,
    getLoopWsRefillSoon: deps.getLoopWsRefillSoon,
    setLoopWsRefillSoon: deps.setLoopWsRefillSoon,
    getLoopWsRefillPriority: deps.getLoopWsRefillPriority,
    setLoopWsRefillPriority: deps.setLoopWsRefillPriority,
    getLoopWsNavIndex: deps.getLoopWsNavIndex,
    setLoopWsNavIndex: deps.setLoopWsNavIndex,
    triggerLoopMoveFromSelection: deps.triggerLoopMoveFromSelection,
  });
}

 
function _buildToolsCollapsible(
  _deps: PanelBuilderDeps, btnStyle: string, taskNextDeps: TaskNextDeps,
  toolsSections: ReturnType<typeof buildToolsSections>,
  wsHistoryResult: { section: HTMLElement },
): { toolsCol: ReturnType<typeof createCollapsibleSection>; settingsDeps: SettingsDeps } {
  const toolsCol = createCollapsibleSection('🔧 Tools & Logs', 'ml_collapse_tools_master');
  const toolsMasterBody = toolsCol.body;
  toolsMasterBody.style.cssText = 'margin-top:4px;display:flex;flex-direction:column;gap:4px;';
  toolsMasterBody.style.display = 'none';
  toolsCol.toggle.textContent = '[+]';

  const settingsDeps = { btnStyle: btnStyle, taskNextDeps: taskNextDeps, getPromptsConfig: getPromptsConfig, showToast: showToast, log: log, sendToExtension: sendToExtension };
  const settingsGearBtn = document.createElement('span');
  settingsGearBtn.textContent = '⚙️';
  settingsGearBtn.title = 'Open Settings';
  settingsGearBtn.style.cssText = 'font-size:12px;cursor:pointer;margin-left:auto;padding:2px 6px;border-radius:4px;transition:background 0.15s;';
  settingsGearBtn.onmouseenter = function() { settingsGearBtn.style.background = 'rgba(255,255,255,0.1)'; };
  settingsGearBtn.onmouseleave = function() { settingsGearBtn.style.background = 'none'; };
  settingsGearBtn.onclick = function(e: Event) { e.stopPropagation(); showSettingsDialog(settingsDeps); };
  toolsCol.header.style.cssText += 'display:flex;align-items:center;';
  toolsCol.header.appendChild(settingsGearBtn);

  let _reinjectSection: HTMLElement | null = null;
  const versionBadge = document.createElement('span');
  versionBadge.style.cssText = 'display:none;font-size:9px;background:#e94560;color:#fff;padding:1px 5px;border-radius:8px;margin-left:6px;font-weight:700;line-height:1.2;animation:pulse 2s ease-in-out infinite;cursor:pointer;';
  versionBadge.onclick = function(e: Event) {
    e.stopPropagation();
    if (toolsMasterBody.style.display === 'none') {
      toolsMasterBody.style.display = '';
      toolsCol.toggle.textContent = '[-]';
      try { localStorage.setItem('ml_collapse_tools_master', 'expanded'); } catch (_e) { logSub('Failed to persist tools collapse state: ' + (_e instanceof Error ? _e.message : String(_e)), 1); }
    }
    if (_reinjectSection) {
      setTimeout(function() { _reinjectSection!.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
    }
  };
  toolsCol.header.insertBefore(versionBadge, settingsGearBtn);

  toolsMasterBody.appendChild(wsHistoryResult.section);
  const openTabsResult = createOpenTabsSection();
  toolsMasterBody.appendChild(openTabsResult.section);
  toolsMasterBody.appendChild(toolsSections.xpathSection);
  toolsMasterBody.appendChild(toolsSections.activitySection);
  toolsMasterBody.appendChild(toolsSections.logSection);
  toolsMasterBody.appendChild(toolsSections.recentErrorsSection);
  toolsMasterBody.appendChild(toolsSections.jsSection);

  const hotReloadResult = buildHotReloadSection(function(availVer: string) {
    versionBadge.textContent = 'v' + availVer;
    versionBadge.title = 'Click to jump to Script Re-Inject';
    versionBadge.style.display = '';
  });
  _reinjectSection = hotReloadResult.section;
  toolsMasterBody.appendChild(hotReloadResult.section);

  checkAndRestoreReinjectState();

  return { toolsCol, settingsDeps };
}

// ============================================
// injectKeyframeStyles — CSS animations
// ============================================

export function injectKeyframeStyles(): void {
  injectSkeletonStyles();
  const style = document.createElement('style');
  style.textContent = ''
    + '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}.loop-pulse{animation:pulse 1s infinite}'
    + '@keyframes ml-badge-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(1.15)}}'
    + '@keyframes marcoFadeIn{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}'
    + '@keyframes marcoScaleIn{0%{transform:scale(0.95);opacity:0}100%{transform:scale(1);opacity:1}}'
    + '@keyframes marcoSlideIn{0%{transform:translateX(100%)}100%{transform:translateX(0)}}'
    + '@keyframes marcoGlow{0%,100%{box-shadow:0 0 8px ' + cPrimaryGlowSub + '}50%{box-shadow:0 0 18px ' + cPrimaryGlowS + '}}'
    + '.marco-fade-in{animation:marcoFadeIn 0.3s ease-out}'
    + '.marco-scale-in{animation:marcoScaleIn 0.2s ease-out}'
    + '.marco-enter{animation:marcoFadeIn 0.3s ease-out,marcoScaleIn 0.2s ease-out}'
    + '.marco-glow{animation:marcoGlow 2s cubic-bezier(0.4,0,0.6,1) infinite}'
    + '.marco-hover-scale{transition:filter 150ms ease,background-color 150ms ease}'
    + '.marco-hover-scale:hover{filter:brightness(1.12)}'
    + '.marco-transition{transition:color ' + trFast + ',background-color ' + trFast + ',border-color ' + trFast + ',box-shadow ' + trFast + '}';
  document.head.appendChild(style);
}

// ============================================
// createRecordIndicator — loop pulse indicator
// ============================================

export function createRecordIndicator(): HTMLElement {
  const record = document.createElement('div');
  record.id = IDS.RECORD_INDICATOR;
  record.className = 'loop-pulse';
  record.style.cssText = 'display:none;position:fixed;top:15px;right:15px;padding:8px 12px;background:#dc2626;border-radius:20px;color:#fff;font-size:12px;font-weight:bold;z-index:99999;align-items:center;gap:6px;box-shadow:0 4px 12px rgba(220,38,38,.4);';
  record.innerHTML = '<span style="width:10px;height:10px;background:#fff;border-radius:50%;display:inline-block;"></span> LOOP';
  return record;
}

// ============================================
// Re-export panel-layout helpers used by createUI
// ============================================

export {
  createPanelLayoutCtx,
  createResizeHandle,
  enableFloating,
  loadPanelGeometry,
  restorePanel,
  setupDragListeners,
  setupResizeListeners,
  registerKeyboardHandlers,
};

export type { PanelLayoutCtx };
