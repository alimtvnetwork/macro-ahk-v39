/**
 * Open Lovable Tabs Handler
 *
 * Returns the list of currently open Chrome tabs whose URL matches the
 * Lovable platform patterns (lovable.dev / *.lovable.app), enriched with
 * each tab's bound project — derived from BOTH:
 *   1. the in-memory tabInjections map (state-manager), and
 *   2. an automatic per-tab workspace probe (PROBE_DETECTED_WORKSPACE)
 *      sent through the existing message bus to the macro-controller
 *      running in each tab.
 *
 * The probe is best-effort: tabs without the controller injected (or that
 * time out) simply omit the detected workspace fields. Probes run in
 * parallel to keep the panel responsive.
 *
 * Consumed by the macro-controller's "Open Lovable Tabs" panel, which
 * cannot call chrome.tabs directly from the MAIN world
 * (mem://architecture/injection-context-awareness).
 */

import { STORAGE_KEY_ALL_PROJECTS } from "../../shared/constants";
import type { StoredProject, UrlRule } from "../../shared/project-types";
import { getTabInjections } from "../state-manager";
import { isUrlMatch } from "../url-matcher";
import { BgLogTag, logBgError } from "../bg-logger";

/**
 * Short, machine-grep-able failure classification for the workspace probe.
 * Conforms to the mandatory failure-log shape (Core memory: every failure MUST
 * log `Reason` + `ReasonDetail`). "NoReceiver" is the common benign case where
 * the controller hasn't been injected into the tab yet.
 */
export type ProbeFailureReason =
    | "NoTabId"
    | "NoReceiver"
    | "EmptyResponse"
    | "ProbeFailed"
    | "Exception";

export type DetectedWorkspaceSource = "api" | "cache" | "dom" | "none";

export interface MatchedRuleInfo {
    /** The rule's pattern (e.g. "https://*.lovable.app/*"). */
    pattern: string;
    /** The rule's match strategy. */
    matchType: UrlRule["matchType"];
    /** How this rule was identified: replayed from the live injection record, or freshly evaluated against the URL. */
    origin: "injection-record" | "evaluated";
}

export interface OpenLovableTabInfo {
    /** Chrome tab id; null if Chrome did not assign one. */
    tabId: number | null;
    title: string;
    url: string;
    /** Whether the tab is the active tab in its window. */
    active: boolean;
    /** Whether the tab is the focused window. */
    windowFocused: boolean;
    /** Bound project id, or null when no injection has been recorded yet. */
    projectId: string | null;
    /** Resolved project name, or null when no binding could be matched. */
    projectName: string | null;
    /** Path used to bind: "injection", "probe", or "none". */
    bindingSource: "injection" | "probe" | "none";
    /** Workspace name detected by the controller running in the tab (best-effort). */
    detectedWorkspaceName: string | null;
    /** Workspace ID cached by the controller running in the tab (best-effort). */
    detectedWorkspaceId: string | null;
    /** Where the controller derived the workspace name from. */
    detectedWorkspaceSource: DetectedWorkspaceSource | null;
    /** Why the probe did not return data — null on success, a short reason on failure. */
    probeError: string | null;
    /** Short Reason code per LOG-1; null on success. */
    probeFailureReason: ProbeFailureReason | null;
    /** Human-readable detail for the Reason code; null on success. */
    probeFailureReasonDetail: string | null;
    /** Which project URL rule the tab matched (when any). Lets the panel explain why this binding was chosen. */
    matchedRule: MatchedRuleInfo | null;
}

export interface OpenLovableTabsResponse {
    tabs: OpenLovableTabInfo[];
    capturedAt: string;
}

/** URL match patterns for chrome.tabs.query — must mirror auto-injector / cookie-watcher. */
const LOVABLE_TAB_PATTERNS: string[] = [
    "https://lovable.dev/*",
    "https://*.lovable.dev/*",
    "https://lovable.app/*",
    "https://*.lovable.app/*",
];

interface ProbePayload {
    workspaceName?: string;
    workspaceId?: string;
    projectId?: string | null;
    source?: DetectedWorkspaceSource;
}

interface ProbeResult {
    payload: ProbePayload | null;
    error: string | null;
    reason: ProbeFailureReason | null;
    reasonDetail: string | null;
}

