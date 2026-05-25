/**
 * Marco Extension — Message Type Enum & Interfaces
 *
 * Single source of truth for all cross-layer message types.
 *
 * @see spec/05-chrome-extension/18-message-protocol.md — Full message protocol spec
 */

import type { JsonValue } from "../background/handlers/handler-types";
import type { InjectionLaunchSource } from "./injection-types";

export enum MessageType {
    // ─── Config & Auth (from Spec 05) ───
    GET_CONFIG = "GET_CONFIG",
    GET_TOKEN = "GET_TOKEN",
    REFRESH_TOKEN = "REFRESH_TOKEN",

    // ─── Logging (from Spec 06) ───
    LOG_ENTRY = "LOG_ENTRY",
    LOG_ERROR = "LOG_ERROR",
    GET_RECENT_LOGS = "GET_RECENT_LOGS",
    GET_LOG_STATS = "GET_LOG_STATS",
    PURGE_LOGS = "PURGE_LOGS",
    EXPORT_LOGS_JSON = "EXPORT_LOGS_JSON",
    EXPORT_LOGS_ZIP = "EXPORT_LOGS_ZIP",

    // ─── Projects (from Spec 15) ───
    GET_ACTIVE_PROJECT = "GET_ACTIVE_PROJECT",
    SET_ACTIVE_PROJECT = "SET_ACTIVE_PROJECT",
    GET_ALL_PROJECTS = "GET_ALL_PROJECTS",
    SAVE_PROJECT = "SAVE_PROJECT",
    DELETE_PROJECT = "DELETE_PROJECT",
    DUPLICATE_PROJECT = "DUPLICATE_PROJECT",
    IMPORT_PROJECT = "IMPORT_PROJECT",
    EXPORT_PROJECT = "EXPORT_PROJECT",
    GET_AUTO_ATTACH_DECISIONS = "GET_AUTO_ATTACH_DECISIONS",

    // ─── Scripts & Configs (from Spec 13) ───
    GET_ALL_SCRIPTS = "GET_ALL_SCRIPTS",
    SAVE_SCRIPT = "SAVE_SCRIPT",
    DELETE_SCRIPT = "DELETE_SCRIPT",
    TOGGLE_SCRIPT = "TOGGLE_SCRIPT",
    GET_ALL_CONFIGS = "GET_ALL_CONFIGS",
    SAVE_CONFIG = "SAVE_CONFIG",
    DELETE_CONFIG = "DELETE_CONFIG",
    GET_SCRIPT_CONFIG = "GET_SCRIPT_CONFIG",
    GET_OPTIONS_BOOTSTRAP = "GET_OPTIONS_BOOTSTRAP",

    // ─── Injection (from Spec 12) ───
    INJECT_SCRIPTS = "INJECT_SCRIPTS",
    INJECTION_RESULT = "INJECTION_RESULT",
    GET_TAB_INJECTIONS = "GET_TAB_INJECTIONS",
    GET_OPEN_LOVABLE_TABS = "GET_OPEN_LOVABLE_TABS",

    // ─── Health & Recovery (from Spec 09) ───
    GET_STATUS = "GET_STATUS",
    GET_HEALTH_STATUS = "GET_HEALTH_STATUS",
    GET_AUTH_HEALTH = "GET_AUTH_HEALTH",
    GET_TOKEN_SEEDER_DIAGNOSTICS = "GET_TOKEN_SEEDER_DIAGNOSTICS",
    GET_API_STATUS = "GET_API_STATUS",
    GET_API_ENDPOINTS = "GET_API_ENDPOINTS",
    GET_ACTIVE_ERRORS = "GET_ACTIVE_ERRORS",
    CLEAR_ERRORS = "CLEAR_ERRORS",
    LOGGING_DEGRADED = "LOGGING_DEGRADED",
    STORAGE_FULL = "STORAGE_FULL",
    NETWORK_STATUS = "NETWORK_STATUS",
    NETWORK_REQUEST = "NETWORK_REQUEST",
    GET_NETWORK_REQUESTS = "GET_NETWORK_REQUESTS",
    GET_NETWORK_STATS = "GET_NETWORK_STATS",
    CLEAR_NETWORK_REQUESTS = "CLEAR_NETWORK_REQUESTS",

    // ─── Storage & Data Browser (from Spec 10) ───
    GET_STORAGE_STATS = "GET_STORAGE_STATS",
    QUERY_LOGS = "QUERY_LOGS",
    GET_LOG_DETAIL = "GET_LOG_DETAIL",

