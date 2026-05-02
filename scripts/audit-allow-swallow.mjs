#!/usr/bin/env node
/**
 * audit-allow-swallow.mjs
 *
 * Two responsibilities in one pass:
 *
 *   1. INVENTORY  — Walk `src/` and `standalone-scripts/` for every
 *      `// allow-swallow: <reason>` (or `/* allow-swallow: ... *​/`)
 *      marker, capture file / line / justification / surrounding
 *      catch snippet, and write a deterministic Markdown report to
 *      `.lovable/audits/allow-swallow-sites.md` (also a JSON sibling
 *      `.lovable/audits/allow-swallow-sites.json` for tooling).
 *
 *   2. GATE       — Run `scripts/check-no-swallowed-errors.mjs --strict`
 *      so this command also fails CI the moment a new empty `catch {}`
 *      block (or no-op `.catch(() => {})`) appears WITHOUT a paired
 *      `allow-swallow:` justification. The strict mode bypasses the
 *      baseline, i.e. only known historic findings are tolerated; any
 *      new occurrence is a hard error.
 *
 * Markers that lack a non-empty reason after the colon are also flagged
 * (`Reason: <missing>`), so a contributor can't satisfy the linter by
 * dropping a bare `// allow-swallow:` with no rationale.
 *
 * Usage:
 *   node scripts/audit-allow-swallow.mjs                  # write report + run gate
 *   node scripts/audit-allow-swallow.mjs --report-only    # skip the strict gate
 *   node scripts/audit-allow-swallow.mjs --stdout         # print MD, do not write
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const REPORT_ONLY = args.includes("--report-only");
const STDOUT_MODE = args.includes("--stdout");

const SCAN_DIRS = ["src", "standalone-scripts"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cts"]);
const SKIP_DIR_NAMES = new Set([
    "node_modules", "dist", "build", ".release", "skipped",
    "__tests__", "__mocks__", "test_reports", ".turbo", ".vite", "coverage",
]);
const SKIP_FILENAME_PATTERNS = [/\.test\.[mc]?[jt]sx?$/, /\.spec\.[mc]?[jt]sx?$/, /\.d\.ts$/];

const OUT_MD = join(REPO_ROOT, ".lovable", "audits", "allow-swallow-sites.md");
const OUT_JSON = join(REPO_ROOT, ".lovable", "audits", "allow-swallow-sites.json");

/* ------------------------------------------------------------------ */
/*  Walker                                                             */
/* ------------------------------------------------------------------ */

function shouldSkipFile(name) {
    return SKIP_FILENAME_PATTERNS.some((re) => re.test(name));
}

function* walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
        if (SKIP_DIR_NAMES.has(name)) continue;
        const full = join(dir, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) { yield* walk(full); continue; }
        if (!st.isFile()) continue;
        if (shouldSkipFile(name)) continue;
        const dot = name.lastIndexOf(".");
        if (dot === -1) continue;
        if (!SCAN_EXTENSIONS.has(name.slice(dot))) continue;
        yield full;
    }
}

/* ------------------------------------------------------------------ */
/*  Marker extraction                                                  */
/* ------------------------------------------------------------------ */

const MARKER_RE = /allow-swallow\s*:\s*(.*?)(?:\*\/|$)/i;

function extractMarkers(filePath) {
    let src;
    try { src = readFileSync(filePath, "utf8"); } catch { return []; }
    if (!src.includes("allow-swallow")) return [];

    const lines = src.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
        const m = MARKER_RE.exec(lines[i]);
        if (!m) continue;
        const reason = (m[1] ?? "").trim().replace(/\s+/g, " ");
        out.push({
            file: relative(REPO_ROOT, filePath).split(sep).join("/"),
            line: i + 1,
            reason: reason.length > 0 ? reason : null,
            snippet: lines[i].trim(),
        });
    }
    return out;
}

/* ------------------------------------------------------------------ */
/*  Report                                                             */
/* ------------------------------------------------------------------ */

