/**
 * E2E — v6 first-class Dependencies + Variables tables.
 *
 * Verifies:
 *   - Dependencies + Variables tables exist in every emitted bundle.
 *   - Each row in Projects.Dependencies JSON blob has a matching
 *     Dependencies row (dual-write for backward compat).
 *   - Projects.SchemaVersion bumped to 2 on emit.
 *   - Meta.format_version is "6".
 *
 * Spec: plan.md §"Follow-ups" item 2 (v6 row-table promotion).
 */
import { describe, it, expect } from "vitest";
import { openCachedDb, loadCachedBundle } from "./setup-helpers";

describe("v6-row-tables", () => {
  it("Meta.format_version is '6'", async () => {
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT Value FROM Meta WHERE Key = 'format_version'");
      expect(String(res[0].values[0][0])).toBe("6");
    } finally {
      db.close();
    }
  });

  it("Projects.SchemaVersion is bumped to 2 on emit", async () => {
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT SchemaVersion FROM Projects");
      for (const row of res[0].values) {
        expect(Number(row[0])).toBeGreaterThanOrEqual(2);
      }
    } finally {
      db.close();
    }
  });

  it("Dependencies table exists with one row per fixture dependency", async () => {
    const { fixture } = await loadCachedBundle();
    const db = await openCachedDb();
    try {
      const res = db.exec(
        "SELECT ProjectUid, DependsOnProjectId, Version FROM Dependencies " +
        "WHERE ProjectUid = ?",
        [fixture.projects[0].id],
      );
      const rows = (res[0]?.values ?? []).map((r) => ({
        projectId: String(r[1]),
        version: String(r[2]),
      }));
      expect(rows).toEqual([{ projectId: "dep-a", version: "1.0.0" }]);
    } finally {
      db.close();
    }
  });

  it("Variables table exists (may be empty if fixture stores variables as JSON string)", async () => {
    const db = await openCachedDb();
    try {
      // PRAGMA introspection — does NOT depend on row count.
      const res = db.exec("PRAGMA table_info(\"Variables\")");
      const cols = (res[0]?.values ?? []).map((r) => String(r[1]));
      expect(cols).toContain("ProjectUid");
      expect(cols).toContain("Name");
      expect(cols).toContain("Value");
    } finally {
      db.close();
    }
  });

  it("Projects.Dependencies JSON blob is still emitted (backward compat for v4/v5 readers)", async () => {
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT Dependencies FROM Projects");
      const raw = String(res[0].values[0][0]);
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toEqual([{ projectId: "dep-a", version: "1.0.0" }]);
    } finally {
      db.close();
    }
  });
});
