#!/usr/bin/env node
/**
 * CI guard: standalone build paths launched from PowerShell/CI must not invoke
 * package-manager scripts recursively.
 *
 * pnpm v11 may run a dependency-status install check before a nested script
 * starts. On Windows non-TTY shells this can abort with:
 * ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY.
 *
 * Use the underlying Node script directly instead of nesting `pnpm run` or
 * `npm run build:<standalone-name>`.
 */
import { readFileSync } from "node:fs";

const PACKAGE_TARGET = "package.json";
const POWERSHELL_TARGET = "scripts/ps-modules/standalone-build.ps1";
const SCRIPT_NAMES = ["build:macro-controller", "build:marco-sdk", "build:extension"];
const FORBIDDEN_PACKAGE_RE = /(^|&&|\|\||;)\s*pnpm\s+run\s+/;
const FORBIDDEN_STANDALONE_PS_RE = /npm\s+run\s+[`"']?build:\$ScriptName|pnpm\s+run\s+[`"']?build:\$ScriptName/;

const pkg = JSON.parse(readFileSync(PACKAGE_TARGET, "utf-8"));
const scripts = pkg && typeof pkg === "object" && pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
const failures = [];

for (const name of SCRIPT_NAMES) {
    const command = scripts[name];
    if (typeof command === "string" && FORBIDDEN_PACKAGE_RE.test(command)) {
        failures.push({ file: PACKAGE_TARGET, name: "scripts." + name, command });
    }
}

const powershellText = readFileSync(POWERSHELL_TARGET, "utf-8");
if (FORBIDDEN_STANDALONE_PS_RE.test(powershellText)) {
    failures.push({
        file: POWERSHELL_TARGET,
        name: "Build-StandaloneScript",
        command: "npm/pnpm run build:$ScriptName",
    });
}

if (failures.length > 0) {
    console.error("[FAIL] Nested pnpm run found in standalone/extension build scripts.");
    console.error("Reason: nested pnpm can trigger a dependency install check and fail on Windows without a TTY.");
    console.error("Fix: call the underlying node script directly instead of `pnpm run ...`.");
    for (const failure of failures) {
        console.error("  - " + failure.file + " " + failure.name);
        console.error("    " + failure.command);
    }
    process.exit(1);
}

console.log("[OK] No nested pnpm run in standalone/extension build scripts");