/**
 * Marco Extension — Project Handler
 *
 * Handles project CRUD operations with chrome.storage.local.
 *
 * @see spec/05-chrome-extension/12-project-model-and-url-rules.md — Project model & URL matching
 * @see spec/05-chrome-extension/13-script-and-config-management.md — Script & config management
 * @see .lovable/memory/architecture/project-scoped-database.md — Project-scoped DB architecture
 */

import type { MessageRequest, OkResponse } from "../../shared/messages";
import { logCaughtError, BgLogTag} from "../bg-logger";
import type { StoredProject } from "../../shared/project-types";
import { rebuildNamespaceCache } from "../namespace-cache";
import { slugify, toCodeName } from "../../lib/slug-utils";
import type { StoredScript } from "../../shared/script-config-types";
import { STORAGE_KEY_ACTIVE_PROJECT, STORAGE_KEY_ALL_SCRIPTS, STORAGE_KEY_ALL_CONFIGS } from "../../shared/constants";
import { setActiveProjectId } from "../state-manager";
import { ensureDefaultProjectSingleScript } from "../default-project-seeder";
import { initProjectDb } from "../project-db-manager";
import { seedConfigToDb } from "../config-seeder";
import { ensureBuiltinScriptsExist } from "../builtin-script-guard";
import {
    generateId,
    nowTimestamp,
    readActiveProjectId,
    readAllProjects,
    writeAllProjects,
} from "./project-helpers";
import { buildInjectedScriptStatus } from "./project-injection-status";

export {
    handleDuplicateProject,
    handleExportProject,
    handleImportProject,
} from "./project-export-handler";

/* ------------------------------------------------------------------ */
/*  Script state helpers                                               */
/* ------------------------------------------------------------------ */

type ScriptStateMap = Record<string, { id: string; isEnabled: boolean }>;

/** Builds a popup-facing map of script IDs and enabled flags by project path. */
async function buildProjectScriptState(
    project: StoredProject | null,
): Promise<ScriptStateMap> {
    if (project === null) {
        return {};
    }

    const storedScripts = await readStoredScripts();
    const state: ScriptStateMap = {};

    for (const entry of project.scripts) {
        const matched = findStoredScriptByProjectPath(storedScripts, entry.path);

        if (matched !== null) {
            state[entry.path] = {
                id: matched.id,
                isEnabled: matched.isEnabled !== false,
            };
        }
    }

    return state;
}

/** Reads all stored scripts from local storage. */
async function readStoredScripts(): Promise<StoredScript[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY_ALL_SCRIPTS);
    const scripts = result[STORAGE_KEY_ALL_SCRIPTS];
    return Array.isArray(scripts) ? scripts : [];
}

/** Finds the stored script that corresponds to a project script path. */
function findStoredScriptByProjectPath(
    scripts: StoredScript[],
    projectPath: string,
): StoredScript | null {
    const direct = scripts.find((script) => script.name === projectPath);

    if (direct !== undefined) {
        return direct;
    }

    const normalizedPath = normalizeScriptKey(projectPath);
    const normalized = scripts.find((script) => normalizeScriptKey(script.name) === normalizedPath);

    return normalized ?? null;
}