    // ─── XPath Recorder (from Spec 07) ───
    TOGGLE_XPATH_RECORDER = "TOGGLE_XPATH_RECORDER",
    GET_RECORDED_XPATHS = "GET_RECORDED_XPATHS",
    CLEAR_RECORDED_XPATHS = "CLEAR_RECORDED_XPATHS",
    TEST_XPATH = "TEST_XPATH",
    VALIDATE_ALL_XPATHS = "VALIDATE_ALL_XPATHS",

    // ─── Macro Recorder Data Sources (from Spec 31, Phase 07) ───
    RECORDER_DATA_SOURCE_ADD = "RECORDER_DATA_SOURCE_ADD",
    RECORDER_DATA_SOURCE_LIST = "RECORDER_DATA_SOURCE_LIST",

    // ─── Macro Recorder Field Bindings (from Spec 31, Phase 08) ───
    RECORDER_FIELD_BINDING_UPSERT = "RECORDER_FIELD_BINDING_UPSERT",
    RECORDER_FIELD_BINDING_LIST = "RECORDER_FIELD_BINDING_LIST",
    RECORDER_FIELD_BINDING_DELETE = "RECORDER_FIELD_BINDING_DELETE",

    // ─── Macro Recorder Steps + Replay (from Spec 31, Phase 09 + 10) ───
    RECORDER_CAPTURE_PERSIST = "RECORDER_CAPTURE_PERSIST",
    RECORDER_CAPTURE_PERSIST_BATCH = "RECORDER_CAPTURE_PERSIST_BATCH",
    RECORDER_STEP_INSERT = "RECORDER_STEP_INSERT",
    RECORDER_STEP_LIST = "RECORDER_STEP_LIST",
    RECORDER_STEP_DELETE = "RECORDER_STEP_DELETE",
    RECORDER_STEP_RESOLVE = "RECORDER_STEP_RESOLVE",
    RECORDER_STEP_RENAME = "RECORDER_STEP_RENAME",
    RECORDER_STEP_SELECTORS_LIST = "RECORDER_STEP_SELECTORS_LIST",
    // ─── Macro Recorder Step Chain + Cross-Project Links (Phase 14) ───
    RECORDER_STEP_UPDATE_META = "RECORDER_STEP_UPDATE_META",
    RECORDER_STEP_TAGS_SET = "RECORDER_STEP_TAGS_SET",
    RECORDER_STEP_LINK_SET = "RECORDER_STEP_LINK_SET",

    // ─── Macro Recorder Inline JS + Snippets (from Spec 31, Phase 11) ───
    RECORDER_JS_SNIPPET_UPSERT = "RECORDER_JS_SNIPPET_UPSERT",
    RECORDER_JS_SNIPPET_LIST = "RECORDER_JS_SNIPPET_LIST",
    RECORDER_JS_SNIPPET_DELETE = "RECORDER_JS_SNIPPET_DELETE",
    RECORDER_JS_STEP_DRYRUN = "RECORDER_JS_STEP_DRYRUN",

    // ─── Config Notifications (from Spec 10) ───
    CONFIG_UPDATED = "CONFIG_UPDATED",

    // ─── Auth Broadcasts (from Spec 04) ───
    TOKEN_EXPIRED = "TOKEN_EXPIRED",
    TOKEN_UPDATED = "TOKEN_UPDATED",

    // ─── User Script Errors (from Spec 20) ───
    USER_SCRIPT_ERROR = "USER_SCRIPT_ERROR",

    // ─── User Script Logging & Data Bridge (from Spec 42) ───
    USER_SCRIPT_LOG = "USER_SCRIPT_LOG",
    USER_SCRIPT_DATA_SET = "USER_SCRIPT_DATA_SET",
    USER_SCRIPT_DATA_GET = "USER_SCRIPT_DATA_GET",
    USER_SCRIPT_DATA_DELETE = "USER_SCRIPT_DATA_DELETE",
    USER_SCRIPT_DATA_KEYS = "USER_SCRIPT_DATA_KEYS",
    USER_SCRIPT_DATA_GET_ALL = "USER_SCRIPT_DATA_GET_ALL",
    USER_SCRIPT_DATA_CLEAR = "USER_SCRIPT_DATA_CLEAR",

    // ─── Data Store Browser (Options page) ───
    GET_DATA_STORE_ALL = "GET_DATA_STORE_ALL",

    // ─── Run Statistics (Spec 15 T-7) ───
    RECORD_CYCLE_METRIC = "RECORD_CYCLE_METRIC",
    GET_RUN_STATS = "GET_RUN_STATS",
    CLEAR_RUN_STATS = "CLEAR_RUN_STATS",

