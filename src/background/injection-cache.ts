/**
 * Marco Extension — IndexedDB Injection Cache
 *
 * Caches scripts, projects, and configs in IndexedDB for ultra-fast
 * cold-start injection. IndexedDB is significantly faster than
 * chrome.storage.local for large blobs (scripts can be 100KB+)
 * and supports structured cloning without JSON serialization overhead.
 *
 * Cache invalidation:
 *   - Automatically on extension update (version bump via onInstalled)
 *   - Automatically on deploy (run.ps1 -d)
 *   - Manually via INVALIDATE_CACHE message from popup
 *   - Per-key invalidation when data changes
 *
 * See: spec/22-app-issues/88-indexeddb-injection-cache.md
 */

import { EXTENSION_VERSION, STORAGE_KEY_LAST_BUILD_ID } from "../shared/constants";
import { logCaughtError, BgLogTag} from "./bg-logger";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DB_NAME = "marco_injection_cache";
const DB_VERSION = 1;
const STORE_NAME = "cache";
const VERSION_KEY = "__cache_version__";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CacheEntry<T = unknown> {
    key: string;
    value: T;
    cachedAt: string;
    version: string;
}

export type CacheCategory =
    | "scripts"      // StoredScript[]
    | "configs"      // StoredConfig[]
    | "projects"     // StoredProject[]
    | "script_code"  // Individual script code by filePath
    | "namespace"    // Pre-built namespace blobs
    | "settings";    // Extension settings

/* ------------------------------------------------------------------ */
/*  IndexedDB Lifecycle                                                */
/* ------------------------------------------------------------------ */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "key" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            logCaughtError(BgLogTag.INJECTION_CACHE, `IndexedDB open failed\n  Path: indexedDB.open("${DB_NAME}", ${DB_VERSION})\n  Missing: IDBDatabase connection\n  Reason: ${request.error?.message ?? "unknown DOMException — browser may have storage quota exceeded or IndexedDB disabled"}`, request.error);
            reject(request.error);
        };
    });

    return dbPromise;
}

/* ------------------------------------------------------------------ */
/*  Core Operations                                                    */
/* ------------------------------------------------------------------ */

/**
 * Get a cached value by category + optional sub-key.
 * Returns null if not found or version mismatch.
 */
export async function cacheGet<T>(category: CacheCategory, subKey = ""): Promise<T | null> {
    try {
        const db = await openDb();
        const key = buildKey(category, subKey);

        return new Promise<T | null>((resolve) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(key);

            request.onsuccess = () => {
                const entry = request.result as CacheEntry<T> | undefined;
                if (!entry) {
                    resolve(null);
                    return;
                }
                // Version guard — stale cache from old extension version
                if (entry.version !== EXTENSION_VERSION) {
                    console.log("[injection-cache] Version mismatch for %s (cached=%s, current=%s) — miss",
                        key, entry.version, EXTENSION_VERSION);
                    resolve(null);
                    return;
                }
                resolve(entry.value);
            };

            request.onerror = () => {
                logCaughtError(BgLogTag.INJECTION_CACHE, `Get failed for cache entry\n  Path: IndexedDB → ${DB_NAME} → store="${STORE_NAME}" → key="${key}"\n  Missing: Cached value for "${key}"\n  Reason: IDBRequest error — ${request.error?.message ?? "unknown"}`, request.error);
                resolve(null);
            };
        });
    } catch {
        return null;
    }
}

/**
 * Set a cached value by category + optional sub-key.
 */
export async function cacheSet<T>(category: CacheCategory, value: T, subKey = ""): Promise<void> {
    try {
        const db = await openDb();
        const key = buildKey(category, subKey);
        const entry: CacheEntry<T> = {
            key,
            value,
            cachedAt: new Date().toISOString(),
            version: EXTENSION_VERSION,
        };

        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(entry);

            request.onsuccess = () => resolve();
            request.onerror = () => {
                logCaughtError(BgLogTag.INJECTION_CACHE, `Set failed for cache entry\n  Path: IndexedDB → ${DB_NAME} → store="${STORE_NAME}" → key="${key}"\n  Missing: Successful write of cached entry\n  Reason: IDBRequest error — ${request.error?.message ?? "unknown, possible quota exceeded"}`, request.error);
                reject(request.error);
            };
        });
    } catch (err) {
        logCaughtError(BgLogTag.INJECTION_CACHE, `cacheSet error\n  Path: IndexedDB → ${DB_NAME} → store="${STORE_NAME}"\n  Missing: Successful cache write\n  Reason: ${err instanceof Error ? err.message : String(err)}`, err);
    }
}

/**
 * Delete a specific cache entry.
 */
export async function cacheDelete(category: CacheCategory, subKey = ""): Promise<void> {
    try {
        const db = await openDb();
        const key = buildKey(category, subKey);

        return new Promise<void>((resolve) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve(); // best-effort
        });
    } catch { // allow-swallow: IndexedDB cache delete is best-effort; stale entry will be re-validated on next read
        // noop
    }
}

/**
 * Clear ALL cache entries. Used on deploy, version bump, or manual invalidation.
 */
