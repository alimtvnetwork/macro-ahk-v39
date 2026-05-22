/**
 * MacroLoop Controller — Settings Tab Panel Builders
 *
 * Individual panel builders for each settings tab: XPaths, Timing,
 * Task Next, Logging, Config (DB), and General.
 *
 * @see spec/04-macro-controller/ts-migration-v2/05-module-splitting.md
 */

import { taskNextState } from './task-next-ui';
import { getBackdropOpacity, setBackdropOpacity } from './panel-layout';
import { getSettingsOverrides, saveSettingsOverrides, type PerWorkspaceLifecycleOverride } from '../settings-store';
import { showToast } from '../toast';
import { logError } from '../error-utils';
import type { ExtensionResponse, ResolvedPromptsConfig } from '../types';
import { getLogConfig, resetLogConfig, type LogManagerConfig } from '../log-manager';
import {
  CONFIG,
  TIMING,
  VERSION,
  cPanelBgAlt,
  cPanelBorder,
  cPanelText,
  cPrimary,
  cPrimaryLight,
  cSectionHeader,
  cWarning,
  cInputBg,
  cInputBorder,
  cInputFg,
  state,
} from '../shared-state';
import type { SettingsDeps, MakeFieldFn } from './settings-ui';
import { CssFragment } from '../types';
// ── Panel Results ──

export interface XPathPanelResult {
  panel: HTMLElement;
  inputs: Record<string, HTMLInputElement>;
}

export interface TimingPanelResult {
  panel: HTMLElement;
  inputs: Record<string, HTMLInputElement>;
}

export interface TaskNextPanelResult {
  panel: HTMLElement;
  inputs: Record<string, HTMLInputElement>;
}

export interface LoggingPanelResult {
  panel: HTMLElement;
  logToggles: Record<string, HTMLInputElement>;
  levelToggles: Record<string, HTMLInputElement>;
  masterFields: Array<{ key: string; label: string; value: boolean }>;
  levelKeys: string[];
}

export interface ConfigDbPanelResult {
  panel: HTMLElement;
  configInputs: Array<{ section: string; key: string; input: HTMLInputElement; valueType: string }>;
}

export interface GeneralPanelResult {
  panel: HTMLElement;
  inputs: Record<string, HTMLInputElement>;
  toggles: Record<string, HTMLInputElement>;
}

// ── XPaths Panel ──

export function buildXPathsPanel(makeField: MakeFieldFn): XPathPanelResult {
  const panel = document.createElement('div');
  const fields = [
    { key: 'PROJECT_BUTTON_XPATH', label: 'Project Button XPath' },
    { key: 'MAIN_PROGRESS_XPATH', label: 'Main Progress XPath' },
    { key: 'PROGRESS_XPATH', label: 'Progress Bar XPath' },
    { key: 'WORKSPACE_XPATH', label: 'Workspace Name XPath' },
    { key: 'WORKSPACE_NAV_XPATH', label: 'Workspace Nav XPath' },
    { key: 'CONTROLS_XPATH', label: 'Controls XPath' },
    { key: 'PROMPT_ACTIVE_XPATH', label: 'Prompt Active XPath' },
    { key: 'PROJECT_NAME_XPATH', label: 'Project Name XPath' },
    { key: 'REQUIRED_DOMAIN', label: 'Required Domain' },
    { key: 'SETTINGS_PATH', label: 'Settings Path' },
    { key: 'DEFAULT_VIEW', label: 'Default View' }
  ];
  const inputs: Record<string, HTMLInputElement> = {};
  fields.forEach(function(f) {
    const field = makeField(f.label, String(CONFIG[f.key] || ''));
    inputs[f.key] = field.input;
    panel.appendChild(field.row);
  });
  return { panel, inputs };
}

// ── Timing Panel ──

