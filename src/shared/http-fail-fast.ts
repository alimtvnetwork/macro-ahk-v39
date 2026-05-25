/**
 * HTTP Fail-Fast helper (HEFF).
 *
 * Hard rule: on ANY non-2xx response from an agent-driven HTTP call, throw
 * `HttpFailFastError` immediately. Callers MUST NOT retry, fan out, or run
 * heavy follow-up work. See:
 *   - mem://constraints/http-error-fail-fast
 *   - spec/03-error-manage/01-error-resolution/05-http-error-fail-fast.md
 *
 * Usage:
 *   const res = await fetch(url, init);
 *   await httpFailFast(res, { method: "GET", url });   // throws on non-2xx
 *   const body = await res.json();
 *
 * Or directly:
 *   const res = await httpFetchOrThrow(url, init);     // wraps fetch + check
 *   const body = await res.json();
 */

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;
const BODY_SNIPPET_MAX = 500;
const REPORT_HALT_LINE = "Loop halted. Awaiting user instruction.";

/** Window CustomEvent name dispatched whenever an `HttpFailFastError` is constructed in a UI context. */
export const HTTP_FAIL_FAST_EVENT = "marco:http-fail-fast";

/** Detail payload for the `marco:http-fail-fast` window CustomEvent. */
export interface HttpFailFastEventDetail {
    status: number;
    method: string;
    url: string;
    reason: string;
    bodySnippet: string | null;
    report: string;
    at: string;
}

const emitHttpFailFastEvent = (err: { status: number; method: string; url: string; reason: string; bodySnippet: string | null; toReportString: () => string }): void => {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    try {
        const detail: HttpFailFastEventDetail = {
            status: err.status,
            method: err.method,
            url: err.url,
            reason: err.reason,
            bodySnippet: err.bodySnippet,
            report: err.toReportString(),
            at: new Date().toISOString(),
        };
        window.dispatchEvent(new CustomEvent(HTTP_FAIL_FAST_EVENT, { detail }));
    // allow-swallow: event dispatch is best-effort UI surfacing; no listener is a valid state
    } catch { /* intentionally empty */ }
};

export interface HttpCallContext {
    method: string;
    url: string;
}

export interface HttpFailureReport {
    status: number;
    method: string;
    url: string;
    bodySnippet: string | null;
    reason: string;
}

const isOk = (status: number): boolean => status >= HTTP_OK_MIN && status < HTTP_OK_MAX;

const reasonForStatus = (status: number): string => {
    if (status === 401) return "Unauthorized — token missing/expired (do NOT retry; do NOT refresh in a loop).";
    if (status === 403) return "Forbidden — caller lacks permission for this resource.";
    if (status === 404) return "Not Found — endpoint or resource does not exist at this URL.";
    if (status === 405) return "Method Not Allowed — server rejected this HTTP method; do NOT swap methods and retry.";
    if (status === 408) return "Request Timeout — server-side timeout.";
    if (status === 409) return "Conflict — server state disagrees with request.";
    if (status === 410) return "Gone — resource permanently removed.";
    if (status === 429) return "Rate Limited — STOP all calls to this host immediately.";
    if (status >= 500 && status < 600) return `Server Error ${status} — do NOT retry; surface to user.`;
    if (status >= 400 && status < 500) return `Client Error ${status} — bad request shape or auth; do NOT retry.`;
    return `Unexpected HTTP status ${status}.`;
};

const truncateBody = (text: string): string => {
    if (text.length <= BODY_SNIPPET_MAX) return text;
    return text.slice(0, BODY_SNIPPET_MAX) + "…[truncated]";
};

/**
 * Error thrown on any non-2xx HTTP response from an agent-driven call.
 * Carries the full failure report shape per HEFF spec §5.
 */
export class HttpFailFastError extends Error {
    public readonly status: number;
    public readonly method: string;
    public readonly url: string;
    public readonly bodySnippet: string | null;
    public readonly reason: string;

    public constructor(report: HttpFailureReport) {
        super(`HTTP ${report.status} on ${report.method} ${report.url} — ${report.reason}`);
        this.name = "HttpFailFastError";
        this.status = report.status;
        this.method = report.method;
        this.url = report.url;
        this.bodySnippet = report.bodySnippet;
        this.reason = report.reason;
        // Step 7 (HEFF UI): emit a window-level event so any mounted
        // HttpFailFastBanner can surface this failure without each caller
        // wiring its own toast/banner. No-op in SW/Node contexts.
        emitHttpFailFastEvent(this);
    }

    /** Mandatory HEFF report shape (spec §5). */
    public toReportString(): string {
        const body = this.bodySnippet === null ? "null" : this.bodySnippet;
        return [
            `HTTP ${this.status} on ${this.method} ${this.url}`,
            `Body: ${body}`,
            `Reason: ${this.reason}`,
            REPORT_HALT_LINE,
        ].join("\n");
    }

    /** True for network/DNS/refused errors. Always false here. */
    public static isNetworkError(err: unknown): boolean {
        if (err instanceof HttpFailFastError) return false;
        return err instanceof TypeError;
    }
}

/**
 * Asserts a Response is 2xx. Throws `HttpFailFastError` otherwise.
 * The response body is read at most once (as text). If you need JSON, call
 * `.json()` on the SAME response object AFTER this helper returns successfully.
 *
 * Returns the response for fluent chaining.
 */
export const httpFailFast = async (response: Response, ctx: HttpCallContext): Promise<Response> => {
    if (isOk(response.status)) return response;

    let bodySnippet: string | null = null;
    try {
        const text = await response.clone().text();
        bodySnippet = truncateBody(text);
    } catch {
        bodySnippet = null;
    }

    throw new HttpFailFastError({
        status: response.status,
        method: ctx.method,
        url: ctx.url,
        bodySnippet,
        reason: reasonForStatus(response.status),
    });
};

/**
 * Convenience wrapper: fetch + httpFailFast in one call. Use for the common
 * case where you don't need the un-checked Response object.
 */
export const httpFetchOrThrow = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const response = await fetch(url, init);
    return httpFailFast(response, { method, url });
};
