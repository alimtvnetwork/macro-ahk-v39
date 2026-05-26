 
/**
 * MacroLoop Controller — Shared State & Configuration
 * Step 2b: Extracted from macro-looping.ts IIFE scope
 *
 * Contains: config parsing, theme resolution, constants, mutable state objects.
 * All variables are exported so other modules can import them.
 */

import {
  type MacroControllerConfig,
  type MacroThemeRoot,
  type ThemePreset,
  type TimingConfig,
  type XPathConfig,
  type ElementIds,
} from './types';
import { validateConfig, validateTheme, drainValidationWarnings } from './config-validator';
import { logDebug } from './error-utils';

// ============================================
// Config: Validated + deep-merged with defaults (Phase 05)
// ============================================
const cfg: MacroControllerConfig = validateConfig(window.__MARCO_CONFIG__);
const loopCfg = cfg.macroLoop || {};
const loopIds = loopCfg.elementIds || {};
const loopTiming = loopCfg.timing || {};
const loopXPaths = loopCfg.xpaths || {};
const loopUrls = loopCfg.urls || {};
export const creditBarWidthPx = loopCfg.creditBarWidthPx || 160;

// ============================================
// Theme: Validated + deep-merged with defaults (Phase 05)
// ============================================
const themeRoot: MacroThemeRoot = validateTheme(window.__MARCO_THEME__);

// Flush validation warnings to activity log (deferred to break the
// shared-state -> logging circular import; logging.ts depends on shared-state).
const _configWarnings = drainValidationWarnings();
if (_configWarnings.length > 0) {
  setTimeout(function () {
    void import('./logging').then(function (mod) {
      for (const w of _configWarnings) {
        try { mod.log('[Config Validation] ' + w, 'warn'); }
        catch { console.warn('[Config Validation] ' + w); }
      }
    }).catch(function () {
      for (const w of _configWarnings) {
        console.warn('[Config Validation] ' + w);
      }
    });
  }, 0);
}
/** Get config validation warnings (for diagnostics). */
export function getConfigValidationWarnings(): string[] { return _configWarnings; }

import { StorageKey } from './types';

export function resolvePreset(key: string): ThemePreset {
  const darkPreset = themeRoot.presets?.dark;
  if (darkPreset) return darkPreset;
  if (themeRoot.presets && themeRoot.presets[key]) return themeRoot.presets[key];
  if (themeRoot.colors) return { colors: themeRoot.colors };
  return {} as ThemePreset;
}

const theme = resolvePreset(StorageKey.ForcedTheme);
const TC = theme.colors || {};
const TP = TC.panel || {};
const TPri = TC.primary || {};
const TAcc = TC.accent || {};
const TSt = TC.status || {};
const TN = TC.neutral || {};
const TCb = TC.creditBar || {};
const TLog = TC.log || {};
const TBtn = TC.button || {};
const TInput = TC.input || {};
const TModal = TC.modal || {};
const TSec = TC.section || {};
const TSep = TC.separator || '#007acc';
const TTrans = theme.transitions || {};
const TLayout = theme.layout || {};
const TTypo = theme.typography || {};

// ============================================
// Exported constants
// ============================================
export { FILE_NAME } from './constants';
export const VERSION = '3.22.0';

// Expose version via RiseupAsiaMacroExt namespace (Issue 78 — no bare window globals)
try {
  const root = (typeof window !== 'undefined' ? window.RiseupAsiaMacroExt : undefined);
  if (root && root.Projects && root.Projects.MacroController) {
    if (!root.Projects.MacroController.meta) root.Projects.MacroController.meta = {};
    root.Projects.MacroController.meta.version = VERSION;
  }
} catch (_e) { logDebug('shared-state', 'SDK namespace not yet registered — version set at injection time'); }

// ============================================
// Panel colors
// ============================================
export const cPanelBg      = TP.background     || '#1e1e2e';
export const cPanelBgAlt   = TP.backgroundAlt  || '#252536';
export const cPanelBorder  = TP.border         || '#313147';
export const cPanelFg      = TP.foreground     || '#e8e8e8';
export const cPanelFgMuted = TP.foregroundMuted || '#f5e6b8';
export const cPanelFgDim   = TP.foregroundDim  || '#9e9e9e';
export const cPanelText    = TP.textBody       || '#d9d9d9';

