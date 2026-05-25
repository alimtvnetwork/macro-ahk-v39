/**
 * Marco Extension — CSP Fallback Handler
 *
 * Detects Content Security Policy blocking main-world injection
 * and automatically retries via chrome.userScripts.execute() (Chrome 135+).
 * See spec 05-content-script-adaptation.md §CSP Handling.
 */

import { transitionHealth } from "./health-handler";
import { handleGetSettings } from "./handlers/settings-handler";
import { logBgWarnError, logCaughtError, logSampledDebug, BgLogTag} from "./bg-logger";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Result of a CSP-aware injection attempt. */
export interface CspInjectionResult {
    isSuccess: boolean;
    world: chrome.scripting.ExecutionWorld | "USER_SCRIPT";
    isFallback: boolean;
    errorMessage?: string;
    /** Which DOM element the script tag was appended to. */
    domTarget?: "body" | "documentElement" | "unknown";
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Single-step DOM-append attempt with sampled-debug breadcrumb on failure.
 * Returns true on success, false on caught exception. The breadcrumb keys
 * are stable per-strategy so repeated DOM-hostility issues collapse into
 * a handful of debug lines per SW lifetime.
 */
function tryAppendStrategy(
    label: string,
    fallbackHint: string,
    operation: () => void,
): boolean {
    try {
        operation();
        return true;
    } catch (err) {
        logSampledDebug(
            BgLogTag.CSP_FALLBACK,
            `appendNodeToTarget:${label}`,
            `${label} failed — ${fallbackHint}`,
            err instanceof Error ? err : String(err),
        );
        return false;
    }
}

function appendNodeToTarget(target: Element, node: Node): boolean {
    if (tryAppendStrategy(
        "appendChild",
        "trying insertBefore (DOM patched by host page)",
        () => { Node.prototype.appendChild.call(target, node); },
    )) return true;

    if (tryAppendStrategy(
        "insertBefore",
        "trying insertAdjacentElement",
        () => { Node.prototype.insertBefore.call(target, node, null); },
    )) return true;

    if (node.nodeType !== Node.ELEMENT_NODE) return false;

    return tryAppendStrategy(
        "insertAdjacent",
        "DOM is hostile, giving up",
        () => { Element.prototype.insertAdjacentElement.call(target, "beforeend", node as Element); },
    );
}


/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CSP_ERROR_PATTERNS = [
    "content security policy",
    "content-security-policy",
    "refused to execute inline script",
    "violates the following content security policy",
    "unsafe-eval",
    "evalerror",
    "refused to evaluate",
];

const MAIN_WORLD_INJECTION_ERROR_PATTERNS = [
    "failed to execute 'appendchild' on 'node'",
    "unexpected strict mode reserved word",
    "unexpected identifier 'let'",
    "osano.js",
];

const USER_SCRIPT_WORLD_ID = "MARCO_FALLBACK";

/* ------------------------------------------------------------------ */
/*  Initialization                                                     */
/* ------------------------------------------------------------------ */

let userScriptsWorldConfigured = false;
let userScriptsWorldIdEnabled = false;

/**
 * Configures the userScripts world for fallback execution.
 * Must be called once during service worker startup.
 */
export async function configureUserScriptWorld(): Promise<void> {
    if (userScriptsWorldConfigured) return;

    try {
        if (typeof chrome.userScripts?.configureWorld !== "function") {
            // Chrome <135 / non-Chromium browsers: configureWorld API does not
            // exist. This is an EXPECTED operational state — the fallback
            // injector simply uses the default USER_SCRIPT world. Logging
            // anything here (even console.debug) gets surfaced in the popup
            // Errors panel by upstream tooling, alarming users for no reason.
            // Stay silent: success path below logs ✅, failure path logs ❌.
            userScriptsWorldConfigured = true;
            userScriptsWorldIdEnabled = false;
            return;
        }

        try {
            await (chrome.userScripts.configureWorld as (p: unknown) => Promise<void>)({
                worldId: USER_SCRIPT_WORLD_ID,
                csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'self';",
                messaging: false,
            });
            userScriptsWorldConfigured = true;
            userScriptsWorldIdEnabled = true;
            console.log("[injection:csp] ✅ userScripts world '%s' configured", USER_SCRIPT_WORLD_ID);
            return;
        } catch (namedWorldError) {
            logCaughtError(BgLogTag.INJECTION_CSP, `Named userScripts world configuration failed\n  Path: chrome.userScripts.configureWorld({ worldId: "${USER_SCRIPT_WORLD_ID}" })\n  Missing: Configured USER_SCRIPT world with custom CSP\n  Reason: ${namedWorldError instanceof Error ? namedWorldError.message : String(namedWorldError)} — retrying with default world`, namedWorldError);
        }

        await chrome.userScripts.configureWorld({
            csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'self';",
            messaging: false,
        });
        userScriptsWorldConfigured = true;
        userScriptsWorldIdEnabled = false;
        console.log("[injection:csp] ✅ default USER_SCRIPT world configured");
    } catch (configError) {
        userScriptsWorldConfigured = false;
        userScriptsWorldIdEnabled = false;
        logCaughtError(BgLogTag.INJECTION_CSP, `Failed to configure userScripts world\n  Path: chrome.userScripts.configureWorld()\n  Missing: Any usable USER_SCRIPT world (named and default both failed)\n  Reason: ${configError instanceof Error ? configError.message : String(configError)} — CSP fallback injection will be unavailable`, configError);
    }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** Injects a script with fallback from MAIN → userScripts when MAIN is blocked. */
export async function injectWithCspFallback(
    tabId: number,
    code: string,
    preferredWorld: chrome.scripting.ExecutionWorld,
): Promise<CspInjectionResult> {
    console.log("[injection:csp] Attempting %s world injection in tab %d (%d chars)", preferredWorld, tabId, code.length);

    const mainResult = await tryInjectViaScripting(tabId, code, preferredWorld);

    if (mainResult.isSuccess) {
        console.log("[injection:csp] ✅ %s world injection succeeded (target: %s)", preferredWorld, mainResult.domTarget);
        return buildResult(true, preferredWorld, false, undefined, mainResult.domTarget as CspInjectionResult["domTarget"]);
    }

    logBgWarnError(BgLogTag.INJECTION_CSP, `${preferredWorld} world failed: ${mainResult.errorMessage}`);

    const errorMessage = mainResult.errorMessage ?? "";
    const isMainWorld = preferredWorld === "MAIN";

    if (isMainWorld) {
        const isCspBlock = detectCspError(errorMessage);
        const isMainWorldBlock = detectMainWorldInjectionError(errorMessage);
        const reason = isCspBlock
            ? "CSP detected"
            : isMainWorldBlock
                ? "MAIN world injector interference detected"
                : "MAIN world injection failed (generic)";
        logBgWarnError(BgLogTag.INJECTION_CSP, `${reason} — falling back to userScripts API`);
        return attemptUserScriptFallback(tabId, code, errorMessage);
    }

    return buildResult(false, preferredWorld, false, mainResult.errorMessage);
}

/** Checks if an error message indicates a CSP violation. */
export function isCspError(errorMessage: string): boolean {
    return detectCspError(errorMessage);
}

/* ------------------------------------------------------------------ */
/*  MAIN World Injection (chrome.scripting)                            */
/* ------------------------------------------------------------------ */

/**
 * Executes serialized user code in MAIN world via Blob URL <script> injection.
 * Uses script.src (not inline textContent) so Osano-like inline parsers cannot
 * parse injected code and crash on modern syntax like let/const.
 *
 * IMPORTANT: This function is serialized by chrome.scripting.executeScript
 * and runs in an isolated page context — it CANNOT reference any external
 * helpers, module imports, or sibling functions. Everything must be inlined.
 */
// eslint-disable-next-line max-lines-per-function
async function executeInMainWorld(code: string): Promise<string> {
    if (typeof document === "undefined") return "unknown";

    // Cache-busting nonce ensures DevTools never serves a stale cached script
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const sourceTag = '\n//# sourceURL=marco-injected-main.js?v=' + nonce + '\n';
    const blob = new Blob([code + sourceTag], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const script = document.createElement("script");
    script.src = url;
    script.setAttribute("defer", "defer");
    script.defer = true;
    script.async = false;
    script.setAttribute("data-marco-injection", "main-blob");
    script.setAttribute("data-marco-nonce", nonce);

    // Remove ALL previous marco injection scripts (any type) to prevent stale cached code
    const staleScripts = document.querySelectorAll('script[data-marco-injection]');
    staleScripts.forEach(function(el) { el.remove(); });

    const target = document.body ?? document.documentElement;
    if (!target) {
        URL.revokeObjectURL(url);
        throw new Error("No HTML target available for MAIN blob script injection");
    }

    const targetName = target === document.body ? "body" : "documentElement";
    const markerComment = document.createComment(" MARCO: main-blob injection (appended at bottom of " + targetName + ") ");

    // eslint-disable-next-line max-lines-per-function
    await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            URL.revokeObjectURL(url);
            reject(new Error("MAIN blob script load timeout"));
        }, 4000);

        script.addEventListener("load", () => {
            window.clearTimeout(timeoutId);
            URL.revokeObjectURL(url);
            resolve();
        }, { once: true });

        script.addEventListener("error", () => {
            window.clearTimeout(timeoutId);
            URL.revokeObjectURL(url);
            reject(new Error("MAIN blob script failed to parse/execute"));
        }, { once: true });

        // CRITICAL: appendNodeToTarget must be inlined here because this function
        // is serialized by chrome.scripting.executeScript — outer-scope references
        // are NOT available in the target page context. See spec/22-app-issues/92-*.md
        const appendNode = (node: Node): boolean => {
            try {
                Node.prototype.appendChild.call(target, node);
                return true;
            } catch {
                try {
                    Node.prototype.insertBefore.call(target, node, null);
                    return true;
                } catch {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        try {
                            Element.prototype.insertAdjacentElement.call(target, "beforeend", node as Element);
                            return true;
                        } catch {
                            return false;
                        }
                    }
                    return false;
                }
            }
        };

