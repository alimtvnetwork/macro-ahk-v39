/**
 * Marco Extension — Schema Migration Runner
 *
 * Sequential, crash-safe schema migrations for SQLite databases.
 * See spec 06-logging-architecture.md §Schema Migration.
 */

import type { Database as SqlJsDatabase } from "sql.js";
import { V2_LOG_COLUMNS, V2_ERROR_COLUMNS, V2_ERROR_CODES_TABLE, V2_ERROR_CODES } from "./migration-v2-sql";
import {
    sessionsHasTextPk,
    migrateSessionsToIntegerPk,
    V3_PROMPTS_SLUG,
} from "./migration-v3-sql";
import {
    V4_SESSIONS_RENAMES,
    V4_LOGS_RENAMES,
    V4_ERRORS_RENAMES,
    V4_PROMPTS_RENAMES,
    V4_PROMPTS_CATEGORY_RENAMES,
    V4_PROMPTS_TO_CATEGORY_RENAMES,
    V4_PROJECT_KV_RENAMES,
    V4_PROJECT_FILES_RENAMES,
    V4_SCRIPTS_RENAMES,
    V4_RECREATE_PROMPTS_VIEW,
} from "./migration-v4-sql";
import { getV5Statements } from "./migration-v5-sql";
import { getV6Statements } from "./migration-v6-sql";
import { getV7Statements } from "./migration-v7-sql";
import { getV8Statements } from "./migration-v8-sql";
import { getV9Statements } from "./migration-v9-sql";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A single schema migration definition. */
export interface Migration {
    version: number;
    description: string;
    up: (logsDb: SqlJsDatabase, errorsDb: SqlJsDatabase) => void;
    down: (logsDb: SqlJsDatabase, errorsDb: SqlJsDatabase) => void;
}