    // ─── Prompts CRUD (Spec 15 T-10) ───
    GET_PROMPTS = "GET_PROMPTS",
    SAVE_PROMPT = "SAVE_PROMPT",
    DELETE_PROMPT = "DELETE_PROMPT",
    REORDER_PROMPTS = "REORDER_PROMPTS",
    RESEED_PROMPTS = "RESEED_PROMPTS",

    // ─── Prompt Chains (Spec 15 T-12) ───
    GET_PROMPT_CHAINS = "GET_PROMPT_CHAINS",
    SAVE_PROMPT_CHAIN = "SAVE_PROMPT_CHAIN",
    DELETE_PROMPT_CHAIN = "DELETE_PROMPT_CHAIN",
    EXECUTE_CHAIN_STEP = "EXECUTE_CHAIN_STEP",

    // ─── Extension Settings ───
    GET_SETTINGS = "GET_SETTINGS",
    SAVE_SETTINGS = "SAVE_SETTINGS",

    // ─── Prompt Template Variables ───
    GET_PROMPT_VARIABLES = "GET_PROMPT_VARIABLES",
    SAVE_PROMPT_VARIABLES = "SAVE_PROMPT_VARIABLES",

    // ─── Project Key-Value Store (Issue 50) ───
    KV_GET = "KV_GET",
    KV_SET = "KV_SET",
    KV_DELETE = "KV_DELETE",
    KV_LIST = "KV_LIST",

    // ─── Grouped Key-Value Store (Issue 60) ───
    GKV_GET = "GKV_GET",
    GKV_SET = "GKV_SET",
    GKV_DELETE = "GKV_DELETE",
    GKV_LIST = "GKV_LIST",
    GKV_CLEAR_GROUP = "GKV_CLEAR_GROUP",

    // ─── Project File Storage (Issue 50) ───
    FILE_SAVE = "FILE_SAVE",
    FILE_GET = "FILE_GET",
    FILE_LIST = "FILE_LIST",
    FILE_DELETE = "FILE_DELETE",

    // ─── Diagnostics ───
    GET_RECENT_MESSAGES = "GET_RECENT_MESSAGES",
    GET_SESSION_LOGS = "GET_SESSION_LOGS",
    GET_SESSION_REPORT = "GET_SESSION_REPORT",
    BROWSE_OPFS_SESSIONS = "BROWSE_OPFS_SESSIONS",
    GET_OPFS_STATUS = "GET_OPFS_STATUS",

    // ─── Injection Chain Diagnostics ───
    GET_INJECTION_CHAIN = "GET_INJECTION_CHAIN",

    // ─── Storage Browser (Options page) ───
    STORAGE_LIST_TABLES = "STORAGE_LIST_TABLES",
    STORAGE_QUERY_TABLE = "STORAGE_QUERY_TABLE",
    STORAGE_UPDATE_ROW = "STORAGE_UPDATE_ROW",
    STORAGE_DELETE_ROW = "STORAGE_DELETE_ROW",
    STORAGE_GET_SCHEMA = "STORAGE_GET_SCHEMA",
    STORAGE_CLEAR_TABLE = "STORAGE_CLEAR_TABLE",
    STORAGE_CLEAR_ALL = "STORAGE_CLEAR_ALL",
    STORAGE_RESEED = "STORAGE_RESEED",

    // ─── Storage Browser: Non-SQL Surfaces (Issue 62) ───
    STORAGE_SESSION_LIST = "STORAGE_SESSION_LIST",
    STORAGE_SESSION_SET = "STORAGE_SESSION_SET",
    STORAGE_SESSION_DELETE = "STORAGE_SESSION_DELETE",
    STORAGE_SESSION_CLEAR = "STORAGE_SESSION_CLEAR",
    STORAGE_COOKIES_LIST = "STORAGE_COOKIES_LIST",
    STORAGE_COOKIES_SET = "STORAGE_COOKIES_SET",
    STORAGE_COOKIES_DELETE = "STORAGE_COOKIES_DELETE",
    STORAGE_COOKIES_CLEAR = "STORAGE_COOKIES_CLEAR",

    // ─── Marco SDK (Spec 18) ───
    AUTH_GET_TOKEN = "AUTH_GET_TOKEN",
    AUTH_GET_SOURCE = "AUTH_GET_SOURCE",
    AUTH_REFRESH = "AUTH_REFRESH",
    AUTH_IS_EXPIRED = "AUTH_IS_EXPIRED",
    AUTH_GET_JWT = "AUTH_GET_JWT",
    COOKIES_GET = "COOKIES_GET",
    COOKIES_GET_DETAIL = "COOKIES_GET_DETAIL",
    COOKIES_GET_ALL = "COOKIES_GET_ALL",
    CONFIG_GET = "CONFIG_GET",
    CONFIG_GET_ALL = "CONFIG_GET_ALL",
    CONFIG_SET = "CONFIG_SET",
    CONFIG_CHANGED = "CONFIG_CHANGED",
    XPATH_GET = "XPATH_GET",
    XPATH_GET_ALL = "XPATH_GET_ALL",
    FILE_READ = "FILE_READ",

