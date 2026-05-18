/**
 * Marco Extension — End-to-End Bundle Round-Trip Test
 *
 * Drives `src/lib/sqlite-bundle.ts` through a full export → import cycle
 * against an in-memory mocked message store. Verifies that every artifact
 * kind the bundle is contracted to carry (Projects, Scripts, Configs,
 * Prompts, Meta) survives a round-trip through the SQLite + JSZip pipeline
 * intact.
 *
 * What this protects against (regressions caught here):
 *   - Casing drift between INSERT and SELECT column names.
 *   - JSON-encoded sub-fields (TargetUrls / Scripts / Configs / CookieRules
 *     / Settings) silently re-shaped during stringify→parse.
 *   - Numeric ↔ boolean coercion regressions on IsIife / HasDomUsage /
 *     IsDefault / IsFavorite.
 *   - Bundle validator mistakenly rejecting a bundle this very build just
 *     produced (i.e. self-incompatibility — the worst possible regression).
 *   - Zip envelope shape — the file is named `marco-backup.db` inside
 *     `marco-backup.zip`, both ends.
 *
 * Why integration-style + jsdom (not Playwright):
 *   - The bundle code is pure (no chrome.* surface). Round-tripping it
 *     through a real extension build would add ~30s for zero extra
 *     coverage. Playwright E2E-18 still owns the user-flow side.
 *   - sql.js is loaded with `locateFile` pointing at the in-package WASM
 *     so no network call is needed.
 *
 * Format version pinned: '4' (PascalCase contract).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

/* ------------------------------------------------------------------ */
/*  Mock #1 — in-memory message store                                  */
/* ------------------------------------------------------------------ */

import type {
  StoredProject,
  StoredScript,
  StoredConfig,
} from "@/hooks/use-projects-scripts";
import type { PromptEntry } from "@/hooks/use-prompts";

interface MockStore {
  projects: StoredProject[];
  scripts: StoredScript[];
  configs: StoredConfig[];
  prompts: PromptEntry[];
}

let store: MockStore = { projects: [], scripts: [], configs: [], prompts: [] };

vi.mock("@/lib/message-client", () => ({
  sendMessage: vi.fn(async (msg: { type: string; [k: string]: unknown }) => {
    switch (msg.type) {
      case "GET_ALL_PROJECTS": return { projects: store.projects };
      case "GET_ALL_SCRIPTS":  return { scripts:  store.scripts  };
      case "GET_ALL_CONFIGS":  return { configs:  store.configs  };
      case "GET_PROMPTS":      return { prompts:  store.prompts  };
      case "SAVE_PROJECT": {
        const p = msg.project as StoredProject;
        store.projects = store.projects.filter((x) => x.id !== p.id).concat(p);
        return {};
      }
      case "SAVE_SCRIPT": {
        const s = msg.script as StoredScript;
        store.scripts = store.scripts.filter((x) => x.id !== s.id).concat(s);
        return {};
      }
      case "SAVE_CONFIG": {
        const c = msg.config as StoredConfig;
        store.configs = store.configs.filter((x) => x.id !== c.id).concat(c);
        return {};
      }
      case "SAVE_PROMPT": {
        const p = msg.prompt as PromptEntry;
        store.prompts = store.prompts.filter((x) => x.id !== p.id).concat(p);
        return {};
      }
      case "DELETE_PROJECT":
        store.projects = store.projects.filter((x) => x.id !== msg.projectId);
        return {};
      case "DELETE_SCRIPT":
        store.scripts = store.scripts.filter((x) => x.id !== msg.id);
        return {};
      case "DELETE_CONFIG":
        store.configs = store.configs.filter((x) => x.id !== msg.id);
        return {};
      case "DELETE_PROMPT":
        store.prompts = store.prompts.filter((x) => x.id !== msg.promptId);
        return {};
      default:
        throw new Error(`Mock store: unhandled message type "${msg.type}"`);
    }
  }),
}));

/* ------------------------------------------------------------------ */
/*  Mock #2 — sql.js locateFile (point at local node_modules WASM)     */
/* ------------------------------------------------------------------ */
/**
 * `sqlite-bundle.ts` hard-codes `WASM_URL = "https://sql.js.org/dist/sql-wasm.wasm"`.
 * jsdom can't fetch that. We intercept `initSqlJs` and override `locateFile`
 * so it loads the WASM from the locally-installed `sql.js` package.
 */
