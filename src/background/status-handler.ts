/**
 * Marco Extension — Status Handler
 *
 * Builds the aggregated GET_STATUS response for the popup.
 */

import type { StatusResponse } from "../shared/messages";
import { EXTENSION_VERSION } from "../shared/constants";
import { getHealthState } from "./state-manager";
import { getBootStep, getBootPersistenceMode, getBootTimings, getTotalBootMs, getBootErrorMessage, getBootErrorStack, getBootErrorContext, getWasmProbeResult } from "./boot-diagnostics";
import { getConfigFetchStatus } from "./handlers/config-auth-handler";
import { readCookieFromCandidates, type ChromeCookie } from "./cookie-helpers";
import { logCaughtError, BgLogTag} from "./bg-logger";

import { getChromeRef } from "./chrome-ref";
const _chr = getChromeRef();

/** Builds the full status response aggregated from all subsystems. */
export async function buildStatusResponse(): Promise<StatusResponse> {
    const tokenStatus = await resolveTokenStatus();
    const configStatus = await resolveConfigStatus();
    const connectionState = resolveConnectionState();
    const loggingMode = resolveLoggingMode();

    return {
        connection: connectionState,
        token: tokenStatus,
        config: configStatus,
        loggingMode,
        version: EXTENSION_VERSION,
        bootStep: getBootStep(),
        persistenceMode: getBootPersistenceMode(),
        bootTimings: getBootTimings(),
        totalBootMs: getTotalBootMs(),
        bootError: getBootErrorMessage(),
        bootErrorStack: getBootErrorStack(),
        bootErrorContext: getBootErrorContext(),
        wasmProbe: getWasmProbeResult(),
    };
}

/** Resolves the current auth token status from cookies. */
async function resolveTokenStatus(): Promise<StatusResponse["token"]> {
    try {
        const cookie = await readAuthCookie();
        return evaluateCookieStatus(cookie);
    } catch (cookieError) {
        logCookieWarning(cookieError);
        return buildMissingToken();
    }
}

/** Reads the active auth cookie from all candidate URLs. */
async function readAuthCookie(): Promise<ChromeCookie | null> {
    // Try active tab URL as primary candidate for better domain matching
    let primaryUrl: string | null = null;
    try {
        const [tab] = await _chr.tabs.query({ active: true, currentWindow: true });
        primaryUrl = tab?.url ?? null;
    } catch { /* ignore */ } // allow-swallow: tabs.query rejects on restricted pages; primaryUrl is a heuristic, cookie fallback covers the miss.

    const sessionCookie = await readCookieFromCandidates("lovable-session-id.id", primaryUrl);

    if (sessionCookie !== null) {
        return sessionCookie;
    }

    return readCookieFromCandidates("lovable-session-id.refresh", primaryUrl);
}

/** Evaluates token status from a cookie value. */
function evaluateCookieStatus(
    cookie: ChromeCookie | null,
): StatusResponse["token"] {
    const isCookieMissing = cookie === null;

    if (isCookieMissing) {
        return buildMissingToken();
    }

    const isMissingExpiration = cookie.expirationDate === undefined;

    if (isMissingExpiration) {
        return {
            status: "valid",
            expiresIn: null,
        };
    }

    return evaluateExpiration(cookie.expirationDate);
}

/** Evaluates expiration timing for a cookie. */
function evaluateExpiration(
    expirationDate: number,
): StatusResponse["token"] {
    const nowSeconds = Date.now() / 1000;
    const secondsRemaining = expirationDate - nowSeconds;
    const isExpired = secondsRemaining <= 0;

    if (isExpired) {
        return {
            status: "expired",
            expiresIn: null,
        };
    }

    const isExpiringSoon = secondsRemaining < 300;

    if (isExpiringSoon) {
        return {
            status: "expiring",
            expiresIn: `${Math.round(secondsRemaining)}s`,
        };
    }

    return {
        status: "valid",
        expiresIn: `${Math.round(secondsRemaining / 60)}m`,
    };
}

/** Builds a missing token status object. */
function buildMissingToken(): StatusResponse["token"] {
    return {
        status: "missing",
        expiresIn: null,
    };
}

/** Logs a cookie access error. */
function logCookieWarning(error: unknown): void {
    logCaughtError(BgLogTag.STATUS_HANDLER, "Token check failed", error);
}

/** Resolves the current config loading state. */
async function resolveConfigStatus(): Promise<StatusResponse["config"]> {
    try {
        const fetchStatus = getConfigFetchStatus();
        const hasFetchError = fetchStatus.lastFetchError !== null;
        const hasFetched = fetchStatus.lastFetchedAt !== null;

        if (hasFetchError) {
            return { status: "failed", source: "hardcoded" };
        }
        if (hasFetched) {
            return { status: "loaded", source: "remote" };
        }
        return { status: "defaults", source: "hardcoded" };
    } catch {
        return { status: "defaults", source: "hardcoded" };
    }
}

/** Resolves the current network connection state. */
function resolveConnectionState(): StatusResponse["connection"] {
    const healthState = getHealthState();
    const isDegraded = healthState === "DEGRADED";
    const isError = healthState === "ERROR" || healthState === "FATAL";

    if (isError) return "offline";
    if (isDegraded) return "degraded";
    return "online";
}

/** Resolves the active logging mode. */
function resolveLoggingMode(): StatusResponse["loggingMode"] {
    // Inferred from health: if degraded+, assume fallback
    const healthState = getHealthState();
    const isDegraded = healthState !== "HEALTHY";

    return isDegraded ? "fallback" : "sqlite";
}
