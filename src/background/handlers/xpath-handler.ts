/**
 * Marco Extension — XPath Recorder Handler
 *
 * Handles TOGGLE_XPATH_RECORDER, GET_RECORDED_XPATHS,
 * CLEAR_RECORDED_XPATHS, TEST_XPATH messages.
 * Uses chrome.scripting to inject/remove recorder content script.
 *
 * @see spec/05-chrome-extension/07-advanced-features.md §XPath Recorder
 * @see spec/05-chrome-extension/05-content-script-adaptation.md — Content script adaptation
 */

import type { MessageRequest, OkResponse } from "../../shared/messages";
import type { RecordedXPath } from "../../shared/xpath-types";
import { logCaughtError, BgLogTag} from "../bg-logger";

/* ------------------------------------------------------------------ */
/*  Module State                                                       */
/* ------------------------------------------------------------------ */

let isRecording = false;
let recordedXPaths: RecordedXPath[] = [];
let activeRecordingTabId: number | null = null;

/** Resets XPath handler state (for testing). */
export function resetXPathState(): void {
    isRecording = false;
    recordedXPaths = [];
    activeRecordingTabId = null;
}

/* ------------------------------------------------------------------ */
/*  TOGGLE_XPATH_RECORDER                                              */
/* ------------------------------------------------------------------ */

/** Toggles the XPath recorder on the active web tab (not the Options tab). */
export async function handleToggleXPathRecorder(
    _message: MessageRequest,
    _sender: chrome.runtime.MessageSender,
): Promise<{ isRecording: boolean }> {
    const tabId = await resolveTargetTabId();
    const isMissingTab = tabId === null;

    if (isMissingTab) {
        return { isRecording: false };
    }

    if (isRecording) {
        await stopRecording(tabId);
    } else {
        await startRecording(tabId);
    }

    return { isRecording };
}

/**
 * Resolves the tab to inject the recorder into.
 *
 * Strategy: pick the active tab in the last-focused normal window so the
 * recorder lands on the user's real web page (e.g. github.com), not on the
 * Options/Popup tab that initiated the toggle. Falls back to the active tab
 * in the current window, then to any active tab, and finally null.
 */
async function resolveTargetTabId(): Promise<number | null> {
    const optionsUrl = chrome.runtime.getURL("");

    const isWebTab = (url: string | undefined): boolean => {
        if (url === undefined) return false;
        if (url.startsWith(optionsUrl)) return false;
        if (url.startsWith("chrome://")) return false;
        if (url.startsWith("chrome-extension://")) return false;
        if (url.startsWith("edge://")) return false;
        if (url.startsWith("about:")) return false;
        return true;
    };

    const queries: chrome.tabs.QueryInfo[] = [
        { active: true, lastFocusedWindow: true, windowType: "normal" },
        { active: true, currentWindow: true },
        { active: true },
    ];

    for (const query of queries) {
        try {
            const tabs = await chrome.tabs.query(query);
            const candidate = tabs.find((t) => t.id !== undefined && isWebTab(t.url));
            if (candidate?.id !== undefined) return candidate.id;
        } catch { // allow-swallow: tabs.query rejection falls through to the next query variant in the waterfall
        }
    }

    return null;
}

/** Starts recording XPaths in the given tab. */
async function startRecording(tabId: number): Promise<void> {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content-scripts/xpath-recorder.js"],
        });

        isRecording = true;
        activeRecordingTabId = tabId;
        recordedXPaths = [];
    } catch (err) {
        logInjectionError("start", err);
    }
}

/** Stops recording XPaths in the given tab. */
async function stopRecording(tabId: number): Promise<void> {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                window.dispatchEvent(new CustomEvent("marco-xpath-stop"));
            },
        });
    } catch (err) {
        logInjectionError("stop", err);
    }

    isRecording = false;
    activeRecordingTabId = null;
}

/** Logs an injection error for recorder start/stop. */
function logInjectionError(action: string, error: unknown): void {
    logCaughtError(BgLogTag.XPATH, `Failed to ${action} recorder`, error);
}

/* ------------------------------------------------------------------ */
/*  GET_RECORDED_XPATHS                                                */
/* ------------------------------------------------------------------ */

/** Returns all recorded XPaths from the current session. */
export async function handleGetRecordedXPaths(
    _message: MessageRequest,
    _sender: chrome.runtime.MessageSender,
): Promise<{ recorded: RecordedXPath[]; isRecording: boolean }> {
    return {
        recorded: recordedXPaths,
        isRecording,
    };
}

/* ------------------------------------------------------------------ */
/*  CLEAR_RECORDED_XPATHS                                              */
/* ------------------------------------------------------------------ */

/** Clears all recorded XPaths. */
export async function handleClearRecordedXPaths(
    _message: MessageRequest,
    _sender: chrome.runtime.MessageSender,
): Promise<OkResponse> {
    recordedXPaths = [];
    return { isOk: true };
}
/* ------------------------------------------------------------------ */
/*  Re-export TEST_XPATH from split file                               */
/* ------------------------------------------------------------------ */

export { handleTestXPath } from "./xpath-test-handler";

/* ------------------------------------------------------------------ */
/*  Incoming XPath Records (from content script)                       */
/* ------------------------------------------------------------------ */

/** Adds a recorded XPath entry from the content script. */
export function addRecordedXPath(entry: RecordedXPath): void {
    recordedXPaths.push(entry);
}
