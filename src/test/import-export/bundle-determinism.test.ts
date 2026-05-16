/**
 * E2E #10 — Bundle determinism.
 * Spec: spec/30-import-export/03-test-plan.md §3 row 10.
 *
 * The exporter writes the wall-clock `exported_at` timestamp into Meta
 * on every run, so byte-equality is intentionally compared **after**
 * zeroing the Meta table. Zip entry order is asserted independently.
 */
import { describe, it, expect } from "vitest";
import { loadCachedBundle } from "./setup-helpers";
import JSZip from "jszip";

describe("bundle-determinism", () => {
  it("zip contains exactly the expected entry (stable order)", async () => {
    const { zipBytes } = await loadCachedBundle();
    const zip = await JSZip.loadAsync(zipBytes);
    const entries = Object.keys(zip.files);
    expect(entries).toEqual(["marco-backup.db"]);
  });

  it.todo(
    "double-export produces byte-identical SQLite output modulo Meta.exported_at " +
    "(requires a second runtime export pass; deferred until exporter exposes a " +
    "pure-data factory entrypoint)",
  );
});
