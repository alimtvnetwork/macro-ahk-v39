/**
 * MacroLoop Controller — Startup & Initialization
 * Step 2h: Extracted from macro-looping.ts
 *
 * Contains: bootstrap sequence, auth resolution, workspace loading,
 * auto-resync on focus/visibility.
 *
 * Sub-modules: startup-token-gate, startup-persistence, startup-global-handlers.
 *
 * @see spec/04-macro-controller/ts-migration-v2/01-initialization-fix.md — Init spec
 * @see .lovable/memory/features/macro-controller/startup-initialization.md — UI-first strategy
 */

import { log, getProjectNameFromDom } from './logging';
import { getIntervalSnapshot } from './interval-registry';
import { getCachedWorkspaceName, cacheWorkspaceName } from './workspace-cache';
import { timingStart, timingEnd, logTimingSummary } from './startup-timing';
import { nsWrite, nsReadTyped } from './api-namespace';
import { registerTokenBroadcastListener } from './token-broadcast-listener';
import { registerPageWorkspaceResponder } from './page-workspace-responder';
import { showToast, dismissAllToasts } from './toast';
import { updateStartupToast } from './startup-toast';
import { toErrorMessage , logError } from './error-utils';
import {
  resolveToken,
  refreshBearerTokenFromBestSource,
  updateAuthBadge,
  getLastTokenSource,
  setLastTokenSource,
  getBearerTokenFromCookie,
} from './auth';
import {
  IDS,
  VERSION,
  loopCreditState,
  state,
} from './shared-state';
import { fetchLoopCreditsAsync, syncCreditStateFromApi } from './credit-fetch';
import { autoDetectLoopCurrentWorkspace, extractProjectIdFromUrl } from './workspace-detection';
import { startWorkspaceObserver } from './workspace-observer';
import { updateUI } from './ui/ui-updaters';
import { MacroController } from './core/MacroController';
import { UIManager } from './core/UIManager';
import { startLoop, stopLoop } from './loop-engine';
import type { MarkViewedResponse } from './types';
import { ensureTokenReady } from './startup-token-gate';
import { setupPersistenceObserver } from './startup-persistence';
import { setupGlobalErrorHandlers, setupDiagnosticDump } from './startup-global-handlers';
import { installSpaRouteGuard } from './spa-route-guard';
import { MAX_SDK_ATTEMPTS, SDK_RETRY_DELAY_MS, MAX_UI_CREATE_RETRIES, STARTUP_WS_MAX_RETRIES } from './constants';
import { Label } from './types';
import { loadSettingsOverrides, onSettingsChange } from './settings-store';

// Re-export sub-modules for backward compatibility
export { setupPersistenceObserver as _setupPersistenceObserver } from './startup-persistence';
export { setupGlobalErrorHandlers as _setupGlobalErrorHandlers, setupDiagnosticDump as _setupDiagnosticDump } from './startup-global-handlers';

/**
 * Run the full startup sequence (V2 Phase 01 — fixed order):
 * 1. Place script marker
 * 2. Register window globals
 * 3. Resolve auth token
 * 4. Load workspaces via API
 * 5. Create UI with loaded data
 * 6. Start workspace observer
 * 7. Setup auth resync
 */
