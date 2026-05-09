#!/usr/bin/env node
/**
 * cached-build.mjs - Content-hash cache wrapper for standalone-scripts builds
 *
 * Wraps any standalone build pipeline so that repeated runs with identical
 * inputs return in ~50ms instead of 5-30s of tsc + vite work. Used both
 * locally (via `pnpm run build:<name>`) and in CI (the `.cache/` directory
 * is restored by `actions/cache@v4` keyed on the same hash inputs).
 *
 * Sequential, fail-fast (no retry/backoff). One miss -> one full build -> one
 * cache write. No partial caches. No probabilistic recovery.
 *
 * USAGE
 * -----
 *   node scripts/cached-build.mjs \
 *       --name=<scriptName> \
 *       [--mode=production|development] \
 *       [--extra-input=<path>...] \
 *       -- <build command> [args...]
 *
 * The portion AFTER `--` is the actual build command. The wrapper hashes
 * the inputs first; on HIT it restores `dist/` and skips the command. On
 * MISS it runs the command, then snapshots `standalone-scripts/<name>/dist/`
 * into the cache directory.
 *
 * EXAMPLE
 * -------
 *   node scripts/cached-build.mjs --name=lovable-common -- \
 *       sh -c "tsc --noEmit -p tsconfig.lovable-common.json && vite build --config vite.config.lovable-common.ts"
 *
 * INPUTS HASHED (deterministic order)
 * -----------------------------------
 *   1. Every file under `standalone-scripts/<name>/src/**`
 *   2. tsconfig.<name>.json (or tsconfig.sdk.json / .xpath.json / .macro.build.json)
 *   3. vite.config.<name>.ts (or vite.config.sdk.ts / .xpath.ts / .macro.ts)
 *   4. standalone-scripts/<name>/package.json (if present)
 *   5. standalone-scripts/<name>/instruction.ts (if present)
 *   6. Root pnpm-lock.yaml
 *   7. The build command itself (so changing the command busts cache)
 *   8. --mode value (production vs development -> different bundles)
 *   9. Any --extra-input=<path> the caller passes (shared deps)
 *
 * CACHE LAYOUT
 * ------------
 *   .cache/standalone-builds/
 *     <name>/
 *       <hash>.json         <- manifest: { hash, builtAt, commandHash, files[] }
 *       <hash>/dist/...     <- snapshot of standalone-scripts/<name>/dist/
 *
 * BYPASS
 * ------
 *   STANDALONE_BUILD_NO_CACHE=1   -> always miss, always rebuild, no write
 *   STANDALONE_BUILD_FORCE=1      -> ignore HIT, rebuild, overwrite cache
 *
 * Author: Riseup Asia LLC
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const CACHE_ROOT = path.join(REPO_ROOT, ".cache", "standalone-builds");

const NO_CACHE = process.env.STANDALONE_BUILD_NO_CACHE === "1";
const FORCE_REBUILD = process.env.STANDALONE_BUILD_FORCE === "1";

/* ------------------------------------------------------------------ */
/*  Argument parsing                                                   */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const dashDashIdx = argv.indexOf("--");
if (dashDashIdx === -1) {
    fail("Missing `--` separator before the build command.\nUsage: cached-build.mjs --name=<n> -- <command>");
}

const flagArgs = argv.slice(0, dashDashIdx);
const buildCommand = argv.slice(dashDashIdx + 1);
if (buildCommand.length === 0) {
    fail("No build command provided after `--`.");
}

function flagValue(prefix) {
    const hit = flagArgs.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
}
function flagAll(prefix) {
    return flagArgs.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length));
}

const scriptName = flagValue("--name=");
if (!scriptName) fail("Missing required --name=<scriptName>.");
const buildMode = flagValue("--mode=") ?? process.env.BUILD_MODE ?? "production";
const extraInputs = flagAll("--extra-input=");

const projectDir = path.join(REPO_ROOT, "standalone-scripts", scriptName);
const distDir = path.join(projectDir, "dist");

if (!fs.existsSync(projectDir)) {
    fail(`Project folder does not exist: ${projectDir}`);
}

/* ------------------------------------------------------------------ */
/*  Resolve config inputs                                              */
/* ------------------------------------------------------------------ */

/**
 * Some legacy projects use non-canonical config filenames (e.g. marco-sdk uses
 * tsconfig.sdk.json). Accept either canonical OR legacy names - first match wins.
 * Order matters: canonical first so the registry-required name is preferred.
 */
const TSCONFIG_CANDIDATES = {
    "marco-sdk": ["tsconfig.marco-sdk.json", "tsconfig.sdk.json"],
    "macro-controller": ["tsconfig.macro-controller.json", "tsconfig.macro.build.json"],
};
const VITE_CANDIDATES = {
    "marco-sdk": ["vite.config.marco-sdk.ts", "vite.config.sdk.ts"],
    "macro-controller": ["vite.config.macro-controller.ts", "vite.config.macro.ts"],
};

function resolveFirstExisting(candidates, fallback) {
    for (const c of candidates) {
        const p = path.join(REPO_ROOT, c);
        if (fs.existsSync(p)) return p;
    }
    const fb = path.join(REPO_ROOT, fallback);
    return fs.existsSync(fb) ? fb : null;
}

const tsconfigPath = resolveFirstExisting(
    TSCONFIG_CANDIDATES[scriptName] ?? [],
    `tsconfig.${scriptName}.json`,
);
const viteConfigPath = resolveFirstExisting(
    VITE_CANDIDATES[scriptName] ?? [],
    `vite.config.${scriptName}.ts`,
);

/* ------------------------------------------------------------------ */
/*  Hash computation                                                    */
/* ------------------------------------------------------------------ */

