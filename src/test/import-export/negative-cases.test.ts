/**
 * E2E #11 — Negative cases at the importer boundary.
 * Spec: spec/30-import-export/03-test-plan.md §3 row 11.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { loadCachedBundle } from "./setup-helpers";

async function buildZipWith(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(entries)) {
    zip.file(name, bytes);
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("negative-cases", () => {
  it("loading a corrupt zip throws", async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    await expect(JSZip.loadAsync(garbage)).rejects.toBeTruthy();
  });

  it("a zip missing marco-backup.db is detectable by entry inspection", async () => {
    const zipBytes = await buildZipWith({ "other.txt": new TextEncoder().encode("hi") });
    const zip = await JSZip.loadAsync(zipBytes);
    expect(zip.file("marco-backup.db")).toBeNull();
  });

  it("an extra unknown table in the bundle does not break read of known tables", async () => {
    const { dbBytes } = await loadCachedBundle();
    const SQL = await (await import("sql.js")).default({ locateFile: () => "sql-wasm.wasm" });
    const db = new SQL.Database(new Uint8Array(dbBytes));
    try {
      db.run("CREATE TABLE UnknownExperimental (Id INTEGER PRIMARY KEY, Note TEXT)");
      db.run("INSERT INTO UnknownExperimental (Note) VALUES ('quarantine candidate')");
      const res = db.exec("SELECT COUNT(*) FROM Projects");
      expect(Number(res[0].values[0][0])).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  });

  it.todo("ImportStrictPascalCase=true rejects synthesised snake_case schema (gated reader)");
  it.todo("specific error message when marco-backup.db is missing — snapshot test");
  it.todo("specific error message when SQLite magic is wrong — snapshot test");
});
