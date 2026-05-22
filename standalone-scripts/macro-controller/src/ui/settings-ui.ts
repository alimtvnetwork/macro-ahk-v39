 
/**
 * MacroLoop Controller — Settings Dialog
 *
 * Orchestrator: dialog shell, tab bar, makeField helper, save/reset
 * footer, and ESC-to-close. Delegates tab content to settings-tab-panels.
 *
 * Sub-modules: settings-tab-panels.
 *
 * @see spec/04-macro-controller/ts-migration-v2/05-module-splitting.md
 */

import { state } from '../shared-state';

import { taskNextState, saveTaskNextSettings, type TaskNextDeps } from './task-next-ui';
import type { ExtensionResponse, ResolvedPromptsConfig } from '../types';
import { updateLogConfig, type LogManagerConfig } from '../log-manager';
import { saveSettingsOverrides, getSettingsOverrides } from '../settings-store';
import type { XPathPanelResult, TimingPanelResult, TaskNextPanelResult, LoggingPanelResult, ConfigDbPanelResult, GeneralPanelResult } from './settings-tab-panels';

import {
  CONFIG,
  TIMING,
  cInputBg,
  cInputBorder,
  cInputFg,
  cNeutral600,
  cPanelBg,
  cPanelBorder,
  cPanelFg,
  cPanelText,
  cPrimary,
  cPrimaryLight,
  cSectionHeader,
  cSuccess,
  cWarning,
} from '../shared-state';

import {
  buildXPathsPanel,
  buildTimingPanel,
  buildTaskNextPanel,
  buildLoggingPanel,
  buildConfigDbPanel,
  buildGeneralPanel,
} from './settings-tab-panels';
import { CssFragment } from '../types';
// ============================================
// Dependencies injected from createUI closure
// ============================================
export interface SettingsDeps {
  btnStyle: string;
  taskNextDeps: TaskNextDeps;
  getPromptsConfig: () => ResolvedPromptsConfig;
  showToast: (msg: string, level?: string) => void;
  log: (msg: string, level?: string) => void;
  sendToExtension: (type: string, payload: Record<string, unknown>) => Promise<ExtensionResponse>;
}

// ============================================
// Helper: create labeled input field
// ============================================
export interface FieldOptions {
  type?: string;
  hint?: string;
  multiline?: boolean;
}

export type MakeFieldFn = (label: string, value: string, opts?: FieldOptions) => { row: HTMLElement; input: HTMLInputElement };

function makeField(label: string, value: string, opts?: FieldOptions) {
  const o = opts || {};
  const row = document.createElement('div');
  row.style.cssText = 'margin-bottom:10px;';
  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:10px;color:' + cSectionHeader + ';margin-bottom:3px;font-weight:600;';
  lbl.textContent = label;
  row.appendChild(lbl);
  const inp = document.createElement(o.multiline ? 'textarea' : 'input') as HTMLInputElement;
  inp.type = o.type || 'text';
  inp.value = value || '';
  inp.style.cssText = 'width:100%;padding:6px 8px;border:1px solid ' + cInputBorder + ';border-radius:5px;background:' + cInputBg + ';color:' + cInputFg + ';font-family:monospace;font-size:11px;box-sizing:border-box;' + (o.multiline ? 'min-height:60px;resize:vertical;' : '');
  row.appendChild(inp);
  if (o.hint) {
    const h = document.createElement('div');
    h.style.cssText = 'font-size:9px;color:#64748b;margin-top:2px;';
    h.textContent = o.hint;
    row.appendChild(h);
  }
  return { row, input: inp };
}

// CQ16: Extracted from showSettingsDialog closure
function switchSettingsTab(tabBtns: HTMLElement[], panels: HTMLElement[], idx: number): void {
  tabBtns.forEach(function(b, i) {
    b.style.borderBottom = i === idx ? '2px solid ' + cPrimary : '2px solid transparent';
    b.style.color = i === idx ? cPrimaryLight : '#64748b';
  });
  panels.forEach(function(p, i) { p.style.display = i === idx ? '' : 'none'; });
}

// CQ16: Extracted from showSettingsDialog closure
function onSettingsEsc(overlay: HTMLElement): (e: KeyboardEvent) => void {
  const handler = function(e: KeyboardEvent) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); }
  };
  return handler;
}

// ============================================
// Show Settings Dialog
// ============================================
export function showSettingsDialog(deps: SettingsDeps) {
  const existing = document.getElementById('macroloop-settings-dialog');
  if (existing) { existing.remove(); return; }

  const { btnStyle, getPromptsConfig } = deps;
  const tFontSystem = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

  const overlay = document.createElement('div');
  overlay.id = 'macroloop-settings-dialog';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:2147483647;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  const dialog = _buildSettingsDialogShell(tFontSystem);
  const { tabBtns, panels, tabPanels, generalResult } = _buildSettingsTabs(deps, getPromptsConfig);

  dialog.appendChild(_buildSettingsHeader(tFontSystem, overlay));
  dialog.appendChild(tabPanels.tabBar);
  dialog.appendChild(tabPanels.panelsContainer);

  const footer = _buildSettingsFooter(btnStyle, deps, panels, overlay, generalResult);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  switchSettingsTab(tabBtns, panels, 0);
  document.addEventListener('keydown', onSettingsEsc(overlay));
}

