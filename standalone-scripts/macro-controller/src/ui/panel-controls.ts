/**
 * Panel Controls — Button row construction extracted from panel-builder.ts (Phase 5F)
 *
 * Builds the button row: check, start/stop, credits, prompts dropdown,
 * hamburger menu, and save-prompt injection.
 */

import { trackedSetInterval, trackedClearInterval } from '../interval-registry';
import {
  IDS,
  cPanelBg,
  cPrimary,
  cError,
  cBtnStartGrad,
  cBtnStartGlow,
  cBtnCreditGrad,
  cBtnCreditGlow,
  cBtnPromptGrad,
  cBtnPromptGlow,
  cBtnUtilBg,
  cBtnUtilBorder,
  lDropdownRadius,
  lDropdownShadow,
  tFont,
  tFontSm,
  tFontTiny,
  trNormal,
  state,
  loopCreditState,
} from '../shared-state';
import { log } from '../logging';
import { getByXPath } from '../xpath-utils';
import { pollUntil } from '../async-utils';
import { getBearerToken, updateAuthBadge } from '../auth';
import { nsWrite } from '../api-namespace';
import { buildHamburgerMenu } from './menu-builder';
import { createCheckButton } from './check-button';
import { createCountdownCtx, updateStartStopBtn } from './countdown';
import { loadTaskNextSettings, setupTaskNextCancelHandler } from './task-next-ui';
import { injectSavePromptButton } from './save-prompt';
import { attachButtonHoverFx } from './ui-updaters';
import { setOverlayVisible, getOverlayErrorCount, ensureErrorOverlay } from './error-overlay';
import { createPromptsListSkeleton } from './skeleton';
import {
  PromptContext,
  getPromptsConfig,
  isPromptsCached,
  loadPromptsFromJson,
  openPromptCreationModal,
  renderPromptsDropdown,
  sendToExtension,
  setRevalidateContext,
} from './prompt-manager';

import type { PanelBuilderDeps } from './panel-builder';
import type { PromptEntry } from '../types';
import type { TaskNextDeps } from './task-next-ui';
import { logError } from '../error-utils';
import { showToast } from '../toast';
import { CssFragment } from '../types';
// ============================================

// ============================================
// Helper: focus the current workspace in the workspace list after credit refresh
// See: spec/22-app-issues/credit-refresh/overview.md
// ============================================

function focusCurrentWorkspaceInList(): void {
  const listEl = document.getElementById('loop-ws-list');
  if (!listEl) return;
  const currentName = state.workspaceName;
  if (!currentName) {
    log('Credits: no current workspace name to focus', 'warn');
    return;
  }
  const currentItem = listEl.querySelector('.loop-ws-item[data-ws-current="true"]');
  if (currentItem) {
    currentItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
    (currentItem as HTMLElement).style.outline = '2px solid #F59E0B';
    setTimeout(function() { (currentItem as HTMLElement).style.outline = ''; }, 2000);
    log('Credits: ✅ Focused current workspace: ' + currentName, 'success');
  } else {
    log('Credits: current workspace item not found in list for "' + currentName + '"', 'warn');
  }
}

// ============================================
// Return type for buildButtonRow
// ============================================

export interface ButtonRowResult {
  btnRow: HTMLElement;
  btnStyle: string;
  promptCtx: PromptContext;
  taskNextDeps: TaskNextDeps;
}

// ============================================
// buildButtonRow — check, start/stop, credits, prompts, menu
// ============================================