/** Walk a directory and return a sorted list of relative file paths. */
function walkSorted(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "dist" || entry.name === "node_modules" || entry.name === ".cache") continue;
                stack.push(full);
            } else if (entry.isFile()) {
                out.push(full);
            }
        }
    }
    return out.sort();
}

function hashFile(filePath) {
    const h = createHash("sha256");
    h.update(fs.readFileSync(filePath));
    return h.digest("hex");
}

function safeHashFile(filePath) {
    if (filePath === null || !fs.existsSync(filePath)) return "ABSENT";
    return hashFile(filePath);
}

const inputManifest = {
    name: scriptName,
    mode: buildMode,
    command: buildCommand,
    sources: {},
    configs: {},
    extras: {},
};

// 1. Source tree
const srcDir = path.join(projectDir, "src");
const srcFiles = walkSorted(srcDir);
for (const f of srcFiles) {
    inputManifest.sources[path.relative(REPO_ROOT, f)] = hashFile(f);
}

// 2. + 3. tsconfig + vite config
inputManifest.configs.tsconfig = tsconfigPath ? path.relative(REPO_ROOT, tsconfigPath) : null;
inputManifest.configs.tsconfigHash = safeHashFile(tsconfigPath);
inputManifest.configs.vite = viteConfigPath ? path.relative(REPO_ROOT, viteConfigPath) : null;
inputManifest.configs.viteHash = safeHashFile(viteConfigPath);

// 4. + 5. project package.json + instruction.ts
inputManifest.configs.projectPackageJson = safeHashFile(path.join(projectDir, "package.json"));
inputManifest.configs.instructionTs = safeHashFile(path.join(projectDir, "instruction.ts"));

// 6. Root lockfile
inputManifest.configs.pnpmLock = safeHashFile(path.join(REPO_ROOT, "pnpm-lock.yaml"));

// 9. Caller-supplied extras
for (const extra of extraInputs) {
    const abs = path.isAbsolute(extra) ? extra : path.join(REPO_ROOT, extra);
    inputManifest.extras[extra] = safeHashFile(abs);
}

const fullHash = createHash("sha256").update(JSON.stringify(inputManifest)).digest("hex").slice(0, 24);
const cacheKey = `${scriptName}-${buildMode}-${fullHash}`;
const cacheManifestPath = path.join(CACHE_ROOT, scriptName, `${fullHash}.json`);
const cacheDistPath = path.join(CACHE_ROOT, scriptName, fullHash, "dist");

/* ------------------------------------------------------------------ */
/*  Cache lookup                                                        */
/* ------------------------------------------------------------------ */

function logHeader(status) {
    console.log("");
    console.log(`[cache ${status}] ${scriptName}  key=${fullHash}  mode=${buildMode}  src=${srcFiles.length} files`);
}

function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirSync(s, d);
        else if (entry.isFile()) fs.copyFileSync(s, d);
    }
}

function clearDir(dir) {
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
}

function cacheHit() {
    if (NO_CACHE || FORCE_REBUILD) return false;
    if (!fs.existsSync(cacheManifestPath) || !fs.existsSync(cacheDistPath)) return false;
    return true;
}

if (cacheHit()) {
    const restoreStart = Date.now();
    clearDir(distDir);
    copyDirSync(cacheDistPath, distDir);
    logHeader("HIT");
    console.log(`           restored dist/ from cache in ${Date.now() - restoreStart}ms - skipped tsc + vite`);
    process.exit(0);
}

/* ------------------------------------------------------------------ */
/*  Cache miss - run the build                                          */
/* ------------------------------------------------------------------ */

if (NO_CACHE) {
    logHeader("BYPASS");
    console.log(`           STANDALONE_BUILD_NO_CACHE=1 - running build, not writing cache`);
} else if (FORCE_REBUILD) {
    logHeader("FORCE");
    console.log(`           STANDALONE_BUILD_FORCE=1 - running build, will overwrite cache`);
} else {
    logHeader("MISS");
    console.log(`           running build -> will write cache on success`);
}

const buildStart = Date.now();
const [cmd, ...cmdArgs] = buildCommand;
const child = spawnSync(cmd, cmdArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
});

if (child.error) {
    console.error(`[cache] failed to spawn build command: ${child.error.message}`);
    process.exit(2);
}
if (child.status !== 0) {
    console.error(`[cache] build command exited with status ${child.status} - NOT writing cache`);
    process.exit(child.status ?? 1);
}
const buildMs = Date.now() - buildStart;

/* ------------------------------------------------------------------ */
/*  Cache write                                                         */
/* ------------------------------------------------------------------ */

if (NO_CACHE) {
    console.log(`[cache SKIP-WRITE] ${scriptName}  build OK in ${buildMs}ms (no-cache mode)`);
    process.exit(0);
}

if (!fs.existsSync(distDir)) {
    console.error(`[cache] build succeeded but dist/ is missing at ${distDir} - refusing to write empty cache`);
    process.exit(0); // build itself succeeded, downstream gate will catch missing dist
}

const writeStart = Date.now();
clearDir(path.join(CACHE_ROOT, scriptName, fullHash));
fs.mkdirSync(path.dirname(cacheDistPath), { recursive: true });
copyDirSync(distDir, cacheDistPath);
fs.writeFileSync(
    cacheManifestPath,
    JSON.stringify(
        {
            cacheKey,
            hash: fullHash,
            builtAt: new Date().toISOString(),
            buildMs,
            srcFileCount: srcFiles.length,
            inputManifest,
        },
        null,
        2,
    ),
);
console.log(`[cache WRITE] ${scriptName}  snapshot saved in ${Date.now() - writeStart}ms (build was ${buildMs}ms)`);

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function fail(msg) {
    console.error(`[cached-build] ${msg}`);
    process.exit(2);
}