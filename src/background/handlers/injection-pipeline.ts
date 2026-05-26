/**
 * Marco Extension — Injection Pipeline (Stages 3 & 4)
 *
 * Extracted from `injection-handler.ts` (PERF-R2b step 5).
 *
 * Owns the per-script wrap+execute machinery:
 *   - `injectAllScripts`     — batch/sequential orchestrator
 *   - `partitionBySyntax`    — pre-flight syntax filter
 *   - `injectSingleScript`   — fallback single-script path (incl. CSS)
 *   - `executeInTab`         — CSP-aware `executeScript` wrapper
 *   - Pipeline cache helpers + types (fingerprint, hash, payload shape)
 *
 * Stages 0–2 (deps, resolve, env prep) and Stage 5 (namespaces) remain
 * in `injection-handler.ts` so the orchestrator there continues to own
 * the overall pipeline narrative + logging.
 *
 * @see src/background/handlers/injection-handler.ts — Pipeline orchestrator
 * @see src/background/handlers/injection-syntax-preflight.ts — Step 1
 * @see src/background/handlers/injection-result-builder.ts — Step 3
 */

import { MessageType, type MessageRequest } from "../../shared/messages";
import type { InjectableScript, InjectionLaunchSource, InjectionResult } from "../../shared/injection-types";
import { logBgWarnError, logCaughtError, BgLogTag } from "../bg-logger";
import { wrapWithIsolation } from "./injection-wrapper";
import { injectWithCspFallback } from "../csp-fallback";
import { detectSyntaxError } from "./injection-syntax-preflight";
import {
    buildSuccessResult,
    buildErrorResult,
    resolveInjectionPath,
    buildSyntaxFailureResult,
} from "./injection-result-builder";
import { handleLogEntry, handleLogError } from "./logging-handler";
import { getActiveProjectId } from "../state-manager";
import { cacheSet } from "../injection-cache";
import type { CacheCategory } from "../injection-cache";
import { EXTENSION_VERSION } from "../../shared/constants";
import { getScriptIdentity } from "./injection-dependency-builder";

/* ------------------------------------------------------------------ */
/*  Pipeline cache types + helpers                                     */
/* ------------------------------------------------------------------ */

export const PIPELINE_CACHE_KEY = "pipeline_payload" as const;
export const PIPELINE_CACHE_CATEGORY: CacheCategory = "scripts";

export type PipelineCacheMeta = {
    id: string;
    name: string;
    order: number;
    codeHash: string;
};

export type PipelineCachePayload = {
    code: string;
    scriptMeta: PipelineCacheMeta[];
    requestFingerprint: string;
    launchSource?: InjectionLaunchSource;
};

