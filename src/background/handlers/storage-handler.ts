/**
 * Marco Extension — Storage & Data Browser Handler
 *
 * Handles GET_STORAGE_STATS, QUERY_LOGS, GET_LOG_DETAIL messages.
 * Uses db-manager.ts for real SQLite queries.
 *
 * @see spec/05-chrome-extension/55-storage-ui-redesign.md — Storage UI redesign
 * @see spec/05-chrome-extension/19-opfs-persistence-strategy.md — OPFS persistence
 */

import type { SqlRow } from "./handler-types";
import type { SqlValue } from "sql.js";
import type { MessageRequest } from "../../shared/messages";
import type { DbManager } from "../db-manager";

let dbManager: DbManager | null = null;

export function bindStorageDbManager(manager: DbManager): void {
    dbManager = manager;
}

function getManager(): DbManager {
    const isMissingDb = dbManager === null;
    if (isMissingDb) {
        throw new Error("[storage] DbManager not bound. Call bindStorageDbManager() first.");
    }
    return dbManager!;
}

function resolveDb(database: "logs" | "errors") {
    const mgr = getManager();
    return database === "errors" ? mgr.getErrorsDb() : mgr.getLogsDb();
}

function resolveTable(database: "logs" | "errors"): string {
    return database === "errors" ? "Errors" : "Logs";
}

function collectRows(stmt: { step(): boolean; getAsObject(): SqlRow; free(): void }): SqlRow[] {
    const rows: SqlRow[] = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

const ALLOWED_TABLES = new Set(["Logs", "Errors", "Sessions", "Prompts", "ProjectKv", "ProjectFiles", "Scripts", "GroupedKv"]);

function countTable(db: ReturnType<typeof resolveDb>, table: string): number {
    if (!ALLOWED_TABLES.has(table)) {
        throw new Error(`[SQL safety] Table name "${table}" not in allowlist`);
    }
    const result = db.exec(`SELECT COUNT(*) as cnt FROM ${table}`);
    const hasResult = result.length > 0 && result[0].values.length > 0;
    return hasResult ? (result[0].values[0][0] as number) : 0;
}

export async function handleGetStorageStats(): Promise<Record<string, unknown>> {
    const mgr = getManager();
    const logsDb = mgr.getLogsDb();
    const errorsDb = mgr.getErrorsDb();

    const logCount = countTable(logsDb, "Logs");
    const errorCount = countTable(errorsDb, "Errors");
    // Defensive: Sessions lives in logs.db — catch startup race where schema may not be ready
    let sessionCount = 0;
    try { sessionCount = countTable(logsDb, "Sessions"); } catch { /* schema not ready */ } // allow-swallow: Sessions schema may not exist yet at startup; sessionCount=0 is the safe default

    return {
        persistenceMode: mgr.getPersistenceMode(),
        logCount,
        errorCount,
        sessionCount,
        databases: [
            { name: "logs.db", tables: { Logs: logCount, Sessions: sessionCount } },
            { name: "errors.db", tables: { Errors: errorCount } },
        ],
    };
}

// eslint-disable-next-line max-lines-per-function
export async function handleQueryLogs(
    message: MessageRequest,
): Promise<{ rows: SqlRow[]; total: number }> {
    const msg = message as MessageRequest & {
        database: "logs" | "errors";
        offset: number;
        limit: number;
        source?: string;
        category?: string;
        search?: string;
        caseSensitive?: boolean;
    };

    const db = resolveDb(msg.database);
    const table = resolveTable(msg.database);

    const conditions: string[] = [];
    const params: SqlValue[] = [];

    if (msg.source) {
        conditions.push("source = ?");
        params.push(msg.source);
    }
    if (msg.category) {
        conditions.push("category = ?");
        params.push(msg.category);
    }
    if (msg.search) {
        const searchColumns = table === "Errors"
            ? ["error_code", "message"]
            : ["action", "detail", "source", "category"];
        const likeOp = msg.caseSensitive ? "LIKE" : "LIKE";
        const collate = msg.caseSensitive ? "" : " COLLATE NOCASE";
        const orClauses = searchColumns.map(col => `${col} ${likeOp} ?${collate}`);
        conditions.push(`(${orClauses.join(" OR ")})`);
        const pattern = `%${msg.search}%`;
        searchColumns.forEach(() => params.push(pattern));
    }

    const whereClause = conditions.length > 0
        ? ` WHERE ${conditions.join(" AND ")}`
        : "";

    const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}${whereClause}`);
    if (params.length > 0) countStmt.bind(params);
    countStmt.step();
    const total = (countStmt.getAsObject() as { cnt: number }).cnt;
    countStmt.free();

    const queryStmt = db.prepare(
        `SELECT * FROM ${table}${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    );
    queryStmt.bind([...params, msg.limit, msg.offset]);
    const rows = collectRows(queryStmt);

    return { rows, total };
}

export async function handleGetLogDetail(
    message: MessageRequest,
): Promise<{ row: SqlRow | null }> {
    const msg = message as MessageRequest & {
        database: "logs" | "errors";
        rowId: number;
    };

    const db = resolveDb(msg.database);
    const table = resolveTable(msg.database);

    const stmt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
    stmt.bind([msg.rowId]);
    const hasRow = stmt.step();
    const row = hasRow ? stmt.getAsObject() : null;
    stmt.free();

    return { row };
}
