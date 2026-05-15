 
/**
 * MacroLoop Controller — Workspace Observer Module
 * Step 2a: Extracted from macro-looping.ts
 *
 * Contains: workspace name detection (XPath + auto-discovery + nav element),
 * MutationObserver for live workspace changes, workspace change history,
 * and credit re-check on workspace change.
 *
 * Uses MacroController singleton for cross-module calls.
 */

import { log, logSub, safeSetItem, getWsHistoryKey, getProjectIdFromUrl, getDisplayProjectName } from './logging';
import { getByXPath } from './xpath-utils';

import { MacroController } from './core/MacroController';

import { checkSystemBusy, closeProjectDialog, ensureProjectDialogOpen, isUserTypingInPrompt, pollForDialogReady } from './dom-helpers';

import { CONFIG, WS_HISTORY_MAX_ENTRIES, loopCreditState, state } from './shared-state';
import { logError } from './error-utils';

import { WORKSPACE_OBSERVER_MAX_RETRIES } from './constants';
import { Label } from './types';

function mc() { return MacroController.getInstance(); }

// ============================================
// Workspace Name Validation
// ============================================

/**
 * v7.9.16: Validate a name against known workspace list.
 * Prevents DOM observer from setting project name as workspace name.
 * v7.39: Tightened matching — exact match on fullName only, no loose partial match.
 * See: spec/22-app-issues/workspace-name-binding-bug.md (RCA-3)
 */
export function isKnownWorkspaceName(name: string): boolean {
  if (!name) return false;
  const perWs = loopCreditState.perWorkspace || [];
  // Issue 84 Fix 1: When workspace list is not yet loaded, allow the name through
  // so that fetchWorkspaceNameFromNav() and the observer can set an early workspace
  // name. Previously this returned false, blocking ALL name detection until credits loaded.
  if (perWs.length === 0) return true;
  for (const ws of perWs) {
    if (ws.fullName === name) { return true; }
    if (ws.name === name) { return true; }
    if (ws.fullName && ws.fullName.toLowerCase() === name.toLowerCase()) { return true; }
  }
  return false;
}

// ============================================
// Workspace Name — XPath-based
// ============================================

/** Try to apply a detected workspace name to state. Returns true if accepted. */
function tryApplyWorkspaceName(name: string, source: string): boolean {
  if (!isKnownWorkspaceName(name)) {
    logSub(source + ' returned "' + name + '" — not a known workspace, skipping', 1);
    return false;
  }
  if (state.workspaceFromApi) {
    logSub(source + ' returned "' + name + Label.IgnoringApiSet + state.workspaceName, 1);
    return true; // accepted but not changed
  }
  if (name !== state.workspaceName) {
    const oldName = state.workspaceName;
    state.workspaceName = name;
    log('Workspace name: ' + name, 'success');
    if (oldName && oldName !== name) {
      addWorkspaceChangeEntry(oldName, name);
    }
  } else {
    logSub('Workspace unchanged: ' + name, 1);
  }
  return true;
}

export function fetchWorkspaceName(): void {
  const wsXpath = CONFIG.WORKSPACE_XPATH;
  if (!wsXpath || wsXpath.indexOf('__') === 0) {
    log('Workspace XPath not configured (placeholder not replaced)', 'warn');
    return;
  }
  try {
    log('Fetching workspace name from XPath: ' + wsXpath, 'check');
    const el = getByXPath(wsXpath);
    if (el) {
      const name = (el.textContent || '').trim();
      if (name) {
        tryApplyWorkspaceName(name, 'Workspace XPath');
      } else {
        log('Workspace element found but text is empty', 'warn');
      }
    } else {
      log('Workspace element NOT FOUND at XPath: ' + wsXpath, 'warn');
    }
    mc().updateUI();
  } catch (e) {
    logError('fetchWorkspaceName error', '' + (e as Error).message);
  }
}

// ============================================
// v7.1: Auto-discover workspace name element via CSS selectors
// ============================================

export function autoDiscoverWorkspaceNavElement(): Element | null {
  const candidates = collectNavCandidates();

  if (candidates.length > 0) {
    candidates.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    const best = candidates[0];
    log('Auto-discovered workspace nav element: "' + best.text + '" <' + best.el.tagName.toLowerCase() + '> at (' + Math.round(best.x) + ',' + Math.round(best.y) + ')', 'success');
    return best.el;
  }

  return null;
}

interface NavCandidate { el: Element; text: string; y: number; x: number }

