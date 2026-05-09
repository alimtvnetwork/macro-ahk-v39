#!/usr/bin/env node
/**
 * Standalone-Scripts Build Orchestrator
 *
 * Runs the three standalone bundle builds (marco-sdk, xpath, macro-controller)
 * in parallel from a single Node process, after running shared prerequisites
 * exactly once.
 *
 * Why this exists:
 *   The previous root scripts (build:sdk / build:xpath / build:macro-controller)
 *   each re-ran `check-axios-version.mjs`, and build:macro-controller also
 *   re-ran build:prompts + build:seed-manifest + check-version-sync. When a
 *   developer wanted "all standalone bundles", they paid for those checks 3x
 *   sequentially. This orchestrator runs each guard exactly once and then fans
 *   out the three bundle builds in parallel, matching the PowerShell pipeline's
 *   behavior but available outside PowerShell (CI, plain `pnpm build:standalone`).
 *
 * Ordering contract (preserved from package.json scripts):
 *   1. SHARED PREREQS (sequential, run once):
 *        - check-axios-version.mjs
 *        - aggregate-prompts.mjs           (was: build:prompts - needed by macro-controller)
 *        - lessc index.less                (was: build:macro-less)
 *        - compile-templates.mjs           (was: build:macro-templates)
 *        - compile-instruction.mjs x3      (marco-sdk, xpath, macro-controller)
 *        - generate-seed-manifest.mjs      (was: build:seed-manifest)
 *        - check-version-sync.mjs
 *   2. PARALLEL BUNDLE BUILDS (fan-out):
 *        - marco-sdk:        tsc -p tsconfig.sdk.json --noEmit && vite build --config vite.config.sdk.ts && generate-dts.mjs
 *        - xpath:            tsc -p tsconfig.xpath.json --noEmit && vite build --config vite.config.xpath.ts
 *        - macro-controller: tsc -p tsconfig.macro.build.json --noEmit && vite build --config vite.config.macro.ts && sync-macro-controller-legacy.mjs
 *
 * Output: Each parallel job's stdout/stderr is prefixed with [<name>] and
 *         streamed live so failures are attributable. Exits 1 on the first
 *         hard failure after all jobs settle (aggregated report).
 *
 * Usage:
 *   node scripts/build-standalone.mjs                # production mode
 *   node scripts/build-standalone.mjs --mode=development
 *   pnpm build:standalone
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * PROJECTS array - canonical registry of every standalone-scripts project
 * recognised by the orchestrator and the standalone registry checker
 * (`scripts/report-standalone-registry.mjs`). Keep in sync with the per-folder
 * directories under `standalone-scripts/`.
 *
 * Note: not every entry below has its own PARALLEL_JOBS step yet - some
 * (lovable-common, lovable-owner-switch, lovable-user-add, payment-banner-hider)
 * are built by their dedicated `pnpm run build:<name>` scripts called from CI
 * jobs and from the `build:extension` chain. Listing them here keeps the
 * registry checker green without forcing a parallel orchestrator step.
 */
export const PROJECTS = [
    "marco-sdk",
    "xpath",
    "macro-controller",
    "payment-banner-hider",
    "lovable-common",
    "lovable-owner-switch",
    "lovable-user-add",
];

const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith("--mode="));
const BUILD_MODE = modeArg ? modeArg.split("=")[1] : "production";