    // ─── Updater (Spec 58) ───
    LIST_UPDATERS = "LIST_UPDATERS",
    GET_UPDATER = "GET_UPDATER",
    CREATE_UPDATER = "CREATE_UPDATER",
    DELETE_UPDATER = "DELETE_UPDATER",
    CHECK_FOR_UPDATE = "CHECK_FOR_UPDATE",
    GET_UPDATE_SETTINGS = "GET_UPDATE_SETTINGS",
    SAVE_UPDATE_SETTINGS = "SAVE_UPDATE_SETTINGS",

    // ─── Project Database API (Spec 67) ───
    PROJECT_API = "PROJECT_API",
    PROJECT_DB_CREATE_TABLE = "PROJECT_DB_CREATE_TABLE",
    PROJECT_DB_DROP_TABLE = "PROJECT_DB_DROP_TABLE",
    PROJECT_DB_LIST_TABLES = "PROJECT_DB_LIST_TABLES",

    // ─── Project Config DB (Issue 85) ───
    PROJECT_CONFIG_READ = "PROJECT_CONFIG_READ",
    PROJECT_CONFIG_UPDATE = "PROJECT_CONFIG_UPDATE",
    PROJECT_CONFIG_RECONSTRUCT = "PROJECT_CONFIG_RECONSTRUCT",

    // ─── Schema Meta Engine (Issue 85) ───
    APPLY_JSON_SCHEMA = "APPLY_JSON_SCHEMA",
    GENERATE_SCHEMA_DOCS = "GENERATE_SCHEMA_DOCS",

    // ─── Automation Chains (Spec 21) ───
    GET_AUTOMATION_CHAINS = "GET_AUTOMATION_CHAINS",
    SAVE_AUTOMATION_CHAIN = "SAVE_AUTOMATION_CHAIN",
    DELETE_AUTOMATION_CHAIN = "DELETE_AUTOMATION_CHAIN",
    TOGGLE_AUTOMATION_CHAIN = "TOGGLE_AUTOMATION_CHAIN",
    IMPORT_AUTOMATION_CHAINS = "IMPORT_AUTOMATION_CHAINS",

    // ─── Script Hot-Reload (Issue 77) ───
    GET_SCRIPT_INFO = "GET_SCRIPT_INFO",
    HOT_RELOAD_SCRIPT = "HOT_RELOAD_SCRIPT",

    // ─── Cache Management (Issue 88) ───
    INVALIDATE_CACHE = "INVALIDATE_CACHE",
    GET_CACHE_STATS = "GET_CACHE_STATS",

    // ─── Dynamic Script Loading ───
    DYNAMIC_REQUIRE = "DYNAMIC_REQUIRE",

    // ─── Cross-Project Sync (Spec 13) ───
    LIBRARY_GET_ASSETS = "LIBRARY_GET_ASSETS",
    LIBRARY_GET_ASSET = "LIBRARY_GET_ASSET",
    LIBRARY_SAVE_ASSET = "LIBRARY_SAVE_ASSET",
    LIBRARY_DELETE_ASSET = "LIBRARY_DELETE_ASSET",
    LIBRARY_GET_LINKS = "LIBRARY_GET_LINKS",
    LIBRARY_SAVE_LINK = "LIBRARY_SAVE_LINK",
    LIBRARY_DELETE_LINK = "LIBRARY_DELETE_LINK",
    LIBRARY_SYNC_ASSET = "LIBRARY_SYNC_ASSET",
    LIBRARY_PROMOTE_ASSET = "LIBRARY_PROMOTE_ASSET",
    LIBRARY_REPLACE_ASSET = "LIBRARY_REPLACE_ASSET",
    LIBRARY_FORK_ASSET = "LIBRARY_FORK_ASSET",
    LIBRARY_GET_GROUPS = "LIBRARY_GET_GROUPS",
    LIBRARY_SAVE_GROUP = "LIBRARY_SAVE_GROUP",
    LIBRARY_DELETE_GROUP = "LIBRARY_DELETE_GROUP",
    LIBRARY_GET_GROUP_MEMBERS = "LIBRARY_GET_GROUP_MEMBERS",
    LIBRARY_ADD_GROUP_MEMBER = "LIBRARY_ADD_GROUP_MEMBER",
    LIBRARY_REMOVE_GROUP_MEMBER = "LIBRARY_REMOVE_GROUP_MEMBER",
    LIBRARY_EXPORT = "LIBRARY_EXPORT",
    LIBRARY_IMPORT = "LIBRARY_IMPORT",
    LIBRARY_GET_VERSIONS = "LIBRARY_GET_VERSIONS",
    LIBRARY_ROLLBACK_VERSION = "LIBRARY_ROLLBACK_VERSION",
    LIBRARY_CASCADE_GROUP_SETTINGS = "LIBRARY_CASCADE_GROUP_SETTINGS",