export async function cacheClearAll(): Promise<{ cleared: number }> {
    try {
        const db = await openDb();

        return new Promise<{ cleared: number }>((resolve) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);

            // Count before clearing
            const countReq = store.count();
            countReq.onsuccess = () => {
                const count = countReq.result;
                const clearReq = store.clear();
                clearReq.onsuccess = () => {
                    console.log("[injection-cache] ✅ Cache cleared (%d entries)", count);
                    resolve({ cleared: count });
                };
                clearReq.onerror = () => resolve({ cleared: 0 });
            };
            countReq.onerror = () => resolve({ cleared: 0 });
        });
    } catch {
        return { cleared: 0 };
    }
}

/**
 * Get cache stats for diagnostics.
 */
export async function cacheStats(): Promise<{ entryCount: number; categories: Record<string, number> }> {
    try {
        const db = await openDb();

        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const entries = request.result as CacheEntry[];
                const categories: Record<string, number> = {};
                for (const entry of entries) {
                    const cat = entry.key.split(":")[0] || "unknown";
                    categories[cat] = (categories[cat] || 0) + 1;
                }
                resolve({ entryCount: entries.length, categories });
            };

            request.onerror = () => resolve({ entryCount: 0, categories: {} });
        });
    } catch {
        return { entryCount: 0, categories: {} };
    }
}

/* ------------------------------------------------------------------ */
/*  Deploy / Version Invalidation                                      */
/* ------------------------------------------------------------------ */

/**
 * Called from the onInstalled listener. Clears the entire cache
 * when the extension version changes (update or fresh install).
 */
export async function invalidateCacheOnDeploy(reason: string): Promise<void> {
    console.log("[injection-cache] Extension %s detected — invalidating cache", reason);
    const result = await cacheClearAll();
    console.log("[injection-cache] Deploy invalidation complete — %d entries cleared", result.cleared);
}

/**
 * Syncs the IndexedDB cache with the current buildId from build-meta.json.
 *
 * This prevents stale script_code entries from surviving dev rebuilds where the
 * extension version stays constant but the bundled macro script changed.
 */
export async function syncCacheWithBuildId(
    currentBuildId: string | null,
): Promise<{ changed: boolean; cleared: number }> {
    if (typeof currentBuildId !== "string" || currentBuildId.length === 0) {
        return { changed: false, cleared: 0 };
    }

    try {
        const result = await chrome.storage.local.get(STORAGE_KEY_LAST_BUILD_ID);
        const previousBuildId = typeof result[STORAGE_KEY_LAST_BUILD_ID] === "string"
            ? result[STORAGE_KEY_LAST_BUILD_ID] as string
            : null;

        if (previousBuildId === currentBuildId) {
            return { changed: false, cleared: 0 };
        }

        const clearResult = await cacheClearAll();
        await chrome.storage.local.set({ [STORAGE_KEY_LAST_BUILD_ID]: currentBuildId });

        if (previousBuildId === null) {
            console.log(
                "[injection-cache] Initialized build cache sync (%s) — cleared %d entries",
                currentBuildId,
                clearResult.cleared,
            );
        } else {
            console.log(
                "[injection-cache] Build changed %s → %s — cleared %d entries",
                previousBuildId,
                currentBuildId,
                clearResult.cleared,
            );
        }

        return { changed: true, cleared: clearResult.cleared };
    } catch (err) {
        logCaughtError(BgLogTag.INJECTION_CACHE, `Build sync failed\n  Path: chrome.storage.local["${STORAGE_KEY_LAST_BUILD_ID}"]\n  Missing: Successful build ID comparison and cache invalidation\n  Reason: ${err instanceof Error ? err.message : String(err)}`, err);
        return { changed: false, cleared: 0 };
    }
}

/**
 * Purge all cache entries whose stored version doesn't match the
 * current EXTENSION_VERSION.  Called during boot to ensure stale
 * macro-looping bundles (or any other artifact) from a previous
 * version are physically deleted — not just treated as cache misses.
 */
export async function purgeStaleEntries(): Promise<number> {
    try {
        const db = await openDb();

        return new Promise<number>((resolve) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const entries = request.result as CacheEntry[];
                let purged = 0;

                for (const entry of entries) {
                    if (entry.version !== EXTENSION_VERSION) {
                        store.delete(entry.key);
                        purged++;
                    }
                }

                if (purged > 0) {
                    console.log("[injection-cache] Purged %d stale entries (version ≠ %s)", purged, EXTENSION_VERSION);
                }
                resolve(purged);
            };

            request.onerror = () => resolve(0);
        });
    } catch {
        return 0;
    }
}

/* ------------------------------------------------------------------ */
/*  Script Code Cache (for resolveScriptCode)                          */
/* ------------------------------------------------------------------ */

/**
 * Cache resolved script code by filePath to avoid repeated fetch() calls.
 */
export async function cacheScriptCode(filePath: string, code: string): Promise<void> {
    await cacheSet("script_code", code, filePath);
}

/**
 * Retrieve cached script code by filePath.
 */
export async function getCachedScriptCode(filePath: string): Promise<string | null> {
    return cacheGet<string>("script_code", filePath);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildKey(category: CacheCategory, subKey: string): string {
    return subKey ? `${category}:${subKey}` : category;
}
