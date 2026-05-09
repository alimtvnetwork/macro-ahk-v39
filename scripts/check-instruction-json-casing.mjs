#!/usr/bin/env node
/**
 * check-instruction-json-casing.mjs
 *
 * Phase 2b dual-emit JSON-shape gate. Runs AFTER `compile-instruction.mjs`
 * has emitted both files into each project's `dist/`, and BEFORE the
 * vite extension build's `copyProjectScripts` plugin copies those files
 * into `chrome-extension/projects/scripts/<name>/`.
 *
 * For every `standalone-scripts/<name>/dist/instruction.json` and its
 * sibling `dist/instruction.compat.json` this script enforces:
 *
 *   -- instruction.json (canonical)
 *   - Every object key in the recursive tree starts with [A-Z] (PascalCase),
 *     OR is one of the documented lowercase binding identifiers
 *     ({config, theme} - these are user-chosen NAMES inside
 *     ConfigSeedIds, not schema keys; see CHECK A in
 *     scripts/check-pascalcase-instruction-migration.mjs).
 *   - Zero camelCase keys allowed (a key starting with [a-z] that is NOT
 *     in the lowercase allowlist is a hard fail).
 *
 *   -- instruction.compat.json (transitional camelCase snapshot)
 *   - Every object key starts with [a-z_] (camelCase or snake-ish) - i.e.
 *     no key may begin with [A-Z]. The lowercase binding identifiers
 *     ({config, theme}) are also valid here (they pass through unchanged
 *     during the camelCase conversion in compile-instruction.mjs).
 *
 * Why this is its OWN script (not folded into
 * check-pascalcase-instruction-migration.mjs):
 *   That checker validates SOURCE FILES (`src/instruction.ts` literals
 *   and `.ts/.mjs` consumers). This checker validates the BUILD ARTIFACTS
 *   (`dist/instruction.json` + `dist/instruction.compat.json`) - the actual
 *   bytes that will be copied into the extension and shipped. Source can
 *   be clean while artifacts drift if `compile-instruction.mjs` has a bug
 *   (wrong conversion, partial walk, alias leak, etc.). This script is
 *   the second line of defence against shipping a wrong-shape JSON.
 *
 * Wiring: invoked from package.json scripts immediately after every
 * `compile-instruction.mjs` invocation in the build pipeline, and from
 * `build:extension` after the bulk `compile-instruction.mjs` calls
 * complete and BEFORE `vite build --config vite.config.extension.ts`
 * (which is where copyProjectScripts runs).
 *
 * Usage:
 *   node scripts/check-instruction-json-casing.mjs
 *     -> scans every standalone-scripts/<name>/dist/{instruction,instruction.compat}.json
 *
 *   node scripts/check-instruction-json-casing.mjs <project-folder>
 *     -> scans only that one project (matches compile-instruction.mjs CLI)
 *     -> e.g. node scripts/check-instruction-json-casing.mjs standalone-scripts/macro-controller
 *
 *   node scripts/check-instruction-json-casing.mjs --json [<project-folder>]
 *     -> emits a single JSON document to stdout describing every scanned
 *       project, the two artifacts, and every casing violation with its
 *       JSON-Pointer-like path. Suppresses human-readable logs and GitHub
 *       Actions ::error annotations so the stdout stream is pure JSON
 *       (machine-parseable for debugging, dashboards, or piping into jq).
 *       Exit code semantics are unchanged. Schema (version 2):
 *         { tool, version: 2, scannedProjects, exitCode,
 *           summary: {
 *             scannedProjects, skippedProjects, missingArtifactProjects,
 *             totalViolations, ok,
 *             totals: {
 *               canonical: { shape:"PascalCase", artifact:"instruction.json",
 *                            scanned, violationCount, parseErrors,
 *                            walkAborted, failingProjects: [...], ok },
 *               compat:    { shape:"camelCase",  artifact:"instruction.compat.json", ... }
 *             }
 *           },
 *           // summary.ok mirrors `exitCode === 0` (so it is false when
 *           // any project is missing artifacts even if both buckets are
 *           // clean). totals.<bucket>.ok is scoped to the projects whose
 *           // artifacts were actually scanned.
 *           projects: [{ name, skipped, missingArtifact,
 *             artifacts: { canonical: { path, shape, ok, parseError,
 *               walkAborted, violationCount, violations: [{ path, key, expected }] },
 *                          compat:    { ... } } }] }
 *
 * Exit codes:
 *   0 - every scanned project's two artifacts pass both shape checks
 *   1 - at least one violation. When run inside GitHub Actions
 *       (GITHUB_ACTIONS=true), one `::error file=<dist/.../instruction[.compat].json>`
 *       annotation is emitted per offending JSON-pointer key (capped at
 *       INSTRUCTION_CASING_MAX_ANNOTATIONS, default 50, per artifact),
 *       so the violations show up inline in the PR Files Changed view
 *       at the exact dist artifact path. A trailing file-level summary
 *       annotation is always emitted naming the artifact + total count
 *       so at least one inline marker exists even when the per-key cap
 *       truncates output. Outside Actions the framed text block is the
 *       sole output (no pseudo-annotation lines).
 *   2 - repo layout broken (no standalone-scripts/) or a referenced
 *       project lacks a dist/ - surfaces a missing-step problem
 *       instead of a false pass.
 *
 * Resolves: build-artifact JSON shape gate for the Phase 2b dual-emit
 *           contract documented in mem://architecture/instruction-dual-emit-phase-2b.md
 *           and mem://standards/pascalcase-json-keys.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const STANDALONE_DIR = resolve(REPO_ROOT, "standalone-scripts");

/* ----------------------------------------------------------------- */
/*  Lowercase keys allowed in BOTH shapes.                            */
/*                                                                    */
/*  These are user-chosen binding names that appear as object keys    */
/*  inside ConfigSeedIds (e.g. `{ config: "...", theme: "..." }`).   */
/*  They survive the PascalCase->camelCase conversion unchanged        */
/*  because their first char is already lowercase, so the same        */
/*  allowlist applies to both files. Mirrors                          */
/*  LOWERCASE_KEY_ALLOWLIST in check-pascalcase-instruction-migration.mjs. */
/* ----------------------------------------------------------------- */
const LOWERCASE_KEY_ALLOWLIST = new Set(["config", "theme"]);

