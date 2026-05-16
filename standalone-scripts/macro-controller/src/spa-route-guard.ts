/**
 * MacroLoop Controller — SPA Route Guard (U-5, v2.245.0)
 *
 * Bridges the gap left by the background-side URL trigger gate
 * (`src/background/url-trigger.ts`): even when the background
 * correctly evaluates "you are no longer on a /projects/{id} URL",
 * the macro controller already injected into the page keeps holding
 * a stale `state.projectId` until the next full page load.
 *
 * Approach (per audit U-5):
 *   1. Capture the project id at install time.
 *   2. Monkey-patch `history.pushState` / `history.replaceState` and
 *      add a `popstate` listener so every SPA route change calls
 *      `evaluateRouteChange()`.
 *   3. If the project id changed (or disappeared entirely),
 *      `stopLoop()` and surface a single toast.
 *   4. Provide a `teardown()` returned for the `pagehide` listener so
 *      we leave no dangling patches behind. Monkey-patches are
 *      reverted to the originals captured here.
 *
 * Hard rules (mirror background gate):
 *   - No `setInterval`. Event-driven only.
 *   - Never throw from inside the patched method — would break SPA.
 *   - Idempotent: installing twice is a no-op (guarded by
 *     `window.__marcoRouteGuardInstalled`).
 *   - No retry/backoff.
 */

import { log } from './logging';
import { logError } from './error-utils';
import { extractProjectIdFromUrl } from './workspace-detection';
import { state } from './shared-state';
import { stopLoop } from './loop-engine';
import { showToast } from './toast';

declare global {
  interface Window {
    __marcoRouteGuardInstalled?: boolean;
  }
}

type HistoryFn = typeof history.pushState;

/** Per-page-lifetime tracker. Reset on each install. */
let lastProjectId: string | null = null;

/**
 * Installs SPA route monitoring. Returns a teardown function that
 * removes listeners and restores the original `history` methods.
 * Calling twice is safe — returns a no-op teardown after the first
 * call.
 */
export function installSpaRouteGuard(): () => void {
  const alreadyInstalled = window.__marcoRouteGuardInstalled === true;
  if (alreadyInstalled) {
    return noopTeardown;
  }
  window.__marcoRouteGuardInstalled = true;

  lastProjectId = extractProjectIdFromUrl();

  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  history.pushState = makePatched(originalPush);
  history.replaceState = makePatched(originalReplace);

  window.addEventListener('popstate', onPopState);
  window.addEventListener('pagehide', onPageHide);

  log('[SpaRouteGuard] installed; initial projectId=' + (lastProjectId ?? '(none)'), 'check');

  return function teardown(): void {
    try {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', onPageHide);
      window.__marcoRouteGuardInstalled = false;
      log('[SpaRouteGuard] torn down', 'check');
    } catch (caught: unknown) {
      logError('SpaRouteGuard.teardown', String(caught));
    }
  };
}

/** Wraps a `history.{push,replace}State` call to invoke our route check after. */
function makePatched(original: HistoryFn): HistoryFn {
  return function patched(this: History, ...args: Parameters<HistoryFn>): void {
    const result = original.apply(this, args);
    // Never throw — would break the page's own routing.
    try {
      evaluateRouteChange('history');
    } catch (caught: unknown) {
      logError('SpaRouteGuard.patched', String(caught));
    }
    return result;
  } as HistoryFn;
}

function onPopState(): void {
  try {
    evaluateRouteChange('popstate');
  } catch (caught: unknown) {
    logError('SpaRouteGuard.popstate', String(caught));
  }
}

function onPageHide(): void {
  // Browser is unloading or BFCache-suspending the page. Stop any
  // running loop so we don't get a zombie heartbeat after restore.
  try {
    if (state.running) {
      stopLoop();
    }
  } catch (caught: unknown) {
    logError('SpaRouteGuard.pagehide', String(caught));
  }
}

/**
 * Compares the current projectId against the last-seen one. On change
 * (including to/from null), stop the loop and notify once.
 */
function evaluateRouteChange(source: 'history' | 'popstate'): void {
  const currentProjectId = extractProjectIdFromUrl();
  const isSame = currentProjectId === lastProjectId;
  if (isSame) {
    return;
  }

  const previous = lastProjectId;
  lastProjectId = currentProjectId;

  const leftProject = previous !== null && currentProjectId === null;
  const switchedProject = previous !== null && currentProjectId !== null && previous !== currentProjectId;

  if (leftProject || switchedProject) {
    if (state.running) {
      stopLoop();
    }
    const label = leftProject ? 'left project' : 'switched project';
    log('[SpaRouteGuard] ' + label + ' via ' + source + ' (was=' + previous + ', now=' + (currentProjectId ?? '(none)') + ') — loop stopped', 'warn');
    try {
      showToast('Project route changed — loop stopped', 'info', { noStop: true });
    } catch (_e: unknown) {
      // Toast UI may not be mounted yet — non-fatal.
    }
  }
}

function noopTeardown(): void {
  // No-op: route guard was already installed by an earlier call.
}
