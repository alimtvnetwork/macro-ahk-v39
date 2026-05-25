/**
 * Marco Extension — Injection Handler
 *
 * Handles INJECT_SCRIPTS and GET_TAB_INJECTIONS messages.
 * Uses chrome.scripting.executeScript with error isolation wrappers.
 * Before user scripts run, platform session cookies are seeded into localStorage.
 *
 * Dependency resolution: When the active project has dependencies,
 * dependency scripts are prepended in topological order (globals first).
 *
 * @see spec/05-chrome-extension/12-project-model-and-url-rules.md — Project model & URL matching
 * @see spec/05-chrome-extension/20-user-script-error-isolation.md — Error isolation wrappers
 * @see spec/21-app/02-features/devtools-and-injection/per-project-architecture.md — Per-project injection
 * @see .lovable/memory/architecture/injection-pipeline-optimization.md — Pipeline perf strategy
 * @see src/background/dependency-resolver.ts — Topological dependency sort
 */

import type { MessageRequest } from "../../shared/messages";
import { logBgWarnError, BgLogTag } from "../bg-logger";
import type { InjectableScript, InjectionLaunchSource, InjectionResult, InjectScriptsResponse } from "../../shared/injection-types";
import type { StoredProject, ScriptEntry } from "../../shared/project-types";
import {
    requestHasInlineSyntaxError,
    collectInlineSyntaxFailures,
    type InjectionRequestScript,
} from "./injection-syntax-preflight";
import { buildSkipMessage } from "./injection-result-builder";
import {
    getTabInjections,
    setTabInjection,
    getActiveProjectId,
} from "../state-manager";
import { seedTokensIntoTab } from "./token-seeder";
import { resolveInjectionRequestScripts } from "./injection-request-resolver";
import { readAllProjects } from "./project-helpers";
import { recordInjectionTiming } from "../injection-timing-history";
import { ensureBuiltinScriptsExist } from "../builtin-script-guard";
import { mirrorDiagnosticToTab, mirrorPipelineLogsToTab } from "../injection-diagnostics";
import { cacheGet, cacheDelete } from "../injection-cache";
import {
    isInjectionToastEnabled,
    showInjectionToastInTab,
    showInjectionFailureToastInTab,
    showInjectionLoadingToast,
} from "./injection-toast";
import {
    bootstrapNamespaceRoot,
    injectSettingsNamespace,
    injectProjectNamespaces,
} from "./injection-namespace-bootstrap";
import { prependDependencyScripts } from "./injection-dependency-builder";
import {
    PIPELINE_CACHE_KEY,
    PIPELINE_CACHE_CATEGORY,
    type PipelineCachePayload,
    buildRequestFingerprint,
    injectAllScripts,
    executeInTab,
} from "./injection-pipeline";


// Pipeline cache types/helpers + Stage 3/4 machinery moved to ./injection-pipeline (PERF-R2b step 5).
// Syntax preflight helpers moved to ./injection-syntax-preflight (PERF-R2b step 1).

/* ------------------------------------------------------------------ */
/*  INJECT_SCRIPTS                                                     */
/* ------------------------------------------------------------------ */