function _buildSettingsDialogShell(tFontSystem: string): HTMLElement {
  const dialog = document.createElement('div');
  dialog.style.cssText = CssFragment.Background + cPanelBg + ';border:1px solid ' + cPanelBorder + ';border-radius:12px;padding:0;max-width:560px;width:92%;max-height:80vh;display:flex;flex-direction:column;color:' + cPanelText + ';font-family:' + tFontSystem + ';box-shadow:0 25px 60px rgba(0,0,0,0.5);';
  dialog.className = 'marco-enter';
  dialog.onclick = function(e) { e.stopPropagation(); };
  return dialog;
}

function _buildSettingsHeader(_fontSystem: string, overlay: HTMLElement): HTMLElement {
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid ' + cPanelBorder + ';flex-shrink:0;font-family:' + _fontSystem + ';';
  const hdrTitle = document.createElement('div');
  hdrTitle.style.cssText = 'font-size:16px;font-weight:700;color:' + cPrimaryLight + ';';
  hdrTitle.textContent = '⚙️ MacroLoop Settings';
  const hdrClose = document.createElement('span');
  hdrClose.style.cssText = 'font-size:18px;color:#64748b;cursor:pointer;padding:4px 8px;border-radius:6px;transition:all 0.15s;';
  hdrClose.textContent = '✕';
  hdrClose.onmouseenter = function() { hdrClose.style.color = '#e2e8f0'; hdrClose.style.background = 'rgba(255,255,255,0.1)'; };
  hdrClose.onmouseleave = function() { hdrClose.style.color = '#64748b'; hdrClose.style.background = 'none'; };
  hdrClose.onclick = function() { overlay.remove(); };
  hdr.appendChild(hdrTitle);
  hdr.appendChild(hdrClose);
  return hdr;
}

function _buildSettingsTabs(deps: SettingsDeps, getPromptsConfig: () => ResolvedPromptsConfig): { tabBtns: HTMLElement[]; panels: HTMLElement[]; tabPanels: { tabBar: HTMLElement; panelsContainer: HTMLElement }; generalResult: GeneralPanelResult } {
  const tabs = ['XPaths', 'Timing', 'Task Next', 'Logging', 'Config (DB)', 'General'];
  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex;gap:0;border-bottom:1px solid ' + cPanelBorder + ';padding:0 20px;flex-shrink:0;';
  const tabPanels = document.createElement('div');
  tabPanels.style.cssText = 'flex:1;overflow-y:auto;padding:16px 20px;';
  const tabBtns: HTMLElement[] = [];
  const panels: HTMLElement[] = [];

  tabs.forEach(function(name, i) {
    const btn = document.createElement('div');
    btn.style.cssText = 'padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:color 0.15s;border-bottom:2px solid transparent;color:#64748b;';
    btn.textContent = name;
    btn.onclick = function() { switchSettingsTab(tabBtns, panels, i); };
    tabBar.appendChild(btn);
    tabBtns.push(btn);
  });

  const generalResult = buildGeneralPanel(makeField, getPromptsConfig);
  panels.push(buildXPathsPanel(makeField).panel);
  panels.push(buildTimingPanel(makeField).panel);
  panels.push(buildTaskNextPanel(makeField).panel);
  panels.push(buildLoggingPanel(deps).panel);
  panels.push(buildConfigDbPanel(deps, makeField).panel);
  panels.push(generalResult.panel);
  panels.forEach(function(p) { tabPanels.appendChild(p); });

  return { tabBtns, panels, tabPanels: { tabBar, panelsContainer: tabPanels }, generalResult };
}

function _buildSettingsFooter(btnStyle: string, deps: SettingsDeps, _panels: HTMLElement[], overlay: HTMLElement, generalResult: GeneralPanelResult): HTMLElement {
  const { showToast, log } = deps;
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid ' + cPanelBorder + ';flex-shrink:0;';

  const cancelBtn2 = document.createElement('button');
  cancelBtn2.textContent = 'Cancel';
  cancelBtn2.style.cssText = btnStyle + CssFragment.Background + cNeutral600 + ';color:' + cPanelFg + ';padding:6px 16px;font-size:12px;';
  cancelBtn2.onclick = function() { overlay.remove(); };

  const resetBtn = document.createElement('button');
  resetBtn.textContent = '↺ Reset';
  resetBtn.title = 'Reset fields to current running values';
  resetBtn.style.cssText = btnStyle + CssFragment.Background + cWarning + ';color:#1e1e2e;padding:6px 16px;font-size:12px;';
  resetBtn.onclick = function() {
    showToast('Fields reset to current values', 'info');
  };

  const saveBtn2 = document.createElement('button');
  saveBtn2.textContent = '💾 Save';
  saveBtn2.style.cssText = btnStyle + CssFragment.Background + cSuccess + ';color:#1e1e2e;padding:6px 20px;font-size:12px;font-weight:600;';
  saveBtn2.onclick = function() {
    _persistOverrideToggles(generalResult).then(function() {
      log('Settings saved', 'info');
      showToast('✅ Settings saved', 'info');
      overlay.remove();
    }).catch(function(err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('❌ Save failed: ' + msg, 'error');
    });
  };

  footer.appendChild(cancelBtn2);
  footer.appendChild(resetBtn);
  footer.appendChild(saveBtn2);
  return footer;
}

