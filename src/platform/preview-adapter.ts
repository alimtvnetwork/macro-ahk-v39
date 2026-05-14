/**
 * Marco — Preview (Dev) Platform Adapter
 *
 * Mock implementation for the browser preview environment.
 * Returns realistic stub data so React components render
 * correctly outside the Chrome extension context.
 */

/* eslint-disable sonarjs/no-duplicate-string -- preview mock data has naturally repeated strings */
import { DEFAULT_CHATBOX_XPATH } from "@/shared/defaults";
import type {
    PlatformAdapter,
    PlatformStorage,
    PlatformTabs,
    MessagePayload,
} from "./platform-adapter";

/* ------------------------------------------------------------------ */
/*  In-Memory Storage                                                  */
/* ------------------------------------------------------------------ */

const memoryStore = new Map<string, string | number | boolean | null | object>();

/* ------------------------------------------------------------------ */
/*  Mutable Mock Error/Log State                                       */
/* ------------------------------------------------------------------ */

/** Whether mock errors have been cleared in this session. */
let mockErrorsCleared = false;
/** Whether mock logs have been cleared in this session. */
let mockLogsCleared = false;

const previewStorage: PlatformStorage = {
    async get<T = string | number | boolean | null | object>(key: string): Promise<T> {
        return (memoryStore.get(key) ?? null) as T;
    },

    async set(key: string, value: string | number | boolean | null | object): Promise<void> {
        memoryStore.set(key, value);
    },

    async remove(key: string): Promise<void> {
        memoryStore.delete(key);
    },
};

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */

const previewTabs: PlatformTabs = {
    openUrl(url: string): void {
        window.open(url, "_blank");
    },

    async getActiveTabId(): Promise<number | null> {
        return 1;
    },
};

/* ------------------------------------------------------------------ */
/*  Mock Message Responses                                             */
/* ------------------------------------------------------------------ */

/* In-memory recorder steps so Self-Test / Export work in web preview. */
interface MockRecorderStep {
    StepId: number;
    StepKindId: number;
    VariableName: string;
    Label: string;
    InlineJs: string | null;
    ParamsJson: string | null;
    IsBreakpoint: boolean;
    OrderIndex: number;
    CreatedAt: string;
}
const mockRecorderSteps = new Map<string, MockRecorderStep[]>();
let mockRecorderStepIdSeq = 1000;

interface MockRecorderMessage {
    type: string;
    projectSlug?: string;
    stepId?: number;
    draft?: {
        StepKindId: number;
        VariableName: string;
        Label?: string;
        InlineJs: string | null;
        ParamsJson: string | null;
        IsBreakpoint: boolean;
    };
}

function handleRecorderMock(message: MockRecorderMessage): object | null {
    const slug = typeof message.projectSlug === "string" ? message.projectSlug : "";
    if (slug.length === 0) { return null; }

    if (message.type === "RECORDER_STEP_LIST") {
        const steps = mockRecorderSteps.get(slug) ?? [];
        return { steps, dataSources: [], fieldBindings: [] };
    }
    if (message.type === "RECORDER_STEP_INSERT" && message.draft !== undefined) {
        const list = mockRecorderSteps.get(slug) ?? [];
        const draft = message.draft;
        const step: MockRecorderStep = {
            StepId: ++mockRecorderStepIdSeq,
            StepKindId: draft.StepKindId,
            VariableName: draft.VariableName,
            Label: draft.Label ?? "",
            InlineJs: draft.InlineJs,
            ParamsJson: draft.ParamsJson,
            IsBreakpoint: draft.IsBreakpoint,
            OrderIndex: list.length,
            CreatedAt: new Date().toISOString(),
        };
        mockRecorderSteps.set(slug, [...list, step]);
        return { isOk: true, step };
    }
    if (message.type === "RECORDER_STEP_DELETE" && typeof message.stepId === "number") {
        const list = mockRecorderSteps.get(slug) ?? [];
        mockRecorderSteps.set(slug, list.filter((s) => s.StepId !== message.stepId));
        return { isOk: true };
    }
    return null;
}