function buildMarkdown(items, missing) {
    const generatedAt = new Date().toISOString();
    const byFile = new Map();
    for (const it of items) {
        if (!byFile.has(it.file)) byFile.set(it.file, []);
        byFile.get(it.file).push(it);
    }
    const sortedFiles = [...byFile.keys()].sort();

    const lines = [];
    lines.push("# Allow-Swallow Audit Report");
    lines.push("");
    lines.push(`**Generated:** ${generatedAt}`);
    lines.push(`**Total sites:** ${items.length}`);
    lines.push(`**Sites missing justification:** ${missing.length}`);
    lines.push("");
    lines.push("> Auto-generated by `scripts/audit-allow-swallow.mjs`. Do not edit by hand.");
    lines.push("> Each entry is an intentional, reviewed swallow of a caught error.");
    lines.push("> Any new empty `catch {}` without an `allow-swallow:` justification will fail CI via");
    lines.push("> `scripts/check-no-swallowed-errors.mjs --strict`.");
    lines.push("");

    if (missing.length > 0) {
        lines.push("## ⚠️ Sites missing justification");
        lines.push("");
        lines.push("| File | Line | Snippet |");
        lines.push("|------|-----:|---------|");
        for (const it of missing) {
            lines.push(`| \`${it.file}\` | ${it.line} | \`${escapeCell(it.snippet)}\` |`);
        }
        lines.push("");
    }

    lines.push("## All allow-swallow sites");
    lines.push("");
    for (const file of sortedFiles) {
        const rows = byFile.get(file).sort((a, b) => a.line - b.line);
        lines.push(`### \`${file}\` (${rows.length})`);
        lines.push("");
        lines.push("| Line | Justification |");
        lines.push("|-----:|---------------|");
        for (const r of rows) {
            const reason = r.reason ?? "_⚠️ missing — please add a reason after `allow-swallow:`_";
            lines.push(`| ${r.line} | ${escapeCell(reason)} |`);
        }
        lines.push("");
    }

    return lines.join("\n") + "\n";
}

function escapeCell(s) {
    return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/* ------------------------------------------------------------------ */
/*  Strict gate                                                        */
/* ------------------------------------------------------------------ */

function runStrictGate() {
    const scanner = join(REPO_ROOT, "scripts", "check-no-swallowed-errors.mjs");
    const result = spawnSync(process.execPath, [scanner, "--strict"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: "inherit",
        maxBuffer: 32 * 1024 * 1024,
    });
    return result.status ?? 1;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

function main() {
    const items = [];
    for (const d of SCAN_DIRS) {
        const root = join(REPO_ROOT, d);
        for (const f of walk(root)) items.push(...extractMarkers(f));
    }
    items.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    const missing = items.filter((it) => it.reason === null);

    const md = buildMarkdown(items, missing);

    if (STDOUT_MODE) {
        process.stdout.write(md);
    } else {
        mkdirSync(dirname(OUT_MD), { recursive: true });
        writeFileSync(OUT_MD, md, "utf8");
        writeFileSync(
            OUT_JSON,
            JSON.stringify({ GeneratedAt: new Date().toISOString(), Items: items, Missing: missing }, null, 2) + "\n",
            "utf8",
        );
        process.stdout.write(
            `Wrote ${relative(REPO_ROOT, OUT_MD)}\n` +
            `Wrote ${relative(REPO_ROOT, OUT_JSON)}\n` +
            `  Total sites: ${items.length}  Missing justification: ${missing.length}\n`,
        );
    }

    let exitCode = 0;

    if (missing.length > 0) {
        process.stderr.write(
            `\n❌ ${missing.length} allow-swallow marker(s) lack a justification:\n`,
        );
        for (const it of missing) {
            process.stderr.write(`   ${it.file}:${it.line}  ${it.snippet}\n`);
        }
        process.stderr.write(
            `Reason: every \`allow-swallow:\` marker MUST be followed by a non-empty rationale.\n`,
        );
        exitCode = 1;
    }

    if (!REPORT_ONLY) {
        const gateStatus = runStrictGate();
        if (gateStatus !== 0) {
            process.stderr.write(
                `\n❌ check-no-swallowed-errors --strict failed (exit ${gateStatus}).\n` +
                `   New empty catch / no-op .catch() detected without an allow-swallow justification.\n`,
            );
            exitCode = exitCode || gateStatus;
        }
    }

    process.exit(exitCode);
}

main();
