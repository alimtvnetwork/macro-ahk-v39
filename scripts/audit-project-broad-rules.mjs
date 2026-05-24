#!/usr/bin/env node
/**
 * audit-project-broad-rules.mjs
 *
 * Step A diagnostic for the "link-click opens the extension" investigation.
 * Reads a chrome.storage.local export JSON (or directory) and flags any
 * project URL rule whose pattern is so broad it would match arbitrary
 * navigations (whole-internet globs, bare host wildcards, empty patterns).
 *
 * Pairs with the AUTOATTACH_* structured-log codes emitted by
 * src/background/auto-attach.ts — see mem://features/auto-attach-policy.md.
 *
 * Usage:
 *   node scripts/audit-project-broad-rules.mjs <path-to-export.json>
 *   node scripts/audit-project-broad-rules.mjs .lovable/diagnostics/
 *
 * Expected JSON shape (chrome.storage.local export):
 *   {
 *     "marco_projects": [{
 *       "id": "...", "name": "...",
 *       "targetUrls": [{ "pattern": "...", "matchType": "glob"|"exact"|"regex" }],
 *       "settings": { "autoStart": true|false }
 *     }]
 *   }
 *
 * Exit codes:
 *   0  no broad rules found
 *   1  at least one broad rule detected (informational)
 *   2  bad input / unreadable file
 *
 * No retries, no network, no mutation. Aligns with
 * mem://constraints/no-retry-policy and mem://standards/error-logging-requirements.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";

const PROJECTS_KEY = "marco_projects";

/** Patterns considered "broad" — would match well beyond a single product surface. */
const BROAD_GLOB_PATTERNS = new Set([
    "",
    "*",
    "**",
    "*://*/*",
    "*://*/**",
    "https://*/*",
    "http://*/*",
    "https://*",
    "http://*",
    "<all_urls>",
]);

function fail(code, reason, detail) {
    console.error(
        `[audit-project-broad-rules] FAIL code=${code} reason=${reason} detail=${detail}`,
    );
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
    const abs = resolve(target);
    let st;
    try {
        st = await stat(abs);
    } catch (err) {
        fail(2, "StatFailed", `path=${abs} message=${err?.message ?? "unknown"}`);
    }
    if (st.isFile()) return [abs];
    if (!st.isDirectory()) {
        fail(2, "UnsupportedInput", `path=${abs} kind=${st.isFIFO() ? "fifo" : "other"}`);
    }
    const entries = await readdir(abs);
    return entries
        .filter((e) => extname(e).toLowerCase() === ".json")
        .map((e) => join(abs, e));
}

/** Classifies a single pattern. Returns null when the pattern is acceptable. */
function classifyBroadness(pattern, matchType) {
    const value = (pattern ?? "").trim();
    if (matchType === "regex") {
        // Treat catch-all regexes as broad.
        if (value === "" || value === ".*" || value === "^.*$" || value === "/.*/") {
            return { code: "BROAD_REGEX_CATCHALL", detail: `regex="${value}"` };
        }
        return null;
    }
    if (matchType === "exact") {
        if (value === "") {
            return { code: "BROAD_EXACT_EMPTY", detail: "exact pattern is empty" };
        }
        return null;
    }
    // Default: glob
    if (BROAD_GLOB_PATTERNS.has(value)) {
        return { code: "BROAD_GLOB_CATCHALL", detail: `glob="${value}"` };
    }
    // Heuristic: a bare scheme-host wildcard like "https://*" with no path segment.
    if (/^https?:\/\/\*\/?$/.test(value)) {
        return { code: "BROAD_GLOB_HOST_WILDCARD", detail: `glob="${value}"` };
    }
    return null;
}

function auditProjects(projects) {
    const findings = [];
    for (const project of projects) {
        const rules = Array.isArray(project.targetUrls) ? project.targetUrls : [];
        const autoStart = project?.settings?.autoStart === true;
        for (const rule of rules) {
            const verdict = classifyBroadness(rule?.pattern, rule?.matchType ?? "glob");
            if (verdict !== null) {
                findings.push({
                    projectId: project.id,
                    projectName: project.name,
                    autoStart,
                    matchType: rule?.matchType ?? "glob",
                    pattern: rule?.pattern ?? "",
                    code: verdict.code,
                    detail: verdict.detail,
                });
            }
        }
    }
    return findings;
}

function printReport(findings, source) {
    if (findings.length === 0) {
        console.log(`[audit-project-broad-rules] OK source=${source} broad_rules=0`);
        return;
    }
    console.log(
        `[audit-project-broad-rules] FOUND source=${source} broad_rules=${findings.length}`,
    );
    for (const f of findings) {
        const risk = f.autoStart ? "HIGH (autoStart=true)" : "LOW (autoStart=false)";
        console.log(
            `  - [${f.code}] project="${f.projectName}" id=${f.projectId} matchType=${f.matchType} pattern="${f.pattern}" risk=${risk} ${f.detail}`,
        );
    }
}

async function main() {
    const arg = process.argv[2];
    if (!arg) {
        fail(2, "MissingArg", "usage: node scripts/audit-project-broad-rules.mjs <export.json|dir>");
    }
    const files = await collectInputFiles(arg);
    if (files.length === 0) {
        fail(2, "NoJsonFiles", `path=${arg}`);
    }
    let totalBroad = 0;
    for (const file of files) {
        const json = await loadJsonFile(file);
        const projects = Array.isArray(json?.[PROJECTS_KEY]) ? json[PROJECTS_KEY] : [];
        const findings = auditProjects(projects);
        totalBroad += findings.length;
        printReport(findings, file);
    }
    process.exit(totalBroad === 0 ? 0 : 1);
}

await main();
