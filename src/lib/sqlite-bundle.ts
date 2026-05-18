/**
 * Marco Extension — SQLite Bundle Export / Import
 *
 * Exports all projects, scripts, configs, and prompts into a single SQLite DB
 * file, compressed as a .zip for portability.
 * Import reads the same format and replaces all existing data.
 *
 * ALL table and column names use PascalCase — no underscores allowed.
 *
 * ID CONVENTION: All primary key `Id` columns use INTEGER PRIMARY KEY AUTOINCREMENT.
 * Original runtime IDs are stored in a separate `Uid` TEXT column for merge/diff matching.
 * See: spec/02-coding-guidelines/coding-guidelines/database-id-convention.md
 */

import type { SqlValue } from "@/background/handlers/handler-types";
import initSqlJs, { type Database } from "sql.js";
import type JSZipType from "jszip";

/** Lazy JSZip loader — keeps ~95 kB out of the options/popup chunk until import/export runs. */
async function loadJSZip(): Promise<typeof JSZipType> {
  const mod = await import("jszip");
  return mod.default;
}
import { sendMessage } from "@/lib/message-client";
import type {
  StoredProject,
  StoredScript,
  StoredConfig,
} from "@/hooks/use-projects-scripts";
import type { PromptEntry } from "@/hooks/use-prompts";
import {
  validateBundleSchema,
  formatValidationError,
  CURRENT_FORMAT_VERSION,
} from "@/lib/sqlite-bundle-contract";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DB_FILENAME = "marco-backup.db";
const ZIP_FILENAME = "marco-backup.zip";
const WASM_URL = "https://sql.js.org/dist/sql-wasm.wasm";

/* ------------------------------------------------------------------ */
/*  Schema (PascalCase, INTEGER AUTOINCREMENT IDs)                     */
/* ------------------------------------------------------------------ */

const CREATE_PROJECTS_TABLE = `
  CREATE TABLE IF NOT EXISTS Projects (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Uid TEXT,
    SchemaVersion INTEGER NOT NULL DEFAULT 1,
    Name TEXT NOT NULL,
    Slug TEXT,
    Version TEXT NOT NULL,
    Description TEXT,
    TargetUrls TEXT,
    Scripts TEXT,
    Configs TEXT,
    Cookies TEXT,
    CookieRules TEXT,
    Dependencies TEXT,
    Settings TEXT,
    IsGlobal INTEGER DEFAULT 0,
    IsRemovable INTEGER DEFAULT 1,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
  );
`;

const CREATE_SCRIPTS_TABLE = `
  CREATE TABLE IF NOT EXISTS Scripts (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Uid TEXT,
    Name TEXT NOT NULL,
    Description TEXT,
    Code TEXT NOT NULL,
    RunOrder INTEGER NOT NULL DEFAULT 0,
    RunAt TEXT,
    ConfigBinding TEXT,
    IsIife INTEGER DEFAULT 0,
    HasDomUsage INTEGER DEFAULT 0,
    UpdateUrl TEXT,
    LastUpdateCheck TEXT,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
  );
`;

const CREATE_CONFIGS_TABLE = `
  CREATE TABLE IF NOT EXISTS Configs (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Uid TEXT,
    Name TEXT NOT NULL,
    Description TEXT,
    Json TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
  );
`;

const CREATE_META_TABLE = `
  CREATE TABLE IF NOT EXISTS Meta (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Key TEXT UNIQUE NOT NULL,
    Value TEXT
  );
`;

const CREATE_PROMPTS_TABLE = `
  CREATE TABLE IF NOT EXISTS Prompts (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Uid TEXT,
    Slug TEXT,
    Name TEXT NOT NULL,
    Text TEXT NOT NULL,
    RunOrder INTEGER NOT NULL DEFAULT 0,
    IsDefault INTEGER DEFAULT 0,
    IsFavorite INTEGER DEFAULT 0,
    Category TEXT,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
  );
`;

/**
 * v6: row-per-dependency promotion of Projects.Dependencies JSON blob.
 * Projects.Dependencies JSON blob is still emitted so v4/v5 readers
 * keep round-tripping. v6+ readers prefer this table when populated.
 */
const CREATE_DEPENDENCIES_TABLE = `
  CREATE TABLE IF NOT EXISTS Dependencies (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Uid TEXT,
    ProjectUid TEXT NOT NULL,
    DependsOnProjectId TEXT NOT NULL,
    Version TEXT,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
  );
`;

/**
 * v6: row-per-variable promotion of Projects.Settings.variables map.
 * Value is JSON-stringified to preserve non-string types on round-trip.
 * Projects.Settings JSON still emitted for v4/v5 read-back.
 */
const CREATE_VARIABLES_TABLE = `
  CREATE TABLE IF NOT EXISTS Variables (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Uid TEXT,
    ProjectUid TEXT NOT NULL,
    Name TEXT NOT NULL,
    Value TEXT,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
  );
`;

/**
 * v6: PromptsCategory + PromptsToCategory tables preserve multi-category
 * linkage on round-trip. Pre-v6 bundles flattened categories into the
 * single Prompts.Category column (lossy when a prompt had >1 category).
 * Prompts.Category is still emitted as the FIRST category for backward
 * compat with v4/v5 readers.
 *
 * Junction stores PromptUid + CategoryName directly (rather than INTEGER
 * Id pairs) so we don't need a two-phase write to resolve auto-increment
 * Ids — bundle is a snapshot, not a relational live store.
 */
const CREATE_PROMPTS_CATEGORY_TABLE = `
  CREATE TABLE IF NOT EXISTS PromptsCategory (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Uid TEXT,
    Name TEXT NOT NULL UNIQUE,
    SortOrder INTEGER DEFAULT 0,
    CreatedAt TEXT NOT NULL
  );
`;

const CREATE_PROMPTS_TO_CATEGORY_TABLE = `
  CREATE TABLE IF NOT EXISTS PromptsToCategory (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    PromptUid TEXT NOT NULL,
    CategoryName TEXT NOT NULL,
    CreatedAt TEXT NOT NULL
  );
`;


/* ------------------------------------------------------------------ */
/*  Init sql.js                                                        */
/* ------------------------------------------------------------------ */

