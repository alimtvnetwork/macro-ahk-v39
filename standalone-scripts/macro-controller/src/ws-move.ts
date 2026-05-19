/**
 * Workspace Move — API-based project move and session verification.
 *
 * Extracted from workspace-management.ts (module splitting).
 * Contains: moveToWorkspace, updateLoopMoveStatus, verifyWorkspaceSessionAfterFailure.
 *
 * v1.74.1: Clear cached workspace ID after successful move so credit-balance
 *          API checks the new workspace on next cycle (fixes stale-workspace bug).
 * v7.40: Migrated from raw fetch() to httpRequest() (XMLHttpRequest + Promise).
 * v7.50: Migrated to marco.api centralized SDK (Axios + registry).
 *
 * @see memory/architecture/networking/centralized-api-registry
 */

import { MacroController } from './core/MacroController';
import { log, logSub } from './logging';
import { resolveToken, invalidateSessionBridgeKey, recoverAuthOnce } from './auth';
import { extractProjectIdFromUrl } from './workspace-detection';
import { showToast } from './toast';
import { CREDIT_API_BASE, state } from './shared-state';
import { clearResolvedWorkspace } from './credit-balance';
import { logError } from './error-utils';

import { Label } from './types';

function mc() { return MacroController.getInstance(); }

// ============================================
// Helper — auth failure check
// ============================================

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

// ============================================
// Delegation state reset helper
// ============================================

function clearDelegationState(): void {
  state.isDelegating = false;
  state.forceDirection = null;
  state.delegateStartTime = 0;
}

// ============================================
// updateLoopMoveStatus — Update the move status indicator element
// ============================================

export function updateLoopMoveStatus(statusState: string, message: string): void {
  const el = document.getElementById('loop-move-status');

  if (!el) {
    return;
  }

  const colors: Record<string, string> = { loading: '#facc15', success: '#4ade80', error: '#ef4444' };
  el.style.color = colors[statusState] || '#9ca3af';
  el.textContent = message;

  if (statusState === 'success') {
    setTimeout(function () { el.textContent = ''; }, 5000);
  }
}

// ============================================
// Session probe — verifies workspace session health via SDK
// ============================================

async function probeSessionWithToken(context: string, token: string): Promise<void> {
  const authLabel = 'Bearer ' + token.substring(0, 12) + '...REDACTED';

  log(Label.LogSessionCheck + context + '] Probing workspace session (auth: ' + authLabel + ')', 'info');

  try {
    const resp = await window.marco!.api!.workspace.probe({ baseUrl: CREDIT_API_BASE });

    if (!resp.ok) {
      logError('unknown', Label.LogSessionCheck + context + '] ❌ Session probe failed: HTTP ' + resp.status + ' (auth: ' + authLabel + ')');
      showToast(context + ' failed — session also broken (HTTP ' + resp.status + '). Re-auth needed.', 'error');

      return;
    }

    const data = resp.data;
    const wsCount = Array.isArray(data)
      ? data.length
      : (data && typeof data === 'object' && 'workspaces' in (data as Record<string, unknown>) && Array.isArray((data as Record<string, unknown>).workspaces)
        ? ((data as Record<string, unknown[]>).workspaces).length
        : '?');

    log(Label.LogSessionCheck + context + '] ✅ Session valid — ' + wsCount + ' workspaces loaded (auth: ' + authLabel + ')', 'success');
    showToast(context + ' failed but session is valid (' + wsCount + ' workspaces)', 'info');
  } catch (err) {
    logError('unknown', Label.LogSessionCheck + context + '] ❌ Network error: ' + (err as Error).message);
    showToast(context + ' failed — network error on session check', 'error');
  }
}

// ============================================
// verifyWorkspaceSessionAfterFailure — public entry point
// ============================================

export async function verifyWorkspaceSessionAfterFailure(context: string): Promise<void> {
  const token = resolveToken();

  if (token) {
    await probeSessionWithToken(context, token);

    return;
  }

  log(Label.LogSessionCheck + context + '] No bearer token — recovering before probe', 'warn');

  try {
    const recoveredToken = await recoverAuthOnce();
    const fallbackToken = recoveredToken || resolveToken();

    if (!fallbackToken) {
      logError('unknown', Label.LogSessionCheck + context + '] Recovery failed — skipping unauthenticated session probe');
      showToast(context + ' failed — no bearer token available for session check', 'error', { noStop: true });

      return;
    }

    await probeSessionWithToken(context, fallbackToken);
  } catch {
    logError('unknown', Label.LogSessionCheck + context + '] Recovery error — skipping unauthenticated session probe');
    showToast(context + ' failed — no bearer token available for session check', 'error', { noStop: true });
  }
}

// ============================================
// confirmMove — UI confirmation dialog
// ============================================

