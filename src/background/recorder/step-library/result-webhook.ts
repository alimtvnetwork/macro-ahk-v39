/**
 * Marco Extension — Result Webhook
 *
 * Single-attempt HTTP POST delivery of recorder/runner results to a
 * user-configurable endpoint. Backed by `localStorage` only.
 *
 * Policy invariants (memory):
 *   - mem://constraints/webhook-fail-fast  — single fetch, no retry, no
 *     backoff, no scheduled redelivery.
 *   - mem://features/webhook-result-schema-version — every persisted result
 *     carries `SchemaVersion`. Legacy v1 blobs (no field) are upgraded on
 *     read by `migrateWebhookDeliveryResult`. Unknown future versions are
 *     replaced by a corrupt-placeholder failure.
 *   - mem://constraints/no-supabase — no remote storage, no Supabase SDK.
 */

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const WEBHOOK_RESULT_SCHEMA_VERSION = 2 as const;

const CONFIG_STORAGE_KEY = "marco.webhook.config.v1";
const LOG_STORAGE_KEY = "marco.webhook.log.v1";
const LOG_MAX_ENTRIES = 20;
const DEFAULT_TIMEOUT_MS = 8000;

const CORRUPT_PLACEHOLDER_PREFIX = "Corrupt webhook log entry";

export const ALL_WEBHOOK_EVENTS = [
    "GroupRunSucceeded",
    "GroupRunFailed",
    "BatchComplete",
    "RecordingStopped",
] as const;

export type WebhookEventKind = typeof ALL_WEBHOOK_EVENTS[number];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface WebhookHeader {
    readonly Name: string;
    readonly Value: string;
}

export interface WebhookConfig {
    readonly Enabled: boolean;
    readonly Url: string;
    readonly TimeoutMs: number;
    readonly Headers: ReadonlyArray<WebhookHeader>;
    readonly Events: ReadonlyArray<WebhookEventKind>;
    readonly SecretToken: string;
}

export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
    Enabled: false,
    Url: "",
    TimeoutMs: DEFAULT_TIMEOUT_MS,
    Headers: [],
    Events: [...ALL_WEBHOOK_EVENTS],
    SecretToken: "",
};

export type WebhookPayload = Record<string, unknown>;

export interface WebhookDeliverySuccess {
    readonly SchemaVersion: typeof WEBHOOK_RESULT_SCHEMA_VERSION;
    readonly Kind: "success";
    readonly Ok: true;
    readonly Skipped: false;
    readonly Event: WebhookEventKind;
    readonly Url: string;
    readonly Status: number;
    readonly DurationMs: number;
    readonly EmittedAt: string;
    readonly Payload: WebhookPayload | null;
}

export interface WebhookDeliverySkipped {
    readonly SchemaVersion: typeof WEBHOOK_RESULT_SCHEMA_VERSION;
    readonly Kind: "skipped";
    readonly Ok: true;
    readonly Skipped: true;
    readonly Event: WebhookEventKind;
    readonly Url: string | null;
    readonly SkipReason: string;
    readonly DurationMs: number;
    readonly EmittedAt: string;
    readonly Payload: WebhookPayload | null;
}

export interface WebhookDeliveryFailure {
    readonly SchemaVersion: typeof WEBHOOK_RESULT_SCHEMA_VERSION;
    readonly Kind: "failure";
    readonly Ok: false;
    readonly Skipped: false;
    readonly Event: WebhookEventKind;
    readonly Url: string;
    readonly Status: number | null;
    readonly Error: string;
    readonly DurationMs: number;
    readonly EmittedAt: string;
    readonly Payload: WebhookPayload | null;
}

export type WebhookDeliveryResult =
    | WebhookDeliverySuccess
    | WebhookDeliverySkipped
    | WebhookDeliveryFailure;

/* ------------------------------------------------------------------ */
/*  Type guards                                                        */
/* ------------------------------------------------------------------ */

export function isWebhookSuccess(r: WebhookDeliveryResult): r is WebhookDeliverySuccess {
    return r.Kind === "success";
}
export function isWebhookSkipped(r: WebhookDeliveryResult): r is WebhookDeliverySkipped {
    return r.Kind === "skipped";
}
export function isWebhookFailure(r: WebhookDeliveryResult): r is WebhookDeliveryFailure {
    return r.Kind === "failure";
}

/* ------------------------------------------------------------------ */
/*  Storage helpers                                                    */
/* ------------------------------------------------------------------ */

function safeLocalStorage(): Storage | null {
    try {
        if (typeof localStorage === "undefined") return null;
        return localStorage;
    } catch {
        return null;
    }
}

