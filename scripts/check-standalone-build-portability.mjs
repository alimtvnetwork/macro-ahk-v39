#!/usr/bin/env node
import { readFileSync } from "node:fs";

const FILES = ["package.json", "scripts/build-standalone.mjs"];
const RUNNER_TARGET = "scripts/run-standalone-build-step.mjs";
const FORBIDDEN = /cached-build\.mjs[\s\S]{0,240}?--[\s\S]{0,80}?sh[\s\S]{0,40}?-c/;
const failures = [];

for (const file of FILES) {
    const text = readFileSync(file, "utf-8");
    if (FORBIDDEN.test(text)) {
        failures.push(file);
    }
}

const runnerText = readFileSync(RUNNER_TARGET, "utf-8");
if (!runnerText.includes("node_modules/typescript/bin/tsc") || !runnerText.includes("node_modules/vite/bin/vite.js")) {
    failures.push(RUNNER_TARGET + " missing local tsc/vite binary resolution");
}

if (/spawnSync\(cmd,/.test(runnerText) || /shell:\s*process\.platform\s*===\s*["']win32["']/.test(runnerText)) {
    failures.push(RUNNER_TARGET + " still depends on PATH/shell lookup for build binaries");
}

if (failures.length > 0) {
    console.error("[FAIL] Non-portable standalone cached build command found.");
    for (const file of failures) {
        console.error("  - " + file);
    }
    console.error("Reason: `sh -c` breaks Windows/PowerShell deploys. Use scripts/run-standalone-build-step.mjs instead.");
    process.exit(1);
}

console.log("[OK] Standalone cached build commands are cross-platform");