    // ─── SDK Self-Test (Popup ✅/❌ panel) ───
    SDK_SELFTEST_REPORT = "SDK_SELFTEST_REPORT",
    GET_SDK_SELFTEST = "GET_SDK_SELFTEST",
}

/* ------------------------------------------------------------------ */
/*  Request / Response Shapes                                         */
/* ------------------------------------------------------------------ */

export interface TokenStatus {
    status: "valid" | "expiring" | "expired" | "missing";
    expiresIn: string | null;
}

export interface ConfigStatus {
    status: "loaded" | "defaults" | "failed";
    source: "local" | "remote" | "hardcoded";
}

export interface BootTiming {
    step: string;
    durationMs: number;
}

/**
 * Structured context describing the *exact* operation that triggered the
 * boot failure (e.g. failing SQL statement + migration step). Mirrors
 * `BootErrorContext` in src/background/boot-diagnostics.ts.
 */
export interface BootErrorContext {
    sql: string | null;
    migrationVersion: number | null;
    migrationDescription: string | null;
    scope: string | null;
}

/**
 * Snapshot of the upfront HEAD probe against the bundled WASM asset. Mirrors
 * `WasmProbeResult` in src/background/boot-diagnostics.ts. Surfaced in
 * `StatusResponse.wasmProbe` so the popup banner can render the captured
 * status code, content-length, and any HEAD error.
 */
export interface WasmProbeResult {
    url: string;
    status: number | null;
    contentLength: string | null;
    headError: string | null;
    ok: boolean;
    at: string;
}

export interface StatusResponse {
    connection: "online" | "offline" | "degraded";
    token: TokenStatus;
    config: ConfigStatus;
    loggingMode: "sqlite" | "fallback";
    version: string;
    bootStep: string;
    persistenceMode: "opfs" | "storage" | "memory";
    bootTimings: BootTiming[];
    totalBootMs: number;
    /** Underlying error message if boot failed; null when boot succeeded. */
    bootError: string | null;
    /** Underlying error stack trace if boot failed; null when unavailable. */
    bootErrorStack: string | null;
    /** Structured operation context (failing SQL/migration step), null when unavailable. */
    bootErrorContext: BootErrorContext | null;
    /** WASM HEAD probe snapshot; null when the probe never ran (boot died earlier). */
    wasmProbe: WasmProbeResult | null;
}

export interface HealthStatusResponse {
    state: "HEALTHY" | "DEGRADED" | "ERROR" | "FATAL";
    details: string[];
}

export interface NetworkStatusRequest {
    type: MessageType.NETWORK_STATUS;
    isOnline: boolean;
}

/** A captured network request from the content script. */
export interface NetworkRequestEntry {
    method: string;
    url: string;
    status: number;
    statusText: string;
    durationMs: number;
    requestType: "xhr" | "fetch";
    timestamp: string;
    initiator: string;
}

export interface NetworkRequestMessage {
    type: MessageType.NETWORK_REQUEST;
    entry: NetworkRequestEntry;
}

export interface GetStatusRequest {
    type: MessageType.GET_STATUS;
}

export interface GetHealthRequest {
    type: MessageType.GET_HEALTH_STATUS;
}

export interface GetAuthHealthRequest {
    type: MessageType.GET_AUTH_HEALTH;
}

export interface GetApiStatusRequest {
    type: MessageType.GET_API_STATUS;
}

export interface GetApiEndpointsRequest {
    type: MessageType.GET_API_ENDPOINTS;
}

/** Standard success envelope for simple acknowledgements. */
export interface OkResponse {
    isOk: true;
}

/** Standard error envelope. */
export interface ErrorResponse {
    isOk: false;
    errorMessage: string;
}

