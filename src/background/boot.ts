/**
 * Marco Extension — Boot Sequence
 *
 * Initializes databases, rehydrates state, binds handlers, seeds defaults,
 * and drains the pre-init message buffer.
 *
 * @see spec/05-chrome-extension/19-opfs-persistence-strategy.md — DB persistence strategy
 * @see spec/05-chrome-extension/09-error-recovery.md — Boot failure recovery
 * @see .lovable/memory/architecture/background/service-worker-structure.md — SW architecture
 */

import { initDatabases, type DbManager } from "./db-manager";
import { bindDbManager, startSession, getLogsDb, getErrorsDb, markLoggingDirty } from "./handlers/logging-handler";
import { bindStorageDbManager } from "./handlers/storage-handler";
import { bindErrorDbManager } from "./handlers/error-handler";
import { bindPromptDbManager, reseedPrompts } from "./handlers/prompt-handler";
import { bindKvDbManager } from "./handlers/kv-handler";
import { bindGroupedKvDbManager } from "./handlers/grouped-kv-handler";
import { bindFileStorageDbManager, onFileStorageChange } from "./handlers/file-storage-handler";
import { bindStorageBrowserDbManager } from "./handlers/storage-browser-handler";
import { bindUpdaterDbManager } from "./handlers/updater-handler";
import { bindLibraryDbManager } from "./handlers/library-handler";
import {
    rehydrateState,
    setCurrentSessionId,
    setPersistenceMode,
} from "./state-manager";
import {
    ensureDefaultProjectSingleScript,
} from "./default-project-seeder";
import { seedFromManifest } from "./manifest-seeder";
import { backfillScriptUrlMatches } from "./url-matches-backfill";
import { runStorageMigrations } from "./storage-migration";
import { setBootStep, setBootPersistenceMode, finalizeBoot, setBootError, getBootErrorContext, getWasmProbeResult } from "./boot-diagnostics";
import { configureUserScriptWorld } from "./csp-fallback";
import { markInitialized, drainBuffer } from "./message-buffer";
import { cacheScriptCode, getCachedScriptCode, purgeStaleEntries, syncCacheWithBuildId, invalidateCacheOnDeploy } from "./injection-cache";
import { invalidateNamespaceCache } from "./namespace-cache";
import { logCaughtError, logBgWarnError, logSampledDebug, BgLogTag} from "./bg-logger";

const BUILD_META_URL = "build-meta.json";

/* ------------------------------------------------------------------ */
/*  Boot-ready gate                                                    */
/* ------------------------------------------------------------------ */

let resolveBootReady: () => void;

/** Resolves when boot has bound all handlers. Await in listeners
 *  that depend on DbManager (e.g. onInstalled seeder). */
export const bootReady: Promise<void> = new Promise((r) => {
    resolveBootReady = r;
});

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

