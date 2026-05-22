/* eslint-disable sonarjs/no-duplicate-string -- prompt seed data repeats timestamps and fields */
/**
 * Marco Extension — Prompt CRUD Handler (Spec 15 T-10)
 *
 * Manages custom prompts in SQLite (logs.db).
 * Automatically migrates existing prompts from chrome.storage.local on first load.
 * Seeds default prompts into the Prompts table so they are always visible.
 *
 * Categories are stored in PromptsCategory with a many-to-many junction
 * table PromptsToCategory. All relational reads use the PromptsDetails view.
 *
 * All column names use PascalCase per database naming convention.
 *
 * @see spec/05-chrome-extension/45-prompt-manager-crud.md — Prompt manager CRUD
 * @see spec/05-chrome-extension/52-prompt-caching-indexeddb.md — Prompt caching
 */

import type { Database as SqlJsDatabase } from "sql.js";
import type { DbManager } from "../db-manager";
import { logCaughtError, logSampledDebug, BgLogTag} from "../bg-logger";
import { bindOpt, missingFieldError, requireField, type HandlerErrorResponse } from "./handler-guards";

const LEGACY_STORAGE_KEY = "marco_custom_prompts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PromptEntry {
    id: string;
    slug?: string;
    name: string;
    text: string;
    version?: string;
    order: number;
    isDefault?: boolean;
    isFavorite?: boolean;
    category?: string;
    categories?: string;
    createdAt: string;
    updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  DbManager binding                                                  */
/* ------------------------------------------------------------------ */

let dbManager: DbManager | null = null;

export function bindPromptDbManager(manager: DbManager): void {
    dbManager = manager;
}

function getDb(): SqlJsDatabase {
    if (!dbManager) {
        throw new Error("[prompts] DbManager not bound. Call bindPromptDbManager() first.");
    }
    return dbManager.getLogsDb();
}

function markDirty(): void {
    dbManager?.markDirty();
}

/* ------------------------------------------------------------------ */
/*  SQLite helpers                                                     */
/* ------------------------------------------------------------------ */

