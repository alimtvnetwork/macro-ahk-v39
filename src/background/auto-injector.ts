/**
 * Marco Extension — Auto-Injector
 *
 * Listens for webNavigation.onCompleted and auto-injects
 * scripts based on project URL matching rules. Resolves
 * real script code from storage, evaluates conditions,
 * and wraps with error isolation.
 *
 * Scripts with autoInject === false are skipped during auto-injection
 * and must be injected manually via the Popup Run button.
 *
 * Non-project pages (login, signup, home) are never auto-injected.
 *
 * See spec 05-content-script-adaptation.md §Injection Flow.
 */

import { evaluateUrlMatches, deduplicateScripts } from "./project-matcher";
import { isNewTabOrBlankUrl } from "../shared/url-utils";
import { resolveScriptBindings, type ResolvedScript } from "./script-resolver";
import { evaluateConditions } from "./condition-evaluator";
import { wrapWithIsolation } from "./handlers/injection-wrapper";
import { logCaughtError, logBgWarnError, BgLogTag } from "./bg-logger";
import {
    setTabInjection,
    getActiveProjectId,
    getTabDecision,
    setTabDecision,
    clearTabDecision,
    isSameDecisionFingerprint,
} from "./state-manager";
import { urlFingerprint } from "./url-fingerprint";
import { injectWithCspFallback } from "./csp-fallback";
import {
    isOriginDismissedForTab,
    clearDismissedOriginsForTab,
} from "./dismissed-origins";
import { maybeShowFirstAttachToast } from "./first-attach-toast";
import { STORAGE_KEY_ALL_SCRIPTS } from "../shared/constants";
import type { InjectionLaunchSource } from "../shared/injection-types";
import { ensureBuiltinScriptsExist } from "./builtin-script-guard";
import { persistInjectionError, persistInjectionWarn } from "./injection-diagnostics";
import { readAllProjects } from "./handlers/project-helpers";
import type { StoredScript } from "../shared/script-config-types";
import type { MatchResult, ScriptBindingResolved } from "../shared/types";

/** Dedup TTL — absorb burst/double-fires from listener overlap (audit U-1). */
const DEDUP_TTL_MS = 5_000;
const AUTO_INJECT_LAUNCH_SOURCE: InjectionLaunchSource = "passive";

/* ------------------------------------------------------------------ */
/*  URL Guards                                                         */
/* ------------------------------------------------------------------ */

/** URL path prefixes that should never be auto-injected. */
const BLOCKED_PATHS = [
    "/login",
    "/signup",
    "/sign-up",
    "/sign-in",
    "/register",
    "/auth",
];

/** Returns true if the URL is a platform project page eligible for auto-injection. */
function isProjectPageUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const isTargetDomain = parsed.hostname === "lovable.dev"
            || parsed.hostname.endsWith(".lovable.dev");

        if (!isTargetDomain) {
            return true; // Non-platform URLs are handled by project URL rules
        }

        const path = parsed.pathname.toLowerCase();

        // Block root/home page
        const isHomePage = path === "/" || path === "";
        if (isHomePage) return false;

        // Block known non-project paths
        for (const blocked of BLOCKED_PATHS) {
            if (path.startsWith(blocked)) return false;
        }

        // Only allow /projects/* paths on lovable.dev
        return path.startsWith("/projects/");
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------ */
/*  Auto-Inject Filter                                                 */
/* ------------------------------------------------------------------ */

/** Reads the script store and returns a Set of script IDs that have autoInject === false. */
async function getManualOnlyScriptIds(): Promise<Set<string>> {
    const result = await chrome.storage.local.get(STORAGE_KEY_ALL_SCRIPTS);
    const scripts: StoredScript[] = result[STORAGE_KEY_ALL_SCRIPTS] ?? [];
    const manualOnly = new Set<string>();

    for (const script of scripts) {
        if (script.autoInject === false) {
            manualOnly.add(script.id);
        }
    }

    return manualOnly;
}

