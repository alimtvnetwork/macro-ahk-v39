/**
 * Marco Extension — Script Injection Types
 *
 * Shared types for the injection handler.
 */

/** Assets declared in a script's manifest (css, templates). */
export interface ScriptAssets {
    css?: string;
    templates?: string;
}

/** How an injection was started. Manual launches may open visible page UI. */
export type InjectionLaunchSource = "manual" | "passive";

/** A script to inject into a tab. */
export interface InjectableScript {
    id: string;
    name?: string;
    code: string;
    order: number;
    runAt?: "document_start" | "document_idle" | "document_end";
    configBinding?: string;
    themeBinding?: string;
    isIife?: boolean;
    /** Optional per-script assets (CSS file, template registry). */
    assets?: ScriptAssets;
}

/** Reason a script was skipped during resolution. */
export type SkipReason = "disabled" | "missing" | "resolver_mismatch" | "empty_code";

/** Result of a single script injection. */
export interface InjectionResult {
    scriptId: string;
    isSuccess: boolean;
    errorMessage?: string;
    durationMs: number;
    /** Set when the script was skipped before execution. */
    skipReason?: SkipReason;
    /** Human-readable name for display. */
    scriptName?: string;
    /** Which injection path was used (main-blob, userScripts, isolated-blob). */
    injectionPath?: string;
    /** DOM target used for script tag insertion (body/documentElement). */
    domTarget?: string;
}

/**
 * Response payload returned by the `INJECT_SCRIPTS` message handler.
 *
 * Single source of truth shared between background, UI, internal callers
 * (shortcut handler, context menu), the preview adapter mock, and E2E
 * tests. Adding a new field here automatically flows to every consumer
 * via TypeScript — preventing the previous drift where the popup hook
 * declared its own narrower `{ results }` shape and silently ignored
 * `inlineSyntaxErrorDetected`.
 *
 * Backward compatibility:
 *   `inlineSyntaxErrorDetected` is intentionally *optional* on the wire
 *   so newer popup builds can talk to an older background that does not
 *   send the field, and older popup builds can ignore it when sent by a
 *   newer background. Always read it through `normalizeInjectScriptsResponse`
 *   to guarantee a `boolean` (defaults to `false` when absent) instead
 *   of accidentally letting `undefined` leak into UI logic.
 */
export interface InjectScriptsResponse {
    /** Per-script outcome rows, in the order the handler executed them. */
    results: InjectionResult[];
    /**
     * `true` iff the inline syntax preflight (`requestHasInlineSyntaxError`)
     * tripped on this request. Always `false` on the cache-hit path, the
     * `forceReload: true` bypass, restricted-URL early returns, and
     * inaccessible-tab early returns. UI surfaces and tests should rely
     * on this flag instead of pattern-matching on `errorMessage` text.
     *
     * Optional on the wire for backward compatibility — older background
     * builds will omit it. Use `normalizeInjectScriptsResponse` to read
     * it as a guaranteed boolean.
     */
    inlineSyntaxErrorDetected?: boolean;
}

/**
 * Normalized response: `inlineSyntaxErrorDetected` is guaranteed to be
 * a boolean (defaults to `false`), and `inlineSyntaxFlagSource` records
 * whether the value came from the wire or the legacy fallback. UI code
 * and tests should consume this shape, not the raw response.
 */
export interface NormalizedInjectScriptsResponse {
    results: InjectionResult[];
    inlineSyntaxErrorDetected: boolean;
    /**
     * `"wire"` when the background actually sent `inlineSyntaxErrorDetected`,
     * `"legacy-default"` when the field was missing and we defaulted to
     * `false`. Useful for diagnostics and for telemetry that wants to
     * know how often older backgrounds are still in play.
     */
    inlineSyntaxFlagSource: "wire" | "legacy-default";
}

/**
 * Coerces an `INJECT_SCRIPTS` response from any background version into
 * a guaranteed-shape object. Tolerates:
 *   - completely missing `inlineSyntaxErrorDetected` (older background)
 *   - non-boolean values (corrupted relay, mock typos)
 *   - completely missing `results` (treated as empty array)
 *
 * Never throws. Returns a normalized object even when given `null` or
 * an object of unexpected shape — the caller can then surface a UI
 * error instead of crashing on a property access.
 */
export function normalizeInjectScriptsResponse(
    raw: InjectScriptsResponse | null | undefined,
): NormalizedInjectScriptsResponse {
    const safe = raw ?? { results: [] };
    const results = Array.isArray(safe.results) ? safe.results : [];
    const flag = safe.inlineSyntaxErrorDetected;
    if (typeof flag === "boolean") {
        return {
            results,
            inlineSyntaxErrorDetected: flag,
            inlineSyntaxFlagSource: "wire",
        };
    }
    return {
        results,
        inlineSyntaxErrorDetected: false,
        inlineSyntaxFlagSource: "legacy-default",
    };
}
