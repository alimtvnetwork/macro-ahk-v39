/**
 * Marco Extension — Dynamic Script Loading Handler
 *
 * Handles DYNAMIC_REQUIRE messages from page scripts via the SDK.
 * Validates project-level flags (allowDynamicRequests, isGlobal),
 * injects the requested script, and logs every attempt to SQLite.
 *
 * Flow:
 *   1. Script A calls `await RiseupAsiaMacroExt.require("ProjectB.scriptName")`
 *   2. SDK sends DYNAMIC_REQUIRE via postMessage → content relay → background
 *   3. This handler validates permissions, injects the target, resolves/rejects
 *   4. Every attempt is logged to SQLite logs.db
 *
 * @see .lovable/memory/architecture/dynamic-script-loading.md
 */

import type { MessageRequest } from "../../shared/messages";
import type { StoredProject, ScriptEntry } from "../../shared/project-types";
import { readAllProjects } from "./project-helpers";
import { injectWithCspFallback } from "../csp-fallback";
import { wrapWithIsolation } from "./injection-wrapper";
import { getLogsDb, markLoggingDirty } from "./logging-handler";
import { getFilesByProject } from "./file-storage-handler";
import { logCaughtError, BgLogTag} from "../bg-logger";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DynamicRequireMessage extends MessageRequest {
    /** Target script identifier, e.g. "XPath" or "Projects.SharedUtils" */
    target: string;
    /** Project ID of the requester */
    requesterProjectId: string;
    /** Tab ID where the script should be injected */
    tabId: number;
}

type RequireStatus = "loaded" | "denied" | "error" | "not_found";

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

/**
 * Handles a DYNAMIC_REQUIRE message.
 * Returns `{ isOk, namespace?, errorMessage? }`.
 */
// eslint-disable-next-line max-lines-per-function
export async function handleDynamicRequire(
    message: MessageRequest,
): Promise<{ isOk: boolean; namespace?: string; errorMessage?: string }> {
    const msg = message as DynamicRequireMessage;
    const { target, requesterProjectId, tabId } = msg;

    if (!target || !requesterProjectId || !tabId) {
        logDynamicLoad(requesterProjectId ?? "unknown", target ?? "unknown", "error", "Missing required fields");
        return { isOk: false, errorMessage: "DYNAMIC_REQUIRE: missing target, requesterProjectId, or tabId" };
    }

    const allProjects = await readAllProjects().catch(() => [] as StoredProject[]);

    // --- Resolve requester project ---
    const requester = allProjects.find((p) => p.id === requesterProjectId);
    if (!requester) {
        logDynamicLoad(requesterProjectId, target, "denied", "Requester project not found");
        return { isOk: false, errorMessage: `Requester project "${requesterProjectId}" not found` };
    }

    // --- Check allowDynamicRequests flag ---
    if (!requester.settings?.allowDynamicRequests) {
        logDynamicLoad(requesterProjectId, target, "denied", "allowDynamicRequests is disabled");
        return {
            isOk: false,
            errorMessage: `Project "${requester.name}" does not have allowDynamicRequests enabled`,
        };
    }

    // --- Resolve target project + script ---
    const resolved = resolveTarget(target, allProjects);
    if (!resolved) {
        logDynamicLoad(requesterProjectId, target, "not_found", "Target project or script not found");
        return { isOk: false, errorMessage: `Cannot resolve target "${target}"` };
    }

    const { project: targetProject, script: targetScript } = resolved;

    // --- Check isGlobal flag on target ---
    if (!targetProject.isGlobal && targetProject.id !== requesterProjectId) {
        logDynamicLoad(requesterProjectId, target, "denied", `Target project "${targetProject.name}" is not global`);
        return {
            isOk: false,
            errorMessage: `Project "${targetProject.name}" is not marked as global — cannot be dynamically loaded`,
        };
    }

    // --- Load script code ---
    try {
        const code = await loadScriptCode(targetProject.id, targetScript);
        if (!code) {
            logDynamicLoad(requesterProjectId, target, "error", "Script code is empty or not found");
            return { isOk: false, errorMessage: `Script code for "${target}" is empty or not found` };
        }

        const wrapped = wrapWithIsolation(code, targetScript.path, targetProject.id);

        await injectWithCspFallback(tabId, wrapped);

        const namespace = `RiseupAsiaMacroExt.Projects.${targetProject.codeName ?? targetProject.name}`;
        logDynamicLoad(requesterProjectId, target, "loaded", `Injected into tab ${tabId}`);

        console.log("[dynamic-require] ✅ %s → %s injected successfully", requester.name, target);
        return { isOk: true, namespace };
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logDynamicLoad(requesterProjectId, target, "error", errMsg);
        logCaughtError(BgLogTag.DYNAMIC_REQUIRE, `${requester.name} → ${target} failed`, err);
        return { isOk: false, errorMessage: errMsg };
    }
}