export function buildButtonRow(deps: PanelBuilderDeps): ButtonRowResult {
  const btnRow = document.createElement('div');
  // v2.195.0: Added 10px horizontal padding so wrapped buttons don't kiss
  // the panel edge when the user resizes the panel narrow or expands from
  // a minimized state (legacy bug — buttons sat flush-left with the rightmost
  // button clipped by the panel's overflow:hidden boundary). Dropped the
  // `width:100%` because the row is already a block child of `ui`; combined
  // with horizontal padding it now centers and wraps cleanly at any width.
  //
  // v2.196.0: Added `min-width:460px` per spec 63 non-regression rule #4 —
  // the button row must keep gap+padding regardless of container width.
  // This guarantees the row holds a consistent layout even when the panel
  // is restored from a minimized state inside a narrow Lovable sidebar.
  // v2.239.0: Removed `min-width:460px` — it forced the button row wider than
  // the panel's `overflow:hidden` content area, clipping the rightmost buttons
  // (menu/error toggle) when the panel is at its default 494px width inside
  // a narrow Lovable sidebar. Flex-wrap already keeps the buttons readable
  // at any width, so the min-width was the sole cause of the clipping bug.
  // v3.9.3: Bumped gap from 8px → 10px AND added per-button `margin:2px 3px`
  // so each control keeps visible breathing room even when the panel is
  // restored from a minimized state into a narrow container — where flex
  // `gap` has been observed to collapse visually (buttons rendered flush
  // against each other). The margin is independent of `gap` and survives
  // any minimize → expand cycle.
  // v3.10.0: Added `min-width:0;max-width:100%;overflow:visible` so the row
  // wraps cleanly instead of clipping the rightmost buttons when the panel
  // is restored into a narrow Lovable sidebar. Prompts/error/menu buttons
  // also get `min-width:0` on their wrappers below.
  btnRow.style.cssText = 'display:flex;gap:10px;row-gap:10px;flex-wrap:wrap;align-items:center;justify-content:center;padding:8px 10px 10px;width:100%;max-width:100%;min-width:0;margin:0 auto;box-sizing:border-box;overflow:visible;';

  // v2.239.0: Added `flex:0 0 auto;white-space:nowrap` so the buttons keep their
  // natural intrinsic width inside the flex-wrap row. Without this, when the panel
  // auto-sizes during minimize → expand (or briefly during keepPanelInViewport
  // clamping inside a narrow Lovable sidebar), the flex children would shrink
  // below their content width and the labels rendered tiny/cramped.
  // v3.9.3: Added `margin:2px 3px` as a defensive gap so adjacent buttons
  // never visually touch even if the parent's flex `gap` is overridden.
  const btnStyle = 'padding:6px 14px;border:none;border-radius:8px;font-weight:600;font-size:' + tFontSm + ';cursor:pointer;transition:all ' + trNormal + ';line-height:1;height:34px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;flex:0 0 auto;white-space:nowrap;margin:2px 3px;';

  // Check button
  const checkResult = createCheckButton({ btnStyle, updateAuthBadge });
  const checkBtn = checkResult.checkBtn;

  // Start/Stop toggle
  const { wrap: startStopWrap, btn: startStopBtn } = buildStartStopButton(deps, btnStyle);

  // Credits button
  const creditBtn = buildCreditButton(deps, btnStyle);

  // Prompts dropdown
  const promptsResult = buildPromptsDropdown(deps, btnStyle);

  // Hamburger menu
  const menuResult = buildHamburgerMenu({
    btnStyle: btnStyle,
    startLoop: deps.startLoop,
    stopLoop: deps.stopLoop,
  });

  // Save Prompt button
  const savePromptDeps = {
    getPromptsConfig: getPromptsConfig,
    getByXPath: ((xpath: string) => getByXPath(xpath) as Element | null) as (xpath: string) => Element | null,
    openPromptCreationModal: function(data: Partial<PromptEntry>) { openPromptCreationModal(promptsResult.promptCtx, promptsResult.taskNextDeps, null, data); },
    taskNextDeps: promptsResult.taskNextDeps,
  };
  injectSavePromptButton(savePromptDeps);

  // Error overlay toggle
  const errorToggleBtn = buildErrorToggleButton(btnStyle);

  // Assemble button row
  btnRow.appendChild(checkBtn);
  btnRow.appendChild(startStopWrap);
  btnRow.appendChild(creditBtn);
  btnRow.appendChild(promptsResult.promptsContainer);
  btnRow.appendChild(errorToggleBtn);
  btnRow.appendChild(menuResult.menuContainer);

  [checkBtn, startStopBtn, creditBtn, promptsResult.promptsBtn, errorToggleBtn, menuResult.menuBtn].forEach(attachButtonHoverFx);

  return { btnRow, btnStyle, promptCtx: promptsResult.promptCtx, taskNextDeps: promptsResult.taskNextDeps };
}