/** Result of running all pending migrations. */
export interface MigrationResult {
    fromVersion: number;
    toVersion: number;
    applied: number;
    failed: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SCHEMA_VERSION_KEY = "marco_schema_version";
export const CURRENT_SCHEMA_VERSION = 9;

/* ------------------------------------------------------------------ */
/*  Migration Registry                                                 */
/* ------------------------------------------------------------------ */

const MIGRATIONS: Migration[] = [
    {
        version: 2,
        description: "Add project/script/config context columns and new error codes",
        up: applyV2Up,
        down: applyV2Down,
    },
    {
        version: 3,
        description: "Convert Sessions TEXT PK to INTEGER AUTOINCREMENT; add Prompts slug column",
        up: applyV3Up,
        down: applyV3Down,
    },
    {
        version: 4,
        description: "Rename all snake_case columns to PascalCase",
        up: applyV4Up,
        down: applyV4Down,
    },
    {
        version: 5,
        description: "Add Updater tables (UpdaterInfo, UpdaterCategory, UpdaterToCategory, UpdaterEndpoints, UpdaterSteps, UpdaterDetails view)",
        up: applyV5Up,
        down: applyV5Down,
    },
    {
        version: 6,
        description: "Add changelog, caching, auto-check, confirm settings to UpdaterInfo; create UpdateSettings table",
        up: applyV6Up,
        down: applyV6Down,
    },
    {
        version: 7,
        description: "Add SharedAsset, AssetLink, ProjectGroup, ProjectGroupMember tables for Cross-Project Sync",
        up: applyV7Up,
        down: applyV7Down,
    },
    {
        version: 8,
        description: "Add AssetVersion table for version history tracking",
        up: applyV8Up,
        down: applyV8Down,
    },
    {
        version: 9,
        description: "Rebuild ProjectGroupMember with ProjectIdUuid TEXT (Cross-Project Sync Phase 3)",
        up: applyV9Up,
        down: applyV9Down,
    },
];

/* ------------------------------------------------------------------ */
/*  Migration v2 — Context Columns                                     */
/* ------------------------------------------------------------------ */

function applyV2Up(logsDb: SqlJsDatabase, errorsDb: SqlJsDatabase): void {
    runIgnoringDuplicates(logsDb, V2_LOG_COLUMNS);
    runIgnoringDuplicates(errorsDb, V2_ERROR_COLUMNS);
    runIgnoringDuplicates(errorsDb, V2_ERROR_CODES_TABLE);
    runIgnoringDuplicates(errorsDb, V2_ERROR_CODES);
}

function applyV2Down(_logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    // No-op — SQLite cannot DROP COLUMN safely
}

/* ------------------------------------------------------------------ */
/*  Migration v3 — INTEGER AUTOINCREMENT PKs                           */
/* ------------------------------------------------------------------ */

function applyV3Up(logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    if (sessionsHasTextPk(logsDb)) {
        migrateSessionsToIntegerPk(logsDb);
        console.log("[migration] v3: Converted Sessions TEXT PK → INTEGER AUTOINCREMENT");
    }
    runIgnoringDuplicates(logsDb, V3_PROMPTS_SLUG);
}

function applyV3Down(_logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    // No-op
}

/* ------------------------------------------------------------------ */
/*  Migration v4 — PascalCase Column Rename                            */
/* ------------------------------------------------------------------ */

function applyV4Up(logsDb: SqlJsDatabase, errorsDb: SqlJsDatabase): void {
    // Rename columns in logs.db tables
    runRenameStatementsIfSourceColumnsExist(logsDb, V4_SESSIONS_RENAMES);
    runRenameStatementsIfSourceColumnsExist(logsDb, V4_LOGS_RENAMES);
    runRenameStatementsIfSourceColumnsExist(logsDb, V4_PROMPTS_RENAMES);
    runRenameStatementsIfSourceColumnsExist(logsDb, V4_PROMPTS_CATEGORY_RENAMES);
    runRenameStatementsIfSourceColumnsExist(logsDb, V4_PROMPTS_TO_CATEGORY_RENAMES);
    runRenameStatementsIfSourceColumnsExist(logsDb, V4_PROJECT_KV_RENAMES);
    runRenameStatementsIfSourceColumnsExist(logsDb, V4_PROJECT_FILES_RENAMES);
    runRenameStatementsIfSourceColumnsExist(logsDb, V4_SCRIPTS_RENAMES);

    // Rename columns in errors.db
    runRenameStatementsIfSourceColumnsExist(errorsDb, V4_ERRORS_RENAMES);

    // Recreate PromptsDetails view with PascalCase column references
    runIgnoringDuplicates(logsDb, V4_RECREATE_PROMPTS_VIEW);

    console.log("[migration] v4: Renamed all columns to PascalCase");
}

function applyV4Down(_logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    // No-op — reverse rename would be destructive
}

/* ------------------------------------------------------------------ */
/*  Migration v5 — Updater Tables                                      */
/*  See: spec/05-chrome-extension/58-updater-system.md                 */
/* ------------------------------------------------------------------ */

function applyV5Up(logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    runIgnoringDuplicates(logsDb, getV5Statements());
    console.log("[migration] v5: Created Updater tables and view");
}

function applyV5Down(_logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    // No-op — DROP TABLE is destructive
}

/* ------------------------------------------------------------------ */
/*  Migration v6 — Updater Settings & Caching                          */
/* ------------------------------------------------------------------ */

function applyV6Up(logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    runIgnoringDuplicates(logsDb, getV6Statements());
    // Seed default global settings row if none exists
    try {
        const existing = logsDb.exec("SELECT COUNT(*) FROM UpdateSettings");
        if (existing.length > 0 && (existing[0].values[0][0] as number) === 0) {
            logsDb.run("INSERT INTO UpdateSettings (AutoCheckIntervalMinutes, HasUserConfirmBeforeUpdate, HasChangelogFromVersionInfo, CacheExpiryMinutes) VALUES (1440, 0, 1, 10080)");
        }
    } catch { // allow-swallow: UpdateSettings table may not exist yet on first-run; seed re-attempts on next migration pass
        // table missing
    }
    console.log("[migration] v6: Added updater settings, caching, and changelog columns");
}

function applyV6Down(_logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    // No-op — ALTER TABLE ADD COLUMN is not reversible in SQLite
}

/* ------------------------------------------------------------------ */
/*  Migration v7 — Cross-Project Sync Tables                           */
/*  See: spec/21-app/02-features/misc-features/cross-project-sync.md                        */
/* ------------------------------------------------------------------ */

function applyV7Up(logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    runIgnoringDuplicates(logsDb, getV7Statements());
    console.log("[migration] v7: Created Cross-Project Sync tables (SharedAsset, AssetLink, ProjectGroup, ProjectGroupMember)");
}

function applyV7Down(_logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    // No-op — DROP TABLE is destructive
}

/* ------------------------------------------------------------------ */
/*  Migration v8 — AssetVersion Table                                  */
/* ------------------------------------------------------------------ */

function applyV8Up(logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    runIgnoringDuplicates(logsDb, getV8Statements());
    console.log("[migration] v8: Created AssetVersion table for version history tracking");
}

function applyV8Down(_logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    // No-op — DROP TABLE is destructive
}

/* ------------------------------------------------------------------ */
/*  Migration v9 — ProjectGroupMember ProjectIdUuid                    */
/* ------------------------------------------------------------------ */

function applyV9Up(logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    // DROP + CREATE are not duplicates — must execute exactly once.
    for (const stmt of getV9Statements()) {
        logsDb.run(stmt);
    }
    console.log("[migration] v9: Rebuilt ProjectGroupMember with ProjectIdUuid TEXT");
}

function applyV9Down(_logsDb: SqlJsDatabase, _errorsDb: SqlJsDatabase): void {
    // No-op — old INTEGER column had no resolvable FK; no data to restore.
}

/* ------------------------------------------------------------------ */
/*  Runner                                                             */
/* ------------------------------------------------------------------ */

export async function migrateSchema(
    logsDb: SqlJsDatabase,
    errorsDb: SqlJsDatabase,
): Promise<MigrationResult> {
    const fromVersion = await readSchemaVersion(logsDb, errorsDb);
    const isUpToDate = fromVersion >= CURRENT_SCHEMA_VERSION;

    if (isUpToDate) {
        return { fromVersion, toVersion: fromVersion, applied: 0, failed: false };
    }

    const pending = getPendingMigrations(fromVersion);
    return applyMigrations(pending, logsDb, errorsDb, fromVersion);
}

async function readSchemaVersion(
    logsDb: SqlJsDatabase,
    errorsDb: SqlJsDatabase,
): Promise<number> {
    const stored = await chrome.storage.local.get(SCHEMA_VERSION_KEY);
    const storedVersion = stored[SCHEMA_VERSION_KEY];

    if (typeof storedVersion === "number") {
        return storedVersion;
    }

    const inferredVersion = inferSchemaVersion(logsDb, errorsDb);

    if (inferredVersion > 1) {
        await persistVersion(inferredVersion);
        console.warn(
            `[migration] Missing ${SCHEMA_VERSION_KEY}; inferred live schema as v${inferredVersion} and repaired version metadata`,
        );
    }

    return inferredVersion;
}

function getPendingMigrations(currentVersion: number): Migration[] {
    return MIGRATIONS
        .filter((m) => m.version > currentVersion)
        .sort((a, b) => a.version - b.version);
}

async function applyMigrations(
    pending: Migration[],
    logsDb: SqlJsDatabase,
    errorsDb: SqlJsDatabase,
    fromVersion: number,
): Promise<MigrationResult> {
    let lastVersion = fromVersion;

    for (const migration of pending) {
        const isSuccess = await applySingleMigration(migration, logsDb, errorsDb);

        if (isSuccess) {
            lastVersion = migration.version;
        } else {
            return buildResult(fromVersion, lastVersion, true);
        }
    }

    return buildResult(fromVersion, lastVersion, false);
}

function buildResult(
    fromVersion: number,
    toVersion: number,
    failed: boolean,
): MigrationResult {
    return {
        fromVersion,
        toVersion,
        applied: toVersion - fromVersion,
        failed,
    };
}

/**
 * Module-level last-attempted-SQL recorder. `runIgnoringDuplicates()`
 * updates this BEFORE each `db.run()` so when the migration's `up()` body
 * throws (or a custom helper throws non-duplicate errors), we can still
 * surface the exact statement text in the boot failure banner.
 *
 * Reset to null at the start of each migration so stale SQL from a
 * successful prior migration cannot leak into a later failure report.
 */
let lastAttemptedSql: string | null = null;

async function applySingleMigration(
    migration: Migration,
    logsDb: SqlJsDatabase,
    errorsDb: SqlJsDatabase,
): Promise<boolean> {
    lastAttemptedSql = null;
    try {
        migration.up(logsDb, errorsDb);
        await persistVersion(migration.version);

        console.log(`[migration] v${migration.version}: ${migration.description}`);
        return true;
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const sqlSuffix = lastAttemptedSql !== null
            ? `\n  SQL: ${lastAttemptedSql}\n  Reason: ${reason}`
            : `\n  Reason: ${reason}`;

        console.error(`[migration] Migration v${migration.version} failed\n  Path: SQLite in-memory DB (logs + errors)\n  Missing: Successful schema migration "${migration.description}"${sqlSuffix}`, err);  // Keep bare console.error — DB may be mid-migration
        attemptRollback(migration, logsDb, errorsDb);

        // Re-throw a tagged error so boot.ts → setBootError() can extract
        // structured context (migration version + step + failing SQL) and
        // the BootFailureBanner can render the dedicated copyable block.
        throw new Error(
            `[MIGRATION_FAILURE v=${migration.version} step="${migration.description}"] ${sqlSuffix.trim()}`,
        );
    }
}

async function persistVersion(version: number): Promise<void> {
    await chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: version });
}

