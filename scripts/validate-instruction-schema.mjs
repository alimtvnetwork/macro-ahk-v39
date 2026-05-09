#!/usr/bin/env node
/**
 * validate-instruction-schema.mjs
 *
 * STRICT structural schema validator for the dist/instruction.json (and
 * its sibling dist/instruction.compat.json) artifacts emitted by
 * `scripts/compile-instruction.mjs`.
 *
 * Whereas `check-instruction-json-casing.mjs` only validates the SHAPE
 * of object keys (PascalCase vs camelCase), this validator enforces the
 * SEMANTIC schema documented in
 * `standalone-scripts/types/instruction/project-instruction.ts`:
 *
 *   - Required top-level keys present and correctly typed
 *   - Optional keys, when present, correctly typed
 *   - String enums (World, RunAt, MatchType, Inject, Role) within the
 *     allowed literal set
 *   - Arrays of objects (Dependencies, Cookies, TargetUrls, Css, ...)
 *     each element validated against its own sub-schema
 *   - UNKNOWN keys at any node are rejected (closed schema) - the
 *     compile step is supposed to be lossless, so any new key is
 *     either a typo or a missed schema bump.
 *   - Cross-field invariants: every Asset.Scripts[].ConfigBinding /
 *     ThemeBinding must reference an existing Seed.ConfigSeedIds key,
 *     and every Configs[].Key must also be referenced by ConfigSeedIds.
 *
 * Usage:
 *   node scripts/validate-instruction-schema.mjs <project-folder>
 *     -> validate exactly one project (matches compile-instruction.mjs CLI)
 *
 *   node scripts/validate-instruction-schema.mjs
 *     -> scan every standalone-scripts/<name>/dist/{instruction,instruction.compat}.json
 *
 * Exit codes:
 *   0 - every scanned artifact passes
 *   1 - at least one schema violation. GitHub Actions annotations are
 *       emitted (one per violation, capped) when GITHUB_ACTIONS=true.
 *   2 - repo layout broken (missing standalone-scripts/) or a referenced
 *       project lacks dist/ artifacts (mirrors check-instruction-json-casing).
 *       In per-project mode (folder argument supplied) a missing dist/
 *       exits 2 immediately. In repo-wide mode a missing dist/ for one
 *       project counts toward the exit-1 summary so a single un-built
 *       sibling does not mask other projects' schema violations.
 *       Also fires when repo-wide discovery returns zero projects (a
 *       sparse-checkout / misconfiguration safeguard).
 *   3 - validator itself crashed (uncaught throw inside main). Treated
 *       as fail-closed so a future schema refactor cannot accidentally
 *       pass green via a swallowed rejection.
 *
 * Design notes:
 *   - Hand-rolled validator (no ajv) to keep zero external deps in the
 *     build hot-path - `compile-instruction.mjs` itself is dep-free, so
 *     pulling in ajv + json-schema files just for this gate would be a
 *     regression.
 *   - Schema is defined twice: once for PascalCase (canonical), and a
 *     mechanical camelCase mirror is derived for the compat artifact.
 *     This guarantees both files are validated from the SAME source of
 *     truth - drift between the two artifacts is impossible.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const STANDALONE_DIR = resolve(REPO_ROOT, "standalone-scripts");
const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === "true";
const MAX_ANNOTATIONS = Number.parseInt(
    process.env.INSTRUCTION_SCHEMA_MAX_ANNOTATIONS ?? "",
    10,
) || 50;

const rel = (p) => relative(REPO_ROOT, p) || p;

/* ------------------------------------------------------------------ */
/*  SchemaVersion contract.                                             */
/*                                                                      */
/*  Loaded from `standalone-scripts/types/instruction/primitives/       */
/*  schema-version.json` - the single source of truth shared with the   */
/*  TypeScript runtime (`schema-version.ts` mirror). Loading here keeps */
/*  this script dep-free (no TS parser) while still failing CI the      */
/*  moment a project's `instruction.json` declares an unsupported       */
/*  SchemaVersion (e.g. "2.0" before the runtime knows how to read it). */
/* ------------------------------------------------------------------ */

const SCHEMA_VERSION_CONTRACT_PATH = resolve(
    STANDALONE_DIR,
    "types/instruction/primitives/schema-version.json",
);