// ============================================
// Start/Stop button builder
// ============================================

function buildStartStopButton(deps: PanelBuilderDeps, btnStyle: string): { wrap: HTMLElement; btn: HTMLElement } {
  const startStopWrap = document.createElement('div');
  startStopWrap.style.cssText = 'display:inline-flex;align-items:center;position:relative;min-width:0;';

  const startStopBtn = document.createElement('button');
  startStopBtn.id = IDS.START_BTN;
  startStopBtn.textContent = '▶';
  startStopBtn.title = 'Start loop';
  startStopBtn.style.cssText = btnStyle + CssFragment.Background + cBtnStartGrad + ';color:#fff;border-radius:8px;min-width:36px;width:36px;font-size:14px;text-align:center;padding:6px 0;box-shadow:' + cBtnStartGlow + CssFragment.Border1pxSolidRgba + ';position:relative;';
  startStopBtn.onmouseenter = function() { startStopBtn.style.filter = 'brightness(1.12)'; startStopBtn.style.boxShadow = '0 2px 8px rgba(0,200,83,0.4), inset 0 1px 0 rgba(255,255,255,0.2)'; };
  startStopBtn.onmouseleave = function() { startStopBtn.style.filter = ''; startStopBtn.style.boxShadow = cBtnStartGlow; };
  startStopBtn.onclick = function() {
    if (state.running) {
      deps.stopLoop();
    } else {
      deps.startLoop(state.direction);
    }
  };

  // Countdown badge
  const countdownBadge = document.createElement('span');
  countdownBadge.id = 'loop-countdown-badge';
  countdownBadge.style.cssText = 'display:none;align-items:center;justify-content:center;font-size:9px;font-family:' + tFont + ';font-weight:700;color:#fbbf24;background:rgba(0,0,0,0.6);padding:2px 6px;height:34px;border-radius:8px;border:1px solid rgba(251,191,36,0.3);margin-left:3px;min-width:28px;text-align:center;pointer-events:none;';
  countdownBadge.textContent = '';

  startStopWrap.appendChild(startStopBtn);
  startStopWrap.appendChild(countdownBadge);

  const cdCtx = createCountdownCtx(startStopBtn, countdownBadge, function(d: string) { deps.startLoop(d); }, deps.stopLoop);
  nsWrite('_internal.updateStartStopBtn', function(running: boolean) { updateStartStopBtn(cdCtx, running); });
  updateStartStopBtn(cdCtx, !!state.running);

  return { wrap: startStopWrap, btn: startStopBtn };
}

// CQ16: Extracted credit fetch context + function
interface CreditFetchCtx {
  deps: PanelBuilderDeps;
  creditBtn: HTMLElement;
  onComplete: () => void;
}

/** Set credit button to loading or idle state. */
function setCreditBtnLoading(btn: HTMLElement, loading: boolean): void {
  btn.textContent = loading ? '⏳ Loading…' : '💰 Credits';
  btn.style.opacity = loading ? '0.7' : '1';
  btn.style.pointerEvents = loading ? 'none' : 'auto';
}

/** Log the token result before credit fetch. */
function logCreditTokenResult(token: string): void {
  if (token) {
    log('Credits: ✅ Token ready via getBearerToken() — proceeding', 'success');
    return;
  }

  log('Credits: ⚠️ No token from getBearerToken() — proceeding with cookies', 'warn');
}

function executeCreditFetch(ctx: CreditFetchCtx): void {
  ctx.deps.fetchLoopCreditsWithDetect(false);
  const startedAt = Date.now();
  pollUntil(
    function () {
      const isComplete = (loopCreditState.lastCheckedAt ?? 0) > startedAt;

      return isComplete ? true : null;
    },
    { intervalMs: 500, timeoutMs: 15000 },
  ).then(function () {
    ctx.onComplete();
    setCreditBtnLoading(ctx.creditBtn, false);
    focusCurrentWorkspaceInList();
  });
}

