#!/usr/bin/env node
/**
 * check-readme-txt.mjs
 *
 * Verifies that `readme.txt` at the repository root contains EXACTLY three
 * whitespace-separated words and nothing else (a single trailing newline is
 * tolerated; no other characters, lines, comments, dates, times, or stamps).
 *
 * Policy alignment:
 *   - mem://constraints/readme-txt-prohibitions (SP-1..SP-8)
 *   - .lovable/strictly-avoid.md → "Strictly prohibited — readme.txt"
 *
 * This checker is read-only. It NEVER writes, regenerates, or "repairs"
 * readme.txt (SP-1). It only fails the build with a clear diagnostic so the
 * user can fix it manually.
 *
 * Exit codes:
 *   0 — readme.txt is exactly three words (plus optional trailing newline).
 *   1 — readme.txt is missing, empty, has wrong word count, or contains
 *       extra lines / non-word content.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const README_PATH = resolve(process.cwd(), "readme.txt");
const EXPECTED_WORD_COUNT = 3;

function fail(reason, detail) {
  process.stderr.write(
    [
      "",
      "================================================================",
      "❌ [check-readme-txt] readme.txt FAILED three-words-only check",
      "================================================================",
      `Path     : ${README_PATH}`,
      `Reason   : ${reason}`,
      `Detail   : ${detail}`,
      "",
      "Required : exactly 3 whitespace-separated words and nothing else.",
      "Allowed  : a single trailing newline.",
      "Forbidden: dates, times, timestamps, AM/PM, git stamps, extra lines,",
      "           punctuation-only tokens, or any 4th+ token.",
      "",
      "Fix      : edit readme.txt by hand (SP-1 forbids programmatic writes).",
      "Policy   : mem://constraints/readme-txt-prohibitions (SP-1..SP-8)",
      "================================================================",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (!existsSync(README_PATH)) {
  fail("FileMissing", "readme.txt does not exist at the repository root.");
}

const raw = readFileSync(README_PATH, "utf8");

if (raw.length === 0) {
  fail("EmptyFile", "readme.txt is empty (0 bytes).");
}

// Tolerate exactly one trailing newline; reject any other multi-line content.
const normalized = raw.endsWith("\n") ? raw.slice(0, -1) : raw;

if (normalized.includes("\n") || normalized.includes("\r")) {
  fail(
    "MultipleLines",
    `readme.txt must be a single line. Found ${raw.split(/\r?\n/).length} line(s).`,
  );
}

const tokens = normalized.split(/\s+/).filter((t) => t.length > 0);

if (tokens.length !== EXPECTED_WORD_COUNT) {
  fail(
    "WrongWordCount",
    `Expected ${EXPECTED_WORD_COUNT} words, found ${tokens.length}: ${JSON.stringify(tokens)}`,
  );
}

// Reject any token that looks like a date, time, or stamp (SP-2/SP-4/SP-8).
// Words are letters/apostrophes only; any digit-bearing or punctuation-heavy
// token is flagged so future regressions surface immediately.
const wordShape = /^[A-Za-z][A-Za-z'’]*$/;
for (const token of tokens) {
  if (!wordShape.test(token)) {
    fail(
      "NonWordToken",
      `Token ${JSON.stringify(token)} is not a plain word (letters/apostrophe only). Dates, times, numbers, and stamps are forbidden in readme.txt.`,
    );
  }
}

process.stdout.write(
  `✅ [check-readme-txt] readme.txt OK — exactly 3 words: ${JSON.stringify(tokens)}\n`,
);
