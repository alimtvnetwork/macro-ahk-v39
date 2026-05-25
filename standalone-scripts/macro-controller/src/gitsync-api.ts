/**
 * MacroLoop Controller — Gitsync API client (v3.10.0)
 *
 * Spec: spec/22-app-issues/workspace-github-open/01-overview.md
 * Sample: spec/22-app-issues/workspace-github-open/02-api-sample.md
 *
 * Single-attempt fetch of `/workspaces/{wsId}/projects/{pid}/gitsync`.
 * No retries, no backoff (`mem://constraints/no-retry-policy`). Auth via
 * `getBearerToken()` (`mem://auth/unified-auth-contract`).
 *
 * Caller is `ws-context-menu.ts` → `openGithubRepoFlow`. Result is then
 * memoized via `gitsync-cache.ts` (including the `not_linked` negative).
 */

import { getBearerToken } from './auth';
import { logError } from './error-utils';
import { log } from './logging';
import { ApiPath } from './types';

export type GitsyncFetchOutcome =
  | { status: 'found'; repoUrl: string }
  | { status: 'not_linked' }
  | { status: 'error'; message: string; httpStatus?: number };

interface GitsyncApiResponse {
  synced?: boolean;
  config?: {
    repo_url?: string | null;
    repo_name?: string | null;
    owner_name?: string | null;
  } | null;
  github_repo?: string | null;
  github_owner?: string | null;
  github_repo_url?: string | null;
  enabled?: boolean;
}

export function pickRepoUrl(body: GitsyncApiResponse): string | null {
  if (body.config?.repo_url) return body.config.repo_url;
  if (body.config?.owner_name && body.config?.repo_name) {
    return 'https://github.com/' + body.config.owner_name + '/' + body.config.repo_name;
  }
  if (body.github_repo_url) return body.github_repo_url;
  if (body.github_owner && body.github_repo) {
    return 'https://github.com/' + body.github_owner + '/' + body.github_repo;
  }
  if (body.github_repo && body.github_repo.indexOf('/') > 0) {
    return 'https://github.com/' + body.github_repo;
  }
  return null;
}

/**
 * Fetch the gitsync config for a (workspace, project). Returns a typed
 * outcome — never throws.
 */
export async function fetchGitsyncConfig(
  wsId: string,
  pid: string,
): Promise<GitsyncFetchOutcome> {
  if (!wsId || !pid) {
    return { status: 'error', message: 'missing wsId or projectId' };
  }
  const url = ApiPath.CreditApiBase + '/workspaces/' + encodeURIComponent(wsId)
    + '/projects/' + encodeURIComponent(pid) + '/gitsync';

  let token = '';
  try {
    token = await getBearerToken();
  } catch (err: unknown) {
    logError('GitsyncApi.token', 'getBearerToken failed', err);
    return { status: 'error', message: 'auth_failed' };
  }
  if (!token) {
    return { status: 'error', message: 'no_bearer_token' };
  }

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
      },
      credentials: 'include',
    });
    if (resp.status === 404 || resp.status === 401 || resp.status === 403) {
      // 404 = no gitsync row; 401/403 = caller lacks access to this project's
      // gitsync config. From the user's perspective all three are "no repo we
      // can open" → cache as not_linked so repeated right-clicks stay offline.
      log('[GitsyncApi] HTTP ' + resp.status + ' ws=' + wsId + ' pid=' + pid + ' → not_linked', 'info');
      return { status: 'not_linked' };
    }
    if (!resp.ok) {
      const text = await resp.text().catch(function () { return ''; });
      logError('GitsyncApi', 'HTTP ' + resp.status + ' for ws=' + wsId + ' pid=' + pid
        + ' url=' + url + ' bodyPreview=' + text.substring(0, 200));
      return { status: 'error', message: 'http_' + resp.status, httpStatus: resp.status };
    }
    const body = await resp.json() as GitsyncApiResponse;
    if (body.enabled === false || body.synced === false) {
      return { status: 'not_linked' };
    }
    const repo = pickRepoUrl(body);
    if (!repo) {
      log('[GitsyncApi] ws=' + wsId + ' pid=' + pid + ' returned no repo fields → not_linked', 'info');
      return { status: 'not_linked' };
    }
    return { status: 'found', repoUrl: repo };
  } catch (err: unknown) {
    logError('GitsyncApi', 'fetch failed for ws=' + wsId + ' pid=' + pid + ' url=' + url, err);
    return { status: 'error', message: 'network_error' };
  }
}
