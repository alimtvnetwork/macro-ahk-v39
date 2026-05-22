/**
 * Marco Extension — Config & Auth Handler
 *
 * Handles GET_CONFIG, GET_TOKEN, REFRESH_TOKEN messages.
 * Uses chrome.cookies for bearer token and chrome.storage.local
 * for config cascade (remote > local > bundled defaults).
 *
 * @see spec/05-chrome-extension/02-config-json-schema.md — Config JSON schema
 * @see spec/05-chrome-extension/04-cookie-and-auth.md — Cookie & auth strategy
 * @see spec/05-chrome-extension/36-cookie-only-bearer.md — Cookie-only bearer flow
 */

import {
    resolveConfigCascade,
    getRemoteFetchStatus,
} from "../remote-config-fetcher";
import { logBgWarnError, logCaughtError, logSampledDebug, BgLogTag} from "../bg-logger";
import {
    buildCookieUrlCandidates,
    readCookieValueFromCandidates,
} from "../cookie-helpers";
import { readAllProjects } from "./project-helpers";
import type { CookieBinding } from "../../shared/project-types";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COOKIE_URL = "https://lovable.dev";
const COOKIE_SESSION_ID = "lovable-session-id.id";
const COOKIE_SESSION_ID_V2 = "lovable-session-id-v2";
const COOKIE_SESSION_ID_LEGACY = "lovable-session-id";
const COOKIE_REFRESH_TOKEN = "lovable-session-id.refresh";
const COOKIE_SESSION_ID_SECURE = "__Secure-lovable-session-id.id";
const COOKIE_REFRESH_TOKEN_SECURE = "__Secure-lovable-session-id.refresh";
const COOKIE_SESSION_ID_HOST = "__Host-lovable-session-id.id";
const COOKIE_REFRESH_TOKEN_HOST = "__Host-lovable-session-id.refresh";
const AUTH_API_BASE = "https://api.lovable.dev";
const TOKEN_CACHE_TTL_MS = 30_000;

const SESSION_COOKIE_NAME_CANDIDATES = [
    COOKIE_SESSION_ID_V2,
    COOKIE_SESSION_ID,
    COOKIE_SESSION_ID_SECURE,
    COOKIE_SESSION_ID_HOST,
    COOKIE_SESSION_ID_LEGACY,
] as const;

const REFRESH_COOKIE_NAME_CANDIDATES = [
    COOKIE_REFRESH_TOKEN,
    COOKIE_REFRESH_TOKEN_SECURE,
    COOKIE_REFRESH_TOKEN_HOST,
] as const;

import { LOVABLE_TAB_PATTERNS } from "../../shared/lovable-tab-patterns";

// Extends the shared platform list with localhost for dev-mode auth probing.
const PLATFORM_TAB_PATTERNS: readonly string[] = [
    ...LOVABLE_TAB_PATTERNS,
    "http://localhost/*",
    "https://localhost/*",
];

const AUTH_COOKIE_NAME_PATTERN = /(lovable|session|token|auth)/i;

/* ------------------------------------------------------------------ */
/*  Project Cookie Resolution                                          */
/* ------------------------------------------------------------------ */

/**
 * Resolves session and refresh cookie names from the active project's
 * dependency chain. Always appends hardcoded fallbacks for compatibility
 * when stored project bindings are stale.
 */
