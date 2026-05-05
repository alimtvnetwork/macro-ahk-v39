#!/usr/bin/env node
/**
 * print-quality-badges.mjs
 *
 * After you activate Codacy and Code Climate (one-time OAuth signup with the
 * GitHub account that owns this repo), run this script with the project IDs
 * to print ready-to-paste markdown for the README badge block.
 *
 * Where to find the IDs:
 *   Codacy        — https://app.codacy.com/gh/<owner>/<repo>/settings → Integrations → Badges
 *                   (the "Grade" badge URL contains a UUID like `a1b2c3d4-...`)
 *   Code Climate  — https://codeclimate.com/github/<owner>/<repo>/badges
 *                   (the maintainability badge URL contains a hex token)
 *
 * Usage:
 *   node scripts/print-quality-badges.mjs --codacy <UUID> --codeclimate <TOKEN>
 *   node scripts/print-quality-badges.mjs --codacy <UUID>           # only Codacy
 *   node scripts/print-quality-badges.mjs --codeclimate <TOKEN>     # only Code Climate
 *
 * Optional:
 *   --repo <owner/repo>   Override (default: alimtvnetwork/macro-ahk-v29)
 *   --branch <name>       Branch for Codacy grade (default: main)
 *   --check               HEAD-fetch each emitted badge URL and report status
 *   --write-readme [path] Replace the placeholder Codacy / Code Climate badge
 *                         lines in readme.md with the generated markdown.
 *                         Path defaults to ./readme.md.
 *   --dry-run             With --write-readme, print the diff but do not save.
 *
 * Exit codes:
 *   0 — printed successfully (and readme written, if requested)
 *   1 — bad arguments, or --write-readme target not found / no placeholders matched
 *   2 — --check requested and at least one badge URL did not return 200
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_REPO = "alimtvnetwork/macro-ahk-v29";
const DEFAULT_BRANCH = "main";

function parseArgs(argv) {
  const args = {
    codacy: "",
    codeclimate: "",
    repo: DEFAULT_REPO,
    branch: DEFAULT_BRANCH,
    check: false,
    writeReadme: false,
    readmePath: "",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    const nextIsValue = typeof next === "string" && !next.startsWith("--");
    switch (flag) {
      case "--codacy":      args.codacy = next ?? "";      i++; break;
      case "--codeclimate": args.codeclimate = next ?? ""; i++; break;
      case "--repo":        args.repo = next ?? DEFAULT_REPO;     i++; break;
      case "--branch":      args.branch = next ?? DEFAULT_BRANCH; i++; break;
      case "--check":       args.check = true; break;
      case "--dry-run":     args.dryRun = true; break;
      case "--write-readme":
        args.writeReadme = true;
        if (nextIsValue) { args.readmePath = next; i++; }
        break;
      case "-h":
      case "--help":        printHelpAndExit(); break;
      default:
        console.error(`Unknown flag: ${flag}`);
        printHelpAndExit(1);
    }
  }
  return args;
}

function printHelpAndExit(code = 0) {
  console.error(
    "Usage: node scripts/print-quality-badges.mjs --codacy <UUID> --codeclimate <TOKEN> [--repo o/r] [--branch main] [--check]",
  );
  process.exit(code);
}

const UUID_RE  = /^[0-9a-fA-F-]{8,}$/;
const TOKEN_RE = /^[0-9a-fA-F]{8,}$/;

function validate(args) {
  if (!args.codacy && !args.codeclimate) {
    console.error("Provide at least one of --codacy <UUID> or --codeclimate <TOKEN>.");
    printHelpAndExit(1);
  }
  if (args.codacy && !UUID_RE.test(args.codacy)) {
    console.error(`--codacy '${args.codacy}' does not look like a Codacy project UUID.`);
    process.exit(1);
  }
  if (args.codeclimate && !TOKEN_RE.test(args.codeclimate)) {
    console.error(`--codeclimate '${args.codeclimate}' does not look like a Code Climate token (hex string).`);
    process.exit(1);
  }
}

function buildBadges({ codacy, codeclimate, repo, branch }) {
  const out = [];

  if (codacy) {
    const shieldsUrl = `https://img.shields.io/codacy/grade/${codacy}/${branch}?label=Codacy&logo=codacy&style=flat-square`;
    const linkUrl    = `https://app.codacy.com/gh/${repo}/dashboard`;
    out.push({
      label: "Codacy",
      shieldsUrl,
      linkUrl,
      markdown: `[![Codacy](${shieldsUrl})](${linkUrl})`,
    });
  }

  if (codeclimate) {
    const shieldsUrl = `https://img.shields.io/codeclimate/maintainability/${repo}?label=Code%20Climate&logo=codeclimate&logoColor=white&style=flat-square`;
    const apiBadgeUrl = `https://api.codeclimate.com/v1/badges/${codeclimate}/maintainability`;
    const linkUrl     = `https://codeclimate.com/github/${repo}/maintainability`;
    out.push({
      label: "Code Climate (Shields)",
      shieldsUrl,
      linkUrl,
      markdown: `[![Code Climate](${shieldsUrl})](${linkUrl})`,
    });
    out.push({
      label: "Code Climate (native API badge)",
      shieldsUrl: apiBadgeUrl,
      linkUrl,
      markdown: `[![Maintainability](${apiBadgeUrl})](${linkUrl})`,
    });
  }

  return out;
}

/**
 * Probe a single URL: try HEAD first (cheap), then fall back to GET if HEAD
 * fails or returns a non-2xx (Shields/Codacy occasionally 405/403 on HEAD).
 * Returns { ok, status, method, finalUrl, ms, error }.
 */
