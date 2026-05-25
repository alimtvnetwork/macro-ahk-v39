/**
 * Marco Extension — SPA Re-Injection (P-009)
 *
 * Detects SPA route changes via webNavigation.onHistoryStateUpdated,
 * probes for missing DOM markers, and re-injects scripts from the
 * last known good TabInjectionRecord to survive SPA re-renders.
 */

import { getTabInjections } from "./state-manager";
import { resolveScriptBindings } from "./script-resolver";
import { wrapWithIsolation } from "./handlers/injection-wrapper";
import { injectWithCspFallback } from "./csp-fallback";
import { ensureBuiltinScriptsExist } from "./builtin-script-guard";
import {
    persistInjectionError,
    persistInjectionInfo,
    persistInjectionWarn,
} from "./injection-diagnostics";
import { readAllProjects } from "./handlers/project-helpers";
import { logCaughtError, logBgWarnError, BgLogTag } from "./bg-logger";
import { urlFingerprint } from "./url-fingerprint";
import { handleNavigationCompleted } from "./auto-injector";
import type { ResolvedScript } from "./script-resolver";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** DOM marker IDs created by injected scripts. */
const MARKER_IDS = [
    "ahk-loop-script",
    "ahk-combo-script",
    "marco-auth-panel",
    "marco-controller-marker",
];

/** Delay before probing markers (let SPA settle). */
const PROBE_DELAY_MS = 500;

/** Minimum age (ms) of a tab injection before re-inject is allowed. */
const MIN_INJECTION_AGE_MS = 2000;

/**
 * Per-tab fingerprint of the last URL we already probed during an SPA
 * route change. Prevents the U-2 storm where 5 pushState calls in a
 * 200ms burst (common on React routers re-syncing query params)
 * scheduled 5 redundant probe + executeScript fan-outs.
 *
 * Bounded by the small set of open tabs; entries are best-effort and
 * may go stale on tab close — harmless.
 */
const lastProbedFingerprint: Map<number, string> = new Map();

/** Tabs with a probe currently in-flight — second concurrent call short-circuits. */
const probeInFlight: Set<number> = new Set();

/** Clears per-tab SPA state. Exported for use by service-worker tab-close handler. */
export function clearSpaReinjectStateForTab(tabId: number): void {
    lastProbedFingerprint.delete(tabId);
    probeInFlight.delete(tabId);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** Registers the SPA navigation listener for re-injection. */
export function registerSpaReinject(): void {
    chrome.webNavigation.onHistoryStateUpdated.addListener(
        handleHistoryStateUpdated,
    );
    try {
        chrome.tabs.onRemoved.addListener((tabId) => {
            clearSpaReinjectStateForTab(tabId);
        });
    } catch (err) {
        logCaughtError(BgLogTag.MARCO, "spa-reinject tabs.onRemoved registration failed", err);
    }
    console.log("[spa-reinject] Registered onHistoryStateUpdated + tab-close cleanup");
}

/* ------------------------------------------------------------------ */
/*  Navigation Handler                                                 */
/* ------------------------------------------------------------------ */

/** Handles SPA route changes (pushState/replaceState). */
async function handleHistoryStateUpdated(
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
    const isSubFrame = details.frameId !== 0;

    if (isSubFrame) {
        return;
    }

    const tabId = details.tabId;
    const record = getTabInjections()[tabId];
    const hasRecord = record !== undefined;

    if (!hasRecord) {
        // First-time SPA navigation onto an injectable page (e.g. user clicked
        // from lovable.dev home → /projects/xxx). `webNavigation.onCompleted`
        // does NOT fire on pushState, so the auto-injector never sees it and
        // the extension stays dormant until a hard refresh. Delegate to the
        // standard auto-injection pipeline so it can evaluate URL rules and
        // inject. The auto-injector applies its own URL guards + 5s dedup.
        await handleNavigationCompleted({
            tabId,
            url: details.url,
            frameId: 0,
            processId: -1,
            timeStamp: Date.now(),
        } as chrome.webNavigation.WebNavigationFramedCallbackDetails);
        return;
    }

    const hasBindings = record.lastGoodBindings !== undefined
        && record.lastGoodBindings.length > 0;

    if (!hasBindings) {
        return;
    }


    const injectionAge = Date.now() - new Date(record.timestamp).getTime();
    const isTooRecent = injectionAge < MIN_INJECTION_AGE_MS;

    if (isTooRecent) {
        return;
    }

    // U-2 dedup: if this exact URL fingerprint was probed last time on
    // this tab, skip the probe + executeScript fan-out entirely.
    const fp = urlFingerprint(details.url);
    const lastFp = lastProbedFingerprint.get(tabId);
    const isSameUrl = lastFp === fp;
    if (isSameUrl) {
        return;
    }
    // U-2 in-flight guard: prevent overlapping probes on the same tab
    // when bursts include a URL change followed quickly by another.
    if (probeInFlight.has(tabId)) {
        return;
    }
    lastProbedFingerprint.set(tabId, fp);
    probeInFlight.add(tabId);
    try {
        await scheduleMarkerProbe(tabId);
    } finally {
        probeInFlight.delete(tabId);
    }
}

/* ------------------------------------------------------------------ */
/*  Marker Probe                                                       */
/* ------------------------------------------------------------------ */

/** Waits briefly, then probes for missing DOM markers. */
async function scheduleMarkerProbe(tabId: number): Promise<void> {
    await delay(PROBE_DELAY_MS);
    await probeAndReinject(tabId);
}

/** Probes the tab for missing markers and re-injects if needed. */
async function probeAndReinject(tabId: number): Promise<void> {
    const record = getTabInjections()[tabId];
    const hasRecord = record !== undefined;

    if (!hasRecord) {
        return;
    }

    const markersExist = await checkMarkersExist(tabId);

    if (markersExist) {
        logMarkersIntact(tabId);
        return;
    }

    logMarkersLost(tabId);
    await reinjectFromSnapshot(tabId);
}

/** Checks if any DOM markers still exist on the page. */
async function checkMarkersExist(tabId: number): Promise<boolean> {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: probeMarkerIds,
            args: [MARKER_IDS],
        });

        return results[0]?.result === true;
    } catch {
        return true;
    }
}