        const commentOk = appendNode(markerComment);
        const scriptOk = appendNode(script);

        if (!commentOk || !scriptOk) {
            window.clearTimeout(timeoutId);
            URL.revokeObjectURL(url);
            reject(new Error("Failed to inject MAIN blob script tag at HTML bottom"));
        }
    });

    return targetName;
}

/** Attempts injection via chrome.scripting.executeScript. */
async function tryInjectViaScripting(
    tabId: number,
    code: string,
    world: chrome.scripting.ExecutionWorld,
): Promise<{ isSuccess: boolean; errorMessage?: string; domTarget?: string }> {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: executeInMainWorld,
            args: [code],
            world,
        });

        const domTarget = results?.[0]?.result as string | undefined;
        return { isSuccess: true, domTarget: domTarget ?? "unknown" };
    } catch (injectionError) {
        const errorMessage = injectionError instanceof Error
            ? injectionError.message
            : String(injectionError);

        return { isSuccess: false, errorMessage };
    }
}

/* ------------------------------------------------------------------ */
/*  Fallback: chrome.userScripts.execute / legacy ISOLATED chain       */
/* ------------------------------------------------------------------ */

/**
 * Fallback injection using chrome.userScripts.execute().
 * If unavailable/failing, chain to legacy ISOLATED blob then ISOLATED eval.
 */
// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
async function attemptUserScriptFallback(
    tabId: number,
    code: string,
    mainErrorMessage?: string,
): Promise<CspInjectionResult> {
    logCspFallback(tabId);
    transitionHealth("DEGRADED", "CSP fallback active");

    let userScriptTierLabel = "unavailable";
    let userScriptTierError: string | undefined;

    // Check if legacy injection is forced via settings
    const isForceLegacy = await isLegacyInjectionForced();

    if (!isForceLegacy) {
        // Ensure USER_SCRIPT world exists before execute() to avoid cold-start race.
        await configureUserScriptWorld();

        // Try chrome.userScripts.execute() first (Chrome 135+)
        if (typeof chrome.userScripts?.execute === "function") {
            try {
                const executeArgs: Record<string, unknown> = {
                    target: { tabId },
                    js: [{ code }],
                    world: "USER_SCRIPT",
                };

                if (userScriptsWorldIdEnabled) {
                    executeArgs.worldId = USER_SCRIPT_WORLD_ID;
                }

                await (chrome.userScripts.execute as (i: unknown) => Promise<unknown>)(executeArgs);

                if (userScriptsWorldIdEnabled) {
                    console.log("[injection:csp] ✅ userScripts.execute() succeeded in tab %d (worldId=%s)", tabId, USER_SCRIPT_WORLD_ID);
                } else {
                    console.log("[injection:csp] ✅ userScripts.execute() succeeded in tab %d (default USER_SCRIPT world)", tabId);
                }
                console.log("[injection:csp] 🏆 WINNER: userScripts in tab %d | MAIN: ❌ %s → USER_SCRIPT: ✅", tabId, mainErrorMessage ?? "unknown");
                return buildResult(true, "USER_SCRIPT", true);
            } catch (userScriptError) {
                userScriptTierError = userScriptError instanceof Error
                    ? userScriptError.message
                    : String(userScriptError);
                userScriptTierLabel = "failed";
                logCaughtError(BgLogTag.INJECTION_CSP, `userScripts.execute() failed\n  Path: chrome.userScripts.execute({ target: { tabId: ${tabId} }, world: "USER_SCRIPT" })\n  Missing: Successful script execution in USER_SCRIPT world\n  Reason: ${userScriptTierError} — falling back to legacy ISOLATED chain`, userScriptError);
            }
        } else {
            userScriptTierLabel = "unavailable";
            logBgWarnError(BgLogTag.INJECTION_CSP, "userScripts.execute() not available, using legacy ISOLATED chain");
        }
    } else {
        userScriptTierLabel = "skipped(forceLegacyInjection=true)";
        logBgWarnError(BgLogTag.INJECTION_CSP, "forceLegacyInjection enabled — skipping userScripts and using legacy ISOLATED chain");
    }

    // Legacy tier 1: ISOLATED blob script tag
    const blobResult = await attemptBlobFallback(tabId, code);
    if (blobResult.isSuccess) {
        console.log(
            "[injection:csp] 🏆 WINNER: isolated-blob in tab %d | MAIN: ❌ %s → USER_SCRIPT: %s → ISOLATED_BLOB: ✅",
            tabId,
            mainErrorMessage ?? "unknown",
            userScriptTierLabel,
        );
        return blobResult;
    }

    // Legacy tier 2: ISOLATED eval
    const evalResult = await attemptIsolatedEvalFallback(tabId, code);
    if (evalResult.isSuccess) {
        console.log(
            "[injection:csp] 🏆 WINNER: isolated-eval in tab %d | MAIN: ❌ %s → USER_SCRIPT: %s → ISOLATED_BLOB: ❌ %s → ISOLATED_EVAL: ✅",
            tabId,
            mainErrorMessage ?? "unknown",
            userScriptTierLabel,
            blobResult.errorMessage ?? "unknown",
        );
        return evalResult;
    }

    const userScriptReason = userScriptTierLabel === "failed"
        ? (userScriptTierError ?? "failed")
        : userScriptTierLabel;

    const combinedError = `All injection tiers failed | MAIN: ${mainErrorMessage ?? "unknown"} | USER_SCRIPT: ${userScriptReason} | ISOLATED_BLOB: ${blobResult.errorMessage ?? "unknown"} | ISOLATED_EVAL: ${evalResult.errorMessage ?? "unknown"}`;
    logBgWarnError(BgLogTag.INJECTION_CSP, combinedError);
    return buildResult(false, "ISOLATED", true, combinedError);
}