/** Injects scripts into the specified tab with error isolation. */
// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
export async function handleInjectScripts(
    message: MessageRequest,
): Promise<InjectScriptsResponse> {
    const pipelineStart = performance.now();
    const timings: Record<string, number> = {};

    const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
        const start = performance.now();
        const result = await fn();
        timings[label] = Math.round((performance.now() - start) * 10) / 10;
        return result;
    };

    const msg = message as MessageRequest & {
        tabId: number;
        scripts: ScriptEntry[];
        forceReload?: boolean;
        launchSource?: InjectionLaunchSource;
    };

    const isForceRun = msg.forceReload === true;
    const launchSource: InjectionLaunchSource = msg.launchSource === "passive" ? "passive" : "manual";

    // ── Early guard: skip injection on restricted URLs (chrome://, edge://, about:, etc.) ──
    try {
        const tab = await chrome.tabs.get(msg.tabId);
        const tabUrl = tab.url ?? "";
        if (/^(chrome|edge|brave|opera|about|devtools|chrome-extension):\/\//i.test(tabUrl)) {
            console.warn("[injection] BLOCKED — cannot inject into restricted URL: %s (tabId=%d)", tabUrl, msg.tabId);
            // v2.197.0: Field name corrected from `success` → `isSuccess` to
            // match the InjectionResult type used everywhere else in the
            // handler (see lines 181, 233, 491). The cast was masking the
            // typo, so callers (incl. e2e-script-injection) saw `undefined`
            // instead of `false` and asserted against the wrong field.
            return {
                results: (msg.scripts as Array<{ id?: string }>).map((s) => ({
                    scriptId: s.id ?? "unknown",
                    isSuccess: false,
                    errorMessage: `Cannot inject into restricted URL: ${tabUrl}`,
                })) as InjectionResult[],
                inlineSyntaxErrorDetected: false,
            };
        }
    } catch (tabErr) {
        console.warn("[injection] BLOCKED — tab %d is inaccessible (closed or discarded): %s", msg.tabId, (tabErr as Error).message);
        return { results: [], inlineSyntaxErrorDetected: false };
    }

    console.log("[injection] ── PIPELINE START ── tabId=%d, raw scripts=%d, forceReload=%s, launchSource=%s", msg.tabId, msg.scripts.length, isForceRun, launchSource);

    // Show loading spinner toast at start of injection
    const toastEnabledEarly = await isInjectionToastEnabled();
    if (toastEnabledEarly) {
        void showInjectionLoadingToast(msg.tabId, msg.scripts.length).catch((toastErr) => {
            logBgWarnError(BgLogTag.INJECTION, `showInjectionLoadingToast failed (tab ${msg.tabId}, ${msg.scripts.length} scripts) — UI cosmetic only, pipeline continues`, toastErr);
        });
    }

    // ── Force Run: clear cached payload before proceeding ──
    if (isForceRun) {
        await cacheDelete(PIPELINE_CACHE_CATEGORY, PIPELINE_CACHE_KEY);
        console.log("[injection] FORCE RUN — pipeline cache cleared by user");
    }

    if (isForceRun) {
        console.log(
            "[injection:syntax-preflight] SKIPPED — forceReload=true, syntax preflight bypassed (raw scripts=%d)",
            msg.scripts.length,
        );
    }
    const hasInlineSyntaxError = !isForceRun && requestHasInlineSyntaxError(msg.scripts as InjectionRequestScript[]);
    const inlineSyntaxFailures = hasInlineSyntaxError
        ? collectInlineSyntaxFailures(msg.scripts as InjectionRequestScript[])
        : [];
    if (hasInlineSyntaxError) {
        await cacheDelete(PIPELINE_CACHE_CATEGORY, PIPELINE_CACHE_KEY);
        console.warn(
            "[injection] CACHE BYPASS — inline syntax error detected in request, stale payload cleared. Failing scripts: [%s]",
            inlineSyntaxFailures.map((f) => `${f.scriptId} (${f.errorMessage ?? "no message"})`).join(" | "),
        );
    }

    // ── Cache Gate: check for cached wrapped payload ──
    // The cache is keyed by a singleton (`pipeline_payload`), so we MUST
    // validate that the cached scripts match the requested scripts before
    // serving the cached payload. Otherwise a previous successful run
    // shadows a new request — including bad-syntax requests that would
    // otherwise be reported as failures (see e2e syntax-error test).
    if (!isForceRun && !hasInlineSyntaxError) {
        const requestedFingerprint = buildRequestFingerprint(msg.scripts as Array<Partial<InjectableScript> & { path?: string }>);
        const cachedPayload = await time("cache_gate", () =>
            cacheGet<PipelineCachePayload>(PIPELINE_CACHE_CATEGORY, PIPELINE_CACHE_KEY));
        const cachedFingerprint = cachedPayload?.requestFingerprint ?? "";
        const cacheLaunchSource = cachedPayload?.launchSource;
        const cacheMatchesRequest = cachedPayload !== null
            && cachedFingerprint.length > 0
            && requestedFingerprint === cachedFingerprint
            && cacheLaunchSource === launchSource;
        if (cachedPayload && cacheMatchesRequest) {
            console.log("[injection] CACHE HIT — skipping Stages 0–3, using cached payload (%d chars, %d scripts) in %.1fms",
                cachedPayload.code.length, cachedPayload.scriptMeta.length, timings["cache_gate"]);
            // Jump directly to Stage 2 (env prep) + Stage 4 (execute) with cached payload
            return await executeCachedPayload(msg.tabId, cachedPayload, pipelineStart, timings, time);
        }
        if (cachedPayload && !cacheMatchesRequest) {
            await cacheDelete(PIPELINE_CACHE_CATEGORY, PIPELINE_CACHE_KEY);
            console.log("[injection] CACHE MISS — cached request fingerprint/source [%s/%s] does not match requested [%s/%s], rebuilding",
                cachedFingerprint || "missing", cacheLaunchSource, requestedFingerprint || "empty", launchSource);
        } else {
            console.log("[injection] CACHE MISS — proceeding through full pipeline (%.1fms)", timings["cache_gate"]);
        }
    }

    // ✅ 15.2: Read all projects ONCE, pass to all consumers
    const allProjects = await time("readAllProjects", () =>
        readAllProjects().catch(() => [] as StoredProject[]));

    // ✅ Auto-reseed missing built-in scripts before resolving
    const didReseedBuiltins = await time("stage0_guard", () => ensureBuiltinScriptsExist(allProjects));
    if (didReseedBuiltins) {
        await mirrorDiagnosticToTab(
            msg.tabId,
            "[builtin-guard] Missing built-in scripts were detected and reseeded from manifest",
            "warn",
        );
    }

    // Stage 0: Dependency resolution — prepend dependency project scripts
    const scriptsWithDeps = await time("stage0_deps", () => prependDependencyScripts(msg.scripts, allProjects));
    console.log("[injection] 0/4 DEPS     — %d scripts after dependency resolution (was %d)",
        scriptsWithDeps.length, msg.scripts.length);

    // Stage 1: Resolve
    const { prepared: preparedScripts, skipped: skippedScripts } = await time("stage1_resolve", () =>
        resolveInjectionRequestScripts(scriptsWithDeps));
    const syntaxFailureIds = new Set(inlineSyntaxFailures.map((result) => result.scriptId));
    const filteredPreparedScripts = preparedScripts.filter(
        (entry) => !syntaxFailureIds.has(entry.injectable.id),
    );
    const sorted = filteredPreparedScripts.map((entry) => entry.injectable);
    console.log("[injection] 1/4 RESOLVE  — %d scripts resolved, %d skipped in %.1fms: [%s]",
        sorted.length,
        skippedScripts.length,
        timings["stage1_resolve"],
        sorted.map((s) => s.name ?? s.id).join(", "));

    // Build skip results with explicit reasons
    const skipResults: InjectionResult[] = skippedScripts.map((s) => ({
        scriptId: s.scriptId,
        scriptName: s.scriptName,
        isSuccess: false,
        skipReason: s.reason,
        errorMessage: buildSkipMessage(s.reason, s.scriptName),
        durationMs: 0,
    }));
    const preflightFailureResults = [...inlineSyntaxFailures, ...skipResults];

    await mirrorSkippedResultsToTab(msg.tabId, preflightFailureResults);

    if (sorted.length === 0) {
        const totalMs = Math.round((performance.now() - pipelineStart) * 10) / 10;
        console.log("[injection] ── PIPELINE END (empty) ── total=%.1fms breakdown=%s",
            totalMs, JSON.stringify(timings));
        void mirrorPipelineLogsToTab(msg.tabId, [
            { msg: `[Marco] ── INJECTION PIPELINE (empty) ── 0 scripts resolved, ${preflightFailureResults.length} skipped/failed, ${totalMs}ms`, level: "warn" },
            ...preflightFailureResults.map((r) => ({
                msg: `[Marco]   ⏭ ${r.scriptName ?? r.scriptId} — ${r.errorMessage ?? r.skipReason ?? "skipped"}`,
                level: "warn" as const,
            })),
        ], `⚠️ Marco Injection — 0 scripts (${totalMs}ms)`);
        return {
            results: preflightFailureResults,
            inlineSyntaxErrorDetected: hasInlineSyntaxError,
        };
    }

    // ✅ 15.5: Parallelize independent stages 1.5, 2a, 2b
    await time("stage1_5_2a_2b_parallel", () => Promise.all([
        bootstrapNamespaceRoot(msg.tabId),
        ensureRelayInjected(msg.tabId),
        seedTokensIntoTab(msg.tabId),
    ]));
    console.log("[injection] 2/4 SEED     — bootstrap+relay+token completed in %.1fms", timings["stage1_5_2a_2b_parallel"]);

    // Stage 3 & 4: Wrap + Execute scripts
    // Stage 5a/5b: Namespace registration — runs IN PARALLEL with script injection
    // Namespaces are independent of script execution and can be injected concurrently.
    // Note: Config seeding was moved to project save handler (off injection hot path).
    const scriptInjectStart = performance.now();
    const nsInjectStart = performance.now();
    const [execResults] = await time("stage3_4_5_parallel", () => Promise.all([
        injectAllScripts(msg.tabId, filteredPreparedScripts, launchSource).then(r => {
            timings["stage3_4_scripts"] = Math.round((performance.now() - scriptInjectStart) * 10) / 10;
            return r;
        }),
        injectSettingsNamespace(msg.tabId, allProjects).then(() => {
            timings["stage5a_settings"] = Math.round((performance.now() - nsInjectStart) * 10) / 10;
        }),
        injectProjectNamespaces(msg.tabId, allProjects).then(() => {
            timings["stage5b_namespaces"] = Math.round((performance.now() - nsInjectStart) * 10) / 10;
        }),
    ]));

    const totalMs = Math.round((performance.now() - pipelineStart) * 10) / 10;
    const results = [...preflightFailureResults, ...execResults];

    const successCount = execResults.filter((r) => r.isSuccess).length;
    const failCount = execResults.length - successCount;

    console.log("[injection] ── TIMING ── total=%.1fms breakdown=%s",
        totalMs, JSON.stringify(timings));
    console.log("[injection] ── PIPELINE END ── %d/%d succeeded, %d skipped, total=%.1fms",
        successCount, execResults.length, skipResults.length, totalMs);
    console.log(
        "[injection] ── PERF NOTE ── Config seeding removed from injection hot path (moved to save-time). " +
        "Scripts: %.1fms | Settings NS: %.1fms | Project NS: %.1fms",
        timings["stage3_4_scripts"] ?? 0,
        timings["stage5a_settings"] ?? 0,
        timings["stage5b_namespaces"] ?? 0,
    );

    // ── Mirror full pipeline summary to tab console (visible in DevTools) ──
    type PipelineLine = { msg: string; level: "log" | "warn" | "error" | "__group__" | "__groupEnd__" };
    const pipelineLines: PipelineLine[] = [
        // ── Stage Summary sub-group ──
        { msg: `📊 Stage Summary (${totalMs}ms)`, level: "__group__" },
        { msg: `0/4 DEPS      ${scriptsWithDeps.length} scripts (${msg.scripts.length} raw + deps)`, level: "log" },
        { msg: `1/4 RESOLVE   ${sorted.length} resolved, ${preflightFailureResults.length} skipped/failed (${(timings["stage1_resolve"] ?? 0)}ms)`, level: "log" },
        { msg: `2/4 SEED      bootstrap+relay+token (${(timings["stage1_5_2a_2b_parallel"] ?? 0)}ms)`, level: "log" },
        { msg: `3/4 BATCH     ${sorted.length} scripts combined (${(timings["stage3_4_scripts"] ?? 0)}ms)`, level: "log" },
        { msg: `4/4 EXECUTE   ✅ ${successCount} succeeded, ${failCount} failed, ${preflightFailureResults.length} skipped/failed`, level: successCount > 0 ? "log" : "warn" },
        { msg: `TOTAL ${totalMs}ms — scripts:${(timings["stage3_4_scripts"] ?? 0)}ms | ns:${(timings["stage5a_settings"] ?? 0)}ms+${(timings["stage5b_namespaces"] ?? 0)}ms`, level: "log" },
        { msg: "", level: "__groupEnd__" },

        // ── Per-Script Results sub-group ──
        { msg: `📜 Per-Script Results (${execResults.length + preflightFailureResults.length})`, level: "__group__" },
    ];

    for (const r of execResults) {
        const icon = r.isSuccess ? "✅" : "❌";
        const via = r.injectionPath ? ` via ${r.injectionPath}` : "";
        pipelineLines.push({
            msg: `${icon} ${r.scriptName ?? r.scriptId} (${r.durationMs ?? 0}ms${via})`,
            level: r.isSuccess ? "log" : "error",
        });
    }
    for (const r of preflightFailureResults) {
        pipelineLines.push({
            msg: `⏭ ${r.scriptName ?? r.scriptId} — ${r.errorMessage ?? r.skipReason ?? "skipped"}`,
            level: "warn",
        });
    }

    pipelineLines.push({ msg: "", level: "__groupEnd__" });

    // Fire-and-forget: don't block pipeline on tab mirroring
    const groupIcon = failCount > 0 ? "❌" : "✅";
    void mirrorPipelineLogsToTab(msg.tabId, pipelineLines, `${groupIcon} Marco Injection — ${successCount}/${execResults.length} scripts (${totalMs}ms)`);

    // Performance budget alert — configurable via Settings > Injection Budget
    let budgetMs = 500;
    try {
        const { settings } = await handleGetSettings();
        budgetMs = settings.injectionBudgetMs ?? 500;
    } catch { /* use default */ } // allow-swallow: settings load failure falls back to default budget
    if (totalMs > budgetMs) {
        logBgWarnError(
            BgLogTag.INJECTION,
            `PERFORMANCE BUDGET EXCEEDED — ${totalMs}ms (budget: ${budgetMs}ms) breakdown=${JSON.stringify(timings)}`,
        );
        void mirrorDiagnosticToTab(
            msg.tabId,
            `[Marco] ⚠️ PERFORMANCE BUDGET EXCEEDED — ${totalMs}ms (budget: ${budgetMs}ms)`,
            "warn",
        );
    }

    // Record cumulative timing history
    recordInjectionTiming(totalMs, sorted.length, budgetMs);

    const lastSuccess = execResults.find((r) => r.isSuccess);
    const lastSuccessPath = lastSuccess?.injectionPath;
    const lastDomTarget = lastSuccess?.domTarget;
    recordInjection(msg.tabId, sorted, lastSuccessPath, lastDomTarget, totalMs, budgetMs);

    // ── Post-injection verification — confirm globals actually landed in MAIN world ──
    if (successCount > 0) {
        void verifyPostInjectionGlobals(msg.tabId).catch((verifyErr) => {
            logBgWarnError(BgLogTag.INJECTION, `verifyPostInjectionGlobals scheduling failed (tab ${msg.tabId}) — verification skipped, pipeline already succeeded`, verifyErr);
        });
    }

    // ── Show injection toasts if enabled ──
    const toastEnabled = await isInjectionToastEnabled();
    if (toastEnabled && successCount > 0) {
        void showInjectionToastInTab(msg.tabId, successCount, execResults.length, totalMs).catch((toastErr) => {
            logBgWarnError(BgLogTag.INJECTION, `showInjectionToastInTab (success) failed (tab ${msg.tabId}) — UI cosmetic only`, toastErr);
        });
    }
    if (toastEnabled && failCount > 0) {
        const failedNames = execResults.filter(r => !r.isSuccess).map(r => r.scriptName ?? r.scriptId);
        void showInjectionFailureToastInTab(msg.tabId, failedNames, failCount, execResults.length, totalMs).catch((toastErr) => {
            logBgWarnError(BgLogTag.INJECTION, `showInjectionFailureToastInTab failed (tab ${msg.tabId}, ${failCount} failed scripts) — UI cosmetic only`, toastErr);
        });
    }

    return { results, inlineSyntaxErrorDetected: hasInlineSyntaxError };
}