const rel = (p) => relative(REPO_ROOT, p) || p;

/* ----------------------------------------------------------------- */
/*  Walker safety limits.                                             */
/*                                                                    */
/*  A malicious or accidentally-massive instruction.json (e.g. a      */
/*  build that accidentally embeds a multi-MB lookup table, or a      */
/*  cycle-broken-but-deeply-nested config tree) must NOT hang the    */
/*  build or balloon CI memory. The walker enforces two hard caps:   */
/*                                                                    */
/*    MAX_NODES  - total objects + array elements visited per file.  */
/*                 Exceeding it aborts that file's scan and surfaces */
/*                 a clear "tree too large" diagnostic instead of    */
/*                 silently truncating violations.                   */
/*    MAX_DEPTH  - maximum nesting depth (object-or-array level) the */
/*                 walker will descend into. Protects against        */
/*                 pathological JSON that could blow Node's call     */
/*                 stack via the recursive generator.                */
/*                                                                    */
/*  Both limits are generous (instruction.json artifacts in this     */
/*  repo top out at <300 nodes / depth ~8) but bounded so a 50 MB   */
/*  rogue file fails fast with a precise error rather than timing   */
/*  out the CI runner. Override via env vars for stress tests:      */
/*    INSTRUCTION_CASING_MAX_NODES=200000                            */
/*    INSTRUCTION_CASING_MAX_DEPTH=64                                */
/* ----------------------------------------------------------------- */
const MAX_NODES = Number.parseInt(process.env.INSTRUCTION_CASING_MAX_NODES ?? "", 10) || 50_000;
const MAX_DEPTH = Number.parseInt(process.env.INSTRUCTION_CASING_MAX_DEPTH ?? "", 10) || 32;

class WalkAbortError extends Error {
    constructor(reason, { nodes, depth, path }) {
        super(reason);
        this.name = "WalkAbortError";
        this.reason = reason;       // "max-nodes" | "max-depth"
        this.nodes = nodes;
        this.depth = depth;
        this.path = path;
    }
}

