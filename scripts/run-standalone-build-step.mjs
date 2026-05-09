#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const PROJECTS = {
    "lovable-common": [
        ["tsc", ["--noEmit", "-p", "tsconfig.lovable-common.json"]],
        ["vite", ["build", "--config", "vite.config.lovable-common.ts"]],
    ],
    "lovable-owner-switch": [
        ["tsc", ["--noEmit", "-p", "tsconfig.lovable-owner-switch.json"]],
        ["vite", ["build", "--config", "vite.config.lovable-owner-switch.ts"]],
    ],
    "lovable-user-add": [
        ["tsc", ["--noEmit", "-p", "tsconfig.lovable-user-add.json"]],
        ["vite", ["build", "--config", "vite.config.lovable-user-add.ts"]],
    ],
    "macro-controller": [
        ["tsc", ["--noEmit", "-p", "tsconfig.macro.build.json"]],
        ["vite", ["build", "--config", "vite.config.macro.ts"]],
        ["node", ["scripts/sync-macro-controller-legacy.mjs"]],
    ],
    "marco-sdk": [
        ["tsc", ["--noEmit", "-p", "tsconfig.sdk.json"]],
        ["vite", ["build", "--config", "vite.config.sdk.ts"]],
        ["node", ["scripts/generate-dts.mjs"]],
    ],
    "payment-banner-hider": [
        ["tsc", ["--noEmit", "-p", "tsconfig.payment-banner-hider.json"]],
        ["vite", ["build", "--config", "vite.config.payment-banner-hider.ts"]],
        ["node", ["scripts/copy-payment-banner-hider-css.mjs"]],
    ],
    "xpath": [
        ["tsc", ["--noEmit", "-p", "tsconfig.xpath.json"]],
        ["vite", ["build", "--config", "vite.config.xpath.ts"]],
    ],
};

const project = process.argv.find((a) => a.startsWith("--project="))?.slice("--project=".length);
const mode = process.argv.find((a) => a.startsWith("--mode="))?.slice("--mode=".length) ?? process.env.BUILD_MODE ?? "production";

if (!project || !(project in PROJECTS)) {
    console.error(`[FAIL] Usage: node scripts/run-standalone-build-step.mjs --project=<${Object.keys(PROJECTS).join("|")}> [--mode=production|development]`);
    process.exit(2);
}

for (const [cmd, args] of PROJECTS[project]) {
    const finalArgs = cmd === "vite" && mode === "development" ? [...args, "--mode", "development"] : args;
    console.log(`[build-step] ${project}: ${cmd} ${finalArgs.join(" ")}`);
    const result = spawnSync(cmd, finalArgs, { stdio: "inherit", shell: process.platform === "win32" });
    if (result.error) {
        console.error(`[FAIL] ${project}: could not start ${cmd}: ${result.error.message}`);
        process.exit(2);
    }
    if (result.status !== 0) {
        console.error(`[FAIL] ${project}: ${cmd} exited with status ${result.status}`);
        process.exit(result.status ?? 1);
    }
}

console.log(`[OK] ${project}: standalone build step complete (${mode})`);