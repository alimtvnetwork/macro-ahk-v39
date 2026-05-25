/**
 * Marco Extension — Script Wrapper Builder
 *
 * Builds the wrapped script code for injection with error isolation,
 * optional JSON preambles (config/theme), and SDK injection (window.marco).
 *
 * IMPORTANT: Scripts run in MAIN world where chrome.runtime is undefined.
 * Error reporting uses window.postMessage through the content script relay.
 *
 * NOTE: Prompts preamble injection was REMOVED in v7.43.
 * The macro controller now fetches prompts dynamically via the GET_PROMPTS bridge message
 *
 * @see spec/05-chrome-extension/20-user-script-error-isolation.md — Error isolation wrappers
 * @see spec/05-chrome-extension/42-user-script-logging-and-data-bridge.md — Data bridge & logging
 * @see .lovable/memory/architecture/marco-sdk-convention.md — SDK convention
 */

import type { InjectableScript, InjectionLaunchSource } from "../../shared/injection-types";
import { buildMarcoSdkScript } from "../marco-sdk-template";
import { getActiveProjectId } from "../state-manager";
import { logBgWarnSampled, BgLogTag } from "../bg-logger";

const DEFAULT_LAUNCH_SOURCE: InjectionLaunchSource = "manual";

function buildLaunchPreamble(launchSource: InjectionLaunchSource): string {
    const safeLaunchSource = JSON.stringify(launchSource);
    return `window.__MARCO_LAUNCH_SOURCE__ = ${safeLaunchSource};`;
}

/* ------------------------------------------------------------------ */
/*  JSON Preamble Injection                                             */
/* ------------------------------------------------------------------ */

function buildAnnotatedJsonPreamble(label: string, assignmentLine: string): string {
    return `/* <!-- ${label} START --> */\n${assignmentLine}\n/* <!-- ${label} END --> */\n`;
}

/** Builds the config preamble that sets window.__MARCO_CONFIG__. */
function buildConfigPreamble(configJson: string): string {
    return buildAnnotatedJsonPreamble("JSON:__MARCO_CONFIG__", `window.__MARCO_CONFIG__ = ${configJson};`);
}

/** Builds the theme preamble that sets window.__MARCO_THEME__. */
function buildThemePreamble(themeJson: string): string {
    return buildAnnotatedJsonPreamble("JSON:__MARCO_THEME__", `window.__MARCO_THEME__ = ${themeJson};`);
}

/* ------------------------------------------------------------------ */
/*  SDK Injection                                                      */
/* ------------------------------------------------------------------ */

/** Builds the marco SDK preamble for user script logging and data bridge. */
function buildSdkPreamble(script: InjectableScript): string {
    const projectId = getActiveProjectId() ?? "";
    let version = "0.0.0";
    try {
        version = chrome.runtime.getManifest().version;
    } catch (err) { // allow-swallow: preview/test contexts lack chrome.runtime; "0.0.0" sentinel is the documented fallback (throttled to avoid test-run flooding)
        logBgWarnSampled(BgLogTag.INJECTION, "manifest-unavailable", "chrome.runtime.getManifest unavailable, using version fallback", err);
    }

    return buildMarcoSdkScript({
        projectId,
        scriptId: script.id,
        configId: script.configBinding ?? "",
        urlRuleId: "",
        version,
    }) + "\n";
}

/* ------------------------------------------------------------------ */
/*  Error Isolation Wrapper                                            */
/* ------------------------------------------------------------------ */

/** Wraps user script code in a try/catch isolation layer with SDK. */
export function wrapWithIsolation(
    script: InjectableScript,
    configJson: string | null,
    themeJson?: string | null,
    launchSource: InjectionLaunchSource = DEFAULT_LAUNCH_SOURCE,
): string {
    const sdkLine = buildSdkPreamble(script);
    const launchLine = buildLaunchPreamble(launchSource);

    const configLine = configJson !== null
        ? buildConfigPreamble(configJson)
        : "";

    const themeLine = themeJson
        ? buildThemePreamble(themeJson)
        : "";

    return buildWrappedCode(script.id, sdkLine, launchLine, configLine, themeLine, script.code);
}