async function resolveSessionCookieNamesFromProjects(_projectId?: string | null): Promise<{
    sessionNames: readonly string[];
    refreshNames: readonly string[];
}> {
    try {
        const projects = await readAllProjects();
        const cookieBindings: CookieBinding[] = [];

        // Collect cookie bindings from all projects (SDK first since it's global)
        for (const project of projects) {
            if (project.cookies && project.cookies.length > 0) {
                cookieBindings.push(...project.cookies);
            }
        }

        const sessionNamesFromBindings = cookieBindings
            .filter((c) => c.role === "session")
            .map((c) => c.cookieName)
            .filter((name): name is string => typeof name === "string" && name.length > 0);
        const refreshNamesFromBindings = cookieBindings
            .filter((c) => c.role === "refresh")
            .map((c) => c.cookieName)
            .filter((name): name is string => typeof name === "string" && name.length > 0);

        return {
            sessionNames: [...new Set([...sessionNamesFromBindings, ...SESSION_COOKIE_NAME_CANDIDATES])],
            refreshNames: [...new Set([...refreshNamesFromBindings, ...REFRESH_COOKIE_NAME_CANDIDATES])],
        };
    } catch (bindingsErr) {
        logSampledDebug(
            BgLogTag.CONFIG_AUTH,
            "getCookieNames",
            "Project cookie bindings unavailable — falling back to default candidate name lists",
            bindingsErr instanceof Error ? bindingsErr : String(bindingsErr),
        );
        return {
            sessionNames: SESSION_COOKIE_NAME_CANDIDATES,
            refreshNames: REFRESH_COOKIE_NAME_CANDIDATES,
        };
    }
}

/* ------------------------------------------------------------------ */
/*  Module State                                                       */
/* ------------------------------------------------------------------ */

let cachedSessionId: string | null = null;
let cachedRefreshToken: string | null = null;
let cachedAt = 0;
let isRefreshing = false;

