// Pre-build guard: fails if any standalone-scripts dist folder is
// empty or missing required artifacts.
// Prevents stale bundle regressions where the extension builds against
// non-existent compiled output.
// RCA: spec/02-issues/81-auth-no-token-stale-macro-bundle.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STANDALONE_DIR = path.join(ROOT, "standalone-scripts");

/** Map of project folder → required dist files.
 *
 * `instruction.json` — canonical, PascalCase. As of Phase 2c the
 * transitional `instruction.compat.json` is no longer emitted and is
 * therefore not required here.
 */
const REQUIRED_ARTIFACTS = {
  "marco-sdk": ["marco-sdk.js", "instruction.json"],
  "macro-controller": ["macro-looping.js", "macro-looping.css", "instruction.json"],
  "xpath": ["xpath.js", "instruction.json"],
  "payment-banner-hider": ["payment-banner-hider.js", "payment-banner-hider.css", "instruction.json"],
  "lovable-common": ["lovable-common.js", "instruction.json"],
  "lovable-owner-switch": ["lovable-owner-switch.js", "instruction.json"],
  "lovable-user-add": ["lovable-user-add.js", "instruction.json"],
  "lovable-dashboard": ["lovable-dashboard.js", "instruction.json"],
};

let failed = false;

for (const [project, requiredFiles] of Object.entries(REQUIRED_ARTIFACTS)) {
  const distDir = path.join(STANDALONE_DIR, project, "dist");

  if (!fs.existsSync(distDir)) {
    console.error(`[FAIL] ${project}/dist/ does not exist. Run: npm run build:${project === "marco-sdk" ? "sdk" : project}`);
    failed = true;
    continue;
  }

  const files = fs.readdirSync(distDir);
  if (files.length === 0) {
    console.error(`[FAIL] ${project}/dist/ is empty. Run: npm run build:${project === "marco-sdk" ? "sdk" : project}`);
    failed = true;
    continue;
  }

  for (const required of requiredFiles) {
    const filePath = path.join(distDir, required);
    if (!fs.existsSync(filePath)) {
      console.error(`[FAIL] ${project}/dist/${required} is missing.`);
      failed = true;
      continue;
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 100) {
      console.error(`[FAIL] ${project}/dist/${required} is suspiciously small (${stat.size} bytes).`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("\n[FAIL] Standalone dist artifacts are missing or empty. Build them before building the extension.");
  process.exit(1);
} else {
  console.log("[OK] All standalone dist artifacts verified.");
}