function loadSchemaVersionContract() {
    if (!existsSync(SCHEMA_VERSION_CONTRACT_PATH)) {
        throw new Error(
            `SchemaVersion contract missing at ${rel(SCHEMA_VERSION_CONTRACT_PATH)} ` +
            `- restore from schema-version.ts or git history`,
        );
    }
    const raw = JSON.parse(readFileSync(SCHEMA_VERSION_CONTRACT_PATH, "utf-8"));
    if (typeof raw.pattern !== "string"
        || !Array.isArray(raw.supported)
        || raw.supported.length === 0
        || typeof raw.current !== "string") {
        throw new Error(
            `SchemaVersion contract malformed at ${rel(SCHEMA_VERSION_CONTRACT_PATH)} ` +
            `- expected { pattern: string, supported: string[>=1], current: string }`,
        );
    }
    let pattern;
    try { pattern = new RegExp(raw.pattern); }
    catch (err) {
        throw new Error(
            `SchemaVersion contract has invalid regex pattern ${JSON.stringify(raw.pattern)}: ${err.message}`,
        );
    }
    if (!raw.supported.includes(raw.current)) {
        throw new Error(
            `SchemaVersion contract drift: current="${raw.current}" not in supported=${JSON.stringify(raw.supported)}`,
        );
    }
    return {
        pattern,
        patternSource: raw.pattern,
        supported: raw.supported,
        current: raw.current,
    };
}

const SCHEMA_VERSION_CONTRACT = loadSchemaVersionContract();

/* ------------------------------------------------------------------ */
/*  Schema (PascalCase canonical).                                      */
/*                                                                      */
/*  Each schema node is one of:                                          */
/*   { kind:"string", enum?: string[] }                                  */
/*   { kind:"number" }                                                   */
/*   { kind:"boolean" }                                                  */
/*   { kind:"array", items: <schema> }                                   */
/*   { kind:"object", required: string[], optional?: string[],           */
/*     properties: { [key]: <schema> },                                  */
/*     additionalKeysAllowed?: boolean (default false),                  */
/*     additionalValueSchema?: <schema> }                                */
/* ------------------------------------------------------------------ */

const TargetUrlSchema = {
    kind: "object",
    required: ["Pattern", "MatchType"],
    properties: {
        Pattern: { kind: "string" },
        MatchType: { kind: "string", enum: ["glob", "regex", "exact"] },
    },
};

const CookieSpecSchema = {
    kind: "object",
    required: ["CookieName", "Url", "Role", "Description"],
    properties: {
        CookieName: { kind: "string" },
        Url: { kind: "string" },
        Role: { kind: "string", enum: ["session", "refresh", "other"] },
        Description: { kind: "string" },
    },
};

const ConfigSeedIdsSchema = {
    kind: "object",
    required: [],
    properties: {},
    // Keys here are user-chosen lowercase binding identifiers
    // ({config, theme}, ...). Allow any string->string mapping.
    additionalKeysAllowed: true,
    additionalValueSchema: { kind: "string" },
};

const SeedSchema = {
    kind: "object",
    required: ["Id", "SeedOnInstall", "IsRemovable", "AutoInject", "TargetUrls", "Cookies", "Settings"],
    optional: ["RunAt", "CookieBinding", "ConfigSeedIds"],
    properties: {
        Id: { kind: "string" },
        SeedOnInstall: { kind: "boolean" },
        IsRemovable: { kind: "boolean" },
        AutoInject: { kind: "boolean" },
        RunAt: { kind: "string", enum: ["document_start", "document_end", "document_idle"] },
        CookieBinding: { kind: "string" },
        TargetUrls: { kind: "array", items: TargetUrlSchema },
        Cookies: { kind: "array", items: CookieSpecSchema },
        // Settings is a project-specific shape - we accept any object.
        Settings: { kind: "object", required: [], properties: {}, additionalKeysAllowed: true },
        ConfigSeedIds: ConfigSeedIdsSchema,
    },
};

const CssAssetSchema = {
    kind: "object",
    required: ["File", "Inject"],
    properties: {
        File: { kind: "string" },
        Inject: { kind: "string", enum: ["head"] },
    },
};

const ConfigAssetSchema = {
    kind: "object",
    required: ["File", "Key"],
    optional: ["InjectAs"],
    properties: {
        File: { kind: "string" },
        Key: { kind: "string" },
        InjectAs: { kind: "string" },
    },
};