function nowIso(): string {
    return new Date().toISOString();
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback: string): string {
    return typeof v === "string" ? v : fallback;
}
function asNumber(v: unknown, fallback: number): number {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asBool(v: unknown, fallback: boolean): boolean {
    return typeof v === "boolean" ? v : fallback;
}
function asEvent(v: unknown): WebhookEventKind {
    if (typeof v === "string" && (ALL_WEBHOOK_EVENTS as ReadonlyArray<string>).includes(v)) {
        return v as WebhookEventKind;
    }
    return "GroupRunSucceeded";
}

/* ------------------------------------------------------------------ */
/*  Config load/save                                                   */
/* ------------------------------------------------------------------ */

export function loadWebhookConfig(): WebhookConfig {
    const ls = safeLocalStorage();
    if (!ls) return { ...DEFAULT_WEBHOOK_CONFIG };
    try {
        const raw = ls.getItem(CONFIG_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_WEBHOOK_CONFIG };
        const parsed: unknown = JSON.parse(raw);
        if (!isPlainRecord(parsed)) return { ...DEFAULT_WEBHOOK_CONFIG };
        const headers: WebhookHeader[] = Array.isArray(parsed.Headers)
            ? parsed.Headers
                  .filter(isPlainRecord)
                  .map((h) => ({
                      Name: asString(h.Name, ""),
                      Value: asString(h.Value, ""),
                  }))
            : [];
        const events: WebhookEventKind[] = Array.isArray(parsed.Events)
            ? parsed.Events
                  .filter((e): e is string => typeof e === "string")
                  .filter((e): e is WebhookEventKind => (ALL_WEBHOOK_EVENTS as ReadonlyArray<string>).includes(e))
            : [...ALL_WEBHOOK_EVENTS];
        return {
            Enabled: asBool(parsed.Enabled, false),
            Url: asString(parsed.Url, ""),
            TimeoutMs: asNumber(parsed.TimeoutMs, DEFAULT_TIMEOUT_MS),
            Headers: headers,
            Events: events,
            SecretToken: asString(parsed.SecretToken, ""),
        };
    } catch {
        return { ...DEFAULT_WEBHOOK_CONFIG };
    }
}

export function saveWebhookConfig(cfg: WebhookConfig): WebhookConfig {
    const ls = safeLocalStorage();
    const normalized: WebhookConfig = {
        Enabled: !!cfg.Enabled,
        Url: typeof cfg.Url === "string" ? cfg.Url : "",
        TimeoutMs: Number.isFinite(cfg.TimeoutMs) && cfg.TimeoutMs > 0 ? cfg.TimeoutMs : DEFAULT_TIMEOUT_MS,
        Headers: (cfg.Headers ?? []).map((h) => ({ Name: h.Name ?? "", Value: h.Value ?? "" })),
        Events: (cfg.Events ?? []).filter((k) => (ALL_WEBHOOK_EVENTS as ReadonlyArray<string>).includes(k)),
        SecretToken: typeof cfg.SecretToken === "string" ? cfg.SecretToken : "",
    };
    if (ls) {
        try { ls.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalized)); } catch { /* quota or storage unavailable */ } // allow-swallow: localStorage quota / unavailable — config in-memory is authoritative this session
    }
    return normalized;
}

/* ------------------------------------------------------------------ */
/*  Migration + corrupt placeholder                                    */
/* ------------------------------------------------------------------ */

function buildCorruptPlaceholder(reason: string): WebhookDeliveryFailure {
    return {
        SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
        Kind: "failure",
        Ok: false,
        Skipped: false,
        Event: "GroupRunFailed",
        Url: "",
        Status: null,
        Error: `${CORRUPT_PLACEHOLDER_PREFIX}: ${reason}`,
        DurationMs: 0,
        EmittedAt: nowIso(),
        Payload: null,
    };
}