/**
 * Executes a cached wrapped payload, skipping Stages 0–3.
 * Still runs Stage 2 (env prep) and Stage 5 (namespaces) since those
 * are tab-specific and cannot be cached across tabs.
 */
// eslint-disable-next-line max-lines-per-function
async function executeCachedPayload(
    tabId: number,
    cached: PipelineCachePayload,
    pipelineStart: number,
    timings: Record<string, number>,
    time: <T>(label: string, fn: () => Promise<T>) => Promise<T>,
): Promise<InjectScriptsResponse> {
    const allProjects = await time("readAllProjects", () =>
        readAllProjects().catch(() => [] as StoredProject[]));

    // Stage 2: Tab environment prep (always needed per-tab)
    await time("stage2_env_prep", () => Promise.all([
        bootstrapNamespaceRoot(tabId),
        ensureRelayInjected(tabId),
        seedTokensIntoTab(tabId),
    ]));
    console.log("[injection] 2/4 SEED     — bootstrap+relay+token (cached path) in %.1fms", timings["stage2_env_prep"]);

    // Stage 4: Execute cached payload
    const execStart = performance.now();
    const execResult = await executeInTab(tabId, cached.code);
    const execMs = Math.round((performance.now() - execStart) * 10) / 10;
    timings["stage4_cached_exec"] = execMs;

    const results: InjectionResult[] = cached.scriptMeta.map((meta) => ({
        scriptId: meta.id,
        scriptName: meta.name,
        isSuccess: true,
        durationMs: execMs,
        injectionPath: execResult.path,
        domTarget: execResult.domTarget,
    }));

    console.log("[injection] 4/4 EXECUTE  — cached batch ✅ %d scripts via %s in %.1fms",
        cached.scriptMeta.length, execResult.path, execMs);

    // Stage 5: Namespaces (always needed per-tab)
    const nsStart = performance.now();
    await time("stage5_namespaces", () => Promise.all([
        injectSettingsNamespace(tabId, allProjects),
        injectProjectNamespaces(tabId, allProjects),
    ]));
    timings["stage5_ns"] = Math.round((performance.now() - nsStart) * 10) / 10;

    const totalMs = Math.round((performance.now() - pipelineStart) * 10) / 10;
    const successCount = results.length;

    console.log("[injection] ── PIPELINE END (cached) ── %d/%d succeeded, total=%.1fms breakdown=%s",
        successCount, results.length, totalMs, JSON.stringify(timings));

    // Post-pipeline: mirror, budget, verification, toast
    type PipelineLine = { msg: string; level: "log" | "warn" | "error" | "__group__" | "__groupEnd__" };
    const pipelineLines: PipelineLine[] = [
        { msg: `📊 Cached Pipeline (${totalMs}ms)`, level: "__group__" },
        { msg: `CACHE HIT — skipped Stages 0–3`, level: "log" },
        { msg: `2/4 SEED      ${(timings["stage2_env_prep"] ?? 0)}ms`, level: "log" },
        { msg: `4/4 EXECUTE   ✅ ${successCount} scripts via ${execResult.path} (${execMs}ms)`, level: "log" },
        { msg: `5/5 NS        ${(timings["stage5_ns"] ?? 0)}ms`, level: "log" },
        { msg: `TOTAL ${totalMs}ms`, level: "log" },
        { msg: "", level: "__groupEnd__" },
    ];
    void mirrorPipelineLogsToTab(tabId, pipelineLines, `✅ Marco Injection (cached) — ${successCount} scripts (${totalMs}ms)`);

    let budgetMs = 500;
    try {
        const { settings } = await handleGetSettings();
        budgetMs = settings.injectionBudgetMs ?? 500;
    } catch { /* use default */ } // allow-swallow: settings load failure falls back to default budget
    if (totalMs > budgetMs) {
        logBgWarnError(BgLogTag.INJECTION, `PERFORMANCE BUDGET EXCEEDED (cached path) — ${totalMs}ms (budget: ${budgetMs}ms)`);
    }

    recordInjectionTiming(totalMs, successCount, budgetMs);

    const scripts = cached.scriptMeta.map((m) => ({ id: m.id, name: m.name, code: "" })) as unknown as InjectableScript[];
    recordInjection(tabId, scripts, execResult.path, execResult.domTarget, totalMs, budgetMs);

    if (successCount > 0) {
        void verifyPostInjectionGlobals(tabId).catch((verifyErr) => {
            logBgWarnError(BgLogTag.INJECTION, `verifyPostInjectionGlobals (cached path) scheduling failed (tab ${tabId}) — verification skipped`, verifyErr);
        });
    }

    const toastEnabled = await isInjectionToastEnabled();
    if (toastEnabled && successCount > 0) {
        void showInjectionToastInTab(tabId, successCount, results.length, totalMs).catch((toastErr) => {
            logBgWarnError(BgLogTag.INJECTION, `showInjectionToastInTab (cached path success) failed (tab ${tabId}) — UI cosmetic only`, toastErr);
        });
    }

    // Cached path skips the syntax preflight entirely (only reachable when
    // the request fingerprint matches a previously-validated payload), so
    // the inline-syntax flag is always false here.
    return { results, inlineSyntaxErrorDetected: false };
}


