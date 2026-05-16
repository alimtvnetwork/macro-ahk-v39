/**
 * E2E #8 — Prompt resolver + mutation-scope tests.
 * Spec: spec/30-import-export/03-test-plan.md §3 row 8.
 *
 * The full 14-prompt MD round-trip + Save/Modify/Delete coverage will
 * land in a follow-up that wires `scripts/aggregate-prompts.mjs` output
 * into the fixture. This file ships the resolver contract + scoped
 * mutation primitives so the suite has a stable target.
 */
import { describe, it, expect } from "vitest";
import { cloneCachedDbInMemory, openCachedDb, loadCachedBundle } from "./setup-helpers";
import { PromptOperationKind } from "./enums";

function resolvePromptBySlug(db: Awaited<ReturnType<typeof openCachedDb>>, slug: string): string | null {
  const res = db.exec("SELECT Text FROM Prompts WHERE Slug = ?", [slug]);
  const v = res[0]?.values[0]?.[0];
  return typeof v === "string" ? v : null;
}

describe("prompt-resolver", () => {
  it("resolves every fixture slug to its Text body", async () => {
    const { fixture } = await loadCachedBundle();
    const db = await openCachedDb();
    try {
      for (const p of fixture.prompts) {
        expect(resolvePromptBySlug(db, p.slug ?? "")).toBe(p.text);
      }
    } finally {
      db.close();
    }
  });

  it("returns null for an unknown slug", async () => {
    const db = await openCachedDb();
    try {
      expect(resolvePromptBySlug(db, "does-not-exist")).toBeNull();
    } finally {
      db.close();
    }
  });

  it(`PromptOperationKind.${PromptOperationKind.Save} inserts a new row in a scoped DB`, async () => {
    const db = await cloneCachedDbInMemory();
    try {
      db.run(
        "INSERT INTO Prompts (Uid, Slug, Name, Text, RunOrder, CreatedAt, UpdatedAt) VALUES (?,?,?,?,?,?,?)",
        ["new-uid", "new-slug", "New", "body", 99, "now", "now"],
      );
      expect(resolvePromptBySlug(db, "new-slug")).toBe("body");
    } finally {
      db.close();
    }
  });

  it(`PromptOperationKind.${PromptOperationKind.Modify} updates Text in a scoped DB`, async () => {
    const { fixture } = await loadCachedBundle();
    const db = await cloneCachedDbInMemory();
    try {
      const slug = fixture.prompts[0].slug ?? "";
      db.run("UPDATE Prompts SET Text = ? WHERE Slug = ?", ["MODIFIED", slug]);
      expect(resolvePromptBySlug(db, slug)).toBe("MODIFIED");
    } finally {
      db.close();
    }
  });

  it(`PromptOperationKind.${PromptOperationKind.Delete} removes a row in a scoped DB`, async () => {
    const { fixture } = await loadCachedBundle();
    const db = await cloneCachedDbInMemory();
    try {
      const slug = fixture.prompts[0].slug ?? "";
      db.run("DELETE FROM Prompts WHERE Slug = ?", [slug]);
      expect(resolvePromptBySlug(db, slug)).toBeNull();
    } finally {
      db.close();
    }
  });

  it.todo("full 14-prompt MD↔SQLite byte-equality (wired via aggregate-prompts.mjs)");
});