/** Filters out resolved scripts that are manual-only. */
function filterAutoInjectOnly(
    scripts: ResolvedScript[],
    manualOnlyIds: Set<string>,
): ResolvedScript[] {
    return scripts.filter((s) => !manualOnlyIds.has(s.injectable.id));
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Registers all auto-injection triggers (T1 load, T2 refresh, T3 tab activation).
 * See `.lovable/audits/2026-05-16-url-trigger-and-energy-audit.md` U-1/U-3.
 */
export function registerAutoInjector(): void {
    try {
        chrome.webNavigation.onCompleted.addListener(handleNavigationCompleted);
    } catch (err) {
        logCaughtError(BgLogTag.MARCO, "webNavigation.onCompleted registration failed", err);
    }
    try {
        chrome.tabs.onActivated.addListener((info) => {
            void handleTabActivated(info.tabId);
        });
    } catch (err) {
        logCaughtError(BgLogTag.MARCO, "tabs.onActivated registration failed", err);
    }
    try {
        chrome.tabs.onRemoved.addListener((tabId) => {
            clearTabDecision(tabId);
            clearDismissedOriginsForTab(tabId);
        });
    } catch (err) {
        logCaughtError(BgLogTag.MARCO, "tabs.onRemoved cache-clear registration failed", err);
    }
    console.log("[auto-injector] Registered T1/T2 (onCompleted) + T3 (onActivated) + cache-clear (onRemoved)");
}

/* ------------------------------------------------------------------ */
/*  Tab activation handler (T3)                                        */
/* ------------------------------------------------------------------ */

/**
 * Fired when the user switches to a different tab. Re-evaluates the
 * URL only if the cached fingerprint differs (or no cache exists).
 * Never re-injects if the URL is unchanged — that's the whole point
 * of the per-tab decision cache.
 */
export async function handleTabActivated(tabId: number): Promise<void> {
    let tab: chrome.tabs.Tab;
    try {
        tab = await chrome.tabs.get(tabId);
    } catch {
        return; // tab gone between event and lookup
    }
    const url = tab.url ?? "";
    if (!url || isNewTabOrBlankUrl(url)) return;
    if (!isProjectPageUrl(url)) return;
    if (isOriginDismissedForTab(tabId, url)) {
        console.log(
            `[auto-injector] AUTOATTACH_SKIPPED_USER_DISMISSED tab=${tabId} url=${url} trigger=activate`,
        );
        return;
    }

    const fp = urlFingerprint(url);
    if (isSameDecisionFingerprint(tabId, fp)) return; // T3 dedup — no work needed

    await processPageNavigation(tabId, url, "activate");
}

/* ------------------------------------------------------------------ */
/*  Navigation Handler                                                 */
/* ------------------------------------------------------------------ */

/** Handles page navigation completions. Exported for testing. */
export async function handleNavigationCompleted(
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
): Promise<void> {
    const isSubFrame = details.frameId !== 0;

    if (isSubFrame) {
        return;
    }

    // New-tab / empty-URL guard (v2.249.5) — see mem://features/new-tab-no-url-guard
    if (isNewTabOrBlankUrl(details.url)) {
        console.log(
            `[new-tab-guard] skipped url="${details.url ?? ""}" tabId=${details.tabId}`,
        );
        return;
    }

    // URL guard: skip non-project pages
    const isEligible = isProjectPageUrl(details.url);

    if (!isEligible) {
        logUrlGuardSkip(details.tabId, details.url);
        return;
    }

    // Per-tab dismissed-origin short-circuit (Step B). User explicitly
    // dismissed the first-attach toast for this (tab, origin); skip everything
    // until tab close or origin change. See mem://features/auto-attach-policy.md.
    if (isOriginDismissedForTab(details.tabId, details.url)) {
        console.log(
            `[auto-injector] AUTOATTACH_SKIPPED_USER_DISMISSED tab=${details.tabId} url=${details.url} trigger=load`,
        );
        return;
    }


    // TTL-based dedup: absorb listener double-fires (audit U-1 recommendation).
    // Reloads >5s apart still re-inject; bursts within 5s are squashed.
    const fp = urlFingerprint(details.url);
    const cached = getTabDecision(details.tabId);
    const isBurst = cached !== undefined
        && cached.urlFp === fp
        && (Date.now() - cached.decidedAt) < DEDUP_TTL_MS;
    if (isBurst) return;

    await processPageNavigation(details.tabId, details.url, "load");
}

/** Processes a top-frame navigation for script injection. */
// eslint-disable-next-line max-lines-per-function -- sequential pipeline; splitting harms readability
async function processPageNavigation(
    tabId: number,
    url: string,
    trigger: "load" | "refresh" | "activate",
): Promise<void> {
    const matches = await evaluateUrlMatches(url);

    // Cache the decision (even empty) so T3 activations don't re-run evaluateUrlMatches.
    setTabDecision(tabId, {
        urlFp: urlFingerprint(url),
        url,
        matches,
        trigger,
        decidedAt: Date.now(),
    });

    const isNoMatch = matches.length === 0;

    if (isNoMatch) {
        return;
    }

    const bindings = deduplicateScripts(matches);
    const conditionsOk = await checkFirstMatchConditions(tabId, matches);
    const isConditionFailed = !conditionsOk;

    if (isConditionFailed) {
        logConditionSkip(tabId, url);
        return;
    }

    // ✅ Self-heal: reseed missing built-in scripts before resolving
    // See: spec/22-app-issues/check-button/11-popup-injection-missing-guard.md (NR-11-A)
    const projects = await readAllProjects();
    await ensureBuiltinScriptsExist(projects);

    const resolution = await resolveScriptBindings(bindings);

    // Filter out manual-only scripts (autoInject === false)
    const manualOnlyIds = await getManualOnlyScriptIds();
    const autoInjectScripts = filterAutoInjectOnly(resolution.resolved, manualOnlyIds);
    const skippedCount = resolution.resolved.length - autoInjectScripts.length;

    if (skippedCount > 0) {
        console.log(
            `[auto-injector] Skipped ${skippedCount} manual-only script(s) in tab ${tabId}`,
        );
        void persistInjectionWarn(
            "AUTO_INJECT_MANUAL_ONLY_SKIPPED",
            `[auto-injector] Skipped ${skippedCount} manual-only script(s) in tab ${tabId}: ${url}`,
            { projectId: matches[0]?.projectId ?? getActiveProjectId() ?? undefined },
        );
    }

    if (autoInjectScripts.length === 0) {
        console.log(
            `[auto-injector] No auto-injectable scripts for tab ${tabId}: ${url}`,
        );
        return;
    }

    await injectResolvedScripts(tabId, autoInjectScripts);
    recordInjections(tabId, bindings, matches);
    logInjection(tabId, url, autoInjectScripts.length);

    // First-attach toast (C-UI): show once per origin asking the user
    // whether to keep auto-attaching here. No-op if seen or dismissed.
    try {
        await maybeShowFirstAttachToast(tabId, url);
    } catch (err) {
        logCaughtError(BgLogTag.MARCO, "first-attach toast inject failed", err);
    }
}

/* ------------------------------------------------------------------ */
/*  Condition Evaluation                                               */
/* ------------------------------------------------------------------ */

/** Evaluates conditions from the first matching rule. */
async function checkFirstMatchConditions(
    tabId: number,
    matches: MatchResult[],
): Promise<boolean> {
    const firstMatch = matches[0];
    const result = await evaluateConditions(tabId, firstMatch.conditions);

    return result.isMet;
}

/* ------------------------------------------------------------------ */
/*  Script Injection                                                   */
/* ------------------------------------------------------------------ */

/** Injects all resolved scripts into the tab sequentially. */
async function injectResolvedScripts(
    tabId: number,
    scripts: ResolvedScript[],
): Promise<void> {
    const sorted = sortByOrder(scripts);

    for (const script of sorted) {
        await injectSingleResolved(tabId, script);
    }
}

/** Injects a single resolved script into a tab with CSP fallback. */
async function injectSingleResolved(
    tabId: number,
    resolved: ResolvedScript,
): Promise<void> {
    try {
        const wrappedCode = wrapWithIsolation(
            resolved.injectable,
            resolved.configJson,
            resolved.themeJson,
            AUTO_INJECT_LAUNCH_SOURCE,
        );

        const result = await injectWithCspFallback(
            tabId,
            wrappedCode,
            resolved.world,
        );

        // Track injection path for diagnostics
        const injectionPath = result.world === "USER_SCRIPT"
            ? "userScripts"
            : result.isFallback && result.world === "ISOLATED"
                ? "isolated-blob"
                : "main-blob";

        // Store path on the tab injection record (will be set in recordInjections)
        (resolved as Record<string, unknown>).__injectionPath = injectionPath;

        const isFallbackUsed = result.isFallback;

        if (isFallbackUsed) {
            logCspFallbackUsed(resolved.injectable.id, tabId);
        }

        const isInjectionFailed = !result.isSuccess;

        if (isInjectionFailed) {
            logInjectionError(resolved.injectable.id, result.errorMessage);
        }
    } catch (injectionError) {
        logInjectionError(resolved.injectable.id, injectionError);
    }
}

/** Sorts resolved scripts by their execution order. */
function sortByOrder(scripts: ResolvedScript[]): ResolvedScript[] {
    return [...scripts].sort(
        (a, b) => a.injectable.order - b.injectable.order,
    );
}

/* ------------------------------------------------------------------ */
/*  State Recording                                                    */
/* ------------------------------------------------------------------ */

/** Records injection state for the tab (includes last-good bindings for P-009). */
function recordInjections(
    tabId: number,
    scripts: ScriptBindingResolved[],
    matches: MatchResult[],
): void {
    const scriptIds = scripts.map((s) => s.scriptId);
    const projectId = matches[0]?.projectId ?? getActiveProjectId() ?? "";
    const matchedRuleId = matches[0]?.ruleId ?? "";

    setTabInjection(tabId, {
        scriptIds,
        timestamp: new Date().toISOString(),
        projectId,
        matchedRuleId,
        lastGoodBindings: scripts,
        injectionPath: (scripts[scripts.length - 1] as Record<string, unknown>)?.__injectionPath as string | undefined,
    });
}

/* ------------------------------------------------------------------ */
/*  Logging                                                            */
/* ------------------------------------------------------------------ */

/** Logs a successful injection summary. */
function logInjection(
    tabId: number,
    url: string,
    scriptCount: number,
): void {
    console.log(
        `[auto-injector] Injected ${scriptCount} script(s) into tab ${tabId}: ${url}`,
    );
}

/** Logs a URL guard skip. */
function logUrlGuardSkip(tabId: number, url: string): void {
    console.log(
        `[auto-injector] URL guard: skipped non-project page tab ${tabId}: ${url}`,
    );
}

/** Logs a condition skip. */
function logConditionSkip(tabId: number, url: string): void {
    console.log(
        `[auto-injector] Conditions not met, skipped tab ${tabId}: ${url}`,
    );
}

/** Logs an injection error. */
function logInjectionError(
    scriptId: string,
    error: unknown,
): void {
    const errorMessage = error instanceof Error
        ? error.message
        : String(error);

    logCaughtError(
        BgLogTag.INJECTION,
        `Failed to inject ${scriptId}: ${errorMessage}`,
        error instanceof Error ? error : new Error(errorMessage),
        { scriptId, projectId: getActiveProjectId() ?? undefined },
    );

    void persistInjectionError(
        "AUTO_INJECT_FAILED",
        `[auto-injector] Failed to inject ${scriptId}: ${errorMessage}`,
        { scriptId, projectId: getActiveProjectId() ?? undefined },
    );
}

/** Logs a CSP fallback event. */
function logCspFallbackUsed(scriptId: string, tabId: number): void {
    logBgWarnError(
        BgLogTag.CSP_FALLBACK,
        `CSP fallback used for ${scriptId} in tab ${tabId}`,
    );

    void persistInjectionWarn(
        "AUTO_INJECT_CSP_FALLBACK",
        `[auto-injector] CSP fallback used for ${scriptId} in tab ${tabId}`,
        { scriptId, projectId: getActiveProjectId() ?? undefined },
    );
}