export function bootstrap(deps: {
  fetchLoopCreditsWithDetect: (isRetry?: boolean) => void;
  setLoopInterval: (ms: number) => void;
  forceSwitch: (dir: string) => void;
  runCheck: () => unknown;
  delegateComplete: () => void;
  updateProjectButtonXPath: (xpath: string) => void;
  updateProgressXPath: (xpath: string) => void;

  hasXPathUtils: boolean;
}): void {
  timingStart('bootstrap', 'Bootstrap');

  if (window.__MARCO_LAUNCH_SOURCE__ === 'passive') {
    bootstrapPassiveAttach(deps);
    return;
  }

  // Preload user settings overrides (chrome.storage.local) before any UI render
  // so the first paint of the workspace list reflects edited grace/refill values.
  // Fire-and-forget — non-blocking; resolver falls back to JSON until loaded.
  void loadSettingsOverrides().then(function () {
    // Re-render the UI when the user saves new overrides so the workspace
    // status pills pick up the new thresholds without a page reload.
    onSettingsChange(function () {
      try { updateUI(); } catch (_e: unknown) { /* UI may not be mounted yet */ } // allow-swallow: UI may not be mounted at settings-change time; non-critical cosmetic update.
    });
  });

  setupPersistenceObserver(function () {
    const mc = MacroController.getInstance();
    if (tryCreateUiNow(mc)) {
      updateUI();
    }
  });
  setupGlobalErrorHandlers();
  setupDiagnosticDump();
  // U-5: tear down loop on SPA navigation away from /projects/{id}
  installSpaRouteGuard();

  // Unified notifier: use SDK-backed toast system only (queued until SDK is ready)
  showToast('MacroLoop v' + VERSION + ' — loading workspace…', 'info', { noStop: true });

  _placeScriptMarker();
  _registerGlobals(deps);
  _logWorkspaceCacheStatus();

  // v7.41: Register proactive token broadcast listener
  registerTokenBroadcastListener();

  // Register page-side responder for background-initiated workspace probes
  // (consumed by the "Open Lovable Tabs" panel in the macro controller).
  registerPageWorkspaceResponder();

  // ── Phase 01 V2: UI creation deferred until data loaded ──
  // Set a hard 5s timeout fallback — if API hasn't resolved, create UI anyway
  const uiCreationTimeout = window.setTimeout(function () {
    if (!document.getElementById(IDS.CONTAINER)) {
      log('Startup: ⏱ 5s timeout — creating UI without workspace data (fallback)', 'warn');
      createUiAndObserver();
    }
  }, 5000);

  // Store timeout ID so loadWorkspacesOnStartup can cancel it on success
  (state as unknown as Record<string, unknown>).__uiTimeoutId = uiCreationTimeout;

  // ── Background data loading ──
  timingStart(Label.PromptPrewarm, 'Prompt Pre-warm');
  _preWarmPrompts(0);

  loadWorkspacesOnStartup();
}

/** Places the hidden script marker element on the page. */
function _placeScriptMarker(): void {
  const marker = document.createElement('div');
  marker.id = IDS.SCRIPT_MARKER;
  marker.style.display = 'none';
  marker.setAttribute('data-version', VERSION);
  marker.setAttribute('data-launch-source', window.__MARCO_LAUNCH_SOURCE__ === 'passive' ? 'passive' : 'manual');
  document.body.appendChild(marker);
}

function bootstrapPassiveAttach(deps: {
  runCheck: () => unknown;
  setLoopInterval: (ms: number) => void;
  delegateComplete: () => void;
  updateProjectButtonXPath: (xpath: string) => void;
  updateProgressXPath: (xpath: string) => void;
}): void {
  _placeScriptMarker();
  _registerGlobals(deps);
  registerPageWorkspaceResponder();
  timingEnd('bootstrap', 'ok', 'Passive attach — no visible UI');
  log('Startup: passive attach complete — visible panel waits for manual Run script', 'info');
}

/** Registers window globals + namespace dual-write (Issue 79 Phase 9A). */
function _registerGlobals(deps: {
  runCheck: () => unknown;
  setLoopInterval: (ms: number) => void;
  delegateComplete: () => void;
  updateProjectButtonXPath: (xpath: string) => void;
  updateProgressXPath: (xpath: string) => void;
}): void {
  nsWrite('api.loop.start', startLoop as (direction?: string) => boolean);
  nsWrite('api.loop.stop', stopLoop);
  nsWrite('api.loop.check', deps.runCheck);
  nsWrite('api.loop.state', function () { return state; });
  nsWrite('api.loop.setInterval', deps.setLoopInterval);
  nsWrite('api.ui.toast', showToast);
  nsWrite('api.metrics.intervals', getIntervalSnapshot);
  nsWrite('_internal.delegateComplete', deps.delegateComplete);
  nsWrite('api.config.setProjectButtonXPath', deps.updateProjectButtonXPath);
  nsWrite('api.config.setProgressXPath', deps.updateProgressXPath);
}