// ============================================
// Credit button builder
// ============================================

function buildCreditButton(deps: PanelBuilderDeps, btnStyle: string): HTMLElement {
  const creditBtn = document.createElement('button');
  creditBtn.textContent = '💰 Credits';
  creditBtn.title = 'Fetch credit status via API and refresh workspace bars';
  creditBtn.style.cssText = btnStyle + CssFragment.Background + cBtnCreditGrad + ';color:#1a1a2e;font-size:' + tFontTiny + ';padding:6px 12px;box-shadow:' + cBtnCreditGlow + CssFragment.Border1pxSolidRgba;
  creditBtn.onmouseenter = function() { creditBtn.style.filter = 'brightness(1.12)'; creditBtn.style.boxShadow = '0 2px 8px rgba(245,158,11,0.4), inset 0 1px 0 rgba(255,255,255,0.2)'; };
  creditBtn.onmouseleave = function() { creditBtn.style.filter = ''; creditBtn.style.boxShadow = cBtnCreditGlow; };

  let creditInFlight = false;
  creditBtn.onclick = function() {
    if (creditInFlight) {
      log('Credits: already in flight — ignoring duplicate click', 'warn');
      return;
    }
    creditInFlight = true;
    setCreditBtnLoading(creditBtn, true);

    const creditFetchCtx: CreditFetchCtx = {
      deps,
      creditBtn,
      onComplete: function() { creditInFlight = false; },
    };

    getBearerToken().then(function(token: string) {
      logCreditTokenResult(token);
      executeCreditFetch(creditFetchCtx);
    });
  };

  return creditBtn;
}

// ============================================
// Prompts dropdown builder
// ============================================

