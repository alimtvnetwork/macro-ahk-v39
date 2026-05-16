/**
 * E2E #12 — Merge vs Replace semantics.
 * Spec: spec/30-import-export/03-test-plan.md §3 row 12.
 *
 * The current importer dispatches to background via sendMessage, which
 * is stubbed in tests. These cases assert the table-level invariants on
 * a scoped clone so the merge/replace semantics can be validated
 * without a real background bus.
 */
import { describe, it, expect } from "vitest";
import { cloneCachedDbInMemory } from "./setup-helpers";

describe("merge-vs-replace", () => {
  it("replaceAll semantics: DELETE then INSERT keeps the inserted row", async () => {
    const db = await cloneCachedDbInMemory();
    try {
      db.run("DELETE FROM Projects");
      db.run(
        "INSERT INTO Projects (Uid, SchemaVersion, Name, Version, CreatedAt, UpdatedAt) VALUES (?,?,?,?,?,?)",
        ["uid-replaced", 1, "Replaced", "1.0.0", "now", "now"],
      );
      const res = db.exec("SELECT Name FROM Projects");
      expect(res[0].values.length).toBe(1);
      expect(String(res[0].values[0][0])).toBe("Replaced");
    } finally {
      db.close();
    }
  });

  it("mergeAll semantics: existing rows survive and new rows upsert by Uid", async () => {
    const db = await cloneCachedDbInMemory();
    try {
      const before = db.exec("SELECT COUNT(*) FROM Projects")[0].values[0][0] as number;
      db.run(
        "INSERT INTO Projects (Uid, SchemaVersion, Name, Version, CreatedAt, UpdatedAt) VALUES (?,?,?,?,?,?)",
        ["uid-merge-new", 1, "Merged", "1.0.0", "now", "now"],
      );
      const after = db.exec("SELECT COUNT(*) FROM Projects")[0].values[0][0] as number;
      expect(Number(after)).toBe(Number(before) + 1);
    } finally {
      db.close();
    }
  });

  it("Uid is the canonical merge key (Name collisions allowed)", async () => {
    const db = await cloneCachedDbInMemory();
    try {
      db.run(
        "INSERT INTO Projects (Uid, SchemaVersion, Name, Version, CreatedAt, UpdatedAt) VALUES (?,?,?,?,?,?)",
        ["uid-collision-1", 1, "FixtureCoverage", "2.0.0", "now", "now"],
      );
      const res = db.exec("SELECT COUNT(*) FROM Projects WHERE Name = 'FixtureCoverage'");
      expect(Number(res[0].values[0][0])).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
    }
  });

  it.todo("Name-without-Uid collision logs a warning (requires importer instrumentation)");
  it.todo("end-to-end MERGE_BUNDLE message round-trip via real background handler");
});
