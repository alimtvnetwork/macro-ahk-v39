/**
 * Marco Extension — State Manager
 *
 * Manages transient state that survives service worker termination
 * via chrome.storage.session. See spec 19-opfs-persistence-strategy.md.
 */

import type { MatchResult, ScriptBindingResolved } from "../shared/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Per-tab injection tracking record. */
export interface TabInjectionRecord {
    scriptIds: string[];
    timestamp: string;
    projectId: string;
    matchedRuleId: string;
    /** Last known good script bindings for SPA re-injection (P-009). */
    lastGoodBindings?: ScriptBindingResolved[];
    /** Which injection path was used: main-blob, userScripts, isolated-blob, or MAIN/ISOLATED. */
    injectionPath?: string;
    /** Which DOM element was used as insertion target: body or documentElement. */
    domTarget?: string;
    /** Total pipeline duration in milliseconds. */
    pipelineDurationMs?: number;
    /** Performance budget threshold in milliseconds. */
    budgetMs?: number;
    /** Post-injection verification results — confirms globals landed in MAIN world. */
    verification?: {
        marcoSdk: boolean;
        extRoot: boolean;
        mcClass: boolean;
        mcInstance: boolean;
        uiContainer: boolean;
        markerEl: boolean;
        verifiedAt: string;
    };
}

