#!/usr/bin/env node
/**
 * check-prompt-info-casing.mjs
 *
 * Validates that every standalone-scripts/prompts/{slug}/info.json uses
 * strictly PascalCase keys (no camelCase or snake_case leftovers).
 *
 * Exit 0 = all clean.
 * Exit 1 = at least one file has non-PascalCase keys.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(import.meta.url).replace("file:", ""), "..");
const PROMPTS_DIR = join(ROOT, "standalone-scripts", "prompts");

/** True when every character is ASCII and the first is uppercase A-Z. */
function isPascalCase(key) {
  if (typeof key !== "string" || key.length === 0) return false;
  if (!/^[A-Z]/.test(key)) return false;
  // Allow only alphanumeric characters (no underscores, no hyphens)
  return /^[A-Za-z0-9]+$/.test(key);
}

async function main() {
  const entries = await readdir(PROMPTS_DIR, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );

  let errors = 0;

  for (const folder of folders) {
    const dir = join(PROMPTS_DIR, folder.name);
    let info;
    try {
      info = JSON.parse(
        await readFile(join(dir, "info.json"), "utf-8"),
      );
    } catch (e) {
      console.error("[SKIP] " + folder.name + ": missing or unreadable info.json");
      continue;
    }

    const badKeys = Object.keys(info).filter((k) => !isPascalCase(k));
    if (badKeys.length > 0) {
      console.error(
        "[FAIL] " + folder.name + "/info.json has non-PascalCase keys: " + badKeys.join(", "),
      );
      errors += 1;
    }
  }

  if (errors > 0) {
    console.error("\n[FAIL] " + errors + " prompt info.json file(s) have casing violations.");
    console.error("       All top-level keys must be PascalCase (e.g. Id, Title, CreatedAt).");
    process.exit(1);
  }

  console.log("[OK] " + folders.length + " prompt info.json files are PascalCase-compliant.");
}

main().catch((err) => {
  console.error("[FAIL] check-prompt-info-casing crashed:", err);
  process.exit(1);
});
