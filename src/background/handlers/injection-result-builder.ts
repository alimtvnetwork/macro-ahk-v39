/**
 * Marco Extension — Injection Result Builder
 *
 * Pure-function constructors for `InjectionResult` records, plus the
 * small string-formatting helpers that surround them. Extracted from
 * `injection-handler.ts` (PERF-R2b step 3).
 *
 * These helpers deliberately have no I/O, no chrome.* dependencies, and
 * no state-manager imports — that makes them straight-line unit-testable
 * (step 4) and lets the `injection-pipeline.ts` orchestrator (step 5)
 * import them without circular dependencies.
 *
 * Catch-block `unknown` is the documented `CaughtError` exception in
 * `mem://standards/unknown-usage-policy`.
 *
 * @see src/background/handlers/injection-handler.ts — pipeline consumer
 * @see src/shared/injection-types.ts — InjectionResult contract
 * @see src/background/csp-fallback.ts — CspInjectionResult source
 */

import type { InjectionResult, SkipReason } from "../../shared/injection-types";
import type { CspInjectionResult } from "../csp-fallback";
import { logBgWarnError, BgLogTag } from "../bg-logger";

/**
 * Builds a successful `InjectionResult`. `injectionPath` and `domTarget`
 * are surfaced to the popup for the per-script results table.
 */
export function buildSuccessResult(
    scriptId: string,
    startTime: number,
    injectionPath?: string,
    domTarget?: string,
): InjectionResult {
    return {
        scriptId,
        isSuccess: true,
        durationMs: Date.now() - startTime,
        injectionPath,
        domTarget,
    };
}

/**
 * Builds a failed `InjectionResult` and emits a single background-log
 * warning so the operator can correlate failed scripts with telemetry
 * without scraping the per-script results table.
 */
export function buildErrorResult(
    scriptId: string,
    startTime: number,
    error: unknown,
): InjectionResult {
    const errorMessage = error instanceof Error
        ? error.message
        : String(error);

    logBgWarnError(BgLogTag.INJECTION, `Script ${scriptId} failed: ${errorMessage}`);

    return {
        scriptId,
        isSuccess: false,
        errorMessage,
        durationMs: Date.now() - startTime,
    };
}

/**
 * Maps a `CspInjectionResult.world` into the human-readable injection
 * path label surfaced to the popup. USER_SCRIPT > MAIN-blob > ISOLATED
 * blob fallback is the documented preference order in
 * `spec/05-chrome-extension/20-user-script-error-isolation.md`.
 */
export function resolveInjectionPath(result: CspInjectionResult): string {
    if (result.world === "USER_SCRIPT") return "userScripts";
    if (result.isFallback && result.world === "ISOLATED") return "isolated-blob";
    return "main-blob";
}

/**
 * Builds a user-facing message explaining why a script was skipped
 * during resolution. Used by the per-script results UI; messages are
 * tuned to read clearly in the popup without operator context.
 */
export function buildSkipMessage(reason: SkipReason, scriptName: string): string {
    switch (reason) {
        case "disabled":
            return `Script "${scriptName}" is disabled — enable it in the Scripts panel to inject.`;
        case "missing":
            return `Script "${scriptName}" not found in storage — it may have been deleted or not yet seeded.`;
        case "resolver_mismatch":
            return `Script "${scriptName}" could not be resolved — the format doesn't match any known script type.`;
        case "empty_code":
            return `Script "${scriptName}" was skipped — its code is empty.`;
        default:
            return `Script "${scriptName}" was skipped (unknown reason).`;
    }
}

/**
 * Extracts a `VERSION = 'x.y.z'` constant from macro-looping script
 * source. Used by the success-logger to detect stale-cache injections
 * (when the injected version disagrees with the extension version).
 * Returns null when the pattern is not present.
 */
export function extractMacroVersion(code: string): string | null {
    const match = code.match(/VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
    return match?.[1] ?? null;
}

/**
 * Builds an `InjectionResult` for a script that failed its syntax
 * preflight inside `partitionBySyntax`. Centralizing the shape here
 * keeps the failure record in lockstep with `buildErrorResult`.
 */
export function buildSyntaxFailureResult(
    scriptId: string,
    scriptName: string | undefined,
    errorMessage: string,
    startTime: number,
): InjectionResult {
    return {
        scriptId,
        scriptName,
        isSuccess: false,
        durationMs: Date.now() - startTime,
        errorMessage,
    };
}