if (BUILD_MODE !== "production" && BUILD_MODE !== "development") {
    console.error(`[ERROR] Invalid --mode='${BUILD_MODE}'. Expected 'production' or 'development'.`);
    process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  Process helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Runs a command sequentially, inheriting stdio. Throws on non-zero exit.
 * @param {string} label   Human-readable step name for log output.
 * @param {string} cmd     Executable (e.g. 'node', 'npx', 'tsc').
 * @param {string[]} cmdArgs
 */
function runSequential(label, cmd, cmdArgs) {
    return new Promise((resolvePromise, rejectPromise) => {
        const start = Date.now();
        process.stdout.write(`[prereq] ${label} ... `);
        const child = spawn(cmd, cmdArgs, {
            cwd: ROOT,
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32",
        });

        let stderr = "";
        let stdout = "";
        child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

        child.on("error", (err) => {
            process.stdout.write("FAIL\n");
            console.error(`[prereq] ${label} could not start: ${err.message}`);
            rejectPromise(err);
        });

        child.on("close", (code) => {
            const ms = Date.now() - start;
            if (code === 0) {
                process.stdout.write(`OK (${ms}ms)\n`);
                resolvePromise();
            } else {
                process.stdout.write(`FAIL (exit ${code}, ${ms}ms)\n`);
                if (stdout.trim()) console.error(stdout);
                if (stderr.trim()) console.error(stderr);
                rejectPromise(new Error(`${label} exited with code ${code}`));
            }
        });
    });
}

/**
 * Runs a list of shell commands sequentially in one parallel "job", streaming
 * each line prefixed with [name] so output from concurrent jobs is attributable.
 * Resolves with { name, success, durationMs, failedStep? }.
 *
 * @param {object} job
 * @param {string} job.name      Bundle name (used as log prefix).
 * @param {Array<{label: string, cmd: string, args: string[]}>} job.steps
 */
function runParallelJob(job) {
    return new Promise((resolvePromise) => {
        const start = Date.now();
        const prefix = `[${job.name}]`;

        const runStep = (index) => {
            if (index >= job.steps.length) {
                console.log(`${prefix} OK (${Date.now() - start}ms)`);
                resolvePromise({ name: job.name, success: true, durationMs: Date.now() - start });
                return;
            }
            const step = job.steps[index];
            console.log(`${prefix} > ${step.label}`);

            const child = spawn(step.cmd, step.args, {
                cwd: ROOT,
                stdio: ["ignore", "pipe", "pipe"],
                shell: process.platform === "win32",
                env: { ...process.env, BUILD_MODE },
            });

            const writeChunk = (stream) => (chunk) => {
                const text = chunk.toString();
                for (const line of text.split(/\r?\n/)) {
                    if (line.length > 0) stream.write(`${prefix} ${line}\n`);
                }
            };
            child.stdout.on("data", writeChunk(process.stdout));
            child.stderr.on("data", writeChunk(process.stderr));

            child.on("error", (err) => {
                console.error(`${prefix} FAIL - '${step.label}' could not start: ${err.message}`);
                resolvePromise({
                    name: job.name,
                    success: false,
                    durationMs: Date.now() - start,
                    failedStep: step.label,
                    reason: err.message,
                });
            });

            child.on("close", (code) => {
                if (code === 0) {
                    runStep(index + 1);
                } else {
                    console.error(`${prefix} FAIL - '${step.label}' exited with code ${code}`);
                    resolvePromise({
                        name: job.name,
                        success: false,
                        durationMs: Date.now() - start,
                        failedStep: step.label,
                        reason: `exit ${code}`,
                    });
                }
            });
        };

        runStep(0);
    });
}

/* ------------------------------------------------------------------ */
/*  Pipeline definition                                                */
/* ------------------------------------------------------------------ */

/** Shared prerequisites - run exactly once, in this order. */
const SHARED_PREREQS = [
    { label: "check-axios-version",          cmd: "node", args: ["scripts/check-axios-version.mjs"] },
    { label: "aggregate-prompts",            cmd: "node", args: ["scripts/aggregate-prompts.mjs"] },
    {
        // Compile LESS via the in-repo compile-less.mjs helper which imports
        // the `less` package directly. Do NOT shell out to npx/dlx with the
        // npx-style `--package` flag - pnpm-managed CI rejects it with
        // ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER. See
        // scripts/check-no-pnpm-dlx-less.mjs for the preflight guard.
        label: "compile-less macro-controller",
        cmd: "node",
        args: [
            "scripts/compile-less.mjs",
            "standalone-scripts/macro-controller/less/index.less",
            "standalone-scripts/macro-controller/dist/macro-looping.css",
        ],
    },
    {
        label: "compile-templates macro-controller",
        cmd: "node",
        args: [
            "scripts/compile-templates.mjs",
            "standalone-scripts/macro-controller/templates",
            "standalone-scripts/macro-controller/dist/templates.json",
        ],
    },
    { label: "compile-instruction marco-sdk",        cmd: "node", args: ["scripts/compile-instruction.mjs", "standalone-scripts/marco-sdk"] },
    { label: "compile-instruction xpath",            cmd: "node", args: ["scripts/compile-instruction.mjs", "standalone-scripts/xpath"] },
    { label: "compile-instruction macro-controller", cmd: "node", args: ["scripts/compile-instruction.mjs", "standalone-scripts/macro-controller"] },
    { label: "generate-seed-manifest",       cmd: "node", args: ["scripts/generate-seed-manifest.mjs"] },
    { label: "check-version-sync",           cmd: "node", args: ["scripts/check-version-sync.mjs"] },
];

/** Three bundle builds - fan out in parallel after prereqs succeed.
 *  Each job is wrapped by `scripts/cached-build.mjs` which:
 *    - computes a content hash of src/ + tsconfig + vite-config + lockfile
 *    - on HIT: restores standalone-scripts/<name>/dist/ from .cache/ in <100ms
 *    - on MISS: runs the inner tsc + vite + post-snapshot chain, then snapshots dist/
 *  The inner shell command is what would have run before (npx tsc + npx vite + node post)
 *  so cache misses behave exactly like the pre-cache pipeline.
 *  Bypass with STANDALONE_BUILD_NO_CACHE=1; force-rebuild with STANDALONE_BUILD_FORCE=1.
 */
function cachedJob(name) {
    return {
        name,
        steps: [
            {
                label: `cached-build (${name})`,
                cmd: "node",
                args: [
                    "scripts/cached-build.mjs",
                    `--name=${name}`,
                    `--mode=${BUILD_MODE}`,
                    "--",
                    "node",
                    "scripts/run-standalone-build-step.mjs",
                    `--project=${name}`,
                    `--mode=${BUILD_MODE}`,
                ],
            },
        ],
    };
}
const PARALLEL_JOBS = [
    cachedJob("marco-sdk"),
    cachedJob("xpath"),
    cachedJob("macro-controller"),
];

/* ------------------------------------------------------------------ */
/*  Pre-flight sanity                                                  */
/* ------------------------------------------------------------------ */

const requiredFiles = [
    "scripts/check-axios-version.mjs",
    "scripts/aggregate-prompts.mjs",
    "scripts/compile-templates.mjs",
    "scripts/compile-instruction.mjs",
    "scripts/generate-seed-manifest.mjs",
    "scripts/check-version-sync.mjs",
    "scripts/sync-macro-controller-legacy.mjs",
    "scripts/generate-dts.mjs",
    "tsconfig.sdk.json",
    "tsconfig.xpath.json",
    "tsconfig.macro.build.json",
    "vite.config.sdk.ts",
    "vite.config.xpath.ts",
    "vite.config.macro.ts",
];

const missing = requiredFiles.filter((f) => !existsSync(resolve(ROOT, f)));
if (missing.length > 0) {
    console.error("");
    console.error("========================================");
    console.error("  [CODE RED] BUILD-STANDALONE PREFLIGHT FAILED");
    console.error("========================================");
    console.error("  Path:     " + ROOT);
    console.error("  Missing:  Required pipeline files");
    for (const f of missing) console.error("    - " + f);
    console.error("  Reason:   build-standalone.mjs cannot proceed without every guard, config, and sub-script. Run a fresh git pull or restore the missing files.");
    console.error("========================================");
    process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const totalStart = Date.now();
console.log("");
console.log("========================================");
console.log(`  build-standalone.mjs  (mode: ${BUILD_MODE})`);
console.log("========================================");
console.log(`  Step 1/2  Shared prerequisites (${SHARED_PREREQS.length} sequential)`);
console.log("");

try {
    for (const step of SHARED_PREREQS) {
        await runSequential(step.label, step.cmd, step.args);
    }
} catch (err) {
    console.error("");
    console.error("[FAIL] Shared prereq failed - aborting before parallel bundles.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
}

console.log("");
console.log(`  Step 2/2  Parallel bundle builds (${PARALLEL_JOBS.length} concurrent)`);
console.log("");

const results = await Promise.all(PARALLEL_JOBS.map(runParallelJob));

console.log("");
console.log("========================================");
console.log("  Results");
console.log("========================================");
for (const r of results) {
    const status = r.success ? "OK  " : "FAIL";
    const detail = r.success ? "" : `  (failed at: ${r.failedStep} - ${r.reason})`;
    console.log(`  [${status}] ${r.name}  ${r.durationMs}ms${detail}`);
}

const failed = results.filter((r) => !r.success);
const totalMs = Date.now() - totalStart;
console.log(`  Total: ${totalMs}ms`);
console.log("========================================");

if (failed.length > 0) {
    console.error("");
    console.error(`[FAIL] ${failed.length} of ${results.length} bundle(s) failed: ${failed.map((f) => f.name).join(", ")}`);
    process.exit(1);
}

console.log("");
console.log(`[OK] All ${results.length} standalone bundles built (${BUILD_MODE}, ${totalMs}ms)`);
process.exit(0);