/** Reads the forceLegacyInjection setting. */
async function isLegacyInjectionForced(): Promise<boolean> {
    try {
        const { settings } = await handleGetSettings();
        return settings.forceLegacyInjection === true;
    } catch (settingsErr) {
        logSampledDebug(
            BgLogTag.CSP_FALLBACK,
            "isLegacyInjectionForced",
            "handleGetSettings unavailable — defaulting forceLegacyInjection=false",
            settingsErr instanceof Error ? settingsErr : String(settingsErr),
        );
        return false;
    }
}

/**
 * Legacy fallback tier 1: Blob URL script tag from ISOLATED world.
 */
async function attemptBlobFallback(
    tabId: number,
    code: string,
): Promise<CspInjectionResult> {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: executeBlobInjection,
            args: [code],
            world: "ISOLATED",
        });

        const domTarget = results?.[0]?.result as string | undefined;
        return buildResult(true, "ISOLATED", true, undefined, domTarget as CspInjectionResult["domTarget"]);
    } catch (blobError) {
        const errorMessage = blobError instanceof Error
            ? blobError.message
            : String(blobError);

        return buildResult(false, "ISOLATED", true, errorMessage);
    }
}

/**
 * Legacy fallback tier 2: evaluate code in ISOLATED world.
 */
async function attemptIsolatedEvalFallback(
    tabId: number,
    code: string,
): Promise<CspInjectionResult> {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: executeIsolatedEval,
            args: [code],
            world: "ISOLATED",
        });

        return buildResult(true, "ISOLATED", true, undefined, "unknown");
    } catch (evalError) {
        const errorMessage = evalError instanceof Error
            ? evalError.message
            : String(evalError);

        return buildResult(false, "ISOLATED", true, errorMessage);
    }
}

/** Runs inside ISOLATED world as serialized executeScript payload. */
function executeIsolatedEval(code: string): void {
    (0, eval)(code);
}

/**
 * Blob-based script injection (runs in content script context).
 * Injects a script tag and waits for load/error so syntax failures are surfaced.
 *
 * IMPORTANT: This function is serialized by chrome.scripting.executeScript
 * and runs in an isolated page context — it CANNOT reference any external
 * helpers, module imports, or sibling functions. Everything must be inlined.
 */
