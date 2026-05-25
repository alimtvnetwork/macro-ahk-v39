/**
 * Panel Builder — orchestrator for MacroLoop Controller panel (Phase 5F barrel)
 *
 * createUI composes sub-modules: panel-header, panel-controls, panel-sections.
 * All external dependencies are injected via PanelBuilderDeps.
 *
 * @see spec/04-macro-controller/ui-overhaul.md — UI architecture
 * @see .lovable/memory/architecture/macro-controller/bootstrap-strategy.md — UI-first rendering
 */

import {
  IDS,
  CONFIG,
  cPanelBg,
  cPanelBorder,
  cPanelFg,
  cPrimary,
  lPanelRadius,
  lPanelPadding,
  lPanelMinW,
  lPanelShadow,
  lPanelFloatW,
  lPanelFloatSh,
  tFont,
  tFontSize,
  PANEL_DEFAULT_WIDTH,
  PANEL_DEFAULT_HEIGHT,
  
} from '../shared-state';
import { log } from '../logging';
import { getByXPath } from '../xpath-utils';

import { buildTitleRow } from './panel-header';
import { buildButtonRow } from './panel-controls';
import {
  buildStatusBar,
  buildToolsMasterSection,
  createRecordIndicator,
  injectKeyframeStyles,
  createPanelLayoutCtx,
  createResizeHandle,
  enableFloating,
  hideBodyElementForMinimize,
  loadPanelGeometry,
  restorePanel,
  setupDragListeners,
  setupResizeListeners,
  registerKeyboardHandlers,
} from './panel-sections';
import { startRedockObserver } from './redock-observer';

import type { RenameHistoryEntry, UndoRenameResults } from '../types';
import type { TaskNextDeps } from './task-next-ui';
import type { PanelLayoutCtx } from './panel-sections';

// ============================================
// Dependencies interface — injected by macro-looping.ts
// ============================================

export interface PanelBuilderDeps {
  startLoop: (direction: string) => void;
  stopLoop: () => void;
  forceSwitch: (direction: string) => void;
  fetchLoopCreditsWithDetect: (isRetry?: boolean) => void;
  autoDetectLoopCurrentWorkspace: (token: string) => Promise<void>;
  updateProjectButtonXPath: (val: string) => void;
  updateProgressXPath: (val: string) => void;
  updateWorkspaceXPath: (val: string) => void;
  executeJs: () => void;
  navigateLoopJsHistory: (dir: string) => void;
  populateLoopWorkspaceDropdown: () => void;
  updateWsSelectionUI: () => void;
  renderBulkRenameDialog: () => void;
  getRenameHistory: () => RenameHistoryEntry[];
  undoLastRename: (cb: (r: UndoRenameResults, done: boolean) => void) => void;
  updateUndoBtnVisibility: () => void;
  getLoopWsFreeOnly: () => boolean;
  setLoopWsFreeOnly: (v: boolean) => void;
  getLoopWsCompactMode: () => boolean;
  setLoopWsCompactMode: (v: boolean) => void;
  getLoopWsExpiredWithCredits: () => boolean;
  setLoopWsExpiredWithCredits: (v: boolean) => void;
  getLoopWsRefillSoon: () => boolean;
  setLoopWsRefillSoon: (v: boolean) => void;
  getLoopWsRefillPriority: () => boolean;
  setLoopWsRefillPriority: (v: boolean) => void;
  getLoopWsNavIndex: () => number;
  setLoopWsNavIndex: (v: number) => void;
  triggerLoopMoveFromSelection: () => void;
  taskNextDeps?: TaskNextDeps;
}

// ============================================
// createUI — main panel construction (orchestrator)
// ============================================

// CQ11: Singleton for createUI retry tracking
class CreateUIState {
  private _retryCount = 0;

  get retryCount(): number {
    return this._retryCount;
  }

  increment(): void {
    this._retryCount++;
  }
}

