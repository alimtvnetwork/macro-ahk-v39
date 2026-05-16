/**
 * Setup helper: runs the REAL exporter + importer once, caches the bytes.
 *
 * Mocks:
 *   - `@/lib/message-client::sendMessage`  → returns fixture data
 *   - `globalThis.fetch`                   → serves node_modules sql-wasm.wasm
 *   - `URL.createObjectURL`                → captures the produced Blob
 *
 * The cached output is:
 *   { zipBytes: Uint8Array, dbBytes: Uint8Array, imported: ImportResult }
 *
 * Called from each test file via `await loadCachedBundle()`. The first
 * call performs the work and stores the result on a module-level
 * promise; subsequent calls re-use the same promise (per-worker cache).
 *
 * Spec: spec/30-import-export/03-test-plan.md §1, §4.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import initSqlJs, { type Database } from "sql.js";
import { vi } from "vitest";

import { buildFullFixture, type FixtureBundle } from "./build-fixture";

/* ─── 1. Mock the chrome bridge BEFORE importing sqlite-bundle. ─── */
//
// `vi.mock` is hoisted to the top of the module by Vitest, so the
// sqlite-bundle import below transparently picks up the stub.
const fixture = buildFullFixture();
vi.mock("@/lib/message-client", () => ({
  sendMessage: async <T = unknown>(req: { type: string }): Promise<T> => {
    switch (req.type) {
      case "GET_ALL_PROJECTS":
        return { projects: fixture.projects } as T;
      case "GET_ALL_SCRIPTS":
        return { scripts: fixture.scripts } as T;
      case "GET_ALL_CONFIGS":
        return { configs: fixture.configs } as T;
      case "GET_PROMPTS":
        return { prompts: fixture.prompts } as T;
      case "REPLACE_ALL_BUNDLE":
      case "MERGE_BUNDLE":
        // Importer dispatches a 'write' message to background; return ok.
        return { ok: true } as T;
      default:
        return { ok: true } as T;
    }
  },
}));

/* ─── 2. WASM loader shim — sql.js fetches sql-wasm.wasm by URL. ─── */
function installWasmFetchShim(): void {
  const wasmPath = resolve(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const originalFetch: typeof fetch | undefined = globalThis.fetch?.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("sql-wasm.wasm")) {
      return new Response(wasmBytes, {
        status: 200,
        headers: { "Content-Type": "application/wasm" },
      });
    }
    if (originalFetch) {
      return originalFetch(input, init);
    }
    throw new Error(`fetch shim: unexpected URL ${url}`);
  }) as typeof fetch;
}

/* ─── 3. URL.createObjectURL capture. ─── */
const capturedBlobs: Blob[] = [];
function installObjectUrlCapture(): void {
  let counter = 0;
  globalThis.URL.createObjectURL = (blob: Blob): string => {
    capturedBlobs.push(blob);
    counter += 1;
    return `blob:fixture-${counter}`;
  };
  globalThis.URL.revokeObjectURL = (): void => { /* noop in tests */ };
}

/* ─── 4. Cached fixture promise (per worker). ─── */
export interface CachedBundle {
  zipBytes: Uint8Array;
  dbBytes: Uint8Array;
  fixture: FixtureBundle;
  importResult: unknown;
}

let cachedPromise: Promise<CachedBundle> | null = null;

export function loadCachedBundle(): Promise<CachedBundle> {
  if (cachedPromise === null) {
    cachedPromise = buildCachedBundle();
  }
  return cachedPromise;
}

async function buildCachedBundle(): Promise<CachedBundle> {
  installWasmFetchShim();
  installObjectUrlCapture();
  capturedBlobs.length = 0;

  // Dynamic import AFTER vi.mock + shims so the module picks up the stub.
  const sqliteBundle = await import("@/lib/sqlite-bundle");

  // ── Export ────────────────────────────────────────────────────────
  await sqliteBundle.exportAllAsSqliteZip();
  if (capturedBlobs.length === 0) {
    throw new Error(
      "loadCachedBundle: exportAllAsSqliteZip() did not produce a Blob via URL.createObjectURL",
    );
  }
  const exportBlob = capturedBlobs[capturedBlobs.length - 1];
  const zipBytes = new Uint8Array(await exportBlob.arrayBuffer());

  // Extract the inner SQLite file for direct schema/data assertions.
  const JSZipMod = await import("jszip");
  const JSZipCtor = JSZipMod.default;
  const zip = await JSZipCtor.loadAsync(zipBytes);
  const dbEntry = zip.file("marco-backup.db");
  if (!dbEntry) {
    throw new Error("loadCachedBundle: zip is missing marco-backup.db entry");
  }
  const dbBytes = new Uint8Array(await dbEntry.async("uint8array"));

  // ── Import (round-trip) ───────────────────────────────────────────
  // importFromSqliteZip expects a File. jsdom exposes File globally.
  const file = new File([zipBytes], "marco-backup.zip", { type: "application/zip" });
  let importResult: unknown = null;
  try {
    importResult = await sqliteBundle.importFromSqliteZip(file);
  } catch (err) {
    // The importer writes back through sendMessage which is stubbed to
    // { ok: true }. Some integration paths still throw on parse — that's
    // a real signal we want surfaced.
    importResult = { error: err instanceof Error ? err.message : String(err) };
  }

  return { zipBytes, dbBytes, fixture, importResult };
}

/* ─── 5. Helper: open the cached DB read-only via sql.js. ─── */
export async function openCachedDb(): Promise<Database> {
  const { dbBytes } = await loadCachedBundle();
  const SQL = await initSqlJs({ locateFile: () => "sql-wasm.wasm" });
  return new SQL.Database(dbBytes);
}

/* ─── 6. Helper: clone the cached DB for mutation tests. ─── */
export async function cloneCachedDbInMemory(): Promise<Database> {
  const { dbBytes } = await loadCachedBundle();
  const SQL = await initSqlJs({ locateFile: () => "sql-wasm.wasm" });
  return new SQL.Database(new Uint8Array(dbBytes));
}