export function migrateWebhookDeliveryResult(input: unknown): WebhookDeliveryResult {
    if (!isPlainRecord(input)) {
        return buildCorruptPlaceholder("entry is not an object");
    }

    // Version handling
    const versionField = input.SchemaVersion;
    const hasVersion = typeof versionField === "number";
    if (hasVersion && versionField !== WEBHOOK_RESULT_SCHEMA_VERSION) {
        return buildCorruptPlaceholder(`unknown SchemaVersion ${String(versionField)}`);
    }
    // No version field => v1 legacy blob; upgrade in place.

    const kind = input.Kind;
    const event = asEvent(input.Event);
    const durationMs = asNumber(input.DurationMs, 0);
    const emittedAt = asString(input.EmittedAt, nowIso());
    const payload: WebhookPayload | null = isPlainRecord(input.Payload)
        ? (input.Payload as WebhookPayload)
        : null;

    if (kind === "success") {
        return {
            SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
            Kind: "success",
            Ok: true,
            Skipped: false,
            Event: event,
            Url: asString(input.Url, ""),
            Status: asNumber(input.Status, 0),
            DurationMs: durationMs,
            EmittedAt: emittedAt,
            Payload: payload,
        };
    }
    if (kind === "skipped") {
        const url = typeof input.Url === "string" ? input.Url : null;
        return {
            SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
            Kind: "skipped",
            Ok: true,
            Skipped: true,
            Event: event,
            Url: url,
            SkipReason: asString(input.SkipReason, "Skipped"),
            DurationMs: durationMs,
            EmittedAt: emittedAt,
            Payload: payload,
        };
    }
    if (kind === "failure") {
        const status = typeof input.Status === "number" ? input.Status : null;
        return {
            SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
            Kind: "failure",
            Ok: false,
            Skipped: false,
            Event: event,
            Url: asString(input.Url, ""),
            Status: status,
            Error: asString(input.Error, "Unknown error"),
            DurationMs: durationMs,
            EmittedAt: emittedAt,
            Payload: payload,
        };
    }
    return buildCorruptPlaceholder(`unknown Kind ${String(kind)}`);
}

/* ------------------------------------------------------------------ */
/*  Delivery log                                                       */
/* ------------------------------------------------------------------ */