/** Boots the extension: init DB → rehydrate → bind → drain buffer. */
// eslint-disable-next-line max-lines-per-function
export async function boot(): Promise<void> {
    let step = "pre-init";
    let manager: DbManager | null = null;

    try {
        step = "db-init";
        setBootStep(step);
        manager = await initDatabases();

        // Configure userScripts world early (non-blocking on failure)
        void configureUserScriptWorld();

        setBootPersistenceMode(manager.getPersistenceMode() as "opfs" | "storage" | "memory");
        console.log("[Marco] ✓ DB initialized (%s)", manager.getPersistenceMode());

        step = "sync-build-cache";
        setBootStep(step);
        const currentBuildId = await readCurrentBuildId();
        const buildSyncResult = await syncCacheWithBuildId(currentBuildId);
        if (buildSyncResult.changed) {
            console.log("[Marco] ✓ Build cache sync cleared %d entries", buildSyncResult.cleared);
        }

        step = "bind-handlers";
        setBootStep(step);
        bindAllHandlers(manager);
        resolveBootReady();

        step = "rehydrate-state";
        setBootStep(step);
        await rehydrateState();
        setPersistenceMode(manager.getPersistenceMode());
        // Hydrate the per-origin auto-attach dismissal set so the
        // auto-injector's C9 gate is hot from the first navigation.
        // See: mem://features/auto-attach-policy (C9).
        try {
            const { preloadDismissedOrigins } = await import("./dismissed-origins");
            await preloadDismissedOrigins();
        } catch (err) {
            logCaughtError(
                BgLogTag.MARCO,
                "[boot] preloadDismissedOrigins failed; C9 gate falls back to in-memory",
                err,
            );
        }
        console.log("[Marco] ✓ State rehydrated");

        step = "start-session";
        setBootStep(step);
        const sessionId = await startSession(chrome.runtime.getManifest().version);
        setCurrentSessionId(sessionId);

        step = "storage-migrations";
        setBootStep(step);
        try {
            const migrationResult = await runStorageMigrations();
            if (migrationResult.applied > 0) {
                console.log("[Marco] ✓ Storage migrations: v%d → v%d (%d applied)",
                    migrationResult.fromVersion, migrationResult.toVersion, migrationResult.applied);
            }
        } catch (err) {
            logCaughtError(BgLogTag.BOOT, "Storage migrations failed (non-fatal)", err);
        }

        step = "seed-scripts";
        setBootStep(step);
        try {
            const result = await seedFromManifest();
            console.log("[Marco] ✓ Manifest seeder: %d scripts, %d configs across %d projects", result.scripts, result.configs, result.projects);
        } catch (err) {
            logCaughtError(BgLogTag.BOOT, "Manifest seeder failed (non-fatal)", err);
        }

        step = "backfill-url-matches";
        setBootStep(step);
        try {
            const bf = await backfillScriptUrlMatches();
            if (bf.updated > 0 || bf.skippedNoBindingFound > 0) {
                console.log(
                    "[Marco] ✓ urlMatches backfill: scanned=%d updated=%d alreadyPopulated=%d noBinding=%d",
                    bf.scanned, bf.updated, bf.skippedAlreadyPopulated, bf.skippedNoBindingFound,
                );
            }
        } catch (err) {
            logCaughtError(BgLogTag.BOOT, "urlMatches backfill failed (non-fatal)", err);
        }

        step = "reseed-prompts";
        setBootStep(step);
        try {
            await reseedPrompts();
            console.log("[Marco] ✓ Prompts reseeded from dist");
        } catch (err) {
            logCaughtError(BgLogTag.BOOT, "Prompt reseed failed (non-fatal)", err);
        }

        step = "normalize-default-project";
        setBootStep(step);
        try {
            await ensureDefaultProjectSingleScript();
            console.log("[Marco] ✓ Default project normalized");
        } catch (err) {
            logCaughtError(BgLogTag.BOOT, "Default project normalization failed (non-fatal)", err);
        }

        step = "purge-stale-cache";
        setBootStep(step);
        try {
            await purgeStaleEntries();
        } catch (err) {
            logCaughtError(BgLogTag.BOOT, "Cache purge failed (non-fatal)", err);
        }

        step = "precache-scripts";
        setBootStep(step);
        try {
            await precacheStableScripts();
            console.log("[Marco] Pre-cached stable scripts into IndexedDB");
        } catch (err) {
            logCaughtError(BgLogTag.BOOT, "Script pre-cache failed (non-fatal)", err);
        }

        step = "ready";
        setBootStep(step);
        finalizeBoot();
        markInitialized();
        await drainBuffer();
        console.log("[Marco] Service worker ready");
    } catch (err) {
        const bootErrorMessage = formatBootError(step, err);

        setBootStep(`failed:${step}`);
        setBootError(err);
        finalizeBoot();
        logCaughtError(BgLogTag.BOOT, `Boot failed at step '${step}'`, err);

        // Persist the failure so the popup can surface it across SW restarts.
        void persistBootFailure(step, err);

        if (manager === null) {
            bindAllHandlers(createUnavailableDbManager(bootErrorMessage));
        }

        markInitialized();
        await drainBuffer();
    }
}

/**
 * Persists boot failure metadata to chrome.storage.local for popup recovery UI.
 *
 * Includes a stable `failureId` derived from the step + first 80 chars of the
 * error message so the popup can:
 *   1. Detect "is this the same failure I already have on screen?" across
 *      service-worker restarts and popup re-opens.
 *   2. Freeze its current click-trail snapshot under that ID exactly once,
 *      ensuring the "Recent actions" list shown beside the failure never
 *      drifts as the user keeps interacting.
 *
 * Also embeds the structured `BootErrorContext` (failing SQL / migration
 * step) so degraded-mode banners can render the dedicated copyable block
 * even when GET_STATUS races against a fresh SW restart.
 */