/** Resets module-level auth cache. Exported for test use only. */
export function _resetAuthCacheForTest(): void {
    cachedSessionId = null;
    cachedRefreshToken = null;
    cachedAt = 0;
    isRefreshing = false;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SessionTokens {
    sessionId: string | null;
    refreshToken: string | null;
}

interface CookieLookupResult {
    value: string | null;
    cookieName: string | null;
}

interface CookieDiscoverySummary {
    checkedUrls: string[];
    authLikeCookieNames: string[];
}

/* ------------------------------------------------------------------ */
/*  Default Config                                                     */
/* ------------------------------------------------------------------ */

/** Returns the bundled default configuration. */
function getBundledDefaults(): Record<string, unknown> {
    return {
        logLevel: "info",
        maxRetries: 3,
        timeoutMs: 5000,
        injectionMode: "programmatic",
        configMethod: "globalObject",
    };
}

/* ------------------------------------------------------------------ */
/*  GET_CONFIG                                                         */
/* ------------------------------------------------------------------ */

/** Retrieves the merged config using the 3-tier cascade. */
export async function handleGetConfig(): Promise<{
    config: Record<string, unknown>;
    source: "local" | "remote" | "hardcoded";
}> {
    const defaults = getBundledDefaults();
    const cascadeResult = await resolveConfigCascade(defaults);

    return {
        config: cascadeResult.config,
        source: cascadeResult.source,
    };
}

/** Returns the remote fetch status for UI display. */
export function getConfigFetchStatus() {
    return getRemoteFetchStatus();
}

/* ------------------------------------------------------------------ */
/*  GET_TOKEN  (with auto-refresh on expiry)                           */
/* ------------------------------------------------------------------ */

/**
 * Resolves a JWT from direct cookie access, platform localStorage, or signed URL fallback.
 *
 * Network auth-token exchange is intentionally disabled to avoid noisy 401s.
 * See root-cause: spec/22-app-issues/80-auth-token-bridge-null-on-preview.md
 */
// eslint-disable-next-line max-lines-per-function
export async function handleGetToken(
    _projectId?: string,
    tabUrlHint?: string,
): Promise<{ token: string | null; refreshed: boolean; errorMessage?: string; cookieName?: string }> {
    const cachedTokenIsJwt = cachedSessionId !== null && isLikelyJwt(cachedSessionId);
    const isCacheValid = cachedTokenIsJwt
        && (Date.now() - cachedAt) < TOKEN_CACHE_TTL_MS;

    if (isCacheValid) {
        return { token: cachedSessionId, refreshed: false };
    }

    const projectId = _projectId ?? await getActiveTabProjectId(tabUrlHint);
    const resolvedCookieNames = await resolveSessionCookieNamesFromProjects(projectId);
    const primaryUrl = await resolvePrimaryUrl(tabUrlHint);

    // ── Strategy 1 (preferred): Direct cookie read — no network, no 401 risk ──
    const sessionLookup = await readCookieValueByNameCandidates(
        resolvedCookieNames.sessionNames,
        primaryUrl,
    );
    if (sessionLookup.value !== null && isLikelyJwt(sessionLookup.value)) {
        console.log("[config-auth] GET_TOKEN: found JWT directly in session cookie");
        cachedSessionId = sessionLookup.value;
        cachedAt = Date.now();
        return {
            token: sessionLookup.value,
            refreshed: true,
            cookieName: sessionLookup.cookieName ?? COOKIE_SESSION_ID,
        };
    }

    // ── Strategy 2: Supabase localStorage JWT from platform tabs ──
    const localStorageJwt = await readSupabaseJwtFromPlatformTabs(tabUrlHint);
    if (localStorageJwt !== null) {
        console.log("[config-auth] GET_TOKEN: found JWT in platform tab localStorage");
        cachedSessionId = localStorageJwt;
        cachedAt = Date.now();
        return {
            token: localStorageJwt,
            refreshed: true,
            cookieName: "localStorage[sb-*-auth-token]",
        };
    }

    // ── Strategy 3: Signed URL token fallback (no network) ──
    const signedUrlToken = await resolveSignedUrlTokenCandidate(tabUrlHint, primaryUrl);

    if (signedUrlToken !== null) {
        console.log("[config-auth] GET_TOKEN: using signed URL token fallback");
        cachedSessionId = signedUrlToken;
        cachedAt = Date.now();
        return {
            token: signedUrlToken,
            refreshed: true,
            cookieName: "signedUrl[__lovable_token]",
        };
    }

    // ── Strategy 4: Opaque session-cookie exchange ──
    const refreshLookup = sessionLookup.value === null
        ? await readCookieValueByNameCandidates(resolvedCookieNames.refreshNames, primaryUrl)
        : { value: null, cookieName: null };
    const exchangeToken = await fetchAuthTokenFromSessionExchange(
        projectId,
        sessionLookup.value !== null || refreshLookup.value !== null,
    );

    if (exchangeToken !== null) {
        console.log("[config-auth] GET_TOKEN: exchanged opaque session cookie for JWT");
        cachedSessionId = exchangeToken;
        cachedAt = Date.now();
        return {
            token: exchangeToken,
            refreshed: true,
            cookieName: "auth-token-exchange",
        };
    }

    if (sessionLookup.value !== null) {
        logBgWarnError(BgLogTag.CONFIG_AUTH, "GET_TOKEN: session cookie exists but no JWT could be derived");
        return {
            token: null,
            refreshed: false,
            errorMessage: "Session cookie exists, but JWT cookie/localStorage lookup failed.",
        };
    }

    const cookieDiscovery = await discoverAuthCookieNames(primaryUrl);

    return {
        token: null,
        refreshed: false,
        errorMessage: buildMissingCookieMessage(
            cookieDiscovery,
            resolvedCookieNames.sessionNames,
            resolvedCookieNames.refreshNames,
        ),
    };
}

/* ------------------------------------------------------------------ */
/*  GET_TOKENS  (both session + refresh)                               */
/* ------------------------------------------------------------------ */

/** Reads both session cookies and returns them as a pair. */
export async function handleGetTokens(): Promise<SessionTokens> {
    const activeTabUrl = await getActiveTabUrl();
    const primaryUrl = activeTabUrl ?? COOKIE_URL;
    const resolved = await resolveSessionCookieNamesFromProjects();

    const sessionLookup = await readCookieValueByNameCandidates(
        resolved.sessionNames,
        primaryUrl,
    );
    const refreshLookup = await readCookieValueByNameCandidates(
        resolved.refreshNames,
        primaryUrl,
    );
    const sessionId = sessionLookup.value;
    const refreshToken = refreshLookup.value;

    cachedSessionId = null;
    cachedRefreshToken = refreshToken;
    cachedAt = 0;

    return { sessionId, refreshToken };
}

/* ------------------------------------------------------------------ */
/*  REFRESH_TOKEN  (forced re-read + API refresh)                      */
/* ------------------------------------------------------------------ */

/** Forces cookie re-read and API refresh. */
// eslint-disable-next-line max-lines-per-function
export async function handleRefreshToken(
    projectId?: string,
    tabUrlHint?: string,
): Promise<SessionTokens & { authToken?: string; errorMessage?: string }> {
    cachedSessionId = null;
    cachedRefreshToken = null;
    cachedAt = 0;

    const primaryUrl = await resolvePrimaryUrl(tabUrlHint);
    const resolved = await resolveSessionCookieNamesFromProjects(projectId);
    const sessionLookup = await readCookieValueByNameCandidates(
        resolved.sessionNames,
        primaryUrl,
    );
    const refreshLookup = await readCookieValueByNameCandidates(
        resolved.refreshNames,
        primaryUrl,
    );
    const sessionId = sessionLookup.value;
    const refreshToken = refreshLookup.value;

    // Strategy 1 (preferred): Session cookie is already a JWT — no network call
    let authToken: string | null = null;
    if (sessionId && isLikelyJwt(sessionId)) {
        authToken = sessionId;
        console.log("[config-auth] REFRESH: found JWT directly in session cookie");
    }

    // Strategy 2: Supabase localStorage JWT
    if (!authToken) {
        authToken = await readSupabaseJwtFromPlatformTabs(tabUrlHint);
    }

    // Strategy 3: Signed URL token fallback (no network)
    if (!authToken) {
        authToken = await resolveSignedUrlTokenCandidate(tabUrlHint, primaryUrl);
    }

    // Strategy 4: Opaque session-cookie exchange
    if (!authToken) {
        authToken = await fetchAuthTokenFromSessionExchange(
            projectId,
            sessionId !== null || refreshToken !== null,
        );
    }

    cachedSessionId = authToken ?? null;
    cachedRefreshToken = refreshToken;
    cachedAt = authToken ? Date.now() : 0;

    if (authToken) {
        return { sessionId, refreshToken, authToken };
    }

    const cookieDiscovery = await discoverAuthCookieNames(primaryUrl);
    return {
        sessionId,
        refreshToken,
        authToken: undefined,
        errorMessage: buildMissingCookieMessage(
            cookieDiscovery,
            resolved.sessionNames,
            resolved.refreshNames,
        ),
    };
}

/* ------------------------------------------------------------------ */
/*  Auto-Refresh Logic                                                 */
/* ------------------------------------------------------------------ */

/** Attempts to get a fresh auth token without any auth-token network exchange. */
async function attemptAutoRefresh(
    projectId?: string,
): Promise<string | null> {
    if (isRefreshing) {
        return null;
    }

    isRefreshing = true;

    try {
        const refreshResult = await handleRefreshToken(projectId);
        const authToken = refreshResult.authToken ?? null;

        if (authToken !== null) {
            cachedSessionId = authToken;
            cachedAt = Date.now();
            console.log("[config-auth] Auto-refresh successful (cookie/localStorage)");
            return authToken;
        }

        logBgWarnError(BgLogTag.CONFIG_AUTH, "Auto-refresh returned no token");
        return null;
    } catch (refreshError) {
        logRefreshError(refreshError);
        return null;
    } finally {
        isRefreshing = false;
    }
}

/**
 * Legacy helper kept for compatibility.
 *
 * Network auth-token exchange is disabled; this now resolves a JWT only from
 * direct cookies, platform localStorage, or signed URL tokens.
 */
export async function fetchAuthToken(
    _bearerToken: string | null,
    projectId?: string,
    tabUrlHint?: string,
): Promise<string | null> {
    const primaryUrl = await resolvePrimaryUrl(tabUrlHint);
    const resolved = await resolveSessionCookieNamesFromProjects(projectId);

    const sessionCookieLookup = await readCookieValueByNameCandidates(
        resolved.sessionNames,
        primaryUrl,
    );
    if (sessionCookieLookup.value !== null && isLikelyJwt(sessionCookieLookup.value)) {
        return sessionCookieLookup.value;
    }

    const localStorageJwt = await readSupabaseJwtFromPlatformTabs(tabUrlHint);
    if (localStorageJwt !== null) {
        return localStorageJwt;
    }

    const signedUrlToken = await resolveSignedUrlTokenCandidate(tabUrlHint, primaryUrl);
    if (signedUrlToken !== null) {
        return signedUrlToken;
    }

    const exchangeToken = await fetchAuthTokenFromSessionExchange(
        projectId,
        sessionCookieLookup.value !== null,
    );

    if (exchangeToken !== null) {
        return exchangeToken;
    }

    if (sessionCookieLookup.value !== null) {
        logBgWarnError(BgLogTag.CONFIG_AUTH, "Session cookie exists but no JWT could be derived from localStorage, URL, or auth-token exchange");
    }

    return null;
}

/** Checks if a token looks like a JWT (3-part base64 starting with eyJ). */
function isLikelyJwt(token: string): boolean {
    return token.startsWith("eyJ") && token.split(".").length === 3;
}

interface TokenValidationResult {
    isValid: boolean;
    status: number | null;
}

/** Validates a token structurally without any network call. */
async function validateToken(
    token: string,
    _projectId?: string,
): Promise<TokenValidationResult> {
    return {
        isValid: isLikelyJwt(token),
        status: null,
    };
}

/** Returns the active tab URL when available. */
async function getActiveTabUrl(): Promise<string | null> {
    try {
        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });

        return tabs[0]?.url ?? null;
    } catch (queryErr) {
        logSampledDebug(
            BgLogTag.CONFIG_AUTH,
            "getActiveTabUrl",
            "chrome.tabs.query(active,currentWindow) failed — returning null URL",
            queryErr instanceof Error ? queryErr : String(queryErr),
        );
        return null;
    }
}

