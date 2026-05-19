/**
 * Marco Extension — Project Schema Meta Tables & Auto-Migration Engine
 *
 * Stores table/column/relation metadata in 3 meta tables per project DB.
 * Provides JSON-driven schema definition with auto-migration on startup.
 *
 * Meta tables (PascalCase, per-project):
 *   - MetaTables:    table-level metadata
 *   - MetaColumns:   column definitions with validation rules
 *   - MetaRelations: foreign key relationships
 */

import type { Database as SqlJsDatabase } from "sql.js";

/* ------------------------------------------------------------------ */
/*  Meta table schemas                                                  */
/* ------------------------------------------------------------------ */

export const META_TABLES_SCHEMA = `
CREATE TABLE IF NOT EXISTS MetaTables (
    Id           INTEGER PRIMARY KEY AUTOINCREMENT,
    TableName    TEXT NOT NULL UNIQUE,
    Description  TEXT DEFAULT '',
    IsSystem     INTEGER NOT NULL DEFAULT 0,
    CreatedAt    TEXT NOT NULL DEFAULT (datetime('now')),
    UpdatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS MetaColumns (
    Id           INTEGER PRIMARY KEY AUTOINCREMENT,
    TableName    TEXT NOT NULL,
    ColumnName   TEXT NOT NULL,
    ColumnType   TEXT NOT NULL DEFAULT 'TEXT',
    IsNullable   INTEGER NOT NULL DEFAULT 0,
    DefaultValue TEXT,
    IsPrimaryKey INTEGER NOT NULL DEFAULT 0,
    IsAutoIncrement INTEGER NOT NULL DEFAULT 0,
    IsUnique     INTEGER NOT NULL DEFAULT 0,
    Description  TEXT DEFAULT '',
    ValidationJson TEXT,
    SortOrder    INTEGER NOT NULL DEFAULT 0,
    CreatedAt    TEXT NOT NULL DEFAULT (datetime('now')),
    UpdatedAt    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(TableName, ColumnName)
);

CREATE TABLE IF NOT EXISTS MetaRelations (
    Id              INTEGER PRIMARY KEY AUTOINCREMENT,
    SourceTable     TEXT NOT NULL,
    SourceColumn    TEXT NOT NULL,
    TargetTable     TEXT NOT NULL,
    TargetColumn    TEXT NOT NULL DEFAULT 'Id',
    OnDelete        TEXT NOT NULL DEFAULT 'NO ACTION',
    OnUpdate        TEXT NOT NULL DEFAULT 'NO ACTION',
    Description     TEXT DEFAULT '',
    CreatedAt       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(SourceTable, SourceColumn, TargetTable, TargetColumn)
);
`;

/* ------------------------------------------------------------------ */
/*  JSON Schema Definition Types                                       */
/* ------------------------------------------------------------------ */

export interface ColumnValidation {
    type: "string" | "number" | "date" | "regex" | "enum";
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    flags?: string;
    format?: string;
    values?: string[];
    startsWith?: string;
    endsWith?: string;
    contains?: string;
}

export interface JsonColumnDef {
    Name: string;
    Type: "TEXT" | "INTEGER" | "REAL" | "BLOB" | "BOOLEAN";
    Nullable?: boolean;
    Default?: string;
    Unique?: boolean;
    Description?: string;
    Validation?: ColumnValidation;
}

export interface JsonRelationDef {
    SourceColumn: string;
    TargetTable: string;
    TargetColumn?: string;
    OnDelete?: "CASCADE" | "SET NULL" | "NO ACTION" | "RESTRICT";
    OnUpdate?: "CASCADE" | "SET NULL" | "NO ACTION" | "RESTRICT";
    Description?: string;
}

export interface JsonTableDef {
    TableName: string;
    Description?: string;
    Columns: JsonColumnDef[];
    Relations?: JsonRelationDef[];
}

export interface JsonSchemaDef {
    version: string;
    tables: JsonTableDef[];
}

/* ------------------------------------------------------------------ */
/*  Ensure meta tables exist                                           */
/* ------------------------------------------------------------------ */

export function ensureMetaTables(db: SqlJsDatabase): void {
    db.run(META_TABLES_SCHEMA);
}

/* ------------------------------------------------------------------ */
/*  Read meta state                                                    */
/* ------------------------------------------------------------------ */

