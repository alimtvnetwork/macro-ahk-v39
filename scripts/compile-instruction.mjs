#!/usr/bin/env node
/**
 * compile-instruction.mjs
 *
 * Compiles a standalone script's `src/instruction.ts` -> canonical
 * artifact in `dist/`:
 *
 *   1. dist/instruction.json         <- canonical, **pure PascalCase**
 *   2. dist/instruction.compat.json  <- transitional camelCase snapshot
 *
 * --- Phase 2c canonical-only emit (PascalCase) ---
 *
 * Phase 1 emitted a single file with BOTH spellings merged on every
 * object node. That worked, but it (a) doubled the file size, (b) made
 * the JSON noisy and ambiguous to read, and (c) let consumers silently
 * keep using the wrong spelling because both keys "just worked".
 *
 * Phase 2b split the two spellings into two physical files. Phase 2c
 * moved all runtime readers to the canonical PascalCase file, but the
 * compat snapshot is still emitted so older CI artifact checks and
 * queued workflow runs can validate the same dist payload safely:
 *
 *   - `instruction.json` is pure PascalCase. This is what every
 *     Phase 2a-migrated reader consumes (background runtime,
 *     manifest-seeder, generate-seed-manifest.mjs, builtin-script-guard,
 *     script-info-handler, runtime-injection-handler, ...).
 *
 *   - `instruction.compat.json` is pure camelCase and exists only as a
 *     transitional artifact. Runtime consumers must not read it.
 *
 * Usage: node scripts/compile-instruction.mjs <script-folder-path>
 * Example: node scripts/compile-instruction.mjs standalone-scripts/macro-controller
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCHEMA_VERSION_CONTRACT_PATH = join(
    ROOT,
    "standalone-scripts/types/instruction/primitives/schema-version.json",
);

function loadCurrentSchemaVersion() {
    if (!existsSync(SCHEMA_VERSION_CONTRACT_PATH)) {
        throw new Error(
            `[compile-instruction] Missing schema contract at ${SCHEMA_VERSION_CONTRACT_PATH}; ` +
            `cannot pin instruction SchemaVersion.`,
        );
    }
    const raw = JSON.parse(readFileSync(SCHEMA_VERSION_CONTRACT_PATH, "utf-8"));
    if (typeof raw.current !== "string" || raw.current.length === 0) {
        throw new Error(
            `[compile-instruction] Invalid schema contract at ${SCHEMA_VERSION_CONTRACT_PATH}; ` +
            `missing non-empty "current" SchemaVersion.`,
        );
    }
    return raw.current;
}

function releaseMajorMinor(version) {
    if (typeof version !== "string") return null;
    const match = version.match(/^(\d+\.\d+)\.\d+$/);
    return match ? match[1] : null;
}

function pinSchemaVersion(obj, tsPath, folderArg) {
    const currentSchemaVersion = loadCurrentSchemaVersion();
    if (obj.SchemaVersion === currentSchemaVersion) return obj;

    const accidentalReleaseSchemaVersion = releaseMajorMinor(obj.Version);
    if (obj.SchemaVersion === accidentalReleaseSchemaVersion) {
        console.warn(
            `[WARN] ${folderArg}/src/instruction.ts had SchemaVersion "${obj.SchemaVersion}" ` +
            `derived from release Version "${obj.Version}"; emitting SchemaVersion ` +
            `"${currentSchemaVersion}" and leaving Version unchanged.`,
        );
        return { ...obj, SchemaVersion: currentSchemaVersion };
    }

    throw new Error(
        `[compile-instruction] Unsupported SchemaVersion in ${tsPath}: ` +
        `expected "${currentSchemaVersion}" from ${SCHEMA_VERSION_CONTRACT_PATH}, ` +
        `got ${JSON.stringify(obj.SchemaVersion)}. Release numbers belong in Version only.`,
    );
}

/* ------------------------------------------------------------------ */
/*  Key-casing helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * PascalCase -> camelCase: lowercase the first character only, leave the
 * rest untouched. Acronym-heavy keys (`URL`, `XPaths`, `IsIife`) get
 * their leading char lowercased only - matching the legacy spelling
 * already in the codebase (`url`, `xPaths`, `isIife`).
 *
 * Returns the input unchanged when the first character is not an
 * uppercase letter (so existing camelCase or single-lowercase keys
 * pass through untouched, which makes this safe for mixed-case trees).
 */
function toCamelCase(key) {
    if (!key) return key;
    const first = key[0];
    if (first !== first.toUpperCase() || first === first.toLowerCase()) {
        // Either already lowercase or a non-letter character.
        return key;
    }
    return first.toLowerCase() + key.slice(1);
}

