/**
 * Marco Extension — Message Router (Registry)
 *
 * Maps message types to handler functions. Separated from
 * the dispatch logic to stay under 200 lines per file.
 *
 * @see spec/05-chrome-extension/18-message-protocol.md — Message type definitions
 * @see src/shared/messages.ts — MessageType enum (source of truth)
 */

import { MessageType, type MessageRequest } from "../shared/messages";

import { buildStatusResponse } from "./status-handler";
import { buildHealthResponse } from "./health-handler";
import { buildAuthHealthResponse } from "./auth-health-handler";
import { getInaccessibleSeedTargets, getInaccessibleSeedCooldownMs } from "./handlers/token-seeder";
import { handleNetworkStatus, handleNetworkRequest, getRecentNetworkRequests, getNetworkStats, clearNetworkRequests } from "./network-handler";
import { buildApiEndpointsResponse, buildApiStatusResponse } from "./api-explorer-handler";
import { getRecentTrackedMessages } from "./message-tracker";

import {
    handleGetConfig,
    handleGetToken,
    handleRefreshToken,
} from "./handlers/config-auth-handler";

import {
    handleGetLogStats,
    handleGetRecentLogs,
    handleLogEntry,
    handleLogError,
    handleGetSessionLogs,
    handleGetSessionReport,
    handleBrowseOpfsSessions,
    handleGetOpfsStatus,
} from "./handlers/logging-handler";

import {
    handleExportLogsJson,
    handleExportLogsZip,
    handlePurgeLogs,
} from "./handlers/logging-export-handler";

import {
    handleDeleteProject,
    handleDuplicateProject,
    handleExportProject,
    handleGetActiveProject,
    handleGetAllProjects,
    handleImportProject,
    handleSaveProject,
    handleSetActiveProject,
    handleGetAutoAttachDecisions,
} from "./handlers/project-handler";


import {
    handleDeleteConfig,
    handleDeleteScript,
    handleGetAllConfigs,
    handleGetAllScripts,
    handleGetScriptConfig,
    handleOptionsBootstrap,
    handleSaveConfig,
    handleSaveScript,
    handleToggleScript,
} from "./handlers/script-config-handler";

import {
    handleGetTabInjections,
    handleInjectScripts,
} from "./handlers/injection-handler";

import { handleGetOpenLovableTabs } from "./handlers/open-tabs-handler";

import {
    handleGetLogDetail,
    handleGetStorageStats,
    handleQueryLogs,
} from "./handlers/storage-handler";

import {
    handleClearRecordedXPaths,
    handleGetRecordedXPaths,
    handleTestXPath,
    handleToggleXPathRecorder,
} from "./handlers/xpath-handler";

import { handleValidateAllXPaths } from "./handlers/xpath-validation-handler";

import {
    handleRecorderDataSourceAdd,
    handleRecorderDataSourceList,
} from "./handlers/recorder-data-source-handler";

import {
    handleRecorderFieldBindingUpsert,
    handleRecorderFieldBindingList,
    handleRecorderFieldBindingDelete,
} from "./handlers/recorder-field-binding-handler";

import {
    handleRecorderStepInsert,
    handleRecorderStepList,
    handleRecorderStepDelete,
    handleRecorderStepResolve,
    handleRecorderStepRename,
    handleRecorderStepSelectorsList,
    handleRecorderStepUpdateMeta,
    handleRecorderStepTagsSet,
    handleRecorderStepLinkSet,
} from "./handlers/recorder-step-handler";

import { handleRecorderCapturePersist, handleRecorderCapturePersistBatch } from "./handlers/recorder-capture-handler";

import {
    handleRecorderJsSnippetUpsert,
    handleRecorderJsSnippetList,
    handleRecorderJsSnippetDelete,
    handleRecorderJsStepDryRun,
} from "./handlers/recorder-js-handler";

import {
    handleGetActiveErrors,
    handleUserScriptError,
    handleClearErrors,
} from "./handlers/error-handler";

import { handleUserScriptLog } from "./handlers/user-script-log-handler";