// eslint-disable-next-line max-lines-per-function
async function executeBlobInjection(code: string): Promise<string> {
    if (typeof document === "undefined") return "unknown";

    // Cache-busting nonce ensures DevTools never serves a stale cached script
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const sourceTag = '\n//# sourceURL=marco-injected-isolated.js?v=' + nonce + '\n';
    const blob = new Blob([code + sourceTag], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const script = document.createElement("script");
    script.src = url;
    script.setAttribute("defer", "defer");
    script.defer = true;
    script.async = false;
    script.setAttribute("data-marco-injection", "isolated-blob");
    script.setAttribute("data-marco-nonce", nonce);

    // Remove ALL previous marco injection scripts to prevent stale cached code
    const staleScripts = document.querySelectorAll('script[data-marco-injection]');
    staleScripts.forEach(function(el) { el.remove(); });

    const target = document.body ?? document.documentElement;
    if (!target) {
        URL.revokeObjectURL(url);
        throw new Error("No HTML target available for ISOLATED script tag injection");
    }

    const targetName = target === document.body ? "body" : "documentElement";
    const markerComment = document.createComment(" MARCO: isolated-blob injection (appended at bottom of " + targetName + ") ");

    // eslint-disable-next-line max-lines-per-function
    await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
            URL.revokeObjectURL(url);
            reject(new Error("ISOLATED blob script load timeout"));
        }, 4000);

        script.addEventListener("load", () => {
            window.clearTimeout(timeoutId);
            URL.revokeObjectURL(url);
            resolve();
        }, { once: true });

        script.addEventListener("error", () => {
            window.clearTimeout(timeoutId);
            URL.revokeObjectURL(url);
            reject(new Error("ISOLATED blob script failed to parse/execute"));
        }, { once: true });

        // CRITICAL: Inlined — this function is serialized by chrome.scripting.executeScript.
        // Outer-scope references are NOT available. See spec/22-app-issues/92-*.md
        // eslint-disable-next-line sonarjs/no-identical-functions
        const appendNode = (node: Node): boolean => {
            try {
                Node.prototype.appendChild.call(target, node);
                return true;
            } catch {
                try {
                    Node.prototype.insertBefore.call(target, node, null);
                    return true;
                } catch {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        try {
                            Element.prototype.insertAdjacentElement.call(target, "beforeend", node as Element);
                            return true;
                        } catch {
                            return false;
                        }
                    }
                    return false;
                }
            }
        };

        const commentOk = appendNode(markerComment);
        const scriptOk = appendNode(script);

        if (!commentOk || !scriptOk) {
            window.clearTimeout(timeoutId);
            URL.revokeObjectURL(url);
            reject(new Error("Failed to inject ISOLATED blob script tag at HTML bottom"));
        }
    });

    return targetName;
}

/* ------------------------------------------------------------------ */
/*  CSP Detection                                                      */
/* ------------------------------------------------------------------ */

/** Detects if an error message indicates a CSP violation. */
function detectCspError(errorMessage: string): boolean {
    const lowerMessage = errorMessage.toLowerCase();

    return CSP_ERROR_PATTERNS.some((pattern) => lowerMessage.includes(pattern));
}

/** Detects MAIN-world script injector interference (e.g. Osano patching). */
function detectMainWorldInjectionError(errorMessage: string): boolean {
    const lowerMessage = errorMessage.toLowerCase();

    return MAIN_WORLD_INJECTION_ERROR_PATTERNS.some(
        (pattern) => lowerMessage.includes(pattern),
    );
}

/* ------------------------------------------------------------------ */
/*  Result Builders                                                    */
/* ------------------------------------------------------------------ */

/** Builds a CSP injection result. */
function buildResult(
    isSuccess: boolean,
    world: chrome.scripting.ExecutionWorld | "USER_SCRIPT",
    isFallback: boolean,
    errorMessage?: string,
    domTarget?: CspInjectionResult["domTarget"],
): CspInjectionResult {
    return { isSuccess, world, isFallback, errorMessage, domTarget };
}

/* ------------------------------------------------------------------ */
/*  Logging                                                            */
/* ------------------------------------------------------------------ */

/** Logs a CSP fallback event. */
function logCspFallback(tabId: number): void {
    logBgWarnError(BgLogTag.CSP_FALLBACK, `MAIN world blocked in tab ${tabId}, switching to userScripts fallback`);
}