// injectAllScripts / partitionBySyntax / injectSingleScript / logInjection* moved to ./injection-pipeline (PERF-R2b step 5).

/** Mirrors skipped-script diagnostics into the active tab console. */
async function mirrorSkippedResultsToTab(
    tabId: number,
    results: InjectionResult[],
): Promise<void> {
    const skipped = results.filter((result) => result.skipReason);

    if (skipped.length === 0) {
        return;
    }

    const detailLines = skipped.map((result) =>
        `- ${result.scriptName ?? result.scriptId}: ${result.errorMessage ?? "skipped"}`,
    ).join("\n");

    await mirrorDiagnosticToTab(
        tabId,
        `[injection] ${skipped.length} script(s) skipped during manual run\n${detailLines}`,
        "warn",
    );
}

// executeInTab moved to ./injection-pipeline (PERF-R2b step 5).

// buildSuccessResult / resolveInjectionPath / buildErrorResult moved to ./injection-result-builder (PERF-R2b step 3).

/** Records the injection in the state manager. */
function recordInjection(tabId: number, scripts: InjectableScript[], injectionPath?: string, domTarget?: string, pipelineDurationMs?: number, budgetMs?: number): void {
    const scriptIds = scripts.map((s) => s.id);
    const projectId = getActiveProjectId() ?? "";

    setTabInjection(tabId, {
        scriptIds,
        timestamp: new Date().toISOString(),
        projectId,
        matchedRuleId: "",
        injectionPath,
        domTarget,
        pipelineDurationMs,
        budgetMs,
    });
}