/** Logs workspace cache source for diagnostics. */
function _logWorkspaceCacheStatus(): void {
  const cachedName = getCachedWorkspaceName();
  const projectId = extractProjectIdFromUrl() || '(unknown)';
  if (state.workspaceFromCache && cachedName) {
    log('Startup: 📦 Workspace name loaded from cache: "' + cachedName + '" (project: ' + projectId + ')', 'info');
  } else {
    log('Startup: 🔍 No cached workspace — will resolve from API (project: ' + projectId + ')', 'info');
  }
}

/**
 * RC-04: Pre-warm prompts with SDK retry + loader fallback.
 * Tries SDK `marco.prompts.preWarm()` up to 3 times (500ms apart),
 * then falls back to direct `loadPromptsFromJson()`.
 */
function _preWarmPrompts(attempt: number): void {

  const sdk = (window as unknown as Record<string, unknown>).marco as { prompts?: { preWarm(): Promise<unknown[]> } } | undefined;

  if (sdk && sdk.prompts && typeof sdk.prompts.preWarm === 'function') {
    sdk.prompts.preWarm().then(function(prompts: unknown[]) {
      if (prompts && prompts.length > 0) {
        log('Startup: 📋 Pre-warmed ' + prompts.length + ' prompts via SDK (attempt ' + (attempt + 1) + ')', 'success');
        timingEnd(Label.PromptPrewarm, 'ok', prompts.length + ' prompts via SDK');
      } else {
        log('Startup: ⚠️ SDK prompt pre-warm returned empty — falling back to loader', 'warn');
        _preWarmViaLoader();
      }
    }).catch(function(e: unknown) {
      log('Startup: SDK prompt pre-warm failed (attempt ' + (attempt + 1) + '): ' + (e instanceof Error ? e.message : String(e)), 'warn');
      _preWarmViaLoader();
    });
    return;
  }

  // SDK not available yet — retry or fallback
  if (attempt < MAX_SDK_ATTEMPTS - 1) {
    log('Startup: SDK not available for prompt pre-warm (attempt ' + (attempt + 1) + '/' + MAX_SDK_ATTEMPTS + ') — retrying in ' + SDK_RETRY_DELAY_MS + 'ms', 'info');
    setTimeout(function() { _preWarmPrompts(attempt + 1); }, SDK_RETRY_DELAY_MS);
    return;
  }

  log('Startup: SDK unavailable after ' + MAX_SDK_ATTEMPTS + ' attempts — falling back to direct loader', 'warn');
  _preWarmViaLoader();
}

function _preWarmViaLoader(): void {
  import('./ui/prompt-loader').then(function(mod) {
    mod.loadPromptsFromJson().then(function(prompts) {
      if (prompts && prompts.length > 0) {
        log('Startup: 📋 Pre-warmed ' + prompts.length + ' prompts via loader fallback', 'success');
        timingEnd(Label.PromptPrewarm, 'ok', prompts.length + ' prompts via loader');
      } else {
        log('Startup: ⚠️ Prompt pre-warm returned empty — will use defaults on dropdown open', 'warn');
        timingEnd(Label.PromptPrewarm, 'warn', 'empty result');
      }
    });
  }).catch(function(e: unknown) {
    logError('Startup', 'Prompt pre-warm loader import failed — ' + (e instanceof Error ? e.message : String(e)));
    timingEnd(Label.PromptPrewarm, 'error', 'loader import failed');
  });
}

/**
 * Phase 01 V2: Create UI + start observer — called AFTER workspace data loaded
 * or after 5s timeout fallback.
 */
