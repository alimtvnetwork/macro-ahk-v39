/**
 * MacroLoop Controller — Projects List Cache (SQLite via marco.kv)
 *
 * Step 4 of `.lovable/plans/projects-modal-15-step-improvement.md`.
 *
 * Persists `projects.list` responses per workspace so the Projects modal
 * doesn't re-fetch on every open. Read/write goes through `marco.kv`
 * (background SQLite, project-scoped). Failures are logged, never thrown.
 *
 * Key format (PascalCase per `mem://architecture/logging-data-contract`):
 *   `MacroProjectListCache:{wsId}` →
 *     { WorkspaceId, FetchedAt (ISO), ExpiresAt (epoch ms), Projects: [...] }
 *
 * TTL: default 48 h, overridable via the `ttlMs` parameter (Step 7 will
 * wire the value to a user-tunable setting).
 *
 * Standards:
 *   - `mem://constraints/no-retry-policy` — single attempt; on failure we
 *     log and let the caller fall back to a network fetch.
 *   - `mem://constraints/no-storage-pascalcase-migration` — this is a
 *     NEW kv-key family, not a rewrite of existing `chrome.storage.local`
 *     keys, so the policy allows it.
 *   - `mem://standards/error-logging-via-namespace-logger` — uses
 *     `logError` from `error-utils`.
 */

import { logError } from './error-utils';
import { log } from './logging';
import { getSettingsOverrides } from './settings-store';
import { DEFAULT_PROJECTS_CACHE_TTL_HOURS } from './constants';

const KEY_PREFIX = 'MacroProjectListCache:';

/** Default cache TTL — 48 h. Overridable per call (Step 7 setting). */
export const DEFAULT_PROJECT_CACHE_TTL_MS = DEFAULT_PROJECTS_CACHE_TTL_HOURS * 60 * 60 * 1000;

/**
 * Resolve the effective TTL for the projects cache, in ms.
 * Reads `projectsCacheTtlHours` from settings-store; falls back to the
 * default 48 h constant when unset / invalid.
 */
export function getProjectsCacheTtlMs(): number {
    const o = getSettingsOverrides();
    const h = o.projectsCacheTtlHours;
    if (typeof h === 'number' && Number.isFinite(h) && h >= 0) {
        return Math.floor(h) * 60 * 60 * 1000;
    }
    return DEFAULT_PROJECT_CACHE_TTL_MS;
}

export interface CachedProject {
    readonly Id: string;
    readonly Name: string;
    readonly GithubRepo: string;
    readonly GithubBranch: string;
    readonly LastMessageAt: string;
}

export interface ProjectListCacheRow {
    readonly WorkspaceId: string;
    readonly FetchedAt: string; // ISO timestamp
    readonly ExpiresAt: number; // epoch ms
    readonly Projects: ReadonlyArray<CachedProject>;
}

interface KvBridge {
    kv: {
        get(key: string): Promise<string | null>;
        set(key: string, value: string): Promise<void>;
        delete(key: string): Promise<void>;
    };
}

function getKv(): KvBridge['kv'] | null {
    const sdk = (window as unknown as { marco?: KvBridge }).marco;
    return sdk && sdk.kv ? sdk.kv : null;
}

function buildKey(workspaceId: string): string {
    return KEY_PREFIX + workspaceId;
}

/**
 * Read a cached project list for a workspace.
 *
 * Returns `null` if no row exists, the row is malformed, or `ExpiresAt`
 * is in the past. Callers should treat `null` as a cache miss and fall
 * back to the network.
 */
export async function readProjectListCache(workspaceId: string): Promise<ProjectListCacheRow | null> {
    if (!workspaceId) return null;
    const kv = getKv();
    if (!kv) return null;
    try {
        const raw = await kv.get(buildKey(workspaceId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<ProjectListCacheRow>;
        if (typeof parsed.ExpiresAt !== 'number' || !Array.isArray(parsed.Projects)) return null;
        if (parsed.ExpiresAt <= Date.now()) {
            log('ProjectsCache: expired for ws=' + workspaceId, 'info');
            return null;
        }
        log('ProjectsCache: hit for ws=' + workspaceId + ' (' + parsed.Projects.length + ' projects)', 'info');
        return parsed as ProjectListCacheRow;
    } catch (err: unknown) {
        logError('ProjectsCache.read', 'kv.get failed for ws=' + workspaceId, err);
        return null;
    }
}

/**
 * Upsert the cached project list for a workspace. Fire-and-forget:
 * resolves immediately while the SQLite write happens in the background.
 */
export function writeProjectListCache(
    workspaceId: string,
    projects: ReadonlyArray<CachedProject>,
    ttlMs: number = DEFAULT_PROJECT_CACHE_TTL_MS,
): void {
    if (!workspaceId) return;
    const kv = getKv();
    if (!kv) {
        logError('ProjectsCache.write', 'marco.kv unavailable — skipping SQLite upsert for ws=' + workspaceId);
        return;
    }
    const now = Date.now();
    const row: ProjectListCacheRow = {
        WorkspaceId: workspaceId,
        FetchedAt: new Date(now).toISOString(),
        ExpiresAt: now + Math.max(0, ttlMs),
        Projects: projects,
    };
    kv.set(buildKey(workspaceId), JSON.stringify(row)).then(function (): void {
        log('ProjectsCache: wrote ws=' + workspaceId + ' (' + projects.length + ' projects, ttl=' + Math.round(ttlMs / 60000) + 'min)', 'info');
    }).catch(function (caught: unknown): void {
        logError('ProjectsCache.write', 'kv.set failed for ws=' + workspaceId, caught);
    });
}

/** Drop a workspace's cache row (used by the Refresh button). */
export function clearProjectListCache(workspaceId: string): void {
    if (!workspaceId) return;
    const kv = getKv();
    if (!kv) return;
    kv.delete(buildKey(workspaceId)).catch(function (caught: unknown): void {
        logError('ProjectsCache.clear', 'kv.delete failed for ws=' + workspaceId, caught);
    });
}