export function buildTimingPanel(makeField: MakeFieldFn): TimingPanelResult {
  const panel = document.createElement('div');
  const fields = [
    { key: 'LOOP_INTERVAL', label: 'Loop Interval (ms)', hint: 'Time between each cycle' },
    { key: 'COUNTDOWN_INTERVAL', label: 'Countdown Interval (ms)' },
    { key: 'FIRST_CYCLE_DELAY', label: 'First Cycle Delay (ms)' },
    { key: 'POST_COMBO_DELAY', label: 'Post Combo Delay (ms)' },
    { key: 'PAGE_LOAD_DELAY', label: 'Page Load Delay (ms)' },
    { key: 'DIALOG_WAIT', label: 'Dialog Wait (ms)' },
    { key: 'WS_CHECK_INTERVAL', label: 'Workspace Check Interval (ms)', hint: 'How often credit status refreshes' },
    { key: 'REDOCK_POLL_INTERVAL', label: 'Re-Dock Poll Interval (ms)', hint: 'How often to check for XPath target when floating' },
    { key: 'REDOCK_MAX_ATTEMPTS', label: 'Re-Dock Max Attempts', hint: 'Max polls before staying in floating mode' },
  ];
  const inputs: Record<string, HTMLInputElement> = {};
  fields.forEach(function(f) {
    const field = makeField(f.label, String(TIMING[f.key] || 0), { type: 'number', hint: f.hint });
    inputs[f.key] = field.input;
    panel.appendChild(field.row);
  });
  return { panel, inputs };
}

// ── Task Next Panel ──

export function buildTaskNextPanel(makeField: MakeFieldFn): TaskNextPanelResult {
  const panel = document.createElement('div');
  const fields = [
    { key: 'preClickDelayMs', label: 'Pre-Click Delay (ms)', hint: 'Wait before clicking Add To Tasks' },
    { key: 'postClickDelayMs', label: 'Post-Click Delay (ms)', hint: 'Wait between each task iteration' },
    { key: 'retryCount', label: 'Retry Count', hint: 'Number of retries if button not found' },
    { key: 'retryDelayMs', label: 'Retry Delay (ms)' },
    { key: 'buttonXPath', label: 'Add To Tasks Button XPath' },
    { key: 'promptSlug', label: 'Prompt Slug', hint: 'Slug of the "next tasks" prompt' }
  ];
  const inputs: Record<string, HTMLInputElement> = {};
  fields.forEach(function(f) {
    const isNum = f.key !== 'buttonXPath' && f.key !== 'promptSlug';
    const field = makeField(f.label, String(taskNextState.settings[f.key] || ''), { type: isNum ? 'number' : 'text', hint: f.hint });
    inputs[f.key] = field.input;
    panel.appendChild(field.row);
  });
  return { panel, inputs };
}

// ── Logging Panel ──

 
export function buildLoggingPanel(deps: SettingsDeps): LoggingPanelResult {
  const { btnStyle, showToast } = deps;
  const panel = document.createElement('div');
  const logCfg = getLogConfig();

  const makeToggle = function(label: string, checked: boolean): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid ' + cPanelBorder + ';';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11px;color:' + cPanelText + ';';
    lbl.textContent = label;
    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.checked = checked;
    sw.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:' + cPrimary + ';';
    row.appendChild(lbl);
    row.appendChild(sw);
    return row;
  };

  const masterTitle = document.createElement('div');
  masterTitle.style.cssText = CssFragment.FontSize11pxFontWeight700Color + cSectionHeader + ';margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;';
  masterTitle.textContent = 'Master Controls';
  panel.appendChild(masterTitle);

  const logToggles: Record<string, HTMLInputElement> = {};
  const masterFields = [
    { key: 'enabled', label: 'Logging Enabled', value: logCfg.enabled },
    { key: 'consoleOutput', label: 'Console Output', value: logCfg.consoleOutput },
    { key: 'persistLogs', label: 'Persist to Storage', value: logCfg.persistLogs },
    { key: 'activityLogUi', label: 'Activity Log Panel', value: logCfg.activityLogUi },
  ];
  masterFields.forEach(function(f) {
    const row = makeToggle(f.label, f.value);
    const inp = row.querySelector('input') as HTMLInputElement;
    logToggles[f.key] = inp;
    panel.appendChild(row);
  });

  const levelTitle = document.createElement('div');
  levelTitle.style.cssText = CssFragment.FontSize11pxFontWeight700Color + cSectionHeader + ';margin-top:14px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;';
  levelTitle.textContent = 'Log Levels';
  panel.appendChild(levelTitle);

  const levelKeys = ['debug', 'info', 'warn', 'error', 'success', 'delegate', 'check', 'skip', 'sub'];
  const levelToggles: Record<string, HTMLInputElement> = {};
  levelKeys.forEach(function(key) {
    const row = makeToggle(key.charAt(0).toUpperCase() + key.slice(1), logCfg.levels[key] !== false);
    const inp = row.querySelector('input') as HTMLInputElement;
    levelToggles[key] = inp;
    panel.appendChild(row);
  });

  const resetLogBtn = document.createElement('button');
  resetLogBtn.textContent = '↺ Reset Logging Defaults';
  // eslint-disable-next-line sonarjs/no-duplicate-string
  resetLogBtn.style.cssText = btnStyle + 'background:' + cWarning + ';color:#1e1e2e;padding:5px 12px;font-size:11px;margin-top:12px;';
  resetLogBtn.onclick = function() {
    resetLogConfig();
    const fresh = getLogConfig();
    masterFields.forEach(function(f) { logToggles[f.key].checked = Boolean(fresh[f.key as keyof LogManagerConfig]); });
    levelKeys.forEach(function(k) { levelToggles[k].checked = fresh.levels[k] !== false; });
    showToast('Logging reset to defaults', 'info');
  };
  panel.appendChild(resetLogBtn);

  return { panel, logToggles, levelToggles, masterFields, levelKeys };
}

