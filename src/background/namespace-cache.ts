/**
 * ✅ 15.8: Pre-Serialized Namespace Cache
 *
 * Builds and caches the namespace injection script string on project save,
 * so injection time only needs to read the cached string + executeScript.
 *
 * Cache key: `ns_cache_<projectId>` in chrome.storage.local
 * Invalidation: called on project save, file save/delete, config save.
 *
 * @see spec/21-app/02-features/devtools-and-injection/sdk-convention.md — SDK namespace convention
 * @see .lovable/memory/architecture/injection-pipeline-optimization.md — Namespace caching
 */

import type { StoredProject } from "../shared/project-types";
import { buildProjectNamespaceScript } from "./project-namespace-builder";
import { getFilesByProject } from "./handlers/file-storage-handler";
import { toCodeName, slugify } from "../lib/slug-utils";
import { logCaughtError, BgLogTag} from "./bg-logger";

const NS_CACHE_PREFIX = "ns_cache_";

export function nsCacheKey(projectId: string): string {
    return `${NS_CACHE_PREFIX}${projectId}`;
}

export interface NsCacheEntry {
    script: string;
    builtAt: number;
}

/**
 * Builds and stores the namespace injection script for a project.
 * Called on project save, file save/delete, config save.
 */
export async function rebuildNamespaceCache(project: StoredProject): Promise<void> {
    try {
        const projectSlug = project.slug || slugify(project.name);
        const codeName = project.codeName || toCodeName(projectSlug);

        let fileCache: Array<{ name: string; data: string }> = [];
        try {
            fileCache = getFilesByProject(project.id, 50);
        } catch { /* db not bound yet — empty fileCache is the documented fallback */ } // allow-swallow: db not bound yet at cache rebuild time

        const nsScript = buildProjectNamespaceScript({
            codeName,
            slug: projectSlug,
            projectName: project.name,
            projectVersion: project.version,
            projectId: project.id,
            description: project.description,
            dependencies: (project.dependencies ?? []).map((d) => ({
                projectId: d.projectId,
                version: d.version,
            })),
            scripts: (project.scripts ?? []).map((s, i) => ({
                name: s.path.split("/").pop() ?? s.path,
                order: s.order ?? i,
                isEnabled: true,
            })),
            fileCache,
            cookieBindings: (project.cookies ?? []).map((c) => ({
                cookieName: c.cookieName,
                url: c.url,
                role: c.role,
            })),
        });

        const entry: NsCacheEntry = { script: nsScript, builtAt: Date.now() };
        await chrome.storage.local.set({ [nsCacheKey(project.id)]: entry });
        console.log("[ns-cache] Rebuilt namespace cache for \"%s\" (%d chars)", project.name, nsScript.length);
    } catch (err) {
        logCaughtError(BgLogTag.NS_CACHE, `Failed to rebuild cache for ${project.id}`, err);
    }
}

/**
 * Invalidates (removes) the namespace cache for a project.
 */
export async function invalidateNamespaceCache(projectId: string): Promise<void> {
    try {
        await chrome.storage.local.remove(nsCacheKey(projectId));
    } catch { /* best-effort remove */ } // allow-swallow: cache invalidation is best-effort; storage failure is benign
}

/**
 * Reads cached namespace scripts for multiple projects in a single storage call.
 * Returns a Map of projectId → cached script string (or undefined for cache misses).
 */
export async function readNamespaceCaches(
    projectIds: string[],
): Promise<Map<string, string>> {
    const keys = projectIds.map(nsCacheKey);
    const result = await chrome.storage.local.get(keys);
    const map = new Map<string, string>();
    for (const pid of projectIds) {
        const entry = result[nsCacheKey(pid)] as NsCacheEntry | undefined;
        if (entry?.script) {
            map.set(pid, entry.script);
        }
    }
    return map;
}