function confirmMove(targetWorkspaceName: string): Promise<boolean> {
  if (state.running) {
    return Promise.resolve(true);
  }

  return new Promise(function (resolve) {
    const overlay = document.createElement('div');
    overlay.id = 'marco-move-confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e1e2e;border:1px solid #444;border-radius:10px;padding:20px 24px;max-width:380px;width:90%;color:#e0e0e0;font-family:system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.5);';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:8px;color:#facc15;';
    title.textContent = '⚠️ Confirm Workspace Move';

    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:13px;line-height:1.5;margin-bottom:16px;color:#ccc;';
    msg.textContent = 'Move this project to "' + targetWorkspaceName + '"? This cannot be undone from here.';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:6px 16px;border-radius:6px;border:1px solid #555;background:#2a2a3a;color:#ccc;cursor:pointer;font-size:13px;';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Move';
    confirmBtn.style.cssText = 'padding:6px 16px;border-radius:6px;border:none;background:#facc15;color:#1e1e2e;cursor:pointer;font-weight:600;font-size:13px;';

    const cleanup = function(result: boolean): void {
      overlay.remove();
      resolve(result);
    };

    cancelBtn.onclick = function () { cleanup(false); };
    confirmBtn.onclick = function () { cleanup(true); };
    overlay.onclick = function (e: Event) { if (e.target === overlay) { cleanup(false); } };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(title);
    dialog.appendChild(msg);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    confirmBtn.focus();
  });
}

// ============================================
// Move token failure handler
// ============================================

function handleMoveNoToken(): void {
  logError('Move aborted', 'no bearer token available');
  updateLoopMoveStatus('error', 'Auth token missing');
  showToast('Cannot move workspace: bearer token is missing. Please re-authenticate.', 'error', { noStop: true });
}

// ============================================
// handleMoveSuccess — post-move state updates
// ============================================

function handleMoveSuccess(targetWorkspaceName: string, label: string): void {
  log('✅ MOVE SUCCESS -> ' + targetWorkspaceName + label, 'success');
  updateLoopMoveStatus('success', 'Moved to ' + targetWorkspaceName);

  const previousWorkspace = state.workspaceName || '(unknown)';
  mc().workspaces.addChangeEntry(previousWorkspace, targetWorkspaceName);

  state.workspaceName = targetWorkspaceName;
  state.workspaceFromApi = true;

  clearResolvedWorkspace();
  log('Updated state.workspaceName to: "' + targetWorkspaceName + '" (cleared cached workspace ID)', 'success');

  mc().ui?.populateDropdown();
  mc().updateUI();
  clearDelegationState();

  setTimeout(function () {
    mc().credits.fetch(false);
  }, 2000);
}

// ============================================
// handleMoveAuthFailure — auth recovery for move request
// ============================================

async function handleMoveAuthFailure(
  projectId: string,
  targetWorkspaceId: string,
  targetWorkspaceName: string,
  token: string,
  status: number,
): Promise<void> {
  const invalidatedKey = invalidateSessionBridgeKey(token);
  log('Move got ' + status + ' — invalidated "' + invalidatedKey + '", retrying with fallback', 'warn');
  showToast('Move auth ' + status + ' — token "' + invalidatedKey + '" expired, retrying...', 'warn', { noStop: true });

  const fallbackToken = resolveToken();

  if (fallbackToken) {
    await executeMove(projectId, targetWorkspaceId, targetWorkspaceName, true);

    return;
  }

  try {
    const recoveredToken = await recoverAuthOnce();
    const refreshedToken = recoveredToken || resolveToken();

    if (!refreshedToken) {
      handleMoveNoToken();

      return;
    }

    await executeMove(projectId, targetWorkspaceId, targetWorkspaceName, true);
  } catch {
    handleMoveNoToken();
  }
}

// ============================================
// executeMove — core PUT request via SDK
// ============================================

async function executeMove(
  projectId: string,
  targetWorkspaceId: string,
  targetWorkspaceName: string,
  isRetry: boolean,
): Promise<void> {
  const token = resolveToken();

  if (!token) {
    handleMoveNoToken();

    return;
  }

  const label = isRetry ? ' (auth-retry)' : '';
  log('=== MOVE TO WORKSPACE ===' + label, 'delegate');
  log('PUT /projects/' + projectId + '/move-to-workspace', 'delegate');
  logSub('Target: ' + targetWorkspaceName + ' (id=' + targetWorkspaceId + ')', 1);
  logSub('Auth: Bearer ' + token.substring(0, 12) + '...REDACTED', 1);

  updateLoopMoveStatus('loading', 'Moving to ' + targetWorkspaceName + '...');

  try {
    const resp = await window.marco!.api!.workspace.move(projectId, targetWorkspaceId, { baseUrl: CREDIT_API_BASE });

    if (isAuthFailure(resp.status) && !isRetry) {
      await handleMoveAuthFailure(projectId, targetWorkspaceId, targetWorkspaceName, token, resp.status);

      return;
    }

    if (resp.ok) {
      log('Move response: ' + resp.status + label, 'success');
    } else {
      logError('ws-move', 'Move response: ' + resp.status + label);
    }

    if (!resp.ok) {
      const bodyPreview = JSON.stringify(resp.data).substring(0, 500);
      logError('Move failed', 'HTTP ' + resp.status + ' | body: ' + bodyPreview);
      updateLoopMoveStatus('error', 'HTTP ' + resp.status + ': ' + bodyPreview.substring(0, 80));
      log('Move failed — verifying workspace session is still valid...', 'warn');
      verifyWorkspaceSessionAfterFailure('move');

      return;
    }

    handleMoveSuccess(targetWorkspaceName, label);
  } catch (err) {
    logError('Move error', '' + (err as Error).message);
    updateLoopMoveStatus('error', (err as Error).message);
    clearDelegationState();
    verifyWorkspaceSessionAfterFailure('move');
  }
}