async function persistBootFailure(step: string, err: unknown): Promise<void> {
    try {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? (err.stack ?? null) : null;
        const failureId = `failed:${step}|${message.slice(0, 80)}`;
        const payload = {
            step,
            message,
            stack,
            at: new Date().toISOString(),
            failureId,
            context: getBootErrorContext(),
            wasmProbe: getWasmProbeResult(),
        };
        await chrome.storage.local.set({ marco_last_boot_failure: payload });
    } catch (storageErr) {
        // Storage may be unavailable during catastrophic boot failure.
        logSampledDebug(
            BgLogTag.BOOT,
            "persistBootFailure",
            "chrome.storage.local.set(marco_last_boot_failure) unavailable — banner will rely on in-memory state only",
            storageErr instanceof Error ? storageErr : String(storageErr),
        );
    }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Creates a degraded DbManager that returns explicit DB-unavailable errors. */
function createUnavailableDbManager(reason: string): DbManager {
    const throwUnavailable = (): never => {
        throw new Error(`[db-unavailable] ${reason}`);
    };

    return {
        getLogsDb: throwUnavailable as unknown as DbManager["getLogsDb"],
        getErrorsDb: throwUnavailable as unknown as DbManager["getErrorsDb"],
        getPersistenceMode: () => "memory",
        flushIfDirty: async () => {},
        markDirty: () => {},
    };
}

/** Formats a stable boot failure message for logs and surfaced errors. */
function formatBootError(step: string, error: unknown): string {
    const reason = error instanceof Error ? error.message : String(error);
    return `Boot failed at step '${step}': ${reason}`;
}

/** Reads the current buildId from build-meta.json, if available. */
async function readCurrentBuildId(): Promise<string | null> {
    try {
        const response = await fetch(chrome.runtime.getURL(BUILD_META_URL), { cache: "no-store" });
        if (!response.ok) {
            return null;
        }

        const meta = await response.json() as { buildId?: string; freshStart?: boolean };

        if (meta.freshStart === true) {
            clearAllLogsAndErrors();
            // Also nuke the IndexedDB injection cache to prevent stale/legacy scripts
            await invalidateCacheOnDeploy("freshStart");
            console.log("[Marco] ✓ Fresh start: cleared all logs, errors, and injection cache");
        }

        return typeof meta.buildId === "string" && meta.buildId.length > 0
            ? meta.buildId
            : null;
    } catch (metaErr) {
        logSampledDebug(
            BgLogTag.BOOT,
            "readCurrentBuildId",
            `fetch(${BUILD_META_URL}) failed — assuming no buildId (cache will use the in-memory token)`,
            metaErr instanceof Error ? metaErr : String(metaErr),
        );
        return null;
    }
}

/** Clears all log and error rows for a fresh start. */
function clearAllLogsAndErrors(): void {
    try {
        const logsDb = getLogsDb();
        logsDb.run("DELETE FROM Logs");
        logsDb.run("DELETE FROM Sessions");
    } catch (logsErr) {
        logSampledDebug(
            BgLogTag.BOOT,
            "clearAllLogsAndErrors:logs",
            "logs DB not ready during freshStart — DELETE skipped (DB will be re-seeded on next boot)",
            logsErr instanceof Error ? logsErr : String(logsErr),
        );
    }

    try {
        const errorsDb = getErrorsDb();
        errorsDb.run("DELETE FROM Errors");
    } catch (errorsErr) {
        logSampledDebug(
            BgLogTag.BOOT,
            "clearAllLogsAndErrors:errors",
            "errors DB not ready during freshStart — DELETE skipped (DB will be re-seeded on next boot)",
            errorsErr instanceof Error ? errorsErr : String(errorsErr),
        );
    }

    markLoggingDirty();
}

/** Binds all handler modules to the shared DbManager. */
function bindAllHandlers(manager: DbManager): void {
    bindDbManager(manager);
    bindStorageDbManager(manager);
    bindErrorDbManager(manager);
    bindPromptDbManager(manager);
    bindKvDbManager(manager);
    bindGroupedKvDbManager(manager);
    bindFileStorageDbManager(manager);
    // Wire file-change → namespace cache invalidation without circular import.
    onFileStorageChange((projectId) => {
        invalidateNamespaceCache(projectId).catch((err) => {
            logBgWarnError(BgLogTag.NS_CACHE, `invalidateNamespaceCache failed for project ${projectId} after file-storage change — cache may be stale until next rebuild`, err);
        });
    });
    bindStorageBrowserDbManager(manager);
    bindUpdaterDbManager(manager);
    bindLibraryDbManager(manager);
}

/**
 * Pre-caches ALL stable injection scripts into IndexedDB on boot.
 * This eliminates cold-start fetch latency (~500ms savings).
 * SDK/XPath are fully stable; macro-looping changes with builds
 * but cache is invalidated by build-ID checks elsewhere.
 */
async function precacheStableScripts(): Promise<void> {
    const stableScripts = [
        "projects/scripts/marco-sdk/marco-sdk.js",
        "projects/scripts/xpath/xpath.js",
        "projects/scripts/macro-controller/macro-looping.js",
    ];

    const t0 = performance.now();

    // HEFF: sequential warm with break on first HTTP failure (was Promise.all
    // fanout). chrome-extension:// asset fetches cannot rate-limit Lovable,
    // but the rule is uniform: one failure → stop, report, surface.
    const cacheResults: string[] = [];
    for (const path of stableScripts) {
        try {
            const cached = await getCachedScriptCode(path);
            if (cached !== null) {
                cacheResults.push(path + " (already cached)");
                continue;
            }

            const url = chrome.runtime.getURL(path);
            const response = await fetch(url);
            if (!response.ok) {
                cacheResults.push(path + " (fetch failed: " + response.status + ") — halting remaining warms");
                break;
            }

            const code = await response.text();
            await cacheScriptCode(path, code);
            cacheResults.push(path + " (cached " + code.length + " chars)");
        } catch (err) {
            cacheResults.push(path + " (error: " + (err instanceof Error ? err.message : String(err)) + ") — halting remaining warms");
            break;
        }
    }

    const ms = (performance.now() - t0).toFixed(1);
    console.log("[Marco] Pre-cached %d scripts in %sms: %s", stableScripts.length, ms, cacheResults.join(", "));
}
