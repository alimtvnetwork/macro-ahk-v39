#!/usr/bin/env node
/**
 * prebuild-clean-and-verify.mjs
 *
 * Pre-build hygiene step:
 *   1. Clears Vite + TypeScript caches that have caused stale-ENOENT failures
 *      against `result-webhook` in the past.
 *   2. Verifies `src/background/recorder/step-library/` contains every
 *      expected module file before bundling.
 *   3. Runs no-bare-fetch lint guard to ensure all HTTP calls obey the
 *      HEFF (HTTP Error Fail-Fast) policy.
 *
 * Exits with code 1 — and a clear path/missing-item/reason message — if any
 * expected file is missing. Cache deletion failures are non-fatal (logged).
 */

import { existsSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { waitForBuildLock } from "./lib/build-lock.mjs";
import {
    EXPECTED_STEP_LIBRARY_FILES,
    STEP_LIBRARY_DIR,
    verifyStepLibraryFilesOrFail,
} from "./lib/step-library-file-guard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CACHE_PATHS = [
    "node_modules/.vite",
    "node_modules/.vite-temp",
    "node_modules/.cache",
    "tsconfig.app.tsbuildinfo",
    "tsconfig.tsbuildinfo",
    "tsconfig.node.tsbuildinfo",
];

function fail(msg) {
    console.error("\n❌ [prebuild-clean-and-verify] " + msg + "\n");
    process.exit(1);
}

function clearCaches() {
    console.log("🧹 [prebuild-clean-and-verify] Clearing Vite/TS caches…");
    for (const rel of CACHE_PATHS) {
        const abs = join(ROOT, rel);
        if (!existsSync(abs)) {
            continue;
        }
        try {
            rmSync(abs, { recursive: true, force: true });
            console.log("   removed: " + rel);
        } catch (err) {
            // Non-fatal — caches are best-effort.
            console.warn("   could not remove " + rel + " (" + (err?.message ?? "unknown") + ") — continuing");
        }
    }
}

function verifyStepLibrary() {
    console.log("🔍 [prebuild-clean-and-verify] Verifying " + STEP_LIBRARY_DIR + "/ contents…");
    verifyStepLibraryFilesOrFail(ROOT, fail);
    console.log("   ✓ " + EXPECTED_STEP_LIBRARY_FILES.length + " expected files present and non-empty");
}

function runNoBareFetchLint() {
    console.log("🔍 [prebuild-clean-and-verify] Running no-bare-fetch lint guard…");
    try {
        execSync("node scripts/lint/no-bare-fetch.mjs", { cwd: ROOT, stdio: "inherit" });
    } catch (err) {
        fail("no-bare-fetch lint guard failed — see output above.");
    }
}

try {
    await waitForBuildLock();
} catch (err) {
    if (err?.code === "EBUILDLOCK") process.exit(1);
    throw err;
}
clearCaches();
verifyStepLibrary();
runNoBareFetchLint();
console.log("✅ [prebuild-clean-and-verify] Cache cleared, step-library verified, lint clean — safe to bundle.\n");