async function initDb(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => WASM_URL });
  return new SQL.Database();
}

async function openDb(data: Uint8Array): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => WASM_URL });
  return new SQL.Database(data);
}

/* ------------------------------------------------------------------ */
/*  Export                                                             */
/* ------------------------------------------------------------------ */

function insertProjects(db: Database, projects: StoredProject[]): void {
  const stmt = db.prepare(`
    INSERT INTO Projects (Uid, SchemaVersion, Name, Slug, Version, Description,
      TargetUrls, Scripts, Configs, Cookies, CookieRules, Dependencies, Settings,
      IsGlobal, IsRemovable, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  for (const p of projects) {
    stmt.run([
      p.id ?? null,
      // v6: this build always writes row-table promotions (Dependencies,
      // Variables), so the emitted SchemaVersion is at least 2 regardless
      // of the source row's prior value. Importers gate row-table reads
      // on SchemaVersion >= 2.
      Math.max(p.schemaVersion ?? 2, 2),
      p.name ?? "",
      p.slug ?? null,
      p.version ?? "1.0.0",
      p.description ?? null,
      JSON.stringify(p.targetUrls ?? []),
      JSON.stringify(p.scripts ?? []),
      JSON.stringify(p.configs ?? []),
      // v5: serialize the modern cookies[] AND the deprecated cookieRules
      // separately so a round-trip never silently merges or drops one.
      JSON.stringify(p.cookies ?? []),
      JSON.stringify(p.cookieRules ?? []),
      JSON.stringify(p.dependencies ?? []),
      JSON.stringify(p.settings ?? {}),
      // Defaults match StoredProject runtime semantics: not global, removable.
      p.isGlobal === true ? 1 : 0,
      p.isRemovable === false ? 0 : 1,
      p.createdAt ?? now,
      p.updatedAt ?? now,
    ]);
  }
  stmt.free();
}

function insertScripts(db: Database, scripts: StoredScript[]): void {
  const stmt = db.prepare(`
    INSERT INTO Scripts (Uid, Name, Description, Code, RunOrder, RunAt,
      ConfigBinding, IsIife, HasDomUsage, UpdateUrl, LastUpdateCheck,
      CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  for (const s of scripts) {
    stmt.run([
      s.id ?? null,
      s.name ?? "",
      s.description ?? null,
      s.code ?? "",
      s.order ?? 0,
      s.runAt ?? null,
      s.configBinding ?? null,
      s.isIife ? 1 : 0,
      s.hasDomUsage ? 1 : 0,
      s.updateUrl ?? null,
      s.lastUpdateCheck ?? null,
      s.createdAt ?? now,
      s.updatedAt ?? now,
    ]);
  }
  stmt.free();
}

function insertConfigs(db: Database, configs: StoredConfig[]): void {
  const stmt = db.prepare(`
    INSERT INTO Configs (Uid, Name, Description, Json, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  for (const c of configs) {
    stmt.run([
      c.id ?? null,
      c.name ?? "",
      c.description ?? null,
      c.json ?? "{}",
      c.createdAt ?? now,
      c.updatedAt ?? now,
    ]);
  }
  stmt.free();
}

function insertMeta(db: Database): void {
  const now = new Date().toISOString();
  db.run(`INSERT INTO Meta (Key, Value) VALUES ('exported_at', ?)`, [now]);
  // CURRENT_FORMAT_VERSION is the canonical source — never inline the literal.
  db.run(
    `INSERT INTO Meta (Key, Value) VALUES ('format_version', ?)`,
    [CURRENT_FORMAT_VERSION],
  );
}

function insertPrompts(db: Database, prompts: PromptEntry[]): void {
  const stmt = db.prepare(`
    INSERT INTO Prompts (Uid, Slug, Name, Text, RunOrder, IsDefault, IsFavorite,
      Category, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const p of prompts) {
    stmt.run([
      p.id ?? null,
      // v5: emit Slug — required by the Task Next prompt resolver.
      p.slug ?? null,
      p.name ?? "",
      p.text ?? "",
      p.order ?? 0,
      p.isDefault ? 1 : 0,
      p.isFavorite ? 1 : 0,
      p.category ?? null,
      p.createdAt ?? now,
      p.updatedAt ?? now,
    ]);
  }
  stmt.free();
}

/**
 * v6: write each project's dependencies as its own row in the new
 * Dependencies table. Projects.Dependencies JSON blob is ALSO still
 * emitted by insertProjects() so v4/v5-only readers keep round-tripping.
 */
function insertDependencies(db: Database, projects: ReadonlyArray<StoredProject>): void {
  const stmt = db.prepare(`
    INSERT INTO Dependencies (Uid, ProjectUid, DependsOnProjectId, Version, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const p of projects) {
    const deps = Array.isArray(p.dependencies) ? p.dependencies : [];
    for (const dep of deps) {
      const d = dep as unknown as Record<string, unknown>;
      const dependsOn = typeof d.projectId === "string" ? d.projectId : "";
      if (!dependsOn) continue;
      stmt.run([
        null,
        p.id ?? "",
        dependsOn,
        typeof d.version === "string" ? d.version : null,
        now,
        now,
      ]);
    }
  }
  stmt.free();
}

/**
 * v6: write each project's settings.variables entry as its own row.
 * Value is JSON-stringified to preserve non-string types. Settings
 * JSON blob is still emitted by insertProjects() for v4/v5 read-back.
 */
function insertVariables(db: Database, projects: ReadonlyArray<StoredProject>): void {
  const stmt = db.prepare(`
    INSERT INTO Variables (Uid, ProjectUid, Name, Value, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const p of projects) {
    const settings = (p.settings ?? {}) as Record<string, unknown>;
    const rawVars = settings.variables;
    if (rawVars == null || typeof rawVars !== "object") continue;
    const vars = rawVars as Record<string, unknown>;
    for (const [name, value] of Object.entries(vars)) {
      stmt.run([
        null,
        p.id ?? "",
        name,
        value == null ? null : JSON.stringify(value),
        now,
        now,
      ]);
    }
  }
  stmt.free();
}

/**
 * v6: parse a prompt's category data into a deduplicated, ordered list.
 * Prefers the comma-separated `categories` field (from PromptsDetails view)
 * and falls back to the singular `category` for pre-view bundles.
 */
function parsePromptCategories(raw: Record<string, unknown>): string[] {
  const joined = typeof raw.categories === "string" ? raw.categories
    : typeof raw.category === "string" ? raw.category
    : "";
  if (!joined) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of joined.split(",")) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * v6: write PromptsCategory + PromptsToCategory rows so multi-category
 * linkage survives round-trip. Categories are deduplicated across the
 * whole prompt set; junction rows reference Prompts.Uid + Category Name
 * (snapshot-friendly — no two-phase INSERT to resolve AUTOINCREMENT Ids).
 */
function insertPromptCategories(
  db: Database,
  prompts: ReadonlyArray<PromptEntry>,
  rawPromptsByUid: Map<string, Record<string, unknown>>,
): void {
  const now = new Date().toISOString();

  // 1) Collect ordered, unique category names across all prompts.
  const seenCategories = new Set<string>();
  const orderedCategories: string[] = [];
  const promptCategoryMap = new Map<string, string[]>();
  for (const p of prompts) {
    const raw = rawPromptsByUid.get(p.id ?? "") ?? {};
    const cats = parsePromptCategories(raw);
    promptCategoryMap.set(p.id ?? "", cats);
    for (const name of cats) {
      if (!seenCategories.has(name)) {
        seenCategories.add(name);
        orderedCategories.push(name);
      }
    }
  }

  // 2) Insert each unique category once with its discovery order.
  const catStmt = db.prepare(`
    INSERT INTO PromptsCategory (Uid, Name, SortOrder, CreatedAt)
    VALUES (?, ?, ?, ?)
  `);
  for (let i = 0; i < orderedCategories.length; i++) {
    catStmt.run([null, orderedCategories[i], i, now]);
  }
  catStmt.free();

  // 3) Insert junction rows for each (PromptUid, CategoryName).
  const linkStmt = db.prepare(`
    INSERT INTO PromptsToCategory (PromptUid, CategoryName, CreatedAt)
    VALUES (?, ?, ?)
  `);
  for (const [promptUid, cats] of promptCategoryMap.entries()) {
    if (!promptUid) continue;
    for (const catName of cats) {
      linkStmt.run([promptUid, catName, now]);
    }
  }
  linkStmt.free();
}


// eslint-disable-next-line max-lines-per-function
export async function exportAllAsSqliteZip(): Promise<void> {
  const [projRes, scriptsRes, configsRes, promptsRes] = await Promise.all([
    sendMessage<{ projects: StoredProject[] }>({ type: "GET_ALL_PROJECTS" }),
    sendMessage<{ scripts: StoredScript[] }>({ type: "GET_ALL_SCRIPTS" }),
    sendMessage<{ configs: StoredConfig[] }>({ type: "GET_ALL_CONFIGS" }),
    sendMessage<{ prompts?: PromptEntry[] }>({ type: "GET_PROMPTS" }),
  ]);

  // v6: keep the raw prompt records keyed by uid so insertPromptCategories
  // can read the `categories` field (comma-separated string from the
  // PromptsDetails view) without forcing PromptEntry to grow a new field.
  const rawPromptsByUid = new Map<string, Record<string, unknown>>();
  const prompts: PromptEntry[] = Array.isArray(promptsRes.prompts)
    ? promptsRes.prompts.map((raw, i) => {
        const r = raw as unknown as Record<string, unknown>;
        const uid = String(r.id ?? "");
        rawPromptsByUid.set(uid, r);
        return {
          id: uid,
          slug: typeof r.slug === "string" ? r.slug : undefined,
          name: (r.name as string) ?? "",
          text: (r.text as string) ?? "",
          order: typeof r.order === "number" ? r.order : i,
          isDefault: r.isDefault === true,
          isFavorite: r.isFavorite === true,
          category: typeof r.category === "string" ? r.category : undefined,
          createdAt: (r.createdAt as string) ?? new Date().toISOString(),
          updatedAt: (r.updatedAt as string) ?? new Date().toISOString(),
        };
      })
    : [];

  const db = await initDb();

  db.run(CREATE_PROJECTS_TABLE);
  db.run(CREATE_SCRIPTS_TABLE);
  db.run(CREATE_CONFIGS_TABLE);
  db.run(CREATE_PROMPTS_TABLE);
  db.run(CREATE_META_TABLE);
  db.run(CREATE_DEPENDENCIES_TABLE);
  db.run(CREATE_VARIABLES_TABLE);
  db.run(CREATE_PROMPTS_CATEGORY_TABLE);
  db.run(CREATE_PROMPTS_TO_CATEGORY_TABLE);

  insertProjects(db, projRes.projects);
  insertScripts(db, scriptsRes.scripts);
  insertConfigs(db, configsRes.configs);
  insertPrompts(db, prompts);
  insertDependencies(db, projRes.projects);
  insertVariables(db, projRes.projects);
  insertPromptCategories(db, prompts, rawPromptsByUid);
  insertMeta(db);

  const dbData = db.export();
  db.close();

  const JSZipCtor = await loadJSZip(); const zip = new JSZipCtor();
  zip.file(DB_FILENAME, dbData);

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  await triggerDownload(blob, ZIP_FILENAME);
}

/** Exports a single project (with all related scripts & configs) as a SQLite zip. */
// eslint-disable-next-line max-lines-per-function
export async function exportProjectAsSqliteZip(project: StoredProject): Promise<void> {
  const [scriptsRes, configsRes] = await Promise.all([
    sendMessage<{ scripts: StoredScript[] }>({ type: "GET_ALL_SCRIPTS" }),
    sendMessage<{ configs: StoredConfig[] }>({ type: "GET_ALL_CONFIGS" }),
  ]);

  // Filter scripts & configs referenced by this project
  const scriptPaths = new Set((project.scripts ?? []).map((s) => s.path));
  const configPaths = new Set((project.configs ?? []).map((c) => c.path));

  const relatedScripts = scriptsRes.scripts.filter((s) => scriptPaths.has(s.id) || scriptPaths.has(s.name));
  const relatedConfigs = configsRes.configs.filter((c) => configPaths.has(c.id) || configPaths.has(c.name));

  // Create synthetic script records for inline code that didn't match a library script
  const matchedIds = new Set(relatedScripts.map((s) => s.name));
  const matchedNames = new Set(relatedScripts.map((s) => s.id));
  const now = new Date().toISOString();

  for (const entry of project.scripts ?? []) {
    const alreadyMatched = matchedIds.has(entry.path) || matchedNames.has(entry.path);
    if (!alreadyMatched && entry.code) {
      relatedScripts.push({
        id: `inline_${entry.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
        name: entry.path,
        code: entry.code,
        order: entry.order,
        runAt: entry.runAt,
        configBinding: entry.configBinding,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const db = await initDb();

  db.run(CREATE_PROJECTS_TABLE);
  db.run(CREATE_SCRIPTS_TABLE);
  db.run(CREATE_CONFIGS_TABLE);
  db.run(CREATE_PROMPTS_TABLE);
  db.run(CREATE_META_TABLE);
  db.run(CREATE_DEPENDENCIES_TABLE);
  db.run(CREATE_VARIABLES_TABLE);

  insertProjects(db, [project]);
  insertScripts(db, relatedScripts);
  insertConfigs(db, relatedConfigs);
  insertDependencies(db, [project]);
  insertVariables(db, [project]);
  insertMeta(db);

  const dbData = db.export();
  db.close();

  const JSZipCtor = await loadJSZip(); const zip = new JSZipCtor();
  zip.file(DB_FILENAME, dbData);

  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  await triggerDownload(blob, `${safeName}-backup.zip`);
}

/**
 * Exports a user-chosen subset of projects (with each project's related
 * scripts and configs, plus any inline-script synthesis) into the same
 * real-SQLite-in-ZIP format used by `exportAllAsSqliteZip` /
 * `exportProjectAsSqliteZip`. Filename is derived from the count.
 *
 * Throws when `projects` is empty so callers don't accidentally produce
 * an empty bundle.
 */
// eslint-disable-next-line max-lines-per-function
export async function exportProjectsAsSqliteZip(
  projects: ReadonlyArray<StoredProject>,
): Promise<void> {
  if (projects.length === 0) {
    throw new Error("No projects selected — pick at least one project to export.");
  }

  const [scriptsRes, configsRes] = await Promise.all([
    sendMessage<{ scripts: StoredScript[] }>({ type: "GET_ALL_SCRIPTS" }),
    sendMessage<{ configs: StoredConfig[] }>({ type: "GET_ALL_CONFIGS" }),
  ]);

  // Union of all script + config paths referenced by the selected projects.
  const allScriptPaths = new Set<string>();
  const allConfigPaths = new Set<string>();
  for (const p of projects) {
    for (const s of p.scripts ?? []) allScriptPaths.add(s.path);
    for (const c of p.configs ?? []) allConfigPaths.add(c.path);
  }

  const relatedScripts = scriptsRes.scripts.filter(
    (s) => allScriptPaths.has(s.id) || allScriptPaths.has(s.name),
  );
  const relatedConfigs = configsRes.configs.filter(
    (c) => allConfigPaths.has(c.id) || allConfigPaths.has(c.name),
  );

  // Synthesize inline-only scripts (mirrors single-project exporter).
  const matchedIds = new Set(relatedScripts.map((s) => s.name));
  const matchedNames = new Set(relatedScripts.map((s) => s.id));
  const now = new Date().toISOString();
  for (const project of projects) {
    for (const entry of project.scripts ?? []) {
      const alreadyMatched = matchedIds.has(entry.path) || matchedNames.has(entry.path);
      if (!alreadyMatched && entry.code) {
        relatedScripts.push({
          id: `inline_${entry.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
          name: entry.path,
          code: entry.code,
          order: entry.order,
          runAt: entry.runAt,
          configBinding: entry.configBinding,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  const db = await initDb();
  db.run(CREATE_PROJECTS_TABLE);
  db.run(CREATE_SCRIPTS_TABLE);
  db.run(CREATE_CONFIGS_TABLE);
  db.run(CREATE_PROMPTS_TABLE);
  db.run(CREATE_META_TABLE);
  db.run(CREATE_DEPENDENCIES_TABLE);
  db.run(CREATE_VARIABLES_TABLE);

  insertProjects(db, [...projects]);
  insertScripts(db, relatedScripts);
  insertConfigs(db, relatedConfigs);
  insertDependencies(db, projects);
  insertVariables(db, projects);
  insertMeta(db);

  const dbData = db.export();
  db.close();

  const JSZipCtor = await loadJSZip();
  const zip = new JSZipCtor();
  zip.file(DB_FILENAME, dbData);

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const filename = projects.length === 1
    ? `${projects[0].name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()}-backup.zip`
    : `projects-${projects.length}-backup.zip`;
  await triggerDownload(blob, filename);
}

/* ------------------------------------------------------------------ */
/*  Import                                                             */
/* ------------------------------------------------------------------ */

/**
 * Column name resolver — supports PascalCase (v3+), legacy snake_case,
 * and the new Uid column (v4+) with fallback to old Id TEXT column.
 */
function col(obj: Record<string, SqlValue>, pascalName: string, snakeName: string): SqlValue {
  return obj[pascalName] ?? obj[snakeName];
}

/** Resolves the runtime UID: prefers Uid column (v4+), falls back to Id column (v3 TEXT PK bundles). */
function resolveUid(obj: Record<string, unknown>): string {
  const uid = obj["Uid"] ?? obj["uid"];
  if (uid != null && String(uid) !== "") return String(uid);
  // Fallback for v3 bundles where Id was TEXT PK containing the runtime UUID
  const id = obj["Id"] ?? obj["id"];
  return String(id ?? "");
}

/**
 * v6: read row-per-dependency entries from the Dependencies table, grouped
 * by ProjectUid. Empty map if the table is absent (v4/v5 bundles).
 */
function readDependenciesTable(db: Database): Map<string, Array<{ projectId: string; version: string }>> {
  const out = new Map<string, Array<{ projectId: string; version: string }>>();
  let rows;
  try { rows = db.exec("SELECT * FROM Dependencies"); } catch { return out; }
  if (rows.length === 0 || rows[0].values.length === 0) return out;
  const cols = rows[0].columns;
  for (const row of rows[0].values) {
    const obj = Object.fromEntries(cols.map((c: SqlValue, i: number) => [c, row[i]]));
    const projectUid = String(obj["ProjectUid"] ?? "");
    const dependsOn = String(obj["DependsOnProjectId"] ?? "");
    if (!projectUid || !dependsOn) continue;
    const version = obj["Version"] != null ? String(obj["Version"]) : "";
    const list = out.get(projectUid) ?? [];
    list.push({ projectId: dependsOn, version });
    out.set(projectUid, list);
  }
  return out;
}

/**
 * v6: read row-per-variable entries from the Variables table, grouped by
 * ProjectUid. Values are JSON.parse'd to restore non-string types.
 */
function readVariablesTable(db: Database): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  let rows;
  try { rows = db.exec("SELECT * FROM Variables"); } catch { return out; }
  if (rows.length === 0 || rows[0].values.length === 0) return out;
  const cols = rows[0].columns;
  for (const row of rows[0].values) {
    const obj = Object.fromEntries(cols.map((c: SqlValue, i: number) => [c, row[i]]));
    const projectUid = String(obj["ProjectUid"] ?? "");
    const name = String(obj["Name"] ?? "");
    if (!projectUid || !name) continue;
    const rawValue = obj["Value"];
    let parsed: unknown = null;
    if (rawValue != null) {
      try { parsed = JSON.parse(String(rawValue)); } catch { parsed = String(rawValue); }
    }
    const map = out.get(projectUid) ?? {};
    map[name] = parsed;
    out.set(projectUid, map);
  }
  return out;
}

function readProjects(db: Database): StoredProject[] {
  let rows;
  try { rows = db.exec("SELECT * FROM Projects"); } catch {
    try { rows = db.exec("SELECT * FROM projects"); } catch { return []; }
  }
  const hasRows = rows.length > 0 && rows[0].values.length > 0;
  if (!hasRows) return [];

  // v6 row-table maps (empty for v4/v5 bundles — fall back to JSON blobs).
  const depsByProject = readDependenciesTable(db);
  const varsByProject = readVariablesTable(db);

  const cols = rows[0].columns;
  return rows[0].values.map((row: SqlValue[]) => {
    const obj = Object.fromEntries(cols.map((c: SqlValue, i: number) => [c, row[i]]));
    const projectUid = resolveUid(obj);
    const schemaVersion = (col(obj, "SchemaVersion", "schema_version") as number) ?? 1;
    // v6 row-table promotion: when SchemaVersion >= 2 AND the rows exist,
    // prefer them over the legacy JSON blob (which is still emitted for
    // backward compatibility with v4/v5 readers).
    const depRows = depsByProject.get(projectUid);
    const dependencies = depRows && schemaVersion >= 2
      ? depRows
      : safeJsonParse(obj["Dependencies"] as string ?? null, [] as Array<{ projectId: string; version: string }>);
    const settingsFromBlob = safeJsonParse(col(obj, "Settings", "settings") as string, {} as Record<string, unknown>);
    const varRows = varsByProject.get(projectUid);
    const settings = varRows && schemaVersion >= 2
      ? { ...settingsFromBlob, variables: varRows }
      : settingsFromBlob;
    return {
      id: projectUid,
      schemaVersion,
      name: (col(obj, "Name", "name") as string),
      slug: (obj["Slug"] as string) ?? undefined,
      version: (col(obj, "Version", "version") as string),
      description: (col(obj, "Description", "description") as string) ?? undefined,
      targetUrls: safeJsonParse(col(obj, "TargetUrls", "target_urls") as string, []),
      scripts: safeJsonParse(col(obj, "Scripts", "scripts") as string, []),
      configs: safeJsonParse(col(obj, "Configs", "configs") as string, []),
      cookies: safeJsonParse(obj["Cookies"] as string ?? null, []),
      cookieRules: safeJsonParse(col(obj, "CookieRules", "cookie_rules") as string, []),
      dependencies,
      settings,
      isGlobal: obj["IsGlobal"] === 1,
      isRemovable: obj["IsRemovable"] == null ? true : obj["IsRemovable"] === 1,
      createdAt: (col(obj, "CreatedAt", "created_at") as string),
      updatedAt: (col(obj, "UpdatedAt", "updated_at") as string),
    } as StoredProject;
  });
}

function readScripts(db: Database): StoredScript[] {
  let rows;
  try { rows = db.exec("SELECT * FROM Scripts"); } catch {
    try { rows = db.exec("SELECT * FROM scripts"); } catch { return []; }
  }
  const hasRows = rows.length > 0 && rows[0].values.length > 0;
  if (!hasRows) return [];

  const cols = rows[0].columns;
  return rows[0].values.map((row: SqlValue[]) => {
    const obj = Object.fromEntries(cols.map((c: SqlValue, i: number) => [c, row[i]]));
    return {
      id: resolveUid(obj),
      name: (col(obj, "Name", "name") as string),
      description: (col(obj, "Description", "description") as string) ?? undefined,
      code: (col(obj, "Code", "code") as string),
      order: (col(obj, "RunOrder", "run_order") as number) ?? 0,
      runAt: (col(obj, "RunAt", "run_at") as string) ?? undefined,
      configBinding: (col(obj, "ConfigBinding", "config_binding") as string) ?? undefined,
      isIife: col(obj, "IsIife", "is_iife") === 1,
      hasDomUsage: col(obj, "HasDomUsage", "has_dom_usage") === 1,
      // v5 — auto-update fields. Absent in v4 bundles (returns undefined,
      // which the runtime treats as "auto-update disabled").
      updateUrl: (obj["UpdateUrl"] as string) ?? undefined,
      lastUpdateCheck: (obj["LastUpdateCheck"] as string) ?? undefined,
      createdAt: (col(obj, "CreatedAt", "created_at") as string),
      updatedAt: (col(obj, "UpdatedAt", "updated_at") as string),
    } as StoredScript;
  });
}

function readConfigs(db: Database): StoredConfig[] {
  let rows;
  try { rows = db.exec("SELECT * FROM Configs"); } catch {
    try { rows = db.exec("SELECT * FROM configs"); } catch { return []; }
  }
  const hasRows = rows.length > 0 && rows[0].values.length > 0;
  if (!hasRows) return [];

  const cols = rows[0].columns;
  return rows[0].values.map((row: SqlValue[]) => {
    const obj = Object.fromEntries(cols.map((c: SqlValue, i: number) => [c, row[i]]));
    return {
      id: resolveUid(obj),
      name: (col(obj, "Name", "name") as string),
      description: (col(obj, "Description", "description") as string) ?? undefined,
      json: (col(obj, "Json", "json") as string),
      createdAt: (col(obj, "CreatedAt", "created_at") as string),
      updatedAt: (col(obj, "UpdatedAt", "updated_at") as string),
    } as StoredConfig;
  });
}

/**
 * v6: read PromptsToCategory junction grouped by PromptUid. Empty map
 * for v4/v5 bundles — readers fall back to Prompts.Category (singular).
 */
function readPromptCategoriesTable(db: Database): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let rows;
  try { rows = db.exec("SELECT PromptUid, CategoryName FROM PromptsToCategory"); } catch { return out; }
  if (rows.length === 0 || rows[0].values.length === 0) return out;
  for (const row of rows[0].values) {
    const uid = String(row[0] ?? "");
    const name = String(row[1] ?? "");
    if (!uid || !name) continue;
    const list = out.get(uid) ?? [];
    list.push(name);
    out.set(uid, list);
  }
  return out;
}

function readPrompts(db: Database): PromptEntry[] {
  try {
    let rows;
    try { rows = db.exec("SELECT * FROM Prompts"); } catch {
      try { rows = db.exec("SELECT * FROM prompts"); } catch { return []; }
    }
    const hasRows = rows.length > 0 && rows[0].values.length > 0;
    if (!hasRows) return [];

    // v6 junction (empty in v4/v5 bundles).
    const catsByPromptUid = readPromptCategoriesTable(db);

    const cols = rows[0].columns;
    return rows[0].values.map((row: SqlValue[]) => {
      const obj = Object.fromEntries(cols.map((c: SqlValue, i: number) => [c, row[i]]));
      const uid = resolveUid(obj);
      const junctionCats = catsByPromptUid.get(uid);
      // v6 preferred: rebuild comma-separated list from junction.
      // Fallback: pre-v6 Prompts.Category single value.
      const singularCategory = (col(obj, "Category", "category") as string) ?? undefined;
      const category = junctionCats && junctionCats.length > 0
        ? junctionCats.join(", ")
        : singularCategory;
      return {
        id: uid,
        // v5 — Slug column is now actually written. v4 bundles return
        // undefined here, which the Task Next resolver treats as "no slug".
        slug: (obj["Slug"] as string) ?? undefined,
        name: (col(obj, "Name", "name") as string),
        text: (col(obj, "Text", "text") as string),
        order: (col(obj, "RunOrder", "run_order") as number) ?? 0,
        isDefault: col(obj, "IsDefault", "is_default") === 1,
        isFavorite: col(obj, "IsFavorite", "is_favorite") === 1,
        category,
        createdAt: (col(obj, "CreatedAt", "created_at") as string),
        updatedAt: (col(obj, "UpdatedAt", "updated_at") as string),
      } as PromptEntry;
    });
  } catch {
    // prompts table may not exist in older bundles
    return [];
  }
}

/** Reads a .zip and returns a preview of its contents (with diff against existing data) without importing. */
// eslint-disable-next-line max-lines-per-function
export async function previewSqliteZip(file: File): Promise<BundlePreview> {
  const arrayBuffer = await file.arrayBuffer();
  const JSZipCtor = await loadJSZip(); const zip = await JSZipCtor.loadAsync(arrayBuffer);

  const dbFile = zip.file(DB_FILENAME);
  if (!dbFile) {
    throw new Error(`Invalid bundle: missing ${DB_FILENAME} inside the zip`);
  }

  const dbData = await dbFile.async("uint8array");
  const db = await openDb(dbData);

  // Strict PascalCase v4 contract gate. Block the preview dialog from
  // ever showing rows extracted from a malformed/legacy bundle.
  const validation = validateBundleSchema(db, "full");
  if (!validation.ok) {
    db.close();
    throw new Error(formatValidationError(validation));
  }

  const projects = readProjects(db);
  const scripts = readScripts(db);
  const configs = readConfigs(db);

  // Read exported_at from Meta
  let exportedAt: string | undefined;
  try {
    let metaRows: { columns: string[]; values: SqlValue[][] }[];
    try { metaRows = db.exec("SELECT Value FROM Meta WHERE Key = 'exported_at'"); } catch {
      try { metaRows = db.exec("SELECT value FROM meta WHERE key = 'exported_at'"); } catch { metaRows = []; }
    }
    if (Array.isArray(metaRows) && metaRows.length > 0 && metaRows[0].values.length > 0) {
      exportedAt = metaRows[0].values[0][0] as string;
    }
  } catch { /* meta table may not exist */ }

  db.close();

  // Fetch existing data for diff
  const [existingProjects, existingScripts, existingConfigs] = await Promise.all([
    sendMessage<{ projects: StoredProject[] }>({ type: "GET_ALL_PROJECTS" }),
    sendMessage<{ scripts: StoredScript[] }>({ type: "GET_ALL_SCRIPTS" }),
    sendMessage<{ configs: StoredConfig[] }>({ type: "GET_ALL_CONFIGS" }),
  ]);

  const existingProjectIds = new Set(existingProjects.projects.map((p) => p.id));
  const existingScriptIds = new Set(existingScripts.scripts.map((s) => s.id));
  const existingConfigIds = new Set(existingConfigs.configs.map((c) => c.id));

  const projectItems: DiffItem[] = projects.map((p) => ({
    name: p.name,
    status: existingProjectIds.has(p.id) ? "overwrite" : "new",
  }));
  const scriptItems: DiffItem[] = scripts.map((s) => ({
    name: s.name,
    status: existingScriptIds.has(s.id) ? "overwrite" : "new",
  }));
  const configItems: DiffItem[] = configs.map((c) => ({
    name: c.name,
    status: existingConfigIds.has(c.id) ? "overwrite" : "new",
  }));

  return {
    projectCount: projects.length,
    scriptCount: scripts.length,
    configCount: configs.length,
    projectNames: projects.map((p) => p.name),
    scriptNames: scripts.map((s) => s.name),
    configNames: configs.map((c) => c.name),
    projectItems,
    scriptItems,
    configItems,
    existingProjectCount: existingProjects.projects.length,
    existingScriptCount: existingScripts.scripts.length,
    existingConfigCount: existingConfigs.configs.length,
    exportedAt,
  };
}

export interface DiffItem {
  name: string;
  status: "new" | "overwrite";
}

export interface BundlePreview {
  projectCount: number;
  scriptCount: number;
  configCount: number;
  projectNames: string[];
  scriptNames: string[];
  configNames: string[];
  projectItems: DiffItem[];
  scriptItems: DiffItem[];
  configItems: DiffItem[];
  /** Counts of items currently in workspace (before import) — for matched/unmatched/untouched summaries. */
  existingProjectCount: number;
  existingScriptCount: number;
  existingConfigCount: number;
  exportedAt?: string;
}

/** Reads a .zip file, extracts the SQLite DB, and replaces all data. */
export async function importFromSqliteZip(file: File): Promise<ImportResult> {
  const { projects, scripts, configs, prompts } = await extractBundle(file);
  await replaceAll(projects, scripts, configs, prompts);
  return {
    projectCount: projects.length,
    scriptCount: scripts.length,
    configCount: configs.length,
    promptCount: prompts.length,
  };
}

/** Reads a .zip file and merges contents into existing data (no deletions). */
export async function mergeFromSqliteZip(file: File): Promise<ImportResult> {
  const { projects, scripts, configs, prompts } = await extractBundle(file);
  await mergeAll(projects, scripts, configs, prompts);
  return {
    projectCount: projects.length,
    scriptCount: scripts.length,
    configCount: configs.length,
    promptCount: prompts.length,
  };
}

async function extractBundle(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const JSZipCtor = await loadJSZip(); const zip = await JSZipCtor.loadAsync(arrayBuffer);
  const dbFile = zip.file(DB_FILENAME);
  if (!dbFile) throw new Error(`Invalid bundle: missing ${DB_FILENAME} inside the zip`);
  const dbData = await dbFile.async("uint8array");
  const db = await openDb(dbData);

  // Strict PascalCase contract gate (v4 + v5). Runs BEFORE we read any rows
  // so a malformed bundle never reaches the SAVE_* messaging layer (where
  // partial writes could corrupt the live extension state).
  const validation = validateBundleSchema(db, "full");
  if (!validation.ok) {
    db.close();
    throw new Error(formatValidationError(validation));
  }

  const projects = readProjects(db);
  const scripts = readScripts(db);
  const configs = readConfigs(db);
  // Prompts table is optional in "full" mode — readPrompts() already
  // returns [] when absent, so older v4 bundles without Prompts still work.
  const prompts = readPrompts(db);
  db.close();
  return { projects, scripts, configs, prompts };
}

export interface ImportResult {
  projectCount: number;
  scriptCount: number;
  configCount: number;
  /** v5: prompts are now part of the full round-trip (was silently dropped pre-v5). */
  promptCount: number;
}

/* ------------------------------------------------------------------ */
/*  Replace All                                                        */
/* ------------------------------------------------------------------ */

async function replaceAll(
  projects: StoredProject[],
  scripts: StoredScript[],
  configs: StoredConfig[],
  prompts: PromptEntry[],
): Promise<void> {
  // Delete existing data
  const [existingProjects, existingScripts, existingConfigs, existingPrompts] = await Promise.all([
    sendMessage<{ projects: StoredProject[] }>({ type: "GET_ALL_PROJECTS" }),
    sendMessage<{ scripts: StoredScript[] }>({ type: "GET_ALL_SCRIPTS" }),
    sendMessage<{ configs: StoredConfig[] }>({ type: "GET_ALL_CONFIGS" }),
    sendMessage<{ prompts?: PromptEntry[] }>({ type: "GET_PROMPTS" }),
  ]);

  // Mirror importPromptsFromSqliteZip: never delete the built-in defaults
  // (their loss would orphan the Task Next resolver and the welcome flow).
  const existingPromptList = Array.isArray(existingPrompts.prompts) ? existingPrompts.prompts : [];

  await Promise.all([
    ...existingProjects.projects.map((p) =>
      sendMessage({ type: "DELETE_PROJECT", projectId: p.id }),
    ),
    ...existingScripts.scripts.map((s) =>
      sendMessage({ type: "DELETE_SCRIPT", id: s.id }),
    ),
    ...existingConfigs.configs.map((c) =>
      sendMessage({ type: "DELETE_CONFIG", id: c.id }),
    ),
    ...existingPromptList
      .filter((p) => (p as unknown as Record<string, unknown>).isDefault !== true)
      .map((p) =>
        sendMessage({ type: "DELETE_PROMPT", promptId: (p as unknown as { id: string }).id }),
      ),
  ]);

  // Insert imported data
  await Promise.all([
    ...projects.map((p) => sendMessage({ type: "SAVE_PROJECT", project: p })),
    ...scripts.map((s) => sendMessage({ type: "SAVE_SCRIPT", script: s })),
    ...configs.map((c) => sendMessage({ type: "SAVE_CONFIG", config: c })),
    ...prompts.map((p) => sendMessage({ type: "SAVE_PROMPT", prompt: p })),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Merge All                                                          */
/* ------------------------------------------------------------------ */

async function mergeAll(
  projects: StoredProject[],
  scripts: StoredScript[],
  configs: StoredConfig[],
  prompts: PromptEntry[],
): Promise<void> {
  // Upsert: simply save each item — existing IDs get overwritten, new ones get added
  await Promise.all([
    ...projects.map((p) => sendMessage({ type: "SAVE_PROJECT", project: p })),
    ...scripts.map((s) => sendMessage({ type: "SAVE_SCRIPT", script: s })),
    ...configs.map((c) => sendMessage({ type: "SAVE_CONFIG", config: c })),
    ...prompts.map((p) => sendMessage({ type: "SAVE_PROMPT", prompt: p })),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  const isAbsent = !raw;
  if (isAbsent) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/*  Prompt-only Export / Import                                        */
/* ------------------------------------------------------------------ */

/** Exports all prompts as a SQLite ZIP. */
export async function exportPromptsAsSqliteZip(): Promise<void> {
  const result = await sendMessage<{ prompts?: PromptEntry[] }>({ type: "GET_PROMPTS" });
  const rawPromptsByUid = new Map<string, Record<string, unknown>>();
  const prompts: PromptEntry[] = Array.isArray(result.prompts)
    ? result.prompts.map((raw, i) => {
        const r = raw as unknown as Record<string, unknown>;
        const uid = String(r.id ?? "");
        rawPromptsByUid.set(uid, r);
        return {
          id: uid,
          slug: typeof r.slug === "string" ? r.slug : undefined,
          name: (r.name as string) ?? "",
          text: (r.text as string) ?? "",
          order: typeof r.order === "number" ? r.order : i,
          isDefault: r.isDefault === true,
          isFavorite: r.isFavorite === true,
          category: typeof r.category === "string" ? r.category : undefined,
          createdAt: (r.createdAt as string) ?? new Date().toISOString(),
          updatedAt: (r.updatedAt as string) ?? new Date().toISOString(),
        };
      })
    : [];

  const db = await initDb();
  db.run(CREATE_PROMPTS_TABLE);
  db.run(CREATE_META_TABLE);
  db.run(CREATE_PROMPTS_CATEGORY_TABLE);
  db.run(CREATE_PROMPTS_TO_CATEGORY_TABLE);
  insertPrompts(db, prompts);
  insertPromptCategories(db, prompts, rawPromptsByUid);
  insertMeta(db);

  const dbData = db.export();
  db.close();

  const JSZipCtor = await loadJSZip(); const zip = new JSZipCtor();
  zip.file(DB_FILENAME, dbData);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  await triggerDownload(blob, "marco-prompts-backup.zip");
}

/** Shared extractor + strict validator for prompts-only bundles. */
async function extractPromptsBundle(file: File): Promise<PromptEntry[]> {
  const arrayBuffer = await file.arrayBuffer();
  const JSZipCtor = await loadJSZip(); const zip = await JSZipCtor.loadAsync(arrayBuffer);
  const dbFile = zip.file(DB_FILENAME);
  if (!dbFile) throw new Error(`Invalid bundle: missing ${DB_FILENAME} inside the zip`);
  const dbData = await dbFile.async("uint8array");
  const db = await openDb(dbData);
  const validation = validateBundleSchema(db, "prompts-only");
  if (!validation.ok) {
    db.close();
    throw new Error(formatValidationError(validation));
  }
  const prompts = readPrompts(db);
  db.close();
  if (prompts.length === 0) throw new Error("No prompts found in bundle");
  return prompts;
}

/** Imports prompts from a SQLite ZIP (replace mode). */
export async function importPromptsFromSqliteZip(file: File): Promise<{ promptCount: number }> {
  const prompts = await extractPromptsBundle(file);

  // Delete existing non-default prompts, then save imported ones
  const existing = await sendMessage<{ prompts?: PromptEntry[] }>({ type: "GET_PROMPTS" });
  const existingList = Array.isArray(existing.prompts) ? existing.prompts : [];
  for (const raw of existingList) {
    const r = raw as unknown as Record<string, unknown>;
    if (r.isDefault !== true && typeof r.id === "string") {
      await sendMessage({ type: "DELETE_PROMPT", promptId: r.id });
    }
  }

  for (const p of prompts) {
    await sendMessage({ type: "SAVE_PROMPT", prompt: p });
  }

  return { promptCount: prompts.length };
}

/** Merges prompts from a SQLite ZIP (no deletions). */
export async function mergePromptsFromSqliteZip(file: File): Promise<{ promptCount: number }> {
  const prompts = await extractPromptsBundle(file);
  for (const p of prompts) {
    await sendMessage({ type: "SAVE_PROMPT", prompt: p });
  }
  return { promptCount: prompts.length };
}

/**
 * Verifies that `blob` is a real ZIP container (PKZIP local-file-header
 * signature `50 4B 03 04`) and not, e.g., a JSON payload mistakenly
 * routed through the download path. Empty / spanned / encrypted-only
 * archives (`PK 05 06`, `PK 07 08`) are rejected too — every export in
 * this codebase always writes at least one file entry, so seeing those
 * markers means the build pipeline broke upstream.
 *
 * Throws a clear, user-facing Error on mismatch so the caller can
 * surface it via toast instead of silently producing a corrupt download.
 */
async function assertIsZipBlob(blob: Blob, context: string): Promise<void> {
  // sql.js + JSZip never produce blobs smaller than the 30-byte local
  // file header, so anything tiny is automatically suspect.
  if (blob.size < 4) {
    throw new Error(
      `${context}: produced blob is ${blob.size} bytes — too small to be a valid ZIP. `
      + `Expected PKZIP signature 'PK\\x03\\x04'. Aborting download to avoid a corrupt file.`,
    );
  }

  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const isLocalFileHeader = header[0] === 0x50 && header[1] === 0x4b
    && header[2] === 0x03 && header[3] === 0x04;
  if (isLocalFileHeader) return;

  // Helpful classification for the most common failure mode: a JSON-shaped
  // payload accidentally piped through the ZIP path.
  const looksLikeJson = header[0] === 0x7b /* { */ || header[0] === 0x5b /* [ */;
  const hex = Array.from(header)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
  const hint = looksLikeJson
    ? "Payload looks like JSON, not a ZIP — the export was likely routed through the wrong serializer."
    : "First 4 bytes do not match the PKZIP local-file-header signature (50 4B 03 04).";
  throw new Error(
    `${context}: produced blob is not a valid ZIP. First bytes: [${hex}]. ${hint}`,
  );
}

async function triggerDownload(blob: Blob, filename: string): Promise<void> {
  await assertIsZipBlob(blob, `Export "${filename}"`);

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