// ── Config (DB) Panel ──

export function buildConfigDbPanel(
  deps: SettingsDeps,
  makeField: MakeFieldFn,
): ConfigDbPanelResult {
  const { sendToExtension } = deps;
  const panel = document.createElement('div');
  const configInputs: Array<{ section: string; key: string; input: HTMLInputElement; valueType: string }> = [];

  const loading = document.createElement('div');
  loading.style.cssText = 'color:#64748b;font-size:11px;padding:12px 0;';
  loading.textContent = '⏳ Loading config from database...';
  panel.appendChild(loading);

  sendToExtension('PROJECT_CONFIG_READ', { project: 'macro-controller' }).then(function(resp: ExtensionResponse) {
    loading.remove();
    const rows = resp.rows as Array<{ section: string; key: string; value: string; valueType: string }> | undefined;
    if (!resp || !resp.isOk || !rows || rows.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#64748b;font-size:11px;padding:12px 0;';
      empty.textContent = 'No config found in database. Config will be seeded on next injection.';
      panel.appendChild(empty);
      return;
    }

    const sections: Record<string, Array<{ key: string; value: string; valueType: string }>> = {};
    for (const row of rows) {
      if (!sections[row.section]) sections[row.section] = [];
      sections[row.section].push({ key: row.key, value: row.value, valueType: row.valueType });
    }

    for (const [sectionName, entries] of Object.entries(sections)) {
      renderConfigSection(panel, sectionName, entries, makeField, configInputs);
    }

    const configInfo = document.createElement('div');
    configInfo.style.cssText = 'margin-top:12px;padding:8px;background:' + cPanelBgAlt + ';border-radius:6px;font-size:9px;color:#64748b;';
    configInfo.textContent = rows.length + ' config entries loaded from project SQLite DB. Changes saved here persist across sessions.';
    panel.appendChild(configInfo);
  });

  return { panel, configInputs };
}

function renderConfigSection(
  panel: HTMLElement,
  sectionName: string,
  entries: Array<{ key: string; value: string; valueType: string }>,
  makeField: MakeFieldFn,
  configInputs: ConfigDbPanelResult['configInputs'],
): void {
  const sectionTitle = document.createElement('div');
  sectionTitle.style.cssText = CssFragment.FontSize11pxFontWeight700Color + cSectionHeader + ';margin-top:12px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;';
  sectionTitle.textContent = sectionName;
  panel.appendChild(sectionTitle);

  for (const entry of entries) {
    const isMultiline = entry.valueType === 'object' || entry.valueType === 'array' || entry.value.length > 80;
    const fieldOpts: { type?: string; hint?: string; multiline?: boolean } = {};
    if (isMultiline) fieldOpts.multiline = true;
    if (entry.valueType === 'number') fieldOpts.type = 'number';
    if (entry.valueType === 'boolean') fieldOpts.type = 'text';
    fieldOpts.hint = entry.valueType;

    const field = makeField(entry.key, entry.value, fieldOpts);
    panel.appendChild(field.row);
    configInputs.push({ section: sectionName, key: entry.key, input: field.input, valueType: entry.valueType });
  }
}

