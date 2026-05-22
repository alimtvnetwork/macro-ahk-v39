/**
 * Bulk Remix Next — v2.219.0
 *
 * Iterates the checked workspace rows in the controller and runs "Remix Next"
 * sequentially against each one. For every checked workspace we:
 *   1. Fetch `projects.list(wsId)` to discover the workspace's projects.
 *   2. Pick the "current" project — defined as the first entry returned by the
 *      list endpoint (servers typically order by recency / updated_at). If a
 *      project name matches the source project's base (current page), that
 *      match wins instead so families stay aligned.
 *   3. Resolve the next V-suffix name via `resolveNextName()`.
 *   4. Submit remix via `submitRemix()`.
 *   5. Record into `recordRemix()` history with mode='next'.
 *
 * Per `mem://constraints/no-retry-policy` — single attempt per workspace; the
 * loop continues on failure but a final toast summarises success/failure
 * counts. No redirects are opened (the user explicitly triggered N remixes —
 * opening N tabs would be disruptive); the user can open them from history.
 *
 * Resolves Q51 with Option A: "iterate checked workspace rows".
 */

import { getLoopWsCheckedIds, loopCreditState } from './shared-state';
import { getRemixConfig } from './remix-config';
import { fetchWorkspaceProjectNames, submitRemix } from './remix-fetch';
import { resolveNextName } from './remix-name-resolver';
import { recordRemix } from './remix-history';
import { showToast } from './toast';
import { logError } from './error-utils';
import { log } from './logging';
import { CREDIT_API_BASE } from './shared-state';

interface ProjectEntry { id: string; name: string }

/** Confirm before bulk-remixing this many or more workspaces. */
const BULK_CONFIRM_THRESHOLD = 4;

async function fetchProjects(wsId: string): Promise<ProjectEntry[]> {
  const sdk = window.marco;
  if (!sdk || !sdk.api || !sdk.api.projects || typeof sdk.api.projects.list !== 'function') {
    throw new Error('marco.api.projects.list unavailable — SDK out of date');
  }
  const resp = await sdk.api.projects.list(wsId, { baseUrl: CREDIT_API_BASE });
  if (!resp.ok) {
    throw new Error('HTTP ' + resp.status);
  }
  const data = resp.data as { projects?: Array<{ id?: string; name?: string }> };
  const list = Array.isArray(data.projects) ? data.projects : [];
  const out: ProjectEntry[] = [];
  for (const p of list) {
    const id = typeof p.id === 'string' ? p.id : '';
    const name = typeof p.name === 'string' ? p.name : '';
    if (id) out.push({ id, name: name || id });
  }
  return out;
}

/** Strip a trailing `V<digits>` (any separator) to get a project family base. */
function baseFamily(name: string): string {
  return name.replace(/[\s._-]*v\d+\s*$/i, '').trim().toLowerCase();
}

function pickTargetProject(projects: ReadonlyArray<ProjectEntry>, sourceBase: string): ProjectEntry | null {
  if (projects.length === 0) return null;
  if (sourceBase) {
    for (const p of projects) {
      if (baseFamily(p.name) === sourceBase) return p;
    }
  }
  return projects[0];
}

export interface BulkRemixSourceHint {
  /** Optional source project name (current page) used to align families. */
  sourceProjectName?: string;
}

/**
 * Run Remix Next against every currently checked workspace, sequentially.
 * Surfaces progress and a final summary via toast.
 */
// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
export async function actionBulkRemixNext(hint: BulkRemixSourceHint = {}): Promise<void> {
  const checked = Object.keys(getLoopWsCheckedIds());
  if (checked.length === 0) {
    showToast('Bulk Remix Next — no workspaces checked', 'warn');
    return;
  }

  // Accidental-fire safeguard: confirm when remixing 4+ workspaces.
  if (checked.length >= BULK_CONFIRM_THRESHOLD) {
    const ok = window.confirm(
      'Bulk Remix Next will remix the most recent project in '
      + checked.length + ' checked workspaces.\n\nProceed?',
    );
    if (!ok) {
      showToast('Bulk Remix Next — cancelled', 'info');
      return;
    }
  }

  const perWs = loopCreditState.perWorkspace || [];
  const wsById = new Map<string, { id: string; name: string }>();
  for (const ws of perWs) {
    if (ws && ws.id) wsById.set(ws.id, { id: ws.id, name: ws.fullName || ws.name || ws.id });
  }

  const cfg = getRemixConfig();
  const sourceBase = baseFamily(hint.sourceProjectName || '');

  showToast('🚀 Bulk Remix Next — ' + checked.length + ' workspace' + (checked.length === 1 ? '' : 's') + '…', 'info');

  let success = 0;
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < checked.length; i++) {
    const wsId = checked[i];
    const wsLabel = wsById.get(wsId)?.name || wsId;
    const progress = '[' + (i + 1) + '/' + checked.length + ']';
    showToast('🔀 ' + progress + ' ' + wsLabel + '…', 'info');
    try {
      const projects = await fetchProjects(wsId);
      const target = pickTargetProject(projects, sourceBase);
      if (!target) {
        throw new Error('no projects in workspace');
      }
      const existing = await fetchWorkspaceProjectNames(wsId);
      const { name } = resolveNextName(target.name, existing, {
        nextSuffixSeparator: cfg.nextSuffixSeparator,
        maxCollisionIncrements: cfg.maxCollisionIncrements,
        nextVCasing: cfg.nextVCasing,
      });
      log('[BulkRemixNext] ' + wsLabel + ': "' + target.name + '" → "' + name + '"', 'info');
      await submitRemix({
        projectId: target.id,
        workspaceId: wsId,
        projectName: name,
        includeHistory: cfg.defaultIncludeHistory,
        includeCustomKnowledge: cfg.defaultIncludeCustomKnowledge,
      });
      recordRemix({
        timestamp: Date.now(),
        source: target.name,
        destination: name,
        workspaceId: wsId,
        mode: 'next',
      });
      success++;
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(wsLabel + ': ' + msg);
      logError('BulkRemixNext', wsLabel + ' failed: ' + msg);
    }
  }

  const tone = failed === 0 ? 'success' : (success === 0 ? 'error' : 'warn');
  const icon = failed === 0 ? '✅' : (success === 0 ? '❌' : '⚠');
  let summary = icon + ' Bulk Remix Next — ' + success + '/' + checked.length + ' succeeded';
  if (failed > 0) summary += ' · ' + failed + ' failed';
  showToast(summary, tone);
  if (failures.length > 0) {
    log('[BulkRemixNext] failures:\n  - ' + failures.join('\n  - '), 'warn');
  }
}