async function _persistOverrideToggles(generalResult: GeneralPanelResult): Promise<void> {
  if (!generalResult.toggles) return;
  const current = getSettingsOverrides();
  const next = {
    ...current,
    enableCanceledCreditOverride: generalResult.toggles.enableCanceledCreditOverride?.checked ?? true,
    enableWorkspaceStatusLabels: generalResult.toggles.enableWorkspaceStatusLabels?.checked ?? true,
    enableWorkspaceHoverDetails: generalResult.toggles.enableWorkspaceHoverDetails?.checked ?? true,
  };
  await saveSettingsOverrides(next);
}

function _applyXPathSettings(xpResult: XPathPanelResult): void {
  for (const k in xpResult.inputs) {
    CONFIG[k] = xpResult.inputs[k].value;
  }
  const pInp = document.getElementById('xpath-project-btn') as HTMLInputElement;
  if (pInp) pInp.value = CONFIG.PROJECT_BUTTON_XPATH;
  const prInp = document.getElementById('xpath-progress-bar') as HTMLInputElement;
  if (prInp) prInp.value = CONFIG.PROGRESS_XPATH;
  const wInp = document.getElementById('xpath-workspace-name') as HTMLInputElement;
  if (wInp) wInp.value = CONFIG.WORKSPACE_XPATH;
}

function _applyTimingSettings(tmResult: TimingPanelResult): void {
  for (const k in tmResult.inputs) {
    const val = parseInt(tmResult.inputs[k].value, 10);
    if (!isNaN(val) && val >= 0) TIMING[k] = val;
  }
}

function _applyTaskNextSettings(tnResult: TaskNextPanelResult, taskNextDeps: TaskNextDeps): void {
  for (const k in tnResult.inputs) {
    const isNum = k !== 'buttonXPath' && k !== 'promptSlug';
    if (isNum) {
      const v = parseInt(tnResult.inputs[k].value, 10);
      if (!isNaN(v)) taskNextState.settings[k] = v;
    } else {
      taskNextState.settings[k] = tnResult.inputs[k].value;
    }
  }
  saveTaskNextSettings(taskNextDeps);
}

function _applyLoggingSettings(logResult: LoggingPanelResult): void {
  const logUpdate: Partial<LogManagerConfig> = {
    enabled: logResult.logToggles.enabled.checked,
    consoleOutput: logResult.logToggles.consoleOutput.checked,
    persistLogs: logResult.logToggles.persistLogs.checked,
    activityLogUi: logResult.logToggles.activityLogUi.checked,
    levels: {},
  };
  logResult.levelKeys.forEach(function(k: string) { logUpdate.levels![k] = logResult.levelToggles[k].checked; });
  updateLogConfig(logUpdate);
}

function _saveConfigEdits(configResult: ConfigDbPanelResult, deps: SettingsDeps): void {
  for (const ci of configResult.configInputs) {
    deps.sendToExtension('PROJECT_CONFIG_UPDATE', {
      project: 'macro-controller',
      section: ci.section,
      key: ci.key,
      value: ci.input.value,
      valueType: ci.valueType,
    });
  }
}

function _saveGeneralSettings(genResult: GeneralPanelResult, deps: SettingsDeps): void {
  // Save custom display name to state + localStorage
  const customName = (genResult.inputs.customDisplayName?.value || '').trim();
  state.customDisplayName = customName;
  try {
    if (customName) {
      localStorage.setItem('marco_custom_display_name', customName);
    } else {
      localStorage.removeItem('marco_custom_display_name');
    }
  } catch { /* localStorage unavailable */ } // allow-swallow: localStorage throws in private browsing or when disabled; custom display name is non-critical.

  const newChatXPath = genResult.inputs.pasteTargetXPath.value;
  if (newChatXPath) {
    deps.sendToExtension('KV_SET', { key: 'chatbox_xpath_override', value: newChatXPath, projectId: '_global' });
  }
}

// Suppress unused warnings — these are wired up at runtime
void _applyXPathSettings;
void _applyTimingSettings;
void _applyTaskNextSettings;
void _applyLoggingSettings;
void _saveConfigEdits;
void _saveGeneralSettings;