import {
    handleDataSet,
    handleDataGet,
    handleDataDelete,
    handleDataKeys,
    handleDataGetAll,
    handleDataClear,
    handleGetDataStoreAll,
} from "./handlers/data-bridge-handler";

import {
    handleRecordCycleMetric,
    handleGetRunStats,
    handleClearRunStats,
} from "./handlers/run-stats-handler";

import {
    handleGetPrompts,
    handleSavePrompt,
    handleDeletePrompt,
    handleReorderPrompts,
    reseedPrompts,
} from "./handlers/prompt-handler";

import { cacheClearAll, cacheStats } from "./injection-cache";
import { handleDynamicRequire } from "./handlers/dynamic-require-handler";

import {
    handleGetPromptChains,
    handleSavePromptChain,
    handleDeletePromptChain,
    handleExecuteChainStep,
} from "./handlers/prompt-chain-handler";

import {
    handleGetSettings,
    handleSaveSettings,
    handleGetPromptVariables,
    handleSavePromptVariables,
} from "./handlers/settings-handler";

import {
    handleKvGet,
    handleKvSet,
    handleKvDelete,
    handleKvList,
} from "./handlers/kv-handler";

import {
    handleGkvGet,
    handleGkvSet,
    handleGkvDelete,
    handleGkvList,
    handleGkvClearGroup,
} from "./handlers/grouped-kv-handler";

import {
    handleFileSave,
    handleFileGet,
    handleFileList,
    handleFileDelete,
} from "./handlers/file-storage-handler";

import {
    handleStorageListTables,
    handleStorageGetSchema,
    handleStorageQueryTable,
    handleStorageUpdateRow,
    handleStorageDeleteRow,
    handleStorageClearTable,
    handleStorageClearAll,
    handleStorageReseed,
} from "./handlers/storage-browser-handler";

import {
    handleStorageSessionList,
    handleStorageSessionSet,
    handleStorageSessionDelete,
    handleStorageSessionClear,
    handleStorageCookiesList,
    handleStorageCookiesSet,
    handleStorageCookiesDelete,
    handleStorageCookiesClear,
} from "./handlers/storage-surfaces-handler";

import {
    handleListUpdaters,
    handleGetUpdater,
    handleCreateUpdater,
    handleDeleteUpdater,
    handleCheckForUpdate,
    handleGetUpdateSettings,
    handleSaveUpdateSettings,
} from "./handlers/updater-handler";

import {
    handleSdkAuthGetToken,
    handleSdkAuthGetSource,
    handleSdkAuthRefresh,
    handleSdkAuthIsExpired,
    handleSdkAuthGetJwt,
    handleSdkCookiesGet,
    handleSdkCookiesGetDetail,
    handleSdkCookiesGetAll,
    handleSdkConfigGet,
    handleSdkConfigGetAll,
    handleSdkConfigSet,
    handleSdkXPathGet,
    handleSdkXPathGetAll,
    handleSdkFileRead,
} from "./handlers/sdk-bridge-handler";

import { handleProjectApi } from "./handlers/project-api-handler";
import {
    handleProjectConfigRead,
    handleProjectConfigUpdate,
    handleProjectConfigReconstruct,
} from "./handlers/project-config-handler";

import {
    handleApplyJsonSchema,
    handleGenerateSchemaDocs,
} from "./handlers/schema-meta-handler";

import {
    handleGetAutomationChains,
    handleSaveAutomationChain,
    handleDeleteAutomationChain,
    handleToggleAutomationChain,
    handleImportAutomationChains,
} from "./handlers/automation-chain-handler";

import {
    handleGetScriptInfo,
    handleHotReloadScript,
} from "./handlers/script-info-handler";

import {
    handleGetSharedAssets,
    handleGetSharedAsset,
    handleSaveSharedAsset,
    handleDeleteSharedAsset,
    handleGetAssetLinks,
    handleSaveAssetLink,
    handleDeleteAssetLink,
    handleSyncLibraryAsset,
    handlePromoteAsset,
    handleReplaceLibraryAsset,
    handleForkLibraryAsset,
    handleGetProjectGroups,
    handleSaveProjectGroup,
    handleDeleteProjectGroup,
    handleGetGroupMembers,
    handleAddGroupMember,
    handleRemoveGroupMember,
    handleExportLibrary,
    handleImportLibrary,
    handleGetAssetVersions,
    handleRollbackAssetVersion,
    handleCascadeGroupSettings,
} from "./handlers/library-handler";