export function getMetaTables(db: SqlJsDatabase): Array<{
    TableName: string;
    Description: string;
    IsSystem: boolean;
}> {
    const stmt = db.prepare("SELECT TableName, Description, IsSystem FROM MetaTables ORDER BY TableName");
    const rows: Array<{ TableName: string; Description: string; IsSystem: boolean }> = [];
    while (stmt.step()) {
        const r = stmt.getAsObject() as Record<string, unknown>;
        rows.push({
            TableName: r.TableName as string,
            Description: (r.Description as string) || "",
            IsSystem: !!(r.IsSystem as number),
        });
    }
    stmt.free();
    return rows;
}

// eslint-disable-next-line max-lines-per-function
export function getMetaColumns(db: SqlJsDatabase, tableName?: string): Array<{
    TableName: string;
    ColumnName: string;
    ColumnType: string;
    IsNullable: boolean;
    DefaultValue: string | null;
    IsPrimaryKey: boolean;
    IsUnique: boolean;
    Description: string;
    ValidationJson: string | null;
    SortOrder: number;
}> {
    const whereClause = tableName ? " WHERE TableName = ?" : "";
    const params = tableName ? [tableName] : [];
    const stmt = db.prepare(
        `SELECT TableName, ColumnName, ColumnType, IsNullable, DefaultValue,
                IsPrimaryKey, IsUnique, Description, ValidationJson, SortOrder
         FROM MetaColumns${whereClause}
         ORDER BY TableName, SortOrder, Id`
    );
    if (params.length > 0) stmt.bind(params);

    const rows: Array<{
        TableName: string; ColumnName: string; ColumnType: string;
        IsNullable: boolean; DefaultValue: string | null; IsPrimaryKey: boolean;
        IsUnique: boolean; Description: string; ValidationJson: string | null;
        SortOrder: number;
    }> = [];

    while (stmt.step()) {
        const r = stmt.getAsObject() as Record<string, unknown>;
        rows.push({
            TableName: r.TableName as string,
            ColumnName: r.ColumnName as string,
            ColumnType: r.ColumnType as string,
            IsNullable: !!(r.IsNullable as number),
            DefaultValue: (r.DefaultValue as string) ?? null,
            IsPrimaryKey: !!(r.IsPrimaryKey as number),
            IsUnique: !!(r.IsUnique as number),
            Description: (r.Description as string) || "",
            ValidationJson: (r.ValidationJson as string) ?? null,
            SortOrder: (r.SortOrder as number) || 0,
        });
    }
    stmt.free();
    return rows;
}

export function getMetaRelations(db: SqlJsDatabase, tableName?: string): Array<{
    SourceTable: string;
    SourceColumn: string;
    TargetTable: string;
    TargetColumn: string;
    OnDelete: string;
    OnUpdate: string;
    Description: string;
}> {
    const whereClause = tableName ? " WHERE SourceTable = ?" : "";
    const params = tableName ? [tableName] : [];
    const stmt = db.prepare(
        `SELECT SourceTable, SourceColumn, TargetTable, TargetColumn, OnDelete, OnUpdate, Description
         FROM MetaRelations${whereClause}
         ORDER BY SourceTable, SourceColumn`
    );
    if (params.length > 0) stmt.bind(params);

    const rows: Array<{
        SourceTable: string; SourceColumn: string;
        TargetTable: string; TargetColumn: string;
        OnDelete: string; OnUpdate: string; Description: string;
    }> = [];

    while (stmt.step()) {
        const r = stmt.getAsObject() as Record<string, unknown>;
        rows.push({
            SourceTable: r.SourceTable as string,
            SourceColumn: r.SourceColumn as string,
            TargetTable: r.TargetTable as string,
            TargetColumn: r.TargetColumn as string,
            OnDelete: r.OnDelete as string,
            OnUpdate: r.OnUpdate as string,
            Description: (r.Description as string) || "",
        });
    }
    stmt.free();
    return rows;
}

/* ------------------------------------------------------------------ */
/*  Check which tables exist in SQLite                                  */
/* ------------------------------------------------------------------ */

function getExistingSqliteTables(db: SqlJsDatabase): Set<string> {
    const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    if (result.length === 0) return new Set();
    return new Set(result[0].values.map((row) => row[0] as string));
}

