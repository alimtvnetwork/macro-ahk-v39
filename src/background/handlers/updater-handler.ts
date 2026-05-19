/**
 * Marco Extension — Updater Handler
 *
 * Background handler for updater CRUD and version check/fetch logic.
 * Uses the UpdaterInfo, UpdaterEndpoints, UpdaterSteps tables.
 *
 * @see spec/05-chrome-extension/58-updater-system.md — Updater system
 * @see spec/05-chrome-extension/56-extension-update-mechanism.md — Update mechanism
 * @see spec/02-data-and-api/db-join-specs/01-category-join-pattern.md — Category join pattern
 */

import type { Database as SqlJsDatabase } from "sql.js";
import type { DbManager } from "../db-manager";
import { bindOpt, requireField } from "./handler-guards";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UpdaterEntry {
    UpdaterId: number;
    Name: string;
    Description: string | null;
    ScriptUrl: string;
    VersionInfoUrl: string | null;
    InstructionUrl: string | null;
    ChangelogUrl: string | null;
    IsGit: number;
    IsRedirectable: number;
    MaxRedirectDepth: number;
    IsInstructionRedirect: number;
    InstructionRedirectDepth: number;
    HasInstructions: number;
    HasChangelogFromVersionInfo: number;
    HasUserConfirmBeforeUpdate: number;
    IsEnabled: number;
    AutoCheckIntervalMinutes: number;
    CacheExpiryMinutes: number;
    CachedRedirectUrl: string | null;
    CachedRedirectAt: string | null;
    CurrentVersion: string | null;
    LatestVersion: string | null;
    LastCheckedAt: string | null;
    LastUpdatedAt: string | null;
    CreatedAt: string;
    UpdatedAt: string;
    Categories: string;
}

export interface VersionInfoResponse {
    Title: string;
    Description: string;
    Version: string;
    Changelog: string[];
    DownloadUrl?: string;
    InstructionUrl?: string;
    UpdateEndpoints?: Array<{
        Url: string;
        ExpectedStatusCode: number;
        AllowRedirects: boolean;
        MaxRedirectDepth: number;
    }>;
}

export interface InstructionStep {
    StepId: string;
    Order: number;
    Type: "Download" | "Execute" | "Update" | "Validate";
    Condition: string | null;
    Payload: {
        ResourceType?: "Script" | "Binary" | "ChromeExtension";
        Source?: {
            Url: string;
            ExpectedStatusCode: number;
            AllowRedirects: boolean;
            MaxRedirectDepth: number;
        };
        Destination?: string;
        PostProcess?: string;
        ExecutionCommand?: string;
        ValidationRule?: string;
    };
}

export interface InstructionResponse {
    Title: string;
    Description: string;
    Version: string;
    Author: string;
    Changelog: string[];
    Steps: InstructionStep[];
}

export interface UpdateCheckResult {
    updaterId: number;
    name: string;
    currentVersion: string | null;
    latestVersion: string | null;
    hasUpdate: boolean;
    errorMessage?: string;
}

/* ------------------------------------------------------------------ */
/*  Manager Binding                                                    */
/* ------------------------------------------------------------------ */

let dbManager: DbManager | null = null;

export function bindUpdaterDbManager(manager: DbManager): void {
    dbManager = manager;
}

function getDb(): SqlJsDatabase {
    if (!dbManager) throw new Error("[updater] DbManager not bound");
    return dbManager.getLogsDb();
}

/* ------------------------------------------------------------------ */
/*  CRUD — List / Get                                                  */
/* ------------------------------------------------------------------ */

/** List all updater entries via the UpdaterDetails view. */
export function handleListUpdaters(): UpdaterEntry[] {
    const db = getDb();
    const stmt = db.prepare("SELECT * FROM UpdaterDetails ORDER BY Name");
    const rows: UpdaterEntry[] = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject() as UpdaterEntry);
    }
    stmt.free();
    return rows;
}

/** Get a single updater by ID. */
export function handleGetUpdater(updaterId: number): UpdaterEntry | null {
    const db = getDb();
    const stmt = db.prepare("SELECT * FROM UpdaterDetails WHERE UpdaterId = ?");
    stmt.bind([updaterId]);
    const row = stmt.step() ? (stmt.getAsObject() as UpdaterEntry) : null;
    stmt.free();
    return row;
}

