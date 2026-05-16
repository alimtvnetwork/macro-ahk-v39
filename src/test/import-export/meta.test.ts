/**
 * E2E #9 — Meta table contract.
 * Spec: spec/30-import-export/03-test-plan.md §3 row 9.
 */
import { describe, it, expect } from "vitest";
import { openCachedDb } from "./setup-helpers";

describe("meta", () => {
  it("Meta has an exported_at row with an ISO-8601 timestamp", async () => {
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT Value FROM Meta WHERE Key = 'exported_at'");
      const v = String(res[0]?.values[0]?.[0] ?? "");
      expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      db.close();
    }
  });

  it("Meta has a format_version row whose integer value is >= 4", async () => {
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT Value FROM Meta WHERE Key = 'format_version'");
      const v = parseInt(String(res[0]?.values[0]?.[0] ?? "0"), 10);
      expect(v).toBeGreaterThanOrEqual(4);
    } finally {
      db.close();
    }
  });
});
