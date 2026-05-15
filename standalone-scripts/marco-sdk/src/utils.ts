/**
 * Riseup Macro SDK — Shared Utilities
 *
 * Reusable async, DOM, and formatting utilities available to all
 * injected scripts via `marco.utils`. These are stable, rarely-changing
 * functions extracted from macro-controller to reduce its bundle size
 * and enable independent caching.
 *
 * @see spec/02-coding-guidelines/02-typescript-immutability-standards.md — Rule CQ18
 * @see spec/21-app/02-features/devtools-and-injection/sdk-convention.md — SDK convention
 */

import { NamespaceLogger } from "./logger";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RetryOptions {
    readonly maxAttempts: number;
    readonly delayMs: number;
    readonly backoffMultiplier?: number;
    readonly onRetry?: (attempt: number, error: unknown) => void;
}

export interface ConcurrencyLockResult<T> {
    readonly value: T;
    readonly wasQueued: boolean;
}

export interface ConcurrencyLock<T> {
    run(fn: () => Promise<T>, timeoutMs?: number, fallback?: T): Promise<ConcurrencyLockResult<T>>;
    readonly isInFlight: boolean;
}

export interface PollUntilOptions {
    /** Polling interval in ms (default: 200) */
    readonly intervalMs?: number;
    /** Maximum time to wait in ms (default: 5000) */
    readonly timeoutMs?: number;
    /** Called when polling times out */
    readonly onTimeout?: () => void;
    /** Called on each successful poll with elapsed time */
    readonly onFound?: (elapsedMs: number) => void;
}

export interface WaitForElementOptions {
    /** CSS selector or XPath expression */
    readonly selector: string;
    /** Use XPath instead of querySelector (default: false) */
    readonly useXPath?: boolean;
    /** Timeout in ms (default: 10000) */
    readonly timeoutMs?: number;
    /** Polling interval in ms (default: 200) */
    readonly intervalMs?: number;
    /** Parent element to search within (default: document) */
    readonly parent?: Element | Document;
}

export interface UtilsApi {
    /** Wrap a promise with a timeout deadline */
    withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T>;
    /** Retry an async function with configurable backoff */
    withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
    /** Create a single-flight concurrency lock */
    createConcurrencyLock<T>(): ConcurrencyLock<T>;
    /** Simple promise-based delay */
    delay(ms: number): Promise<void>;
    /** Poll a condition until truthy or timeout */
    pollUntil<T>(condition: () => T | null | undefined | false, options?: PollUntilOptions): Promise<T | null>;
    /** Wait for a DOM element to appear */
    waitForElement(options: WaitForElementOptions): Promise<Element | null>;
    /** Debounce a function call */
    debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void;
    /** Throttle a function call */
    throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void;
    /** Safe JSON parse with fallback */
    safeJsonParse<T>(json: string, fallback: T): T;
    /** Format a duration in ms to human-readable string */
    formatDuration(ms: number): string;
    /** Generate a short unique ID */
    uid(prefix?: string): string;
    /** Deep-clone a plain object/array */
    deepClone<T>(value: T): T;
    /** Check if a value is a non-null object */
    isObject(value: unknown): value is Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  withTimeout                                                        */
/* ------------------------------------------------------------------ */

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return new Promise<T>(function (resolve) {
        let isSettled = false;

        const timer = setTimeout(function () {
            if (isSettled) { return; }
            isSettled = true;
            resolve(fallback);
        }, ms);

        promise.then(function (value) {
            if (isSettled) { return; }
            isSettled = true;
            clearTimeout(timer);
            resolve(value);
        });
    });
}

/* ------------------------------------------------------------------ */
/*  withRetry                                                          */
/* ------------------------------------------------------------------ */

async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
    let currentDelay = options.delayMs;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error: unknown) {
            NamespaceLogger.error('parseJson', 'JSON parse failed', error);
            if (attempt === options.maxAttempts) { throw error; }
            if (options.onRetry) { options.onRetry(attempt, error); }
            await delay(currentDelay);
            if (options.backoffMultiplier !== undefined) {
                currentDelay = currentDelay * options.backoffMultiplier;
            }
        }
    }

    throw new Error("withRetry: exhausted all attempts");
}

/* ------------------------------------------------------------------ */
/*  ConcurrencyLock                                                    */
/* ------------------------------------------------------------------ */

function createConcurrencyLock<T>(): ConcurrencyLock<T> {
    let inFlight: Promise<T> | null = null;
    const waiters: Array<{
        resolve: (result: ConcurrencyLockResult<T>) => void;
        timer: ReturnType<typeof setTimeout> | null;
    }> = [];

    function resolveAllWaiters(value: T): void {
        const pending = waiters.splice(0);
        for (const waiter of pending) {
            if (waiter.timer !== null) { clearTimeout(waiter.timer); }
            waiter.resolve({ value, wasQueued: true });
        }
    }

    return {
        get isInFlight(): boolean { return inFlight !== null; },

        run(fn: () => Promise<T>, timeoutMs?: number, fallback?: T): Promise<ConcurrencyLockResult<T>> {
            if (inFlight !== null) {
                return new Promise<ConcurrencyLockResult<T>>(function (resolve) {
                    const entry: typeof waiters[0] = { resolve, timer: null };
                    if (timeoutMs !== undefined && fallback !== undefined) {
                        entry.timer = setTimeout(function () {
                            const idx = waiters.indexOf(entry);
                            if (idx !== -1) { waiters.splice(idx, 1); }
                            resolve({ value: fallback!, wasQueued: true });
                        }, timeoutMs);
                    }
                    waiters.push(entry);
                });
            }

            inFlight = fn();
            return inFlight.then(function (value) {
                inFlight = null;
                resolveAllWaiters(value);
                return { value, wasQueued: false };
            });
        },
    };
}