// buildSkipMessage moved to ./injection-result-builder (PERF-R2b step 3).



/* ------------------------------------------------------------------ */
/*  Relay Injection (safety net for content_scripts manifest entry)     */
/* ------------------------------------------------------------------ */

const relayInjectedTabs = new Set<number>();

/**
 * ✅ 15.6: Optimized relay injection — single combined probe-and-inject.
 * Reduces from 2-4 executeScript IPC calls to 1-2.
 */
// eslint-disable-next-line max-lines-per-function
async function ensureRelayInjected(tabId: number): Promise<void> {
    if (relayInjectedTabs.has(tabId)) {
        return;
    }

    try {
        // Single probe: check sentinel + runtime health in one call
        const [probeResult] = await chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: async () => {
                const hasSentinel = !!(window as unknown as Record<string, unknown>).__marcoRelayActive;
                if (!hasSentinel) return { status: "needs_injection" as const };

                try {
                    const ping = await chrome.runtime.sendMessage({ type: "__PING__" });
                    // Accept both `{ isOk: true }` (legacy) and `{ type: '__PONG__' }`
                    // (current) reply shapes — the router contract changed in v2.200.
                    const pingObj = typeof ping === "object" && ping !== null
                        ? ping as { isOk?: boolean; type?: string }
                        : null;
                    const isHealthy = pingObj !== null
                        && (pingObj.isOk === true || pingObj.type === "__PONG__");
                    if (isHealthy) return { status: "healthy" as const };
                } catch (pingErr) {
                    // Runtime stale — fall through to needs_injection. Breadcrumb only;
                    // runs in MAIN world, so no namespace logger available.
                    console.debug("[injection] relay ping failed — runtime stale, marking needs_injection:", pingErr);
                }

                // Sentinel exists but runtime is stale — clear sentinel for reinjection
                delete (window as unknown as Record<string, unknown>).__marcoRelayActive;
                return { status: "needs_injection" as const };
            },
        });

        const status = (probeResult?.result as { status: string } | undefined)?.status;

        if (status === "healthy") {
            relayInjectedTabs.add(tabId);
            return;
        }

        // Inject the relay content script (only when needed)
        await chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            files: ["content-scripts/message-relay.js"],
        });

        relayInjectedTabs.add(tabId);
        console.log("[injection] Message relay injected into tab %d (safety net)", tabId);
    } catch (relayError) {
        logCaughtError(BgLogTag.INJECTION, "Failed to inject message relay", relayError);
    }
}