async function probeUrl(url) {
  const attempt = async (method) => {
    const start = performance.now();
    try {
      // `redirect: "follow"` is the fetch default, but we set it explicitly so
      // res.url reflects the final resolved location after any redirects.
      const res = await fetch(url, { method, redirect: "follow" });
      const ms = Math.round(performance.now() - start);
      return { ok: res.ok, status: res.status, method, finalUrl: res.url || url, ms, error: null };
    } catch (err) {
      const ms = Math.round(performance.now() - start);
      return { ok: false, status: 0, method, finalUrl: url, ms, error: err.message };
    }
  };

  const head = await attempt("HEAD");
  if (head.ok) return head;
  // Retry with GET — many CDN-fronted badge endpoints reject or mis-cache HEAD.
  const get = await attempt("GET");
  // Prefer the GET result (it's the authoritative one), but annotate that HEAD was tried.
  return { ...get, retried: true, headStatus: head.status, headError: head.error };
}

async function checkBadgeUrls(badges) {
  let allOk = true;
  console.log("\n## URL reachability\n");
  for (const b of badges) {
    const r = await probeUrl(b.shieldsUrl);
    const icon = r.ok ? "✓" : "✗";
    const statusText = r.status === 0 ? "ERR" : String(r.status);
    const retryNote = r.retried
      ? ` (HEAD ${r.headError ? `err: ${r.headError}` : r.headStatus} → GET)`
      : "";
    console.log(`  ${icon} ${statusText.padStart(3)} ${String(r.ms).padStart(5)}ms  ${b.label}${retryNote}`);
    if (r.finalUrl && r.finalUrl !== b.shieldsUrl) {
      console.log(`         → resolved: ${r.finalUrl}`);
    } else {
      console.log(`         → url:      ${b.shieldsUrl}`);
    }
    if (r.error) {
      console.log(`         → error:    ${r.error}`);
    }
    if (!r.ok) allOk = false;
  }
  return allOk;
}

function printReadmeBlock(badges) {
  console.log("## Paste-ready README block\n");
  console.log("Replace the placeholder 'activate' badges in `readme.md` with these lines:\n");
  console.log("```markdown");
  for (const b of badges) {
    console.log(b.markdown);
  }
  console.log("```\n");
}

function printIndividual(badges) {
  console.log("## Individual badge URLs\n");
  for (const b of badges) {
    console.log(`### ${b.label}`);
    console.log(`  Image:  ${b.shieldsUrl}`);
    console.log(`  Link:   ${b.linkUrl}\n`);
  }
}

/* ------------------------------------------------------------------ */
/*  README rewrite                                                     */
/* ------------------------------------------------------------------ */