/** Union of all possible message requests. */
export type MessageRequest =
    | GetStatusRequest
    | GetHealthRequest
    | GetAuthHealthRequest
    | { type: MessageType.GET_TOKEN_SEEDER_DIAGNOSTICS }
    | GetApiStatusRequest
    | GetApiEndpointsRequest
    | NetworkStatusRequest
    | { type: MessageType.GET_CONFIG }
    | { type: MessageType.GET_TOKEN }
    | { type: MessageType.REFRESH_TOKEN }
    | { type: MessageType.LOG_ENTRY; level: string; source: string; category: string; action: string; detail: string; scriptId?: string; projectId?: string; configId?: string }
    | { type: MessageType.LOG_ERROR; level: string; source: string; category: string; errorCode: string; message: string; stackTrace?: string; context?: string; scriptId?: string; projectId?: string; configId?: string; scriptFile?: string }
    | { type: MessageType.GET_RECENT_LOGS; source?: string; limit?: number }
    | { type: MessageType.GET_LOG_STATS }
    | { type: MessageType.PURGE_LOGS; olderThanDays?: number }
    | { type: MessageType.EXPORT_LOGS_JSON }
    | { type: MessageType.EXPORT_LOGS_ZIP }
    | { type: MessageType.GET_ACTIVE_PROJECT }
    | { type: MessageType.SET_ACTIVE_PROJECT; projectId: string }
    | { type: MessageType.GET_ALL_PROJECTS }
    | { type: MessageType.SAVE_PROJECT; project: Record<string, JsonValue> }
    | { type: MessageType.DELETE_PROJECT; projectId: string }
    | { type: MessageType.DUPLICATE_PROJECT; projectId: string }
    | { type: MessageType.IMPORT_PROJECT; json: string }
    | { type: MessageType.EXPORT_PROJECT; projectId: string }
    | { type: MessageType.GET_AUTO_ATTACH_DECISIONS; projectId: string }
    | { type: MessageType.GET_ALL_SCRIPTS }
    | { type: MessageType.SAVE_SCRIPT; script: Record<string, JsonValue> }
    | { type: MessageType.DELETE_SCRIPT; id: string }
    | { type: MessageType.TOGGLE_SCRIPT; id: string }
    | { type: MessageType.GET_ALL_CONFIGS }
    | { type: MessageType.SAVE_CONFIG; config: Record<string, JsonValue> }
    | { type: MessageType.DELETE_CONFIG; id: string }
    | { type: MessageType.GET_SCRIPT_CONFIG; scriptId: string; configId?: string }
    | { type: MessageType.INJECT_SCRIPTS; tabId: number; scripts: Record<string, JsonValue>[]; forceReload?: boolean; launchSource?: InjectionLaunchSource }
    | { type: MessageType.GET_TAB_INJECTIONS; tabId: number }
    | { type: MessageType.GET_ACTIVE_ERRORS }
    | { type: MessageType.CLEAR_ERRORS }
    | { type: MessageType.GET_STORAGE_STATS }
    | { type: MessageType.QUERY_LOGS; database: "logs" | "errors"; offset: number; limit: number }
    | { type: MessageType.GET_LOG_DETAIL; database: "logs" | "errors"; rowId: number }
    | { type: MessageType.TOGGLE_XPATH_RECORDER }
    | { type: MessageType.GET_RECORDED_XPATHS }
    | { type: MessageType.CLEAR_RECORDED_XPATHS }
    | { type: MessageType.TEST_XPATH; xpath: string }
    | { type: MessageType.VALIDATE_ALL_XPATHS; xpaths: Record<string, { xpath: string; selector?: string }> }
    | { type: MessageType.RECORDER_DATA_SOURCE_ADD; projectSlug: string; filePath: string; mimeKind: "csv" | "json"; rawText: string }
    | { type: MessageType.RECORDER_DATA_SOURCE_LIST; projectSlug: string }
    | { type: MessageType.RECORDER_FIELD_BINDING_UPSERT; projectSlug: string; stepId: number; dataSourceId: number; columnName: string }
    | { type: MessageType.RECORDER_FIELD_BINDING_LIST; projectSlug: string }
    | { type: MessageType.RECORDER_FIELD_BINDING_DELETE; projectSlug: string; stepId: number }
    | { type: MessageType.RECORDER_CAPTURE_PERSIST; projectSlug?: string; payload: Record<string, JsonValue> }
    | { type: MessageType.RECORDER_CAPTURE_PERSIST_BATCH; projectSlug?: string; payloads: ReadonlyArray<Record<string, JsonValue>> }
    | { type: MessageType.RECORDER_STEP_INSERT; projectSlug: string; draft: Record<string, JsonValue> }
    | { type: MessageType.RECORDER_STEP_LIST; projectSlug: string }
    | { type: MessageType.RECORDER_STEP_DELETE; projectSlug: string; stepId: number }
    | { type: MessageType.RECORDER_STEP_RESOLVE; projectSlug: string; stepId: number }
    | { type: MessageType.RECORDER_STEP_RENAME; projectSlug: string; stepId: number; newVariableName: string }
    | { type: MessageType.RECORDER_STEP_SELECTORS_LIST; projectSlug: string; stepId: number }
    | { type: MessageType.RECORDER_STEP_UPDATE_META; projectSlug: string; stepId: number; patch: Record<string, JsonValue> }
    | { type: MessageType.RECORDER_STEP_TAGS_SET; projectSlug: string; stepId: number; tags: ReadonlyArray<string> }
    | { type: MessageType.RECORDER_STEP_LINK_SET; projectSlug: string; stepId: number; slot: "OnSuccessProjectId" | "OnFailureProjectId"; targetProjectSlug: string | null }
    | { type: MessageType.RECORDER_JS_SNIPPET_UPSERT; projectSlug: string; draft: Record<string, JsonValue> }
    | { type: MessageType.RECORDER_JS_SNIPPET_LIST; projectSlug: string }
    | { type: MessageType.RECORDER_JS_SNIPPET_DELETE; projectSlug: string; jsSnippetId: number }
    | { type: MessageType.RECORDER_JS_STEP_DRYRUN; body: string; context: Record<string, JsonValue> }
    | { type: MessageType.USER_SCRIPT_ERROR; scriptId: string; message: string; stack: string; scriptCode?: string; projectId?: string }
    | { type: MessageType.GET_NETWORK_REQUESTS }
    | { type: MessageType.GET_NETWORK_STATS }
    | { type: MessageType.CLEAR_NETWORK_REQUESTS }
    | NetworkRequestMessage
    | { type: MessageType.GET_RECENT_MESSAGES; limit?: number }
    | { type: MessageType.GET_SESSION_LOGS }
    | { type: MessageType.GET_SESSION_REPORT; sessionId?: string }
    | { type: MessageType.BROWSE_OPFS_SESSIONS }
    | { type: MessageType.GET_OPFS_STATUS }
    | { type: MessageType.RECORD_CYCLE_METRIC; cycleNumber: number; startTime: string; endTime: string; status: "success" | "error" | "skipped"; errorMessage?: string }
    | { type: MessageType.GET_RUN_STATS }
    | { type: MessageType.CLEAR_RUN_STATS }
    | { type: MessageType.GET_PROMPTS }
    | { type: MessageType.SAVE_PROMPT; prompt: Record<string, JsonValue> }
    | { type: MessageType.DELETE_PROMPT; promptId: string }
    | { type: MessageType.REORDER_PROMPTS; promptIds: string[] }
    | { type: MessageType.RESEED_PROMPTS }
    | { type: MessageType.GET_PROMPT_CHAINS }
    | { type: MessageType.SAVE_PROMPT_CHAIN; chain: Record<string, JsonValue> }
    | { type: MessageType.DELETE_PROMPT_CHAIN; chainId: string }
    | { type: MessageType.EXECUTE_CHAIN_STEP; promptText: string; stepIndex: number; totalSteps: number; timeoutSec: number }
    | UserScriptLogRequest
    | UserScriptDataSetRequest
    | UserScriptDataGetRequest
    | UserScriptDataDeleteRequest
    | UserScriptDataKeysRequest
    | UserScriptDataGetAllRequest
    | UserScriptDataClearRequest
    | { type: MessageType.GET_SETTINGS }
    | { type: MessageType.SAVE_SETTINGS; settings: Record<string, unknown> }
    | { type: MessageType.GET_PROMPT_VARIABLES }
    | { type: MessageType.SAVE_PROMPT_VARIABLES; variables: Record<string, string> }
    | { type: MessageType.KV_GET; projectId: string; key: string }
    | { type: MessageType.KV_SET; projectId: string; key: string; value: string }
    | { type: MessageType.KV_DELETE; projectId: string; key: string }
    | { type: MessageType.KV_LIST; projectId: string }
    | { type: MessageType.GKV_GET; group: string; key: string }
    | { type: MessageType.GKV_SET; group: string; key: string; value?: string }
    | { type: MessageType.GKV_DELETE; group: string; key: string }
    | { type: MessageType.GKV_LIST; group: string }
    | { type: MessageType.GKV_CLEAR_GROUP; group: string }
    | { type: MessageType.FILE_SAVE; projectId: string; filename: string; mimeType?: string; dataBase64: string }
    | { type: MessageType.FILE_GET; fileId: string }
    | { type: MessageType.FILE_LIST; projectId: string }
    | { type: MessageType.FILE_DELETE; fileId: string }
    | { type: MessageType.STORAGE_LIST_TABLES }
    | { type: MessageType.STORAGE_QUERY_TABLE; table: string; offset?: number; limit?: number }
    | { type: MessageType.STORAGE_UPDATE_ROW; table: string; primaryKey: Record<string, unknown>; updates: Record<string, unknown> }
    | { type: MessageType.STORAGE_DELETE_ROW; table: string; primaryKey: Record<string, unknown> }
    | { type: MessageType.STORAGE_GET_SCHEMA; table: string }
    | { type: MessageType.STORAGE_CLEAR_TABLE; table: string }
    | { type: MessageType.STORAGE_CLEAR_ALL }
    | { type: MessageType.STORAGE_RESEED }
    | { type: MessageType.STORAGE_SESSION_LIST; prefix?: string }
    | { type: MessageType.STORAGE_SESSION_SET; key: string; value: JsonValue }
    | { type: MessageType.STORAGE_SESSION_DELETE; key: string }
    | { type: MessageType.STORAGE_SESSION_CLEAR; prefix?: string }
    | { type: MessageType.STORAGE_COOKIES_LIST; domain?: string; nameContains?: string }
    | {
        type: MessageType.STORAGE_COOKIES_SET;
        name: string;
        value: string;
        url?: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
        sameSite?: string;
        expirationDate?: number;
      }
    | { type: MessageType.STORAGE_COOKIES_DELETE; name: string; url: string; storeId?: string }
    | { type: MessageType.STORAGE_COOKIES_CLEAR; domain?: string; nameContains?: string }
    // ─── Script Hot-Reload (Issue 77) ───
    | { type: MessageType.GET_SCRIPT_INFO; scriptName: string }
    | { type: MessageType.HOT_RELOAD_SCRIPT; scriptName: string }
    // ─── Schema Meta Engine (Issue 85) ───
    | { type: MessageType.APPLY_JSON_SCHEMA; project: string; schema: Record<string, JsonValue> }
    | { type: MessageType.GENERATE_SCHEMA_DOCS; project: string; format?: "markdown" | "prisma" | "both" | "meta" }
    // ─── Automation Chains (Spec 21) ───
    | { type: MessageType.GET_AUTOMATION_CHAINS; project?: string }
    | { type: MessageType.SAVE_AUTOMATION_CHAIN; project?: string; chain: Record<string, JsonValue> }
    | { type: MessageType.DELETE_AUTOMATION_CHAIN; project?: string; chainId: string }
    | { type: MessageType.TOGGLE_AUTOMATION_CHAIN; project?: string; chainId: string }
    | { type: MessageType.IMPORT_AUTOMATION_CHAINS; project?: string; chains: Record<string, JsonValue>[] }
    // ─── Cache Management (Issue 88) ───
    | { type: MessageType.INVALIDATE_CACHE }
    | { type: MessageType.GET_CACHE_STATS }
    // ─── SDK Self-Test (Popup ✅/❌ panel) ───
    | { type: MessageType.SDK_SELFTEST_REPORT; surface: "sync" | "kv" | "files" | "gkv"; pass: boolean; failures: string[]; version: string }
    | { type: MessageType.GET_SDK_SELFTEST };