/** Returns mock data matching the background service worker protocol. */
// eslint-disable-next-line max-lines-per-function
function getMockResponse(message: MessagePayload): string | number | boolean | null | object {
    // Handle stateful mutations before building mock lookup
    if (message.type === "CLEAR_ERRORS") {
        mockErrorsCleared = true;
        mockLogsCleared = true;
        return { isOk: true };
    }

    /* Recorder messages — stateful, project-scoped in-memory store. */
    if (message.type === "RECORDER_STEP_LIST"
        || message.type === "RECORDER_STEP_INSERT"
        || message.type === "RECORDER_STEP_DELETE") {
        const result = handleRecorderMock(message as unknown as MockRecorderMessage);
        if (result !== null) { return result; }
    }

    const mocks: Record<string, string | number | boolean | null | object> = {
        GET_STATUS: {
            connection: "online",
            token: { status: "valid", expiresIn: "58m" },
            config: { status: "defaults", source: "hardcoded" },
            loggingMode: "fallback",
            version: "1.0.0-dev",
            bootStep: "ready",
            persistenceMode: "memory",
            bootTimings: [
                { step: "db-init", durationMs: 124 },
                { step: "bind-handlers", durationMs: 2 },
                { step: "rehydrate-state", durationMs: 18 },
                { step: "start-session", durationMs: 3 },
                { step: "seed-scripts", durationMs: 31 },
                { step: "ready", durationMs: 1 },
            ],
            totalBootMs: 179,
            bootError: null,
            bootErrorStack: null,
            bootErrorContext: null,
            wasmProbe: null,
        },
        GET_HEALTH_STATUS: { state: "HEALTHY", details: [] },
        GET_AUTH_HEALTH: {
            status: "authenticated",
            resolvedVia: "localStorage JWT scan",
            totalMs: 142,
            strategies: [
                { name: "Cookie presence", tier: 1, success: true, durationMs: 8, detail: "Session cookie found" },
                { name: "localStorage JWT scan", tier: 2, success: true, durationMs: 45, detail: "JWT in sb-ref-auth-token (tabId=1)" },
                { name: "Auth-token endpoint (tab)", tier: 3, success: true, durationMs: 78, detail: "JWT via tabId=1" },
                { name: "Direct fetch (service worker)", tier: 4, success: false, durationMs: 6, detail: "HTTP 401 (expected — MV3 strips cookies)" },
                { name: "Cross-tab cookie scan", tier: 5, success: true, durationMs: 5, detail: 'Cookie "lovable-session-id.id" (domain=.lovable.dev)' },
            ],
            checkedAt: new Date().toISOString(),
        },
        GET_API_STATUS: {
            isOk: true,
            service: "Marco Extension Message API",
            version: "1.0.0-dev",
            connection: "online",
            health: "HEALTHY",
            bootStep: "ready",
            persistenceMode: "memory",
            endpointCount: 74,
            timestamp: new Date().toISOString(),
        },
        GET_API_ENDPOINTS: {
            isOk: true,
            generatedAt: new Date().toISOString(),
            total: 8,
            endpoints: [
                { type: "GET_STATUS", category: "Diagnostics", description: "Read extension runtime status", isMutating: false, exampleRequest: { type: "GET_STATUS" } },
                { type: "GET_HEALTH_STATUS", category: "Diagnostics", description: "Read health state", isMutating: false, exampleRequest: { type: "GET_HEALTH_STATUS" } },
                { type: "GET_API_STATUS", category: "API Explorer", description: "Read API explorer status", isMutating: false, exampleRequest: { type: "GET_API_STATUS" } },
                { type: "GET_API_ENDPOINTS", category: "API Explorer", description: "List all endpoint docs", isMutating: false, exampleRequest: { type: "GET_API_ENDPOINTS" } },
                { type: "GET_PROMPTS", category: "Prompts", description: "Read all prompts", isMutating: false, exampleRequest: { type: "GET_PROMPTS" } },
                { type: "SAVE_PROMPT", category: "Prompts", description: "Create or update prompt", isMutating: true, exampleRequest: { type: "SAVE_PROMPT", prompt: { name: "Example", text: "Hello" } } },
                { type: "KV_SET", category: "Project KV", description: "Set project key/value", isMutating: true, exampleRequest: { type: "KV_SET", projectId: "_global", key: "sample", value: "1" } },
                { type: "STORAGE_QUERY_TABLE", category: "Storage Browser", description: "Query table rows", isMutating: false, exampleRequest: { type: "STORAGE_QUERY_TABLE", table: "Prompts", offset: 0, limit: 25 } },
            ],
        },
        GET_CONFIG: {
            config: {
                logLevel: "info",
                maxRetries: 3,
                timeoutMs: 5000,
                injectionMode: "programmatic",
                configMethod: "globalObject",
            },
            source: "hardcoded",
        },
        GET_TOKEN: { token: null },
        GET_ALL_PROJECTS: {
            projects: [
                {
                    id: "p1",
                    schemaVersion: 1,
                    name: "Marco Dashboard",
                    version: "1.2.0",
                    description: "Automation scripts for the developer dashboard",
                    targetUrls: [
                        { pattern: "https://app.example.dev/*", matchType: "glob" },
                        { pattern: "https://*.example.dev/dashboard", matchType: "glob" },
                    ],
                    scripts: [
                        { path: "scripts/init-globals.js", order: 1, runAt: "document_start", code: "// init-globals.js\n'use strict';\n\nconst MARCO_VERSION = '1.2.0';\nconst API_BASE = 'https://api.example.dev/v1';\n\n// Set up global namespace\nwindow.__MARCO__ = window.__MARCO__ || {};\nwindow.__MARCO__.version = MARCO_VERSION;\nwindow.__MARCO__.apiBase = API_BASE;\nwindow.__MARCO__.initialized = false;\n\nconsole.log(`[Marco] v${MARCO_VERSION} globals initialized`);" },
                        { path: "scripts/ui-enhancer.js", order: 2, runAt: "document_idle", configBinding: "configs/ui-settings.json", code: "// ui-enhancer.js\nimport { getConfig } from './utils';\n\nconst config = getConfig('ui-settings');\n\nfunction enhanceNavigation() {\n  const nav = document.querySelector(config.selectors.mainNav);\n  if (!nav) return;\n\n  // Add custom styles\n  nav.style.backgroundColor = config.theme === 'dark' ? '#1a1a2e' : '#ffffff';\n  nav.classList.add('marco-enhanced');\n  console.log('[Marco] Navigation enhanced');\n}\n\n// Wait for DOM\nif (document.readyState === 'complete') {\n  enhanceNavigation();\n} else {\n  window.addEventListener('load', enhanceNavigation);\n}" },
                        { path: "scripts/metrics.js", order: 3, runAt: "document_idle", code: "// metrics.js\n(function() {\n  'use strict';\n\n  const METRICS_ENDPOINT = '/v1/metrics';\n  let cycleCount = 0;\n\n  async function reportMetrics(data) {\n    try {\n      const response = await fetch(METRICS_ENDPOINT, {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify(data)\n      });\n      return response.ok;\n    } catch (err) {\n      console.warn('[Marco] Metrics report failed:', err.message);\n      return false;\n    }\n  }\n\n  window.__MARCO__.reportMetrics = reportMetrics;\n  window.__MARCO__.getCycleCount = () => cycleCount;\n})();" },
                    ],
                    configs: [{ path: "configs/ui-settings.json", description: "UI customization" }],
                    variables: JSON.stringify({
                        apiBaseUrl: "https://api.example.dev/v1",
                        theme: "dark",
                        featureFlags: { enableBeta: true, showDebugPanel: false, maxRetries: 3 },
                        selectors: { mainNav: "#app-nav", contentArea: ".main-content" },
                    }),
                    createdAt: "2026-01-15T10:00:00Z",
                    updatedAt: "2026-02-28T14:30:00Z",
                },
                {
                    id: "p2",
                    schemaVersion: 1,
                    name: "GitHub Enhancements",
                    version: "0.3.1",
                    description: "Custom tweaks for GitHub PR review pages",
                    targetUrls: [
                        { pattern: "https://github.com/*/pull/*", matchType: "glob" },
                    ],
                    scripts: [
                        { path: "scripts/pr-helpers.js", order: 1, runAt: "document_idle", code: "// pr-helpers.js\nconst PR_SELECTOR = '.pull-request-tab-content';\n\nfunction addReviewShortcuts() {\n  document.addEventListener('keydown', (e) => {\n    if (e.altKey && e.key === 'a') {\n      // Approve PR shortcut\n      const approveBtn = document.querySelector('[data-action=\"approve\"]');\n      if (approveBtn) approveBtn.click();\n    }\n  });\n}\n\naddReviewShortcuts();" },
                    ],
                    configs: [],
                    variables: JSON.stringify({
                        prPageSelector: ".pull-request-tab-content",
                        autoExpandFiles: true,
                    }),
                    createdAt: "2026-02-01T09:00:00Z",
                    updatedAt: "2026-03-01T11:00:00Z",
                },
            ],
        },
        GET_ALL_SCRIPTS: {
            scripts: [
                { id: "s1", name: "Auto-Login", order: 0, runAt: "document_idle", isEnabled: true, code: "// auto-login", isIife: false, hasDomUsage: false, createdAt: "2026-01-15T10:00:00Z", updatedAt: "2026-02-28T14:30:00Z" },
                { id: "s2", name: "Theme Injector", order: 1, runAt: "document_end", isEnabled: true, code: "// theme", isIife: false, hasDomUsage: true, createdAt: "2026-01-20T08:00:00Z", updatedAt: "2026-03-01T11:00:00Z" },
                { id: "s3", name: "Analytics Blocker", order: 2, runAt: "document_start", isEnabled: false, code: "// block", isIife: true, hasDomUsage: false, createdAt: "2026-02-01T09:00:00Z", updatedAt: "2026-03-10T16:00:00Z" },
            ],
        },
        GET_ALL_CONFIGS: { configs: [] },
        GET_ACTIVE_PROJECT: {
            activeProject: {
                id: "p1",
                name: "Macro Controller",
                version: "1.0.0",
                description: "Default project",
                scripts: [
                    { path: "scripts/init-globals.js", order: 1, runAt: "document_idle" },
                    { path: "scripts/ui-enhancer.js", order: 2, runAt: "document_idle", configBinding: "configs/ui-settings.json" },
                    { path: "scripts/metrics.js", order: 3, runAt: "document_idle" },
                ],
            },
            matchedRule: null,
            allProjects: [
                { id: "p1", name: "Macro Controller", version: "1.0.0" },
                { id: "p2", name: "GitHub Enhancements", version: "0.2.0" },
                { id: "p3", name: "Dev Tools", version: "1.1.0" },
            ],
            injectedScripts: {},
        },
        INJECT_SCRIPTS: {
            results: [
                { scriptId: "s1", scriptName: "init-globals.js", isSuccess: true, durationMs: 12 },
                { scriptId: "s2", scriptName: "ui-enhancer.js", isSuccess: true, durationMs: 8 },
                { scriptId: "s3", scriptName: "metrics.js", isSuccess: true, durationMs: 5 },
            ],
            inlineSyntaxErrorDetected: false,
        },
        GET_CACHE_STATS: {
            entryCount: 7,
            categories: { script_code: 4, namespace: 2, settings: 1 },
        },
        INVALIDATE_CACHE: { isOk: true, cleared: 7 },
        SET_ACTIVE_PROJECT: { matchedRule: null, injectedScripts: {} },
        GET_TAB_INJECTIONS: {
            injections: {
                1: { scriptIds: ["s1", "s2"], timestamp: new Date().toISOString(), projectId: "p1" },
            },
        },
        GET_STORAGE_STATS: {
            persistenceMode: "memory",
            logCount: 42,
            errorCount: 3,
            sessionCount: 5,
            databases: [
                { name: "logs.db", tables: { logs: 42, sessions: 5 } },
                { name: "errors.db", tables: { errors: 3 } },
            ],
        },
        QUERY_LOGS: { rows: [], total: 0 },
        GET_LOG_STATS: { logCount: 42, errorCount: 3, sessionCount: 5 },
        GET_RECENT_LOGS: {
            logs: mockLogsCleared ? [] : [
                { id: 1, timestamp: new Date(Date.now() - 60000).toISOString(), level: "info", source: "BOOT", category: "LIFECYCLE", action: "init", detail: "Service worker initialized", message: "Service worker initialized" },
                { id: 2, timestamp: new Date(Date.now() - 55000).toISOString(), level: "info", source: "CONFIG", category: "CONFIG", action: "load", detail: "Config loaded from storage", message: "Config loaded from storage" },
                { id: 3, timestamp: new Date(Date.now() - 50000).toISOString(), level: "warn", source: "AUTH", category: "AUTH", action: "token_expiry", detail: "Token expires in 5 minutes", message: "Token expires in 5 minutes" },
                { id: 4, timestamp: new Date(Date.now() - 45000).toISOString(), level: "error", source: "INJECTION", category: "INJECTION", action: "inject_fail", detail: "Script injection failed: tab closed", message: "Script injection failed: tab closed" },
                { id: 5, timestamp: new Date(Date.now() - 40000).toISOString(), level: "info", source: "MACRO", category: "LIFECYCLE", action: "cycle_start", detail: "Macro loop cycle #12 started", message: "Macro loop cycle #12 started" },
                { id: 6, timestamp: new Date(Date.now() - 35000).toISOString(), level: "info", source: "MACRO", category: "LIFECYCLE", action: "cycle_end", detail: "Macro loop cycle #12 completed", message: "Macro loop cycle #12 completed" },
                { id: 7, timestamp: new Date(Date.now() - 30000).toISOString(), level: "warn", source: "XPATH", category: "INJECTION", action: "stale_selector", detail: "XPath selector may be stale: projectButton", message: "XPath selector may be stale: projectButton" },
                { id: 8, timestamp: new Date(Date.now() - 25000).toISOString(), level: "error", source: "MACRO", category: "LIFECYCLE", action: "cycle_fail", detail: "Cycle #14 failed: page load timeout", message: "Cycle #14 failed: page load timeout" },
                { id: 9, timestamp: new Date(Date.now() - 20000).toISOString(), level: "info", source: "NETWORK", category: "NETWORK", action: "request", detail: "GET /v1/projects — 200 OK (142ms)", message: "GET /v1/projects — 200 OK (142ms)" },
                { id: 10, timestamp: new Date(Date.now() - 15000).toISOString(), level: "info", source: "DATA_BRIDGE", category: "DATA_BRIDGE", action: "set", detail: "Key 'userPrefs' updated", message: "Key 'userPrefs' updated" },
                { id: 11, timestamp: new Date(Date.now() - 10000).toISOString(), level: "warn", source: "STORAGE", category: "STORAGE", action: "flush", detail: "Storage flush took 2.3s (slow)", message: "Storage flush took 2.3s (slow)" },
                { id: 12, timestamp: new Date(Date.now() - 5000).toISOString(), level: "info", source: "MACRO", category: "LIFECYCLE", action: "retry", detail: "Retrying cycle #15 (attempt 2/3)", message: "Retrying cycle #15 (attempt 2/3)" },
            ],
        },
        GET_RECORDED_XPATHS: { recorded: [], isRecording: false },
        GET_ACTIVE_ERRORS: { errors: mockErrorsCleared ? [] : [
            {
                id: 1,
                timestamp: new Date(Date.now() - 30000).toISOString(),
                message: "Cannot read properties of undefined (reading 'plusButtonXPath')",
                stack_trace: "TypeError: Cannot read properties of undefined (reading 'plusButtonXPath')\n    at resolveAutoAttachConfig (eval at executeSerializedCode (:2:12), <anonymous>:6052:28)\n    at createUI (eval at executeSerializedCode (:2:12), <anonymous>:6172:20)\n    at eval (eval at executeSerializedCode (:2:12), <anonymous>:6979:3)",
                script_id: "default-macro-looping",
                error_code: "USER_SCRIPT_ERROR",
                ext_version: "1.33.0",
            },
            {
                id: 2,
                timestamp: new Date(Date.now() - 120000).toISOString(),
                message: "Script injection failed: tab closed before execution",
                stack_trace: "Error: Script injection failed: tab closed before execution\n    at executeInTab (injection-handler.ts:194:15)\n    at injectSingleScript (injection-handler.ts:116:9)",
                script_id: "default-combo",
                error_code: "INJECTION_FAILED",
                ext_version: "1.33.0",
            },
        ] },
        /* CLEAR_ERRORS handled above as stateful mutation */
        GET_SETTINGS: { settings: {
            autoRunOnPageLoad: true,
            showNotifications: true,
            defaultRunAt: "document_idle",
            debugMode: false,
            maxCycleCount: 100,
            idleTimeout: 5000,
            theme: "system",
            chatBoxXPath: DEFAULT_CHATBOX_XPATH,
            injectionBudgetMs: 500,
            optionsMountBudgetMs: 1000,
        } },
        SAVE_SETTINGS: { isOk: true },
        GET_PROMPT_VARIABLES: {
            variables: {
                date: new Date().toISOString().split("T")[0],
                time: new Date().toTimeString().split(" ")[0],
                datetime: new Date().toISOString(),
                timestamp: String(Date.now()),
                year: String(new Date().getFullYear()),
                month: String(new Date().getMonth() + 1).padStart(2, "0"),
                day: String(new Date().getDate()).padStart(2, "0"),
                workspace: "my-project",
                author: "Marco User",
            },
            builtIn: ["date", "time", "datetime", "timestamp", "year", "month", "day"],
        },
        SAVE_PROMPT_VARIABLES: { isOk: true },
        NETWORK_STATUS: { isOk: true },
        GET_NETWORK_REQUESTS: {
            requests: [
                { method: "GET", url: "https://api.example.dev/v1/projects", status: 200, statusText: "OK", durationMs: 142, requestType: "fetch", timestamp: new Date(Date.now() - 30000).toISOString(), initiator: "app", requestHeaders: { Authorization: "Bearer eyJ...truncated", Accept: "application/json" }, responseHeaders: { "Content-Type": "application/json" }, responsePreview: '{"projects":[{"id":"p1","name":"Macro Controller"}]}' },
                { method: "POST", url: "https://api.example.dev/v1/auth/refresh", status: 200, statusText: "OK", durationMs: 89, requestType: "fetch", timestamp: new Date(Date.now() - 25000).toISOString(), initiator: "auth" },
                { method: "GET", url: "https://cdn.example.dev/assets/logo.png", status: 304, statusText: "Not Modified", durationMs: 12, requestType: "xhr", timestamp: new Date(Date.now() - 20000).toISOString(), initiator: "ui" },
                { method: "PUT", url: "https://api.example.dev/v1/config", status: 401, statusText: "Unauthorized", durationMs: 200, requestType: "fetch", timestamp: new Date(Date.now() - 15000).toISOString(), initiator: "settings" },
                { method: "GET", url: "https://api.example.dev/v1/scripts", status: 500, statusText: "Internal Server Error", durationMs: 1500, requestType: "xhr", timestamp: new Date(Date.now() - 10000).toISOString(), initiator: "scripts" },
                { method: "DELETE", url: "https://api.example.dev/v1/logs/old", status: 204, statusText: "No Content", durationMs: 340, requestType: "fetch", timestamp: new Date(Date.now() - 5000).toISOString(), initiator: "cleanup" },
                { method: "GET", url: "https://api.example.dev/v1/health", status: 0, statusText: "", durationMs: 5000, requestType: "fetch", timestamp: new Date(Date.now() - 2000).toISOString(), initiator: "health" },
            ],
        },
        GET_NETWORK_STATS: {
            totalCaptured: 7,
            byType: { xhr: 2, fetch: 5 },
            byStatus: { "2xx": 3, "3xx": 1, "4xx": 1, "5xx": 1, "0xx": 1 },
            averageDurationMs: 326,
        },
        CLEAR_NETWORK_REQUESTS: { isOk: true },
        GET_DATA_STORE_ALL: {
            entries: [
                { key: "p1::userPrefs", value: { theme: "dark", lang: "en" }, valuePreview: '{"theme":"dark","lang":"en"}', sizeBytes: 28, projectId: "p1", scriptId: "s1", updatedAt: "2026-03-10T08:00:00Z" },
                { key: "p1::sessionToken", value: "abc123xyz", valuePreview: '"abc123xyz"', sizeBytes: 11, projectId: "p1", scriptId: "s2", updatedAt: "2026-03-12T14:30:00Z" },
            ],
        },
        PURGE_LOGS: { purged: 0 },
        VALIDATE_ALL_XPATHS: {
            results: [
                { name: "projectButton", xpath: "/html/body/div[2]/.../button", found: 1, status: "pass" },
                { name: "mainProgress", xpath: "/html/body/div[6]/.../div[1]", found: 1, status: "pass" },
                { name: "progress", xpath: "/html/body/div[6]/.../div[2]", selector: "[role='progressbar']", found: 1, status: "pass" },
                { name: "workspace", xpath: "/html/body/div[6]/.../p", found: 1, status: "pass" },
                { name: "controls", xpath: "/html/body/div[3]/.../div[3]", found: 0, status: "fallback", fallbackUsed: true, error: 'XPath stale — CSS fallback found 1 element(s). Update XPath config for "controls".' },
                { name: "promptActive", xpath: "/html/body/div[2]/.../div[2]", selector: "form textarea", found: 0, status: "fail", error: 'XPath not found: "promptActive". Consider adding a CSS selector fallback.' },
                { name: "projectName", xpath: "/html/body/div[2]/.../p", found: 0, status: "fail", error: 'XPath not found: "projectName". Consider adding a CSS selector fallback.' },
            ],
            passCount: 4,
            failCount: 2,
            fallbackCount: 1,
        },
        STORAGE_LIST_TABLES: {
            tables: [
                { name: "Sessions", rowCount: 5, primaryKeys: ["id"], isView: false },
                { name: "Logs", rowCount: 42, primaryKeys: ["id"], isView: false },
                { name: "Errors", rowCount: 3, primaryKeys: ["id"], isView: false },
                { name: "Prompts", rowCount: 6, primaryKeys: ["id"], isView: false },
                { name: "PromptsCategory", rowCount: 4, primaryKeys: ["id"], isView: false },
                { name: "PromptsToCategory", rowCount: 5, primaryKeys: ["id"], isView: false },
                { name: "ProjectKv", rowCount: 2, primaryKeys: ["project_id", "key"], isView: false },
                { name: "ProjectFiles", rowCount: 0, primaryKeys: ["id"], isView: false },
                { name: "Scripts", rowCount: 3, primaryKeys: ["id"], isView: false },
                { name: "PromptsDetails", rowCount: 6, primaryKeys: [], isView: true },
            ],
            dbSizeBytes: 262144,
        },
        STORAGE_GET_SCHEMA: {
            columns: [
                { name: "promptId", type: "TEXT", notnull: false, pk: false },
                { name: "title", type: "TEXT", notnull: false, pk: false },
                { name: "content", type: "TEXT", notnull: false, pk: false },
                { name: "version", type: "TEXT", notnull: false, pk: false },
                { name: "sortOrder", type: "INTEGER", notnull: false, pk: false },
                { name: "isDefault", type: "INTEGER", notnull: false, pk: false },
                { name: "isFavorite", type: "INTEGER", notnull: false, pk: false },
                { name: "createdAt", type: "TEXT", notnull: false, pk: false },
                { name: "updatedAt", type: "TEXT", notnull: false, pk: false },
                { name: "categories", type: "TEXT", notnull: false, pk: false },
            ],
        },
        STORAGE_QUERY_TABLE: {
            rows: [
                { promptId: "default-start", title: "Start Prompt", content: "Read the plan file and memory bank...", version: "1.0.0", sortOrder: 0, isDefault: 1, isFavorite: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", categories: "General" },
                { promptId: "default-rejog", title: "Rejog Memory", content: "Re-read the memory bank and project context...", version: "1.0.0", sortOrder: 1, isDefault: 1, isFavorite: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", categories: "Memory" },
                { promptId: "default-issues", title: "Issues Tracking", content: "Check the issues list and work on highest priority...", version: "1.0.0", sortOrder: 2, isDefault: 1, isFavorite: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", categories: "Debug" },
                { promptId: "default-test", title: "Unit Test Fix", content: "Run the failing unit tests and fix them one by one.", version: "1.0.0", sortOrder: 3, isDefault: 1, isFavorite: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", categories: "Testing" },
                { promptId: "custom-1", title: "Deploy Check", content: "Verify the deployment pipeline is green...", version: "1.0.0", sortOrder: 4, isDefault: 0, isFavorite: 0, createdAt: "2026-03-15T10:00:00Z", updatedAt: "2026-03-15T10:00:00Z", categories: "Deploy" },
                { promptId: "custom-2", title: "Context Dump", content: "Print the full context of the current file...", version: "1.0.0", sortOrder: 5, isDefault: 0, isFavorite: 1, createdAt: "2026-03-16T08:00:00Z", updatedAt: "2026-03-16T08:00:00Z", categories: "Debug" },
            ],
            total: 6,
            columns: ["promptId", "title", "content", "version", "sortOrder", "isDefault", "isFavorite", "createdAt", "updatedAt", "categories"],
        },
        STORAGE_UPDATE_ROW: { isOk: true },
        STORAGE_DELETE_ROW: { isOk: true },
        STORAGE_CLEAR_TABLE: { isOk: true, table: "Prompts", deleted: 6 },
        STORAGE_CLEAR_ALL: { isOk: true, cleared: ["Sessions", "Logs", "Errors", "Prompts", "PromptsCategory", "PromptsToCategory", "ProjectKv", "ProjectFiles", "Scripts"] },
        STORAGE_RESEED: { isOk: true, seeded: ["Prompts", "PromptsCategory", "PromptsToCategory"] },
        STORAGE_SESSION_LIST: {
            entries: [
                { key: "marco_network_online", value: true, valueType: "boolean", sizeBytes: 4 },
                { key: "marco_last_workspace", value: "workspace_123", valueType: "string", sizeBytes: 13 },
                { key: "marco_boot_state", value: { step: "ready", retries: 0 }, valueType: "object", sizeBytes: 31 },
            ],
            total: 3,
        },
        STORAGE_SESSION_SET: { isOk: true },
        STORAGE_SESSION_DELETE: { isOk: true },
        STORAGE_SESSION_CLEAR: { isOk: true, cleared: 2 },
        STORAGE_COOKIES_LIST: {
            cookies: [
                {
                    name: "lovable-session-id.id",
                    value: "sess_preview_token",
                    domain: ".lovable.dev",
                    path: "/",
                    secure: true,
                    httpOnly: true,
                    sameSite: "lax",
                    session: true,
                    storeId: "0",
                },
                {
                    name: "lovable-session-id.refresh",
                    value: "refresh_preview_token",
                    domain: ".lovable.dev",
                    path: "/",
                    secure: true,
                    httpOnly: true,
                    sameSite: "lax",
                    session: true,
                    storeId: "0",
                },
            ],
            total: 2,
        },
        STORAGE_COOKIES_SET: { isOk: true },
        STORAGE_COOKIES_DELETE: { isOk: true },
        STORAGE_COOKIES_CLEAR: { isOk: true, cleared: 2 },
        LIST_UPDATERS: {
            updaters: [
                {
                    UpdaterId: 1,
                    Name: "Riseup Macro SDK",
                    Description: "Core SDK providing the mandatory foundation for all macro scripts",
                    ScriptUrl: "https://cdn.riseup.dev/sdk/latest/macro-sdk.js",
                    VersionInfoUrl: "https://cdn.riseup.dev/sdk/version.json",
                    InstructionUrl: "https://cdn.riseup.dev/sdk/instruction.json",
                    ChangelogUrl: "https://cdn.riseup.dev/sdk/changelog.md",
                    IsGit: 0,
                    IsRedirectable: 1,
                    MaxRedirectDepth: 2,
                    IsInstructionRedirect: 0,
                    InstructionRedirectDepth: 2,
                    HasInstructions: 1,
                    HasChangelogFromVersionInfo: 1,
                    HasUserConfirmBeforeUpdate: 0,
                    IsEnabled: 1,
                    AutoCheckIntervalMinutes: 1440,
                    CacheExpiryMinutes: 10080,
                    CachedRedirectUrl: null,
                    CachedRedirectAt: null,
                    CurrentVersion: "2.4.1",
                    LatestVersion: "2.5.0",
                    LastCheckedAt: new Date(Date.now() - 3600000).toISOString(),
                    LastUpdatedAt: "2026-03-20T10:00:00Z",
                    Categories: "Script, Core",
                },
                {
                    UpdaterId: 2,
                    Name: "UI Helpers",
                    Description: "Optional UI utility library for DOM manipulation",
                    ScriptUrl: "https://cdn.riseup.dev/ui-helpers/latest/ui-helpers.js",
                    VersionInfoUrl: "https://cdn.riseup.dev/ui-helpers/version.json",
                    InstructionUrl: null,
                    ChangelogUrl: null,
                    IsGit: 0,
                    IsRedirectable: 0,
                    MaxRedirectDepth: 2,
                    IsInstructionRedirect: 0,
                    InstructionRedirectDepth: 2,
                    HasInstructions: 0,
                    HasChangelogFromVersionInfo: 0,
                    HasUserConfirmBeforeUpdate: 1,
                    IsEnabled: 1,
                    AutoCheckIntervalMinutes: 10080,
                    CacheExpiryMinutes: 10080,
                    CachedRedirectUrl: null,
                    CachedRedirectAt: null,
                    CurrentVersion: "1.0.0",
                    LatestVersion: "1.0.0",
                    LastCheckedAt: new Date(Date.now() - 86400000).toISOString(),
                    LastUpdatedAt: "2026-03-15T08:00:00Z",
                    Categories: "Script, Feature",
                },
            ],
        },
        CREATE_UPDATER: { isOk: true },
        DELETE_UPDATER: { isOk: true },
        CHECK_FOR_UPDATE: {
            hasUpdate: true,
            latestVersion: "2.5.0",
            currentVersion: "2.4.1",
        },
        TOGGLE_SCRIPT: { isOk: true },
        SAVE_PROJECT: { isOk: true },
        DELETE_PROJECT: { isOk: true },
        SAVE_SCRIPT: { isOk: true },
        DELETE_SCRIPT: { isOk: true },
        SAVE_CONFIG: { isOk: true },
        DELETE_CONFIG: { isOk: true },
        EXPORT_LOGS_JSON: { json: "[]", filename: "marco-logs.json" },
        EXPORT_LOGS_ZIP: { dataUrl: null, filename: "marco-bundle.zip" },
        GET_ONBOARDING_STATE: { isComplete: true },
        COMPLETE_ONBOARDING: { isOk: true },
        RECORD_CYCLE_METRIC: { isOk: true },
        CLEAR_RUN_STATS: { isOk: true },
        GET_RUN_STATS: {
            totalCycles: 27,
            successCount: 23,
            errorCount: 3,
            skippedCount: 1,
            successRate: 85.2,
            avgDurationMs: 4320,
            lastErrorMessage: "XPath not found: projectButton",
            recentCycles: [
                { cycleNumber: 8, startTime: "2026-03-18T10:00:00Z", endTime: "2026-03-18T10:00:04Z", durationMs: 4000, status: "success" as const },
                { cycleNumber: 9, startTime: "2026-03-18T10:02:00Z", endTime: "2026-03-18T10:02:05Z", durationMs: 5000, status: "success" as const },
                { cycleNumber: 10, startTime: "2026-03-18T10:04:00Z", endTime: "2026-03-18T10:04:03Z", durationMs: 3000, status: "error" as const, errorMessage: "XPath not found: projectButton" },
                { cycleNumber: 11, startTime: "2026-03-18T10:06:00Z", endTime: "2026-03-18T10:06:04Z", durationMs: 4200, status: "success" as const },
                { cycleNumber: 12, startTime: "2026-03-18T10:08:00Z", endTime: "2026-03-18T10:08:01Z", durationMs: 800, status: "skipped" as const },
                { cycleNumber: 13, startTime: "2026-03-18T10:10:00Z", endTime: "2026-03-18T10:10:05Z", durationMs: 5100, status: "success" as const },
                { cycleNumber: 14, startTime: "2026-03-18T10:12:00Z", endTime: "2026-03-18T10:12:06Z", durationMs: 6200, status: "success" as const },
                { cycleNumber: 15, startTime: "2026-03-18T10:14:00Z", endTime: "2026-03-18T10:14:03Z", durationMs: 3500, status: "error" as const, errorMessage: "Page load timeout" },
                { cycleNumber: 16, startTime: "2026-03-18T10:16:00Z", endTime: "2026-03-18T10:16:04Z", durationMs: 4100, status: "success" as const },
                { cycleNumber: 17, startTime: "2026-03-18T10:18:00Z", endTime: "2026-03-18T10:18:04Z", durationMs: 3900, status: "success" as const },
            ],
        },
        SAVE_PROMPT: { isOk: true, prompt: {} },
        DELETE_PROMPT: { isOk: true },
        REORDER_PROMPTS: { isOk: true },
        GET_PROMPT_CHAINS: {
            chains: [
                {
                    id: "chain-1",
                    name: "Full Context Workflow",
                    promptIds: ["default-start", "default-rejog", "default-test"],
                    timeoutSec: 300,
                    createdAt: "2026-03-10T08:00:00Z",
                    updatedAt: "2026-03-16T12:00:00Z",
                },
            ],
        },
        SAVE_PROMPT_CHAIN: { isOk: true, chain: {} },
        DELETE_PROMPT_CHAIN: { isOk: true },
        EXECUTE_CHAIN_STEP: (() => {
            // Simulate async step execution with delay
            return new Promise(resolve => setTimeout(() => resolve({ isOk: true }), 1500));
        })(),
        GET_PROMPTS: {
            prompts: [
                { id: "1", name: "Start Prompt", text: "Begin session with repository context scan and memory synthesis, then produce a reliability risk report before implementation.", order: 0, isDefault: true, category: "General", isFavorite: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
                { id: "3", name: "Rejog the Memory v1", text: "Read and synthesize existing repository context from the memory folder and the full specification set.", order: 2, isDefault: true, category: "Memory", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
                { id: "4", name: "Unified AI Prompt v4", text: "Read and synthesize existing repository context. Follow Required Execution Order.", order: 3, isDefault: true, category: "Memory", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
                { id: "5", name: "Issues Tracking", text: "Do not implement any code changes. Update specifications and documentation only.", order: 4, isDefault: true, category: "Debug", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
                { id: "6", name: "Unit Test Failing", text: "Fix failing tests: check code, check implementation, check test case, fix logically.", order: 5, isDefault: true, category: "Testing", isFavorite: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
                { id: "7", name: "Minor Bump", text: "Bump all Minor versions for all", order: 6, isDefault: true, category: "versioning", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
                { id: "8", name: "Major Bump", text: "Bump all Major versions for all", order: 7, isDefault: true, category: "versioning", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
                { id: "9", name: "Patch Bump", text: "Bump all Patch versions for all", order: 8, isDefault: true, category: "versioning", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
                { id: "10", name: "Code Coverage Basic", text: "Based on low-coverage packages, plan 200-line segments for coverage tests.", order: 9, isDefault: true, category: "code-coverage", createdAt: "2026-03-21T00:00:00Z", updatedAt: "2026-03-21T00:00:00Z" },
                { id: "11", name: "Code Coverage Details", text: "Plan 200-line segments for low-coverage packages. Follow AAA format.", order: 10, isDefault: true, category: "code-coverage", createdAt: "2026-03-21T00:00:00Z", updatedAt: "2026-03-21T00:00:00Z" },
                { id: "12", name: "Next Tasks", text: "Next, list out the remaining tasks always.", order: 11, isDefault: true, category: "automation", createdAt: "2026-03-21T00:00:00Z", updatedAt: "2026-03-21T00:00:00Z" },
                { id: "13", name: "Deploy Check", text: "Verify the deployment pipeline is green and all checks pass before merging.", order: 12, isDefault: false, category: "Deploy", createdAt: "2026-03-15T10:00:00Z", updatedAt: "2026-03-15T10:00:00Z" },
                { id: "14", name: "Context Dump", text: "Print the full context of the current file and its dependencies for review.", order: 13, isDefault: false, category: "Debug", isFavorite: true, createdAt: "2026-03-16T08:00:00Z", updatedAt: "2026-03-16T08:00:00Z" },
            ],
        },
        RESEED_PROMPTS: { isOk: true },
        FILE_LIST: {
            files: [
                { id: "f1", filename: "config/settings.json", mimeType: "application/json", size: 245, createdAt: "2026-03-10T08:00:00Z", updatedAt: "2026-03-18T12:00:00Z" },
                { id: "f2", filename: "config/urls.json", mimeType: "application/json", size: 128, createdAt: "2026-03-10T08:00:00Z", updatedAt: "2026-03-15T10:00:00Z" },
                { id: "f3", filename: "scripts/init.js", mimeType: "text/javascript", size: 1024, createdAt: "2026-03-12T09:00:00Z", updatedAt: "2026-03-20T14:00:00Z" },
                { id: "f4", filename: "scripts/helpers/utils.js", mimeType: "text/javascript", size: 512, createdAt: "2026-03-14T11:00:00Z", updatedAt: "2026-03-19T16:00:00Z" },
                { id: "f5", filename: "readme.md", mimeType: "text/markdown", size: 340, createdAt: "2026-03-10T08:00:00Z", updatedAt: "2026-03-21T08:00:00Z" },
                { id: "f6", filename: "notes.txt", mimeType: "text/plain", size: 89, createdAt: "2026-03-16T10:00:00Z", updatedAt: "2026-03-16T10:00:00Z" },
            ],
        },
        FILE_GET: { data: "// Sample file content\nconsole.log('Hello from project file');\n\nexport function init() {\n  return { status: 'ready' };\n}\n", dataBase64: btoa("// Sample file content\nconsole.log('Hello from project file');\n\nexport function init() {\n  return { status: 'ready' };\n}\n") },
        FILE_SAVE: { isOk: true },
        FILE_DELETE: { isOk: true },
        // ─── Automation Chains (Spec 21) ───
        GET_AUTOMATION_CHAINS: {
            isOk: true,
            chains: [
                {
                    id: "1", projectId: "default", name: "Full Review Cycle", slug: "full-review-cycle",
                    steps: [
                        { type: "inject_prompt", slug: "code-review" },
                        { type: "wait_for_text", text: "Review complete", timeoutMs: 60000 },
                        { type: "notify", message: "Review done ✅", level: "success" },
                    ],
                    triggerType: "manual", triggerConfig: {}, enabled: true,
                    createdAt: "2026-03-25T10:00:00Z", updatedAt: "2026-03-26T14:00:00Z",
                },
            ],
        },
        SAVE_AUTOMATION_CHAIN: { isOk: true },
        DELETE_AUTOMATION_CHAIN: { isOk: true },
        TOGGLE_AUTOMATION_CHAIN: { isOk: true },
        IMPORT_AUTOMATION_CHAINS: { isOk: true, imported: 0 },
        GET_SESSION_REPORT: {
            report: "══════════════════════════════════════════\n  Marco Full Session Report\n  Session: #29\n  Generated: 2026-04-05T10:00:00Z\n  Version: 2.17.0\n══════════════════════════════════════════\n\n2026-04-05T09:58:00Z  INFO   background    INJECTION     SCRIPT_INJECTED  marco-sdk.js\n2026-04-05T09:58:01Z  INFO   background    INJECTION     SCRIPT_INJECTED  macro-looping.js\n",
            sessionId: "29",
            sessions: ["29", "28", "27", "26", "25"],
            sessionsWithTimestamps: [
                { id: "29", lastModified: new Date(Date.now() - 15 * 60_000).toISOString() },
                { id: "28", lastModified: new Date(Date.now() - 2 * 3600_000).toISOString() },
                { id: "27", lastModified: new Date(Date.now() - 5 * 3600_000).toISOString() },
                { id: "26", lastModified: new Date(Date.now() - 24 * 3600_000).toISOString() },
                { id: "25", lastModified: new Date(Date.now() - 3 * 24 * 3600_000).toISOString() },
            ],
        },
        BROWSE_OPFS_SESSIONS: {
            rootPath: "opfs-root/session-logs",
            totalSessions: 3,
            sessions: [
                {
                    sessionId: "29",
                    absolutePath: "opfs-root/session-logs/session-29",
                    totalSizeBytes: 4812,
                    files: [
                        { name: "events.log", absolutePath: "opfs-root/session-logs/session-29/events.log", sizeBytes: 3200, lastModified: "2026-04-05T08:30:00Z" },
                        { name: "errors.log", absolutePath: "opfs-root/session-logs/session-29/errors.log", sizeBytes: 512, lastModified: "2026-04-05T08:28:00Z" },
                        { name: "scripts.log", absolutePath: "opfs-root/session-logs/session-29/scripts.log", sizeBytes: 1100, lastModified: "2026-04-05T08:25:00Z" },
                    ],
                },
                {
                    sessionId: "28",
                    absolutePath: "opfs-root/session-logs/session-28",
                    totalSizeBytes: 2048,
                    files: [
                        { name: "events.log", absolutePath: "opfs-root/session-logs/session-28/events.log", sizeBytes: 1800, lastModified: "2026-04-04T14:10:00Z" },
                        { name: "scripts.log", absolutePath: "opfs-root/session-logs/session-28/scripts.log", sizeBytes: 248, lastModified: "2026-04-04T14:05:00Z" },
                    ],
                },
                {
                    sessionId: "27",
                    absolutePath: "opfs-root/session-logs/session-27",
                    totalSizeBytes: 0,
                    files: [],
                },
            ],
        },
        GET_OPFS_STATUS: {
            sessionId: "29",
            dirExists: true,
            files: [
                { name: "events.log", absolutePath: "opfs-root/session-logs/session-29/events.log", sizeBytes: 3200, exists: true },
                { name: "errors.log", absolutePath: "opfs-root/session-logs/session-29/errors.log", sizeBytes: 512, exists: true },
                { name: "scripts.log", absolutePath: "opfs-root/session-logs/session-29/scripts.log", sizeBytes: 1100, exists: true },
            ],
            healthy: true,
        },

        // ─── Cross-Project Sync (Library) ───
        LIBRARY_GET_ASSETS: {
            assets: [
                { Id: 1, Type: "prompt", Name: "Summarize Article", Slug: "summarize-article", ContentJson: '{"text":"Summarize the following article in 3 bullet points:"}', ContentHash: "a1b2c3d4", Version: "2.1.0", CreatedAt: "2026-03-15T10:00:00Z", UpdatedAt: "2026-04-01T14:30:00Z" },
                { Id: 2, Type: "script", Name: "Auto-Click Submit", Slug: "auto-click-submit", ContentJson: '{"code":"document.querySelector(\\".submit-btn\\").click()"}', ContentHash: "e5f6a7b8", Version: "1.0.0", CreatedAt: "2026-03-20T09:00:00Z", UpdatedAt: "2026-03-20T09:00:00Z" },
                { Id: 3, Type: "chain", Name: "Research Pipeline", Slug: "research-pipeline", ContentJson: '{"steps":["summarize","extract-keywords","generate-report"]}', ContentHash: "c9d0e1f2", Version: "1.3.0", CreatedAt: "2026-03-25T12:00:00Z", UpdatedAt: "2026-04-05T08:15:00Z" },
                { Id: 4, Type: "preset", Name: "Dark Theme Config", Slug: "dark-theme-config", ContentJson: '{"theme":"dark","fontSize":14,"fontFamily":"JetBrains Mono"}', ContentHash: "a3b4c5d6", Version: "1.0.0", CreatedAt: "2026-04-01T10:00:00Z", UpdatedAt: "2026-04-01T10:00:00Z" },
            ],
        },
        LIBRARY_GET_LINKS: {
            links: [
                { Id: 1, SharedAssetId: 1, ProjectId: 1, LinkState: "synced", PinnedVersion: null, LocalOverrideJson: null, SyncedAt: "2026-04-01T14:30:00Z" },
                { Id: 2, SharedAssetId: 1, ProjectId: 2, LinkState: "pinned", PinnedVersion: "2.0.0", LocalOverrideJson: null, SyncedAt: "2026-03-28T10:00:00Z" },
                { Id: 3, SharedAssetId: 2, ProjectId: 1, LinkState: "synced", PinnedVersion: null, LocalOverrideJson: null, SyncedAt: "2026-03-20T09:00:00Z" },
                { Id: 4, SharedAssetId: 3, ProjectId: 3, LinkState: "detached", PinnedVersion: null, LocalOverrideJson: '{"steps":["summarize-v2"]}', SyncedAt: "2026-04-02T16:00:00Z" },
            ],
        },
        LIBRARY_GET_GROUPS: {
            groups: [
                { Id: 1, Name: "Production Sites", SharedSettingsJson: '{"autoSync":true}', CreatedAt: "2026-03-10T08:00:00Z" },
                { Id: 2, Name: "Testing", SharedSettingsJson: null, CreatedAt: "2026-03-15T12:00:00Z" },
            ],
        },
        LIBRARY_SYNC_ASSET: { syncedCount: 2, pinnedNotified: 1 },
        LIBRARY_PROMOTE_ASSET: { action: "created", assetId: 5 },
        LIBRARY_REPLACE_ASSET: { isOk: true, newVersion: "2.2.0" },
        LIBRARY_FORK_ASSET: { assetId: 6, slug: "summarize-article-fork" },
        LIBRARY_DELETE_ASSET: { isOk: true, detachedCount: 1 },
        LIBRARY_EXPORT: {
            bundle: {
                exportVersion: "1.0",
                exportedAt: new Date().toISOString(),
                assets: [],
                groups: [],
            },
        },
        LIBRARY_IMPORT: { imported: 3, skipped: 1, conflicts: [] },
    };

    return mocks[message.type] ?? { isOk: true };
}

/* ------------------------------------------------------------------ */
/*  Adapter                                                            */
/* ------------------------------------------------------------------ */

export const previewAdapter: PlatformAdapter = {
    target: "preview",

    async sendMessage<T>(message: MessagePayload): Promise<T> {
        return getMockResponse(message) as T;
    },

    storage: previewStorage,
    tabs: previewTabs,

    getExtensionUrl(path: string): string {
        return `/${path}`;
    },
};