/** Strategy 1: nav area buttons/links in the top bar */
function collectFromNavButtons(): NavCandidate[] {
  const results: NavCandidate[] = [];
  const navButtons = document.querySelectorAll('nav button, nav a, nav span, [role="navigation"] button');
  for (const el of navButtons) {
    const text = (el.textContent || '').trim();
    if (!text || text.length < 2 || text.length > 60) continue;
    if (/^(Projects?|Settings|Home|Menu|Sign|Log|Help|Docs|\+|×|☰|⋮)$/i.test(text)) continue;
    if (text.length <= 2 && /[^a-zA-Z0-9]/.test(text)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.top < 80) {
      results.push({ el, text, y: rect.top, x: rect.left });
    }
  }
  return results;
}

/** Strategy 2: top-left nav area text elements */
function collectFromTopNav(): NavCandidate[] {
  const results: NavCandidate[] = [];
  const topNavEls = document.querySelectorAll('nav div span, nav div p, nav div a, header span, header a');
  for (const el2 of topNavEls) {
    const text2 = (el2.textContent || '').trim();
    if (!text2 || text2.length < 3 || text2.length > 60) continue;
    const rect2 = el2.getBoundingClientRect();
    if (rect2.width > 0 && rect2.height > 0 && rect2.top < 80 && rect2.left < 400 && el2.children.length <= 1) {
      results.push({ el: el2, text: text2, y: rect2.top, x: rect2.left });
    }
  }
  return results;
}

function collectNavCandidates(): NavCandidate[] {
  const candidates = collectFromNavButtons();
  return candidates.length > 0 ? candidates : collectFromTopNav();
}

// ============================================
// v6.55: Fetch workspace name from nav element
// ============================================

export function fetchWorkspaceNameFromNav(): boolean {
  const navXpath = CONFIG.WORKSPACE_NAV_XPATH;
  const hasXpath = navXpath && navXpath.indexOf('__') !== 0 && navXpath !== '';
  try {
    let el: Node | null = null;
    if (hasXpath) el = getByXPath(navXpath);
    if (!el) el = autoDiscoverWorkspaceNavElement();

    if (el) {
      const name = (el.textContent || '').trim();
      if (name) {
        const accepted = tryApplyWorkspaceName(name, 'Nav');
        if (accepted) mc().updateUI();
        return accepted;
      }
    }
    logSub('Nav workspace element not found or empty', 1);
    return false;
  } catch (e) {
    logError('fetchWorkspaceNameFromNav error', '' + (e as Error).message);
    return false;
  }
}

// ============================================
// WorkspaceObserverState — encapsulated observer state (CQ11, CQ17)
//
// Conversion (CQ10):
//   Before: 2 module-level `let` vars (workspaceObserverInstance, workspaceObserverRetryCount).
//   After:  `WorkspaceObserverState` singleton class with private fields.
// ============================================

// L-1 (audit 2026-05-15): bound the mutation-driven reinstall loop.
// Cap reinstalls at 10 per 60s window with bounded backoff (2s→5s→15s→60s).
// Track all setTimeout handles so disconnect() leaves zero pending timers.
const MUTATION_REINSTALL_CAP = 10;
const MUTATION_REINSTALL_WINDOW_MS = 60_000;
const MUTATION_BACKOFF_LADDER_MS = [2_000, 5_000, 15_000, 60_000];

class WorkspaceObserverState {
  private _instance: MutationObserver | null = null;
  private _retryCount = 0;
  private _mutationReinstallCount = 0;
  private _mutationReinstallWindowStartedAt = 0;
  private _mutationCapReached = false;
  private _pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  get instance(): MutationObserver | null { return this._instance; }
  set instance(value: MutationObserver | null) { this._instance = value; }

  get retryCount(): number { return this._retryCount; }
  set retryCount(value: number) { this._retryCount = value; }

  incrementRetry(): number { return ++this._retryCount; }

  /** Track a setTimeout handle so we can clear it on disconnect. */
  trackTimer(handle: ReturnType<typeof setTimeout>): void {
    this._pendingTimers.add(handle);
  }

  /** Untrack a timer that fired naturally. */
  untrackTimer(handle: ReturnType<typeof setTimeout>): void {
    this._pendingTimers.delete(handle);
  }