function createUiAndObserver(): void {
  timingStart('ui', 'UI Creation');

  // Read project name from DOM on first UI creation
  const domName = getProjectNameFromDom();
  if (domName) {
    log('Startup: Project name from DOM XPath: "' + domName + '"', 'info');
  }

  const mc = MacroController.getInstance();
  if (tryCreateUiNow(mc)) {
    timingEnd('ui', 'ok');
    log('Startup: ✅ UI rendered after workspace data loaded (Phase 01 V2)', 'success');
  } else {
    timingEnd('ui', 'warn', 'UI registration deferred');
    log('Startup: UIManager missing — attempting self-heal + retry', 'warn');
    scheduleUiCreationRetry(mc, 1);
  }
  startWorkspaceObserver();
}

function tryCreateUiNow(mc: MacroController): boolean {
  if (window.__MARCO_LAUNCH_SOURCE__ === 'passive') {
    log('Startup: passive injection registered globals only — panel hidden until manual Run script', 'info');
    return true;
  }

  if (!mc.hasUI) {
    ensureUiManagerRegistered(mc);
  }

  const ui = mc.ui;
  if (!ui) {
    return false;
  }

  ui.create();
  return true;
}

function ensureUiManagerRegistered(mc: MacroController): boolean {
  if (mc.hasUI) {
    return true;
  }

  const factory = nsReadTyped('_internal.createUIManager') as (() => ReturnType<typeof buildUiManagerFromFactory>) | null;
  if (factory) {
    try {
      mc.registerUI(factory());
      log('Startup: self-healed UIManager from persisted factory', 'success');
      return true;
    } catch (err) {
      log('Startup: persisted UIManager factory failed — ' + toErrorMessage(err), 'warn');
    }
  }

  const legacyCreateFn = nsReadTyped('_internal.createUIWrapper') as (() => void) | null;
  if (legacyCreateFn) {
    const uiManager = new UIManager();
    uiManager.setCreateFn(legacyCreateFn);
    mc.registerUI(uiManager);
    log('Startup: self-healed UIManager from legacy createUI wrapper', 'success');
    return true;
  }

  return false;
}

function buildUiManagerFromFactory(): UIManager {
  return new UIManager();
}

function scheduleUiCreationRetry(mc: MacroController, attempt: number): void {
  
  if (attempt > MAX_UI_CREATE_RETRIES) {
    logError('Startup', '❌ UIManager recovery exhausted after \' + MAX_UI_CREATE_RETRIES + \' attempts');
    return;
  }

  window.setTimeout(function () {
    if (document.getElementById(IDS.CONTAINER)) {
      return;
    }

    if (tryCreateUiNow(mc)) {
      log('Startup: ✅ UI created after recovery retry #' + attempt, 'success');
      return;
    }

    log('Startup: UIManager still unavailable on retry #' + attempt, 'warn');
    scheduleUiCreationRetry(mc, attempt + 1);
  }, 100);
}

// ── Workspace Loading ──

/**
 * Phase 01 V2: Cancel the UI creation timeout and create UI now.
 * Called when workspace data resolves (success or failure).
 */
function cancelTimeoutAndCreateUi(): void {
  const timeoutId = (state as unknown as Record<string, unknown>).__uiTimeoutId as number | undefined;
  if (timeoutId) {
    window.clearTimeout(timeoutId);
    (state as unknown as Record<string, unknown>).__uiTimeoutId = undefined;
  }
  if (!document.getElementById(IDS.CONTAINER)) {
    createUiAndObserver();
  }
}

function loadWorkspacesOnStartup(): void {
  log('Auto-loading workspaces on injection...', 'check');
  updateStartupToast('Resolving auth token\u2026');

  timingStart('token', 'Token Resolution');
  ensureTokenReady(2000).then(function (tokenResult) {
    const hasNoToken = !tokenResult.token;

    if (hasNoToken) {
      handleTokenFailure(tokenResult);
      return;
    }

    timingEnd('token', 'ok', tokenResult.waitedMs + 'ms via ' + getLastTokenSource());
    log('Startup self-check: ✅ Token ready after ' + tokenResult.waitedMs + 'ms (source: ' + getLastTokenSource() + ')', 'success');
    logAuthDiag();
    launchCreditAndWorkspaceLoad();
  });
}

