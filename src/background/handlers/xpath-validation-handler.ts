/**
 * Marco Extension — XPath Validation Handler (Spec 15 T-3)
 *
 * Validates all configured XPath selectors against the active tab.
 * Supports optional CSS selector fallback. Produces structured
 * error reports for stale selectors.
 *
 * @see spec/05-chrome-extension/07-advanced-features.md §XPath Recorder
 * @see spec/05-chrome-extension/05-content-script-adaptation.md — Content script adaptation
 */

import type { MessageRequest } from "../../shared/messages";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface XPathValidationEntry {
    name: string;
    xpath: string;
    selector?: string;
    found: number;
    status: "pass" | "fail" | "fallback";
    error?: string;
    fallbackUsed?: boolean;
}

export interface XPathValidationResult {
    results: XPathValidationEntry[];
    passCount: number;
    failCount: number;
    fallbackCount: number;
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

/** Validates all XPath selectors from the message payload against the active tab. */
export async function handleValidateAllXPaths(
    message: MessageRequest,
): Promise<XPathValidationResult> {
    const msg = message as MessageRequest & {
        xpaths: Record<string, { xpath: string; selector?: string }>;
    };

    const tabId = await getActiveTabId();
    if (tabId === null) {
        const entries = Object.entries(msg.xpaths).map(([name, { xpath, selector }]) => ({
            name,
            xpath,
            selector,
            found: 0,
            status: "fail" as const,
            error: "No active tab found",
        }));
        return { results: entries, passCount: 0, failCount: entries.length, fallbackCount: 0 };
    }

    const results: XPathValidationEntry[] = [];

    for (const [name, { xpath, selector }] of Object.entries(msg.xpaths)) {
        const entry = await validateSingleXPath(tabId, name, xpath, selector);
        results.push(entry);
    }

    const passCount = results.filter(r => r.status === "pass").length;
    const failCount = results.filter(r => r.status === "fail").length;
    const fallbackCount = results.filter(r => r.status === "fallback").length;

    return { results, passCount, failCount, fallbackCount };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getActiveTabId(): Promise<number | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs.length > 0 && tabs[0].id !== undefined ? tabs[0].id! : null;
}

// eslint-disable-next-line max-lines-per-function
async function validateSingleXPath(
    tabId: number,
    name: string,
    xpath: string,
    selector?: string,
): Promise<XPathValidationEntry> {
    if (!xpath && !selector) {
        return { name, xpath, selector, found: 0, status: "fail", error: "No xpath or selector configured" };
    }

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: evaluateXPathAndSelector,
            args: [xpath, selector ?? null],
        });

        if (results.length === 0) {
            return { name, xpath, selector, found: 0, status: "fail", error: "No result returned" };
        }

        const r = results[0].result as { xpathFound: number; selectorFound: number; error?: string };

        if (r.error) {
            return { name, xpath, selector, found: 0, status: "fail", error: r.error };
        }

        if (r.xpathFound > 0) {
            return { name, xpath, selector, found: r.xpathFound, status: "pass" };
        }

        if (selector && r.selectorFound > 0) {
            return {
                name, xpath, selector, found: r.selectorFound, status: "fallback",
                fallbackUsed: true,
                error: `XPath stale — CSS fallback found ${r.selectorFound} element(s). Update XPath config for "${name}".`,
            };
        }

        return {
            name, xpath, selector, found: 0, status: "fail",
            error: `XPath not found: "${name}". ${selector ? "CSS fallback also failed." : "Consider adding a CSS selector fallback."}`,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { name, xpath, selector, found: 0, status: "fail", error: msg };
    }
}

/** Runs in page context. */
function evaluateXPathAndSelector(
    xpath: string,
    selector: string | null,
): { xpathFound: number; selectorFound: number; error?: string } {
    let xpathFound = 0;
    let selectorFound = 0;

    try {
        if (xpath) {
            const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            xpathFound = result.snapshotLength;
        }
    } catch (e) {
        return { xpathFound: 0, selectorFound: 0, error: `Invalid XPath: ${(e as Error).message}` };
    }

    try {
        if (selector) {
            selectorFound = document.querySelectorAll(selector).length;
        }
    } catch { // allow-swallow: malformed CSS selector is reported as selectorFound=0 to the caller
    }

    return { xpathFound, selectorFound };
}
