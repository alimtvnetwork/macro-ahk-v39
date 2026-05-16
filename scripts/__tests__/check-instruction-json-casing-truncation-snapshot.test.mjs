#!/usr/bin/env node
/**
 * check-instruction-json-casing-truncation-snapshot.test.mjs
 *
 * Exact-line snapshot test for the truncation-summary case in
 * `scripts/check-instruction-json-casing.mjs`.
 *
 * Sister test to `check-instruction-json-casing-truncation.test.mjs`
 * (which uses regex assertions on counts/buckets). This test pins the
 * EXACT formatting of every annotation line emitted in the canonical
 * bucket — wording, ordering, punctuation, and the GitHub-Actions
 * workflow-command shape — so a typo, reordering, or escape-encoding
 * regression fails CI loudly instead of silently shipping malformed
 * annotations.
 *
 * Path sanitization rules:
 *   • The temp fixture path
 *       standalone-scripts/__casing-fixture-temp__/dist/instruction.json
 *     is replaced with the literal placeholder
 *       <FIXTURE>/dist/instruction.json
 *     so the snapshot is reproducible across machines and CI runners
 *     (Windows/Linux path separators, absolute prefixes, etc.).
 *   • All other content (`::error file=…,title=…::` prefix, the
 *     `→` arrow, parentheses, "and N more" text, "First offender:")
 *     is preserved byte-for-byte.
 *
 * Run locally:   node scripts/__tests__/check-instruction-json-casing-truncation-snapshot.test.mjs
 * Run in CI:     wired alongside the regex test in `.github/workflows/ci.yml`.
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
const FIXTURE_NAME = "__casing-fixture-snapshot-temp__";
const FIXTURE_DIR = resolve(REPO_ROOT, "standalone-scripts", FIXTURE_NAME);
const FIXTURE_DIST = join(FIXTURE_DIR, "dist");
const FIXTURE_SRC = join(FIXTURE_DIR, "src");
const CANONICAL_PATH = join(FIXTURE_DIST, "instruction.json");
const COMPAT_PATH = join(FIXTURE_DIST, "instruction.compat.json");

// Use small, deterministic numbers so the inline snapshot below is
// short and easy to eyeball. CAP=3, EXTRA=2 → 5 violations total,
// 3 per-key annotations + 1 truncation summary + 1 file-level summary.
const CAP = 3;
const EXTRA = 2;
const VIOLATIONS = CAP + EXTRA; // 5

/* ------------------------------------------------------------------ */
/*  Fixture helpers                                                    */
/* ------------------------------------------------------------------ */

function buildCanonicalFixture(badKeyCount) {
    const obj = {
        Name: "casing-fixture-snapshot",
        Version: "0.0.0",
        Assets: { Scripts: [{ File: "fixture.js" }] },
    };
    for (let i = 0; i < badKeyCount; i++) {
        obj[`badKey${i}`] = i;
    }
    return obj;
}

function buildCompatFixture() {
    return {
        name: "casing-fixture-snapshot",
        version: "0.0.0",
        assets: { scripts: [{ file: "fixture.js" }] },
        config: "default",
    };
}

function setupFixture() {
    cleanupFixture();
    mkdirSync(FIXTURE_SRC, { recursive: true });
    mkdirSync(FIXTURE_DIST, { recursive: true });
    writeFileSync(
        join(FIXTURE_SRC, "instruction.ts"),
        "// Test fixture — see scripts/__tests__/check-instruction-json-casing-truncation-snapshot.test.mjs\nexport const instruction = {};\n",
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

/**
 * Sanitize a single annotation line so the snapshot is reproducible.
 * Replaces the fixture's canonical and compat path with stable placeholders.
 * Normalizes path separators (Windows back-slashes → forward slashes).
 */
function sanitizeLine(line) {
    return line
        .replace(/\\/g, "/")
        .replace(
            new RegExp(`standalone-scripts/${FIXTURE_NAME}/dist/instruction\\.json`, "g"),
            "<FIXTURE>/dist/instruction.json",
        )
        .replace(
            new RegExp(`standalone-scripts/${FIXTURE_NAME}/dist/instruction\\.compat\\.json`, "g"),
            "<FIXTURE>/dist/instruction.compat.json",
        );
}

/* ------------------------------------------------------------------ */
/*  Test                                                               */
/* ------------------------------------------------------------------ */

test("annotation lines snapshot — truncation summary case", (t) => {
    setupFixture();
    t.after(cleanupFixture);

    const result = runChecker();
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    assert.equal(
        result.status,
        1,
        `Expected exit 1 (violations present); got ${result.status}.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );

    const annotationLines = stdout
        .split("\n")
        .filter((l) => l.startsWith("::error"))
        .map(sanitizeLine);

    // The script emits per-key annotations in the order keys are walked
    // (object insertion order). Our fixture inserts Name, Version,
    // Assets, badKey0…badKey{N-1}. The first 3 PascalCase keys are
    // legal so the per-key annotations target badKey0, badKey1, badKey2.
    // The walker reports the offending KEY name in the message and uses
    // `$` for the root JSON-pointer scope. The truncation summary fires
    // when the cap (=3) is hit, leaving 2 unreported violations. The
    // file-level summary is always emitted last and names the first
    // offender + a remediation hint.
    const expected = [
        '::error file=<FIXTURE>/dist/instruction.json,title=PascalCase casing violation::$  ->  "badKey0"  (expected PascalCase)',
        '::error file=<FIXTURE>/dist/instruction.json,title=PascalCase casing violation::$  ->  "badKey1"  (expected PascalCase)',
        '::error file=<FIXTURE>/dist/instruction.json,title=PascalCase casing violation::$  ->  "badKey2"  (expected PascalCase)',
        '::error file=<FIXTURE>/dist/instruction.json::... and 2 more PascalCase-shape violation(s) in <FIXTURE>/dist/instruction.json (showing first 3; run --json or raise INSTRUCTION_CASING_MAX_ANNOTATIONS for the full list).',
        '::error file=<FIXTURE>/dist/instruction.json::5 PascalCase-shape violation(s) in <FIXTURE>/dist/instruction.json. First offender: $ -> "badKey0". Fix compile-instruction.mjs or the source instruction.ts so this artifact stays pure PascalCase.',
    ];

    assert.deepEqual(
        annotationLines,
        expected,
        [
            "Annotation output drifted from snapshot.",
            "If this change is intentional, update the `expected` array in",
            "scripts/__tests__/check-instruction-json-casing-truncation-snapshot.test.mjs",
            "to match the new format.",
            "",
            "--- expected ---",
            expected.join("\n"),
            "",
            "--- actual ---",
            annotationLines.join("\n"),
        ].join("\n"),
    );

    // Sanity: stderr framed log block names the right total.
    assert.match(
        stderr,
        new RegExp(`${VIOLATIONS} PascalCase-shape violation\\(s\\)`),
        `Expected stderr to mention "${VIOLATIONS} PascalCase-shape violation(s)" in the framed block.\nstderr:\n${stderr}`,
    );
});