/* ----------------------------------------------------------------- */
/*  GitHub Actions annotations.                                       */
/*                                                                    */
/*  Two flavours:                                                     */
/*    - annotateFile(file, msg)   - one summary `::error` on the      */
/*      file (used for parse errors, walker aborts, and the trailing  */
/*      "+N more" message when violations are truncated).             */
/*    - annotateKey(file, v, shape) - one `::error` per offending     */
/*      JSON-pointer key, so the developer sees the exact key in the  */
/*      Actions UI without having to scroll the log.                  */
/*                                                                    */
/*  Both are no-ops outside `GITHUB_ACTIONS=true` so a local run      */
/*  doesn't print pseudo-annotation lines that look like broken log   */
/*  output. `--json` mode bypasses both via the JSON branch in main().*/
/*                                                                    */
/*  Per-file cap (MAX_ANNOTATIONS, default 50) prevents a totally-    */
/*  broken artifact (thousands of bad keys) from drowning the Actions */
/*  annotation pane - the cap matches the human-readable MAX_PRINT    */
/*  framed-block cap so the two reports stay in sync. Override via    */
/*  INSTRUCTION_CASING_MAX_ANNOTATIONS env var.                       */
/* ----------------------------------------------------------------- */
const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === "true";
const MAX_ANNOTATIONS = Number.parseInt(process.env.INSTRUCTION_CASING_MAX_ANNOTATIONS ?? "", 10) || 50;

/** Escape a value for the message portion of a workflow command. */
function ghEscapeMessage(s) {
    return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Emit a single GitHub Actions error annotation on the JSON file itself. */
function annotateFile(file, msg) {
    if (!IS_GITHUB_ACTIONS) return;
    process.stdout.write(`::error file=${file}::${ghEscapeMessage(msg)}\n`);
}

/**
 * Emit one GitHub Actions error annotation per violating JSON-pointer key.
 * Capped at MAX_ANNOTATIONS; returns the count actually emitted so the
 * caller can append a "+N more" summary annotation.
 */
function annotateKeys(file, violations, shape) {
    if (!IS_GITHUB_ACTIONS) return 0;
    const limit = Math.min(violations.length, MAX_ANNOTATIONS);
    const expected = shape === "PascalCase" ? "PascalCase" : "camelCase";
    for (let i = 0; i < limit; i++) {
        const v = violations[i];
        process.stdout.write(
            `::error file=${file},title=${expected} casing violation::` +
            ghEscapeMessage(`${v.path}  ->  "${v.key}"  (expected ${expected})`) +
            `\n`,
        );
    }
    return limit;
}

/* ----------------------------------------------------------------- */
/*  Recursive key walker.                                             */
/*                                                                    */
/*  Yields every {path, key} pair encountered as the tree is walked. */
/*  Arrays are descended (path becomes `...[i]`) but their indices are */
/*  not yielded as keys. Non-object leaves are skipped - only object */
/*  KEYS are subject to casing rules. JSON null is ignored.           */
/*                                                                    */
/*  Path uses dotted JSON-Pointer-like notation rooted at `$` for     */
/*  human-readable error messages (`$.Assets.Scripts[0].File`).       */
/*                                                                    */
/*  Throws WalkAbortError when MAX_NODES or MAX_DEPTH is exceeded.   */
/*  The counter is shared across the whole tree via a closure on    */
/*  `state` so recursion accumulates correctly.                       */
/* ----------------------------------------------------------------- */
function* walkKeys(value, path = "$", depth = 0, state = { nodes: 0 }) {
    if (depth > MAX_DEPTH) {
        throw new WalkAbortError("max-depth", { nodes: state.nodes, depth, path });
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            state.nodes++;
            if (state.nodes > MAX_NODES) {
                throw new WalkAbortError("max-nodes", { nodes: state.nodes, depth, path: `${path}[${i}]` });
            }
            yield* walkKeys(value[i], `${path}[${i}]`, depth + 1, state);
        }
        return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, val] of Object.entries(value)) {
        state.nodes++;
        if (state.nodes > MAX_NODES) {
            throw new WalkAbortError("max-nodes", { nodes: state.nodes, depth, path: `${path}.${key}` });
        }
        yield { path, key };
        yield* walkKeys(val, `${path}.${key}`, depth + 1, state);
    }
}

