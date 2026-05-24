/**
 * Marco Extension — URL Trigger Gate (audit 2026-05-16, fixes U-1/U-2/U-3)
 *
 * Listens to the ONLY three allowed re-evaluation triggers:
 *   T1 — initial load   (webNavigation.onCompleted, frameId === 0)
 *   T2 — refresh        (webNavigation.onCommitted, transitionType === "reload")
 *   T3 — tab activate   (chrome.tabs.onActivated)
 *
 * Each trigger fingerprints the URL and consults `tabDecisionCache`
 * via `isSameDecisionFingerprint()`. If the fingerprint matches the
 * cached one for that tab, the whole pipeline is short-circuited —
 * NO `evaluateUrlMatches()`, NO sentinel re-inject, NO logs that
 * would create a hot loop on noisy SPA history events.
 *
 * On a miss, the trigger:
 *   1. calls `evaluateUrlMatches(url)` once
 *   2. stores the decision in `tabDecisionCache`
 *   3. injects the `__marco_sentinel__` div so page-side checks
 *      become O(1) `document.getElementById()` lookups
 *
 * Hard constraints (do not change without re-reading the audit):
 *   • Sub-frames are ignored — top-frame only.
 *   • No setInterval, no setTimeout retry loop, no MutationObserver.
 *   • All errors are caught and logged; this gate must NEVER throw
 *     into Chrome's event loop (would unregister the listener).
 *   • Hash-only navigation (`onReferenceFragmentUpdated`) is
 *     intentionally NOT listened to — the fingerprint strips hashes.
 */

import { evaluateUrlMatches } from "./project-matcher";
import {
    getTabDecision,
    isSameDecisionFingerprint,
    setTabDecision,
    clearTabDecision,
    type TabDecision,
} from "./state-manager";
import { urlFingerprint } from "./url-fingerprint";
import { logCaughtError, BgLogTag } from "./bg-logger";

/* ------------------------------------------------------------------ */
/*  Sentinel constants                                                 */
/* ------------------------------------------------------------------ */

/** DOM id of the page-side decision sentinel. Stable contract. */
export const MARCO_SENTINEL_ID = "__marco_sentinel__";

/** data-* attribute names — keep in sync with `readSentinel()` consumers. */
const SENTINEL_ATTR_FP = "data-fp";
const SENTINEL_ATTR_PROJECTS = "data-projects";
const SENTINEL_ATTR_CAN_RUN = "data-can-run";
const SENTINEL_ATTR_TRIGGER = "data-trigger";
const SENTINEL_ATTR_DECIDED_AT = "data-decided-at";

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */

let isRegistered = false;

/** Wires the three triggers. Idempotent. */
export function registerUrlTriggers(): void {
    if (isRegistered) {
        return;
    }
    isRegistered = true;

    chrome.webNavigation.onCompleted.addListener(handleLoad);
    chrome.webNavigation.onCommitted.addListener(handleCommitted);
    chrome.tabs.onActivated.addListener(handleActivated);

    console.log("[url-trigger] Registered T1 onCompleted, T2 onCommitted(reload), T3 onActivated");
}

/* ------------------------------------------------------------------ */
/*  T1 — initial load                                                  */
/* ------------------------------------------------------------------ */

async function handleLoad(
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
): Promise<void> {
    const isSubFrame = details.frameId !== 0;
    if (isSubFrame) {
        return;
    }
    await runGate(details.tabId, details.url, "load");
}

/* ------------------------------------------------------------------ */
/*  T2 — refresh (transitionType === "reload")                         */
/* ------------------------------------------------------------------ */

async function handleCommitted(
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
    const isSubFrame = details.frameId !== 0;
    if (isSubFrame) {
        return;
    }
    const isReload = details.transitionType === "reload";
    if (!isReload) {
        return;
    }
    // Force re-eval on refresh — user explicitly requested a fresh page.
    clearTabDecision(details.tabId);
    await runGate(details.tabId, details.url, "refresh");
}

/* ------------------------------------------------------------------ */
/*  T3 — tab activated                                                 */
/* ------------------------------------------------------------------ */

async function handleActivated(
    info: chrome.tabs.TabActiveInfo,
): Promise<void> {
    let tab: chrome.tabs.Tab;
    try {
        tab = await chrome.tabs.get(info.tabId);
    } catch (err) {
        // Tab disappeared between activate and get — non-fatal.
        logCaughtError(BgLogTag.MARCO, "tabs.onActivated: tabs.get failed", err);
        return;
    }
    const url = tab.url ?? "";
    const hasUrl = url.length > 0;
    if (!hasUrl) {
        return;
    }
    await runGate(info.tabId, url, "activate");
}

/* ------------------------------------------------------------------ */
/*  Shared gate                                                        */
/* ------------------------------------------------------------------ */

/**
 * Returns true for URLs Chrome forbids scripting into (chrome://, the
 * Web Store, other extensions, devtools, file://, view-source:, blank).
 * Avoids logging predictable "restricted URL" errors on every nav.
 */