// ── General Panel ──

export function buildGeneralPanel(
  makeField: MakeFieldFn,
  getPromptsConfig: () => ResolvedPromptsConfig,
): GeneralPanelResult {
  const panel = document.createElement('div');
  const promptsCfg = getPromptsConfig();

  // Custom display name field
  const displayNameField = makeField('Custom Display Name', state.customDisplayName || '', {
    hint: 'Override the project name shown in the title bar. Leave empty to auto-detect.',
  });

  const fields = [
    { key: 'pasteTargetXPath', label: 'Chatbox / Paste Target XPath', value: promptsCfg.pasteTargetXPath || '' },
    { key: 'pasteTargetSelector', label: 'Chatbox CSS Selector (fallback)', value: promptsCfg.pasteTargetSelector || '' }
  ];
  const inputs: Record<string, HTMLInputElement> = {};

  // Add custom display name as first input
  inputs['customDisplayName'] = displayNameField.input;
  panel.appendChild(displayNameField.row);

  fields.forEach(function(f) {
    const field = makeField(f.label, f.value);
    inputs[f.key] = field.input;
    panel.appendChild(field.row);
  });

  const toggles = _buildOverrideToggles(panel);

  panel.appendChild(_buildPerWorkspaceEditor());
  panel.appendChild(_buildBackdropSlider());
  panel.appendChild(_buildVersionInfo());

  return { panel, inputs, toggles };
}

/* ------------------------------------------------------------------ */
/*  Per-workspace lifecycle overrides editor                           */
/* ------------------------------------------------------------------ */

function _buildPerWorkspaceEditor(): HTMLElement {
  const section = document.createElement('div');
  section.style.cssText = 'margin-top:14px;';

  const title = document.createElement('div');
  title.style.cssText = CssFragment.FontSize11pxFontWeight700Color + cSectionHeader
    + ';margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;';
  title.textContent = 'Per-Workspace Lifecycle Overrides';
  section.appendChild(title);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:9px;color:#64748b;margin-bottom:6px;';
  hint.textContent = 'Tune expiry grace + refill warning for individual workspaces. Leave a field empty to fall back to the global value.';
  section.appendChild(hint);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  section.appendChild(list);

  const addRow = _buildPerWsAddRow(function () { _renderPerWsList(list); });
  section.appendChild(addRow);

  _renderPerWsList(list);
  return section;
}

function _renderPerWsList(list: HTMLElement): void {
  list.innerHTML = '';
  const overrides = getSettingsOverrides();
  const map = overrides.perWorkspace || {};
  const ids = Object.keys(map).sort();
  if (ids.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:10px;color:#64748b;padding:6px 0;font-style:italic;';
    empty.textContent = 'No per-workspace overrides set.';
    list.appendChild(empty);
    return;
  }
  for (const wsId of ids) {
    list.appendChild(_buildPerWsRow(wsId, map[wsId], function () { _renderPerWsList(list); }));
  }
}

function _buildPerWsRow(
  wsId: string,
  entry: PerWorkspaceLifecycleOverride,
  onChange: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 70px 70px auto;gap:6px;align-items:center;'
    + 'padding:5px 6px;border:1px solid ' + cPanelBorder + ';border-radius:5px;background:' + cPanelBgAlt + ';';

  const idLabel = document.createElement('div');
  idLabel.style.cssText = 'font-family:monospace;font-size:10px;color:' + cPanelText + ';'
    + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  idLabel.title = wsId;
  idLabel.textContent = wsId;
  row.appendChild(idLabel);

  const graceInp = _numField(entry.expiryGracePeriodDays, 'grace');
  const refillInp = _numField(entry.refillWarningThresholdDays, 'refill');
  row.appendChild(graceInp);
  row.appendChild(refillInp);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Remove override';
  removeBtn.style.cssText = 'background:transparent;border:1px solid ' + cPanelBorder
    + ';color:' + cWarning + ';font-size:11px;padding:2px 7px;border-radius:4px;cursor:pointer;';
  removeBtn.onclick = function (): void {
    void _persistPerWs(function (map) { delete map[wsId]; })
      .then(function () { showToast('Removed override for ' + wsId, 'info'); onChange(); });
  };
  row.appendChild(removeBtn);

  const commit = function (): void {
    const grace = graceInp.value.trim() === '' ? undefined : Number(graceInp.value);
    const refill = refillInp.value.trim() === '' ? undefined : Number(refillInp.value);
    void _persistPerWs(function (map) {
      const next: PerWorkspaceLifecycleOverride = {};
      if (typeof grace === 'number' && Number.isFinite(grace) && grace >= 0) {
        next.expiryGracePeriodDays = Math.floor(grace);
      }
      if (typeof refill === 'number' && Number.isFinite(refill) && refill >= 0) {
        next.refillWarningThresholdDays = Math.floor(refill);
      }
      if (next.expiryGracePeriodDays === undefined && next.refillWarningThresholdDays === undefined) {
        delete map[wsId];
      } else {
        map[wsId] = next;
      }
    });
  };
  graceInp.onchange = commit;
  refillInp.onchange = commit;

  return row;
}

