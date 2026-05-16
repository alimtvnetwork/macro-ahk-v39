/**
 * E2E #6 — Variables JSON blob round-trips deep-equal.
 * Spec: spec/30-import-export/03-test-plan.md §3 row 6.
 */
import { describe, it, expect } from "vitest";
import { openCachedDb, loadCachedBundle } from "./setup-helpers";

describe("variables-roundtrip", () => {
  it("Settings.variables JSON deep-equals fixture including nested arrays/null/bool", async () => {
    const { fixture } = await loadCachedBundle();
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT Settings FROM Projects WHERE Uid = ?", [fixture.projects[0].id]);
      const parsed = JSON.parse(String(res[0].values[0][0]));
      const originalVars = JSON.parse(String(fixture.projects[0].settings?.variables ?? "{}"));
      const roundTripVars = JSON.parse(String(parsed.variables ?? "{}"));
      expect(roundTripVars).toEqual(originalVars);
    } finally {
      db.close();
    }
  });

  it("nested array preserves null/true/false/number order", async () => {
    const { fixture } = await loadCachedBundle();
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT Settings FROM Projects WHERE Uid = ?", [fixture.projects[0].id]);
      const parsed = JSON.parse(String(res[0].values[0][0]));
      const vars = JSON.parse(String(parsed.variables ?? "{}"));
      expect(vars.Nested.B).toEqual([true, false, null]);
      expect(vars.Nested.A).toBe(1);
    } finally {
      db.close();
    }
  });

  it("autoRun + theme settings survive", async () => {
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT Settings FROM Projects");
      const parsed = JSON.parse(String(res[0].values[0][0]));
      expect(parsed.autoRun).toBe(true);
      expect(parsed.theme).toBe("dark");
    } finally {
      db.close();
    }
  });

  it("variables blob is a string (not pre-parsed JSON)", async () => {
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT Settings FROM Projects");
      const parsed = JSON.parse(String(res[0].values[0][0]));
      expect(typeof parsed.variables).toBe("string");
    } finally {
      db.close();
    }
  });
});