/**
 * Recursively convert every object key in `value` to camelCase. Arrays
 * are walked element-by-element. Non-object leaves (strings, numbers,
 * booleans, null, undefined) are returned as-is.
 *
 * If two source keys collide after conversion (e.g. both "Foo" and
 * "foo" exist on the same object), the later-iterated key wins. This
 * cannot actually happen in a well-formed PascalCase source tree, but
 * we guard against it by failing loudly so a typo in `instruction.ts`
 * doesn't silently drop a field.
 */
function toCamelCaseTree(value, path = "$") {
    if (Array.isArray(value)) {
        return value.map((item, idx) => toCamelCaseTree(item, `${path}[${idx}]`));
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const out = {};
    const seen = new Map(); // camelKey -> originalKey, for collision detection
    for (const [key, val] of Object.entries(value)) {
        const camel = toCamelCase(key);
        if (seen.has(camel) && seen.get(camel) !== key) {
            throw new Error(
                `[compile-instruction] camelCase key collision at ${path}: ` +
                `"${seen.get(camel)}" and "${key}" both map to "${camel}". ` +
                `Rename one of them in the source instruction.ts.`,
            );
        }
        seen.set(camel, key);
        out[camel] = toCamelCaseTree(val, `${path}.${key}`);
    }
    return out;
}

/* ------------------------------------------------------------------ */
/*  Source extraction                                                   */
/* ------------------------------------------------------------------ */

/**
 * Extract and evaluate the `const instruction: ... = { ... };` literal
 * from a TypeScript source string. Also collects simple top-level
 * `const NAME[: T] = ...;` declarations that appear BEFORE the
 * instruction block, so identifiers like `LOVABLE_BASE_URL` resolve
 * during evaluation.
 *
 * Returns the evaluated plain JS object (the instruction tree).
 *
 * Throws if the instruction block cannot be located. We do not run
 * `tsc` here - the source files are intentionally limited to a single
 * top-level object literal so this lightweight regex extraction is
 * sufficient and avoids dragging the TypeScript compiler into the
 * build-time hot path.
 */
function evaluateInstructionSource(source, tsPath) {
    const match = source.match(
        /const\s+instruction\s*(?::\s*[^=]+?)?\s*=\s*(\{[\s\S]*?\n\});/,
    );
    if (!match) {
        throw new Error(`Could not extract instruction object from ${tsPath}`);
    }

    const preambleLines = [];
    const lines = source.split("\n");
    for (const line of lines) {
        if (/^\s*const\s+instruction\s*(?::\s*[^=]+?)?\s*=/.test(line)) break;
        const constMatch = line.match(/^\s*(const\s+\w+)\s*(?::\s*\w+)?\s*=\s*(.+?);?\s*$/);
        if (constMatch) {
            preambleLines.push(`${constMatch[1]} = ${constMatch[2]};`);
        }
    }

    const evalCode = preambleLines.join("\n") + "\nreturn (" + match[1] + ")";
    return new Function(evalCode)();
}

/* ------------------------------------------------------------------ */
/*  Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
    const folderArg = process.argv[2];
    if (!folderArg) {
        console.error("Usage: node scripts/compile-instruction.mjs <script-folder>");
        process.exit(1);
    }

    const folder = resolve(ROOT, folderArg);
    const tsPath = join(folder, "src", "instruction.ts");
    const distDir = join(folder, "dist");
    const canonicalOutPath = join(distDir, "instruction.json");
    const compatOutPath = join(distDir, "instruction.compat.json");

    if (!existsSync(tsPath)) {
        console.log(`[INFO] No instruction.ts in ${folderArg}/src/ - skipping`);
        return;
    }

    const source = readFileSync(tsPath, "utf-8");
    const obj = pinSchemaVersion(evaluateInstructionSource(source, tsPath), tsPath, folderArg);

    // Runtime readers consume only the canonical PascalCase artifact.
    // Keep emitting the transitional camelCase snapshot because older
    // queued CI workflow revisions still assert its presence after
    // downloading each standalone dist artifact.
    const canonical = obj;
    const compat = toCamelCaseTree(obj);

    mkdirSync(distDir, { recursive: true });
    writeFileSync(canonicalOutPath, JSON.stringify(canonical, null, 2) + "\n", "utf-8");
    writeFileSync(compatOutPath, JSON.stringify(compat, null, 2) + "\n", "utf-8");

    console.log(`[OK] Compiled instruction.json -> ${canonicalOutPath} (PascalCase, canonical)`);
    console.log(`[OK] Compiled instruction.compat.json -> ${compatOutPath} (camelCase, transitional)`);
}

main().catch((err) => {
    console.error("[FAIL] compile-instruction failed:", err);
    process.exit(1);
});