function _buildPerWsAddRow(onAdded: () => void): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 70px 70px auto;gap:6px;align-items:center;margin-top:8px;';

  const idInp = document.createElement('input');
  idInp.type = 'text';
  idInp.placeholder = 'Workspace ID (UUID)';
  idInp.style.cssText = 'padding:4px 6px;border:1px solid ' + cInputBorder + ';border-radius:4px;'
    + 'background:' + cInputBg + ';color:' + cInputFg + ';font-family:monospace;font-size:10px;';
  row.appendChild(idInp);

  const graceInp = _numField(undefined, 'grace');
  graceInp.placeholder = 'grace';
  const refillInp = _numField(undefined, 'refill');
  refillInp.placeholder = 'refill';
  row.appendChild(graceInp);
  row.appendChild(refillInp);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+ Add';
  addBtn.style.cssText = 'background:' + cPrimary + ';border:none;color:#fff;font-size:11px;'
    + 'padding:3px 10px;border-radius:4px;cursor:pointer;font-weight:600;';
  addBtn.onclick = function (): void {
    const wsId = idInp.value.trim();
    if (!wsId) { showToast('Enter a workspace id first', 'warn'); return; }
    const grace = graceInp.value.trim() === '' ? undefined : Number(graceInp.value);
    const refill = refillInp.value.trim() === '' ? undefined : Number(refillInp.value);
    if (grace === undefined && refill === undefined) {
      showToast('Set at least one of grace / refill', 'warn');
      return;
    }
    void _persistPerWs(function (map) {
      const next: PerWorkspaceLifecycleOverride = {};
      if (typeof grace === 'number' && Number.isFinite(grace) && grace >= 0) {
        next.expiryGracePeriodDays = Math.floor(grace);
      }
      if (typeof refill === 'number' && Number.isFinite(refill) && refill >= 0) {
        next.refillWarningThresholdDays = Math.floor(refill);
      }
      map[wsId] = next;
    }).then(function () {
      showToast('Added override for ' + wsId, 'success');
      idInp.value = '';
      graceInp.value = '';
      refillInp.value = '';
      onAdded();
    });
  };
  row.appendChild(addBtn);
  return row;
}

function _numField(initial: number | undefined, kind: 'grace' | 'refill'): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.min = '0';
  inp.step = '1';
  inp.value = typeof initial === 'number' ? String(initial) : '';
  inp.title = kind === 'grace' ? 'Expiry grace period (days)' : 'Refill warning threshold (days)';
  inp.style.cssText = 'padding:4px 6px;border:1px solid ' + cInputBorder + ';border-radius:4px;'
    + 'background:' + cInputBg + ';color:' + cInputFg + ';font-family:monospace;font-size:10px;width:100%;box-sizing:border-box;';
  return inp;
}

async function _persistPerWs(
  mutate: (map: Record<string, PerWorkspaceLifecycleOverride>) => void,
): Promise<void> {
  try {
    const current = getSettingsOverrides();
    const map: Record<string, PerWorkspaceLifecycleOverride> = { ...(current.perWorkspace || {}) };
    mutate(map);
    await saveSettingsOverrides({ ...current, perWorkspace: map });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError('PerWsOverridesEditor', 'persist failed: ' + msg);
    showToast('❌ Save failed: ' + msg, 'error');
  }
}