export function hashScriptCode(code: string): string {
    let hash = 0;
    for (let i = 0; i < code.length; i += 1) {
        hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

export function buildRequestFingerprint(
    scripts: Array<Partial<InjectableScript> & { path?: string }>,
): string {
    return [...scripts]
        .sort((a, b) => {
            const orderDiff = (a.order ?? 0) - (b.order ?? 0);
            if (orderDiff !== 0) return orderDiff;
            const aKey = getScriptIdentity(a) ?? "";
            const bKey = getScriptIdentity(b) ?? "";
            return aKey.localeCompare(bKey);
        })
        .map((script) => {
            const scriptKey = getScriptIdentity(script) ?? "unknown";
            return [
                scriptKey,
                script.name ?? scriptKey,
                String(script.order ?? 0),
                typeof script.code === "string" ? hashScriptCode(script.code) : "store",
            ].join(":");
        })
        .join("|");
}

/* ------------------------------------------------------------------ */
/*  Prepared script shape                                              */
/* ------------------------------------------------------------------ */

export type PreparedScript = {
    injectable: InjectableScript;
    configJson: string | null;
    themeJson: string | null;
    codeSource?: string;
};

/* ------------------------------------------------------------------ */
/*  Stage 3 & 4 — Batch/sequential injection                           */
/* ------------------------------------------------------------------ */

/**
 * Batch script injection — concatenates wrapped scripts into a single
 * executeScript call when possible. Scripts with CSS assets are injected
 * individually (CSS must precede their JS). Falls back to sequential on failure.
 */
// eslint-disable-next-line max-lines-per-function
export async function injectAllScripts(
    tabId: number,
    scripts: PreparedScript[],
    launchSource: InjectionLaunchSource = "manual",
    forceReload = false,
): Promise<InjectionResult[]> {
    if (scripts.length === 0) return [];

    const startTime = Date.now();
    const projectId = getActiveProjectId() ?? undefined;

    const results: InjectionResult[] = [];

    const orderedScripts = [...scripts].sort((a, b) => {
        const aOrder = a.injectable.order ?? 0;
        const bOrder = b.injectable.order ?? 0;
        return aOrder - bOrder;
    });

    // CRITICAL: preserve dependency order across CSS and non-CSS scripts.
    // If any script in the chain needs CSS, batching only the non-CSS subset can
    // execute a dependent script before its prerequisites. In that case, inject
    // the full ordered chain sequentially.
    const hasCssScript = orderedScripts.some((s) => Boolean(s.injectable.assets?.css));
    if (hasCssScript) {
        console.log("[injection] 3/4 ORDER    — CSS-bearing chain detected, forcing sequential ordered injection (%d scripts)", orderedScripts.length);
        for (const script of orderedScripts) {
            const result = await injectSingleScript(tabId, script.injectable, script.configJson, script.themeJson, script.codeSource, launchSource, forceReload);
            results.push(result);
        }
        return results;
    }

    // Pre-flight syntax validation: scripts that fail to parse must be
    // reported as failures, NOT slipped into the batch where userScripts
    // .execute() would silently swallow the parse error and mark them OK.
    const { good: goodScripts, syntaxFailures } = partitionBySyntax(
        orderedScripts,
        startTime,
        projectId,
    );
    results.push(...syntaxFailures);

    if (goodScripts.length > 0) {
        try {
            const wrappedParts: string[] = [];
            const scriptMeta: PipelineCacheMeta[] = [];

            for (const script of goodScripts) {
                const wrapped = wrapWithIsolation(script.injectable, script.configJson, script.themeJson, launchSource, forceReload);
                wrappedParts.push(wrapped);
                scriptMeta.push({
                    id: script.injectable.id,
                    name: script.injectable.name ?? script.injectable.id,
                    order: script.injectable.order ?? 0,
                    codeHash: hashScriptCode(script.injectable.code),
                });
            }

            const combinedCode = wrappedParts.join("\n;\n");
            const requestFingerprint = buildRequestFingerprint(
                goodScripts.map((script) => script.injectable),
            );
            console.log("[injection] 3/4 BATCH    — %d scripts combined (%d chars)", goodScripts.length, combinedCode.length);

            void cacheSet(PIPELINE_CACHE_CATEGORY, { code: combinedCode, scriptMeta, requestFingerprint, launchSource }, PIPELINE_CACHE_KEY)
                .then(() => console.log("[injection] CACHE STORE — payload cached for version=%s, size=%d bytes", EXTENSION_VERSION, combinedCode.length))
                .catch(() => { /* best-effort cache write */ }); // allow-swallow: best-effort IndexedDB cache write

            const execResult = await executeInTab(tabId, combinedCode);
            const durationMs = Date.now() - startTime;

            for (const meta of scriptMeta) {
                results.push({
                    scriptId: meta.id,
                    scriptName: meta.name,
                    isSuccess: true,
                    durationMs,
                    injectionPath: execResult.path,
                    domTarget: execResult.domTarget,
                });
                const matchedScript = goodScripts.find(s => s.injectable.id === meta.id)!;
                logInjectionSuccess(
                    matchedScript.injectable,
                    projectId,
                    matchedScript.codeSource,
                ).catch((logErr) => {
                    logBgWarnError(BgLogTag.INJECTION, `logInjectionSuccess self-failed for "${matchedScript.injectable.name ?? matchedScript.injectable.id}" (batch path) — telemetry suppressed but injection succeeded`, logErr);
                });
            }

            console.log("[injection] 4/4 EXECUTE  — batch ✅ %d scripts via %s in %dms",
                scriptMeta.length, execResult.path, durationMs);
        } catch (batchError) {
            logCaughtError(BgLogTag.INJECTION, "Batch injection failed, falling back to sequential", batchError);
            for (const script of goodScripts) {
                const result = await injectSingleScript(tabId, script.injectable, script.configJson, script.themeJson, script.codeSource, launchSource, forceReload);
                results.push(result);
            }
        }
    }

    return results;
}

/**
 * Splits a list of prepared scripts into the ones that parse cleanly and a
 * ready-to-return failure list for the ones that do not.
 */
export function partitionBySyntax(
    scripts: PreparedScript[],
    startTime: number,
    projectId: string | undefined,
): { good: PreparedScript[]; syntaxFailures: InjectionResult[] } {
    const good: PreparedScript[] = [];
    const syntaxFailures: InjectionResult[] = [];
    for (const script of scripts) {
        const syntaxError = detectSyntaxError(script.injectable.code);
        if (syntaxError === null) {
            good.push(script);
            continue;
        }
        const errorMessage = `Script "${script.injectable.name ?? script.injectable.id}" has a syntax error: ${syntaxError}`;
        logBgWarnError(BgLogTag.INJECTION, `3/4 SYNTAX — ${errorMessage}`);
        syntaxFailures.push(buildSyntaxFailureResult(
            script.injectable.id,
            script.injectable.name,
            errorMessage,
            startTime,
        ));
        logInjectionFailure(script.injectable, projectId, new SyntaxError(syntaxError)).catch((logErr) => {
            logCaughtError(BgLogTag.INJECTION, `logInjectionFailure self-failed for "${script.injectable.name ?? script.injectable.id}" (syntax stage)`, logErr);
        });
    }
    return { good, syntaxFailures };
}

/** Injects one script into a tab and logs the result. */
// eslint-disable-next-line max-lines-per-function
export async function injectSingleScript(
    tabId: number,
    script: InjectableScript,
    resolvedConfigJson: string | null,
    resolvedThemeJson: string | null,
    resolvedCodeSource?: string,
    launchSource: InjectionLaunchSource = "manual",
    forceReload = false,
): Promise<InjectionResult> {
    const startTime = Date.now();
    const configJson = resolvedConfigJson;
    const projectId = getActiveProjectId() ?? undefined;

    const syntaxError = detectSyntaxError(script.code);
    if (syntaxError !== null) {
        const errorMessage = `Script "${script.name}" has a syntax error: ${syntaxError}`;
        logBgWarnError(BgLogTag.INJECTION, `3/4 SYNTAX — ${errorMessage}`);
        logInjectionFailure(script, projectId, new SyntaxError(syntaxError)).catch((logErr) => {
            logCaughtError(BgLogTag.INJECTION, `logInjectionFailure self-failed for "${script.name}" (single-script syntax stage)`, logErr);
        });
        return buildErrorResult(script.id, startTime, new SyntaxError(syntaxError));
    }

    if (script.assets?.css) {
        try {
            const cssPath = script.assets.css.startsWith("projects/")
                ? script.assets.css
                : `projects/scripts/${script.assets.css}`;
            await chrome.scripting.insertCSS({
                target: { tabId },
                files: [cssPath],
            });
            console.log("[injection] CSS      — \"%s\" injected %s (tab %d)",
                script.name, script.assets.css, tabId);
        } catch (cssError) {
            logCaughtError(BgLogTag.INJECTION, `CSS "${script.name}" failed to inject ${script.assets.css}`, cssError);
        }
    }

    console.log("[injection] 3/4 WRAP     — \"%s\" (id=%s) configBinding=%s hasConfig=%s hasTheme=%s codeLen=%d",
        script.name, script.id, script.configBinding ?? "none",
        configJson !== null, resolvedThemeJson !== null, script.code.length);

    try {
        const wrappedCode = wrapWithIsolation(script, configJson, resolvedThemeJson, launchSource, forceReload);
        console.log("[injection] 3/4 WRAP     — wrapped code length: %d chars", wrappedCode.length);

        const execStart = performance.now();
        const execResult = await executeInTab(tabId, wrappedCode);
        console.log("[injection] 4/4 EXECUTE  — \"%s\" ✅ success via %s (target: %s) in %.1fms (tab %d)",
            script.name, execResult.path, execResult.domTarget, performance.now() - execStart, tabId);

        logInjectionSuccess(script, projectId, resolvedCodeSource).catch((logErr) => {
            logBgWarnError(BgLogTag.INJECTION, `logInjectionSuccess self-failed for "${script.name}" (single-script path) — telemetry suppressed but injection succeeded`, logErr);
        });
        return buildSuccessResult(script.id, startTime, execResult.path, execResult.domTarget);
    } catch (injectionError) {
        logCaughtError(BgLogTag.INJECTION, `4/4 EXECUTE — "${script.name}" failed`, injectionError);

        logInjectionFailure(script, projectId, injectionError).catch((logErr) => {
            logCaughtError(BgLogTag.INJECTION, `logInjectionFailure self-failed for "${script.name}" (execute stage)`, logErr);
        });
        return buildErrorResult(script.id, startTime, injectionError);
    }
}

/** Executes wrapped code in the specified tab using CSP-aware fallback. */
export async function executeInTab(tabId: number, code: string): Promise<{ path: string; domTarget?: string }> {
    const result = await injectWithCspFallback(tabId, code, "MAIN");

    if (!result.isSuccess) {
        throw new Error(result.errorMessage ?? "Injection failed in MAIN and ISOLATED worlds.");
    }

    if (result.isFallback) {
        logBgWarnError(
            BgLogTag.INJECTION,
            `Script executed via ${result.world} fallback (tab ${tabId}) — window.marco created in non-MAIN world, RiseupAsiaMacroExt.Projects.* may not be accessible from the page console.`,
        );
    }

    return { path: resolveInjectionPath(result), domTarget: result.domTarget ?? "unknown" };
}

/* ------------------------------------------------------------------ */
/*  Telemetry — success/failure logs                                   */
/* ------------------------------------------------------------------ */

import { extractMacroVersion } from "./injection-result-builder";

/** Logs a successful script injection to the logs DB. */
// eslint-disable-next-line max-lines-per-function
async function logInjectionSuccess(
    script: InjectableScript,
    projectId: string | undefined,
    codeSource?: string,
): Promise<void> {
    const codeSnippet = script.code.slice(0, 200);
    const sourceTag = codeSource ? ` [source: ${codeSource}]` : "";

    const scriptName = script.name ?? "";
    const isMacroLooping = scriptName.includes("macro-looping") || script.id.includes("macro-looping");
    if (isMacroLooping) {
        const injectedVersion = extractMacroVersion(script.code);
        if (injectedVersion && injectedVersion !== EXTENSION_VERSION) {
            const legacyMsg = `LEGACY SCRIPT DETECTED\n  Path: chrome.storage.local script="${scriptName}" id="${script.id}"\n  Missing: Current version macro-looping.js v${EXTENSION_VERSION}\n  Reason: Injected script is v${injectedVersion} but extension is v${EXTENSION_VERSION} — stale cache or embedded code fallback. Source: ${codeSource ?? "unknown"}`;
            logCaughtError(BgLogTag.INJECTION, legacyMsg, new Error(`LEGACY_SCRIPT_INJECTED v=${injectedVersion} expected=${EXTENSION_VERSION}`));
            try {
                await handleLogError({
                    type: MessageType.LOG_ERROR,
                    level: "ERROR",
                    source: "background",
                    category: "injection",
                    errorCode: "LEGACY_SCRIPT_INJECTED",
                    message: legacyMsg,
                    stackTrace: `Injected version: ${injectedVersion}, Expected: ${EXTENSION_VERSION}, Source: ${codeSource ?? "unknown"}, Code length: ${script.code.length}`,
                } as MessageRequest);
            } catch (logErr) {
                logBgWarnError(BgLogTag.INJECTION, `handleLogError(LEGACY_SCRIPT_INJECTED) failed for "${script.name}" — telemetry suppressed but injection continues`, logErr);
            }
        }
    }

    try {
        await handleLogEntry({
            type: "LOG_ENTRY",
            level: "INFO",
            source: "background",
            category: "INJECTION",
            action: "SCRIPT_INJECTED",
            detail: `Injected "${script.name}" (${script.code.length} chars${sourceTag}): ${codeSnippet}`,
            scriptId: script.id,
            projectId,
            configId: script.configBinding,
        } as MessageRequest);
    } catch (loggingError) {
        logCaughtError(BgLogTag.INJECTION, "logInjectionSuccess skipped", loggingError);
    }
}

/** Logs a failed script injection to the errors DB. */
async function logInjectionFailure(
    script: InjectableScript,
    projectId: string | undefined,
    error: unknown,
): Promise<void> {
    const errorMessage = error instanceof Error
        ? error.message
        : String(error);

    try {
        await handleLogError({
            type: "LOG_ERROR",
            level: "ERROR",
            source: "background",
            category: "INJECTION",
            errorCode: "INJECTION_FAILED",
            message: `Script "${script.name}" failed: ${errorMessage}`,
            scriptId: script.id,
            projectId,
            configId: script.configBinding,
            scriptFile: script.code.slice(0, 500),
        } as MessageRequest);
    } catch (loggingError) {
        logCaughtError(BgLogTag.INJECTION, "logInjectionFailure skipped", loggingError);
    }
}
