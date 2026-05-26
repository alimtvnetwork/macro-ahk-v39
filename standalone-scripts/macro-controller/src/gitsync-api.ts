/**
 * MacroLoop Controller — Gitsync API client (v3.19.0)
 *
 * Spec: spec/22-app-issues/workspace-github-open/01-overview.md
 * Sample: spec/22-app-issues/workspace-github-open/02-api-sample.md
 *
 * Single-attempt fetch of `/workspaces/{wsId}/projects/{pid}/gitsync` via the
 * centralized marco-sdk (`window.marco.api.call`). Routing through the SDK
 * ensures the Authorization header, base URL, and axios interceptors are
 * applied identically to every other API call (workspaces, credit-balance,
 * memberships, projects.list, remix.init, ...) — fixing the prior bug where
 * a raw `fetch()` from MAIN world produced inconsistent auth/CORS results.
 *
 * No retries, no backoff (`mem://constraints/no-retry-policy`).
 * Auth contract: `mem://auth/unified-auth-contract`.
 */

import { logError } from './error-utils';
import { log } from './logging';
import { CREDIT_API_BASE } from './shared-state';

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

interface SdkApiResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly data: unknown;
}

interface SdkBridge {
  api: {
    call(path: string, options: { params: Record<string, string>; baseUrl: string }): Promise<SdkApiResponse>;
  };
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

function getSdk(): SdkBridge | null {
  const sdk = (window as unknown as { marco?: SdkBridge }).marco;
  if (!sdk || !sdk.api || typeof sdk.api.call !== 'function') return null;
  return sdk;
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
  const sdk = getSdk();
  if (!sdk) {
    logError('GitsyncApi', 'marco.api.call unavailable (SDK not injected yet)');
    return { status: 'error', message: 'sdk_unavailable' };
  }

  let resp: SdkApiResponse;
  try {
    resp = await sdk.api.call('projects.gitsync', {
      params: { wsId, projectId: pid },
      baseUrl: CREDIT_API_BASE,
    });
  } catch (err: unknown) {
    logError('GitsyncApi', 'sdk.api.call threw for ws=' + wsId + ' pid=' + pid, err);
    return { status: 'error', message: 'network_error' };
  }

  if (resp.status === 404 || resp.status === 401 || resp.status === 403) {
    // 404 = no gitsync row; 401/403 = caller lacks access. From the user's
    // perspective all three are "no repo we can open" → cache as not_linked.
    log('[GitsyncApi] HTTP ' + resp.status + ' ws=' + wsId + ' pid=' + pid + ' → not_linked', 'info');
    return { status: 'not_linked' };
  }
  if (!resp.ok) {
    logError('GitsyncApi', 'HTTP ' + resp.status + ' for ws=' + wsId + ' pid=' + pid
      + ' bodyPreview=' + JSON.stringify(resp.data).substring(0, 200));
    return { status: 'error', message: 'http_' + resp.status, httpStatus: resp.status };
  }

  const body = (resp.data ?? {}) as GitsyncApiResponse;
  if (body.enabled === false || body.synced === false) {
    return { status: 'not_linked' };
  }
  const repo = pickRepoUrl(body);
  if (!repo) {
    log('[GitsyncApi] ws=' + wsId + ' pid=' + pid + ' returned no repo fields → not_linked', 'info');
    return { status: 'not_linked' };
  }
  return { status: 'found', repoUrl: repo };
}