function _buildOverrideToggles(panel: HTMLElement): Record<string, HTMLInputElement> {
  const overrides = getSettingsOverrides();
  const title = document.createElement('div');
  title.style.cssText = CssFragment.FontSize11pxFontWeight700Color + cSectionHeader + ';margin-top:14px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;';
  title.textContent = 'Workspace Display Overrides';
  panel.appendChild(title);

  const items = [
    { key: 'enableCanceledCreditOverride', label: 'Canceled/Expired Credit Override', value: overrides.enableCanceledCreditOverride !== false, hint: 'Force canceled or expired plans to show zero credits.' },
    { key: 'enableWorkspaceStatusLabels', label: 'Inline Status Labels', value: overrides.enableWorkspaceStatusLabels !== false, hint: 'Show status text under each workspace row.' },
    { key: 'enableWorkspaceHoverDetails', label: 'Hover-Card Details', value: overrides.enableWorkspaceHoverDetails !== false, hint: 'Show rich credit details on row hover.' },
  ];
  const toggles: Record<string, HTMLInputElement> = {};

  items.forEach(function(item) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid ' + cPanelBorder + ';';
    const labelWrap = document.createElement('div');
    labelWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1;padding-right:8px;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11px;color:' + cPanelText + ';';
    lbl.textContent = item.label;
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:9px;color:#64748b;';
    hint.textContent = item.hint;
    labelWrap.appendChild(lbl);
    labelWrap.appendChild(hint);
    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.checked = item.value;
    sw.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:' + cPrimary + ';';
    row.appendChild(labelWrap);
    row.appendChild(sw);
    panel.appendChild(row);
    toggles[item.key] = sw;
  });
  return toggles;
}

/** Builds the backdrop opacity slider row. */
function _buildBackdropSlider(): HTMLDivElement {
  const currentBackdropOpacity = getBackdropOpacity();
  const bdRow = document.createElement('div');
  bdRow.style.cssText = 'margin-top:14px;margin-bottom:10px;';
  const bdLabel = document.createElement('div');
  bdLabel.style.cssText = 'font-size:10px;color:' + cSectionHeader + ';margin-bottom:3px;font-weight:600;';
  bdLabel.textContent = 'Backdrop Opacity';
  bdRow.appendChild(bdLabel);

  const bdSliderRow = document.createElement('div');
  bdSliderRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const bdSlider = document.createElement('input');
  bdSlider.type = 'range';
  bdSlider.min = '0';
  bdSlider.max = '100';
  bdSlider.value = String(Math.round(currentBackdropOpacity * 100));
  bdSlider.style.cssText = 'flex:1;height:6px;accent-color:' + cPrimary + ';cursor:pointer;';

  const bdValueLabel = document.createElement('span');
  bdValueLabel.style.cssText = 'font-size:11px;color:' + cPanelText + ';min-width:36px;text-align:right;font-family:monospace;';
  bdValueLabel.textContent = bdSlider.value + '%';

  bdSlider.oninput = function() {
    const pct = parseInt(bdSlider.value, 10);
    bdValueLabel.textContent = pct + '%';
    setBackdropOpacity(pct / 100);
  };

  bdSliderRow.appendChild(bdSlider);
  bdSliderRow.appendChild(bdValueLabel);
  bdRow.appendChild(bdSliderRow);

  const bdHint = document.createElement('div');
  bdHint.style.cssText = 'font-size:9px;color:#64748b;margin-top:2px;';
  bdHint.textContent = 'Dark overlay behind the floating panel. 0% = transparent, 100% = opaque.';
  bdRow.appendChild(bdHint);

  return bdRow;
}

/** Builds the version info footer. */
function _buildVersionInfo(): HTMLDivElement {
  const verInfo = document.createElement('div');
  verInfo.style.cssText = 'margin-top:16px;padding:10px;background:' + cPanelBgAlt + ';border-radius:6px;font-size:10px;color:#64748b;';
  verInfo.innerHTML = '<strong style="color:' + cPrimaryLight + '">MacroLoop</strong> v' + VERSION + '<br>Changes are saved to the running instance. For permanent changes, update the config JSON or extension settings.';
  return verInfo;
}