  /**
   * Returns the next backoff delay (ms) when the nav element disappears,
   * or `null` when the cap for the current 60s window has been reached.
   */
  nextMutationBackoffMs(): number | null {
    const now = Date.now();
    if (now - this._mutationReinstallWindowStartedAt > MUTATION_REINSTALL_WINDOW_MS) {
      this._mutationReinstallWindowStartedAt = now;
      this._mutationReinstallCount = 0;
      this._mutationCapReached = false;
    }
    if (this._mutationReinstallCount >= MUTATION_REINSTALL_CAP) {
      this._mutationCapReached = true;
      return null;
    }
    const idx = Math.min(this._mutationReinstallCount, MUTATION_BACKOFF_LADDER_MS.length - 1);
    this._mutationReinstallCount += 1;
    return MUTATION_BACKOFF_LADDER_MS[idx];
  }

  get mutationCapReached(): boolean { return this._mutationCapReached; }

  disconnect(): void {
    if (this._instance) {
      this._instance.disconnect();
      this._instance = null;
    }
    for (const handle of this._pendingTimers) {
      clearTimeout(handle);
    }
    this._pendingTimers.clear();
  }
}

const wsObserverState = new WorkspaceObserverState();

export function startWorkspaceObserver(): void {
  const navEl = resolveNavElement();

  if (!navEl) {
    scheduleObserverRetry();
    return;
  }

  wsObserverState.retryCount = 0;

  if (wsObserverState.instance) {
    wsObserverState.instance.disconnect();
    logSub('Previous workspace observer disconnected', 1);
  }

  // Initial read
  const name = (navEl.textContent || '').trim();
  applyInitialObserverName(name);

  // Install MutationObserver
  wsObserverState.instance = new MutationObserver(function (_mutations: MutationRecord[]) {
    handleObserverMutation(navEl);
  });

  wsObserverState.instance!.observe(navEl, { childList: true, characterData: true, subtree: true });
  state.workspaceObserverActive = true;
  log('✅ Workspace MutationObserver installed on nav element', 'success');
}

/** Resolve the workspace nav element via XPath or auto-discovery. */
function resolveNavElement(): Node | Element | null {
  const navXpath = CONFIG.WORKSPACE_NAV_XPATH;
  const hasXpath = navXpath && navXpath.indexOf('__') !== 0 && navXpath !== '';
  let navEl: Node | Element | null = null;

  if (hasXpath) {
    navEl = getByXPath(navXpath);
    if (navEl) logSub('Workspace nav element found via XPath', 1);
  }

  if (!navEl) {
    if (hasXpath) {
      log('WorkspaceNavXPath configured but element not found — trying auto-discovery', 'warn');
    } else {
      logSub('WorkspaceNavXPath not configured — trying auto-discovery', 1);
    }
    navEl = autoDiscoverWorkspaceNavElement();
  }

  return navEl;
}

/** Schedule a retry when the nav element isn't found yet. */
function scheduleObserverRetry(): void {
  const retryNum = wsObserverState.incrementRetry();
  if (retryNum < WORKSPACE_OBSERVER_MAX_RETRIES) {
    const retryDelay = Math.min(retryNum * 3000, 15000);
    log('Workspace observer: element not found — retry ' + retryNum + '/' + WORKSPACE_OBSERVER_MAX_RETRIES + ' in ' + (retryDelay / 1000) + 's', 'warn');
    const handle = setTimeout(function () {
      wsObserverState.untrackTimer(handle);
      startWorkspaceObserver();
    }, retryDelay);
    wsObserverState.trackTimer(handle);
  } else {
    logError('Workspace observer', 'gave up after \' + WORKSPACE_OBSERVER_MAX_RETRIES + \' retries. Set WorkspaceNavXPath in config.ini.');
  }
}

/** Apply the workspace name read during observer initialization. */
function applyInitialObserverName(name: string): void {
  if (!name) return;
  if (name === state.workspaceName) {
    logSub('Workspace name already set: ' + name, 1);
    return;
  }
  if (!isKnownWorkspaceName(name)) {
    logSub('Observer init: "' + name + '" not a known workspace — skipping (API will detect)', 1);
  } else if (state.workspaceFromApi) {
    logSub('Observer init: "' + name + Label.IgnoringApiSet + state.workspaceName, 1);
  } else {
    const oldName = state.workspaceName;
    state.workspaceName = name;
    log('Workspace name (observer init): ' + name, 'success');
    if (oldName && oldName !== name) {
      addWorkspaceChangeEntry(oldName, name);
    }
    mc().updateUI();
  }
}