async function getActivePlatformTabs(tabUrlHint?: string): Promise<chrome.tabs.Tab[]> {
    const byHint: chrome.tabs.Tab[] = [];

    if (typeof tabUrlHint === "string" && tabUrlHint.length > 0) {
        try {
            const hintedTabs = await chrome.tabs.query({ url: [tabUrlHint] });
            byHint.push(...hintedTabs);
        } catch (hintErr) {
            // Ignore hint query failures — pattern-based query below still runs.
            // Hint URL may be malformed or restricted (chrome://, file://).
            console.debug(`[config-auth] tabs.query(hint="${tabUrlHint}") failed, falling back to pattern query:`, hintErr);
        }
    }

    const patternTabs = await chrome.tabs.query({ url: [...PLATFORM_TAB_PATTERNS] });

    const merged = new Map<number, chrome.tabs.Tab>();
    for (const tab of byHint) {
        if (typeof tab.id === "number") merged.set(tab.id, tab);
    }
    for (const tab of patternTabs) {
        if (typeof tab.id === "number") merged.set(tab.id, tab);
    }

    return [...merged.values()];
}

// eslint-disable-next-line max-lines-per-function
async function readSupabaseJwtFromPlatformTabs(tabUrlHint?: string): Promise<string | null> {
    const tabs = await getActivePlatformTabs(tabUrlHint);

    for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;

        try {
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: "MAIN",
                func: function scanLocalStorageForJwt(): string | null { // eslint-disable-line sonarjs/cognitive-complexity -- localStorage scan with priority matching
                    try {
                        const len = localStorage.length;
                        // Priority 1: Supabase auth token (sb-*-auth-token)
                        for (let i = 0; i < len; i++) {
                            const key = localStorage.key(i);
                            if (!key) continue;
                            if (key.startsWith("sb-") && key.includes("-auth-token")) {
                                const raw = localStorage.getItem(key);
                                if (!raw) continue;
                                try {
                                    const parsed = JSON.parse(raw);
                                    const token = parsed?.access_token
                                        ?? parsed?.currentSession?.access_token
                                        ?? parsed?.session?.access_token;
                                    if (typeof token === "string" && token.startsWith("eyJ") && token.split(".").length === 3) {
                                        return token;
                                    }
                                } catch {
                                    if (raw.startsWith("eyJ") && raw.split(".").length === 3) {
                                        return raw;
                                    }
                                }
                            }
                        }
                        // Priority 2: Lovable-specific auth keys
                        const lovableKeys = ["lovable-auth-token", "lovable:token", "auth-token", "supabase.auth.token"];
                        for (let j = 0; j < lovableKeys.length; j++) {
                            const val = localStorage.getItem(lovableKeys[j]);
                            if (!val) continue;
                            try {
                                const p2 = JSON.parse(val);
                                const t2 = p2?.access_token ?? p2?.currentSession?.access_token ?? p2?.token;
                                if (typeof t2 === "string" && t2.startsWith("eyJ") && t2.split(".").length === 3) return t2;
                            } catch { if (val.startsWith("eyJ") && val.split(".").length === 3) return val; }
                        }
                    } catch (lsErr) { console.debug("[config-auth] localStorage scan unavailable:", lsErr); }
                    return null;
                },
            });

            const token = result?.[0]?.result;
            if (typeof token === "string" && isLikelyJwt(token)) {
                return token;
            }
        } catch (scriptErr) {
            // Tab may be unavailable, restricted, or closed mid-scan. Log warn so a
            // platform-tab regression that breaks token discovery surfaces in diagnostics.
            logBgWarnError(BgLogTag.CONFIG_AUTH, `executeScript localStorage JWT scan failed for tab — proceeding to next candidate tab`, scriptErr);
        }
    }

    return null;
}