function getExistingColumns(db: SqlJsDatabase, tableName: string): Set<string> {
    const result = db.exec(`PRAGMA table_info("${tableName}")`);
    if (result.length === 0) return new Set();
    return new Set(result[0].values.map((row) => row[1] as string));
}

/* ------------------------------------------------------------------ */
/*  Migration Engine                                                    */
/* ------------------------------------------------------------------ */

export interface MigrationResult {
    tablesCreated: string[];
    columnsAdded: Array<{ table: string; column: string }>;
    relationsCreated: number;
    errors: string[];
}

/**
 * Apply a JSON schema definition to the project DB.
 * Creates missing tables, adds missing columns, and registers all metadata.
 * Runs inside a transaction for atomicity.
 */
export function applyJsonSchema(db: SqlJsDatabase, schema: JsonSchemaDef): MigrationResult {
    ensureMetaTables(db);

    const result: MigrationResult = {
        tablesCreated: [],
        columnsAdded: [],
        relationsCreated: 0,
        errors: [],
    };

    const existingTables = getExistingSqliteTables(db);

    try {
        db.run("BEGIN TRANSACTION");

        for (const tableDef of schema.tables) {
            try {
                migrateTable(db, tableDef, existingTables, result);
            } catch (err) {
                result.errors.push(`Table "${tableDef.TableName}": ${String(err)}`);
            }
        }

        db.run("COMMIT");
    } catch (err) {
        try { db.run("ROLLBACK"); } catch { /* noop */ } // allow-swallow: ROLLBACK after failed COMMIT may itself fail if no active txn; outer error is already recorded
        result.errors.push(`Transaction failed: ${String(err)}`);
    }

    return result;
}

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
function migrateTable(
    db: SqlJsDatabase,
    tableDef: JsonTableDef,
    existingTables: Set<string>,
    result: MigrationResult,
): void {
    const { TableName, Description, Columns, Relations } = tableDef;
    const tableExists = existingTables.has(TableName);

    if (!tableExists) {
        // Build CREATE TABLE statement
        const colDefs: string[] = [
            "Id INTEGER PRIMARY KEY AUTOINCREMENT",
        ];

        for (const col of Columns) {
            const sqlType = col.Type === "BOOLEAN" ? "INTEGER" : col.Type;
            const nullable = col.Nullable ? "" : " NOT NULL";
            const def = col.Default !== undefined ? ` DEFAULT ${col.Default}` : "";
            const unique = col.Unique ? " UNIQUE" : "";
            colDefs.push(`"${col.Name}" ${sqlType}${nullable}${def}${unique}`);
        }

        // Add auto columns
        colDefs.push(
            "CreatedAt TEXT NOT NULL DEFAULT (datetime('now'))",
            "UpdatedAt TEXT NOT NULL DEFAULT (datetime('now'))"
        );

        // Add FK constraints AFTER all column definitions
        if (Relations) {
            for (const rel of Relations) {
                const targetCol = rel.TargetColumn || "Id";
                const onDel = rel.OnDelete || "NO ACTION";
                const onUpd = rel.OnUpdate || "NO ACTION";
                colDefs.push(
                    `FOREIGN KEY ("${rel.SourceColumn}") REFERENCES "${rel.TargetTable}"("${targetCol}") ON DELETE ${onDel} ON UPDATE ${onUpd}`
                );
            }
        }

        db.run(`CREATE TABLE IF NOT EXISTS "${TableName}" (\n    ${colDefs.join(",\n    ")}\n)`);
        result.tablesCreated.push(TableName);
    } else {
        // Table exists — check for missing columns (additive only)
        const existingCols = getExistingColumns(db, TableName);

        for (const col of Columns) {
            if (!existingCols.has(col.Name)) {
                const sqlType = col.Type === "BOOLEAN" ? "INTEGER" : col.Type;
                const def = col.Default !== undefined ? ` DEFAULT ${col.Default}` : col.Nullable ? "" : " DEFAULT ''";
                db.run(`ALTER TABLE "${TableName}" ADD COLUMN "${col.Name}" ${sqlType}${def}`);
                result.columnsAdded.push({ table: TableName, column: col.Name });
            }
        }
    }

    // Upsert MetaTables
    db.run(
        `INSERT INTO MetaTables (TableName, Description, UpdatedAt) VALUES (?, ?, datetime('now'))
         ON CONFLICT(TableName) DO UPDATE SET Description = excluded.Description, UpdatedAt = datetime('now')`,
        [TableName, Description || ""],
    );

    // Upsert MetaColumns
    for (let i = 0; i < Columns.length; i++) {
        const col = Columns[i];
        const validationJson = col.Validation ? JSON.stringify(col.Validation) : null;
        db.run(
            `INSERT INTO MetaColumns (TableName, ColumnName, ColumnType, IsNullable, DefaultValue, IsUnique, Description, ValidationJson, SortOrder, UpdatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(TableName, ColumnName) DO UPDATE SET
                ColumnType = excluded.ColumnType,
                IsNullable = excluded.IsNullable,
                DefaultValue = excluded.DefaultValue,
                IsUnique = excluded.IsUnique,
                Description = excluded.Description,
                ValidationJson = excluded.ValidationJson,
                SortOrder = excluded.SortOrder,
                UpdatedAt = datetime('now')`,
            [
                TableName, col.Name, col.Type,
                col.Nullable ? 1 : 0,
                col.Default ?? null,
                col.Unique ? 1 : 0,
                col.Description || "",
                validationJson,
                i,
            ],
        );
    }

    // Also register auto-added columns (Id, CreatedAt, UpdatedAt) in meta
    for (const autoCol of [
        { Name: "Id", Type: "INTEGER", IsPrimaryKey: 1, IsAutoIncrement: 1, Description: "Auto-increment primary key" },
        { Name: "CreatedAt", Type: "TEXT", IsPrimaryKey: 0, IsAutoIncrement: 0, Description: "Row creation timestamp" },
        { Name: "UpdatedAt", Type: "TEXT", IsPrimaryKey: 0, IsAutoIncrement: 0, Description: "Last update timestamp" },
    ]) {
        db.run(
            `INSERT OR IGNORE INTO MetaColumns (TableName, ColumnName, ColumnType, IsPrimaryKey, IsAutoIncrement, Description, SortOrder, UpdatedAt)
             VALUES (?, ?, ?, ?, ?, ?, -1, datetime('now'))`,
            [TableName, autoCol.Name, autoCol.Type, autoCol.IsPrimaryKey, autoCol.IsAutoIncrement, autoCol.Description],
        );
    }

    // Upsert MetaRelations
    if (Relations) {
        for (const rel of Relations) {
            db.run(
                `INSERT INTO MetaRelations (SourceTable, SourceColumn, TargetTable, TargetColumn, OnDelete, OnUpdate, Description)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(SourceTable, SourceColumn, TargetTable, TargetColumn) DO UPDATE SET
                    OnDelete = excluded.OnDelete,
                    OnUpdate = excluded.OnUpdate,
                    Description = excluded.Description`,
                [
                    TableName,
                    rel.SourceColumn,
                    rel.TargetTable,
                    rel.TargetColumn || "Id",
                    rel.OnDelete || "NO ACTION",
                    rel.OnUpdate || "NO ACTION",
                    rel.Description || "",
                ],
            );
            result.relationsCreated++;
        }
    }

    // Also update ProjectSchema for backwards compatibility
    db.run(
        `INSERT OR REPLACE INTO ProjectSchema (TableName, ColumnDefs, UpdatedAt)
         VALUES (?, ?, datetime('now'))`,
        [TableName, JSON.stringify(Columns)],
    );
}