function attemptRollback(
    migration: Migration,
    logsDb: SqlJsDatabase,
    errorsDb: SqlJsDatabase,
): void {
    try {
        migration.down(logsDb, errorsDb);
        console.error(`[migration] Rolled back v${migration.version}\n  Path: SQLite in-memory DB (logs + errors)\n  Missing: Successful migration — rolled back to previous schema\n  Reason: Original migration threw, rollback applied`);
    } catch (rollbackErr) {
        console.error(`[migration] Rollback of v${migration.version} also failed\n  Path: SQLite in-memory DB (logs + errors)\n  Missing: Successful rollback of failed migration\n  Reason: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)} — database may be in inconsistent state`, rollbackErr);
    }
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

/**
 * Runs a batch of statements, swallowing the SQLite "duplicate column /
 * index already exists" class of errors. Any *other* failure re-throws so
 * `applySingleMigration()` can attach migration version + step context.
 *
 * Records the most recent attempted statement into `lastAttemptedSql` so
 * the upstream catch can include the exact failing SQL in its tagged
 * error — this is the source-of-truth for the popup banner's "Failing
 * statement" copyable block.
 */
function runIgnoringDuplicates(db: SqlJsDatabase, statements: string[]): void {
    for (const sql of statements) {
        lastAttemptedSql = sql;
        try {
            db.run(sql);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            const isDuplicate =
                reason.toLowerCase().includes("duplicate column") ||
                reason.toLowerCase().includes("already exists");
            if (isDuplicate) {
                continue;
            }
            // Non-recoverable — re-throw with the SQL preserved in
            // lastAttemptedSql so the migration wrapper can tag it.
            throw err;
        }
    }
}

function runRenameStatementsIfSourceColumnsExist(db: SqlJsDatabase, statements: string[]): void {
    const pending = [...statements];

    while (pending.length > 0) {
        const sql = pending.shift()!;
        const renameMatch = sql.match(/^ALTER TABLE\s+(\w+)\s+RENAME COLUMN\s+(\w+)\s+TO\s+(\w+)$/i);

        if (!renameMatch) {
            runIgnoringDuplicates(db, [sql]);
            continue;
        }

        const [, tableName, sourceColumn, targetColumn] = renameMatch;
        const existingColumns = getTableColumns(db, tableName);

        if (existingColumns.has(targetColumn)) {
            continue;
        }

        if (!existingColumns.has(sourceColumn)) {
            console.warn(
                `[migration] Skipping rename ${tableName}.${sourceColumn} → ${targetColumn} because source column is absent`,
            );
            continue;
        }

        runIgnoringDuplicates(db, [sql]);
    }
}

function inferSchemaVersion(logsDb: SqlJsDatabase, errorsDb: SqlJsDatabase): number {
    const logsTables = getExistingTables(logsDb);
    const errorsTables = getExistingTables(errorsDb);
    const sessionsColumns = getTableColumns(logsDb, "Sessions");

    if (sessionsColumns.has("StartedAt")) {
        if (logsTables.has("AssetVersion")) { return 8; }
        if (logsTables.has("SharedAsset") || logsTables.has("ProjectGroup")) { return 7; }
        if (logsTables.has("UpdateSettings")) { return 6; }
        if (logsTables.has("UpdaterInfo")) { return 5; }
        if (errorsTables.has("ErrorCodes")) { return 4; }
        return 4;
    }

    if (sessionsHasTextPk(logsDb)) {
        return 2;
    }

    return 3;
}

function getExistingTables(db: SqlJsDatabase): Set<string> {
    try {
        const result = db.exec("SELECT name FROM sqlite_master WHERE type='table'");

        if (result.length === 0) {
            return new Set<string>();
        }

        return new Set(result[0].values.map((row) => String(row[0])));
    } catch {
        return new Set<string>();
    }
}

function getTableColumns(db: SqlJsDatabase, tableName: string): Set<string> {
    try {
        const result = db.exec(`PRAGMA table_info(${tableName})`);

        if (result.length === 0) {
            return new Set<string>();
        }

        const nameIndex = result[0].columns.indexOf("name");
        if (nameIndex === -1) {
            return new Set<string>();
        }

        return new Set(result[0].values.map((row) => String(row[nameIndex])));
    } catch {
        return new Set<string>();
    }
}