/* ----------------------------------------------------------------- */
/*  Per-shape key validators. Each returns true if the key is legal  */
/*  for that shape, false otherwise.                                  */
/* ----------------------------------------------------------------- */

/** PascalCase shape: key starts with [A-Z], or is in lowercase allowlist. */
function isLegalPascalKey(key) {
    if (LOWERCASE_KEY_ALLOWLIST.has(key)) return true;
    if (!key) return false;
    const c = key.charCodeAt(0);
    // 'A'..'Z' === 65..90
    return c >= 65 && c <= 90;
}

/** camelCase shape: key starts with [a-z_], i.e. anything NOT [A-Z]. */
function isLegalCamelKey(key) {
    if (!key) return false;
    const c = key.charCodeAt(0);
    // Reject only PascalCase (uppercase-leading). Lowercase binding
    // identifiers, snake_case, leading-underscore, and digits are all
    // accepted - the only thing camelCase artifacts must never do is
    // re-introduce a PascalCase key.
    return !(c >= 65 && c <= 90);
}

/* ----------------------------------------------------------------- */
/*  Per-file scanners.                                                */
/* ----------------------------------------------------------------- */

function scanArtifact(file, predicate, shapeLabel) {
    const violations = [];
    let raw;
    try {
        raw = readFileSync(file, "utf-8");
    } catch (e) {
        return { missing: true, error: e.message, violations };
    }
    let tree;
    try {
        tree = JSON.parse(raw);
    } catch (e) {
        return { parseError: e.message, violations };
    }
    try {
        for (const { path, key } of walkKeys(tree)) {
            if (!predicate(key)) {
                violations.push({ path, key, expected: shapeLabel });
            }
        }
    } catch (e) {
        if (e instanceof WalkAbortError) {
            return {
                walkAborted: {
                    reason: e.reason,         // "max-nodes" | "max-depth"
                    nodes: e.nodes,
                    depth: e.depth,
                    path: e.path,
                    limit: e.reason === "max-nodes" ? MAX_NODES : MAX_DEPTH,
                },
                violations,
            };
        }
        throw e;
    }
    return { violations };
}

function checkProject(projectName) {
    const distDir = resolve(STANDALONE_DIR, projectName, "dist");
    const canonical = join(distDir, "instruction.json");
    const compat = join(distDir, "instruction.compat.json");

    // A project without a src/instruction.ts is intentionally skipped
    // (matches compile-instruction.mjs behaviour). A project WITH a
    // source but missing dist artifacts is a hard error - it means
    // compile-instruction.mjs was not run before this checker, which
    // is a build-pipeline ordering bug.
    const tsPath = resolve(STANDALONE_DIR, projectName, "src", "instruction.ts");
    if (!existsSync(tsPath)) {
        return { skipped: true, reason: "no src/instruction.ts" };
    }
    if (!existsSync(canonical) || !existsSync(compat)) {
        return {
            missingArtifact: true,
            canonicalExists: existsSync(canonical),
            compatExists: existsSync(compat),
            distDir,
        };
    }

    const canonicalResult = scanArtifact(canonical, isLegalPascalKey, "PascalCase");
    const compatResult = scanArtifact(compat, isLegalCamelKey, "camelCase");
    return { canonical, compat, canonicalResult, compatResult };
}

/* ----------------------------------------------------------------- */
/*  Project enumeration.                                              */
/* ----------------------------------------------------------------- */

function listAllProjects() {
    if (!existsSync(STANDALONE_DIR)) return null;
    return readdirSync(STANDALONE_DIR).filter((name) => {
        try {
            return statSync(join(STANDALONE_DIR, name)).isDirectory();
        } catch {
            return false;
        }
    });
}

/**
 * Resolve the CLI argument (a folder path like
 * `standalone-scripts/macro-controller`) to a project name. Accepts
 * absolute paths, repo-relative paths, or a bare project name.
 */