function isRestrictedUrl(url: string): boolean {
    if (url.length === 0) return true;
    if (url === "about:blank") return true;
    if (url.startsWith("chrome://")) return true;
    if (url.startsWith("chrome-search://")) return true;
    if (url.startsWith("chrome-extension://")) return true;
    if (url.startsWith("chrome-untrusted://")) return true;
    if (url.startsWith("moz-extension://")) return true;
    if (url.startsWith("edge://")) return true;
    if (url.startsWith("brave://")) return true;
    if (url.startsWith("opera://")) return true;
    if (url.startsWith("about:")) return true;
    if (url.startsWith("devtools://")) return true;
    if (url.startsWith("view-source:")) return true;
    if (url.startsWith("file://")) return true;
    if (url.startsWith("https://chrome.google.com/webstore")) return true;
    if (url.startsWith("https://chromewebstore.google.com")) return true;
    return false;
}

/** Single source of truth for the dedup gate + decision write + sentinel. */
async function runGate(
    tabId: number,
    url: string,
    trigger: TabDecision["trigger"],
): Promise<void> {
    if (isRestrictedUrl(url)) {
        // Scripting is forbidden here — clear any stale decision and exit
        // silently. Logging would flood on chrome:// and Web Store tabs.
        clearTabDecision(tabId);
        return;
    }

    const fp = urlFingerprint(url);

    const isDuplicate = isSameDecisionFingerprint(tabId, fp);
    if (isDuplicate) {
        // Cache hit — the whole point of the gate. Stay silent.
        return;
    }

    try {
        const matches = await evaluateUrlMatches(url);
        const decision: TabDecision = {
            urlFp: fp,
            url,
            matches,
            trigger,
            decidedAt: Date.now(),
        };
        setTabDecision(tabId, decision);
        await injectSentinel(tabId, decision);
        console.log(
            `[url-trigger] ${trigger} tab=${tabId} matches=${matches.length} fp=${fp}`,
        );
    } catch (err) {
        // NEVER rethrow — would unregister the chrome listener.
        logCaughtError(
            BgLogTag.MARCO,
            `[url-trigger] gate failed (trigger=${trigger}, tab=${tabId})`,
            err,
        );
    }
}

/* ------------------------------------------------------------------ */
/*  Sentinel injection                                                 */
/* ------------------------------------------------------------------ */

/**
 * Injects (or updates) the `<div id="__marco_sentinel__">` element at
 * the end of `<body>` with the decision summary as data-* attributes.
 * Idempotent: same fingerprint → no DOM write.
 *
 * Runs in the page MAIN world via `chrome.scripting.executeScript` so
 * the page itself (and other content scripts) can read it cheaply.
 */
async function injectSentinel(
    tabId: number,
    decision: TabDecision,
): Promise<void> {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: writeSentinelInPage,
            args: [
                MARCO_SENTINEL_ID,
                SENTINEL_ATTR_FP,
                SENTINEL_ATTR_PROJECTS,
                SENTINEL_ATTR_CAN_RUN,
                SENTINEL_ATTR_TRIGGER,
                SENTINEL_ATTR_DECIDED_AT,
                decision.urlFp,
                decision.matches.map((m) => m.projectId).join(","),
                decision.matches.length > 0,
                decision.trigger,
                decision.decidedAt,
            ],
        });
    } catch (err) {
        // The upfront `isRestrictedUrl()` guard in `runGate` filters the
        // predictable chrome://, Web Store, and other-extension cases.
        // Anything that reaches this catch is unexpected — log it fully
        // (no swallowing, per project policy).
        logCaughtError(
            BgLogTag.MARCO,
            `[url-trigger] sentinel inject failed (tab=${tabId})`,
            err,
        );
    }
}

/**
 * Page-side function. Serialized by Chrome — keep self-contained
 * (no closures, no imports, only the primitives passed via `args`).
 */
function writeSentinelInPage(
    id: string,
    attrFp: string,
    attrProjects: string,
    attrCanRun: string,
    attrTrigger: string,
    attrDecidedAt: string,
    fp: string,
    projectsCsv: string,
    canRun: boolean,
    trigger: string,
    decidedAt: number,
): void {
    try {
        const existing = document.getElementById(id);
        const isSameFp = existing !== null && existing.getAttribute(attrFp) === fp;
        if (isSameFp) {
            return;
        }
        const el = existing ?? document.createElement("div");
        el.id = id;
        el.setAttribute(attrFp, fp);
        el.setAttribute(attrProjects, projectsCsv);
        el.setAttribute(attrCanRun, String(canRun));
        el.setAttribute(attrTrigger, trigger);
        el.setAttribute(attrDecidedAt, String(decidedAt));
        el.style.display = "none";
        const isNew = existing === null;
        if (isNew) {
            const host = document.body ?? document.documentElement;
            host.appendChild(el);
        }
    } catch { // allow-swallow: page may be mid-navigation / detached; sentinel element write is best-effort and re-runs on next decision.
        // Page may be mid-navigation; safe to drop.
    }
}

/* ------------------------------------------------------------------ */
/*  Public read helper (background-side mirror)                        */
/* ------------------------------------------------------------------ */

/** Returns the cached decision for a tab, or null. Sync, hot-path safe. */
export function readDecision(tabId: number): TabDecision | null {
    return getTabDecision(tabId) ?? null;
}