// Primary colors
export const cPrimary        = TPri.base          || '#007acc';
export const cPrimaryLight   = TPri.light         || '#3daee9';
export const cPrimaryLighter = TPri.lighter       || '#569cd6';
export const cPrimaryLightest= TPri.lightest      || '#9cdcfe';
export const cPrimaryDark    = TPri.dark          || '#005a9e';
export const cPrimaryGlow    = TPri.glow          || 'rgba(0,122,204,0.2)';
export const cPrimaryGlowS   = TPri.glowStrong   || 'rgba(0,122,204,0.35)';
export const cPrimaryGlowSub = TPri.glowSubtle   || 'rgba(0,122,204,0.12)';
export const cPrimaryBorderA = TPri.borderAlpha   || 'rgba(0,122,204,0.45)';
export const cPrimaryBgA     = TPri.bgAlpha       || 'rgba(0,122,204,0.15)';
export const cPrimaryBgAL    = TPri.bgAlphaLight  || 'rgba(61,174,233,0.25)';
export const cPrimaryBgAS    = TPri.bgAlphaSubtle || 'rgba(61,174,233,0.1)';
export const cPrimaryHL      = TPri.highlight     || 'rgba(0,122,204,0.12)';

// Accent colors
export const cAccPurple      = TAcc.purple      || '#c586c0';
export const cAccPurpleLight = TAcc.purpleLight  || '#d7b0d4';
export const cAccPink        = TAcc.pink        || '#d16d9e';

// Status colors
export const cSuccess       = TSt.success       || '#4ec9b0';
export const cSuccessLight  = TSt.successLight  || '#73e0c8';
export const cSuccessMuted  = TSt.successMuted  || '#4ec9b0';
export const cWarning       = TSt.warning       || '#dcdcaa';
export const cWarningLight  = TSt.warningLight  || '#e8e8c0';
export const cWarningPale   = TSt.warningPale   || '#f0f0d0';
export const cError         = TSt.error         || '#f44747';
export const cErrorLight    = TSt.errorLight    || '#f87171';
export const cInfo          = TSt.info          || '#569cd6';
export const cInfoLight     = TSt.infoLight     || '#7bb8e6';

// Neutral colors
export const cNeutral400 = TN['400'] || '#6a6a6a';
export const cNeutral500 = TN['500'] || '#505050';
export const cNeutral600 = TN['600'] || '#3c3c3c';
export const cNeutral700 = TN['700'] || '#333333';
export const cNeutral950 = TN['950'] || '#181825';

// Credit bar gradients
export const cCbBonus    = TCb.bonus    || ['#7c3aed', '#a78bfa'];
export const cCbBilling  = TCb.billing  || ['#22c55e', '#4ade80'];
export const cCbRollover = TCb.rollover || ['#6b7280', '#9ca3af'];
export const cCbDaily    = TCb.daily    || ['#d97706', '#facc15'];
export const cCbAvail    = TCb.available || '#22d3ee';
export const cCbEmpty    = TCb.emptyTrack || 'rgba(239,68,68,0.25)';

// Log level colors
export const cLogDefault   = TLog['default']  || '#e8e8e8';
export const cLogError     = TLog.error       || '#f44747';
export const cLogInfo      = TLog.info        || '#9e9e9e';
export const cLogSuccess   = TLog.success     || '#4ec9b0';
export const cLogDebug     = TLog.debug       || '#c586c0';
export const cLogWarn      = TLog.warn        || '#f5e6b8';
export const cLogDelegate  = TLog.delegate    || '#7bb8e6';
export const cLogCheck     = TLog.check       || '#d7b0d4';
export const cLogSkip      = TLog.skip        || '#9e9e9e';
export const cLogTimestamp  = TLog.timestamp   || '#6a6a6a';

// Extra colors
export const cOrange     = TC.orange     || '#ce9178';
export const cCyan       = TC.cyan       || '#4ec9b0';
export const cCyanLight  = TC.cyanLight  || '#73e0c8';
export const cSkyLight   = TC.skyLight   || '#9cdcfe';
export const cGreenBright= TC.greenBright|| '#6a9955';