/** Handle a MutationObserver callback for workspace nav changes. */
function handleObserverMutation(navEl: Node | Element): void {
  if (!document.contains(navEl)) {
    log('Workspace nav element removed from DOM — restarting observer', 'warn');
    wsObserverState.disconnect();
    state.workspaceObserverActive = false;
    const backoff = wsObserverState.nextMutationBackoffMs();
    if (backoff === null) {
      logError(
        'standalone-scripts/macro-controller/src/workspace-observer.ts',
        'Reason=ReinstallCapHit ReasonDetail=workspace observer reinstall cap (' + MUTATION_REINSTALL_CAP + ' per ' + (MUTATION_REINSTALL_WINDOW_MS / 1000) + 's) hit; halting auto-reinstall to prevent leak loop'
      );
      return;
    }
    const handle = setTimeout(function () {
      wsObserverState.untrackTimer(handle);
      startWorkspaceObserver();
    }, backoff);
    wsObserverState.trackTimer(handle);
    return;
  }

  const newName = (navEl!.textContent || '').trim();
  if (!isKnownWorkspaceName(newName)) {
    logSub('Observer mutation: "' + newName + '" not a known workspace — ignoring', 1);
    return;
  }
  if (state.workspaceFromApi) {
    logSub('Observer mutation: "' + newName + Label.IgnoringApiSet + state.workspaceName, 1);
    return;
  }
  if (newName && newName !== state.workspaceName) {
    const oldName = state.workspaceName;
    state.workspaceName = newName;
    log('⚡ Workspace changed (observer): "' + oldName + '" → "' + newName + '"', 'success');
    if (oldName) addWorkspaceChangeEntry(oldName, newName);

    state.workspaceJustChanged = true;
    if (state.workspaceChangedTimer) clearTimeout(state.workspaceChangedTimer);
    state.workspaceChangedTimer = setTimeout(function () {
      state.workspaceJustChanged = false;
      mc().updateUI();
    }, 10000);

    mc().updateUI();
    triggerCreditCheckOnWorkspaceChange();
  }
}

// ============================================
// v6.56: On workspace change → check free credit
// ============================================

export function triggerCreditCheckOnWorkspaceChange(): void {
  log('Workspace changed — checking free credit...', 'check');

  // Issue 82 policy: NEVER open project dialog when loop is stopped.
  // Dialog interaction when stopped is only permitted via explicit user actions (Check, Credits).
  if (!state.running) {
    log('Skipping dialog-based credit check — loop is stopped (Issue 82 policy)', 'skip');
    mc().updateUI();
    return;
  }

  if (isUserTypingInPrompt()) {
    log('Skipping credit check — user is typing in prompt', 'skip');
    return;
  }

  const opened = ensureProjectDialogOpen();
  if (!opened) {
    log('Could not open project dialog for credit check', 'warn');
    return;
  }

  pollForDialogReady().then(function () {
    const hasCredit = checkSystemBusy();
    state.hasFreeCredit = hasCredit;
    state.isIdle = !hasCredit;
    state.lastStatusCheck = Date.now();
    log('Credit check after workspace change: ' + (hasCredit ? 'FREE CREDIT' : 'NO CREDIT'), hasCredit ? 'success' : 'warn');
    closeProjectDialog();
    mc().updateUI();
  });
}

// ============================================
// Workspace Change History (localStorage)
// ============================================

export function addWorkspaceChangeEntry(fromName: string, toName: string): void {
  try {
    const key = getWsHistoryKey();
    let history = JSON.parse(localStorage.getItem(key) || '[]');
    const now = new Date();
    const projectName = getDisplayProjectName();
    const projectId = getProjectIdFromUrl();
    history.push({
      from: fromName,
      to: toName,
      time: now.toISOString(),
      display: now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
      projectName: projectName,
      projectId: projectId,
    });
    if (history.length > WS_HISTORY_MAX_ENTRIES) history = history.slice(history.length - WS_HISTORY_MAX_ENTRIES);
    safeSetItem(key, JSON.stringify(history));
    log('Workspace changed: "' + fromName + '" → "' + toName + '" (project=' + projectName + ', key=' + key + ')', 'success');
    mc().updateUI();
  } catch (e) { log('Failed to record workspace change: ' + (e instanceof Error ? e.message : String(e)), 'warn'); }
}

export function getWorkspaceHistory(): Array<Record<string, string>> {
  try {
    const key = getWsHistoryKey();

    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    log('Failed to read workspace history: ' + (e instanceof Error ? e.message : String(e)), 'warn');

    return [];
  }
}

export function clearWorkspaceHistory(): void {
  try {
    const key = getWsHistoryKey();
    localStorage.removeItem(key);
  } catch (e) { log('Failed to clear workspace history: ' + (e instanceof Error ? e.message : String(e)), 'warn'); }
}