import {
    handleSdkSelfTestReport,
    handleGetSdkSelfTest,
} from "./handlers/sdk-selftest-handler";

/** Handler function that takes message and sender. */
export type MessageHandler = (
    message: MessageRequest,
    sender: chrome.runtime.MessageSender,
) => Promise<unknown>;

/** Broadcast-only types that need no processing. */
export const BROADCAST_TYPES = new Set<MessageType>([
    MessageType.INJECTION_RESULT,
    MessageType.LOGGING_DEGRADED,
    MessageType.STORAGE_FULL,
    MessageType.CONFIG_UPDATED,
    MessageType.CONFIG_CHANGED,
    MessageType.TOKEN_EXPIRED,
    MessageType.TOKEN_UPDATED,
]);

function getProjectIdHint(message: MessageRequest): string | undefined {
    const maybeProjectId = (message as Record<string, string | undefined>).projectId;
    return typeof maybeProjectId === "string" && maybeProjectId.length > 0
        ? maybeProjectId
        : undefined;
}

function getTabUrlHint(
    message: MessageRequest,
    sender: chrome.runtime.MessageSender,
): string | undefined {
    const senderUrl = sender.tab?.url;
    if (typeof senderUrl === "string" && senderUrl.length > 0) {
        return senderUrl;
    }

    const maybeTabUrl = (message as Record<string, string | undefined>).tabUrl;
    if (typeof maybeTabUrl === "string" && maybeTabUrl.length > 0) {
        return maybeTabUrl;
    }

    const maybePageUrl = (message as Record<string, string | undefined>).pageUrl;
    return typeof maybePageUrl === "string" && maybePageUrl.length > 0
        ? maybePageUrl
        : undefined;
}