const ScriptAssetSchema = {
    kind: "object",
    required: ["File", "Order"],
    optional: ["ConfigBinding", "ThemeBinding", "IsIife"],
    properties: {
        File: { kind: "string" },
        Order: { kind: "number" },
        ConfigBinding: { kind: "string" },
        ThemeBinding: { kind: "string" },
        IsIife: { kind: "boolean" },
    },
};

const TemplateAssetSchema = {
    kind: "object",
    required: ["File"],
    optional: ["InjectAs"],
    properties: {
        File: { kind: "string" },
        InjectAs: { kind: "string" },
    },
};

const PromptAssetSchema = {
    kind: "object",
    required: ["File"],
    properties: { File: { kind: "string" } },
};

const AssetsSchema = {
    kind: "object",
    required: ["Css", "Configs", "Scripts", "Templates", "Prompts"],
    properties: {
        Css: { kind: "array", items: CssAssetSchema },
        Configs: { kind: "array", items: ConfigAssetSchema },
        Scripts: { kind: "array", items: ScriptAssetSchema },
        Templates: { kind: "array", items: TemplateAssetSchema },
        Prompts: { kind: "array", items: PromptAssetSchema },
    },
};

// XPathRegistry uses lowercase keys by design (entries/groups), see
// `mem://standards/pascalcase-json-keys` exception. Schema is permissive
// because individual XPath entry shape is owned by xpath/ subtree.
const XPathsSchema = {
    kind: "object",
    required: ["entries", "groups"],
    properties: {
        entries: { kind: "array", items: { kind: "object", required: [], properties: {}, additionalKeysAllowed: true } },
        groups: { kind: "array", items: { kind: "object", required: [], properties: {}, additionalKeysAllowed: true } },
    },
};

const ProjectInstructionSchema = {
    kind: "object",
    required: ["SchemaVersion", "Name", "DisplayName", "Version", "Description", "World", "Dependencies", "LoadOrder", "Seed", "Assets"],
    optional: ["IsGlobal", "XPaths"],
    properties: {
        SchemaVersion: { kind: "schemaVersion" },
        Name: { kind: "string" },
        DisplayName: { kind: "string" },
        Version: { kind: "string" },
        Description: { kind: "string" },
        World: { kind: "string", enum: ["MAIN", "ISOLATED"] },
        IsGlobal: { kind: "boolean" },
        Dependencies: { kind: "array", items: { kind: "string" } },
        LoadOrder: { kind: "number" },
        Seed: SeedSchema,
        Assets: AssetsSchema,
        XPaths: XPathsSchema,
    },
};

/* ------------------------------------------------------------------ */
/*  PascalCase -> camelCase mirror (mechanical, mirrors compile step). */
/* ------------------------------------------------------------------ */

function toCamelCase(key) {
    if (!key) return key;
    const first = key[0];
    if (first !== first.toUpperCase() || first === first.toLowerCase()) return key;
    return first.toLowerCase() + key.slice(1);
}

function camelMirror(schema) {
    if (!schema || typeof schema !== "object") return schema;
    if (schema.kind === "array") {
        return { ...schema, items: camelMirror(schema.items) };
    }
    if (schema.kind !== "object") return schema;
    const properties = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
        properties[toCamelCase(k)] = camelMirror(v);
    }
    const out = {
        ...schema,
        properties,
        required: (schema.required ?? []).map(toCamelCase),
        optional: (schema.optional ?? []).map(toCamelCase),
    };
    if (schema.additionalValueSchema) {
        out.additionalValueSchema = camelMirror(schema.additionalValueSchema);
    }
    return out;
}

const ProjectInstructionSchemaCamel = camelMirror(ProjectInstructionSchema);

/* ------------------------------------------------------------------ */
/*  Validator core.                                                     */
/* ------------------------------------------------------------------ */