/** Runs in the page context to check for marker elements. */
function probeMarkerIds(ids: string[]): boolean {
    for (const id of ids) {
        const element = document.getElementById(id);
        const isFound = element !== null;

        if (isFound) {
            return true;
        }
    }

    return false;
}

/* ------------------------------------------------------------------ */
/*  Re-Injection                                                       */
/* ------------------------------------------------------------------ */

/** Re-injects scripts from the last known good snapshot. */
async function reinjectFromSnapshot(tabId: number): Promise<void> {
    const record = getTabInjections()[tabId];
    const bindings = record?.lastGoodBindings;
    const hasBindings = bindings !== undefined && bindings.length > 0;

    if (!hasBindings) {
        return;
    }

    try {
        // ✅ Self-heal: reseed missing built-in scripts before resolving
        // See: spec/22-app-issues/check-button/11-popup-injection-missing-guard.md (NR-11-A)
        const projects = await readAllProjects();
        await ensureBuiltinScriptsExist(projects);

        const resolution = await resolveScriptBindings(bindings!);
        const sorted = sortByOrder(resolution.resolved);

        for (const script of sorted) {
            await injectSingle(tabId, script);
        }

        logReinjectSuccess(tabId, sorted.length);
    } catch (error) {
        logReinjectError(tabId, error);
    }
}

/** Injects a single resolved script with CSP fallback. */
async function injectSingle(
    tabId: number,
    resolved: ResolvedScript,
): Promise<void> {
    const wrappedCode = wrapWithIsolation(
        resolved.injectable,
        resolved.configJson,
        resolved.themeJson,
        "passive",
    );

    await injectWithCspFallback(tabId, wrappedCode, resolved.world);
}

/** Sorts resolved scripts by execution order. */
function sortByOrder(scripts: ResolvedScript[]): ResolvedScript[] {
    return [...scripts].sort(
        (a, b) => a.injectable.order - b.injectable.order,
    );
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

/** Promise-based delay. */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  Logging                                                            */
/* ------------------------------------------------------------------ */

/** Logs that markers are still intact (no re-inject needed). */
function logMarkersIntact(tabId: number): void {
    console.log(
        `[spa-reinject] Markers intact in tab ${tabId}, skipping re-inject`,
    );
}

/** Logs that markers were lost after SPA navigation. */
function logMarkersLost(tabId: number): void {
    logBgWarnError(
        BgLogTag.INJECTION,
        `[spa-reinject] Markers lost in tab ${tabId} after SPA navigation, re-injecting`,
    );

    void persistInjectionWarn(
        "SPA_REINJECT_MARKERS_LOST",
        `[spa-reinject] Markers lost in tab ${tabId} after SPA navigation, re-injecting`,
        { projectId: getTabInjections()[tabId]?.projectId || undefined },
    );
}

/** Logs a successful SPA re-injection. */
function logReinjectSuccess(tabId: number, count: number): void {
    console.log(
        `[spa-reinject] Re-injected ${count} script(s) into tab ${tabId}`,
    );

    void persistInjectionInfo(
        "SPA_REINJECT_COMPLETE",
        `[spa-reinject] Re-injected ${count} script(s) into tab ${tabId}`,
        { projectId: getTabInjections()[tabId]?.projectId || undefined },
    );
}

/** Logs a failed SPA re-injection. */
function logReinjectError(tabId: number, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    logCaughtError(
        BgLogTag.INJECTION,
        `[spa-reinject] Re-inject failed for tab ${tabId}: ${reason}`,
        error instanceof Error ? error : new Error(reason),
        { contextDetail: `tabId=${tabId}` },
    );

    void persistInjectionError(
        "SPA_REINJECT_FAILED",
        `[spa-reinject] Re-inject failed for tab ${tabId}: ${reason}`,
        {
            projectId: getTabInjections()[tabId]?.projectId || undefined,
            contextDetail: `tabId=${tabId}`,
        },
    );
}
