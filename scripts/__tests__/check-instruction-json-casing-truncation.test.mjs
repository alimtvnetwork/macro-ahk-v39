#!/usr/bin/env node
/**
 * check-instruction-json-casing-truncation.test.mjs
 *
 * CI test fixture for `scripts/check-instruction-json-casing.mjs`.
 *
 * Verifies the GitHub Actions annotation cap (`MAX_ANNOTATIONS`,
 * overridable via `INSTRUCTION_CASING_MAX_ANNOTATIONS`) when a single
 * artifact contains MORE casing violations than the cap. Without this
 * test a regression that drops the cap, off-by-ones the truncation
 * summary, or silently emits unbounded annotations would slip through
 * — the script's other consumers (the four real `standalone-scripts/*`
 * projects) are all clean today, so the truncation branch is
 * untested in production CI runs.
 *
 * The test:
 *   1. Creates a temp project under `standalone-scripts/__casing-fixture-temp__/`
 *      with `src/instruction.ts` (so the script doesn't skip it) and
 *      a `dist/instruction.json` containing exactly N PascalCase
 *      violations where N > cap. The compat sibling is intentionally
 *      clean (camelCase) so the canonical bucket is the only one that
 *      drives the cap.
 *   2. Runs the real script as a subprocess with
 *        GITHUB_ACTIONS=true                        → enables annotations
 *        INSTRUCTION_CASING_MAX_ANNOTATIONS=<cap>   → forces a known cap
 *      and captures stdout (where `::error` lines land).
 *   3. Asserts:
 *        a. Exit code === 1.
 *        b. Per-key `::error file=…,title=PascalCase casing violation::`
 *           count === cap (not N, not cap+1, not 0).
 *        c. Exactly ONE truncation-summary annotation matching
 *           `… and <N-cap> more PascalCase-shape violation(s) in <file>`.
 *        d. The always-emitted file-level summary annotation
 *           (`<N> PascalCase-shape violation(s) in <file>. First offender: …`)
 *           is present exactly once.
 *        e. Total count of canonical-bucket annotations equals
 *           cap + 2 (per-key + truncation summary + file-level summary).
 *        f. Compat bucket emits ZERO annotations (clean fixture).
 *   4. Cleans up the temp project even on failure.
 *
 * Run locally:   node scripts/__tests__/check-instruction-json-casing-truncation.test.mjs
 * Run in CI:     same — wired in `.github/workflows/ci.yml` as
 *                `casing-checker-self-test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const SCRIPT = resolve(REPO_ROOT, "scripts", "check-instruction-json-casing.mjs");
const FIXTURE_NAME = "__casing-fixture-temp__";
const FIXTURE_DIR = resolve(REPO_ROOT, "standalone-scripts", FIXTURE_NAME);
const FIXTURE_DIST = join(FIXTURE_DIR, "dist");
const FIXTURE_SRC = join(FIXTURE_DIR, "src");
const CANONICAL_PATH = join(FIXTURE_DIST, "instruction.json");
const COMPAT_PATH = join(FIXTURE_DIST, "instruction.compat.json");

// Cap and violation count are picked so:
//   • CAP < default 50 → keeps the test cheap.
//   • VIOLATIONS = CAP + EXTRA where EXTRA > 1 → forces truncation
//     AND verifies the summary's "+N more" arithmetic isn't hard-coded.
const CAP = 7;
const EXTRA = 5;
const VIOLATIONS = CAP + EXTRA;   // 12

/* ------------------------------------------------------------------ */
/*  Fixture helpers                                                    */
/* ------------------------------------------------------------------ */

function buildCanonicalFixture(badKeyCount) {
    // Top-level legal PascalCase + camelCase intruders that all start
    // with [a-z]. Pick keys deterministically (`badKey0`, `badKey1`, …)
    // so the summary's "First offender:" line is predictable.
    const obj = {
        Name: "casing-fixture-temp",
        Version: "0.0.0",
        Assets: { Scripts: [{ File: "fixture.js" }] },
    };
    for (let i = 0; i < badKeyCount; i++) {
        obj[`badKey${i}`] = i;
    }
    return obj;
}

function buildCompatFixture() {
    // Pure camelCase (+ allowlist `config`) — must be clean.
    return {
        name: "casing-fixture-temp",
        version: "0.0.0",
        assets: { scripts: [{ file: "fixture.js" }] },
        config: "default",
    };
}