/** Handle startup when no auth token is available. */
function handleTokenFailure(tokenResult: { waitedMs: number; reason: string }): void {
  timingEnd('token', 'error', 'No token after ' + tokenResult.waitedMs + 'ms');
  logError('Startup self-check', '❌ Token not available after ' + tokenResult.waitedMs + 'ms — ' + tokenResult.reason);
  showToast(
    '⚠️ Auth failed — no token after ' + Math.round(tokenResult.waitedMs / 1000) + 's. '
    + 'Try: 1) Re-login to lovable.dev  2) Hard refresh (Ctrl+Shift+R)  3) Click Credits to retry',
    'error',
    { noStop: true },
  );
  timingEnd('bootstrap', 'warn', 'No token');
  logTimingSummary();
  cancelTimeoutAndCreateUi();
  updateUI();
}

/** Log SDK auth diagnostic info if available. */
function logAuthDiag(): void {
  try {
    const authDiag = window.marco?.auth?.getLastAuthDiag?.();
    if (!authDiag) return;

    const bridgeTag = authDiag.bridgeOutcome === 'hit' ? '✅ bridge hit'
      : authDiag.bridgeOutcome === 'timeout' ? '⏱ bridge timeout'
      : authDiag.bridgeOutcome === 'error' ? '❌ bridge error'
      : 'bridge skipped';
    const detail = authDiag.source + ' · ' + bridgeTag + ' · ' + Math.round(authDiag.durationMs) + 'ms';
    const status = authDiag.source === 'none' ? 'error' as const
      : authDiag.bridgeOutcome === 'hit' ? 'ok' as const
      : 'warn' as const;
    timingStart('auth-source', 'Auth Source (SDK)');
    timingEnd('auth-source', status, detail);
    if (authDiag.source === 'none') {
      logError('emitAuthDiag', 'Startup: SDK auth diag — no token from any source, bridge=' + authDiag.bridgeOutcome + ', ' + Math.round(authDiag.durationMs) + 'ms');
    } else {
      log('Startup: SDK auth diag — source=' + authDiag.source + ', bridge=' + authDiag.bridgeOutcome + ', ' + Math.round(authDiag.durationMs) + 'ms', 'info');
    }
  } catch (e: unknown) {
    logError('emitAuthDiag', 'SDK auth diagnostics unavailable', e);
    // SDK not available yet — skip silently
  }
}

/** Launch parallel credit fetch + workspace prefetch after token is ready. */
function launchCreditAndWorkspaceLoad(): void {
  updateStartupToast('Loading workspaces & credits\u2026');
  timingStart('credits', 'Credit Fetch');
  const creditPromise = fetchLoopCreditsAsync(false);

  timingStart(Label.WsPrefetch, 'WS Tier1 Prefetch');
  const currentProjectId = extractProjectIdFromUrl();
  const startupToken = resolveToken();
  let tier1Data: MarkViewedResponse | null = null;

  const tier1Promise = (currentProjectId && startupToken)
    ? fetchTier1Prefetch(currentProjectId, startupToken).then(function (data) {
        tier1Data = data;
        return data;
      })
    : Promise.resolve(null).then(function () {
        timingEnd(Label.WsPrefetch, 'warn', 'No projectId or token');
        return null;
      });

  Promise.all([creditPromise, tier1Promise])
    .then(function () { handleCreditSuccess(tier1Data); })
    .catch(function (err: unknown) { handleCreditError(err); });
}