function resolveProjectArg(arg) {
    const abs = resolve(REPO_ROOT, arg);
    const r = relative(STANDALONE_DIR, abs);
    if (!r || r.startsWith("..") || r.includes("/") || r.includes("\\")) {
        // Not directly inside standalone-scripts/ - fall back to basename.
        return arg.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    }
    return r;
}

/* ----------------------------------------------------------------- */
/*  Reporter + main.                                                  */
/* ----------------------------------------------------------------- */

function reportProject(name, result) {
    if (result.skipped) {
        console.log(`[INFO] ${name} - skipped (${result.reason})`);
        return { exit: 0, failures: [] };
    }
    if (result.missingArtifact) {
        const distAbs = resolve(REPO_ROOT, result.distDir);
        process.stderr.write(
            `\n[FAIL] ${name} - dist artifacts missing\n` +
            `  dist dir (relative): ${rel(result.distDir)}\n` +
            `  dist dir (absolute): ${distAbs}\n` +
            `    instruction.json:        ${result.canonicalExists ? "present" : "MISSING"}\n` +
            `    instruction.compat.json: ${result.compatExists ? "present" : "MISSING"}\n` +
            `  Fix: run \`node scripts/compile-instruction.mjs standalone-scripts/${name}\` before this check.\n\n`,
        );
        return { exit: 2, failures: [] };
    }

    let exit = 0;
    const failures = [];   // { project, label, shape, fileRel, fileAbs, kind, count }

    for (const [label, file, res, shape] of [
        ["canonical", result.canonical, result.canonicalResult, "PascalCase"],
        ["compat   ", result.compat, result.compatResult, "camelCase"],
    ]) {
        const fileRel = rel(file);
        const fileAbs = resolve(REPO_ROOT, file);

        if (res.parseError) {
            process.stderr.write(
                `\n[FAIL] ${name} ${label.trim()} - JSON parse error\n` +
                `  file (relative): ${fileRel}\n` +
                `  file (absolute): ${fileAbs}\n` +
                `  error:           ${res.parseError}\n`,
            );
            annotateFile(fileRel, `Invalid JSON in ${fileRel}: ${res.parseError}`);
            failures.push({ project: name, label: label.trim(), shape, fileRel, fileAbs, kind: "parse-error", count: 1 });
            exit = 1;
            continue;
        }
        if (res.walkAborted) {
            const a = res.walkAborted;
            const explain = a.reason === "max-nodes"
                ? `tree exceeded MAX_NODES=${a.limit} (visited ${a.nodes} nodes before aborting at ${a.path})`
                : `tree exceeded MAX_DEPTH=${a.limit} (depth ${a.depth} at ${a.path})`;
            process.stderr.write(
                `\n[FAIL] ${name} ${label.trim()} - walker aborted\n` +
                `  file (relative): ${fileRel}\n` +
                `  file (absolute): ${fileAbs}\n` +
                `  reason:          ${explain}\n` +
                `  partial scan:    ${res.violations.length} violation(s) before abort\n` +
                `  override:        INSTRUCTION_CASING_MAX_NODES / INSTRUCTION_CASING_MAX_DEPTH env vars\n`,
            );
            // Walker-aborted: emit the file-level summary AND per-key
            // annotations for whatever partial violations were collected
            // before the abort, so devs still see exact offending keys.
            annotateFile(fileRel, `Walker aborted on ${fileRel}: ${explain}. Likely a runaway/oversized artifact - investigate compile-instruction.mjs output.`);
            if (res.violations.length > 0) {
                const emitted = annotateKeys(fileRel, res.violations, shape);
                if (res.violations.length > emitted) {
                    annotateFile(fileRel, `... and ${res.violations.length - emitted} more ${shape}-shape violation(s) before walker abort (run with --json or set INSTRUCTION_CASING_MAX_ANNOTATIONS for the full list).`);
                }
            }
            failures.push({ project: name, label: label.trim(), shape, fileRel, fileAbs, kind: "walker-aborted", count: res.violations.length });
            exit = 1;
            continue;
        }
        if (res.violations.length === 0) {
            console.log(`[OK] ${name} ${label} - ${fileRel} is pure ${shape}`);
            continue;
        }

        // -- Casing violations: print a framed block with both paths
        // and the full list of offending keys (capped at MAX_PRINT
        // so a totally-broken file can't spam thousands of lines).
        // Each violation is shown as `<json-path>  ->  "<offending-key>"`
        // so the developer can grep the JSON file directly for the key.
        const expectation = shape === "PascalCase"
            ? `expected PascalCase (or one of {${[...LOWERCASE_KEY_ALLOWLIST].join(", ")}})`
            : `expected camelCase (no PascalCase keys allowed)`;
        const MAX_PRINT = 50;

        process.stderr.write(
            `\n[FAIL] ${name} ${label.trim()} - ${res.violations.length} ${shape}-shape violation(s)\n` +
            `  file (relative): ${fileRel}\n` +
            `  file (absolute): ${fileAbs}\n` +
            `  rule:            ${expectation}\n` +
            `  offending keys:  (showing ${Math.min(res.violations.length, MAX_PRINT)} of ${res.violations.length})\n`,
        );
        for (const v of res.violations.slice(0, MAX_PRINT)) {
            process.stderr.write(`    ${v.path}  ->  "${v.key}"\n`);
        }
        if (res.violations.length > MAX_PRINT) {
            process.stderr.write(`    ... and ${res.violations.length - MAX_PRINT} more (use --json for the full list)\n`);
        }
        process.stderr.write("\n");

        // Per-key GitHub Actions annotations: one ::error per
        // offending JSON-pointer key, capped at MAX_ANNOTATIONS so a
        // totally-broken file can't drown the Actions UI. When the
        // cap kicks in, append a single summary annotation pointing
        // at the file with the truncated-count and a how-to-see-all
        // hint. Followed by a final file-level summary annotation
        // that names the artifact + total violation count, so the
        // PR Files Changed view always has at least one inline marker
        // even when --json mode or local runs would skip per-key ones.
        const emittedKeys = annotateKeys(fileRel, res.violations, shape);
        if (res.violations.length > emittedKeys) {
            annotateFile(
                fileRel,
                `... and ${res.violations.length - emittedKeys} more ${shape}-shape violation(s) in ${fileRel} (showing first ${emittedKeys}; run --json or raise INSTRUCTION_CASING_MAX_ANNOTATIONS for the full list).`,
            );
        }
        annotateFile(
            fileRel,
            `${res.violations.length} ${shape}-shape violation(s) in ${fileRel}. First offender: ${res.violations[0].path} -> "${res.violations[0].key}". ` +
            `Fix compile-instruction.mjs or the source instruction.ts so this artifact stays pure ${shape}.`,
        );
        failures.push({ project: name, label: label.trim(), shape, fileRel, fileAbs, kind: "casing", count: res.violations.length });
        exit = 1;
    }
    return { exit, failures };
}