/**
 * Match either the placeholder ("activate" image) OR a previously written
 * live badge for the same provider, so this script is idempotent.
 *
 * Codacy line examples it matches:
 *   [![Codacy](https://img.shields.io/badge/Codacy-activate-...)](...)
 *   [![Codacy](https://img.shields.io/codacy/grade/<UUID>/main?...)](...)
 *
 * Code Climate line examples it matches (Shields or native API badge):
 *   [![Code Climate](https://img.shields.io/badge/Code%20Climate-activate-...)](...)
 *   [![Code Climate](https://img.shields.io/codeclimate/maintainability/...)](...)
 *   [![Maintainability](https://api.codeclimate.com/v1/badges/<TOKEN>/maintainability)](...)
 */
const CODACY_LINE_RE       = /^\[!\[Codacy\]\(https:\/\/img\.shields\.io\/(?:badge\/Codacy-activate|codacy\/grade)[^)]*\)\]\([^)]*\)\s*$/;
const CODECLIMATE_LINE_RE  = /^\[!\[(?:Code Climate|Maintainability)\]\((?:https:\/\/img\.shields\.io\/(?:badge\/Code%20Climate-activate|codeclimate\/maintainability)|https:\/\/api\.codeclimate\.com\/v1\/badges\/)[^)]*\)\]\([^)]*\)\s*$/;

function rewriteReadme({ original, badges, codacy, codeclimate }) {
  const lines = original.split("\n");
  const replacements = [];

  // Pick the canonical replacement line per provider from the generated badges.
  const codacyMd      = codacy      ? badges.find((b) => b.label === "Codacy")?.markdown ?? ""        : "";
  const codeclimateMd = codeclimate ? badges.find((b) => b.label === "Code Climate (Shields)")?.markdown ?? "" : "";

  let codacyHits = 0;
  let codeclimateHits = 0;

  const out = lines.map((line, idx) => {
    if (codacy && CODACY_LINE_RE.test(line)) {
      codacyHits++;
      replacements.push({ lineNo: idx + 1, before: line, after: codacyMd });
      return codacyMd;
    }
    if (codeclimate && CODECLIMATE_LINE_RE.test(line)) {
      codeclimateHits++;
      replacements.push({ lineNo: idx + 1, before: line, after: codeclimateMd });
      return codeclimateMd;
    }
    return line;
  });

  return {
    next: out.join("\n"),
    replacements,
    codacyHits,
    codeclimateHits,
  };
}

async function handleWriteReadme(args, badges) {
  const target = resolve(args.readmePath || "readme.md");
  if (!existsSync(target)) {
    console.error(`\n--write-readme: file not found at ${target}`);
    process.exit(1);
  }
  const original = await readFile(target, "utf8");
  const { next, replacements, codacyHits, codeclimateHits } = rewriteReadme({
    original,
    badges,
    codacy: Boolean(args.codacy),
    codeclimate: Boolean(args.codeclimate),
  });

  console.log(`\n## README rewrite (${target})\n`);

  if (replacements.length === 0) {
    console.error("No matching placeholder or existing badge lines found. Nothing to write.");
    console.error("Expected lines starting with `[![Codacy](...)` or `[![Code Climate](...)`.");
    process.exit(1);
  }

  for (const r of replacements) {
    console.log(`  line ${r.lineNo}:`);
    console.log(`    -  ${r.before}`);
    console.log(`    +  ${r.after}`);
  }

  if (args.codacy && codacyHits === 0) {
    console.error("\nWarning: --codacy supplied but no Codacy line was found in the README.");
  }
  if (args.codeclimate && codeclimateHits === 0) {
    console.error("\nWarning: --codeclimate supplied but no Code Climate line was found in the README.");
  }

  if (args.dryRun) {
    console.log("\n(dry run — no file written)");
    return;
  }

  if (next === original) {
    console.log("\nREADME already up to date — no write needed.");
    return;
  }

  await writeFile(target, next, "utf8");
  console.log(`\n✓ Wrote ${replacements.length} replacement(s) to ${target}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validate(args);

  const badges = buildBadges(args);

  console.log(`# Quality badges for ${args.repo}\n`);
  printReadmeBlock(badges);
  printIndividual(badges);

  if (args.writeReadme) {
    await handleWriteReadme(args, badges);
  }

  if (args.check) {
    const ok = await checkBadgeUrls(badges);
    if (!ok) {
      console.error("\nOne or more badge URLs failed. Activation may still be pending — wait for the first analysis.");
      process.exit(2);
    }
    console.log("\nAll badge URLs reachable.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