function typeOf(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

/**
 * Pretty-preview a received value for an error message. Keeps strings
 * short (<=40 chars), shows numbers/bools verbatim, and prints a one-line
 * shape summary for objects/arrays so the operator can eyeball "what
 * did the validator actually see" without scrolling the JSON dump.
 */
function previewValue(value) {
    const t = typeOf(value);
    if (t === "null" || t === "undefined") return t;
    if (t === "string") {
        const max = 40;
        const truncated = value.length > max ? `${value.slice(0, max)}...` : value;
        return JSON.stringify(truncated);
    }
    if (t === "number" || t === "boolean") return String(value);
    if (t === "array") return `array(len=${value.length})`;
    // object
    const keys = Object.keys(value);
    const head = keys.slice(0, 4).join(",");
    const tail = keys.length > 4 ? `,...+${keys.length - 4}` : "";
    return `object{${head}${tail}}`;
}

/**
 * Pull a stable "identity" from an object so a violation deep in
 * `Assets.Scripts[3].ConfigBinding` can be reported as
 * `near Scripts[3] {File:"foo.js"}` instead of forcing the operator to
 * count array indices in the JSON dump. Tries common identity keys in
 * priority order; falls back to the first 2 string-valued keys.
 */
const IDENTITY_KEYS = [
    "Name", "name",
    "Key", "key",
    "File", "file",
    "Id", "id",
    "Code", "code",
    "Url", "url", "TargetUrl", "targetUrl",
];

function identityHint(parents) {
    // Walk parents from nearest object up; return the first object that
    // has a recognisable identity field. Skip arrays - the index is
    // already in `path`.
    for (let i = parents.length - 1; i >= 0; i--) {
        const p = parents[i];
        if (!p || typeof p.value !== "object" || Array.isArray(p.value)) continue;
        for (const k of IDENTITY_KEYS) {
            const v = p.value[k];
            if (typeof v === "string" && v.length > 0) {
                const max = 40;
                const trimmed = v.length > max ? `${v.slice(0, max)}...` : v;
                return ` (near ${p.label} {${k}:${JSON.stringify(trimmed)}})`;
            }
        }
    }
    return "";
}

/** Levenshtein distance, capped - used for "did you mean?" suggestions. */
function editDistance(a, b) {
    if (a === b) return 0;
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    let prev = new Array(bl + 1);
    let curr = new Array(bl + 1);
    for (let j = 0; j <= bl; j++) prev[j] = j;
    for (let i = 1; i <= al; i++) {
        curr[0] = i;
        for (let j = 1; j <= bl; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[bl];
}

function suggestClosest(input, candidates) {
    if (candidates.length === 0) return null;
    const lcInput = input.toLowerCase();
    let best = null;
    let bestDist = Infinity;
    for (const cand of candidates) {
        const d = editDistance(lcInput, cand.toLowerCase());
        if (d < bestDist) { bestDist = d; best = cand; }
    }
    // Suggest only if reasonably close: <= 2 edits OR <= 1/3 of input length.
    const threshold = Math.max(2, Math.floor(input.length / 3));
    return bestDist <= threshold ? best : null;
}

function validate(value, schema, path, violations, parents = []) {
    const hint = () => identityHint(parents);

    if (schema.kind === "string") {
        if (typeof value !== "string") {
            violations.push({
                path,
                message: `expected string, got ${typeOf(value)} (received ${previewValue(value)})${hint()}`,
            });
            return;
        }
        if (schema.enum && !schema.enum.includes(value)) {
            const closest = suggestClosest(value, schema.enum);
            const didYouMean = closest ? ` - did you mean "${closest}"?` : "";
            violations.push({
                path,
                message: `value "${value}" not in enum [${schema.enum.join(", ")}]${didYouMean}${hint()}`,
            });
        }
        return;
    }
    if (schema.kind === "schemaVersion") {
        // Composite check: must be a string, must match the dotted
        // MAJOR.MINOR pattern from schema-version.json, AND must be in
        // the supported list. Each failure mode produces a distinct,
        // actionable message so a "1" typo, a "2.0" pre-bump, and a
        // numeric `1.0` literal each report a different remediation.
        const { pattern, patternSource, supported, current } = SCHEMA_VERSION_CONTRACT;
        if (typeof value !== "string") {
            violations.push({
                path,
                message:
                    `expected SchemaVersion string (one of [${supported.join(", ")}]), ` +
                    `got ${typeOf(value)} (received ${previewValue(value)})${hint()}`,
            });
            return;
        }
        if (!pattern.test(value)) {
            violations.push({
                path,
                message:
                    `SchemaVersion "${value}" does not match required pattern /${patternSource}/ ` +
                    `(expected dotted MAJOR.MINOR like "${current}")${hint()}`,
            });
            return;
        }
        if (!supported.includes(value)) {
            const closest = suggestClosest(value, supported);
            const didYouMean = closest ? ` - did you mean "${closest}"?` : "";
            violations.push({
                path,
                message:
                    `SchemaVersion "${value}" is not supported by this build ` +
                    `(supported: [${supported.join(", ")}], current: "${current}")${didYouMean}` +
                    ` - bump standalone-scripts/types/instruction/primitives/schema-version.{ts,json} ` +
                    `if this is an intentional rollout${hint()}`,
            });
        }
        return;
    }
    if (schema.kind === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            violations.push({
                path,
                message: `expected finite number, got ${typeOf(value)} (received ${previewValue(value)})${hint()}`,
            });
        }
        return;
    }
    if (schema.kind === "boolean") {
        if (typeof value !== "boolean") {
            violations.push({
                path,
                message: `expected boolean, got ${typeOf(value)} (received ${previewValue(value)})${hint()}`,
            });
        }
        return;
    }
    if (schema.kind === "array") {
        if (!Array.isArray(value)) {
            violations.push({
                path,
                message: `expected array, got ${typeOf(value)} (received ${previewValue(value)})${hint()}`,
            });
            return;
        }
        // Push a synthetic parent labelled by the array path so deeply
        // nested errors can still report ancestor identity.
        const arrayLabel = path.split(".").pop() || path;
        const nextParents = parents.concat([{ value, label: arrayLabel }]);
        for (let i = 0; i < value.length; i++) {
            const elemLabel = `${arrayLabel}[${i}]`;
            const elemParents = nextParents.concat([{ value: value[i], label: elemLabel }]);
            validate(value[i], schema.items, `${path}[${i}]`, violations, elemParents);
        }
        return;
    }
    if (schema.kind === "object") {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            violations.push({
                path,
                message: `expected object, got ${typeOf(value)} (received ${previewValue(value)})${hint()}`,
            });
            return;
        }
        const knownKeys = new Set([
            ...(schema.required ?? []),
            ...(schema.optional ?? []),
            ...Object.keys(schema.properties ?? {}),
        ]);
        for (const required of schema.required ?? []) {
            if (!(required in value)) {
                const presentKeys = Object.keys(value);
                const presentSummary = presentKeys.length === 0
                    ? "(empty object)"
                    : `present keys: [${presentKeys.slice(0, 8).join(", ")}${presentKeys.length > 8 ? `, ...+${presentKeys.length - 8}` : ""}]`;
                violations.push({
                    path,
                    message: `missing required key "${required}" - ${presentSummary}${hint()}`,
                });
            }
        }
        const objLabel = path.split(".").pop() || path;
        const childParents = parents.concat([{ value, label: objLabel }]);
        for (const [k, v] of Object.entries(value)) {
            if (knownKeys.has(k)) {
                const subSchema = schema.properties?.[k];
                if (subSchema) validate(v, subSchema, `${path}.${k}`, violations, childParents);
                continue;
            }
            if (schema.additionalKeysAllowed) {
                if (schema.additionalValueSchema) {
                    validate(v, schema.additionalValueSchema, `${path}.${k}`, violations, childParents);
                }
                continue;
            }
            const closest = suggestClosest(k, [...knownKeys]);
            const didYouMean = closest ? ` - did you mean "${closest}"?` : "";
            const allowed = knownKeys.size > 0
                ? ` (allowed: [${[...knownKeys].slice(0, 8).join(", ")}${knownKeys.size > 8 ? `, ...+${knownKeys.size - 8}` : ""}])`
                : "";
            violations.push({
                path,
                message: `unknown key "${k}" (closed schema)${didYouMean}${allowed}${hint()}`,
            });
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Cross-field invariants.                                             */
/* ------------------------------------------------------------------ */

function validateBindings(instruction, isCanonical, violations) {
    // Pick keys based on shape so this works for both artifacts.
    const seedKey = isCanonical ? "Seed" : "seed";
    const assetsKey = isCanonical ? "Assets" : "assets";
    const configSeedIdsKey = isCanonical ? "ConfigSeedIds" : "configSeedIds";
    const scriptsKey = isCanonical ? "Scripts" : "scripts";
    const configsKey = isCanonical ? "Configs" : "configs";
    const configBindingKey = isCanonical ? "ConfigBinding" : "configBinding";
    const themeBindingKey = isCanonical ? "ThemeBinding" : "themeBinding";
    const fileKey = isCanonical ? "File" : "file";
    const keyKey = isCanonical ? "Key" : "key";

    const seed = instruction?.[seedKey];
    const assets = instruction?.[assetsKey];
    if (!seed || !assets) return; // structural errors already reported

    const configIds = seed[configSeedIdsKey] ?? {};
    const definedBindingNames = new Set(Object.keys(configIds));
    const scripts = Array.isArray(assets[scriptsKey]) ? assets[scriptsKey] : [];
    const configs = Array.isArray(assets[configsKey]) ? assets[configsKey] : [];

    for (let i = 0; i < scripts.length; i++) {
        const s = scripts[i] ?? {};
        for (const bindingProp of [configBindingKey, themeBindingKey]) {
            const ref = s[bindingProp];
            if (typeof ref === "string" && !definedBindingNames.has(ref)) {
                violations.push({
                    path: `$.${assetsKey}.${scriptsKey}[${i}].${bindingProp}`,
                    message: `binding "${ref}" not declared in ${seedKey}.${configSeedIdsKey} (known: [${[...definedBindingNames].join(", ")}])`,
                });
            }
        }
    }

    // Every ConfigSeedIds key must map to a Configs[].Key entry, AND
    // every Configs[].Key must appear in ConfigSeedIds.
    const configKeys = new Set();
    for (const c of configs) {
        if (c && typeof c[keyKey] === "string") configKeys.add(c[keyKey]);
    }
    for (const name of definedBindingNames) {
        if (!configKeys.has(name)) {
            violations.push({
                path: `$.${seedKey}.${configSeedIdsKey}.${name}`,
                message: `binding "${name}" has no matching ${assetsKey}.${configsKey}[].${keyKey} entry`,
            });
        }
    }
    for (const c of configs) {
        const k = c?.[keyKey];
        if (typeof k === "string" && definedBindingNames.size > 0 && !definedBindingNames.has(k)) {
            violations.push({
                path: `$.${assetsKey}.${configsKey}`,
                message: `${configsKey}[].${keyKey}="${k}" is not referenced in ${seedKey}.${configSeedIdsKey}`,
            });
        }
    }
}

/* ------------------------------------------------------------------ */
/*  GitHub Actions annotation helpers.                                  */
/* ------------------------------------------------------------------ */

function ghEscape(s) {
    return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function annotate(file, msg) {
    if (!IS_GITHUB_ACTIONS) return;
    process.stdout.write(`::error file=${file}::${ghEscape(msg)}\n`);
}

/* ------------------------------------------------------------------ */
/*  Per-artifact runner.                                                */
/* ------------------------------------------------------------------ */

function validateArtifact(filePath, schema, isCanonical) {
    const result = { path: filePath, ok: true, violations: [], parseError: null };
    if (!existsSync(filePath)) {
        result.ok = false;
        result.parseError = "missing artifact";
        return result;
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (err) {
        result.ok = false;
        result.parseError = `JSON parse error: ${err.message}`;
        return result;
    }
    validate(parsed, schema, "$", result.violations);
    validateBindings(parsed, isCanonical, result.violations);
    if (result.violations.length > 0) result.ok = false;
    return result;
}

/* ------------------------------------------------------------------ */
/*  Project discovery.                                                  */
/* ------------------------------------------------------------------ */

function listProjects() {
    if (!existsSync(STANDALONE_DIR)) return null;
    return readdirSync(STANDALONE_DIR)
        .map((name) => ({ name, full: join(STANDALONE_DIR, name) }))
        .filter((p) => {
            try { return statSync(p.full).isDirectory(); } catch { return false; }
        })
        .filter((p) => existsSync(join(p.full, "src", "instruction.ts")));
}

/* ------------------------------------------------------------------ */
/*  Main.                                                               */
/* ------------------------------------------------------------------ */

function printArtifactReport(label, result) {
    if (result.ok) {
        console.log(`  [OK] ${label}: ${rel(result.path)} - schema OK`);
        return;
    }
    console.log(`  [FAIL] ${label}: ${rel(result.path)}`);
    if (result.parseError) {
        console.log(`     - ${result.parseError}`);
        annotate(rel(result.path), result.parseError);
        return;
    }
    let printed = 0;
    for (const v of result.violations) {
        console.log(`     - ${v.path}: ${v.message}`);
        if (printed < MAX_ANNOTATIONS) {
            annotate(rel(result.path), `${v.path}: ${v.message}`);
            printed++;
        }
    }
    if (result.violations.length > MAX_ANNOTATIONS) {
        const more = result.violations.length - MAX_ANNOTATIONS;
        console.log(`     - (+${more} more violations not annotated)`);
    }
}

function main() {
    const folderArg = process.argv[2];

    let projects;
    if (folderArg) {
        const full = resolve(REPO_ROOT, folderArg);
        if (!existsSync(full)) {
            console.error(`[FAIL] Project folder not found: ${folderArg}`);
            process.exit(2);
        }
        // Per-project mode: the folder must be a real standalone project,
        // i.e. it must contain `src/instruction.ts`. Without this check
        // the script silently "validates" arbitrary directories and exits
        // 0 with `Scanned: 1 project(s), 0 artifact(s)` - a false green.
        const instructionSource = join(full, "src", "instruction.ts");
        if (!existsSync(instructionSource)) {
            console.error(
                `[FAIL] Not a standalone project (missing ${rel(instructionSource)})`,
            );
            process.exit(2);
        }
        projects = [{ name: folderArg.split("/").pop(), full }];
    } else {
        projects = listProjects();
        if (projects === null) {
            console.error(`[FAIL] Repo layout broken: ${rel(STANDALONE_DIR)} not found`);
            process.exit(2);
        }
        // Repo-wide mode: an empty discovery is suspicious - treat as a
        // layout failure (exit 2), not a clean pass. Without this guard
        // a misconfigured CI checkout (e.g. sparse-checkout dropping
        // standalone-scripts/*/src/) would produce a false green.
        if (projects.length === 0) {
            console.error(
                `[FAIL] No standalone projects discovered under ${rel(STANDALONE_DIR)} ` +
                `(no src/instruction.ts files found)`,
            );
            process.exit(2);
        }
    }

    console.log("Instruction Schema Validator");
    console.log("============================");

    let totalFailures = 0;
    let totalArtifacts = 0;
    // Per-project exit-code contract: in per-project (single-folder) mode,
    // a missing dist/ is itself a layout error (exit 2 per the header
    // docstring). In repo-wide mode we keep going and fold it into the
    // exit-1 summary so one un-built sibling doesn't mask other failures.
    const isPerProject = Boolean(folderArg);

    for (const project of projects) {
        const distDir = join(project.full, "dist");
        const canonicalPath = join(distDir, "instruction.json");
        const compatPath = join(distDir, "instruction.compat.json");

        console.log(`\n- ${project.name}`);
        if (!existsSync(distDir)) {
            const msg = `  [FAIL] Missing dist/ - run compile-instruction.mjs first`;
            console.error(msg);
            annotate(rel(distDir), "Missing dist/ - run compile-instruction.mjs first");
            if (isPerProject) {
                process.exit(2);
            }
            totalFailures++;
            continue;
        }

        const canonical = validateArtifact(canonicalPath, ProjectInstructionSchema, true);
        const compat = validateArtifact(compatPath, ProjectInstructionSchemaCamel, false);
        totalArtifacts += 2;
        if (!canonical.ok) totalFailures++;
        if (!compat.ok) totalFailures++;

        printArtifactReport("canonical", canonical);
        printArtifactReport("compat   ", compat);
    }

    console.log("\n----------------------------");
    console.log(`Scanned: ${projects.length} project(s), ${totalArtifacts} artifact(s)`);
    if (totalFailures === 0) {
        console.log("[OK] All instruction artifacts pass schema validation");
        process.exit(0);
    }
    const failMsg = `[FAIL] ${totalFailures} artifact(s) failed schema validation`;
    console.log(failMsg);
    if (IS_GITHUB_ACTIONS) {
        process.stdout.write(
            `::error title=Instruction schema validation failed::` +
            `${ghEscape(failMsg)} (scanned ${projects.length} project(s), ` +
            `${totalArtifacts} artifact(s))\n`,
        );
    }
    process.exit(1);
}

try {
    main();
} catch (err) {
    // Defence-in-depth: any uncaught throw inside main() (schema bug,
    // fs race, malformed JSON the parser missed) MUST surface as a hard
    // failure with a stable exit code (3) rather than a silent green
    // exit. Without this guard, a thrown TypeError from a future schema
    // refactor would crash with exit 0 in some Node versions on CI
    // runners that swallow the rejection.
    const msg = err && err.stack ? err.stack : String(err);
    console.error(`[FAIL] Validator crashed: ${msg}`);
    if (IS_GITHUB_ACTIONS) {
        process.stdout.write(
            `::error title=Instruction schema validator crashed::${ghEscape(msg)}\n`,
        );
    }
    process.exit(3);
}