/**
 * Marco Extension — Injection Syntax Preflight
 *
 * Pure-function helpers that parse user-supplied script source with Acorn
 * BEFORE handing it to `chrome.userScripts.execute()` /
 * `chrome.scripting.executeScript()`, because those APIs swallow parse
 * failures silently and report success — see spec/22-app-issues for the
 * regression that broke the bad-syntax e2e test.
 *
 * Extracted from `injection-handler.ts` (PERF-R2b step 1). This module
 * deliberately depends only on Acorn and the shared injection types so it
 * can be exercised by integration tests in isolation (step 2).
 *
 * No `unknown` is used outside the documented `CaughtError` policy.
 *
 * @see src/background/handlers/injection-handler.ts — pipeline orchestrator
 * @see standalone-scripts/types/riseup-namespace.d.ts — namespace contract
 */

import { parse } from "acorn";
import type { InjectableScript, InjectionResult } from "../../shared/injection-types";
import type { ScriptEntry } from "../../shared/project-types";

/** A request entry as it may arrive from any caller (popup, shortcut, ctx menu). */
export type InjectionRequestScript =
    | ScriptEntry
    | InjectableScript
    | Record<string, string | number | boolean | null | undefined>;

/** Minimal shape needed to syntax-check an inline script payload. */
export interface InlineSyntaxCheckScript {
    id: string;
    name?: string;
    code: string;
}

/**
 * Returns a normalized `{id, name, code}` record iff the request entry
 * actually carries inline `code`. Used to skip store-only entries (which
 * are loaded later from disk) during the preflight pass.
 */
export function getInlineSyntaxCheckScript(
    value: InjectionRequestScript,
): InlineSyntaxCheckScript | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }

    const candidate = value as Partial<InjectableScript> & {
        id?: string;
        code?: string;
        name?: string;
    };
    if (typeof candidate.id !== "string" || typeof candidate.code !== "string") {
        return null;
    }

    return {
        id: candidate.id,
        name: typeof candidate.name === "string" ? candidate.name : candidate.id,
        code: candidate.code,
    };
}

/**
 * Parses `code` with Acorn wrapped in a function expression. Returns the
 * parser error message string on failure, or `null` if the source parses
 * cleanly. Never throws.
 */
export function detectSyntaxError(code: string): string | null {
    try {
        parse(`(function(){\n${code}\n});`, {
            ecmaVersion: "latest",
            sourceType: "script",
            allowReturnOutsideFunction: false,
        });
        return null;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.debug(
            "[injection:syntax-preflight] detectSyntaxError caught parse error (codeLen=%d): %s",
            code.length,
            message,
        );
        return message;
    }
}

/**
 * Fast boolean preflight — short-circuits at the first inline script that
 * fails to parse. Emits one summary log line at the end so operators can
 * correlate cache-bypass events with the offending script.
 */
// eslint-disable-next-line max-lines-per-function
export function requestHasInlineSyntaxError(
    scripts: InjectionRequestScript[],
): boolean {
    let inlineCandidateCount = 0;
    let firstFailureId: string | null = null;
    let firstFailureMessage: string | null = null;

    const triggered = scripts.some((script, index) => {
        const inlineScript = getInlineSyntaxCheckScript(script);
        if (inlineScript === null) {
            return false;
        }

        inlineCandidateCount += 1;
        const syntaxError = detectSyntaxError(inlineScript.code);
        if (syntaxError === null) {
            console.debug(
                "[injection:syntax-preflight] script #%d id=%s name=%s parsed cleanly (codeLen=%d)",
                index,
                inlineScript.id,
                inlineScript.name ?? inlineScript.id,
                inlineScript.code.length,
            );
            return false;
        }

        firstFailureId = inlineScript.id;
        firstFailureMessage = syntaxError;
        console.warn(
            "[injection:syntax-preflight] FAIL — script #%d id=%s name=%s codeLen=%d → %s",
            index,
            inlineScript.id,
            inlineScript.name ?? inlineScript.id,
            inlineScript.code.length,
            syntaxError,
        );
        return true;
    });

    console.log(
        "[injection:syntax-preflight] requestHasInlineSyntaxError → %s (inline candidates=%d/%d, total scripts=%d, firstFailure=%s%s)",
        triggered,
        inlineCandidateCount,
        scripts.length,
        scripts.length,
        firstFailureId ?? "none",
        firstFailureMessage !== null ? ` "${firstFailureMessage}"` : "",
    );

    return triggered;
}

/**
 * Full-pass variant: returns one `InjectionResult` per failing inline
 * script so the caller can surface them in the per-script results table
 * without re-parsing. Always returns an empty array when nothing fails.
 */
export function collectInlineSyntaxFailures(
    scripts: InjectionRequestScript[],
): InjectionResult[] {
    const failures: InjectionResult[] = [];

    for (const script of scripts) {
        const inlineScript = getInlineSyntaxCheckScript(script);
        if (inlineScript === null) {
            continue;
        }

        const syntaxError = detectSyntaxError(inlineScript.code);
        if (syntaxError === null) {
            continue;
        }

        const scriptName = inlineScript.name ?? inlineScript.id;
        console.warn(
            "[injection:syntax-preflight] collectInlineSyntaxFailures recorded id=%s name=%s message=%s",
            inlineScript.id,
            scriptName,
            syntaxError,
        );
        failures.push({
            scriptId: inlineScript.id,
            scriptName,
            isSuccess: false,
            errorMessage: `Script "${scriptName}" has a syntax error: ${syntaxError}`,
            durationMs: 0,
        });
    }

    console.log(
        "[injection:syntax-preflight] collectInlineSyntaxFailures → %d failure(s) of %d total script(s): [%s]",
        failures.length,
        scripts.length,
        failures.map((f) => f.scriptId).join(", ") || "none",
    );

    return failures;
}
