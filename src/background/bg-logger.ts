/**
 * Marco Extension — Background Logger
 *
 * Centralized error logging for the background service worker.
 * All caught errors in background modules should flow through this utility
 * so they are persisted to:
 *   1. SQLite errors table (via handleLogError)
 *   2. OPFS session files (events.log + errors.log)
 *   3. Browser console (console.error — LAST step, preserves stack trace)
 *
 * IMPORTANT: Do NOT use this inside the logging pipeline itself
 * (session-log-writer.ts, logging-handler.ts, db-manager.ts) to avoid
 * infinite recursion. Those files must use bare console.error.
 *
 * @see spec/05-chrome-extension/06-logging-architecture.md
 */

import { MessageType, type MessageRequest } from "../shared/messages";
import { handleLogError } from "./handlers/logging-handler";

/* ------------------------------------------------------------------ */
/*  Log Tag Enum                                                       */
/* ------------------------------------------------------------------ */

/** Canonical log tags — eliminates magic strings across all background modules. */
export const enum BgLogTag {
    AUTH_HEALTH = "[auth-health]",
    BOOT = "[boot]",
    BUILTIN_GUARD = "[builtin-guard]",
    BUILTIN_GUARD_FALLBACK = "[builtin-guard:fallback]",
    CACHE_WARMER = "[cache-warmer]",
    CONFIG_AUTH = "[config-auth]",
    CONFIG_SEEDER = "[config-seeder]",
    CONTEXT_MENU = "[context-menu]",
    COOKIE_WATCHER = "[cookie-watcher]",
    CSP_FALLBACK = "[csp-fallback]",
    DATA_BRIDGE = "[data-bridge]",
    DYNAMIC_REQUIRE = "[dynamic-require]",
    HEALTH = "[health]",
    INJECTION = "[injection]",
    INJECTION_BOOTSTRAP = "[injection:bootstrap]",
    INJECTION_CACHE = "[injection-cache]",
    INJECTION_CSP = "[injection:csp]",
    INJECTION_DEPS = "[injection:deps]",
    INJECTION_NS = "[injection:ns]",
    INJECTION_RESOLVE = "[injection:resolve]",
    INJECTION_SETTINGS = "[injection:settings]",
    KEEPALIVE = "[keepalive]",
    LOGGING = "[logging]",
    MANIFEST_SEEDER = "[manifest-seeder]",
    MARCO = "[Marco]",
    MESSAGE_ROUTER = "[message-router]",
    NS_CACHE = "[ns-cache]",
    OPEN_TABS = "[open-tabs]",
    PROJECT_SAVE_CONFIG_SEED = "[project-save:config-seed]",
    PROMPTS = "[prompts]",
    REMOTE_CONFIG = "[remote-config]",
    SCRIPT_RESOLVER = "[script-resolver]",
    SEEDER = "[seeder]",
    SHORTCUT = "[shortcut]",
    SQLITE_BIND = "[sqlite-bind]",
    STATUS_HANDLER = "[status-handler]",
    TOKEN_SEEDER = "[token-seeder]",
    URL_MATCHER = "[url-matcher]",
    WEBHOOK = "[webhook]",
    XPATH = "[xpath]",
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Caught error type — an Error, a string message, or an object with message. */
export type CaughtError = Error | string | { message?: string };

export interface BgErrorContext {
    scriptId?: string;
    projectId?: string;
    configId?: string;
    scriptFile?: string;
    contextDetail?: string;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Logs an error through the full pipeline: DB → session files → console.error.
 *
 * @param tag       Module tag, e.g. "[boot]", "[injection]", "[cookie-watcher]"
 * @param errorCode Machine-readable error code for the errors DB
 * @param message   Human-readable error description
 * @param error     The caught error object (preserved for stack trace in console)
 * @param context   Optional context for the errors DB row
 */
export function logBgError(
    tag: string,
    errorCode: string,
    message: string,
    error?: CaughtError,
    context?: BgErrorContext,
): void {
    const stackTrace = error instanceof Error ? error.stack : undefined;

    // Step 1 + 2: Persist to DB + OPFS session (fire-and-forget, must never throw)
    try {
        void handleLogError({
            type: MessageType.LOG_ERROR,
            level: "ERROR",
            source: "background",
            category: tag.replace(/[[\]]/g, "").toUpperCase(),
            errorCode,
            message,
            stackTrace,
            context: context?.contextDetail,
            scriptId: context?.scriptId,
            projectId: context?.projectId,
            configId: context?.configId,
            scriptFile: context?.scriptFile,
        } as MessageRequest).catch(() => {
            // DB/session not ready — fall through to console.error
        });
    } catch {
        // handleLogError threw synchronously (DB not bound) — fall through
    }

    // Step 3: Console.error LAST — always executes, preserves full stack trace
    if (error !== undefined) {
        console.error(`${tag} ${message}`, error);
    } else {
        console.error(`${tag} ${message}`);
    }
}

/**
 * Shorthand for logging a caught error with a simple message.
 * Derives errorCode from the tag.
 *
 * Usage:
 *   catch (err) { logCaughtError("[boot]", "Manifest seeder failed", err); }
 */
export function logCaughtError(
    tag: string,
    message: string,
    error: CaughtError,
    context?: BgErrorContext,
): void {
    const errorCode = tag
        .replace(/[[\]:]/g, "")
        .replace(/[^a-zA-Z0-9-]/g, "_")
        .toUpperCase() + "_ERROR";

    logBgError(tag, errorCode, message, error, context);
}

/**
 * Logs a warning-level event (non-fatal, degraded functionality).
 * Warnings go to console.warn only and MUST NOT be persisted to the Errors table,
 * otherwise transient/non-fatal issues poison health/error counts.
 */
export function logBgWarnError(
    tag: string,
    message: string,
    error?: CaughtError,
): void {
    if (error !== undefined) {
        console.warn(`${tag} ${message}`, error);
    } else {
        console.warn(`${tag} ${message}`);
    }
}

/**
 * Per-key budget for `logBgWarnSampled`. Resets only on service-worker
 * cold start so noisy "expected fallback" warnings (cache miss, missing
 * chrome.runtime in test contexts, schema-not-ready) surface a handful
 * of times per SW lifetime instead of flooding DevTools / Playwright
 * stdout during long test runs.
 */
const sampledWarnCounters = new Map<string, number>();

/** Default budget for sampled warnings — small enough to keep logs clean. */
const SAMPLED_WARN_BUDGET_DEFAULT = 3;

/**
 * Throttled `console.warn` for expected/recoverable fallbacks.
 *
 * Use instead of `logBgWarnError` whenever a warning sits on a hot path
 * (cache misses, per-tab probes, init-time schema races) where repeating
 * the same warning thousands of times during a test run buries actual
 * signal. The first `budget` (default 3) calls per `key` emit; the final
 * allowed call is suffixed with "(further occurrences suppressed)" so a
 * reader knows the throttle is engaged.
 *
 * Counters live for the SW lifetime, so forensics still get the first
 * few occurrences with full error context.
 *
 * @param tag      BgLogTag identifying the module
 * @param key      Stable per-call-site key (e.g. "cache-miss:<filePath>")
 * @param message  Human-readable description
 * @param error    Optional caught error
 * @param budget   Override the default per-key emission budget
 */
export function logBgWarnSampled(
    tag: string,
    key: string,
    message: string,
    error?: CaughtError,
    budget: number = SAMPLED_WARN_BUDGET_DEFAULT,
): void {
    const fullKey = `${tag}::${key}`;
    const seen = sampledWarnCounters.get(fullKey) ?? 0;
    if (seen >= budget) return;
    sampledWarnCounters.set(fullKey, seen + 1);

    const suffix = seen === budget - 1 ? " (further occurrences suppressed)" : "";
    if (error !== undefined) {
        console.warn(`${tag} ${message}${suffix}`, error);
    } else {
        console.warn(`${tag} ${message}${suffix}`);
    }
}

/** Test-only: clears the sampled-warn counters between unit tests. */
export function _resetSampledWarnCountersForTest(): void {
    sampledWarnCounters.clear();
}

/* ------------------------------------------------------------------ */
/*  Sampled debug emitter (Wave 4 P1 breadcrumbs)                      */
/* ------------------------------------------------------------------ */

/**
 * Per-key counters for `logSampledDebug`. Resets only on service-worker
 * cold start, so each "expected fallback" surfaces at most a handful of
 * times per SW lifetime — enough for forensics, never enough to flood
 * SQLite or the DevTools console.
 */
const sampledCounters = new Map<string, number>();

/** How many emissions per key are allowed during a SW lifetime. */
const SAMPLED_DEBUG_BUDGET = 3;

/**
 * Logs a `console.debug` breadcrumb gated by a per-key budget. Use this for
 * P1 "documented fallback" sites that fire inside tight loops (CSP fallback
 * chain, table-introspection probes, per-tab auth scans). The first
 * `SAMPLED_DEBUG_BUDGET` calls per `key` emit; subsequent calls are dropped
 * silently so high-frequency paths do not spam the log.
 *
 * Breadcrumbs are intentionally console-only — they are diagnostic, not
 * persisted to the Errors table.
 *
 * @param tag      BgLogTag identifying the module
 * @param key      Stable identifier for the call-site (file:line or short slug)
 * @param message  Human-readable description of the fallback
 * @param error    Optional caught error to attach
 */
export function logSampledDebug(
    tag: string,
    key: string,
    message: string,
    error?: CaughtError,
): void {
    const fullKey = `${tag}::${key}`;
    const seen = sampledCounters.get(fullKey) ?? 0;
    if (seen >= SAMPLED_DEBUG_BUDGET) return;
    sampledCounters.set(fullKey, seen + 1);

    const suffix = seen === SAMPLED_DEBUG_BUDGET - 1
        ? " (further occurrences suppressed)"
        : "";
    if (error !== undefined) {
        console.debug(`${tag} ${message}${suffix}`, error);
    } else {
        console.debug(`${tag} ${message}${suffix}`);
    }
}

/** Test-only: clears the sampled-debug counters between unit tests. */
export function _resetSampledDebugCountersForTest(): void {
    sampledCounters.clear();
}