/*  GET_TAB_INJECTIONS                                                 */
/* ------------------------------------------------------------------ */

/** Returns injection status for all scripts in a tab. */
export async function handleGetTabInjections(
    message: MessageRequest,
): Promise<{ injections: Record<number, unknown> }> {
    const msg = message as MessageRequest & { tabId: number };
    const allInjections = getTabInjections();
    const hasTabId = msg.tabId !== undefined;

    if (hasTabId) {
        const tabRecord = allInjections[msg.tabId] ?? null;
        return { injections: { [msg.tabId]: tabRecord } };
    }

    return { injections: allInjections };
}



/* ------------------------------------------------------------------ */
/*  Post-injection verification                                        */
/* ------------------------------------------------------------------ */

/**
 * Runs a lightweight check in the MAIN world to confirm that key globals
 * (marco SDK, MacroController, RiseupAsiaMacroExt, and the UI container)
 * actually exist after injection. Logs a detailed verification report to
 * the tab console so false-positive "SCRIPT_INJECTED" entries are caught.
 */
// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
async function verifyPostInjectionGlobals(tabId: number): Promise<void> {
    try {
        const [frameResult] = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: () => {
                const win = window as unknown as Record<string, unknown>;
                const marcoSdk = typeof win.marco === "object" && win.marco !== null;
                const extRoot = typeof win.RiseupAsiaMacroExt === "object" && win.RiseupAsiaMacroExt !== null;
                const mcClass = typeof (win as Record<string, unknown>).MacroController === "function";
                const extRootObj = win.RiseupAsiaMacroExt as Record<string, Record<string, Record<string, Record<string, unknown>>>> | undefined;
                const mcInstance = !!(
                    extRoot &&
                    extRootObj?.Projects?.MacroController?.api?.mc
                );
                const uiContainer = !!document.getElementById("macro-loop-container");
                const markerEl = !!document.querySelector("[data-marco-injected]");

                // Capture diagnostic stack trace at verification point for dev debugging
                const verifyStack = new Error("[DEV] post-injection verification snapshot").stack ?? "";

                return { marcoSdk, extRoot, mcClass, mcInstance, uiContainer, markerEl, verifyStack };
            },
        });

        const r = frameResult?.result as {
            marcoSdk: boolean;
            extRoot: boolean;
            mcClass: boolean;
            mcInstance: boolean;
            uiContainer: boolean;
            markerEl: boolean;
            verifyStack: string;
        } | undefined;

        if (!r) return;

        const allOk = r.marcoSdk && r.extRoot && r.mcClass && r.mcInstance && r.uiContainer;
        const status = allOk ? "✅ VERIFIED" : "⚠️ INCOMPLETE";

        const lines: Array<{ msg: string; level: "log" | "warn" | "error" }> = [
            { msg: `window.marco (SDK)           : ${r.marcoSdk ? "✅" : "❌"}`, level: r.marcoSdk ? "log" : "error" },
            { msg: `window.RiseupAsiaMacroExt     : ${r.extRoot ? "✅" : "❌"}`, level: r.extRoot ? "log" : "error" },
            { msg: `window.MacroController (class): ${r.mcClass ? "✅" : "❌"}`, level: r.mcClass ? "log" : "error" },
            { msg: `api.mc (singleton instance)   : ${r.mcInstance ? "✅" : "❌"}`, level: r.mcInstance ? "log" : "warn" },
            { msg: `#macro-loop-container (UI)    : ${r.uiContainer ? "✅" : "❌"}`, level: r.uiContainer ? "log" : "warn" },
            { msg: `[data-marco-injected] marker  : ${r.markerEl ? "✅" : "⚠️ (not required)"}`, level: "log" },
        ];

        if (!allOk) {
            lines.push({ msg: `── Stack at verification point ──`, level: "warn" });
            lines.push({ msg: r.verifyStack, level: "warn" });
        }

        void mirrorPipelineLogsToTab(tabId, lines, `${status} Post-Injection Verification`);

        // Store verification results on the tab injection record for diagnostics copy
        const existingRecord = getTabInjections()[tabId];
        if (existingRecord) {
            setTabInjection(tabId, {
                ...existingRecord,
                verification: {
                    marcoSdk: r.marcoSdk,
                    extRoot: r.extRoot,
                    mcClass: r.mcClass,
                    mcInstance: r.mcInstance,
                    uiContainer: r.uiContainer,
                    markerEl: r.markerEl,
                    verifiedAt: new Date().toISOString(),
                },
            });
        }

        if (!allOk) {
            logBgWarnError(
                BgLogTag.INJECTION,
                `Post-injection verification INCOMPLETE on tab ${tabId}: ` +
                `sdk=${r.marcoSdk} ext=${r.extRoot} mc=${r.mcClass} instance=${r.mcInstance} ui=${r.uiContainer}\n` +
                `Verify stack: ${r.verifyStack}`,
        );
        }
    } catch (verifyErr) {
        // Verification is best-effort — never block the pipeline. Emit a warn so the
        // suppressed verifier failure is at least visible in the diagnostic dump.
        logBgWarnError(BgLogTag.INJECTION, `Post-injection verifier itself threw on tab ${tabId} — verification skipped`, verifyErr);
    }
}