/** Handle successful credit + workspace load. */
function handleCreditSuccess(tier1Data: MarkViewedResponse | null): void {
  timingEnd('credits', 'ok');
  dismissAllToasts();
  log('Startup: Credits loaded — resolving workspace...', 'success');
  timingStart('workspace', 'Workspace Detection');

  const isResolved = tier1Data !== null && resolveTier1Workspace(tier1Data);
  if (isResolved) return;

  log('Startup: Tier 1 prefetch did not resolve workspace — falling back to autoDetect', 'info');
  const freshToken = resolveToken();
  autoDetectLoopCurrentWorkspace(freshToken, { skipDialog: true }).then(function () {
    const shouldRetryWorkspace = state.running;
    timingEnd(
      'workspace',
      state.workspaceName ? 'ok' : (shouldRetryWorkspace ? 'warn' : 'ok'),
      state.workspaceName || (shouldRetryWorkspace ? 'No name detected' : 'Passive mode — unresolved until manual Check or loop start'),
    );
    syncCreditStateFromApi();
    cancelTimeoutAndCreateUi();
    updateUI();
    timingEnd('bootstrap', 'ok');
    logTimingSummary();

    if (!state.workspaceName) {
      if (shouldRetryWorkspace) {
        log('Startup: ⚠️ Workspace name still empty after initial detection while running — scheduling retry', 'warn');
        scheduleWorkspaceRetry(1);
      } else {
        log('Startup: Passive startup left workspace unresolved by design — waiting for manual Check or loop start', 'info');
      }
    }
  });
}

/** Handle credit/workspace load failure. */
function handleCreditError(err: unknown): void {
  const errMsg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : String(err);
  const axiosStatus = err && typeof err === 'object' && 'response' in err ? (err as { response?: { status?: number; statusText?: string; data?: unknown } }).response : null;
  const statusDetail = axiosStatus ? ' [HTTP ' + (axiosStatus.status || '?') + ' ' + (axiosStatus.statusText || '') + ']' : '';
  const responseBody = axiosStatus?.data ? ' body=' + (typeof axiosStatus.data === 'string' ? axiosStatus.data.substring(0, 200) : JSON.stringify(axiosStatus.data).substring(0, 200)) : '';
  const fullDetail = errMsg + statusDetail + responseBody;

  timingEnd('credits', 'error', fullDetail);
  timingEnd('bootstrap', 'error', 'Credit fetch failed: ' + fullDetail);
  logTimingSummary();
  logError('Startup', '❌ Credit/workspace load failed: ' + fullDetail);
  if (axiosStatus) {
    log('Startup: HTTP ' + (axiosStatus.status || '?') + ' — check token validity, re-login, or hard refresh', 'warn');
  }
  const stack = err && typeof err === 'object' && 'stack' in err ? (err as Error).stack : null;
  if (stack) {
    log('Startup: Stack: ' + stack.split('\n').slice(0, 3).join(' → '), 'warn');
  }
  showToast('Could not load workspaces — ' + (statusDetail || errMsg) + ' — click Credits to retry', 'warn', { noStop: true });
  cancelTimeoutAndCreateUi();
  updateUI();
  scheduleWorkspaceRetry(1);
}

function fetchTier1Prefetch(projectId: string, _token: string): Promise<MarkViewedResponse | null> {
  try {
    const workspaceApi = window.marco?.api?.workspace;
    if (!workspaceApi || typeof workspaceApi.markViewed !== 'function') {
      log('Startup: Tier 1 prefetch skipped — marco-sdk workspace API unavailable', 'warn');
      timingEnd(Label.WsPrefetch, 'warn', 'SDK workspace API unavailable');
      return Promise.resolve(null);
    }
    return workspaceApi.markViewed(projectId)
      .then(handleTier1Response)
      .catch(handleTier1Error);
  } catch (err: unknown) {
    log('Startup: Tier 1 prefetch error: ' + toErrorMessage(err), 'warn');
    timingEnd(Label.WsPrefetch, 'warn', toErrorMessage(err));
    return Promise.resolve(null);
  }
}