/** Extracts project ID from the active tab URL.
 *  Supports both path-based (/projects/{id}) and subdomain-based
 *  (id-preview--{id}.lovable.app) URL formats.
 */
async function getActiveTabProjectId(tabUrlHint?: string): Promise<string | null> {
    const hasTabUrlHint = typeof tabUrlHint === "string" && tabUrlHint.length > 0;
    if (hasTabUrlHint) {
        return extractProjectIdFromUrl(tabUrlHint);
    }

    const tabUrl = await getActiveTabUrl();
    const hasUrl = tabUrl !== null && tabUrl.length > 0;

    if (!hasUrl) {
        return null;
    }

    return extractProjectIdFromUrl(tabUrl!);
}

async function resolvePrimaryUrl(tabUrlHint?: string): Promise<string> {
    if (typeof tabUrlHint === "string" && tabUrlHint.length > 0) {
        return tabUrlHint;
    }

    const activeTabUrl = await getActiveTabUrl();
    return activeTabUrl ?? COOKIE_URL;
}

function extractSignedUrlTokenFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;

    try {
        const parsed = new URL(url);
        const token = parsed.searchParams.get("__lovable_token")
            ?? parsed.searchParams.get("lovable_token");

        return token && isLikelyJwt(token)
            ? token
            : null;
    } catch (urlErr) {
        logSampledDebug(
            BgLogTag.CONFIG_AUTH,
            "extractSignedUrlTokenFromUrl",
            "URL parse failed for signed-URL token extraction — input was not a valid URL",
            urlErr instanceof Error ? urlErr : String(urlErr),
        );
        return null;
    }
}