/** Builds the full wrapped code string. Uses postMessage for error reporting (MAIN world). */
// eslint-disable-next-line max-lines-per-function
function buildWrappedCode(
    scriptId: string,
    sdkLine: string,
    launchLine: string,
    configLine: string,
    themeLine: string,
    userCode: string,
): string {
    const codeSnippet = JSON.stringify(userCode.slice(0, 500));
    const safeScriptId = JSON.stringify(scriptId);

    // Blob URL scripts run in their own parse context — no need for
    // 'use strict' (which would break top-level let/const in some engines).
    // Leading semicolon prevents ASI issues if sdkLine lacks a trailing one.
    // Cache-busting nonce in sourceURL prevents DevTools from serving stale script
    const wrapperNonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    return `;${sdkLine};${launchLine};(function() {
    // Per-page dedup via <body data-marco-injected="id1,id2,..."> marker.
    // See mem://features/auto-attach-policy.md §2. Logged, never silent.
    try {
        var __mBody = document.body;
        if (__mBody) {
            var __mAttr = __mBody.getAttribute("data-marco-injected") || "";
            var __mList = __mAttr ? __mAttr.split(",") : [];
            var __mAlreadyInjected = __mList.indexOf(${safeScriptId}) !== -1;
            var __mLaunchSource = window.__MARCO_LAUNCH_SOURCE__ || "manual";
            var __mPassiveMarker = document.querySelector('[data-launch-source="passive"]');
            var __mVisiblePanel = document.getElementById("ahk-loop-container");
            var __mManualAfterPassive = __mAlreadyInjected && __mLaunchSource === "manual" && __mPassiveMarker && !__mVisiblePanel;
            if (__mAlreadyInjected && !__mManualAfterPassive) {
                console.info("[Marco] INJECT_SKIPPED_ALREADY_MARKED script=" + ${safeScriptId});
                return;
            }
            if (!__mAlreadyInjected) {
                __mList.push(${safeScriptId});
                __mBody.setAttribute("data-marco-injected", __mList.join(","));
            }
        }
    } catch (__mDedupErr) {
        console.warn("[Marco] body-marker dedup failed for " + ${safeScriptId} + ":", __mDedupErr);
    }
    ${configLine}${themeLine}try {
        ${userCode}
    } catch (__marcoErr) {
        var __errMsg = __marcoErr.message || String(__marcoErr);
        var __errStack = __marcoErr.stack || "";
        console.error("[Marco] Script " + ${safeScriptId} + " error:", __errMsg, "\\nStack:", __errStack);
        try {
            if(typeof __marcoNotify==="function"){__marcoNotify("Script error: "+__errMsg,"error",8000);}
        } catch(__ne){
            // MAIN-world context: namespace Logger unavailable. Surface breadcrumb so the
            // suppressed notify error is recoverable from devtools console.
            console.warn("[Marco] __marcoNotify failed for script " + ${safeScriptId} + ":", __ne);
        }
        try {
            var __ctx = window.marco && window.marco.context ? window.marco.context : null;

            window.postMessage({
                source: "marco-controller",
                type: "USER_SCRIPT_ERROR",
                scriptId: ${safeScriptId},
                message: __errMsg,
                stack: __errStack,
                scriptCode: ${codeSnippet},
                projectId: __ctx && __ctx.projectId ? __ctx.projectId : null
            }, "*");

            window.postMessage({
                source: "marco-controller",
                type: "USER_SCRIPT_LOG",
                payload: {
                    level: "ERROR",
                    source: "user-script",
                    category: "INJECTION",
                    action: "runtime_error",
                    detail: "Script " + ${safeScriptId} + " error: " + __errMsg,
                    metadata: JSON.stringify({ stack: __errStack }),
                    projectId: __ctx && __ctx.projectId ? __ctx.projectId : null,
                    scriptId: ${safeScriptId},
                    configId: __ctx && __ctx.configId ? __ctx.configId : null,
                    urlRuleId: __ctx && __ctx.urlRuleId ? __ctx.urlRuleId : null,
                    pageUrl: window.location.href,
                    timestamp: new Date().toISOString()
                }
            }, "*");
        } catch (__relayErr) {
            console.error("[Marco] Failed to relay error:", __relayErr);
        }
    }
})();
//# sourceURL=marco-wrapper-${scriptId}.js?v=${wrapperNonce}`;
}