/* ----------------------------------------------------------------- */
/*  JSON reporter - `--json` flag.                                    */
/*                                                                    */
/*  Builds a single structured document covering every scanned        */
/*  project and writes it to stdout. Suppresses the human-readable    */
/*  per-project logs and GitHub Actions ::error annotations so the    */
/*  stdout stream stays pure JSON (safe to pipe into jq, store as a  */
/*  CI artifact, or feed into a dashboard). Exit code is computed    */
/*  the same way as the text reporter so callers that only care     */
/*  about pass/fail can ignore the body.                              */
/* ----------------------------------------------------------------- */
function buildJsonProjectEntry(name, result) {
    if (result.skipped) {
        return {
            name,
            skipped: true,
            skipReason: result.reason,
            missingArtifact: false,
            artifacts: null,
            exitCode: 0,
        };
    }
    if (result.missingArtifact) {
        return {
            name,
            skipped: false,
            missingArtifact: true,
            distDir: rel(result.distDir),
            canonicalExists: result.canonicalExists,
            compatExists: result.compatExists,
            artifacts: null,
            exitCode: 2,
        };
    }

    const buildArtifact = (file, res, shape) => {
        if (res.parseError) {
            return {
                path: rel(file),
                shape,
                ok: false,
                parseError: res.parseError,
                walkAborted: null,
                violationCount: 0,
                violations: [],
            };
        }
        if (res.walkAborted) {
            return {
                path: rel(file),
                shape,
                ok: false,
                parseError: null,
                walkAborted: res.walkAborted,  // { reason, nodes, depth, path, limit }
                violationCount: res.violations.length,
                violations: res.violations.map((v) => ({
                    path: v.path,
                    key: v.key,
                    expected: v.expected,
                })),
            };
        }
        return {
            path: rel(file),
            shape,
            ok: res.violations.length === 0,
            parseError: null,
            walkAborted: null,
            violationCount: res.violations.length,
            violations: res.violations.map((v) => ({
                path: v.path,
                key: v.key,
                expected: v.expected,
            })),
        };
    };

    const canonical = buildArtifact(result.canonical, result.canonicalResult, "PascalCase");
    const compat = buildArtifact(result.compat, result.compatResult, "camelCase");
    const exitCode = canonical.ok && compat.ok && !canonical.parseError && !compat.parseError && !canonical.walkAborted && !compat.walkAborted ? 0 : 1;

    return {
        name,
        skipped: false,
        missingArtifact: false,
        artifacts: { canonical, compat },
        exitCode,
    };
}