/** Normalizes a script path for robust filename-only matching. */
function normalizeScriptKey(path: string): string {
    const normalized = path.trim().toLowerCase().replace(/\\/g, "/");
    const fileName = normalized.split("/").pop() ?? normalized;
    return fileName.split(/[?#]/)[0] ?? fileName;
}

/** Sorts project options so runnable (non-global) projects appear first. */
function sortProjectOptions(projects: StoredProject[]): StoredProject[] {
    return [...projects].sort((a, b) => {
        const aGlobal = a.isGlobal === true ? 1 : 0;
        const bGlobal = b.isGlobal === true ? 1 : 0;
        if (aGlobal !== bGlobal) return aGlobal - bGlobal;
        return a.name.localeCompare(b.name);
    });
}

/** Chooses the preferred active project, avoiding global SDK projects only for auto-fallback. */
function selectPreferredActiveProject(
    projects: StoredProject[],
    activeId: string | null,
): { activeProject: StoredProject | null; nextActiveId: string | null } {
    // If user explicitly set an active project, honour it even if global
    if (activeId) {
        const explicit = projects.find((project) => project.id === activeId);
        if (explicit) {
            return { activeProject: explicit, nextActiveId: activeId };
        }
    }

    // Auto-fallback: prefer non-global projects
    const runnableProjects = projects.filter((project) => project.isGlobal !== true);
    const candidates = runnableProjects.length > 0 ? runnableProjects : projects;
    const activeProject = candidates[0] ?? null;

    return {
        activeProject,
        nextActiveId: activeProject?.id ?? null,
    };
}

/* ------------------------------------------------------------------ */
/*  Public handlers                                                    */
/* ------------------------------------------------------------------ */

/** Returns the active project for the current tab. */
export async function handleGetActiveProject(
    sender: chrome.runtime.MessageSender,
): Promise<unknown> {
    const activeId = await readActiveProjectId();
    await ensureDefaultProjectSingleScript();
    const projects = await readAllProjects();
    // Auto-reseed if any built-in scripts are missing from the store
    await ensureBuiltinScriptsExist(projects);
    const { activeProject, nextActiveId } = selectPreferredActiveProject(projects, activeId);
    const [injectedScripts, scriptStates] = await Promise.all([
        buildInjectedScriptStatus(activeProject),
        buildProjectScriptState(activeProject),
    ]);

    if (nextActiveId !== null && nextActiveId !== activeId) {
        await chrome.storage.local.set({
            [STORAGE_KEY_ACTIVE_PROJECT]: nextActiveId,
        });
        setActiveProjectId(nextActiveId);
    }

    return {
        activeProject,
        matchedRule: null,
        allProjects: sortProjectOptions(projects),
        injectedScripts,
        scriptStates,
    };
}

/** Sets the active project by ID. */
export async function handleSetActiveProject(
    message: MessageRequest,
    sender: chrome.runtime.MessageSender,
): Promise<unknown> {
    const { projectId } = message as { projectId: string };

    await chrome.storage.local.set({
        [STORAGE_KEY_ACTIVE_PROJECT]: projectId,
    });
    setActiveProjectId(projectId);

    return { matchedRule: null, injectedScripts: {} };
}

/** Returns all stored projects. */
export async function handleGetAllProjects(): Promise<{
    projects: StoredProject[];
}> {
    await ensureDefaultProjectSingleScript();
    const projects = await readAllProjects();
    return { projects: sortProjectOptions(projects) };
}

/** Creates or updates a project. */
export async function handleSaveProject(
    message: MessageRequest,
): Promise<OkResponse & { project: StoredProject }> {
    const { project } = message as { project: StoredProject };
    const projects = await readAllProjects();
    const wasNew = !projects.some((p) => p.id === project.id);

    // Phase 2a: heal script bindings (path → canonical StoredScript.name)
    // before persisting so the next read of project.scripts in the UI lines
    // up with availableScripts and "not available" rows disappear.
    // No error swallowing — unresolved paths are logged via Logger.error.
    const healed = await healProjectScriptBindings(project);

    const saved = upsertProject(projects, healed);
    await writeAllProjects(projects);

    // ✅ 15.8: Rebuild namespace cache on save (fire-and-forget)
    rebuildNamespaceCache(saved).catch((err) =>
        logCaughtError(BgLogTag.NS_CACHE, `rebuildNamespaceCache failed for project "${saved.id}" after save — namespace cache may be stale until next rebuild`, err),
    );

    // ✅ Seed bound configs into project SQLite DB (moved off injection hot path)
    seedBoundConfigs(saved).catch((e) =>
        logCaughtError(BgLogTag.PROJECT_SAVE_CONFIG_SEED, "Config seeding failed", e),
    );

    // ✅ Provision per-project DB on first creation so the recorder schema
    //    (DataSource/Step/Selector/FieldBinding + lookups) is migrated
    //    immediately. initProjectDb is idempotent — safe to call again on
    //    updates, but we only invoke on first save to avoid needless work.
    //    See spec/31-macro-recorder/04-per-project-db-provisioning.md
    if (wasNew) {
        initProjectDb(saved.slug).catch((e) =>
            logCaughtError(BgLogTag.PROJECT_SAVE_CONFIG_SEED, "Recorder DB provisioning failed", e),
        );
    }

    return { isOk: true, project: saved };
}

/**
 * Rewrites each `project.scripts[].path` to the canonical `StoredScript.name`
 * when a basename/case-insensitive match exists. Unresolved entries are
 * preserved as-is and logged via `logCaughtError` so the diagnostics export
 * captures them — never silently dropped.
 *
 * @see .lovable/plan.md "Phase 2 — Fix bindings + auto-attach"
 */
async function healProjectScriptBindings(project: StoredProject): Promise<StoredProject> {
    const entries = project.scripts ?? [];
    if (entries.length === 0) {
        return project;
    }

    let storedScripts: StoredScript[];
    try {
        storedScripts = await readStoredScripts();
    } catch (caught) {
        logCaughtError(
            BgLogTag.PROJECT_SAVE_CONFIG_SEED,
            `healProjectScriptBindings: failed to read stored scripts for project "${project.id}" — bindings left as-is`,
            caught,
        );
        throw caught;
    }

    const healedScripts = entries.map((entry) => {
        const matched = findStoredScriptByProjectPath(storedScripts, entry.path);
        if (matched === null) {
            logCaughtError(
                BgLogTag.PROJECT_SAVE_CONFIG_SEED,
                `healProjectScriptBindings: project "${project.id}" references script path "${entry.path}" but no StoredScript.name matches — library names: [${storedScripts.map((s) => s.name).join(", ")}]`,
                new Error("UnboundProjectScriptPath"),
            );
            return entry;
        }
        if (matched.name === entry.path) {
            return entry;
        }
        return { ...entry, path: matched.name };
    });

    return { ...project, scripts: healedScripts };
}

/** Auto-derives slug and codeName from project name if not already set. */
function ensureDerivedIdentifiers(project: StoredProject): StoredProject {
    const slug = project.slug || slugify(project.name);
    const codeName = project.codeName || toCodeName(slug);
    return { ...project, slug, codeName };
}

/** Inserts or replaces a project in the list, returns saved record. */
function upsertProject(
    projects: StoredProject[],
    project: StoredProject,
): StoredProject {
    const now = nowTimestamp();
    const enriched = ensureDerivedIdentifiers(project);
    const existingIndex = projects.findIndex((p) => p.id === enriched.id);
    const isExisting = existingIndex >= 0;

    if (isExisting) {
        const updated = { ...enriched, updatedAt: now };
        projects[existingIndex] = updated;
        return updated;
    }

    const created: StoredProject = {
        ...enriched,
        id: enriched.id || generateId(),
        createdAt: now,
        updatedAt: now,
    };

    projects.push(created);
    return created;
}

/** Deletes a project and clears active if it matches. */
export async function handleDeleteProject(
    message: MessageRequest,
): Promise<OkResponse> {
    const { projectId } = message as { projectId: string };
    const projects = await readAllProjects();
    const filtered = projects.filter((p) => p.id !== projectId);

    await writeAllProjects(filtered);
    await clearActiveIfDeleted(projectId);

    return { isOk: true };
}

/** Clears active project if the deleted ID was active. */
async function clearActiveIfDeleted(
    deletedId: string,
): Promise<void> {
    const activeId = await readActiveProjectId();
    const isActiveDeleted = activeId === deletedId;

    if (isActiveDeleted) {
        await chrome.storage.local.remove(STORAGE_KEY_ACTIVE_PROJECT);
    }
}

/* ------------------------------------------------------------------ */
/*  Config Seeding (background, off injection hot path)                */
/* ------------------------------------------------------------------ */

/**
 * Seeds bound config.json files into the project's SQLite DB.
 * Uses hash-based change detection to skip unchanged configs.
 * @see .lovable/memory/features/projects/configuration-seeding.md
 */
async function seedBoundConfigs(project: StoredProject): Promise<void> {
    const projectScripts = project.scripts ?? [];
    const bindingIds = projectScripts
        .map((s: { configBinding?: string }) => s.configBinding)
        .filter(Boolean);

    if (bindingIds.length === 0) return;

    const stored = await chrome.storage.local.get(STORAGE_KEY_ALL_CONFIGS);
    const allConfigs: Array<{ id: string; name?: string; json?: string }> =
        stored[STORAGE_KEY_ALL_CONFIGS] ?? [];

    const projectSlug = project.slug || slugify(project.name);
    const mgr = await initProjectDb(projectSlug);

    for (const cfg of allConfigs) {
        if (bindingIds.includes(cfg.id) && cfg.json) {
            await seedConfigToDb(mgr, cfg.name || "config.json", cfg.json);
        }
    }
}