/** Registry mapping each message type to its handler. */
export const HANDLER_REGISTRY = new Map<MessageType, MessageHandler>([
    [MessageType.GET_CONFIG, async () => handleGetConfig()],
    [MessageType.GET_TOKEN, async (msg, sender) => handleGetToken(
        getProjectIdHint(msg),
        getTabUrlHint(msg, sender),
    )],
    [MessageType.REFRESH_TOKEN, async (msg, sender) => handleRefreshToken(
        getProjectIdHint(msg),
        getTabUrlHint(msg, sender),
    )],
    [MessageType.LOG_ENTRY, async (msg) => handleLogEntry(msg)],
    [MessageType.LOG_ERROR, async (msg) => handleLogError(msg)],
    [MessageType.GET_RECENT_LOGS, async (msg) => handleGetRecentLogs(msg)],
    [MessageType.GET_LOG_STATS, async () => handleGetLogStats()],
    [MessageType.PURGE_LOGS, async (msg) => handlePurgeLogs(msg)],
    [MessageType.EXPORT_LOGS_JSON, async () => handleExportLogsJson()],
    [MessageType.EXPORT_LOGS_ZIP, async () => handleExportLogsZip()],
    [MessageType.GET_ACTIVE_PROJECT, async (_msg, sender) => handleGetActiveProject(sender)],
    [MessageType.SET_ACTIVE_PROJECT, async (msg, sender) => handleSetActiveProject(msg, sender)],
    [MessageType.GET_ALL_PROJECTS, async () => handleGetAllProjects()],
    [MessageType.SAVE_PROJECT, async (msg) => handleSaveProject(msg)],
    [MessageType.DELETE_PROJECT, async (msg) => handleDeleteProject(msg)],
    [MessageType.DUPLICATE_PROJECT, async (msg) => handleDuplicateProject(msg)],
    [MessageType.IMPORT_PROJECT, async (msg) => handleImportProject(msg)],
    [MessageType.EXPORT_PROJECT, async (msg) => handleExportProject(msg)],
    [MessageType.GET_AUTO_ATTACH_DECISIONS, async (msg) => handleGetAutoAttachDecisions(msg)],
    [MessageType.GET_ALL_SCRIPTS, async () => handleGetAllScripts()],
    [MessageType.SAVE_SCRIPT, async (msg) => handleSaveScript(msg)],
    [MessageType.DELETE_SCRIPT, async (msg) => handleDeleteScript(msg)],
    [MessageType.TOGGLE_SCRIPT, async (msg) => handleToggleScript(msg)],
    [MessageType.GET_ALL_CONFIGS, async () => handleGetAllConfigs()],
    [MessageType.SAVE_CONFIG, async (msg) => handleSaveConfig(msg)],
    [MessageType.DELETE_CONFIG, async (msg) => handleDeleteConfig(msg)],
    [MessageType.GET_SCRIPT_CONFIG, async (msg) => handleGetScriptConfig(msg)],
    [MessageType.GET_OPTIONS_BOOTSTRAP, async () => handleOptionsBootstrap()],
    [MessageType.INJECT_SCRIPTS, async (msg) => handleInjectScripts(msg)],
    [MessageType.GET_TAB_INJECTIONS, async (msg) => handleGetTabInjections(msg)],
    [MessageType.GET_OPEN_LOVABLE_TABS, async () => handleGetOpenLovableTabs()],
    [MessageType.GET_STATUS, async () => buildStatusResponse()],
    [MessageType.GET_HEALTH_STATUS, async () => buildHealthResponse()],
    [MessageType.GET_AUTH_HEALTH, async () => buildAuthHealthResponse()],
    [MessageType.GET_TOKEN_SEEDER_DIAGNOSTICS, async () => ({
        targets: getInaccessibleSeedTargets(),
        cooldownMs: getInaccessibleSeedCooldownMs(),
        capturedAt: new Date().toISOString(),
    })],
    [MessageType.GET_API_STATUS, async () => buildApiStatusResponse()],
    [MessageType.GET_API_ENDPOINTS, async () => buildApiEndpointsResponse()],
    [MessageType.GET_ACTIVE_ERRORS, async () => handleGetActiveErrors()],
    [MessageType.CLEAR_ERRORS, async () => handleClearErrors()],
    [MessageType.NETWORK_STATUS, async (msg) => handleNetworkStatus(msg)],
    [MessageType.NETWORK_REQUEST, async (msg) => handleNetworkRequest(msg)],
    [MessageType.GET_NETWORK_REQUESTS, async () => ({ requests: getRecentNetworkRequests() })],
    [MessageType.GET_NETWORK_STATS, async () => getNetworkStats()],
    [MessageType.CLEAR_NETWORK_REQUESTS, async () => { clearNetworkRequests(); return { isOk: true }; }],
    [MessageType.GET_STORAGE_STATS, async () => handleGetStorageStats()],
    [MessageType.QUERY_LOGS, async (msg) => handleQueryLogs(msg)],
    [MessageType.GET_LOG_DETAIL, async (msg) => handleGetLogDetail(msg)],
    [MessageType.TOGGLE_XPATH_RECORDER, async (msg, sender) => handleToggleXPathRecorder(msg, sender)],
    [MessageType.GET_RECORDED_XPATHS, async (msg, sender) => handleGetRecordedXPaths(msg, sender)],
    [MessageType.CLEAR_RECORDED_XPATHS, async (msg, sender) => handleClearRecordedXPaths(msg, sender)],
    [MessageType.TEST_XPATH, async (msg) => handleTestXPath(msg)],
    [MessageType.VALIDATE_ALL_XPATHS, async (msg) => handleValidateAllXPaths(msg)],
    [MessageType.RECORDER_DATA_SOURCE_ADD, async (msg) => handleRecorderDataSourceAdd(msg)],
    [MessageType.RECORDER_DATA_SOURCE_LIST, async (msg) => handleRecorderDataSourceList(msg)],
    [MessageType.RECORDER_FIELD_BINDING_UPSERT, async (msg) => handleRecorderFieldBindingUpsert(msg)],
    [MessageType.RECORDER_FIELD_BINDING_LIST, async (msg) => handleRecorderFieldBindingList(msg)],
    [MessageType.RECORDER_FIELD_BINDING_DELETE, async (msg) => handleRecorderFieldBindingDelete(msg)],
    [MessageType.RECORDER_CAPTURE_PERSIST, async (msg) => handleRecorderCapturePersist(msg)],
    [MessageType.RECORDER_CAPTURE_PERSIST_BATCH, async (msg) => handleRecorderCapturePersistBatch(msg)],
    [MessageType.RECORDER_STEP_INSERT, async (msg) => handleRecorderStepInsert(msg)],
    [MessageType.RECORDER_STEP_LIST, async (msg) => handleRecorderStepList(msg)],
    [MessageType.RECORDER_STEP_DELETE, async (msg) => handleRecorderStepDelete(msg)],
    [MessageType.RECORDER_STEP_RESOLVE, async (msg) => handleRecorderStepResolve(msg)],
    [MessageType.RECORDER_STEP_RENAME, async (msg) => handleRecorderStepRename(msg)],
    [MessageType.RECORDER_STEP_SELECTORS_LIST, async (msg) => handleRecorderStepSelectorsList(msg)],
    [MessageType.RECORDER_STEP_UPDATE_META, async (msg) => handleRecorderStepUpdateMeta(msg)],
    [MessageType.RECORDER_STEP_TAGS_SET, async (msg) => handleRecorderStepTagsSet(msg)],
    [MessageType.RECORDER_STEP_LINK_SET, async (msg) => handleRecorderStepLinkSet(msg)],
    [MessageType.RECORDER_JS_SNIPPET_UPSERT, async (msg) => handleRecorderJsSnippetUpsert(msg)],
    [MessageType.RECORDER_JS_SNIPPET_LIST, async (msg) => handleRecorderJsSnippetList(msg)],
    [MessageType.RECORDER_JS_SNIPPET_DELETE, async (msg) => handleRecorderJsSnippetDelete(msg)],
    [MessageType.RECORDER_JS_STEP_DRYRUN, async (msg) => handleRecorderJsStepDryRun(msg)],
    [MessageType.USER_SCRIPT_ERROR, async (msg) => handleUserScriptError(msg)],
    [MessageType.USER_SCRIPT_LOG, async (msg) => handleUserScriptLog(msg)],
    [MessageType.USER_SCRIPT_DATA_SET, async (msg) => handleDataSet(msg)],
    [MessageType.USER_SCRIPT_DATA_GET, async (msg) => handleDataGet(msg)],
    [MessageType.USER_SCRIPT_DATA_DELETE, async (msg) => handleDataDelete(msg)],
    [MessageType.USER_SCRIPT_DATA_KEYS, async (msg) => handleDataKeys(msg)],
    [MessageType.USER_SCRIPT_DATA_GET_ALL, async (msg) => handleDataGetAll(msg)],
    [MessageType.USER_SCRIPT_DATA_CLEAR, async (msg) => handleDataClear(msg)],
    [MessageType.GET_DATA_STORE_ALL, async () => handleGetDataStoreAll()],
    [MessageType.RECORD_CYCLE_METRIC, async (msg) => handleRecordCycleMetric(msg)],
    [MessageType.GET_RUN_STATS, async () => handleGetRunStats()],
    [MessageType.CLEAR_RUN_STATS, async () => handleClearRunStats()],
    [MessageType.GET_PROMPTS, async () => handleGetPrompts()],
    [MessageType.SAVE_PROMPT, async (msg) => handleSavePrompt(msg)],
    [MessageType.DELETE_PROMPT, async (msg) => handleDeletePrompt(msg)],
    [MessageType.REORDER_PROMPTS, async (msg) => handleReorderPrompts(msg)],
    [MessageType.RESEED_PROMPTS, async () => { await reseedPrompts(); return { isOk: true }; }],
    [MessageType.GET_PROMPT_CHAINS, async () => handleGetPromptChains()],
    [MessageType.SAVE_PROMPT_CHAIN, async (msg) => handleSavePromptChain(msg)],
    [MessageType.DELETE_PROMPT_CHAIN, async (msg) => handleDeletePromptChain(msg)],
    [MessageType.EXECUTE_CHAIN_STEP, async (msg) => handleExecuteChainStep(msg)],
    [MessageType.GET_RECENT_MESSAGES, async (msg) => {
        const limit = (msg as Record<string, unknown>).limit as number ?? 10;
        return { messages: getRecentTrackedMessages(limit) };
    }],
    [MessageType.GET_SESSION_LOGS, async () => handleGetSessionLogs()],
    [MessageType.GET_SESSION_REPORT, async (msg) => handleGetSessionReport(msg)],
    [MessageType.BROWSE_OPFS_SESSIONS, async () => handleBrowseOpfsSessions()],
    [MessageType.GET_OPFS_STATUS, async () => handleGetOpfsStatus()],
    [MessageType.GET_SETTINGS, async () => handleGetSettings()],
    [MessageType.SAVE_SETTINGS, async (msg) => handleSaveSettings(msg)],
    [MessageType.GET_PROMPT_VARIABLES, async () => handleGetPromptVariables()],
    [MessageType.SAVE_PROMPT_VARIABLES, async (msg) => handleSavePromptVariables(msg)],
    [MessageType.KV_GET, async (msg) => handleKvGet(msg)],
    [MessageType.KV_SET, async (msg) => handleKvSet(msg)],
    [MessageType.KV_DELETE, async (msg) => handleKvDelete(msg)],
    [MessageType.KV_LIST, async (msg) => handleKvList(msg)],
    [MessageType.GKV_GET, async (msg) => handleGkvGet(msg)],
    [MessageType.GKV_SET, async (msg) => handleGkvSet(msg)],
    [MessageType.GKV_DELETE, async (msg) => handleGkvDelete(msg)],
    [MessageType.GKV_LIST, async (msg) => handleGkvList(msg)],
    [MessageType.GKV_CLEAR_GROUP, async (msg) => handleGkvClearGroup(msg)],
    [MessageType.FILE_SAVE, async (msg) => handleFileSave(msg)],
    [MessageType.FILE_GET, async (msg) => handleFileGet(msg)],
    [MessageType.FILE_LIST, async (msg) => handleFileList(msg)],
    [MessageType.FILE_DELETE, async (msg) => handleFileDelete(msg)],
    [MessageType.STORAGE_LIST_TABLES, async () => handleStorageListTables()],
    [MessageType.STORAGE_GET_SCHEMA, async (msg) => handleStorageGetSchema(msg)],
    [MessageType.STORAGE_QUERY_TABLE, async (msg) => handleStorageQueryTable(msg)],
    [MessageType.STORAGE_UPDATE_ROW, async (msg) => handleStorageUpdateRow(msg)],
    [MessageType.STORAGE_DELETE_ROW, async (msg) => handleStorageDeleteRow(msg)],
    [MessageType.STORAGE_CLEAR_TABLE, async (msg) => handleStorageClearTable(msg)],
    [MessageType.STORAGE_CLEAR_ALL, async () => handleStorageClearAll()],
    [MessageType.STORAGE_RESEED, async () => handleStorageReseed()],
    [MessageType.STORAGE_SESSION_LIST, async (msg) => handleStorageSessionList(msg)],
    [MessageType.STORAGE_SESSION_SET, async (msg) => handleStorageSessionSet(msg)],
    [MessageType.STORAGE_SESSION_DELETE, async (msg) => handleStorageSessionDelete(msg)],
    [MessageType.STORAGE_SESSION_CLEAR, async (msg) => handleStorageSessionClear(msg)],
    [MessageType.STORAGE_COOKIES_LIST, async (msg) => handleStorageCookiesList(msg)],
    [MessageType.STORAGE_COOKIES_SET, async (msg) => handleStorageCookiesSet(msg)],
    [MessageType.STORAGE_COOKIES_DELETE, async (msg) => handleStorageCookiesDelete(msg)],
    [MessageType.STORAGE_COOKIES_CLEAR, async (msg) => handleStorageCookiesClear(msg)],
    // ─── Updater (Spec 58) ───
    [MessageType.LIST_UPDATERS, async () => ({ updaters: handleListUpdaters() })],
    [MessageType.GET_UPDATER, async (msg) => ({ updater: handleGetUpdater((msg as Record<string, unknown>).updaterId as number) })],
    [MessageType.CREATE_UPDATER, async (msg) => ({ updaterId: handleCreateUpdater((msg as Record<string, unknown>).data as Record<string, unknown>) })],
    [MessageType.DELETE_UPDATER, async (msg) => { handleDeleteUpdater((msg as Record<string, unknown>).updaterId as number); return { isOk: true }; }],
    [MessageType.CHECK_FOR_UPDATE, async (msg) => handleCheckForUpdate((msg as Record<string, unknown>).updaterId as number)],
    [MessageType.GET_UPDATE_SETTINGS, async () => ({ settings: handleGetUpdateSettings() })],
    [MessageType.SAVE_UPDATE_SETTINGS, async (msg) => { handleSaveUpdateSettings((msg as Record<string, unknown>).data as Record<string, unknown>); return { isOk: true }; }],
    // ─── SDK Bridge (marco.*) ───
    [MessageType.AUTH_GET_TOKEN, async () => handleSdkAuthGetToken()],
    [MessageType.AUTH_GET_SOURCE, async () => handleSdkAuthGetSource()],
    [MessageType.AUTH_REFRESH, async () => handleSdkAuthRefresh()],
    [MessageType.AUTH_IS_EXPIRED, async () => handleSdkAuthIsExpired()],
    [MessageType.AUTH_GET_JWT, async () => handleSdkAuthGetJwt()],
    [MessageType.COOKIES_GET, async (msg) => handleSdkCookiesGet(msg)],
    [MessageType.COOKIES_GET_DETAIL, async (msg) => handleSdkCookiesGetDetail(msg)],
    [MessageType.COOKIES_GET_ALL, async (msg) => handleSdkCookiesGetAll(msg)],
    [MessageType.CONFIG_GET, async () => handleSdkConfigGet()],
    [MessageType.CONFIG_GET_ALL, async () => handleSdkConfigGetAll()],
    [MessageType.CONFIG_SET, async (msg) => handleSdkConfigSet(msg)],
    [MessageType.XPATH_GET, async (msg, sender) => handleSdkXPathGet(msg, sender)],
    [MessageType.XPATH_GET_ALL, async (msg, sender) => handleSdkXPathGetAll(msg, sender)],
    [MessageType.FILE_READ, async (msg) => handleSdkFileRead(msg)],
    // ─── Project Database API (Spec 67) ───
    [MessageType.PROJECT_API, async (msg) => handleProjectApi(msg)],
    [MessageType.PROJECT_DB_CREATE_TABLE, async (msg) => handleProjectApi({ ...msg as object, method: "SCHEMA", endpoint: "createTable" })],
    [MessageType.PROJECT_DB_DROP_TABLE, async (msg) => handleProjectApi({ ...msg as object, method: "SCHEMA", endpoint: "dropTable" })],
    [MessageType.PROJECT_DB_LIST_TABLES, async (msg) => handleProjectApi({ ...msg as object, method: "SCHEMA", endpoint: "listTables" })],
    // ─── Project Config DB (Issue 85) ───
    [MessageType.PROJECT_CONFIG_READ, async (msg) => handleProjectConfigRead(msg)],
    [MessageType.PROJECT_CONFIG_UPDATE, async (msg) => handleProjectConfigUpdate(msg)],
    [MessageType.PROJECT_CONFIG_RECONSTRUCT, async (msg) => handleProjectConfigReconstruct(msg)],
    // ─── Script Hot-Reload (Issue 77) ───
    [MessageType.GET_SCRIPT_INFO, async (msg) => handleGetScriptInfo(msg)],
    [MessageType.HOT_RELOAD_SCRIPT, async (msg) => handleHotReloadScript(msg)],
    // ─── Schema Meta Engine (Issue 85) ───
    [MessageType.APPLY_JSON_SCHEMA, async (msg) => handleApplyJsonSchema(msg)],
    [MessageType.GENERATE_SCHEMA_DOCS, async (msg) => handleGenerateSchemaDocs(msg)],
    // ─── Automation Chains (Spec 21) ───
    [MessageType.GET_AUTOMATION_CHAINS, async (msg) => handleGetAutomationChains(msg)],
    [MessageType.SAVE_AUTOMATION_CHAIN, async (msg) => handleSaveAutomationChain(msg)],
    [MessageType.DELETE_AUTOMATION_CHAIN, async (msg) => handleDeleteAutomationChain(msg)],
    [MessageType.TOGGLE_AUTOMATION_CHAIN, async (msg) => handleToggleAutomationChain(msg)],
    [MessageType.IMPORT_AUTOMATION_CHAINS, async (msg) => handleImportAutomationChains(msg)],
    // ─── Cache Management (Issue 88) ───
    [MessageType.INVALIDATE_CACHE, async () => {
        const result = await cacheClearAll();
        return { isOk: true, cleared: result.cleared };
    }],
    [MessageType.GET_CACHE_STATS, async () => {
        const stats = await cacheStats();
        return { isOk: true, ...stats };
    }],
    // ─── Dynamic Script Loading ───
    [MessageType.DYNAMIC_REQUIRE, async (msg) => {
        return handleDynamicRequire(msg);
    }],
    // ─── Cross-Project Sync (Spec 13) ───
    [MessageType.LIBRARY_GET_ASSETS, async (msg) => handleGetSharedAssets(msg)],
    [MessageType.LIBRARY_GET_ASSET, async (msg) => handleGetSharedAsset(msg)],
    [MessageType.LIBRARY_SAVE_ASSET, async (msg) => handleSaveSharedAsset(msg)],
    [MessageType.LIBRARY_DELETE_ASSET, async (msg) => handleDeleteSharedAsset(msg)],
    [MessageType.LIBRARY_GET_LINKS, async (msg) => handleGetAssetLinks(msg)],
    [MessageType.LIBRARY_SAVE_LINK, async (msg) => handleSaveAssetLink(msg)],
    [MessageType.LIBRARY_DELETE_LINK, async (msg) => handleDeleteAssetLink(msg)],
    [MessageType.LIBRARY_SYNC_ASSET, async (msg) => handleSyncLibraryAsset(msg)],
    [MessageType.LIBRARY_PROMOTE_ASSET, async (msg) => handlePromoteAsset(msg)],
    [MessageType.LIBRARY_REPLACE_ASSET, async (msg) => handleReplaceLibraryAsset(msg)],
    [MessageType.LIBRARY_FORK_ASSET, async (msg) => handleForkLibraryAsset(msg)],
    [MessageType.LIBRARY_GET_GROUPS, async () => handleGetProjectGroups()],
    [MessageType.LIBRARY_SAVE_GROUP, async (msg) => handleSaveProjectGroup(msg)],
    [MessageType.LIBRARY_DELETE_GROUP, async (msg) => handleDeleteProjectGroup(msg)],
    [MessageType.LIBRARY_GET_GROUP_MEMBERS, async (msg) => handleGetGroupMembers(msg)],
    [MessageType.LIBRARY_ADD_GROUP_MEMBER, async (msg) => handleAddGroupMember(msg)],
    [MessageType.LIBRARY_REMOVE_GROUP_MEMBER, async (msg) => handleRemoveGroupMember(msg)],
    [MessageType.LIBRARY_EXPORT, async () => handleExportLibrary()],
    [MessageType.LIBRARY_IMPORT, async (msg) => handleImportLibrary(msg)],
    [MessageType.LIBRARY_GET_VERSIONS, async (msg) => handleGetAssetVersions(msg)],
    [MessageType.LIBRARY_ROLLBACK_VERSION, async (msg) => handleRollbackAssetVersion(msg)],
    [MessageType.LIBRARY_CASCADE_GROUP_SETTINGS, async (msg) => handleCascadeGroupSettings(msg)],
    // ─── SDK Self-Test (Popup ✅/❌ panel) ───
    [MessageType.SDK_SELFTEST_REPORT, async (msg) => handleSdkSelfTestReport(msg)],
    [MessageType.GET_SDK_SELFTEST, async () => handleGetSdkSelfTest()],
]);