/* ----------------------------------------------------------------- */
/*  CLI argv parser. Accepts `--json` anywhere; positional arg is    */
/*  the project folder (same as before).                              */
/* ----------------------------------------------------------------- */
function parseArgs(argv) {
    const opts = { json: false, projectArg: null };
    for (const a of argv) {
        if (a === "--json") opts.json = true;
        else if (a === "--help" || a === "-h") opts.help = true;
        else if (!opts.projectArg) opts.projectArg = a;
    }
    return opts;
}

function main() {
    const { json: jsonMode, projectArg, help } = parseArgs(process.argv.slice(2));

    if (help) {
        process.stdout.write(
            `Usage: check-instruction-json-casing.mjs [--json] [<standalone-scripts/<name>>]\n` +
            `  --json   Emit a structured JSON report on stdout (suppresses text + ::error annotations).\n`,
        );
        process.exit(0);
    }

    let projects;
    if (projectArg) {
        const name = resolveProjectArg(projectArg);
        if (!name) {
            if (jsonMode) {
                process.stdout.write(JSON.stringify({
                    tool: "check-instruction-json-casing",
                    version: 2,
                    error: `Could not resolve project name from "${projectArg}"`,
                    exitCode: 2,
                    scannedProjects: 0,
                    projects: [],
                }) + "\n");
            } else {
                process.stderr.write(`x Could not resolve project name from "${projectArg}"\n`);
            }
            process.exit(2);
        }
        if (!existsSync(join(STANDALONE_DIR, name))) {
            if (jsonMode) {
                process.stdout.write(JSON.stringify({
                    tool: "check-instruction-json-casing",
                    version: 2,
                    error: `Project not found: standalone-scripts/${name}`,
                    exitCode: 2,
                    scannedProjects: 0,
                    projects: [],
                }) + "\n");
            } else {
                process.stderr.write(`x Project not found: standalone-scripts/${name}\n`);
            }
            process.exit(2);
        }
        projects = [name];
    } else {
        projects = listAllProjects();
        if (projects === null) {
            if (jsonMode) {
                process.stdout.write(JSON.stringify({
                    tool: "check-instruction-json-casing",
                    version: 2,
                    error: `standalone-scripts/ not found at ${rel(STANDALONE_DIR)}`,
                    exitCode: 2,
                    scannedProjects: 0,
                    projects: [],
                }) + "\n");
            } else {
                process.stderr.write(`[FAIL] standalone-scripts/ not found at ${rel(STANDALONE_DIR)} - repo layout broken?\n`);
            }
            process.exit(2);
        }
    }

    // -- JSON mode: build the report silently, then emit once. ------
    if (jsonMode) {
        const entries = [];
        let worst = 0;
        let scanned = 0;
        for (const name of projects) {
            const result = checkProject(name);
            const entry = buildJsonProjectEntry(name, result);
            if (!entry.skipped) scanned++;
            if (entry.exitCode > worst) worst = entry.exitCode;
            entries.push(entry);
        }

        // -- Top-level aggregate summary -----------------------------
        // Roll every project's per-artifact result into two buckets
        // (canonical = instruction.json / PascalCase, compat =
        // instruction.compat.json / camelCase) so a CI dashboard or
        // jq one-liner can read total drift without walking the full
        // projects[] array. Counts cover violations only - parse
        // errors and walker aborts are tracked as separate booleans
        // per project (see `failingProjects` below) so a single bad
        // file can't inflate violation totals.
        const buildBucket = (artifactKey, shape) => {
            const violations = [];   // { project, path, key, expected }
            const failingProjects = new Set();
            let parseErrors = 0;
            let walkAborted = 0;
            let scanned = 0;
            for (const e of entries) {
                if (e.skipped || e.missingArtifact || !e.artifacts) continue;
                const a = e.artifacts[artifactKey];
                if (!a) continue;
                scanned++;
                if (a.parseError) { parseErrors++; failingProjects.add(e.name); }
                if (a.walkAborted) { walkAborted++; failingProjects.add(e.name); }
                if (a.violationCount > 0) failingProjects.add(e.name);
                for (const v of a.violations) {
                    violations.push({ project: e.name, path: v.path, key: v.key, expected: v.expected });
                }
            }
            return {
                shape,
                artifact: artifactKey === "canonical" ? "instruction.json" : "instruction.compat.json",
                scanned,
                violationCount: violations.length,
                parseErrors,
                walkAborted,
                failingProjects: [...failingProjects].sort(),
                ok: violations.length === 0 && parseErrors === 0 && walkAborted === 0,
            };
        };

        const summary = {
            scannedProjects: scanned,
            skippedProjects: entries.filter((e) => e.skipped).length,
            missingArtifactProjects: entries.filter((e) => e.missingArtifact).length,
            totals: {
                canonical: buildBucket("canonical", "PascalCase"),
                compat: buildBucket("compat", "camelCase"),
            },
            // Convenience flat counters for dashboards.
            totalViolations: 0,
            ok: worst === 0,
        };
        summary.totalViolations =
            summary.totals.canonical.violationCount + summary.totals.compat.violationCount;

        const report = {
            tool: "check-instruction-json-casing",
            version: 2,
            scannedProjects: scanned,
            exitCode: worst,
            summary,
            projects: entries,
        };
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        process.exit(worst);
    }

    // -- Default text mode: per-project logs + ::error annotations. -
    let worst = 0;
    let scanned = 0;
    const allFailures = [];
    for (const name of projects) {
        const result = checkProject(name);
        const { exit: code, failures } = reportProject(name, result);
        if (!result.skipped) scanned++;
        if (code > worst) worst = code;
        for (const f of failures) allFailures.push(f);
    }

    if (worst === 0) {
        console.log(`\n[OK] check-instruction-json-casing - ${scanned} project(s) passed both shape checks`);
    } else {
        // Final summary: collapse every failing file into a one-line
        // table so a CI viewer scrolling to the bottom of the log
        // gets a copy-pasteable list of every artifact that needs
        // fixing - both relative (for grep) and absolute (for
        // editor open) paths.
        process.stderr.write(`\n[FAIL] check-instruction-json-casing - failed (exit ${worst})\n`);
        if (allFailures.length > 0) {
            process.stderr.write(`\nFailing artifacts (${allFailures.length}):\n`);
            for (const f of allFailures) {
                const tag = f.kind === "casing"
                    ? `${f.count} ${f.shape} violation(s)`
                    : f.kind === "walker-aborted"
                        ? `walker aborted (partial: ${f.count} violation(s))`
                        : `JSON parse error`;
                process.stderr.write(
                    `  - ${f.project} ${f.label} - ${tag}\n` +
                    `      relative: ${f.fileRel}\n` +
                    `      absolute: ${f.fileAbs}\n`,
                );
            }
        }
        process.stderr.write(`\n  See: mem://standards/pascalcase-json-keys, mem://architecture/instruction-dual-emit-phase-2b.md\n\n`);
    }
    process.exit(worst);
}


main();