function readLogRaw(): unknown[] {
    const ls = safeLocalStorage();
    if (!ls) return [];
    try {
        const raw = ls.getItem(LOG_STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeLog(entries: ReadonlyArray<WebhookDeliveryResult>): void {
    const ls = safeLocalStorage();
    if (!ls) return;
    try {
        ls.setItem(LOG_STORAGE_KEY, JSON.stringify(entries.slice(0, LOG_MAX_ENTRIES)));
    } catch { /* quota or storage unavailable */ } // allow-swallow: delivery-log write is best-effort; loss of one log entry must not break the run
}

export function getDeliveryLog(): ReadonlyArray<WebhookDeliveryResult> {
    return readLogRaw().map(migrateWebhookDeliveryResult);
}

export function clearDeliveryLog(): void {
    const ls = safeLocalStorage();
    if (!ls) return;
    try { ls.removeItem(LOG_STORAGE_KEY); } catch { /* ignore */ } // allow-swallow: clearing the delivery log is best-effort cleanup
}

export interface RepairReport {
    readonly Removed: number;
    readonly Kept: number;
    readonly Errors: ReadonlyArray<string>;
}

export function repairDeliveryLog(): RepairReport {
    const raw = readLogRaw();
    const errors: string[] = [];
    const kept: WebhookDeliveryResult[] = [];
    let removed = 0;
    for (const entry of raw) {
        const migrated = migrateWebhookDeliveryResult(entry);
        if (isWebhookFailure(migrated) && migrated.Error.startsWith(CORRUPT_PLACEHOLDER_PREFIX)) {
            removed += 1;
            errors.push(migrated.Error);
        } else {
            kept.push(migrated);
        }
    }
    writeLog(kept);
    return { Removed: removed, Kept: kept.length, Errors: errors };
}

function appendLog(entry: WebhookDeliveryResult): void {
    const current = getDeliveryLog();
    writeLog([entry, ...current]);
}

/* ------------------------------------------------------------------ */
/*  Payload builders                                                   */
/* ------------------------------------------------------------------ */

export interface GroupRunPayloadInput {
    readonly ProjectId: number | null;
    readonly GroupId: number;
    readonly GroupName: string;
    readonly DurationMs: number;
    readonly StepsExecuted: number;
    readonly Outcome: string;
    readonly FailureReason?: string;
    readonly FailedStepId?: number;
    readonly IsTest?: boolean;
}

export function buildGroupRunPayload(input: GroupRunPayloadInput): WebhookPayload {
    const out: WebhookPayload = {
        ProjectId: input.ProjectId,
        GroupId: input.GroupId,
        GroupName: input.GroupName,
        DurationMs: input.DurationMs,
        StepsExecuted: input.StepsExecuted,
        Outcome: input.Outcome,
        EmittedAt: nowIso(),
    };
    if (input.FailureReason !== undefined) out.FailureReason = input.FailureReason;
    if (input.FailedStepId !== undefined) out.FailedStepId = input.FailedStepId;
    if (input.IsTest) out.IsTest = true;
    return out;
}

export interface BatchCompletePayloadInput {
    readonly ProjectId: number | null;
    readonly TotalGroups: number;
    readonly Succeeded: number;
    readonly Failed: number;
    readonly Skipped: number;
    readonly DurationMs: number;
    readonly Ok: boolean;
}

export function buildBatchCompletePayload(input: BatchCompletePayloadInput): WebhookPayload {
    return {
        ProjectId: input.ProjectId,
        TotalGroups: input.TotalGroups,
        Succeeded: input.Succeeded,
        Failed: input.Failed,
        Skipped: input.Skipped,
        DurationMs: input.DurationMs,
        Ok: input.Ok,
        EmittedAt: nowIso(),
    };
}

/* ------------------------------------------------------------------ */
/*  Variable substitution                                              */
/* ------------------------------------------------------------------ */

function substitute(template: string, payload: WebhookPayload, event: WebhookEventKind): string {
    if (!template.includes("{{")) return template;
    const lookup: Record<string, unknown> = {
        ...payload,
        Event: event,
        Outcome: payload.Outcome ?? event,
    };
    return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, key: string) => {
        const v = lookup[key];
        if (v === undefined || v === null) return "";
        return typeof v === "string" ? v : String(v);
    });
}

/* ------------------------------------------------------------------ */
/*  Dispatch                                                           */
/* ------------------------------------------------------------------ */

export interface DispatchOptions {
    readonly config?: WebhookConfig;
}

/**
 * Single-attempt webhook delivery. Fire-and-forget by contract:
 * no retries, no backoff, no scheduled redelivery.
 */
export async function dispatchWebhook(
    event: WebhookEventKind,
    payload: WebhookPayload,
    options: DispatchOptions = {},
): Promise<WebhookDeliveryResult> {
    const cfg = options.config ?? loadWebhookConfig();
    const startedAt = Date.now();
    const emittedAt = nowIso();

    function record<T extends WebhookDeliveryResult>(entry: T): T {
        appendLog(entry);
        return entry;
    }

    if (!cfg.Enabled) {
        return record<WebhookDeliverySkipped>({
            SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
            Kind: "skipped",
            Ok: true,
            Skipped: true,
            Event: event,
            Url: cfg.Url || null,
            SkipReason: "Webhook disabled",
            DurationMs: 0,
            EmittedAt: emittedAt,
            Payload: payload,
        });
    }
    if (!cfg.Url || cfg.Url.trim().length === 0) {
        return record<WebhookDeliverySkipped>({
            SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
            Kind: "skipped",
            Ok: true,
            Skipped: true,
            Event: event,
            Url: null,
            SkipReason: "URL empty",
            DurationMs: 0,
            EmittedAt: emittedAt,
            Payload: payload,
        });
    }
    if (cfg.Events.length > 0 && !cfg.Events.includes(event)) {
        return record<WebhookDeliverySkipped>({
            SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
            Kind: "skipped",
            Ok: true,
            Skipped: true,
            Event: event,
            Url: cfg.Url,
            SkipReason: `Event ${event} not subscribed`,
            DurationMs: 0,
            EmittedAt: emittedAt,
            Payload: payload,
        });
    }

    const finalUrl = substitute(cfg.Url, payload, event);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    for (const h of cfg.Headers) {
        const name = (h.Name ?? "").trim();
        if (!name) continue;
        headers[name] = substitute(h.Value ?? "", payload, event);
    }
    if (cfg.SecretToken && cfg.SecretToken.trim().length > 0) {
        headers["X-Marco-Token"] = cfg.SecretToken;
    }

    const body = JSON.stringify({ Event: event, Payload: payload, EmittedAt: emittedAt });

    const controller = new AbortController();
    const timeoutMs = cfg.TimeoutMs > 0 ? cfg.TimeoutMs : DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(finalUrl, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
        });
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        if (res.ok) {
            return record<WebhookDeliverySuccess>({
                SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
                Kind: "success",
                Ok: true,
                Skipped: false,
                Event: event,
                Url: finalUrl,
                Status: res.status,
                DurationMs: durationMs,
                EmittedAt: emittedAt,
                Payload: payload,
            });
        }
        return record<WebhookDeliveryFailure>({
            SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
            Kind: "failure",
            Ok: false,
            Skipped: false,
            Event: event,
            Url: finalUrl,
            Status: res.status,
            Error: `HTTP ${res.status} ${res.statusText || ""}`.trim(),
            DurationMs: durationMs,
            EmittedAt: emittedAt,
            Payload: payload,
        });
    } catch (err) {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        const aborted = err instanceof DOMException && err.name === "AbortError";
        const message = aborted
            ? `Timeout after ${timeoutMs}ms`
            : err instanceof Error
                ? err.message
                : String(err);
        return record<WebhookDeliveryFailure>({
            SchemaVersion: WEBHOOK_RESULT_SCHEMA_VERSION,
            Kind: "failure",
            Ok: false,
            Skipped: false,
            Event: event,
            Url: finalUrl,
            Status: null,
            Error: message,
            DurationMs: durationMs,
            EmittedAt: emittedAt,
            Payload: payload,
        });
    }
}