/* ------------------------------------------------------------------ */
/*  Target Resolution                                                  */
/* ------------------------------------------------------------------ */

/**
 * Resolves a target string like "XPath", "Projects.SharedUtils", or
 * "ProjectName.scriptName" to a project + script entry.
 */
function resolveTarget(
    target: string,
    allProjects: StoredProject[],
): { project: StoredProject; script: ScriptEntry } | null {
    // Strip "Projects." prefix if present
    const cleaned = target.startsWith("Projects.") ? target.slice(9) : target;

    // Try "ProjectName.scriptName" format
    const dotIdx = cleaned.indexOf(".");
    if (dotIdx > 0) {
        const projectPart = cleaned.slice(0, dotIdx);
        const scriptPart = cleaned.slice(dotIdx + 1);
        const project = findProject(projectPart, allProjects);
        if (project) {
            const script = project.scripts.find(
                (s) => s.path.includes(scriptPart) || s.description === scriptPart,
            );
            if (script) return { project, script };
        }
    }

    // Try matching just project name — return first script
    const project = findProject(cleaned, allProjects);
    if (project && project.scripts.length > 0) {
        return { project, script: project.scripts[0] };
    }

    return null;
}

/** Finds a project by codeName, name, or slug (case-insensitive). */
function findProject(name: string, projects: StoredProject[]): StoredProject | undefined {
    const lower = name.toLowerCase();
    return projects.find(
        (p) =>
            p.codeName?.toLowerCase() === lower ||
            p.name.toLowerCase() === lower ||
            p.slug?.toLowerCase() === lower,
    );
}

/* ------------------------------------------------------------------ */
/*  Script Code Loading                                                */
/* ------------------------------------------------------------------ */

/** Loads the script code from file storage or inline code. */
async function loadScriptCode(projectId: string, script: ScriptEntry): Promise<string | null> {
    // Prefer inline code if available
    if (script.code) return script.code;

    // Try loading from file storage
    try {
        const files = await getFilesByProject(projectId);
        const file = files.find((f: { path: string; content: string }) => f.path === script.path);
        return file?.content ?? null;
    } catch {
        return null;
    }
}

/* ------------------------------------------------------------------ */
/*  SQLite Logging                                                     */
/* ------------------------------------------------------------------ */

/** Logs a dynamic loading event to SQLite. */
function logDynamicLoad(
    requester: string,
    target: string,
    status: RequireStatus,
    detail: string,
): void {
    try {
        const db = getLogsDb();
        const now = new Date().toISOString();
        let version = "unknown";
        try {
            version = chrome.runtime.getManifest().version;
        } catch { /* allow-swallow: service worker context may lack manifest; "unknown" sentinel is the documented fallback */ }

        db.run(
            `INSERT INTO DynamicLoadLog (Timestamp, Requester, Target, Status, Detail, ExtVersion)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [now, requester, target, status, detail, version],
        );
        markLoggingDirty();
    } catch (err) {
        logCaughtError(BgLogTag.DYNAMIC_REQUIRE, "Failed to log dynamic load", err);
    }
}