function setupFixture() {
    cleanupFixture(); // be defensive against a leftover from a crashed run
    mkdirSync(FIXTURE_SRC, { recursive: true });
    mkdirSync(FIXTURE_DIST, { recursive: true });
    // Empty stub is enough — the script only checks existsSync().
    writeFileSync(
        join(FIXTURE_SRC, "instruction.ts"),
        "// Test fixture — see scripts/__tests__/check-instruction-json-casing-truncation.test.mjs\nexport const instruction = {};\n",
    );
    writeFileSync(CANONICAL_PATH, JSON.stringify(buildCanonicalFixture(VIOLATIONS), null, 2));
    writeFileSync(COMPAT_PATH, JSON.stringify(buildCompatFixture(), null, 2));
}

function cleanupFixture() {
    if (existsSync(FIXTURE_DIR)) {
        rmSync(FIXTURE_DIR, { recursive: true, force: true });
    }
}

function runChecker() {
    return spawnSync(
        process.execPath,
        [SCRIPT, `standalone-scripts/${FIXTURE_NAME}`],
        {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                GITHUB_ACTIONS: "true",
                INSTRUCTION_CASING_MAX_ANNOTATIONS: String(CAP),
            },
            encoding: "utf-8",
        },
    );
}

/* ------------------------------------------------------------------ */
/*  Test                                                               */
/* ------------------------------------------------------------------ */

test("annotation cap + truncation summary at MAX_ANNOTATIONS", (t) => {
    setupFixture();
    t.after(cleanupFixture);

    const result = runChecker();
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    // — a. Exit code —
    assert.equal(
        result.status,
        1,
        `Expected exit 1 (violations present); got ${result.status}.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );

    const annotationLines = stdout.split("\n").filter((l) => l.startsWith("::error"));

    // — b. Per-key annotation count for the canonical bucket —
    const perKeyRe = /^::error file=[^,]+,title=PascalCase casing violation::/;
    const perKeyAnnotations = annotationLines.filter((l) => perKeyRe.test(l));
    assert.equal(
        perKeyAnnotations.length,
        CAP,
        `Expected exactly ${CAP} per-key ::error annotations (cap), got ${perKeyAnnotations.length}.\nAll annotations:\n${annotationLines.join("\n")}`,
    );

    // — c. Truncation summary: exactly one match, with correct "+N more" count —
    const truncationRe = new RegExp(
        `^::error file=[^:]+::\\.\\.\\. and ${VIOLATIONS - CAP} more PascalCase-shape violation\\(s\\) in `,
    );
    const truncationMatches = annotationLines.filter((l) => truncationRe.test(l));
    assert.equal(
        truncationMatches.length,
        1,
        `Expected exactly 1 truncation-summary annotation matching "... and ${VIOLATIONS - CAP} more PascalCase-shape violation(s) in ..."; got ${truncationMatches.length}.\nAnnotations:\n${annotationLines.join("\n")}`,
    );

    // — d. File-level summary annotation present exactly once —
    const fileSummaryRe = new RegExp(
        `^::error file=[^:]+::${VIOLATIONS} PascalCase-shape violation\\(s\\) in `,
    );
    const fileSummaryMatches = annotationLines.filter((l) => fileSummaryRe.test(l));
    assert.equal(
        fileSummaryMatches.length,
        1,
        `Expected exactly 1 file-level summary annotation ("${VIOLATIONS} PascalCase-shape violation(s) in …"); got ${fileSummaryMatches.length}.\nAnnotations:\n${annotationLines.join("\n")}`,
    );

    // — e. Canonical bucket totals: per-key + truncation + file-level —
    const canonicalBucket = annotationLines.filter(
        (l) => l.includes("PascalCase casing violation") || l.includes("PascalCase-shape violation"),
    );
    assert.equal(
        canonicalBucket.length,
        CAP + 2,
        `Expected ${CAP + 2} total canonical-bucket annotations (${CAP} per-key + 1 truncation summary + 1 file-level summary); got ${canonicalBucket.length}.\nCanonical:\n${canonicalBucket.join("\n")}`,
    );

    // — f. Compat bucket is clean: no camelCase annotations —
    const compatAnnotations = annotationLines.filter(
        (l) => l.includes("camelCase casing violation") || l.includes("camelCase-shape violation"),
    );
    assert.equal(
        compatAnnotations.length,
        0,
        `Expected 0 compat-bucket annotations (compat fixture is clean camelCase); got ${compatAnnotations.length}.\nCompat:\n${compatAnnotations.join("\n")}`,
    );

    // — sanity: framed log block on stderr names the right count —
    assert.match(
        stderr,
        new RegExp(`${VIOLATIONS} PascalCase-shape violation\\(s\\)`),
        `Expected stderr to mention "${VIOLATIONS} PascalCase-shape violation(s)" in the framed block.\nstderr:\n${stderr}`,
    );
});