async function resolveSignedUrlTokenCandidate(
    tabUrlHint?: string,
    primaryUrl?: string,
): Promise<string | null> {
    const hintedToken = extractSignedUrlTokenFromUrl(tabUrlHint);
    if (hintedToken) {
        return hintedToken;
    }

    const primaryToken = extractSignedUrlTokenFromUrl(primaryUrl);
    if (primaryToken) {
        return primaryToken;
    }

    const activeTabUrl = await getActiveTabUrl();
    return extractSignedUrlTokenFromUrl(activeTabUrl);
}

async function fetchAuthTokenFromSessionExchange(
    projectId: string | null | undefined,
    hasSessionCookie: boolean,
): Promise<string | null> {
    if (!hasSessionCookie || !projectId) return null;

    // HEFF: single attempt, no retry, no refresh-loop. 401/403 are reported
    // and propagated as null (unified-auth-contract handles re-auth elsewhere).
    const url = `${AUTH_API_BASE}/projects/${projectId}/auth-token`;
    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include",
        });
        if (!response.ok) {
            logBgWarnError(
                BgLogTag.CONFIG_AUTH,
                `HEFF: HTTP ${response.status} on GET ${url} — auth-token exchange failed; ` +
                `do NOT retry. Loop halted. Awaiting user instruction.`,
            );
            return null;
        }

        const payload = await response.json() as unknown;
        return extractJwtFromAuthTokenPayload(payload);
    } catch (exchangeError) {
        logBgWarnError(BgLogTag.CONFIG_AUTH, "Auth-token exchange failed", exchangeError instanceof Error ? exchangeError : undefined);
        return null;
    }
}