// Button colors — flat solid with subtle border/shadow (no gradients)
export const cBtnCheckBg   = (TBtn.check || {}).bg   || '#E8475F';
export const cBtnCheckFg   = (TBtn.check || {}).fg   || '#fff';
export const cBtnCheckGrad = (TBtn.check || {}).gradient || '#E8475F';
export const cBtnCheckGlow = (TBtn.check || {}).glow || '0 1px 3px rgba(232,71,95,0.3), inset 0 1px 0 rgba(255,255,255,0.1)';
export const cBtnCreditBg  = (TBtn.credits || {}).bg || '#F59E0B';
export const cBtnCreditFg  = (TBtn.credits || {}).fg || '#1a1a2e';
export const cBtnCreditGrad = (TBtn.credits || {}).gradient || '#F59E0B';
export const cBtnCreditGlow = (TBtn.credits || {}).glow || '0 1px 3px rgba(245,158,11,0.3), inset 0 1px 0 rgba(255,255,255,0.15)';
export const cBtnPromptBg  = (TBtn.prompts || {}).bg || '#6C5CE7';
export const cBtnPromptFg  = (TBtn.prompts || {}).fg || '#fff';
export const cBtnPromptGrad = (TBtn.prompts || {}).gradient || '#6C5CE7';
export const cBtnPromptGlow = (TBtn.prompts || {}).glow || '0 1px 3px rgba(108,92,231,0.3), inset 0 1px 0 rgba(255,255,255,0.1)';
export const cBtnStartGrad = (TBtn.startStop || {}).gradient || '#00C853';
export const cBtnStartGlow = (TBtn.startStop || {}).glow || '0 1px 3px rgba(0,200,83,0.3), inset 0 1px 0 rgba(255,255,255,0.15)';
export const cBtnStopGrad  = (TBtn.startStop || {}).stopGradient || '#B91C1C';
export const cBtnStopGlow  = (TBtn.startStop || {}).stopGlow || '0 1px 3px rgba(185,28,28,0.3), inset 0 1px 0 rgba(255,255,255,0.1)';
export const cBtnMenuBg    = (TBtn.menu || {}).bg    || '#2A2D3A';
export const cBtnMenuFg    = (TBtn.menu || {}).fg    || '#e8e8e8';
export const cBtnMenuHover = TBtn.menuHover          || '#3A3F55';
export const cBtnUtilBg    = TBtn.utilityBg          || '#2A2D3A';
export const cBtnUtilBorder= TBtn.utilityBorder      || 'rgba(255,255,255,0.08)';

// Input colors
export const cInputBg     = TInput.bg     || cPanelBg;
export const cInputBorder = TInput.border || cPrimary;
export const cInputFg     = TInput.fg     || cPanelFg;

// Modal colors
export const cModalBg     = TModal.bg     || cPanelBg;
export const cModalBorder = TModal.border || cPrimary;

// Section colors
export const cSectionBg      = cPanelBgAlt;
export const cSectionHeader  = TSec.headerColor || '#f5e6b8';
export const cSectionToggle  = TSec.toggleColor || '#e8e8e8';

// Separator
export const cSeparator = (typeof TSep === 'string') ? TSep : cPrimary;

// Layout tokens
export const lPanelRadius  = TLayout.panelBorderRadius  || '10px';
export const lPanelPadding = TLayout.panelPadding       || '12px';
export const lPanelMinW    = TLayout.panelMinWidth       || '420px';
export const lPanelFloatW  = TLayout.panelFloatingWidth  || '480px';
export const lPanelShadow  = TLayout.panelShadow         || '0 4px 16px rgba(0,0,0,0.4),0 0 1px rgba(0,122,204,0.25)';
export const lPanelFloatSh = TLayout.panelFloatShadow    || '0 8px 32px rgba(0,0,0,0.5)';

// ── Default panel dimensions (single source of truth) ──
// Change these two values to adjust the default load size everywhere.
export { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_HEIGHT } from './constants';
export const lDropdownRadius= TLayout.dropdownBorderRadius || '4px';
export const lDropdownShadow= TLayout.dropdownShadow      || '0 8px 24px rgba(0,0,0,0.6)';
export const lModalRadius  = TLayout.modalBorderRadius    || '12px';
export const lModalShadow  = TLayout.modalShadow          || '0 20px 50px rgba(0,0,0,0.6),0 0 30px rgba(0,122,204,0.1)';
export const lAboutGradient= TLayout.aboutGradient         || 'linear-gradient(135deg,#1e1e2e 0%,#181825 100%)';

// Typography tokens
export const tFont       = TTypo.fontFamily       || "'Cascadia Code','Fira Code','Consolas',monospace";
export const tFontSystem = TTypo.fontFamilySystem || '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
export const tFontSize   = TTypo.fontSize         || '12px';
export const tFontSm     = TTypo.fontSizeSmall    || '11px';
export const tFontTiny   = TTypo.fontSizeTiny     || '10px';
export const tFontMicro  = TTypo.fontSizeMicro    || '9px';

// Transition tokens
export const trFast   = TTrans.fast   || '0.15s';
export const trNormal = TTrans.normal || '0.2s';
export const trSlow   = TTrans.slow   || '0.3s';

// ============================================
// IDs from config JSON
// ============================================
export const IDS: ElementIds = {
  SCRIPT_MARKER: loopIds.scriptMarker || 'ahk-loop-script',
  CONTAINER: loopIds.container || 'ahk-loop-container',
  STATUS: loopIds.status || 'ahk-loop-status',
  START_BTN: loopIds.startBtn || 'ahk-loop-start-btn',
  STOP_BTN: loopIds.stopBtn || 'ahk-loop-stop-btn',
  UP_BTN: loopIds.upBtn || 'ahk-loop-up-btn',
  DOWN_BTN: loopIds.downBtn || 'ahk-loop-down-btn',
  RECORD_INDICATOR: loopIds.recordIndicator || 'ahk-loop-record',
  JS_EXECUTOR: loopIds.jsExecutor || 'ahk-loop-js-executor',
  JS_EXECUTE_BTN: loopIds.jsExecuteBtn || 'ahk-loop-js-execute-btn'
};