function ensurePromptsTable(): void {
    const db = getDb();
    db.run(`
        CREATE TABLE IF NOT EXISTS Prompts (
            Id         INTEGER PRIMARY KEY AUTOINCREMENT,
            Slug       TEXT UNIQUE,
            Name       TEXT NOT NULL,
            Text       TEXT NOT NULL,
            Version    TEXT DEFAULT '1.0.0',
            SortOrder  INTEGER DEFAULT 0,
            IsDefault  INTEGER DEFAULT 0,
            IsFavorite INTEGER DEFAULT 0,
            CreatedAt  TEXT NOT NULL,
            UpdatedAt  TEXT NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS PromptsCategory (
            Id        INTEGER PRIMARY KEY AUTOINCREMENT,
            Name      TEXT NOT NULL UNIQUE,
            SortOrder INTEGER DEFAULT 0,
            CreatedAt TEXT NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS PromptsToCategory (
            Id         INTEGER PRIMARY KEY AUTOINCREMENT,
            PromptId   INTEGER NOT NULL,
            CategoryId INTEGER NOT NULL,
            FOREIGN KEY (PromptId) REFERENCES Prompts(Id) ON DELETE CASCADE,
            FOREIGN KEY (CategoryId) REFERENCES PromptsCategory(Id) ON DELETE CASCADE,
            UNIQUE (PromptId, CategoryId)
        )
    `);
    // Migration: add Version column if missing
    try { db.run("ALTER TABLE Prompts ADD COLUMN Version TEXT DEFAULT '1.0.0'"); } catch (e) { console.debug("[prompts] ALTER ADD Version skipped (already exists):", e); }
    // Migration: add Slug column if missing (UNIQUE cannot be in ALTER TABLE ADD COLUMN in SQLite)
    try { db.run("ALTER TABLE Prompts ADD COLUMN Slug TEXT"); } catch (e) { console.debug("[prompts] ALTER ADD Slug skipped (already exists):", e); }
    // Ensure unique index on Slug (safe to call repeatedly)
    try { db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_slug ON Prompts(Slug)"); } catch (e) { console.debug("[prompts] CREATE INDEX idx_prompts_slug skipped:", e); }
}

/** Ensures a category exists and returns its ID (INTEGER AUTOINCREMENT). */
function ensureCategoryId(categoryName: string): string {
    const db = getDb();
    const trimmed = categoryName.trim();
    if (!trimmed) return "";

    const existing = db.exec("SELECT Id FROM PromptsCategory WHERE Name = ?", [trimmed]);
    if (existing.length > 0 && existing[0].values.length > 0) {
        return String(existing[0].values[0][0]);
    }

    const now = new Date().toISOString();
    db.run(
        "INSERT INTO PromptsCategory (Name, SortOrder, CreatedAt) VALUES (?, 0, ?)",
        [trimmed, now],
    );
    const result = db.exec("SELECT last_insert_rowid()");
    return String(result[0].values[0][0]);
}

/** Links a prompt to a category via the junction table. */
function linkPromptToCategory(promptId: string, categoryId: string): void {
    if (!categoryId) return;
    const db = getDb();
    try {
        db.run(
            "INSERT OR IGNORE INTO PromptsToCategory (PromptId, CategoryId) VALUES (?, ?)",
            [Number(promptId), Number(categoryId)],
        );
    } catch (linkErr) {
        // Already linked — INSERT OR IGNORE should prevent this, but log debug
        // so unexpected SQL failures (FK violation, schema drift) are recoverable.
        console.debug(`[prompts] linkPromptToCategory(${promptId} → ${categoryId}) skipped:`, linkErr);
    }
}

function rowToPrompt(row: Record<string, unknown>): PromptEntry {
    return {
        id: String(row.Id ?? row.PromptId ?? row.id ?? row.promptId ?? ""),
        name: String(row.Name ?? row.Title ?? row.name ?? row.title ?? ""),
        text: String(row.Text ?? row.Content ?? row.text ?? row.content ?? ""),
        version: String(row.Version ?? row.version ?? "1.0.0"),
        order: Number(row.SortOrder ?? row.sortOrder ?? row.sort_order ?? 0),
        isDefault: (row.IsDefault ?? row.isDefault ?? row.is_default) === 1,
        isFavorite: (row.IsFavorite ?? row.isFavorite ?? row.is_favorite) === 1,
        category: row.Categories ? String(row.Categories) : (row.categories ? String(row.categories) : undefined),
        categories: row.Categories ? String(row.Categories) : (row.categories ? String(row.categories) : undefined),
        slug: row.Slug ? String(row.Slug) : (row.slug ? String(row.slug) : undefined),
        createdAt: String(row.CreatedAt ?? row.createdAt ?? row.created_at ?? ""),
        updatedAt: String(row.UpdatedAt ?? row.updatedAt ?? row.updated_at ?? ""),
    };
}

/** Reads all prompts using the PromptsDetails view for joined data. */
function queryAllPromptsViaView(): PromptEntry[] {
    const db = getDb();
    try {
        const stmt = db.prepare("SELECT * FROM PromptsDetails ORDER BY SortOrder ASC");
        const results: PromptEntry[] = [];
        while (stmt.step()) {
            results.push(rowToPrompt(stmt.getAsObject()));
        }
        stmt.free();
        return results;
    } catch (viewErr) {
        // View may not exist yet — fall back to direct query
        logSampledDebug(
            BgLogTag.PROMPTS,
            "queryAllPromptsViaView",
            "PromptsDetails view missing — falling back to direct Prompts table query",
            viewErr instanceof Error ? viewErr : String(viewErr),
        );
        return queryAllPromptsDirect();
    }
}

function queryAllPromptsDirect(): PromptEntry[] {
    const db = getDb();
    const stmt = db.prepare("SELECT * FROM Prompts ORDER BY SortOrder ASC");
    const results: PromptEntry[] = [];
    while (stmt.step()) {
        results.push(rowToPrompt(stmt.getAsObject()));
    }
    stmt.free();
    return results;
}

function queryAllCustomPrompts(): PromptEntry[] {
    const db = getDb();
    const stmt = db.prepare("SELECT * FROM Prompts WHERE IsDefault = 0 ORDER BY SortOrder ASC");
    const results: PromptEntry[] = [];
    while (stmt.step()) {
        results.push(rowToPrompt(stmt.getAsObject()));
    }
    stmt.free();
    return results;
}

/* ------------------------------------------------------------------ */
/*  Migration: chrome.storage.local → SQLite                           */
/* ------------------------------------------------------------------ */

let migrationDone = false;

async function migrateFromStorageIfNeeded(): Promise<void> {
    if (migrationDone) return;
    migrationDone = true;

    try {
        ensurePromptsTable();
        await seedDefaultPromptsIfEmpty();

        const db = getDb();
        const countResult = db.exec("SELECT COUNT(*) as cnt FROM Prompts WHERE IsDefault = 0");
        const existingCount = countResult.length > 0 ? Number(countResult[0].values[0][0]) : 0;
        if (existingCount > 0) return;

        const localResult = await chrome.storage.local.get(LEGACY_STORAGE_KEY);
        const legacyPrompts = localResult[LEGACY_STORAGE_KEY];
        if (!Array.isArray(legacyPrompts) || legacyPrompts.length === 0) return;

        try {
            const syncResult = await chrome.storage.sync.get(LEGACY_STORAGE_KEY);
            const syncData = syncResult[LEGACY_STORAGE_KEY];
            if (Array.isArray(syncData) && syncData.length > 0 && legacyPrompts.length === 0) {
                for (const prompt of syncData) {
                    insertPromptRow(prompt as PromptEntry);
                }
                await chrome.storage.sync.remove(LEGACY_STORAGE_KEY);
                console.log(`[prompts] Migrated ${syncData.length} prompts from sync → SQLite`);
                markDirty();
                return;
            }
        } catch (syncErr) {
            // chrome.storage.sync may be unavailable (rare in MV3, but possible
            // when sync is disabled at the browser level). Migration falls through.
            console.debug("[prompts] chrome.storage.sync legacy migration unavailable:", syncErr);
        }

        for (const prompt of legacyPrompts) {
            insertPromptRow(prompt as PromptEntry);
        }

        console.log(`[prompts] Migrated ${legacyPrompts.length} prompts from storage.local → SQLite`);
        markDirty();
        await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
    } catch (err) {
        logCaughtError(BgLogTag.PROMPTS, "Migration error", err);
    }
}

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
function insertPromptRow(prompt: PromptEntry): void {
    const db = getDb();
    const now = new Date().toISOString();
    const slug = prompt.id || undefined; // Legacy text IDs become slugs

    // Check if a prompt with this slug already exists (for seeding dedup)
    if (slug) {
        const existing = db.exec("SELECT Id FROM Prompts WHERE Slug = ?", [slug]);
        if (existing.length > 0 && existing[0].values.length > 0) {
            // Already seeded — update instead
            const existingId = existing[0].values[0][0];
            db.run(
                `UPDATE Prompts SET Name = ?, Text = ?, Version = ?, SortOrder = ?, IsDefault = ?, IsFavorite = ?, UpdatedAt = ? WHERE Id = ?`,
                [bindOpt(prompt.name) ?? "Untitled", bindOpt(prompt.text) ?? "", bindOpt(prompt.version) ?? "1.0.0", prompt.order ?? 0, prompt.isDefault ? 1 : 0, prompt.isFavorite ? 1 : 0, bindOpt(prompt.updatedAt) ?? now, existingId],
            );
            const promptId = String(existingId);
            const category = prompt.category || "";
            if (category) {
                const categoryId = ensureCategoryId(category);
                linkPromptToCategory(promptId, categoryId);
            }
            return;
        }
    }

    db.run(
        `INSERT INTO Prompts (Slug, Name, Text, Version, SortOrder, IsDefault, IsFavorite, CreatedAt, UpdatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            bindOpt(slug),
            bindOpt(prompt.name) ?? "Untitled",
            bindOpt(prompt.text) ?? "",
            bindOpt(prompt.version) ?? "1.0.0",
            prompt.order ?? 0,
            prompt.isDefault ? 1 : 0,
            prompt.isFavorite ? 1 : 0,
            bindOpt(prompt.createdAt) ?? now,
            bindOpt(prompt.updatedAt) ?? now,
        ],
    );

    const result = db.exec("SELECT last_insert_rowid()");
    const promptId = String(result[0].values[0][0]);

    // Handle category via junction table
    const category = prompt.category || "";
    if (category) {
        const categoryId = ensureCategoryId(category);
        linkPromptToCategory(promptId, categoryId);
    }
}

/* ------------------------------------------------------------------ */
/*  Default prompts seeding                                            */
/* ------------------------------------------------------------------ */

const PROMPTS_SEED_VERSION_KEY = "marco_prompts_seed_version";

/**
 * Seeds default prompts into the Prompts table if:
 * 1. The table is empty (first run), OR
 * 2. The bundled prompts version has changed since last seed.
 *
 * Version is derived from the count + hash of bundled prompt names.
 * This ensures re-seeding happens on extension updates that add/change prompts,
 * but NOT on every startup.
 */
async function seedDefaultPromptsIfEmpty(): Promise<void> {
    const db = getDb();
    const countResult = db.exec("SELECT COUNT(*) FROM Prompts");
    const count = countResult.length > 0 ? Number(countResult[0].values[0][0]) : 0;

    const defaults = (await loadBundledDefaultPrompts()) ?? getFallbackDefaultPrompts();
    const bundledVersion = computeBundledVersion(defaults);

    if (count === 0) {
        // First run — seed everything
        console.log("[prompts] Prompts table empty — seeding defaults...");
        for (const prompt of defaults) {
            insertPromptRow(prompt);
        }
        markDirty();
        await chrome.storage.local.set({ [PROMPTS_SEED_VERSION_KEY]: bundledVersion });
        console.log(`[prompts] Seeded ${defaults.length} default prompts (version: ${bundledVersion})`);
        return;
    }

    // Check if bundled version changed
    const stored = await chrome.storage.local.get(PROMPTS_SEED_VERSION_KEY);
    const storedVersion = stored[PROMPTS_SEED_VERSION_KEY] as string | undefined;

    if (storedVersion === bundledVersion) {
        return; // No change — skip re-seeding
    }

    console.log(`[prompts] Bundled prompts version changed (${storedVersion ?? "none"} → ${bundledVersion}) — re-seeding defaults...`);

    // Re-seed: upsert defaults (insertPromptRow handles slug-based dedup)
    for (const prompt of defaults) {
        insertPromptRow(prompt);
    }
    markDirty();
    await chrome.storage.local.set({ [PROMPTS_SEED_VERSION_KEY]: bundledVersion });
    console.log(`[prompts] Re-seeded ${defaults.length} default prompts (version: ${bundledVersion})`);
}

/** Compute a version string from bundled prompts for change detection.
 *  Includes text length in the signature so text-only changes trigger re-seeding. */
function computeBundledVersion(prompts: PromptEntry[]): string {
    const signature = prompts
        .map((p) => `${p.id ?? ""}:${p.name}:${p.version ?? "1.0.0"}:${(p.text ?? "").length}`)
        .join("|");
    // Simple hash
    let hash = 0;
    for (let i = 0; i < signature.length; i++) {
        hash = ((hash << 5) - hash + signature.charCodeAt(i)) | 0;
    }
    return `${prompts.length}-${(hash >>> 0).toString(36)}`;
}

function getFallbackDefaultPrompts(): PromptEntry[] {
    return [
        { id: "default-rejog", name: "Rejog the Memory v1", text: "# Rejog the Memory v1\n\n> **Purpose:** Read and synthesize existing repository context from the Lovable memory folder and the full specification set, then produce a reliability risk report before any implementation work begins. Do not implement anything. Only produce a report and specification-side artifacts for memory, suggestions, and planning.\n\n---\n\n## Goals\n\n1. Reconstruct project requirements by reading:\n   1. the `.lovable` memory content\n   2. the existing spec files and idea files across all projects\n2. Produce a detailed risk and failure-chance report for handing the current specs to another AI.\n3. Establish a disciplined workflow for Lovable suggestions tracking and future planning so another AI can continue work reliably.\n\n---\n\n## Inputs to read\n\n1. `.lovable/`\n   1. `memories/`\n   2. `memory/`\n   3. `memory/suggestions/`\n   4. any other Lovable state folders present\n   5. What to do and what NOT to do \u2014 remember.\n   6. Do NOT touch any `skipped/` folder.\n2. Spec folder content for all projects:\n   1. ideas\n   2. backend and frontend specs\n   3. specs\n   4. instruction builder specs\n   5. seeding and configuration specs\n   6. data model specs\n   7. acceptance criteria specs\n   8. Read root `spec/` folder or get a general idea of files.\n\n---\n\n## Deliverable 1 \u2014 Reliability and Failure-Chance Report\n\n1. **Success probability estimates**\n   - by module complexity tier (simple, medium, complex agentic workflows, end-to-end)\n   - explicit assumptions behind each estimate\n2. **Failure map**\n   - where failures are likely (module and workflow)\n   - why failures occur (missing constraints, ambiguity, cross-file inconsistency)\n   - how failures would manifest (symptoms)\n3. **Corrective actions**\n   - prioritized list of spec fixes to reduce failure chance\n   - for each fix: what to change, where to change it, expected reliability gain\n4. **Readiness decision**\n   - whether the spec set is ready for implementation\n   - what must be fixed before starting implementation\n\n---\n\n## Deliverable 2 \u2014 Lovable Suggestions Workflow (filesystem contract)\n\n1. **Location** \u2014 Write each suggestion into `.lovable/memory/suggestions` as an individual file.\n2. **File naming** \u2014 `YYYYMMDD-HHMMSS-suggestion-<slug>.md`\n3. **Suggestion file content**\n   - suggestionId\n   - createdAt\n   - source (Lovable)\n   - affectedProject\n   - description\n   - rationale\n   - proposed change\n   - acceptance criteria\n   - status (open, inProgress, done)\n   - completion notes\n4. **Completion handling** \u2014 When a suggestion is completed, update status to `done`. Optionally archive completed items, or remove them if policy is to keep the folder for active items only.\n\n---\n\n## Deliverable 3 \u2014 `plan.md` Future Work Roadmap\n\nCreate a `plan.md` at the repository root that captures future work for hand-off to another AI model.\n\nRequirements:\n1. A prioritized backlog of tasks\n2. Grouping by phase and by project\n3. For each task:\n   1. objective\n   2. dependencies\n   3. expected outputs (spec file updates, UI changes, API changes)\n   4. acceptance criteria\n4. A section titled **Next task selection** where the next implementable items are listed so the user can pick what to implement next.\n\n---\n\n## Interaction rule\n\nAfter producing the report and creating the memory and plan artifacts, ask the user which specific task to implement next, since the specs should define what to build.\n\n---\n\n*Prompt v2.0. Trigger phrase: \"rejog the memory\".*\n", order: 0, isDefault: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "default-unified", name: "Unified AI Prompt v4", text: "# Unified AI Prompt \u2014 v4\n\n## Part 1 \u2014 Repository Analysis, Memory Reconstruction, and Implementation Readiness\n\n### Proofread prompt\n\nRead and synthesize existing repository context from the Lovable memory folder and the full specification set, then produce a reliability risk report before any implementation work begins. Do not implement anything. Only produce a report and specification-side artifacts for memory, suggestions, and planning.\n\n### Mandatory pre-analysis steps\n\nBefore producing any report or analysis, the AI must:\n\n1. **Scan the entire repository tree at the directory level** to understand project boundaries, folder structure, and dependencies. Do not read contents inside folders marked skipped, ignored, deprecated, generated, archived, or otherwise excluded.\n2. **Read workflow memory** \u2014 specifically `.lovable/memory/workflow/01-plan.md` \u2014 to understand what has been done and what is pending. This avoids repeated work.\n3. **Read all relevant memory files** under `.lovable/memory/`, including workflow, suggestions, rules, decisions, history, issue references, and any protocol or process files present.\n\n### Goals\n\n1. Reconstruct project requirements by reading:\n   1. the .lovable memory content\n   2. the existing spec files and idea files across all projects\n2. Produce a detailed risk and failure-chance report for handing the current specs to another AI.\n3. Establish a disciplined workflow for Lovable suggestions tracking and future planning so another AI can continue work reliably.\n\n### Inputs to read\n\n1. .lovable/\n   1. memories/\n   2. memory/\n   3. memory/suggestions/\n   4. any other Lovable state folders present\n   5. What todo and what not to do \u2014 remember.\n   6. Folders marked skipped, ignored, deprecated, generated, or archived must not be read or modified \u2014 they may be listed structurally but their contents must not be opened.\n2. Spec folder content for all projects:\n   1. ideas\n   2. backend and frontend specs\n   3. specs\n   4. instruction builder specs\n   5. seeding and configuration specs\n   6. data model specs\n   7. acceptance criteria specs\n   8. Read root `spec/` folder or get a general idea of files.\n\n### Deliverable 1: Reliability and failure-chance report\n\n1. **Success probability estimates** by module complexity tier (simple, medium, complex agentic workflows, end-to-end), with explicit assumptions.\n2. **Failure map** \u2014 where (module + workflow), why (missing constraints, ambiguity, cross-file inconsistency), how it manifests.\n3. **Corrective actions** \u2014 prioritized list of spec fixes; for each: what to change, where, expected reliability gain.\n4. **Readiness decision** \u2014 classify each major area as: ready / ready with assumptions / blocked by ambiguity / blocked by contradiction / blocked by missing acceptance criteria. State what must be fixed before implementation and what can be deferred safely.\n\n### Deliverable 2: Lovable suggestions workflow (filesystem contract)\n\nAll suggestions must be tracked in a single file: `.lovable/memory/suggestions/01-suggestions.md`. If the file grows beyond manageable size (50+ items), suggestions may be split per project.\n\n**Suggestion entry fields:** suggestionId, createdAt, source (Lovable), affectedProject, description, rationale, proposed change, acceptance criteria, status (open, inProgress, done), completion notes.\n\n**Completion handling** \u2014 When a suggestion is completed, update its status to done. Optionally move completed items to `completed/` subfolder.\n\n### Deliverable 3: plan.md future work roadmap\n\n`.lovable/memory/workflow/01-plan.md` is the **canonical workflow tracker**. Root `plan.md` (if created) is a **summarized AI handoff roadmap** only. It must not contradict the canonical plan.\n\n**plan.md requirements:**\n1. A prioritized backlog of tasks\n2. Grouping by phase and by project\n3. For each task: objective, dependencies, expected outputs (spec updates, UI changes, API changes), acceptance criteria\n4. A section titled **Next task selection** where the next implementable items are listed so the user can pick what to implement next.\n\n### Required Part 1 artifacts\n\n- `.lovable/memory/workflow/01-plan.md`\n- `.lovable/memory/suggestions/01-suggestions.md`\n- `.lovable/memory/history/01-decisions.md` \u2014 create the `history/` folder if it does not exist\n- `.lovable/memory/01-working-rules.md` \u2014 if new rules or constraints are discovered\n- Root `plan.md` \u2014 only if a handoff roadmap is needed\n- Update memory issue references if analysis uncovers prior unresolved issue patterns\n\n### Interaction rule\n\nAfter producing the report and creating the memory and plan artifacts, ask which specific task should be implemented next since the specs define what to build.\n\n---\n\n## Part 2 \u2014 Specification Fix Workflow and Issue Documentation\n\n### Original input (verbatim)\n\nupdate spec properly so that the mistake doesn't appear and update memory and also write the details how you fixed it, and every time we fix it, add to do /spec/02-app/issues/01-{issue slug name}.md explain the issue first, then root cause analysis, how you fixed and how not to repeat it again, and if iterations required, then write all the iterations And put all the spec files in 01-app Keep it in your memory to update all the time so that mistakes don't happen this is the most important part the many times i have remind the mistakes make sure to update in the\n\n### Objectives\n\n1. Update the relevant spec files so the mistake cannot happen again.\n2. Update memory documentation to record the mistake, the fix, and the prevention rule.\n3. Every time a fix is made, create a dedicated issue documentation file under the required path.\n4. Consolidate all application spec files under a single folder.\n\n### Required folder structure\n\n- All application spec files: `/spec/01-app/`\n- All issue write-ups: `/spec/02-app/issues/`\n- File naming format: `{seq}-{issueSlugName}.md` (sequential numbering: 01, 02, 03\u2026)\n\n### issueSlugName rules\n\n- lowercase only\n- hyphen-separated\n- short, descriptive, and stable\n- no spaces or special characters\n\n### Issue numbering\n\nIssues use **sequential numbering** across the entire issues folder. Before creating a new issue, check the highest existing sequence number and increment by one.\n\n```\n/spec/02-app/issues/01-auth-timeout.md\n/spec/02-app/issues/02-cache-race-condition.md\n/spec/02-app/issues/03-missing-default-config.md\n```\n\n### Issue write-up file requirements\n\nCreate an issue file at `/spec/02-app/issues/{seq}-{issueSlugName}.md`. Sections in this exact order:\n\n**Issue summary** \u2014 what happened, where (feature/module + paths), symptoms and impact, how discovered.\n\n**Root cause analysis** \u2014 direct cause, contributing factors, triggering conditions, why existing spec did not prevent it.\n\n**Fix description** \u2014 spec changes (no code), new rules/constraints, why fix resolves root cause, config/default changes, logging or diagnostics required.\n\n**Iterations history** (only if multiple attempts) \u2014 Iteration 1: what was tried and why it failed. Iteration 2: ... continue until final resolution.\n\n**Prevention and non-regression** \u2014 prevention rule, acceptance criteria/test scenarios, guardrails or linting policies, references to exact spec sections updated (by file path), explicit testable regression prevention rule.\n\n**TODO and follow-ups** \u2014 remaining tasks, owners or roles if applicable.\n\n**Done checklist**\n- [ ] Spec updated under /spec/01-app/\n- [ ] Issue write-up created under /spec/02-app/issues/\n- [ ] Memory updated with summary and prevention rule\n- [ ] Acceptance criteria updated or added\n- [ ] Iterations recorded if applicable\n- [ ] Plan status updated in workflow tracker\n\n### Spec update requirements\n\nUpdate the relevant spec files under /spec/01-app/ to include: corrected behavior, explicit constraints to prevent the old mistake, failure modes and debugging guidance, acceptance criteria updates that make regression testable, and a **Known pitfalls and prevention** section that references the issue file path.\n\n### Memory update requirements\n\nMaintain a memory record updated every time a fix is made: short description of the mistake, prevention rule, reference to the issue write-up file path.\n\n**Memory update is mandatory. If memory is not updated the fix is incomplete.**\n\n### Decision logging\n\nAll important decisions must be written to `.lovable/memory/history/01-decisions.md`. If the `history/` folder does not exist, create it and use this file as the canonical decision log.\n\nRequired entries: architecture changes, spec interpretation decisions, rejected approaches and why, trade-off resolutions.\n\n### Output requirements\n\n1. A concise process checklist to follow after every fix.\n2. A copy-paste template for `/spec/02-app/issues/{seq}-{issueSlugName}.md`.\n3. A brief note stating all specs live under `/spec/01-app/`.\n\n**Formatting rule:** ensure there is a blank line after every Markdown header.\n\n---\n\n## Part 3 \u2014 Unit Test Failure Investigation and Documentation\n\n### Original input (verbatim)\n\nFix these and when fixing failing tests: 1. check code, 2. Method code actual one, 3. Logical implementation of the test, 4. Check Testcase, 5. Logically fix it either actual or the test depending on the logical discussion and write it.\n\n### Unit Test Failure Logic\n\n1. **Check code** \u2014 read the production code under test.\n2. **Method code actual implementation** \u2014 understand what the method actually does.\n3. **Logical implementation of the test** \u2014 read the test and understand what it asserts.\n4. **Check the testcase logic** \u2014 verify whether the test expectation is logically correct, including fixtures, mocks, seed data, and expected outputs.\n5. **Decide** \u2014 fix either the implementation or the test depending on which is logically wrong.\n\n### Documentation requirement for failing tests\n\nEvery failing test resolution must be documented at: `/spec/05-failing-tests/{seq}-failing-test-name.md`. Include:\n\n1. Root cause analysis\n2. Solution description\n3. Whether the issue was caused by incorrect implementation or incorrect test logic\n4. Any corrections made to test logic or implementation logic\n5. Prevention guidance so similar failures do not occur again\n6. **Reference to the relevant spec section** that governs the expected behavior\n\n---\n\n## Specification Authority\n\nThe specification is the source of truth.\n\n**Priority order (highest to lowest):**\n1. Specification files under `/spec/01-app/`\n2. Issue corrections under `/spec/02-app/issues/`\n3. Failing test documentation under `/spec/05-failing-tests/`\n4. Memory and decision logs\n5. Existing implementation code\n\nIf implementation contradicts the specification, the specification takes precedence unless the spec is proven incorrect. If the spec is proven incorrect, document the correction as an issue before changing the spec.\n\n---\n\n## Required Execution Order\n\nThe AI must follow this sequence strictly. Steps must not be skipped or reordered.\n\n1. Scan the entire repository tree.\n2. Read Lovable memory folders.\n3. Read workflow tracker `.lovable/memory/workflow/01-plan.md`.\n4. Read specification folders.\n5. Reconstruct project context.\n6. Produce the reliability and failure-chance report.\n7. Propose spec corrections if required.\n8. Update memory artifacts.\n9. Update workflow plan.\n10. Ask the user which task to implement next.\n\n---\n\n## Context Preservation\n\nAfter any significant analysis, correction, or decision, the AI must summarize the key conclusions into Lovable memory files. Summaries must include: what was learned, what was decided, what constraints now exist, what must not be repeated.\n\n**If the AI does not persist conclusions to memory, the work is considered incomplete.**\n\n---\n\n## Task Selection Protocol\n\nWhen asking for the next task, present:\n1. The **top 3 next implementable tasks** from the plan\n2. Their **dependencies** (what must be done first)\n3. Their **estimated complexity** (simple / medium / complex)\n4. The **spec files involved**\n\nThen ask the user to select the task number.\n\n---\n\n## Blocker Handling\n\nIf a blocker prevents reliable implementation or specification updates:\n1. Record the blocker in `.lovable/memory/workflow/01-plan.md`\n2. Document it in the relevant spec or issue file\n3. Explain the minimum information or change required to unblock progress\n4. Avoid guessing past the blocker\n\nThe AI must not silently work around blockers. Blockers must be surfaced to the user.\n\n---\n\n## Allowed Actions Before Implementation\n\nAnalysis, reporting, memory updates, planning, spec corrections, issue documentation, and test diagnosis documentation are allowed before implementation. Application code changes are **not allowed** until the user explicitly selects a task and authorizes implementation.\n\n---\n\n## Global Rules (apply to all parts)\n\n### Spec before code\nAlways write or update specs before any implementation. Never implement until the user explicitly says to start a specific phase or task.\n\n### Ambiguity handling\nIf the specification is ambiguous, the AI must **document the ambiguity** in the relevant spec file and in `.lovable/memory/history/01-decisions.md` before implementing a solution. Do not silently resolve ambiguity.\n\n### Repository scan requirement\nBefore implementation analysis, scan the entire repository tree at the directory level. Do not read contents inside folders marked excluded. Reading only the spec folder is insufficient.\n\n### Skipped folders\nFolders marked skipped, ignored, deprecated, generated, or archived must not be read or modified. They may be listed structurally but their contents must not be opened. This overrides any other instruction.\n\n### Code style (GitMap enforced)\n- All `if` conditions must be **positive** (no `!`, no negation).\n- Functions: **8\u201315 lines**.\n- Files: **100\u2013200 lines max**.\n- Small, focused packages \u2014 one responsibility per package.\n\n### Version bumping\nAny changes to code must bump at least the minor version. The `.release` folder is off-limits \u2014 do not read, modify, or reference it.\n\n### File naming\n- Use stable canonical filenames such as `01-plan.md`, `01-suggestions.md`, `01-decisions.md` for singleton tracker files.\n- Use `{seq}-{slug}.md` for repeating records such as issues and failing test write-ups.\n- Keep folder file counts small.\n- Plans and suggestions are tracked in single files and updated in place unless explicitly split by scale.\n\n### Regression prevention\nEvery fix \u2014 specs, code, or tests \u2014 must include an explicit, testable regression prevention rule.\n\n### Definition of Done\nA task is done only when:\n1. Spec updated (if applicable)\n2. Issue documented (if applicable)\n3. Memory updated\n4. Acceptance criteria added or verified\n5. Plan status updated in `.lovable/memory/workflow/01-plan.md`\n6. Decision log updated (if a decision was made)\n\n---\n\n## Final Instruction\n\nImplementation must not begin until readiness analysis and specification validation are completed and the user explicitly selects the next task.\n\nUse:\n1. **Required Execution Order** for sequencing\n2. **Specification Authority** for conflict resolution\n3. **Context Preservation** for memory persistence\n4. **Blocker Handling** for unresolved situations\n\n*Prompt v4.0. Trigger phrase: \"unified ai prompt\".*\n", order: 1, isDefault: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "default-issues", name: "Issues Tracking", text: "Update spec properly so that the mistake doesn't appear and update memory and also write the details how you fixed it. Create issue file at /spec/02-app/issues/{seq}-{issueSlugName}.md with: Issue summary, Root cause analysis, Fix description, Iterations history, Prevention and non-regression, TODO and follow-ups, Done checklist.", order: 4, isDefault: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "default-test", name: "Unit Test Failing", text: "Fix failing tests: 1) Check code, 2) Check actual method implementation, 3) Check logical implementation of the test, 4) Check test case, 5) Fix logically either the implementation or the test. Document at /spec/05-failing-tests/{seq}-failing-test-name.md with root cause and solution.", order: 5, isDefault: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "default-audit-spec", name: "Audit Spec v1", text: "Audit the current specification set against the implemented codebase. For each spec:\n\n1. Check if the spec accurately reflects the current implementation\n2. Identify any drift between spec and code\n3. Flag missing specs for implemented features\n4. Flag specs for features not yet implemented\n5. Score each spec on a 6-dimension rubric:\n   - Completeness (25%): Are all requirements documented?\n   - Consistency (25%): Do specs agree with each other?\n   - Alignment (20%): Does the spec match the code?\n   - Clarity (15%): Is the spec unambiguous?\n   - Maintainability (10%): Is the spec easy to update?\n   - Test Coverage (5%): Are acceptance criteria testable?\n\nOutput a report to `.lovable/memory/audit/` with severity and impact scores for each finding. Propose corrections for any inconsistencies found.", order: 6, isDefault: true, category: "general", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "default-minor-bump", name: "Minor Bump", text: "Bump the MINOR version (MAJOR.MINOR.PATCH \u2192 MINOR+1, PATCH=0) across all unified-version sites, then:\n\n1. Add a changelog entry in root `changelog.md` (new `## vX.Y.0 \u2014 YYYY-MM-DD` heading, Asia/Kuala_Lumpur date, grouped Added/Changed/Fixed/Removed).\n2. Pin the new version in the root `README.md`.\n3. Run `node scripts/check-version-sync.mjs` \u2014 must exit 0.\n4. Run `bunx tsc --noEmit` \u2014 must exit 0.\n\nAll three artifacts (version + changelog + README) must move together.", order: 7, isDefault: true, category: "versioning", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "default-major-bump", name: "Major Bump", text: "Bump the MAJOR version (MAJOR.MINOR.PATCH \u2192 MAJOR+1, MINOR=0, PATCH=0) across all unified-version sites, then:\n\n1. Add a changelog entry in root `changelog.md` (new `## vX.0.0 \u2014 YYYY-MM-DD` heading, Asia/Kuala_Lumpur date, grouped Added/Changed/Fixed/Removed/Breaking).\n2. Pin the new version in the root `README.md`.\n3. Run `node scripts/check-version-sync.mjs` \u2014 must exit 0.\n4. Run `bunx tsc --noEmit` \u2014 must exit 0.\n\nAll three artifacts (version + changelog + README) must move together.", order: 8, isDefault: true, category: "versioning", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "default-patch-bump", name: "Patch Bump", text: "Bump the PATCH version (MAJOR.MINOR.PATCH \u2192 PATCH+1) across all unified-version sites, then:\n\n1. Add a changelog entry in root `changelog.md` (new `## vX.Y.Z \u2014 YYYY-MM-DD` heading, Asia/Kuala_Lumpur date, grouped Fixed/Changed as applicable).\n2. Pin the new version in the root `README.md`.\n3. Run `node scripts/check-version-sync.mjs` \u2014 must exit 0.\n4. Run `bunx tsc --noEmit` \u2014 must exit 0.\n\nAll three artifacts (version + changelog + README) must move together.", order: 9, isDefault: true, category: "versioning", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "default-code-coverage-basic", name: "Code Coverage Basic", text: "Based on low-coverage packages (>1000 lines), plan 200-line segments for coverage tests. Cover branches, logical segments. Follow AAA format, naming conventions, Should Be methods.", order: 10, isDefault: true, category: "code-coverage", createdAt: "2026-03-21T00:00:00Z", updatedAt: "2026-03-21T00:00:00Z" },
        { id: "default-code-coverage-details", name: "Code Coverage Details", text: "Plan 200-line segments for low-coverage packages. Follow AAA format, naming conventions. Identify packages >1000 lines, segment into 200-line chunks, cover branches and logical flows.", order: 11, isDefault: true, category: "code-coverage", createdAt: "2026-03-21T00:00:00Z", updatedAt: "2026-03-21T00:00:00Z" },
        { id: "default-next-tasks", name: "Next Tasks", text: "Next,\n\nList out the remaining tasks always, if you finish then in future `next` command, find any remaining tasks from memory and suggest", order: 12, isDefault: true, category: "automation", createdAt: "2026-03-21T00:00:00Z", updatedAt: "2026-03-21T00:00:00Z" },
        { id: "default-unit-test-issues-v2-enhanced", name: "Unit Test Issues V2 Enhanced", text: "Based on the packages that have low coverage, if a package has more than 1000 lines, then for that specific package we should split it into segments of 200 lines per task.\n\nYou should create a plan where each 200-line segment is treated as one task. Each task should focus on writing meaningful test coverage, including:\n- Branch coverage\n- Logical segment coverage\n- Edge cases\n\nFirst, create a detailed plan outlining:\n- Which packages will be handled\n- How many segments each package will be split into\n- The step-by-step execution plan\n\nEach time I say \"next\", you should proceed with the next package or segment and work towards achieving 100% code coverage.", order: 13, isDefault: true, category: "code-coverage", createdAt: "2026-03-21T00:00:00Z", updatedAt: "2026-03-21T00:00:00Z" },
    ];
}

let bundledDefaultsCache: PromptEntry[] | null = null;

interface RawDefaultPromptEntry {
    name?: string;
    text?: string;
    category?: string;
}

function mapRawToPromptEntry(entry: RawDefaultPromptEntry, index: number, now: string): PromptEntry | null {
    const name = typeof entry.name === "string" ? entry.name : "";
    const text = typeof entry.text === "string" ? entry.text : "";
    if (!name || !text) return null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const category = typeof entry.category === "string" && entry.category ? entry.category : undefined;
    return {
        id: `default-${slug || index}`,
        name,
        text,
        order: index,
        isDefault: true,
        category,
        createdAt: now,
        updatedAt: now,
    } as PromptEntry;
}

export async function loadBundledDefaultPrompts(): Promise<PromptEntry[] | null> {
    if (bundledDefaultsCache !== null) return bundledDefaultsCache;

    try {
        const url = chrome.runtime.getURL("prompts/macro-prompts.json");
        const response = await fetch(url);
        if (!response.ok) {
            // HEFF: bundled asset missing/mis-served. No retry; log and return null.
            logSampledDebug(
                BgLogTag.PROMPTS,
                "loadBundledDefaults",
                `HEFF: HTTP ${response.status} on GET ${url} — bundled prompts missing. Loop halted.`,
            );
            return null;
        }

        const parsed = await response.json() as { prompts?: RawDefaultPromptEntry[] } | RawDefaultPromptEntry[];
        const rawEntries: RawDefaultPromptEntry[] = Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed.prompts) ? parsed.prompts : []);

        const now = new Date().toISOString();
        const defaults = rawEntries
            .map((entry, index) => mapRawToPromptEntry(entry, index, now))
            .filter((entry): entry is PromptEntry => entry !== null);

        if (defaults.length === 0) return null;
        bundledDefaultsCache = defaults;
        return defaults;
    } catch (defaultsErr) {
        logSampledDebug(
            BgLogTag.PROMPTS,
            "loadBundledDefaults",
            "Failed to load bundled default prompts JSON — caller will fall back to seeded DB rows",
            defaultsErr instanceof Error ? defaultsErr : String(defaultsErr),
        );
        return null;
    }
}