function handleTier1Response(resp: { ok: boolean; status?: number; data?: unknown }): MarkViewedResponse | null {
  if (!resp.ok) {
    log('Startup: Tier 1 prefetch HTTP ' + resp.status, 'warn');
    timingEnd(Label.WsPrefetch, 'warn', 'HTTP ' + resp.status);
    return null;
  }
  timingEnd(Label.WsPrefetch, 'ok');
  return (resp.data ?? null) as MarkViewedResponse | null;
}

function handleTier1Error(err: unknown): null {
  log('Startup: Tier 1 prefetch error: ' + toErrorMessage(err), 'warn');
  timingEnd(Label.WsPrefetch, 'warn', toErrorMessage(err));
  return null;
}

function resolveTier1Workspace(tier1Data: MarkViewedResponse): boolean {
  const wsId = tier1Data.workspace_id
    || (tier1Data.project && tier1Data.project.workspace_id)
    || tier1Data.workspaceId || '';

  // Extract project name from mark-viewed response
  const apiProjectName = (tier1Data.project && (tier1Data.project.name || tier1Data.project.title))
    || (tier1Data.name as string) || (tier1Data.title as string) || '';
  if (apiProjectName && !state.projectNameFromApi) {
    state.projectNameFromApi = apiProjectName;
    log('Startup: 📁 Project name from Tier 1 prefetch: "' + apiProjectName + '"', 'success');
  }

  const hasNoWsId = !wsId;
  if (hasNoWsId) return false;

  const wsById = loopCreditState.wsById || {};
  const perWs = loopCreditState.perWorkspace || [];
  let matched = wsById[wsId];

  if (!matched) {
    for (const ws of perWs) {
      const isMatch = ws.id === wsId;

      if (isMatch) {
        matched = ws;
        break;
      }
    }
  }

  const hasNoMatch = !matched;
  if (hasNoMatch) return false;

  state.workspaceName = matched!.fullName || matched!.name;
  state.workspaceFromApi = true;
  loopCreditState.currentWs = matched!;
  timingEnd('workspace', 'ok', 'Tier 1 prefetch: ' + state.workspaceName);
  log('Startup: ✅ Workspace resolved from prefetched Tier 1: "' + state.workspaceName + '"', 'success');
  syncCreditStateFromApi();
  // Phase 01 V2: Create UI after Tier 1 workspace resolution
  cancelTimeoutAndCreateUi();
  updateUI();
  timingEnd('bootstrap', 'ok');
  logTimingSummary();
  return true;
}

// ── Workspace Retry ──

