#!/usr/bin/env node
/**
 * audit-project-script-bindings.mjs
 *
 * Phase-1 diagnostic helper for the "Dashboard scripts not available" plan.
 * Reads a chrome.storage.local export JSON (or directory of exports) and prints
 * a per-project mismatch table comparing `project.scripts[].path` against
 * `StoredScript.name` from the library.
 *
 * Usage:
 *   node scripts/audit-project-script-bindings.mjs <path-to-export.json>
 *   node scripts/audit-project-script-bindings.mjs .lovable/diagnostics/
 *
 * Expected JSON shape (chrome.storage.local export):
 *   {
 *     "marco_projects": [{ "id": "...", "name": "...", "url": "...",
 *                          "scripts": [{ "path": "...", "order": 0 }, ...] }],
 *     "marco_scripts":  [{ "id": "...", "name": "...", ... }]
 *   }
 *
 * Exit codes:
 *   0  no mismatches found
 *   1  at least one unbound binding detected (non-fatal — informational)
 *   2  bad input / unreadable file
 *
 * No retries, no network, no mutation — read-only diagnostic.
 * Aligns with `mem://constraints/no-retry-policy` and
 * `mem://standards/error-logging-requirements`.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";

const PROJECTS_KEY = "marco_projects";
const SCRIPTS_KEY = "marco_scripts";

/** @typedef {{ path: string; order?: number }} StoredProjectScript */
/** @typedef {{ id: string; name: string; url?: string; scripts?: StoredProjectScript[] }} StoredProject */
/** @typedef {{ id: string; name: string }} StoredScript */

function fail(code, reason, detail) {
    // eslint-disable-next-line no-console
    console.error(`[audit-project-script-bindings] FAIL code=${code} reason=${reason} detail=${detail}`);
    process.exit(code);
}

async function loadJsonFile(filePath) {
    let raw;
    try {
        raw = await readFile(filePath, "utf8");
    } catch (err) {
        fail(2, "ReadFailed", `path=${filePath} message=${err?.message ?? "unknown"}`);
    }
    try {
        return JSON.parse(raw);
    } catch (err) {
        fail(2, "ParseFailed", `path=${filePath} message=${err?.message ?? "unknown"}`);
    }
}

async function collectInputFiles(target) {
    const absolute = resolve(target);
    let info;
    try {
        info = await stat(absolute);
    } catch (err) {
        fail(2, "StatFailed", `path=${absolute} message=${err?.message ?? "unknown"}`);
    }
    if (info.isFile()) {
        return [absolute];
    }
    if (info.isDirectory()) {
        const entries = await readdir(absolute);
        const jsonFiles = entries
            .filter((name) => extname(name).toLowerCase() === ".json")
            .map((name) => join(absolute, name))
            .sort();
        if (jsonFiles.length === 0) {
            fail(2, "EmptyDir", `path=${absolute} reason=no .json files found`);
        }
        return jsonFiles;
    }
    fail(2, "BadInput", `path=${absolute} reason=not a file or directory`);
    return [];
}

/**
 * Re-implements the runtime matcher in `ProjectDetailView.findScript`:
 *   1. exact name
 *   2. basename
 *   3. suffix "/" + basename
 */
function findMatch(path, library) {
    const exact = library.find((s) => s.name === path);
    if (exact) return { kind: "exact", script: exact };
    const basename = path.includes("/") ? path.split("/").pop() : path;
    const byBase = library.find((s) => s.name === basename);
    if (byBase) return { kind: "basename", script: byBase };
    const bySuffix = library.find((s) => s.name.endsWith("/" + basename));
    if (bySuffix) return { kind: "suffix", script: bySuffix };
    return { kind: "missing", script: null };
}

function auditBundle(bundle, sourcePath) {
    const projects = Array.isArray(bundle?.[PROJECTS_KEY]) ? bundle[PROJECTS_KEY] : [];
    const library = Array.isArray(bundle?.[SCRIPTS_KEY]) ? bundle[SCRIPTS_KEY] : [];

    // eslint-disable-next-line no-console
    console.log(`\n=== ${sourcePath} ===`);
    // eslint-disable-next-line no-console
    console.log(`projects=${projects.length} libraryScripts=${library.length}`);

    if (library.length === 0) {
        // eslint-disable-next-line no-console
        console.log("⚠ Library is empty — every binding will appear unbound. Reason: marco_scripts missing or not exported.");
    }

    const rows = [];
    let unboundCount = 0;
    let driftCount = 0;

    for (const project of projects) {
        const scripts = project?.scripts ?? [];
        for (const entry of scripts) {
            const match = findMatch(entry.path, library);
            const status = match.kind === "missing" ? "UNBOUND" : match.kind === "exact" ? "OK" : `DRIFT(${match.kind})`;
            if (match.kind === "missing") unboundCount += 1;
            if (match.kind !== "missing" && match.kind !== "exact") driftCount += 1;
            rows.push({
                Project: `${project.name} [${project.id}]`,
                "Saved path": entry.path,
                Status: status,
                "Resolved library name": match.script?.name ?? "—",
            });
        }
    }

    if (rows.length === 0) {
        // eslint-disable-next-line no-console
        console.log("(no project.scripts bindings to audit)");
    } else {
        // eslint-disable-next-line no-console
        console.table(rows);
    }

    // eslint-disable-next-line no-console
    console.log(`Summary: bindings=${rows.length} ok=${rows.length - unboundCount - driftCount} drift=${driftCount} unbound=${unboundCount}`);
    return { unboundCount, driftCount };
}

async function main() {
    const target = process.argv[2];
    if (!target) {
        fail(2, "UsageError", "missing argument — usage: node scripts/audit-project-script-bindings.mjs <file-or-dir>");
    }

    const files = await collectInputFiles(target);
    let totalUnbound = 0;
    let totalDrift = 0;

    for (const file of files) {
        const bundle = await loadJsonFile(file);
        const { unboundCount, driftCount } = auditBundle(bundle, file);
        totalUnbound += unboundCount;
        totalDrift += driftCount;
    }

    // eslint-disable-next-line no-console
    console.log(`\nGrand total: files=${files.length} unbound=${totalUnbound} drift=${totalDrift}`);
    process.exit(totalUnbound > 0 ? 1 : 0);
}

main();