/** Full transient state persisted to chrome.storage.session. */
export interface TransientState {
    activeProjectId: string | null;
    tabInjections: Record<number, TabInjectionRecord>;
    healthState: "HEALTHY" | "DEGRADED" | "ERROR" | "FATAL";
    currentSessionId: string;
    persistenceMode: "opfs" | "storage" | "memory";
    lastFlushTimestamp: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "marco_transient_state";

/* ------------------------------------------------------------------ */
/*  Module State                                                       */
/* ------------------------------------------------------------------ */

let activeProjectId: string | null = null;
let tabInjections: Record<number, TabInjectionRecord> = {};
let healthState: TransientState["healthState"] = "HEALTHY";
let currentSessionId = "";
let persistenceMode: TransientState["persistenceMode"] = "memory";

/* ------------------------------------------------------------------ */
/*  Per-Tab URL Decision Cache (2026-05-16 audit U-1/U-2/U-3)         */
/* ------------------------------------------------------------------ */

/**
 * Cached URL-match decision for a single tab. Populated ONLY by the
 * three allowed triggers (initial load, refresh, tab change) so that
 * `evaluateUrlMatches()` runs at most once per (tab, urlFingerprint).
 * Lifetime is the tab's lifetime — cleared on `tabs.onRemoved`.
 *
 * Memory-only; this is a hot path read on every tab activation.
 * Persisting to `chrome.storage.session` would cost an async hop and
 * defeat the cache purpose. SW restart simply re-warms it from the
 * next trigger — that's the same cost as today's cold path.
 */
export interface TabDecision {
    /** URL fingerprint produced by `urlFingerprint(url)`. */
    urlFp: string;
    /** Full URL at decision time — kept for diagnostics only. */
    url: string;
    /** Resolved matches (may be empty array — empty IS a valid decision). */
    matches: MatchResult[];
    /** Trigger that produced this decision. */
    trigger: "load" | "refresh" | "activate";
    /** Decision wall-clock timestamp (ms since epoch). */
    decidedAt: number;
}

const tabDecisionCache: Map<number, TabDecision> = new Map();

/** Returns the cached decision for a tab, or undefined if none. */
export function getTabDecision(tabId: number): TabDecision | undefined {
    return tabDecisionCache.get(tabId);
}

/** Stores a fresh decision for a tab. */
export function setTabDecision(tabId: number, decision: TabDecision): void {
    tabDecisionCache.set(tabId, decision);
}

/** Removes the cached decision for a tab (call on close/invalidate). */
export function clearTabDecision(tabId: number): void {
    tabDecisionCache.delete(tabId);
}

/**
 * Returns true iff the tab already has a decision for this exact
 * fingerprint. Callers MUST use this gate before calling
 * `evaluateUrlMatches()` from a navigation trigger — that's the whole
 * point of the cache.
 */
export function isSameDecisionFingerprint(tabId: number, urlFp: string): boolean {
    const cached = tabDecisionCache.get(tabId);
    return cached !== undefined && cached.urlFp === urlFp;
}

/* ------------------------------------------------------------------ */
/*  Getters                                                            */
/* ------------------------------------------------------------------ */

/** Returns the currently active project ID. */
export function getActiveProjectId(): string | null {
    return activeProjectId;
}

/** Returns the tab injection records. */
export function getTabInjections(): Record<number, TabInjectionRecord> {
    return tabInjections;
}

/** Returns the current health state. */
export function getHealthState(): TransientState["healthState"] {
    return healthState;
}

/** Returns the current session ID. */
export function getCurrentSessionId(): string {
    return currentSessionId;
}

/* ------------------------------------------------------------------ */
/*  Setters                                                            */
/* ------------------------------------------------------------------ */

/** Updates the active project ID. */
export function setActiveProjectId(id: string | null): void {
    activeProjectId = id;
}

/** Records a script injection for a tab. */
export function setTabInjection(tabId: number, record: TabInjectionRecord): void {
    tabInjections[tabId] = record;
}

/** Removes injection tracking for a closed tab. */
export function removeTabInjection(tabId: number): void {
    delete tabInjections[tabId];
    tabDecisionCache.delete(tabId);
}

/** Updates the health state. */
export function setHealthState(state: TransientState["healthState"]): void {
    healthState = state;
}

/** Updates the current session ID. */
export function setCurrentSessionId(id: string): void {
    currentSessionId = id;
}

/** Updates the persistence mode. */
export function setPersistenceMode(mode: TransientState["persistenceMode"]): void {
    persistenceMode = mode;
}

/* ------------------------------------------------------------------ */
/*  Rehydration                                                        */
/* ------------------------------------------------------------------ */

/** Restores transient state from chrome.storage.session on wake. */
export async function rehydrateState(): Promise<void> {
    const stored = await (chrome.storage as unknown as { session: { get: (k: string) => Promise<Record<string, unknown>> } }).session.get(SESSION_KEY);
    const state: TransientState = stored[SESSION_KEY] ?? getDefaultState();

    activeProjectId = state.activeProjectId;
    tabInjections = state.tabInjections;
    healthState = state.healthState;
    currentSessionId = state.currentSessionId;
    persistenceMode = state.persistenceMode;

    await pruneClosedTabs();
    console.log("[state-manager] State rehydrated");
}

/** Returns the default empty transient state. */
function getDefaultState(): TransientState {
    return {
        activeProjectId: null,
        tabInjections: {},
        healthState: "HEALTHY",
        currentSessionId: "",
        persistenceMode: "memory",
        lastFlushTimestamp: new Date().toISOString(),
    };
}

/** Removes injection entries for tabs that no longer exist. */
async function pruneClosedTabs(): Promise<void> {
    const tabs = await (chrome.tabs.query as (q: unknown) => Promise<Array<{ id?: number }>>)({});
    const validTabIds = new Set(tabs.map((t) => t.id));

    for (const tabIdStr of Object.keys(tabInjections)) {
        const tabId = Number(tabIdStr);
        const isTabClosed = !validTabIds.has(tabId);

        if (isTabClosed) {
            delete tabInjections[tabId];
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

/** Saves all transient state to chrome.storage.session. */
export async function saveTransientState(): Promise<void> {
    const state: TransientState = {
        activeProjectId,
        tabInjections,
        healthState,
        currentSessionId,
        persistenceMode,
        lastFlushTimestamp: new Date().toISOString(),
    };

    await (chrome.storage as unknown as { session: { set: (i: Record<string, unknown>) => Promise<void> } }).session.set({ [SESSION_KEY]: state });
}