/* ------------------------------------------------------------------ */
/*  CRUD — Create                                                      */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export function handleCreateUpdater(data: {
    name: string;
    scriptUrl: string;
    versionInfoUrl?: string;
    instructionUrl?: string;
    changelogUrl?: string;
    isGit?: boolean;
    isRedirectable?: boolean;
    maxRedirectDepth?: number;
    hasChangelogFromVersionInfo?: boolean;
    hasUserConfirmBeforeUpdate?: boolean;
    autoCheckIntervalMinutes?: number;
    cacheExpiryMinutes?: number;
}): number {
    const name = requireField(data?.name);
    const scriptUrl = requireField(data?.scriptUrl);
    if (name === null) throw new Error("[updater] CREATE_UPDATER missing required field: name");
    if (scriptUrl === null) throw new Error("[updater] CREATE_UPDATER missing required field: scriptUrl");

    const db = getDb();
    const now = new Date().toISOString();
    db.run(
        `INSERT INTO UpdaterInfo (Name, ScriptUrl, VersionInfoUrl, InstructionUrl, ChangelogUrl, IsGit, IsRedirectable, MaxRedirectDepth, HasInstructions, HasChangelogFromVersionInfo, HasUserConfirmBeforeUpdate, AutoCheckIntervalMinutes, CacheExpiryMinutes, CreatedAt, UpdatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            name,
            scriptUrl,
            bindOpt(data.versionInfoUrl),
            bindOpt(data.instructionUrl),
            bindOpt(data.changelogUrl),
            data.isGit ? 1 : 0,
            data.isRedirectable !== false ? 1 : 0,
            data.maxRedirectDepth ?? 2,
            data.instructionUrl ? 1 : 0,
            data.hasChangelogFromVersionInfo !== false ? 1 : 0,
            data.hasUserConfirmBeforeUpdate ? 1 : 0,
            data.autoCheckIntervalMinutes ?? 1440,
            data.cacheExpiryMinutes ?? 10080,
            now,
            now,
        ],
    );

    const result = db.exec("SELECT last_insert_rowid() AS Id");
    const newId = result[0]?.values[0]?.[0] as number;
    dbManager?.markDirty();
    return newId;
}

/* ------------------------------------------------------------------ */
/*  CRUD — Delete                                                      */
/* ------------------------------------------------------------------ */

export function handleDeleteUpdater(updaterId: number): void {
    const db = getDb();
    db.run("DELETE FROM UpdaterInfo WHERE Id = ?", [updaterId]);
    dbManager?.markDirty();
}

/* ------------------------------------------------------------------ */
/*  Version Check                                                      */
/* ------------------------------------------------------------------ */

/**
 * Fetch VersionInfoSchema from the VersionInfoUrl, compare versions,
 * and update the local record.
 */
export async function handleCheckForUpdate(updaterId: number): Promise<UpdateCheckResult> {
    const entry = handleGetUpdater(updaterId);
    if (!entry) {
        return { updaterId, name: "Unknown", currentVersion: null, latestVersion: null, hasUpdate: false, errorMessage: "Updater not found" };
    }

    if (!entry.VersionInfoUrl) {
        return { updaterId, name: entry.Name, currentVersion: entry.CurrentVersion, latestVersion: null, hasUpdate: false, errorMessage: "No VersionInfoUrl configured" };
    }

    try {
        const versionInfo = await fetchVersionInfo(entry.VersionInfoUrl, entry.IsRedirectable === 1, entry.MaxRedirectDepth);
        const now = new Date().toISOString();

        // Update local record
        const db = getDb();
        db.run(
            "UPDATE UpdaterInfo SET LatestVersion = ?, LastCheckedAt = ?, UpdatedAt = ? WHERE Id = ?",
            [versionInfo.Version, now, now, updaterId],
        );
        dbManager?.markDirty();

        const hasUpdate = entry.CurrentVersion !== versionInfo.Version;

        return {
            updaterId,
            name: entry.Name,
            currentVersion: entry.CurrentVersion,
            latestVersion: versionInfo.Version,
            hasUpdate,
        };
    } catch (err) {
        return {
            updaterId,
            name: entry.Name,
            currentVersion: entry.CurrentVersion,
            latestVersion: null,
            hasUpdate: false,
            errorMessage: err instanceof Error ? err.message : "Fetch failed",
        };
    }
}

/* ------------------------------------------------------------------ */
/*  Fetch Helpers                                                      */
/* ------------------------------------------------------------------ */

async function fetchVersionInfo(
    url: string,
    isRedirectable: boolean,
    maxRedirectDepth: number,
): Promise<VersionInfoResponse> {
    const response = await fetch(url, {
        redirect: isRedirectable ? "follow" : "error",
        signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
        throw new Error(`VersionInfo fetch failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as VersionInfoResponse;

    if (!json.Version || typeof json.Version !== "string") {
        throw new Error("Invalid VersionInfoSchema: missing Version field");
    }

    return json;
}

/**
 * Fetch InstructionSchema from a URL.
 */
export async function fetchInstructions(
    url: string,
    isRedirectable: boolean,
): Promise<InstructionResponse> {
    const response = await fetch(url, {
        redirect: isRedirectable ? "follow" : "error",
        signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
        throw new Error(`Instruction fetch failed: ${response.status}`);
    }

    const json = await response.json() as InstructionResponse;

    if (!json.Steps || !Array.isArray(json.Steps)) {
        throw new Error("Invalid InstructionSchema: missing Steps array");
    }

    return json;
}

/* ------------------------------------------------------------------ */
/*  Category Management                                                */
/* ------------------------------------------------------------------ */

/** Ensure a category exists, return its ID. */
export function ensureUpdaterCategory(name: string): number {
    const trimmed = requireField(name);
    if (trimmed === null) throw new Error("[updater] ensureUpdaterCategory called with empty name");

    const db = getDb();

    const existing = db.exec("SELECT Id FROM UpdaterCategory WHERE Name = ?", [trimmed]);
    if (existing.length > 0 && existing[0].values.length > 0) {
        return existing[0].values[0][0] as number;
    }

    db.run("INSERT INTO UpdaterCategory (Name, CreatedAt) VALUES (?, datetime('now'))", [trimmed]);
    const result = db.exec("SELECT last_insert_rowid() AS Id");
    dbManager?.markDirty();
    return result[0]?.values[0]?.[0] as number;
}

/** Link an updater to a category. */
export function linkUpdaterToCategory(updaterId: number, categoryName: string): void {
    const categoryId = ensureUpdaterCategory(categoryName);
    const db = getDb();

    try {
        db.run(
            "INSERT INTO UpdaterToCategory (UpdaterId, CategoryId) VALUES (?, ?)",
            [updaterId, categoryId],
        );
        dbManager?.markDirty();
    } catch { // allow-swallow: UNIQUE constraint violation means link already exists — idempotent insert
        // already linked
    }
}

/* ------------------------------------------------------------------ */
/*  Global Update Settings                                             */
/* ------------------------------------------------------------------ */

export interface GlobalUpdateSettings {
    Id: number;
    AutoCheckIntervalMinutes: number;
    HasUserConfirmBeforeUpdate: number;
    HasChangelogFromVersionInfo: number;
    CacheExpiryMinutes: number;
}

/** Get the global update settings (first row). */
export function handleGetUpdateSettings(): GlobalUpdateSettings {
    const db = getDb();
    const stmt = db.prepare("SELECT * FROM UpdateSettings LIMIT 1");
    const row = stmt.step() ? (stmt.getAsObject() as GlobalUpdateSettings) : null;
    stmt.free();
    return row ?? {
        Id: 0,
        AutoCheckIntervalMinutes: 1440,
        HasUserConfirmBeforeUpdate: 0,
        HasChangelogFromVersionInfo: 1,
        CacheExpiryMinutes: 10080,
    };
}

/** Update global update settings. */
export function handleSaveUpdateSettings(data: {
    autoCheckIntervalMinutes: number;
    hasUserConfirmBeforeUpdate: boolean;
    hasChangelogFromVersionInfo: boolean;
    cacheExpiryMinutes: number;
}): void {
    const db = getDb();
    const now = new Date().toISOString();
    const existing = db.exec("SELECT COUNT(*) FROM UpdateSettings");
    const count = existing.length > 0 ? (existing[0].values[0][0] as number) : 0;

    if (count === 0) {
        db.run(
            "INSERT INTO UpdateSettings (AutoCheckIntervalMinutes, HasUserConfirmBeforeUpdate, HasChangelogFromVersionInfo, CacheExpiryMinutes, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?)",
            [data.autoCheckIntervalMinutes, data.hasUserConfirmBeforeUpdate ? 1 : 0, data.hasChangelogFromVersionInfo ? 1 : 0, data.cacheExpiryMinutes, now, now],
        );
    } else {
        db.run(
            "UPDATE UpdateSettings SET AutoCheckIntervalMinutes = ?, HasUserConfirmBeforeUpdate = ?, HasChangelogFromVersionInfo = ?, CacheExpiryMinutes = ?, UpdatedAt = ?",
            [data.autoCheckIntervalMinutes, data.hasUserConfirmBeforeUpdate ? 1 : 0, data.hasChangelogFromVersionInfo ? 1 : 0, data.cacheExpiryMinutes, now],
        );
    }
    dbManager?.markDirty();
}
