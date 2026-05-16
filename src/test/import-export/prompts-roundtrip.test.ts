/**
 * E2E #7 — Prompts round-trip (fixture-side, not full 14-prompt MD scan).
 * Spec: spec/30-import-export/03-test-plan.md §3 row 7.
 */
import { describe, it, expect } from "vitest";
import { openCachedDb, loadCachedBundle } from "./setup-helpers";

describe("prompts-roundtrip", () => {
  it("every fixture prompt is present in Prompts table by Slug", async () => {
    const { fixture } = await loadCachedBundle();
    const db = await openCachedDb();
    try {
      for (const p of fixture.prompts) {
        const res = db.exec("SELECT Name FROM Prompts WHERE Slug = ?", [p.slug ?? ""]);
        expect(res[0]?.values.length, `prompt '${p.slug}' missing`).toBe(1);
      }
    } finally {
      db.close();
    }
  });

  it("Text column is byte-equal to fixture text", async () => {
    const { fixture } = await loadCachedBundle();
    const db = await openCachedDb();
    try {
      for (const p of fixture.prompts) {
        const res = db.exec("SELECT Text FROM Prompts WHERE Slug = ?", [p.slug ?? ""]);
        expect(String(res[0].values[0][0])).toBe(p.text);
      }
    } finally {
      db.close();
    }
  });

  it("IsDefault / IsFavorite flags preserved as 0/1", async () => {
    const { fixture } = await loadCachedBundle();
    const db = await openCachedDb();
    try {
      for (const p of fixture.prompts) {
        const res = db.exec(
          "SELECT IsDefault, IsFavorite FROM Prompts WHERE Slug = ?",
          [p.slug ?? ""],
        );
        const row = res[0].values[0];
        expect(Number(row[0])).toBe(p.isDefault ? 1 : 0);
        expect(Number(row[1])).toBe(p.isFavorite ? 1 : 0);
      }
    } finally {
      db.close();
    }
  });

  it("Category preserved when set", async () => {
    const { fixture } = await loadCachedBundle();
    const db = await openCachedDb();
    try {
      for (const p of fixture.prompts) {
        if (!p.category) continue;
        const res = db.exec("SELECT Category FROM Prompts WHERE Slug = ?", [p.slug ?? ""]);
        expect(String(res[0].values[0][0])).toBe(p.category);
      }
    } finally {
      db.close();
    }
  });

  it("RunOrder column is monotonically non-decreasing for the fixture rows", async () => {
    const db = await openCachedDb();
    try {
      const res = db.exec("SELECT RunOrder FROM Prompts ORDER BY Id ASC");
      let prev = -Infinity;
      for (const row of res[0]?.values ?? []) {
        const v = Number(row[0]);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    } finally {
      db.close();
    }
  });

  it("Uid carries the original runtime id", async () => {
    const { fixture } = await loadCachedBundle();
    const db = await openCachedDb();
    try {
      for (const p of fixture.prompts) {
        const res = db.exec("SELECT Uid FROM Prompts WHERE Slug = ?", [p.slug ?? ""]);
        expect(String(res[0].values[0][0])).toBe(p.id);
      }
    } finally {
      db.close();
    }
  });
});