const createUIState = new CreateUIState();

 
export function createUI(deps: PanelBuilderDeps): void {
  let container = getByXPath(CONFIG.CONTROLS_XPATH);
  if (!container) {
    createUIState.increment();
    log('UI container not found at XPath: ' + CONFIG.CONTROLS_XPATH + ' — using immediate BODY fallback (floating panel)', 'warn');
    container = document.body;
  }

  if (document.getElementById(IDS.CONTAINER)) {
    log('UI already exists in DOM');
    return;
  }

  // Inject keyframe animations + skeleton shimmer styles
  injectKeyframeStyles();

  // Main UI container
  const ui = document.createElement('div');
  ui.id = IDS.CONTAINER;
  ui.style.cssText = 'background:' + cPanelBg + ';border:1px solid ' + cPanelBorder + ';border-radius:' + lPanelRadius + ';padding:' + lPanelPadding + ';margin:8px 0;font-family:' + tFont + ';font-size:' + tFontSize + ';color:' + cPanelFg + ';min-width:' + lPanelMinW + ';box-shadow:' + lPanelShadow + ';width:' + PANEL_DEFAULT_WIDTH + 'px;height:' + PANEL_DEFAULT_HEIGHT + 'px;overflow:hidden;';
  ui.className = 'marco-enter';

  // Panel layout — drag, resize, minimize
  const plCtx = createPanelLayoutCtx(ui, lPanelFloatW, lPanelFloatSh, cPrimary);
  setupDragListeners(plCtx);
  setupResizeListeners(plCtx);

  ui.style.position = ui.style.position || 'relative';
  const cornerHandle = createResizeHandle(plCtx, 'corner');
  const bottomHandle = createResizeHandle(plCtx, 'bottom');
  ui.appendChild(cornerHandle);
  ui.appendChild(bottomHandle);

  // ── Build sub-sections ──
  const { titleRow } = buildTitleRow(deps, plCtx);
  const { status, infoRow } = buildStatusBar();
  const { btnRow, btnStyle, taskNextDeps } = buildButtonRow(deps);
  const { toolsSection, wsDropSection, authDiagRow, jsBody, settingsDeps } = buildToolsMasterSection(deps, btnStyle, taskNextDeps);

  // Track body elements for minimize/restore
  plCtx.bodyElements = [status, infoRow, btnRow, authDiagRow, wsDropSection, toolsSection];

  // Assembly
  ui.appendChild(titleRow);
  ui.appendChild(status);
  ui.appendChild(infoRow);
  ui.appendChild(btnRow);
  ui.appendChild(authDiagRow);
  ui.appendChild(wsDropSection);
  ui.appendChild(toolsSection);

  container.appendChild(ui);

  // Auto-float if body fallback, then start polling for the real XPath target
  if (container === document.body) {
    enableFloating(plCtx);
    startRedockObserver(plCtx);
  }

  // Restore minimized state from localStorage on initial load
  // See: spec/22-app-issues/63-button-layout-collapse-reload.md
  if (plCtx.panelState === 'minimized') {
    _restoreMinimizedPanel(ui, plCtx);
  }

  // Record indicator (fixed position)
  document.body.appendChild(createRecordIndicator());

  // Keyboard handlers (with Task Next deps for Ctrl+Shift+1..9 shortcuts)
  const kbTaskNextDeps = deps.taskNextDeps;
  registerKeyboardHandlers({
    jsBody, plCtx, settingsDeps, ui, startLoop: deps.startLoop, stopLoop: deps.stopLoop, forceSwitch: deps.forceSwitch, restorePanel, taskNextDeps: kbTaskNextDeps,
  });

  log('UI created successfully with drag, hide/minimize, and keyboard shortcuts', 'success');
}

// ============================================
// _restoreMinimizedPanel — v2.196.0 fix for spec 63
// ============================================
//
// When the page reloads while the panel was last left minimized, we hide all
// body sections AND seed plCtx.expandedHeight from the saved geometry. The
// previous implementation left expandedHeight as the empty string, so the
// later [+] expand call set ui.style.height = '' and the browser collapsed
// the panel to content height. Inside a narrow Lovable sidebar that meant
// the button row's flex-wrap kicked in too aggressively and rendered with
// no spacing, padding, or centering.
//
// Seeding from saved geometry restores the user's last expanded size; if no
// geometry was ever saved (first run after install) we fall back to the
// PANEL_DEFAULT_HEIGHT constant — never an empty string.
function _restoreMinimizedPanel(ui: HTMLElement, plCtx: PanelLayoutCtx): void {
  for (const el of plCtx.bodyElements) {
    hideBodyElementForMinimize(el);
  }

  const savedGeometry = loadPanelGeometry();
  const restoredHeight = savedGeometry?.height || (PANEL_DEFAULT_HEIGHT + 'px');
  plCtx.expandedHeight = restoredHeight;
  plCtx.expandedMaxHeight = '';
  plCtx.expandedOverflow = 'hidden';
  plCtx.expandedOverflowY = 'auto';

  ui.style.height = 'auto';
  ui.style.maxHeight = '';
  ui.style.overflow = 'visible';
  ui.style.overflowY = 'visible';
  log('Panel restored in minimized state from localStorage (expandedHeight seeded: ' + restoredHeight + ')', 'info');
}