vi.mock("sql.js", async () => {
  const real = await vi.importActual<typeof import("sql.js")>("sql.js");
  const realInit = real.default;
  const wasmDir = resolvePath(
    resolvePath(__dirname, "../../../node_modules/sql.js/dist"),
  );
  const localInit: typeof realInit = ((cfg) =>
    realInit({
      ...(cfg ?? {}),
      // Always resolve from the local install — ignore the caller's URL.
      locateFile: (file: string) => resolvePath(wasmDir, file),
    })) as typeof realInit;
  return { ...real, default: localInit };
});

/**
 * jsdom won't fetch wasm via URL — but `sql.js` itself reads WASM through
 * `locateFile` (which we just remapped to a filesystem path). On Node it
 * uses `fs.readFileSync`, no fetch needed. We still install a no-op fetch
 * stub so any unrelated URL access throws a clear, fast error rather than
 * hanging the test.
 */
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = String(input);
      if (path.endsWith(".wasm")) {
        const buf = readFileSync(
          resolvePath(__dirname, "../../../node_modules/sql.js/dist/sql-wasm.wasm"),
        );
        return new Response(buf, { status: 200 });
      }
      throw new Error(`Unexpected fetch in test: ${path}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  store = { projects: [], scripts: [], configs: [], prompts: [] };
});

/* ------------------------------------------------------------------ */
/*  Mock #3 — `triggerDownload` capture                                */
/* ------------------------------------------------------------------ */
/**
 * The exporter ends with a DOM <a download> click. In jsdom that is a
 * no-op, but we want the raw Blob so we can feed it back into the
 * importer as a `File`. We capture the most recent Blob via a
 * `URL.createObjectURL` spy — that's the only side-effect we need.
 */
let lastExportedBlob: Blob | null = null;
beforeEach(() => {
  lastExportedBlob = null;
  // jsdom provides URL.createObjectURL but not always — provide a stub
  // that records the blob and returns a fake URL.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (b: Blob) => {
      lastExportedBlob = b;
      return "blob:test/" + Math.random().toString(36).slice(2);
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
});

/* ------------------------------------------------------------------ */
/*  Imports under test (after mocks are registered)                    */
/* ------------------------------------------------------------------ */

import {
  exportAllAsSqliteZip,
  importFromSqliteZip,
} from "@/lib/sqlite-bundle";
import initSqlJs from "sql.js";

/* ------------------------------------------------------------------ */
/*  Fixture                                                            */
/* ------------------------------------------------------------------ */

/**
 * One project that exercises every column the contract carries:
 * deeply-nested JSON arrays, optional fields populated, boolean ↔
 * integer fields set to BOTH true and false, and unicode in text.
 */
function buildFixture(): MockStore {
  const now = "2026-04-24T08:30:00.000Z";

  const project: StoredProject = {
    id: "proj-uid-1",
    schemaVersion: 2,
    slug: "round-trip-fixture",
    name: "Round-Trip Fixture",
    version: "1.2.3",
    description: "Exercises every bundle column — 中文 / emoji 🚀",
    targetUrls: [
      { pattern: "https://lovable.dev/*", matchType: "wildcard" },
      { pattern: "https://example.com/foo", matchType: "exact" },
    ],
    scripts: [
      { path: "scripts/main.js", order: 0, runAt: "document_idle", configBinding: "cfg-uid-1" },
      { path: "scripts/late.js", order: 1, runAt: "document_end" },
    ],
    configs: [{ path: "configs/app.json", description: "App config" }],
    // v5 — modern cookie bindings AND deprecated cookieRules in the SAME
    // fixture so the round-trip can prove both columns survive independently.
    cookies: [
      { cookieName: "sessionid", url: "https://example.com", role: "session" },
      { cookieName: "refresh", url: "https://example.com", role: "refresh", description: "rotates daily" },
    ],
    cookieRules: [],
    dependencies: [
      { projectId: "shared-utils", version: "^2.1.0" },
    ],
    settings: { isolateScripts: true, logLevel: "info", retryOnNavigate: false },
    isGlobal: true,
    isRemovable: false,
    createdAt: now,
    updatedAt: now,
  };

  const scripts: StoredScript[] = [
    {
      id: "scr-uid-1",
      name: "scripts/main.js",
      description: "Main entry",
      code: "console.log('hello');",
      order: 0,
      runAt: "document_idle",
      configBinding: "cfg-uid-1",
      isIife: true,
      hasDomUsage: false,
      // v5 — auto-update fields must survive round-trip.
      updateUrl: "https://example.com/scripts/main.user.js",
      lastUpdateCheck: "2026-04-23T12:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "scr-uid-2",
      name: "scripts/late.js",
      code: "document.title = 'x';",
      order: 1,
      runAt: "document_end",
      isIife: false,
      hasDomUsage: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const configs: StoredConfig[] = [
    {
      id: "cfg-uid-1",
      name: "configs/app.json",
      description: "App config",
      json: JSON.stringify({ apiBase: "https://api.example.com", retries: 3 }),
      createdAt: now,
      updatedAt: now,
    },
  ];

  const prompts: PromptEntry[] = [
    {
      id: "prm-uid-1",
      // v5 — Slug must round-trip; the Task Next resolver looks up by slug.
      slug: "next-tasks",
      name: "Next Tasks",
      text: "Continue with the next task in the list.",
      order: 0,
      isDefault: false,
      isFavorite: true,
      category: "automation",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "prm-uid-2",
      name: "Default Welcome",
      text: "Hello!",
      order: 1,
      isDefault: true,
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return { projects: [project], scripts, configs, prompts };
}

/* ------------------------------------------------------------------ */
/*  The test                                                           */
/* ------------------------------------------------------------------ */

describe("sqlite-bundle — full round-trip", () => {
  it("exports a fixture project to a single-DB zip and imports it intact into a clean workspace",
    // eslint-disable-next-line sonarjs/cognitive-complexity -- single integration test asserting every contracted field
    async () => {
    /* ---- 1. Seed source workspace ---- */
    const fixture = buildFixture();
    store = structuredClone(fixture);

    /* ---- 2. Export ---- */
    await exportAllAsSqliteZip();
    expect(lastExportedBlob, "exporter should produce a Blob").not.toBeNull();
    const exportedBlob = lastExportedBlob!;
    expect(exportedBlob.size).toBeGreaterThan(0);

    /* ---- 3. Confirm zip envelope shape (one .db inside) ---- */
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await exportedBlob.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names, "zip should contain exactly one entry").toEqual(["marco-backup.db"]);

    /* ---- 4. Wipe workspace ---- */
    store = { projects: [], scripts: [], configs: [], prompts: [] };

    /* ---- 5. Import the same zip as a File ---- */
    const file = new File([exportedBlob], "marco-backup.zip", { type: "application/zip" });
    const result = await importFromSqliteZip(file);

    /* ---- 6. Counts (v5: prompts now part of full round-trip) ---- */
    expect(result).toEqual({
      projectCount: fixture.projects.length,
      scriptCount: fixture.scripts.length,
      configCount: fixture.configs.length,
      promptCount: fixture.prompts.length,
    });

    /* ---- 7. Per-artifact deep equality ---- */
    expect(store.projects).toHaveLength(fixture.projects.length);
    expect(store.scripts).toHaveLength(fixture.scripts.length);
    expect(store.configs).toHaveLength(fixture.configs.length);
    expect(store.prompts).toHaveLength(fixture.prompts.length);

    const byId = <T extends { id: string }>(xs: T[]) =>
      Object.fromEntries(xs.map((x) => [x.id, x]));

    /* Projects — every contracted field must come back identical, INCLUDING
     * the v5 additions (slug / cookies / dependencies / isGlobal /
     * isRemovable). Each of these was a documented data-loss bug pre-v5
     * and the audit's "P-1 / P-2 / P-3 / P-4" findings. */
    const importedProject = byId(store.projects)["proj-uid-1"];
    const sourceProject = fixture.projects[0];
    expect(importedProject).toMatchObject({
      id: sourceProject.id,
      schemaVersion: sourceProject.schemaVersion,
      name: sourceProject.name,
      slug: sourceProject.slug,
      version: sourceProject.version,
      description: sourceProject.description,
      targetUrls: sourceProject.targetUrls,
      scripts: sourceProject.scripts,
      configs: sourceProject.configs,
      cookies: sourceProject.cookies,
      cookieRules: sourceProject.cookieRules,
      dependencies: sourceProject.dependencies,
      settings: sourceProject.settings,
      isGlobal: sourceProject.isGlobal,
      isRemovable: sourceProject.isRemovable,
      createdAt: sourceProject.createdAt,
      updatedAt: sourceProject.updatedAt,
    });

    /* Scripts — boolean flags, optional fields, AND v5 update fields. */
    for (const src of fixture.scripts) {
      const imp = byId(store.scripts)[src.id];
      expect(imp, `script ${src.id} survived round-trip`).toBeDefined();
      expect(imp).toMatchObject({
        id: src.id,
        name: src.name,
        code: src.code,
        order: src.order,
        isIife: src.isIife ?? false,
        hasDomUsage: src.hasDomUsage ?? false,
        createdAt: src.createdAt,
        updatedAt: src.updatedAt,
      });
      // Optional fields — only assert when the source had them.
      if (src.description !== undefined) expect(imp.description).toBe(src.description);
      if (src.runAt !== undefined) expect(imp.runAt).toBe(src.runAt);
      if (src.configBinding !== undefined) expect(imp.configBinding).toBe(src.configBinding);
      // v5 — auto-update path. Pre-v5, both fields silently became undefined.
      if (src.updateUrl !== undefined) expect(imp.updateUrl).toBe(src.updateUrl);
      if (src.lastUpdateCheck !== undefined) expect(imp.lastUpdateCheck).toBe(src.lastUpdateCheck);
    }

    /* Configs — JSON column must round-trip byte-identical. */
    for (const src of fixture.configs) {
      const imp = byId(store.configs)[src.id];
      expect(imp).toMatchObject({
        id: src.id,
        name: src.name,
        description: src.description,
        json: src.json,
        createdAt: src.createdAt,
        updatedAt: src.updatedAt,
      });
    }

    /* Prompts — full restore via mock store (was DB-only pre-v5). The Slug
     * field is the headline v5 fix because the Task Next resolver keys on it. */
    for (const src of fixture.prompts) {
      const imp = byId(store.prompts)[src.id];
      expect(imp, `prompt ${src.id} restored to message store`).toBeDefined();
      expect(imp).toMatchObject({
        id: src.id,
        name: src.name,
        text: src.text,
        order: src.order,
        isDefault: src.isDefault ?? false,
        isFavorite: src.isFavorite ?? false,
        createdAt: src.createdAt,
        updatedAt: src.updatedAt,
      });
      if (src.slug !== undefined) expect(imp.slug).toBe(src.slug);
      if (src.category !== undefined) expect(imp.category).toBe(src.category);
    }

    /* ---- 8. Direct DB inspection — Meta + raw column shape ---- */
    const dbBuf = await zip.file("marco-backup.db")!.async("uint8array");
    const SQL = await initSqlJs({
      locateFile: (f: string) =>
        resolvePath(__dirname, "../../../node_modules/sql.js/dist", f),
    });
    const db = new SQL.Database(dbBuf);

    /* Prompts — every PascalCase column must be present and accurate at
     * the SQLite layer too (belt + braces against a future read regression). */
    const promptsRows = db.exec(
      "SELECT Uid, Slug, Name, Text, RunOrder, IsDefault, IsFavorite, Category " +
      "FROM Prompts ORDER BY RunOrder",
    );
    expect(promptsRows[0]?.values, "Prompts table populated").toHaveLength(
      fixture.prompts.length,
    );
    const promptByUid = new Map(
      promptsRows[0].values.map((row) => [String(row[0]), row]),
    );
    for (const src of fixture.prompts) {
      const row = promptByUid.get(src.id);
      expect(row, `prompt ${src.id} present in exported DB`).toBeDefined();
      const [, slug, name, text, runOrder, isDefault, isFavorite, category] = row!;
      expect(slug ?? null).toBe(src.slug ?? null);
      expect(name).toBe(src.name);
      expect(text).toBe(src.text);
      expect(Number(runOrder)).toBe(src.order);
      expect(Number(isDefault)).toBe(src.isDefault ? 1 : 0);
      expect(Number(isFavorite)).toBe(src.isFavorite ? 1 : 0);
      expect(category ?? null).toBe(src.category ?? null);
    }

    /* Projects — raw-DB inspection of the v5 PascalCase columns that were
     * silently dropped pre-v5 (audit P-1: Cookies, P-2: Dependencies,
     * P-3: IsGlobal/IsRemovable, P-4: Slug). Asserting at the SQLite layer
     * (not just at the importer's parsed output) catches an entire class
     * of regressions where insertProjects drops a column but readProjects
     * happens to reconstruct it from elsewhere. */
    const projectRows = db.exec(
      "SELECT Uid, Slug, Cookies, Dependencies, IsGlobal, IsRemovable " +
      "FROM Projects",
    );
    expect(projectRows[0]?.values, "Projects table populated").toHaveLength(
      fixture.projects.length,
    );
    const projectByUid = new Map(
      projectRows[0].values.map((row) => [String(row[0]), row]),
    );
    for (const src of fixture.projects) {
      const row = projectByUid.get(src.id);
      expect(row, `project ${src.id} present in exported DB`).toBeDefined();
      const [, slug, cookiesJson, depsJson, isGlobal, isRemovable] = row!;
      expect(slug ?? null).toBe(src.slug ?? null);
      // JSON-encoded columns: parse and deep-compare so whitespace / key
      // ordering differences in JSON.stringify don't fail the test.
      expect(JSON.parse(String(cookiesJson))).toEqual(src.cookies ?? []);
      expect(JSON.parse(String(depsJson))).toEqual(src.dependencies ?? []);
      expect(Number(isGlobal)).toBe(src.isGlobal ? 1 : 0);
      expect(Number(isRemovable)).toBe(src.isRemovable === false ? 0 : 1);
    }

    /* Scripts — raw-DB inspection of v5 auto-update columns. Pre-v5 these
     * were never emitted, so the auto-update path was silently disabled
     * after every import. Belt + braces: assert at the SQLite layer too. */
    const scriptRows = db.exec(
      "SELECT Uid, UpdateUrl, LastUpdateCheck FROM Scripts",
    );
    expect(scriptRows[0]?.values, "Scripts table populated").toHaveLength(
      fixture.scripts.length,
    );
    const scriptByUid = new Map(
      scriptRows[0].values.map((row) => [String(row[0]), row]),
    );
    for (const src of fixture.scripts) {
      const row = scriptByUid.get(src.id);
      expect(row, `script ${src.id} present in exported DB`).toBeDefined();
      const [, updateUrl, lastUpdateCheck] = row!;
      expect((updateUrl as string | null) ?? null).toBe(src.updateUrl ?? null);
      expect((lastUpdateCheck as string | null) ?? null).toBe(
        src.lastUpdateCheck ?? null,
      );
    }

    /* Meta — declares format_version='6' (this build's emit version). */
    const metaRows = db.exec(
      "SELECT Key, Value FROM Meta WHERE Key IN ('format_version', 'exported_at')",
    );
    const meta = Object.fromEntries(
      (metaRows[0]?.values ?? []).map((r) => [String(r[0]), String(r[1])]),
    );
    expect(meta.format_version).toBe("6");
    expect(meta.exported_at, "exported_at is an ISO timestamp").toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );

    db.close();
  });
});

/* ------------------------------------------------------------------ */
/*  Strict-reject suite                                                */
/* ------------------------------------------------------------------ */
/**
 * These tests prove `validateBundleSchema` (gated inside `extractBundle`)
 * blocks malformed bundles BEFORE any SAVE_* message reaches the mock
 * store. The success criterion is identical for every case: import throws,
 * AND the store stays empty (i.e. no partial write happened).
 *
 * We build the bad bundles by hand-crafting a sql.js DB and zipping it
 * with JSZip — that's the same envelope shape the real importer expects.
 */

async function buildZipFromDb(buildSchema: (db: import("sql.js").Database) => void): Promise<File> {
  const SQL = await initSqlJs({
    locateFile: (f: string) =>
      resolvePath(__dirname, "../../../node_modules/sql.js/dist", f),
  });
  const db = new SQL.Database();
  buildSchema(db);
  const dbData = db.export();
  db.close();

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("marco-backup.db", dbData);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return new File([blob], "marco-backup.zip", { type: "application/zip" });
}

describe("sqlite-bundle — strict reject", () => {
  it("rejects a bundle missing a required PascalCase table", async () => {
    const file = await buildZipFromDb((db) => {
      // Only Projects + Meta — Scripts and Configs are missing.
      db.run(`CREATE TABLE Projects (
        Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT, Version TEXT,
        CreatedAt TEXT, UpdatedAt TEXT, TargetUrls TEXT, Scripts TEXT,
        Configs TEXT, CookieRules TEXT, Settings TEXT
      )`);
      db.run(`CREATE TABLE Meta (Id INTEGER PRIMARY KEY AUTOINCREMENT, Key TEXT, Value TEXT)`);
      db.run(`INSERT INTO Meta (Key, Value) VALUES ('format_version', '5')`);
    });
    await expect(importFromSqliteZip(file)).rejects.toThrow(/Required table 'Scripts' is missing/);
    expect(store.projects).toHaveLength(0);
    expect(store.scripts).toHaveLength(0);
  });

  it("rejects a bundle that uses legacy snake_case tables (v3 shape)", async () => {
    const file = await buildZipFromDb((db) => {
      db.run(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT)`);
      db.run(`CREATE TABLE scripts (id TEXT PRIMARY KEY, name TEXT, code TEXT)`);
      db.run(`CREATE TABLE configs (id TEXT PRIMARY KEY, name TEXT, json TEXT)`);
      db.run(`CREATE TABLE meta (key TEXT, value TEXT)`);
    });
    await expect(importFromSqliteZip(file)).rejects.toThrow(/LEGACY_SNAKE_CASE/);
    expect(store.projects).toHaveLength(0);
  });

  it("rejects a bundle whose Meta.format_version is not in SUPPORTED_FORMAT_VERSIONS", async () => {
    const file = await buildZipFromDb((db) => {
      // Schema is contract-clean — only the version is bad.
      db.run(`CREATE TABLE Projects (
        Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Version TEXT NOT NULL,
        CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL, TargetUrls TEXT, Scripts TEXT,
        Configs TEXT, CookieRules TEXT, Settings TEXT
      )`);
      db.run(`CREATE TABLE Scripts (
        Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Code TEXT NOT NULL,
        RunOrder INTEGER NOT NULL DEFAULT 0, CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL
      )`);
      db.run(`CREATE TABLE Configs (
        Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Json TEXT NOT NULL,
        CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL
      )`);
      db.run(`CREATE TABLE Meta (Id INTEGER PRIMARY KEY AUTOINCREMENT, Key TEXT UNIQUE NOT NULL, Value TEXT)`);
      db.run(`INSERT INTO Meta (Key, Value) VALUES ('format_version', '99')`);
    });
    await expect(importFromSqliteZip(file)).rejects.toThrow(/UNSUPPORTED_FORMAT_VERSION/);
    expect(store.projects).toHaveLength(0);
  });

  it("rejects a bundle that emits an unknown PascalCase column not in the contract", async () => {
    const file = await buildZipFromDb((db) => {
      db.run(`CREATE TABLE Projects (
        Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Version TEXT NOT NULL,
        CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL, TargetUrls TEXT, Scripts TEXT,
        Configs TEXT, CookieRules TEXT, Settings TEXT,
        MysteryFromTheFuture TEXT
      )`);
      db.run(`CREATE TABLE Scripts (
        Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Code TEXT NOT NULL,
        RunOrder INTEGER NOT NULL DEFAULT 0, CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL
      )`);
      db.run(`CREATE TABLE Configs (
        Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Json TEXT NOT NULL,
        CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL
      )`);
      db.run(`CREATE TABLE Meta (Id INTEGER PRIMARY KEY AUTOINCREMENT, Key TEXT UNIQUE NOT NULL, Value TEXT)`);
      db.run(`INSERT INTO Meta (Key, Value) VALUES ('format_version', '5')`);
    });
    await expect(importFromSqliteZip(file)).rejects.toThrow(/UNKNOWN_COLUMN.*MysteryFromTheFuture/s);
    expect(store.projects).toHaveLength(0);
  });

  it("rejects a zip that does not contain marco-backup.db", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("not-the-bundle.txt", "wrong file");
    const blob = await zip.generateAsync({ type: "blob" });
    const file = new File([blob], "marco-backup.zip", { type: "application/zip" });
    await expect(importFromSqliteZip(file)).rejects.toThrow(/missing marco-backup\.db/);
  });
});