/* ------------------------------------------------------------------ */
/*  delay                                                              */
/* ------------------------------------------------------------------ */

function delay(ms: number): Promise<void> {
    return new Promise<void>(function (resolve) { setTimeout(resolve, ms); });
}

/* ------------------------------------------------------------------ */
/*  pollUntil                                                          */
/* ------------------------------------------------------------------ */

// L-4 (audit 2026-05-15): Track every active poll so a forgotten interval
// is observable via marco._diag.activePolls() and so we have a single
// audit point if a leak ever recurs.
interface ActivePollEntry {
    handle: ReturnType<typeof setInterval>;
    label: string;
    startedAt: number;
}
const _activePolls = new Set<ActivePollEntry>();

export function _diagActivePolls(): Array<{ label: string; ageMs: number }> {
    const now = Date.now();
    const out: Array<{ label: string; ageMs: number }> = [];
    for (const entry of _activePolls) {
        out.push({ label: entry.label, ageMs: now - entry.startedAt });
    }
    return out;
}

function pollUntil<T>(
    condition: () => T | null | undefined | false,
    options: PollUntilOptions = {},
): Promise<T | null> {
    const intervalMs = options.intervalMs ?? 200;
    const timeoutMs = options.timeoutMs ?? 5000;

    return new Promise<T | null>(function (resolve) {
        const startedAt = Date.now();
        const immediate = condition();

        if (immediate) {
            if (options.onFound) { options.onFound(0); }
            resolve(immediate);
            return;
        }

        const entry: ActivePollEntry = {
            handle: 0 as unknown as ReturnType<typeof setInterval>,
            label: 'pollUntil(timeoutMs=' + timeoutMs + ',intervalMs=' + intervalMs + ')',
            startedAt,
        };

        function stop(): void {
            clearInterval(entry.handle);
            _activePolls.delete(entry);
        }

        entry.handle = setInterval(function () {
            const elapsed = Date.now() - startedAt;
            const result = condition();

            if (result) {
                stop();
                if (options.onFound) { options.onFound(elapsed); }
                resolve(result);
                return;
            }

            if (elapsed >= timeoutMs) {
                stop();
                if (options.onTimeout) { options.onTimeout(); }
                resolve(null);
            }
        }, intervalMs);
        _activePolls.add(entry);
    });
}

/* ------------------------------------------------------------------ */
/*  waitForElement                                                     */
/* ------------------------------------------------------------------ */

function waitForElement(options: WaitForElementOptions): Promise<Element | null> {
    const { selector, useXPath = false, timeoutMs = 10000, intervalMs = 200, parent } = options;
    const root = parent || document;

    return pollUntil(function () {
        if (useXPath) {
            const result = document.evaluate(
                selector, root, null,
                XPathResult.FIRST_ORDERED_NODE_TYPE, null,
            );
            return result.singleNodeValue as Element | null;
        }
        return root.querySelector(selector);
    }, { intervalMs, timeoutMs });
}

/* ------------------------------------------------------------------ */
/*  debounce                                                           */
/* ------------------------------------------------------------------ */

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return function (...args: A) {
        if (timer !== null) { clearTimeout(timer); }
        timer = setTimeout(function () { timer = null; fn(...args); }, ms);
    };
}

/* ------------------------------------------------------------------ */
/*  throttle                                                           */
/* ------------------------------------------------------------------ */

function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return function (...args: A) {
        const now = Date.now();
        const remaining = ms - (now - last);
        if (remaining <= 0) {
            if (timer !== null) { clearTimeout(timer); timer = null; }
            last = now;
            fn(...args);
        } else if (timer === null) {
            timer = setTimeout(function () {
                last = Date.now();
                timer = null;
                fn(...args);
            }, remaining);
        }
    };
}

/* ------------------------------------------------------------------ */
/*  Formatting & Misc                                                  */
/* ------------------------------------------------------------------ */

function safeJsonParse<T>(json: string, fallback: T): T {
    try {
        return JSON.parse(json) as T;
    } catch {
        return fallback;
    }
}

function formatDuration(ms: number): string {
    if (ms < 1000) { return ms + "ms"; }
    if (ms < 60000) { return (ms / 1000).toFixed(1) + "s"; }
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return mins + "m " + secs + "s";
}

let _uidCounter = 0;
function uid(prefix = "m"): string {
    return prefix + "-" + Date.now().toString(36) + "-" + (++_uidCounter).toString(36);
}

function deepClone<T>(value: T): T {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function createUtilsApi(): UtilsApi {
    return {
        withTimeout,
        withRetry,
        createConcurrencyLock,
        delay,
        pollUntil,
        waitForElement,
        debounce,
        throttle,
        safeJsonParse,
        formatDuration,
        uid,
        deepClone,
        isObject,
    };
}