function extractJwtFromAuthTokenPayload(payload: unknown, depth = 0): string | null {
    if (depth > 4 || payload === null || payload === undefined) return null;
    if (typeof payload === "string") return isLikelyJwt(payload) ? payload : null;
    if (typeof payload !== "object") return null;

    const obj = payload as Record<string, unknown>;
    const directCandidates = [obj.token, obj.authToken, obj.access_token, obj.jwt, obj.sessionId];
    for (const candidate of directCandidates) {
        const token = extractJwtFromAuthTokenPayload(candidate, depth + 1);
        if (token !== null) return token;
    }

    const wrappers = [obj.payload, obj.result, obj.data, obj.response];
    for (const wrapper of wrappers) {
        const token = extractJwtFromAuthTokenPayload(wrapper, depth + 1);
        if (token !== null) return token;
    }

    return null;
}

/** Extracts project ID from a URL string. */
function extractProjectIdFromUrl(url: string): string | null {
    // Pattern 1: /projects/{id} (editor URL)
    const pathMatch = url.match(/\/projects\/([^/?#]+)/);
    if (pathMatch) return pathMatch[1];

    try {
        const hostname = new URL(url).hostname;
        const firstLabel = hostname.split(".")[0] ?? "";

        // Pattern 2: id-preview--{uuid}.{domain}
        const idPreviewLabelMatch = firstLabel.match(/^id-preview--([a-f0-9-]{36})$/i);
        if (idPreviewLabelMatch) return idPreviewLabelMatch[1];

        // Pattern 3: {uuid}--preview.{domain} or {uuid}-preview.{domain}
        const previewSuffixLabelMatch = firstLabel.match(/^([a-f0-9-]{36})(?:--preview|-preview)$/i);
        if (previewSuffixLabelMatch) return previewSuffixLabelMatch[1];

        // Pattern 4: bare UUID subdomain: {uuid}.lovableproject.com
        const bareUuidLabelMatch = firstLabel.match(/^([a-f0-9-]{36})$/i);
        if (bareUuidLabelMatch) return bareUuidLabelMatch[1];
    } catch (urlErr) {
        // Fall through to legacy string regex checks below. Debug only — this
        // catch fires for any non-URL input passed to extractProjectId.
        console.debug("[config-auth] extractProjectId URL parse failed, using legacy regex fallback:", urlErr);
    }

    // Legacy fallback regexes (defensive)
    const subdomainMatch = url.match(/id-preview--([a-f0-9-]{36})\./i);
    if (subdomainMatch) return subdomainMatch[1];

    const altSubdomainMatch = url.match(/([a-f0-9-]{36})(?:--preview|-preview)\./i);
    if (altSubdomainMatch) return altSubdomainMatch[1];

    const bareUuidSubdomainMatch = url.match(/https?:\/\/([a-f0-9-]{36})\.[^/]+/i);
    if (bareUuidSubdomainMatch) return bareUuidSubdomainMatch[1];

    return null;
}

/* ------------------------------------------------------------------ */
/*  Cookie Reader                                                      */
/* ------------------------------------------------------------------ */

async function readCookieValueByNameCandidates(
    cookieNames: readonly string[],
    primaryUrl: string,
): Promise<CookieLookupResult> {
    for (const cookieName of cookieNames) {
        let value: string | null = null;

        try {
            value = await readCookieValueFromCandidates(cookieName, primaryUrl);
        } catch (cookieError) {
            const errorMessage = cookieError instanceof Error
                ? cookieError.message
                : String(cookieError);
            logCaughtError(BgLogTag.CONFIG_AUTH, `Cookie read failed (${cookieName})`, cookieError);
        }

        if (value !== null) {
            return { value, cookieName };
        }
    }

    return { value: null, cookieName: null };
}

async function discoverAuthCookieNames(primaryUrl: string): Promise<CookieDiscoverySummary> {
    const checkedUrls = buildCookieUrlCandidates(primaryUrl);
    const authLikeCookieNames = new Set<string>();
    const canListCookies = typeof chrome.cookies?.getAll === "function";

    if (!canListCookies) {
        return { checkedUrls, authLikeCookieNames: [] };
    }

    for (const url of checkedUrls) {
        try {
            const cookies = await chrome.cookies.getAll({ url });

            for (const cookie of cookies) {
                const isAuthLike = AUTH_COOKIE_NAME_PATTERN.test(cookie.name);

                if (isAuthLike) {
                    authLikeCookieNames.add(cookie.name);
                }
            }
        } catch (cookieErr) {
            // Ignore candidate URL errors and keep scanning. Debug because we
            // intentionally probe many candidate URLs and most will not match.
            console.debug("[config-auth] cookie candidate URL scan errored, continuing:", cookieErr);
        }
    }

    return {
        checkedUrls,
        authLikeCookieNames: [...authLikeCookieNames],
    };
}

function buildMissingCookieMessage(
    summary: CookieDiscoverySummary,
    expectedSessionNamesInput: readonly string[],
    expectedRefreshNamesInput: readonly string[],
): string {
    const expectedSessionNames = expectedSessionNamesInput.join(", ");
    const expectedRefreshNames = expectedRefreshNamesInput.join(", ");
    const foundNames = summary.authLikeCookieNames.length > 0
        ? summary.authLikeCookieNames.join(", ")
        : "none";

    return [
        "Session cookie not found via chrome.cookies.get.",
        `Expected session names: [${expectedSessionNames}].`,
        `Expected refresh names: [${expectedRefreshNames}].`,
        `Checked URLs: [${summary.checkedUrls.join(", ")}].`,
        `Found auth-like cookie names: [${foundNames}].`,
    ].join(" ");
}

/* ------------------------------------------------------------------ */
/*  Error Logging                                                      */
/* ------------------------------------------------------------------ */

/** Logs a refresh failure. */
function logRefreshError(error: unknown): void {
    logCaughtError(BgLogTag.CONFIG_AUTH, "Token refresh failed", error);
}