export async function handleGetPrompts(): Promise<{ prompts: PromptEntry[] }> {
    await migrateFromStorageIfNeeded();

    // All prompts (defaults + custom) are now in the DB — read via view
    const prompts = queryAllPromptsViaView();
    return { prompts };
}

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
export async function handleSavePrompt(msg: { prompt: Partial<PromptEntry> }): Promise<{ isOk: true; prompt: PromptEntry }> {
    await migrateFromStorageIfNeeded();

    const input = msg;
    const now = new Date().toISOString();
    const db = getDb();

    // Check if updating an existing prompt (id is an integer string)
    let promptId = input.prompt.id;
    let exists = false;
    if (promptId) {
        const existingResult = db.exec("SELECT Id FROM Prompts WHERE Id = ?", [Number(promptId)]);
        exists = existingResult.length > 0 && existingResult[0].values.length > 0;
    }

    if (exists && promptId) {
        const setClauses: string[] = [];
        const values: (string | number)[] = [];

        if (input.prompt.name !== undefined) { setClauses.push("Name = ?"); values.push(input.prompt.name); }
        if (input.prompt.text !== undefined) { setClauses.push("Text = ?"); values.push(input.prompt.text); }
        if (input.prompt.order !== undefined) { setClauses.push("SortOrder = ?"); values.push(input.prompt.order); }
        if (input.prompt.isFavorite !== undefined) { setClauses.push("IsFavorite = ?"); values.push(input.prompt.isFavorite ? 1 : 0); }
        setClauses.push("UpdatedAt = ?"); values.push(now);
        values.push(Number(promptId));

        db.run(`UPDATE Prompts SET ${setClauses.join(", ")} WHERE Id = ?`, values);

        // Update category via junction table if provided
        if (input.prompt.category !== undefined) {
            db.run("DELETE FROM PromptsToCategory WHERE PromptId = ?", [Number(promptId)]);
            if (input.prompt.category) {
                const categoryId = ensureCategoryId(input.prompt.category);
                linkPromptToCategory(promptId, categoryId);
            }
        }
    } else {
        db.run(
            `INSERT INTO Prompts (Name, Text, Version, SortOrder, IsDefault, IsFavorite, CreatedAt, UpdatedAt)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
            [
                bindOpt(input.prompt.name) ?? "Untitled Prompt",
                bindOpt(input.prompt.text) ?? "",
                bindOpt(input.prompt.version) ?? "1.0.0",
                input.prompt.order ?? 0,
                input.prompt.isFavorite ? 1 : 0,
                now,
                now,
            ],
        );

        const result = db.exec("SELECT last_insert_rowid()");
        promptId = String(result[0].values[0][0]);

        // Link category
        if (input.prompt.category) {
            const categoryId = ensureCategoryId(input.prompt.category);
            linkPromptToCategory(promptId, categoryId);
        }
    }

    markDirty();

    const saved = db.exec("SELECT * FROM Prompts WHERE Id = ?", [Number(promptId)]);
    const row = saved.length > 0 && saved[0].values.length > 0
        ? Object.fromEntries(saved[0].columns.map((col, i) => [col, saved[0].values[0][i]]))
        : { Id: Number(promptId), Name: input.prompt.name ?? "Untitled", Text: input.prompt.text ?? "", SortOrder: 0, IsDefault: 0, IsFavorite: 0, CreatedAt: now, UpdatedAt: now };

    return { isOk: true, prompt: rowToPrompt(row) };
}

export async function handleDeletePrompt(msg: { promptId: string }): Promise<{ isOk: true } | HandlerErrorResponse> {
    await migrateFromStorageIfNeeded();

    const promptIdStr = requireField(msg?.promptId);
    if (promptIdStr === null) return missingFieldError("promptId", "DELETE_PROMPT");

    const numId = Number(promptIdStr);
    if (!Number.isFinite(numId)) return missingFieldError("promptId (numeric)", "DELETE_PROMPT");

    const db = getDb();
    // Delete junction entries first
    db.run("DELETE FROM PromptsToCategory WHERE PromptId = ?", [numId]);
    db.run("DELETE FROM Prompts WHERE Id = ? AND IsDefault = 0", [numId]);
    markDirty();
    return { isOk: true };
}

export async function handleReorderPrompts(msg: { promptIds: string[] }): Promise<{ isOk: true } | HandlerErrorResponse> {
    await migrateFromStorageIfNeeded();

    const promptIds = Array.isArray(msg?.promptIds) ? msg.promptIds : null;
    if (promptIds === null) return missingFieldError("promptIds (array)", "REORDER_PROMPTS");

    const db = getDb();

    for (let i = 0; i < promptIds.length; i++) {
        const id = requireField(promptIds[i]);
        if (id === null) continue; // skip invalid entries instead of crashing
        const numId = Number(id);
        if (!Number.isFinite(numId)) continue;
        db.run("UPDATE Prompts SET SortOrder = ? WHERE Id = ?", [i, numId]);
    }

    markDirty();
    return { isOk: true };
}

/** Reseed prompts: clears all and re-inserts defaults. Updates version key. */
export async function reseedPrompts(): Promise<void> {
    ensurePromptsTable();
    const db = getDb();
    db.run("DELETE FROM PromptsToCategory");
    db.run("DELETE FROM Prompts");
    db.run("DELETE FROM PromptsCategory");

    bundledDefaultsCache = null;
    const defaults = (await loadBundledDefaultPrompts()) ?? getFallbackDefaultPrompts();
    for (const prompt of defaults) {
        insertPromptRow(prompt);
    }
    markDirty();

    // Update seed version so version-based seeding won't re-trigger
    const bundledVersion = computeBundledVersion(defaults);
    await chrome.storage.local.set({ [PROMPTS_SEED_VERSION_KEY]: bundledVersion });

    console.log(`[prompts] Reseeded ${defaults.length} default prompts (version: ${bundledVersion})`);
}