export async function handleGetOpenLovableTabs(): Promise<OpenLovableTabsResponse> {
    const [tabs, projectsResult, focusedWindow] = await Promise.all([
        chrome.tabs.query({ url: LOVABLE_TAB_PATTERNS }),
        chrome.storage.local.get(STORAGE_KEY_ALL_PROJECTS),
        safeGetFocusedWindowId(),
    ]);

    const projects: StoredProject[] = projectsResult[STORAGE_KEY_ALL_PROJECTS] ?? [];
    const projectNameById = new Map<string, string>();
    const projectById = new Map<string, StoredProject>();
    for (const p of projects) {
        projectNameById.set(p.id, p.name);
        projectById.set(p.id, p);
    }

    const injections = getTabInjections();

    // Probe every tab in parallel. Errors / missing controllers are tolerated.
    const probeResults = await Promise.all(
        tabs.map((t) => probeTabWorkspace(typeof t.id === "number" ? t.id : null)),
    );

    const out: OpenLovableTabInfo[] = tabs.map((t, i) => {
        const tabId = typeof t.id === "number" ? t.id : null;
        const record = tabId !== null ? injections[tabId] : undefined;
        const probe = probeResults[i];
        const probePayload = probe.payload;

        // Project ID resolution priority: injection record → probe-reported projectId.
        let projectId: string | null = record?.projectId ?? null;
        let bindingSource: OpenLovableTabInfo["bindingSource"] = record !== undefined ? "injection" : "none";
        if (projectId === null && probePayload && typeof probePayload.projectId === "string" && probePayload.projectId !== "") {
            projectId = probePayload.projectId;
            bindingSource = "probe";
        }

        const projectName = projectId !== null ? (projectNameById.get(projectId) ?? null) : null;
        const matchedRule = resolveMatchedRule({
            url: t.url ?? "",
            projectId,
            project: projectId !== null ? (projectById.get(projectId) ?? null) : null,
            injectionMatchedRuleId: record?.matchedRuleId ?? null,
        });

        return {
            tabId,
            title: t.title ?? "",
            url: t.url ?? "",
            active: t.active === true,
            windowFocused: focusedWindow !== null && t.windowId === focusedWindow,
            projectId,
            projectName,
            bindingSource,
            detectedWorkspaceName: probePayload?.workspaceName?.trim() || null,
            detectedWorkspaceId: probePayload?.workspaceId?.trim() || null,
            detectedWorkspaceSource: probePayload?.source ?? null,
            probeError: probe.error,
            probeFailureReason: probe.reason,
            probeFailureReasonDetail: probe.reasonDetail,
            matchedRule,
        };
    });

    return { tabs: out, capturedAt: new Date().toISOString() };
}

/**
 * Identify which UrlRule on the bound project caused this tab to bind.
 *
 * Strategy:
 *   1. If the live injection record carries a `matchedRuleId`
 *      ("<projectId>:<pattern>", per project-matcher.ts), parse the pattern
 *      out of it and look up its matchType on the project — origin = "injection-record".
 *   2. Else evaluate every targetUrls rule of the project against the tab URL
 *      via `isUrlMatch()` and return the first hit — origin = "evaluated".
 *   3. Else null.
 */
function resolveMatchedRule(args: {
    url: string;
    projectId: string | null;
    project: StoredProject | null;
    injectionMatchedRuleId: string | null;
}): MatchedRuleInfo | null {
    const { url, projectId, project, injectionMatchedRuleId } = args;
    if (project === null || projectId === null) return null;

    if (injectionMatchedRuleId !== null && injectionMatchedRuleId.startsWith(projectId + ":")) {
        const pattern = injectionMatchedRuleId.slice(projectId.length + 1);
        const rule = project.targetUrls.find((r) => r.pattern === pattern);
        return {
            pattern,
            matchType: rule?.matchType ?? "glob",
            origin: "injection-record",
        };
    }

    if (url !== "") {
        for (const rule of project.targetUrls) {
            if (isUrlMatch(url, rule)) {
                return {
                    pattern: rule.pattern,
                    matchType: rule.matchType,
                    origin: "evaluated",
                };
            }
        }
    }

    return null;
}

async function safeGetFocusedWindowId(): Promise<number | null> {
    try {
        const w = await chrome.windows.getLastFocused();
        return typeof w.id === "number" ? w.id : null;
    } catch {
        return null;
    }
}

/**
 * Asks a tab's content-script relay to probe the MAIN-world macro-controller
 * for its detected workspace snapshot. Returns null payload + a reason when
 * the tab cannot answer (no content script, page navigating, timeout, …).
 */
async function probeTabWorkspace(tabId: number | null): Promise<ProbeResult> {
    if (tabId === null) {
        return emitProbeFailure(null, "NoTabId", "tab carried no chrome-assigned id");
    }
    try {
        const response: unknown = await chrome.tabs.sendMessage(tabId, { type: "PROBE_DETECTED_WORKSPACE" });
        if (response === undefined || response === null) {
            return emitProbeFailure(tabId, "EmptyResponse", "relay returned no payload (controller may be loading)");
        }
        const r = response as { isOk?: boolean; payload?: ProbePayload | null; errorMessage?: string };
        if (r.isOk === false) {
            return emitProbeFailure(tabId, "ProbeFailed", r.errorMessage ?? "probe failed (no errorMessage from controller)");
        }
        return { payload: r.payload ?? null, error: null, reason: null, reasonDetail: null };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // "Could not establish connection. Receiving end does not exist." is the
        // expected case when the controller isn't injected yet — classify separately
        // so it isn't conflated with genuine SDK exceptions.
        const isNoReceiver = /receiving end does not exist|could not establish connection/i.test(msg);
        const reason: ProbeFailureReason = isNoReceiver ? "NoReceiver" : "Exception";
        return emitProbeFailure(tabId, reason, msg);
    }
}

/**
 * Records the Reason + ReasonDetail to both the returned row AND a structured
 * background-log line per LOG-1. NoReceiver is the benign "controller not
 * injected" case and is logged at console.debug to avoid noise; everything
 * else uses logBgError so it lands in the SQLite errors table.
 */
function emitProbeFailure(
    tabId: number | null,
    reason: ProbeFailureReason,
    reasonDetail: string,
): ProbeResult {
    const tagged = `${BgLogTag.OPEN_TABS} probe failure Reason=${reason} ReasonDetail="${reasonDetail}" tabId=${tabId ?? "null"}`;
    if (reason === "NoReceiver") {
        // Expected when the controller has not yet been injected — keep noise low.
        console.debug(tagged);
    } else {
        logBgError(BgLogTag.OPEN_TABS, `probe_${reason}`, tagged, undefined, {
            contextDetail: reasonDetail,
        });
    }
    return { payload: null, error: reasonDetail, reason, reasonDetail };
}
