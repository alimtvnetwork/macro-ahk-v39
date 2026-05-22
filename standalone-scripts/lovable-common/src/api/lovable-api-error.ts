/**
 * LovableApiError — narrow, typed error surface for the shared client.
 * Wraps the HTTP status, the resolved endpoint, and the response body.
 *
 * Conforms to the HTTP Fail-Fast contract (HEFF). See:
 *   - mem://constraints/http-error-fail-fast
 *   - spec/03-error-manage/01-error-resolution/05-http-error-fail-fast.md
 *
 * Callers MUST NOT swallow this error, MUST NOT retry, and MUST NOT fan
 * out the failing call across remaining items. Surface the report via
 * `toReportString()` and halt.
 */

const BODY_SNIPPET_MAX = 500;
const REPORT_HALT_LINE = "Loop halted. Awaiting user instruction.";

const reasonForStatus = (status: number): string => {
    if (status === 401) return "Unauthorized — token missing/expired (do NOT retry; do NOT refresh in a loop).";
    if (status === 403) return "Forbidden — caller lacks permission for this resource.";
    if (status === 404) return "Not Found — endpoint or resource does not exist at this URL.";
    if (status === 405) return "Method Not Allowed — server rejected this HTTP method; do NOT swap methods and retry.";
    if (status === 429) return "Rate Limited — STOP all calls to this host immediately.";
    if (status >= 500 && status < 600) return `Server Error ${status} — do NOT retry; surface to user.`;
    if (status >= 400 && status < 500) return `Client Error ${status} — bad request shape or auth; do NOT retry.`;
    return `Unexpected HTTP status ${status}.`;
};

const truncateBody = (text: string): string => {
    if (text.length <= BODY_SNIPPET_MAX) return text;
    return text.slice(0, BODY_SNIPPET_MAX) + "…[truncated]";
};

export class LovableApiError extends Error {
    public readonly Status: number;
    public readonly Endpoint: string;
    public readonly BodyText: string;
    public readonly Method: string;

    public constructor(message: string, status: number, endpoint: string, bodyText: string, method: string = "GET") {
        super(message);
        this.name = "LovableApiError";
        this.Status = status;
        this.Endpoint = endpoint;
        this.BodyText = bodyText;
        this.Method = method;
    }

    /** HEFF report shape (spec §5). */
    public toReportString(): string {
        const body = this.BodyText.length === 0 ? "null" : truncateBody(this.BodyText);
        return [
            `HTTP ${this.Status} on ${this.Method} ${this.Endpoint}`,
            `Body: ${body}`,
            `Reason: ${reasonForStatus(this.Status)}`,
            REPORT_HALT_LINE,
        ].join("\n");
    }
}