// Retry policy: first retry forces cookie refresh, second retry is the final pass.

 
function scheduleWorkspaceRetry(attempt: number): void {
  const isExhausted = attempt > STARTUP_WS_MAX_RETRIES;
  if (isExhausted) {
    log(
      'standalone-scripts/macro-controller/src/startup.ts scheduleWorkspaceRetry: workspace unresolved after '
      + STARTUP_WS_MAX_RETRIES
      + ' retries; projectId=' + (extractProjectIdFromUrl() || 'missing')
      + '; tokenSource=' + (getLastTokenSource() || 'none')
      + '; loadedWorkspaces=' + ((loopCreditState.perWorkspace || []).length)
      + '; reason=Tier 1 mark-viewed + passive fallback did not identify the current workspace',
      'error',
    );
    return;
  }

  const delayMs = attempt * 2000;
  log('Startup: Scheduling workspace retry #' + attempt + '/' + STARTUP_WS_MAX_RETRIES + ' in ' + delayMs + 'ms', 'check');

  setTimeout(function () {
    const isAlreadyResolved = !!state.workspaceName && !state.workspaceFromCache;
    if (isAlreadyResolved) {
      log('Startup: Workspace already resolved ("' + state.workspaceName + '") — skipping retry #' + attempt, 'success');
      return;
    }

    let retryToken = '';

    if (attempt === 1) {
      log(Label.StartupRetry + attempt + ' — forcing cookie read before retry', 'check');
      retryToken = getBearerTokenFromCookie();
      if (retryToken) {
        log(Label.StartupRetry + attempt + ' — cookie token resolved, using refreshed token for retry', 'success');
      } else {
        log(Label.StartupRetry + attempt + ' — cookie read returned no token, falling back to current resolver', 'warn');
      }
    }

    if (!retryToken) {
      retryToken = resolveToken();
    }

    if (!retryToken) {
      log(Label.StartupRetry + attempt + ' — no token available after cookie fallback, moving to next retry', 'warn');
      scheduleWorkspaceRetry(attempt + 1);
      return;
    }

    log(Label.StartupRetry + attempt + '/' + STARTUP_WS_MAX_RETRIES + ' — re-fetching credits + workspace detection...', 'check');
    state.workspaceFromApi = false;

    fetchLoopCreditsAsync(false).then(function () {
      return autoDetectLoopCurrentWorkspace(retryToken, { skipDialog: true });
    }).then(function () {
      syncCreditStateFromApi();
      updateUI();
      if (state.workspaceName) {
        log('Startup: ✅ Retry #' + attempt + ' succeeded — workspace: "' + state.workspaceName + '"', 'success');
        cacheWorkspaceName(state.workspaceName, loopCreditState.currentWs ? loopCreditState.currentWs.id : undefined);
      } else {
        log(Label.StartupRetry + attempt + ' — workspace still empty, scheduling next retry', 'warn');
        scheduleWorkspaceRetry(attempt + 1);
      }
    }).catch(function (err: unknown) {
      log(Label.StartupRetry + attempt + ' failed: ' + toErrorMessage(err) + ' — scheduling next retry', 'warn');
      scheduleWorkspaceRetry(attempt + 1);
    });
  }, delayMs);
}

// ── Auth Auto-Resync (CQ11: singleton) ──

class AuthResyncState {
  private _inFlight = false;

  get inFlight(): boolean {
    return this._inFlight;
  }

  set inFlight(v: boolean) {
    this._inFlight = v;
  }
}

const authResyncState = new AuthResyncState();

function setupAuthResync(): void {
  document.addEventListener('visibilitychange', function () {
    const isVisible = document.visibilityState === 'visible';
    if (isVisible) {
      tryAutoAuthResync('visibilitychange');
    }
  });

  window.addEventListener('focus', function () {
    tryAutoAuthResync('window-focus');
  });
}

function tryAutoAuthResync(trigger: string): void {
  if (authResyncState.inFlight) return;
  authResyncState.inFlight = true;

  log(Label.AuthAutoResync + trigger + '): checking bridge for restored session...', 'check');

  refreshBearerTokenFromBestSource(function (token: string, source: string) {
    authResyncState.inFlight = false;
    const hasNoToken = !token;

    if (hasNoToken) {
      log(Label.AuthAutoResync + trigger + '): no token yet (user may still be logged out)', 'warn');
      updateAuthBadge(false, 'none');
      return;
    }

    setLastTokenSource(source || getLastTokenSource() || 'bridge');
    updateAuthBadge(true, getLastTokenSource());
    log(Label.AuthAutoResync + trigger + '): ✅ token restored from ' + getLastTokenSource(), 'success');

    if (state.running) return;

    fetchLoopCreditsAsync(false)
      .then(function () {
        return autoDetectLoopCurrentWorkspace(token, { skipDialog: true });
      })
      .then(function () {
        syncCreditStateFromApi();
        updateUI();
        log(Label.AuthAutoResync + trigger + '): workspace/credit UI refreshed', 'success');
      })
      .catch(function (err: Error) {
        log(Label.AuthAutoResync + trigger + '): UI refresh failed: ' + (err && err.message ? err.message : String(err)), 'warn');
      });
  });
}

// Setup auth resync listeners at module load
setupAuthResync();