// ============================================
// Timing from config JSON
// ============================================
export const TIMING: TimingConfig = {
  LOOP_INTERVAL: loopTiming.loopIntervalMs || 100000,
  COUNTDOWN_INTERVAL: loopTiming.countdownIntervalMs || 1000,
  FIRST_CYCLE_DELAY: loopTiming.firstCycleDelayMs || 200,
  POST_COMBO_DELAY: loopTiming.postComboDelayMs || 4000,
  PAGE_LOAD_DELAY: loopTiming.pageLoadDelayMs || 2500,
  DIALOG_WAIT: loopTiming.dialogWaitMs || 3000,
  WS_CHECK_INTERVAL: loopTiming.workspaceCheckIntervalMs || 5000,
  REDOCK_POLL_INTERVAL: loopTiming.redockPollIntervalMs || 800,
  REDOCK_MAX_ATTEMPTS: loopTiming.redockMaxAttempts || 30,
};

// ============================================
// XPaths and URLs from config JSON
// ============================================
export const CONFIG: XPathConfig = {
  PROJECT_BUTTON_XPATH: loopXPaths.projectButton || '/html/body/div[2]/div/div[2]/nav/div/div/div/div[1]/div[1]/button',
  MAIN_PROGRESS_XPATH: loopXPaths.mainProgress || '/html/body/div[6]/div/div[2]/div[2]/div/div[2]/div/div[1]',
  PROGRESS_XPATH: loopXPaths.progress || '/html/body/div[6]/div/div[2]/div[2]/div/div[2]/div/div[2]',
  WORKSPACE_XPATH: loopXPaths.workspace || '/html/body/div[6]/div/div[2]/div[1]/p',
  WORKSPACE_NAV_XPATH: loopXPaths.workspaceNav || '',
  CONTROLS_XPATH: loopXPaths.controls || '/html/body/div[3]/div/div[2]/main/div/div/div[3]',
  PROMPT_ACTIVE_XPATH: loopXPaths.promptActive || '/html/body/div[2]/div/div[2]/main/div/div/div[1]/div/div[2]/div/form/div[2]',
  PROJECT_NAME_XPATH: loopXPaths.projectName || '/html/body/div[2]/div/div[2]/nav/div[2]/div/div/div[1]/div[1]/button/div/div/p',
  REQUIRED_DOMAIN: loopUrls.requiredDomain || 'https://lovable.dev/',
  SETTINGS_PATH: loopUrls.settingsTabPath || '/settings?tab=project',
  DEFAULT_VIEW: loopUrls.defaultView || '?view=codeEditor'
};

// ============================================
// Auto-Attach config
// ============================================
export const autoAttachCfg = cfg.autoAttach || {};
export const autoAttachTiming = autoAttachCfg.timing || {};
export const autoAttachGroups = autoAttachCfg.groups || [];

// Storage constants — centralized in types/ enums and constants.ts
export { StorageKey } from './types';
export const LOG_STORAGE_KEY = StorageKey.LogStorage;
export const WS_HISTORY_KEY = StorageKey.WsHistory;
export const WS_SHARED_KEY = StorageKey.WsShared;
export { LOG_MAX_ENTRIES, WS_HISTORY_MAX_ENTRIES, BLOATED_KEY_PATTERNS } from './constants';

// ============================================
// Runtime state — re-exported from shared-state-runtime.ts (Phase 5 split)
// ============================================
export {
  getActivityLogVisible,
  setActivityLogVisible,
  activityLogState,
  activityLogLines,
  maxActivityLines,
  CREDIT_API_BASE,
  CREDIT_CACHE_TTL_S,
  loopCreditState,
  getLoopWsCheckedIds,
  setLoopWsCheckedIds,
  getLoopWsLastCheckedIdx,
  setLoopWsLastCheckedIdx,
  SESSION_BRIDGE_KEYS,
  getLastSessionBridgeSource,
  setLastSessionBridgeSource,
  toastContainerId,
  state,
} from './shared-state-runtime';

// Re-import state to wire retry config from validated config
import { state as _state } from './shared-state-runtime';
_state.maxRetries = (loopCfg.retry && loopCfg.retry.maxRetries) || 3;
_state.retryBackoffMs = (loopCfg.retry && loopCfg.retry.backoffMs) || 2000;