/* ------------------------------------------------------------------ */
/*  User Script Logging & Data Bridge (Spec 42)                       */
/* ------------------------------------------------------------------ */

export interface UserScriptLogRequest {
    type: MessageType.USER_SCRIPT_LOG;
    payload: {
        level: string;
        source: string;
        category: string;
        action: string;
        detail: string;
        metadata: string | null;
        projectId: string | null;
        scriptId: string | null;
        configId: string | null;
        urlRuleId: string | null;
        pageUrl: string | null;
        timestamp: string;
    };
}

export interface UserScriptDataSetRequest {
    type: MessageType.USER_SCRIPT_DATA_SET;
    key: string;
    value: JsonValue;
    projectId: string;
    scriptId: string;
}

export interface UserScriptDataGetRequest {
    type: MessageType.USER_SCRIPT_DATA_GET;
    key: string;
}

export interface UserScriptDataDeleteRequest {
    type: MessageType.USER_SCRIPT_DATA_DELETE;
    key: string;
}

export interface UserScriptDataKeysRequest {
    type: MessageType.USER_SCRIPT_DATA_KEYS;
    prefix: string;
}

export interface UserScriptDataGetAllRequest {
    type: MessageType.USER_SCRIPT_DATA_GET_ALL;
    prefix: string;
}

export interface UserScriptDataClearRequest {
    type: MessageType.USER_SCRIPT_DATA_CLEAR;
    prefix: string;
}

/** A tracked message event for the diagnostics live log. */
export interface TrackedMessageEvent {
    type: string;
    timestamp: string;
    durationMs: number;
    ok: boolean;
}