interface PromptsDropdownResult {
  promptsContainer: HTMLElement;
  promptsBtn: HTMLElement;
  promptCtx: PromptContext;
  taskNextDeps: TaskNextDeps;
}

 
function buildPromptsDropdown(_deps: PanelBuilderDeps, btnStyle: string): PromptsDropdownResult {
  const promptsContainer = document.createElement('div');
  promptsContainer.style.cssText = 'position:relative;display:inline-block;min-width:0;';
  const promptsBtn = document.createElement('button');
  promptsBtn.textContent = '📋 Prompts';
  promptsBtn.title = 'Select a prompt to paste or copy';
  promptsBtn.style.cssText = btnStyle + CssFragment.Background + cBtnPromptGrad + ';color:#fff;font-size:' + tFontTiny + ';padding:6px 12px;box-shadow:' + cBtnPromptGlow + CssFragment.Border1pxSolidRgba;
  promptsBtn.onmouseenter = function() { promptsBtn.style.filter = 'brightness(1.15)'; promptsBtn.style.boxShadow = '0 0 20px rgba(0,198,255,0.55)'; };
  promptsBtn.onmouseleave = function() { promptsBtn.style.filter = ''; promptsBtn.style.boxShadow = cBtnPromptGlow; };

  const promptsDropdown = document.createElement('div');
  // Portaled to document.body to escape panel overflow:hidden clipping.
  // Position is computed on open via positionPromptsDropdown() in Step 3.
  promptsDropdown.setAttribute('data-marco-prompts-dropdown', '1');
  promptsDropdown.style.cssText = 'display:none;position:fixed;top:0;left:0;min-width:220px;max-width:340px;max-height:280px;overflow-y:auto;background:' + cPanelBg + ';border:1px solid ' + cPrimary + ';border-radius:' + lDropdownRadius + ';z-index:2147483600;box-shadow:' + lDropdownShadow + ';';

  const promptCtx: PromptContext = { promptsDropdown: promptsDropdown };
  const taskNextDeps: TaskNextDeps = { sendToExtension: sendToExtension as (type: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>, getPromptsConfig: getPromptsConfig, getByXPath: ((xpath: string) => getByXPath(xpath) as Element | null) as (xpath: string) => Element | null };
  loadTaskNextSettings(taskNextDeps);
  setupTaskNextCancelHandler();
  setRevalidateContext(promptCtx, taskNextDeps);

  // Pre-load prompts on injection so they're warm by first click
  // See: spec/22-app-issues/64-prompts-loading-when-cached.md
  loadPromptsFromJson().then(function() {
    log('Prompts pre-loaded on injection', 'success');
  });

  promptsBtn.onclick = function(e: Event) {
    e.stopPropagation();
    const isOpen = promptsDropdown.style.display !== 'none';
    promptsDropdown.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      positionPromptsDropdown(promptsBtn, promptsDropdown);
      loadTaskNextSettings(taskNextDeps);
      if (isPromptsCached()) {
        // Prompts already in memory — render instantly, no loading indicator
        renderPromptsDropdown(promptCtx, taskNextDeps);
      } else {
        // Cold load — show shimmer skeleton
        promptsDropdown.innerHTML = '';
        promptsDropdown.appendChild(createPromptsListSkeleton());
        loadPromptsFromJson().then(function(_loaded: PromptEntry[] | null) {
          renderPromptsDropdown(promptCtx, taskNextDeps);
        }).catch(function(e: unknown) {
          logError('loadPrompts', 'Failed to load prompts from JSON', e);
          showToast('❌ Failed to load prompts from JSON', 'error');
          // Show error state if load completely fails
          promptsDropdown.innerHTML = '';
          const errEl = document.createElement('div');
          errEl.style.cssText = 'padding:16px 12px;text-align:center;color:#ef4444;font-size:11px;';
          errEl.textContent = '❌ Failed to load prompts. Click to retry.';
          errEl.style.cursor = 'pointer';
          errEl.onclick = function(ev: Event) {
            ev.stopPropagation();
            promptsDropdown.innerHTML = '';
            promptsDropdown.appendChild(createPromptsListSkeleton());
            loadPromptsFromJson().then(function() { renderPromptsDropdown(promptCtx, taskNextDeps); });
          };
          promptsDropdown.appendChild(errEl);
        });
      }
    }
  };
  document.addEventListener('click', function(ev: Event) {
    const target = ev.target as Node | null;
    const insideDropdown = target !== null && promptsDropdown.contains(target);
    const onButton = target !== null && promptsBtn.contains(target);
    if (insideDropdown || onButton) { return; }
    promptsDropdown.style.display = 'none';
    const sub = document.querySelector('[data-task-next-sub]') as HTMLElement | null;
    if (sub) { sub.style.display = 'none'; }
  });
  // Reposition on viewport changes while open
  const onReflow = function(): void {
    if (promptsDropdown.style.display !== 'none') {
      positionPromptsDropdown(promptsBtn, promptsDropdown);
    }
  };
  window.addEventListener('resize', onReflow);
  window.addEventListener('scroll', onReflow, true);
  promptsContainer.appendChild(promptsBtn);
  // Portal the dropdown to <body> so it escapes the panel's overflow:hidden.
  document.body.appendChild(promptsDropdown);

  return { promptsContainer, promptsBtn, promptCtx, taskNextDeps };
}

// ============================================
// Prompts dropdown positioning — viewport-aware flip + clamp
// ============================================

const DROPDOWN_GAP = 4;
const DROPDOWN_SAFE_GUTTER = 8;
const DROPDOWN_MIN_HEIGHT = 160;
const DROPDOWN_MAX_HEIGHT_CAP = 480;

