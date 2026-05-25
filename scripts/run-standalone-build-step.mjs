#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const LOCAL_NODE_BINARIES = {
    tsc: "node_modules/typescript/bin/tsc",
    vite: "node_modules/vite/bin/vite.js",
};

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

// Windows tsc OOM / stack-overflow guard.
// Three standalone projects (lovable-common, lovable-owner-switch, xpath) intermittently
// fail under `tsc --noEmit` on Windows with exit codes:
//   -2147483645 (0x80000003 — V8 breakpoint after Fatal "out of memory: Zone")
//   -1073741571 (0xC00000FD — Windows STATUS_STACK_OVERFLOW)
// Reason: default V8 heap (~4 GB) + small stack (~984 KB) are insufficient for the
// shared type graph these projects pull in via lovable-common/sdk barrel re-exports.
// Fix: pass V8 flags directly to the node child (NODE_OPTIONS disallows --stack-size).
// --max-old-space-size goes via NODE_OPTIONS (allowed); --stack-size goes as a direct
// node CLI flag inserted before the tsc script path.
const TSC_NODE_OPTIONS_EXTRA = "--max-old-space-size=8192";
const TSC_NODE_DIRECT_FLAGS = ["--stack-size=8000"];

for (const [cmd, args] of PROJECTS[project]) {
    const finalArgs = cmd === "vite" && mode === "development" ? [...args, "--mode", "development"] : args;
    console.log(`[build-step] ${project}: ${cmd} ${finalArgs.join(" ")}`);
    const localBinary = LOCAL_NODE_BINARIES[cmd];
    const resolvedCommand = process.execPath;
    let resolvedArgs;
    if (localBinary) {
        resolvedArgs = cmd === "tsc"
            ? [...TSC_NODE_DIRECT_FLAGS, localBinary, ...finalArgs]
            : [localBinary, ...finalArgs];
    } else {
        resolvedArgs = finalArgs;
    }
    const requiredPath = localBinary ? join(process.cwd(), localBinary) : null;
    if (requiredPath && !existsSync(requiredPath)) {
        console.error(`[FAIL] ${project}: missing local executable at ${requiredPath}`);
        console.error(`[FAIL] ${project}: missing item=${localBinary}; Reason=DependencyBinaryMissing; ReasonDetail=run pnpm install before standalone builds`);
        process.exit(2);
    }
    const childEnv = { ...process.env };
    if (cmd === "tsc") {
        const existing = childEnv.NODE_OPTIONS ? childEnv.NODE_OPTIONS + " " : "";
        childEnv.NODE_OPTIONS = existing + TSC_NODE_OPTIONS_EXTRA;
    }
    const result = spawnSync(resolvedCommand, resolvedArgs, { stdio: "inherit", shell: false, env: childEnv });
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