/* ------------------------------------------------------------------ */
/*  Doc Generator — Markdown                                            */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
export function generateMarkdownDocs(db: SqlJsDatabase): string {
    const tables = getMetaTables(db);
    const allColumns = getMetaColumns(db);
    const allRelations = getMetaRelations(db);

    const lines: string[] = [
        "# Database Schema Reference",
        "",
        `> Auto-generated from MetaTables. ${tables.length} table(s).`,
        "",
    ];

    for (const table of tables) {
        const cols = allColumns.filter((c) => c.TableName === table.TableName);
        const rels = allRelations.filter((r) => r.SourceTable === table.TableName);

        lines.push(`## ${table.TableName}`);
        if (table.Description) lines.push("", table.Description);
        lines.push("");

        // Column table
        lines.push("| Column | Type | Nullable | Default | Unique | PK | Description |");
        lines.push("|--------|------|----------|---------|--------|----|-------------|");
        for (const col of cols) {
            lines.push(
                `| ${col.ColumnName} | ${col.ColumnType} | ${col.IsNullable ? "✓" : "✗"} | ${col.DefaultValue ?? "—"} | ${col.IsUnique ? "✓" : "✗"} | ${col.IsPrimaryKey ? "✓" : "✗"} | ${col.Description} |`
            );
        }
        lines.push("");

        // Validation rules
        const colsWithValidation = cols.filter((c) => c.ValidationJson);
        if (colsWithValidation.length > 0) {
            lines.push("### Validation Rules", "");
            for (const col of colsWithValidation) {
                const v = JSON.parse(col.ValidationJson!);
                lines.push(`- **${col.ColumnName}**: \`${JSON.stringify(v)}\``);
            }
            lines.push("");
        }

        // Relations
        if (rels.length > 0) {
            lines.push("### Relations", "");
            for (const rel of rels) {
                const descSuffix = rel.Description ? ` — ${rel.Description}` : "";
                lines.push(
                    `- \`${rel.SourceColumn}\` → \`${rel.TargetTable}.${rel.TargetColumn}\` (ON DELETE ${rel.OnDelete}, ON UPDATE ${rel.OnUpdate})${descSuffix}`
                );
            }
            lines.push("");
        }

        lines.push("---", "");
    }

    return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Doc Generator — Prisma-Style Schema                                 */
/* ------------------------------------------------------------------ */

const SQL_TO_PRISMA_TYPE: Record<string, string> = {
    TEXT: "String",
    INTEGER: "Int",
    REAL: "Float",
    BLOB: "Bytes",
    BOOLEAN: "Boolean",
};

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
export function generatePrismaSchema(db: SqlJsDatabase): string {
    const tables = getMetaTables(db);
    const allColumns = getMetaColumns(db);
    const allRelations = getMetaRelations(db);

    const lines: string[] = [
        "// Auto-generated Prisma-style schema from MetaTables",
        "// This is a reference document — NOT used by Prisma ORM directly.",
        "// Feed this to any AI for schema-aware code generation.",
        "",
        "datasource db {",
        '  provider = "sqlite"',
        '  url      = "file:project.db"',
        "}",
        "",
    ];

    for (const table of tables) {
        const cols = allColumns.filter((c) => c.TableName === table.TableName);
        const rels = allRelations.filter((r) => r.SourceTable === table.TableName);
        const incomingRels = allRelations.filter((r) => r.TargetTable === table.TableName);

        if (table.Description) {
            lines.push(`/// ${table.Description}`);
        }
        lines.push(`model ${table.TableName} {`);

        for (const col of cols) {
            const prismaType = SQL_TO_PRISMA_TYPE[col.ColumnType] || "String";
            const nullable = col.IsNullable ? "?" : "";
            const attrs: string[] = [];

            if (col.IsPrimaryKey) attrs.push("@id");
            if (col.ColumnName === "Id") attrs.push("@default(autoincrement())");
            if (col.IsUnique) attrs.push("@unique");
            if (col.DefaultValue) {
                if (col.DefaultValue.includes("datetime")) {
                    attrs.push("@default(now())");
                } else {
                    attrs.push(`@default(${col.DefaultValue})`);
                }
            }

            // Check if this column has a FK relation
            const rel = rels.find((r) => r.SourceColumn === col.ColumnName);
            if (rel) {
                attrs.push(`// FK → ${rel.TargetTable}.${rel.TargetColumn}`);
            }

            const description = col.Description ? ` /// ${col.Description}` : "";
            lines.push(`  ${col.ColumnName}  ${prismaType}${nullable}  ${attrs.join("  ")}${description}`);
        }

        // Add virtual relation fields
        for (const rel of rels) {
            const refName = rel.TargetTable.charAt(0).toLowerCase() + rel.TargetTable.slice(1);
            lines.push(`  ${refName}  ${rel.TargetTable}  @relation(fields: [${rel.SourceColumn}], references: [${rel.TargetColumn}])`);
        }

        // Add reverse relations
        for (const rel of incomingRels) {
            const fieldName = rel.SourceTable.charAt(0).toLowerCase() + rel.SourceTable.slice(1) + "s";
            lines.push(`  ${fieldName}  ${rel.SourceTable}[]`);
        }

        lines.push("}", "");
    }

    return lines.join("\n");
}