function positionPromptsDropdown(triggerBtn: HTMLElement, dropdown: HTMLElement): void {
  const btnRect = triggerBtn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Reset height cap so measurement reflects natural size.
  dropdown.style.maxHeight = DROPDOWN_MAX_HEIGHT_CAP + 'px';
  const dropRect = dropdown.getBoundingClientRect();
  const dropWidth = dropRect.width > 0 ? dropRect.width : 280;
  const dropHeight = dropRect.height > 0 ? dropRect.height : DROPDOWN_MIN_HEIGHT;

  const spaceBelow = vh - btnRect.bottom - DROPDOWN_GAP - DROPDOWN_SAFE_GUTTER;
  const spaceAbove = btnRect.top - DROPDOWN_GAP - DROPDOWN_SAFE_GUTTER;
  const openUp = spaceBelow < Math.min(dropHeight, DROPDOWN_MIN_HEIGHT) && spaceAbove > spaceBelow;

  const availableHeight = openUp ? spaceAbove : spaceBelow;
  const finalHeight = Math.max(DROPDOWN_MIN_HEIGHT, Math.min(dropHeight, availableHeight, DROPDOWN_MAX_HEIGHT_CAP));
  dropdown.style.maxHeight = Math.round(finalHeight) + 'px';

  const top = openUp
    ? Math.max(DROPDOWN_SAFE_GUTTER, btnRect.top - DROPDOWN_GAP - finalHeight)
    : Math.round(btnRect.bottom + DROPDOWN_GAP);

  // Horizontal: prefer left-align to trigger; flip to right-align if it would overflow right edge;
  // finally clamp into viewport with safe gutter.
  let left = Math.round(btnRect.left);
  const overflowsRight = left + dropWidth + DROPDOWN_SAFE_GUTTER > vw;
  if (overflowsRight) {
    left = Math.round(btnRect.right - dropWidth);
  }
  const minLeft = DROPDOWN_SAFE_GUTTER;
  const maxLeft = Math.max(minLeft, vw - dropWidth - DROPDOWN_SAFE_GUTTER);
  if (left < minLeft) { left = minLeft; }
  if (left > maxLeft) { left = maxLeft; }

  dropdown.style.top = Math.round(top) + 'px';
  dropdown.style.left = left + 'px';
  dropdown.setAttribute('data-open-direction', openUp ? 'up' : 'down');
}

// ============================================
// Error overlay toggle button
// ============================================

function buildErrorToggleButton(btnStyle: string): HTMLElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-panel-action', 'error-overlay-toggle');
  btn.title = 'Show/hide error overlay';
  btn.style.cssText = btnStyle + 'background:' + cBtnUtilBg + ';color:#fff;font-size:13px;min-width:36px;width:36px;padding:6px 0;border:1px solid ' + cBtnUtilBorder + ';position:relative;';

  const icon = document.createElement('span');
  icon.textContent = '⚠';
  icon.style.cssText = 'font-size:14px;';
  btn.appendChild(icon);

  // Error count badge (hidden when 0)
  const badge = document.createElement('span');
  badge.setAttribute('data-error-badge', 'true');
  badge.style.cssText = 'display:none;position:absolute;top:-4px;right:-4px;background:' + cError + ';color:#fff;font-size:9px;font-weight:700;min-width:16px;height:16px;border-radius:8px;padding:0 4px;line-height:16px;text-align:center;pointer-events:none;';
  btn.appendChild(badge);

  btn.onclick = function () {
    ensureErrorOverlay();
    const count = getOverlayErrorCount();
    const hasErrors = count > 0;
    setOverlayVisible(true);

    if (!hasErrors) {
      log('[ErrorOverlay] Opened (no errors)', 'check');
    } else {
      log('[ErrorOverlay] Opened (' + count + ' errors)', 'check');
    }
  };

  // PERF-2 (2026-04-25): self-clearing interval. Re-bootstrap stacking
  // is prevented by the data-error-badge-poll guard, and the timer
  // self-stops once the badge element is detached from the DOM (panel
  // teardown / navigation), avoiding leaked intervals + closure refs.
  if (!badge.hasAttribute('data-error-badge-poll')) {
    badge.setAttribute('data-error-badge-poll', '1');
    const badgePollId = trackedSetInterval('UI.errorBadgePoll', function () {
      if (!badge.isConnected) {
        trackedClearInterval(badgePollId);
        return;
      }
      const count = getOverlayErrorCount();
      const hasErrors = count > 0;
      badge.style.display = hasErrors ? 'inline-block' : 'none';
      badge.textContent = hasErrors ? (count > 99 ? '99+' : String(count)) : '';
    }, 5000);
  }

  return btn;
}