// ============================================
// executeSwitchContext — fallback GET request when no project ID
// ============================================

 
async function executeSwitchContext(
  targetWorkspaceId: string,
  targetWorkspaceName: string,
  isRetry: boolean,
): Promise<void> {
  const token = resolveToken();

  if (!token) {
    handleMoveNoToken();

    return;
  }

  const label = isRetry ? ' (auth-retry)' : '';
  log('=== SWITCH WORKSPACE CONTEXT ===' + label, 'delegate');
  log('GET /workspaces/' + targetWorkspaceId + '/workspace-access-requests', 'delegate');
  logSub('Target: ' + targetWorkspaceName + ' (id=' + targetWorkspaceId + ')', 1);
  logSub('Auth: Bearer ' + token.substring(0, 12) + '...REDACTED', 1);

  updateLoopMoveStatus('loading', 'Switching to ' + targetWorkspaceName + '...');

  try {
    const resp = await window.marco!.api!.workspace.switchContext(
      targetWorkspaceId,
      { baseUrl: CREDIT_API_BASE },
    );

    if (isAuthFailure(resp.status) && !isRetry) {
      const invalidatedKey = invalidateSessionBridgeKey(token);
      log('Switch got ' + resp.status + ' — invalidated "' + invalidatedKey + '", retrying with fallback', 'warn');
      showToast('Switch auth ' + resp.status + ' — token "' + invalidatedKey + '" expired, retrying...', 'warn', { noStop: true });

      const fallbackToken = resolveToken();

      if (fallbackToken) {
        await executeSwitchContext(targetWorkspaceId, targetWorkspaceName, true);

        return;
      }

      try {
        const recoveredToken = await recoverAuthOnce();
        const refreshedToken = recoveredToken || resolveToken();

        if (refreshedToken) {
          await executeSwitchContext(targetWorkspaceId, targetWorkspaceName, true);

          return;
        }
      } catch {
        // fall through to handleMoveNoToken // allow-swallow: Auth recovery failure is intentionally handled by the no-token fallback path below.
      }

      handleMoveNoToken();

      return;
    }

    if (resp.ok) {
      log('Switch context response: ' + resp.status + label, 'success');
    } else {
      logError('ws-move', 'Switch context response: ' + resp.status + label);
    }

    if (!resp.ok) {
      const bodyPreview = JSON.stringify(resp.data).substring(0, 500);
      logError('Switch context failed', 'HTTP ' + resp.status + ' | body: ' + bodyPreview);
      updateLoopMoveStatus('error', 'HTTP ' + resp.status + ': ' + bodyPreview.substring(0, 80));

      return;
    }

    handleMoveSuccess(targetWorkspaceName, label);
  } catch (err) {
    logError('Switch context error', '' + (err as Error).message);
    updateLoopMoveStatus('error', (err as Error).message);
    clearDelegationState();
  }
}

// ============================================
// moveToWorkspace — public entry point
// ============================================

export async function moveToWorkspace(targetWorkspaceId: string, targetWorkspaceName: string): Promise<void> {
  const isConfirmed = await confirmMove(targetWorkspaceName);

  if (!isConfirmed) {
    log('Move cancelled by user', 'info');
    updateLoopMoveStatus('error', 'Move cancelled');

    return;
  }

  let token = resolveToken();

  if (!token) {
    log('No bearer token — recovering before move request', 'warn');

    try {
      const recoveredToken = await recoverAuthOnce();
      token = recoveredToken || resolveToken();
    } catch {
      handleMoveNoToken();

      return;
    }

    if (!token) {
      handleMoveNoToken();

      return;
    }
  }

  const projectId = extractProjectIdFromUrl();

  if (projectId) {
    // ✅ Primary path: move project to target workspace
    await executeMove(projectId, targetWorkspaceId, targetWorkspaceName, false);
  } else {
    // ✅ Fallback path: switch workspace context without moving a project
    log('No project ID in URL — using workspace-access-requests fallback', 'warn');
    await executeSwitchContext(targetWorkspaceId, targetWorkspaceName, false);
  }
}
