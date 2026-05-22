/**
 * Marco Extension — useStepLibrary
 *
 * React hook that owns an in-memory `StepLibraryDb` (sql.js) and
 * persists the raw DB bytes to `localStorage` on every mutation.
 *
 * This is the "preview-friendly" data layer that the new
 * `StepGroupLibraryPanel` uses. It deliberately does NOT touch OPFS,
 * chrome.storage, or the background message bus — those are wired
 * separately when the panel ships inside the extension. Keeping the
 * hook self-contained makes the panel runnable in the Lovable preview
 * and unit-testable without WASM mocking gymnastics.
 *
 * Storage key: `marco.step-library.v1` (versioned so a future schema
 * bump can invalidate cleanly).
 *
 * @see src/background/recorder/step-library/db.ts
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { logError } from "./hook-logger";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import {
    StepLibraryDb,
    type ProjectRow,
    type StepGroupRow,
    type StepRow,
} from "@/background/recorder/step-library/db";
import {
    clearGroupInput as clearGroupInputStorage,
    readAllGroupInputs,
    writeGroupInput,
    type GroupInputBag,
    type GroupInputsMap,
} from "@/background/recorder/step-library/group-inputs";
import { StepKindId } from "@/background/recorder/step-library/schema";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "marco.step-library.v1";
const WASM_CDN_URL = "https://sql.js.org/dist/sql-wasm.wasm";
const DEFAULT_PROJECT_NAME = "My Project";
const DEFAULT_PROJECT_EXTERNAL_ID = "00000000-0000-0000-0000-000000000001";

/* ------------------------------------------------------------------ */
/*  Structured load failure                                            */
/* ------------------------------------------------------------------ */

/**
 * Discriminated load-failure shape so the panel can render an
 * actionable error UI (icon + title + hint + recovery action) instead
 * of a single opaque string. Each kind maps to a distinct user-facing
 * recovery path:
 *
 *  - `SqlJsLoad` — sql.js WASM never resolved (CDN blocked, offline,
 *    CSP, slow network). User can retry once connectivity is back.
 *  - `StorageRead` — `localStorage` read or JSON parse failed
 *    (corrupt payload, quota inaccessible). User can reset to clear
 *    the bad blob and start fresh.
 *  - `StorageWrite` — initial seed write failed (quota, private
 *    mode). The library still works in-memory but won't persist;
 *    user should free space or exit private browsing.
 *  - `Unknown` — anything not classified above. Shown as-is with a
 *    generic retry.
 */
export type StepLibraryLoadError =
    | { Kind: "SqlJsLoad"; Message: string; Hint: string; Recoverable: true }
    | { Kind: "StorageRead"; Message: string; Hint: string; Recoverable: true }
    | { Kind: "StorageWrite"; Message: string; Hint: string; Recoverable: true }
    | { Kind: "Unknown"; Message: string; Hint: string; Recoverable: true };

function classifyLoadError(err: unknown, stage: "sqljs" | "storage-read" | "storage-write" | "other"): StepLibraryLoadError {
    const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
    if (stage === "sqljs") {
        return {
            Kind: "SqlJsLoad",
            Message: message,
            Hint: "Could not download the SQL engine (sql.js WASM) from the CDN. Check your internet connection, then click Retry.",
            Recoverable: true,
        };
    }
    if (stage === "storage-read") {
        return {
            Kind: "StorageRead",
            Message: message,
            Hint: "Your saved step-library data appears to be corrupted or unreadable. Click Reset to clear it and start with an empty library.",
            Recoverable: true,
        };
    }
    if (stage === "storage-write") {
        return {
            Kind: "StorageWrite",
            Message: message,
            Hint: "Browser storage is full or unavailable (private/incognito mode often blocks writes). Free up space or use a normal window, then Retry.",
            Recoverable: true,
        };
    }
    return {
        Kind: "Unknown",
        Message: message,
        Hint: "Something went wrong while opening the step library. Try retrying — if the problem persists, reset to clear local state.",
        Recoverable: true,
    };
}

/* ------------------------------------------------------------------ */
/*  sql.js singleton (lazy, browser-only)                              */
/* ------------------------------------------------------------------ */

let sqlPromise: Promise<SqlJsStatic> | null = null;
function loadSql(): Promise<SqlJsStatic> {
    if (sqlPromise === null) {
        sqlPromise = initSqlJs({ locateFile: () => WASM_CDN_URL });
    }
    return sqlPromise;
}

/**
 * Read result is tri-state:
 *   - `{ Kind: "Empty" }`  — nothing stored yet, fresh start
 *   - `{ Kind: "Bytes" }`  — stored DB found and decoded
 *   - `{ Kind: "Error" }`  — storage was present but unreadable
 *                            (corrupt JSON, blocked access). Caller
 *                            propagates to the load-error UI rather
 *                            than silently wiping the user's data.
 */
type StorageReadResult =
    | { Kind: "Empty" }
    | { Kind: "Bytes"; Bytes: Uint8Array }
    | { Kind: "Error"; Error: unknown };

function readBytesFromStorage(): StorageReadResult {
    let raw: string | null;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
        // Access blocked entirely (e.g. SecurityError in sandboxed iframes).
        return { Kind: "Error", Error: err };
    }
    if (raw === null) return { Kind: "Empty" };
    try {
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr)) {
            return { Kind: "Error", Error: new Error("stored payload is not a numeric array") };
        }
        return { Kind: "Bytes", Bytes: new Uint8Array(arr as number[]) };
    } catch (err) {
        return { Kind: "Error", Error: err };
    }
}

/**
 * Write result mirrors the read shape so the bootstrap path can
 * distinguish "saved fine" from "stayed in memory only". Mutation
 * helpers downstream still call this and only `console.warn` on
 * failure, since by then the user has been working with the library
 * and a hard error would lose unsaved work.
 */
function writeBytesToStorage(bytes: Uint8Array): { Ok: true } | { Ok: false; Error: unknown } {
    try {
        // localStorage only takes strings — JSON-encode as a numeric
        // array. Acceptable for a preview-tier persistence (small DBs);
        // production wiring will flip this over to OPFS.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(bytes)));
        return { Ok: true };
    } catch (err) {
        // Quota / private-mode failures should not crash the UI.
        console.warn("useStepLibrary: localStorage write failed", err);
        return { Ok: false, Error: err };
    }
}

/* ------------------------------------------------------------------ */
/*  Public hook surface                                                */
/* ------------------------------------------------------------------ */

export interface UseStepLibraryState {
    readonly Loading: boolean;
    /**
     * Legacy string error — kept for back-compat with any consumer
     * that just needs a message. New UI should read `LoadError` for
     * the structured kind + hint.
     */
    readonly Error: string | null;
    /** Structured load failure for the actionable error UI. */
    readonly LoadError: StepLibraryLoadError | null;
    readonly SqlJs: SqlJsStatic | null;
    readonly Lib: StepLibraryDb | null;
    readonly Project: ProjectRow | null;
    readonly Groups: ReadonlyArray<StepGroupRow>;
    readonly StepsByGroup: ReadonlyMap<number, ReadonlyArray<StepRow>>;
    /**
     * Per-StepGroup input variable bags. Empty Map until a user
     * applies one via the GroupInputsDialog. Persisted to a sibling
     * `localStorage` key — see `group-inputs.ts`.
     */
    readonly GroupInputs: GroupInputsMap;
}

export interface UseStepLibraryApi extends UseStepLibraryState {
    /** Force a re-read from the DB — call after a mutation outside CRUD helpers (e.g. import). */
    readonly refresh: () => void;
    readonly createGroup: (input: { Name: string; ParentStepGroupId: number | null; Description?: string | null }) => number;
    readonly renameGroup: (stepGroupId: number, newName: string) => void;
    readonly deleteGroup: (stepGroupId: number) => void;
    /**
     * Move a group up or down among its current siblings (same parent).
     * No-op when the move would push past either edge — the panel can
     * still call it on every arrow-button click without checking.
     */
    readonly moveGroupWithinParent: (stepGroupId: number, direction: "up" | "down") => void;
    /**
     * Reorder all sibling groups under a parent in one shot. Used by
     * the drag-and-drop handler — caller passes the COMPLETE new order.
     */
    readonly reorderSiblings: (parentStepGroupId: number | null, orderedIds: readonly number[]) => void;
    readonly setGroupArchived: (stepGroupId: number, archived: boolean) => void;
    /**
     * Flip the `IsDisabled` flag on a single step. Disabled steps are
     * dropped by the runner's expansion phase (`skipDisabled` defaults
     * to true), so this is the supported way to temporarily exclude
     * a step from a run while keeping its config intact.
     */
    readonly setStepDisabled: (stepId: number, disabled: boolean) => void;
    /**
     * Append a new step to the end of a StepGroup. Returns the new
     * StepId. Validation rules from the DB layer apply: RunGroup
     * steps require a TargetStepGroupId; every other kind forbids it.
     */
    readonly appendStep: (input: {
        StepGroupId: number;
        StepKindId: StepKindId;
        Label?: string | null;
        PayloadJson?: string | null;
        TargetStepGroupId?: number | null;
    }) => number;
    /** Edit a single step in place (preserves OrderIndex). */
    readonly updateStep: (input: {
        StepId: number;
        StepKindId: StepKindId;
        Label?: string | null;
        PayloadJson?: string | null;
        TargetStepGroupId?: number | null;
    }) => void;
    /** Delete a single step. */
    readonly deleteStep: (stepId: number) => void;
    /**
     * Move a step up or down among its sibling steps in the same
     * StepGroup. No-op when already at the edge — safe to call from
     * an always-rendered button.
     */
    readonly moveStepWithinGroup: (stepId: number, direction: "up" | "down") => void;
    /**
     * Reorder all sibling steps under a StepGroup in one shot. Caller
     * passes the COMPLETE new order (every existing StepId in the
     * group). Used by the drag-and-drop handler.
     */
    readonly reorderSteps: (stepGroupId: number, orderedStepIds: readonly number[]) => void;
    /**
     * Replace the input variable bag for one StepGroup. The bag must
     * be a plain JSON object — see `parseGroupInputJson` in
     * `group-inputs.ts`. Persisted immediately to localStorage.
     */
    readonly setGroupInput: (stepGroupId: number, bag: GroupInputBag) => void;
    /** Remove the input bag for one StepGroup. No-op when absent. */
    readonly clearGroupInput: (stepGroupId: number) => void;
    readonly resetAll: () => void;
    /**
     * Retry the bootstrap after a load failure. Resets the load
     * promise so a previously-failed sql.js fetch is attempted again
     * (the cached rejection would otherwise resolve instantly).
     */
    readonly retryLoad: () => void;
}

export function useStepLibrary(): UseStepLibraryApi {
    const [sql, setSql] = useState<SqlJsStatic | null>(null);
    const [lib, setLib] = useState<StepLibraryDb | null>(null);
    const [project, setProject] = useState<ProjectRow | null>(null);
    const [groups, setGroups] = useState<ReadonlyArray<StepGroupRow>>([]);
    const [stepsByGroup, setStepsByGroup] = useState<ReadonlyMap<number, ReadonlyArray<StepRow>>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<StepLibraryLoadError | null>(null);
    const [groupInputs, setGroupInputs] = useState<GroupInputsMap>(() => new Map());
    const [loading, setLoading] = useState(true);
    /** Bumping this triggers the bootstrap effect to re-run. */
    const [bootstrapNonce, setBootstrapNonce] = useState(0);

    /* ------------------------ bootstrap --------------------------- */

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setLoadError(null);
        (async () => {
            // ---- 1. Load sql.js (network / WASM) -----------------
            let sqljs: SqlJsStatic;
            try {
                sqljs = await loadSql();
            } catch (err) {
                if (cancelled) return;
                // Reset the cached promise so the next retry actually
                // re-fetches instead of resolving the stale rejection.
                sqlPromise = null;
                const classified = classifyLoadError(err, "sqljs");
                setLoadError(classified);
                setError(classified.Message);
                setLoading(false);
                return;
            }
            if (cancelled) return;

            // ---- 2. Read persisted DB bytes (localStorage) -------
            const readResult = readBytesFromStorage();
            if (readResult.Kind === "Error") {
                const classified = classifyLoadError(readResult.Error, "storage-read");
                setLoadError(classified);
                setError(classified.Message);
                setLoading(false);
                return;
            }

            // ---- 3. Open the database & seed if empty ------------
            try {
                const db: Database = readResult.Kind === "Empty"
                    ? new sqljs.Database()
                    : new sqljs.Database(readResult.Bytes);
                const wrapper = new StepLibraryDb(db);
                let projectId: number;
                const existing = wrapper.listProjects();
                if (existing.length === 0) {
                    projectId = wrapper.upsertProject({
                        ExternalId: DEFAULT_PROJECT_EXTERNAL_ID,
                        Name: DEFAULT_PROJECT_NAME,
                    });
                    seedExampleData(wrapper, projectId);
                    const writeResult = writeBytesToStorage(wrapper.exportDbBytes());
                    if (!writeResult.Ok) {
                        // Hard-fail on the FIRST write only — the user
                        // hasn't done any work yet, so surfacing this
                        // up front is friendlier than silently losing
                        // data later. Subsequent mutation writes only
                        // warn (see `persist`).
                        const classified = classifyLoadError(writeResult.Error, "storage-write");
                        setLoadError(classified);
                        setError(classified.Message);
                        setLoading(false);
                        return;
                    }
                } else {
                    projectId = existing[0].ProjectId;
                }
                if (cancelled) return;
                setSql(sqljs);
                setLib(wrapper);
                setProject(wrapper.listProjects().find((p) => p.ProjectId === projectId) ?? null);
                refreshFromDb(wrapper, projectId, setGroups, setStepsByGroup);
                setGroupInputs(readAllGroupInputs());
                setLoading(false);
            } catch (err) {
                if (cancelled) return;
                const classified = classifyLoadError(err, "other");
                setLoadError(classified);
                setError(classified.Message);
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [bootstrapNonce]);

    const persist = useCallback(() => {
        if (lib === null) return;
        writeBytesToStorage(lib.exportDbBytes());
    }, [lib]);

    const refresh = useCallback(() => {
        if (lib === null || project === null) return;
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
    }, [lib, project]);

    const createGroup = useCallback<UseStepLibraryApi["createGroup"]>((input) => {
        if (lib === null || project === null) {
            throw new Error("createGroup: library not initialised");
        }
        const id = lib.createGroup({
            ProjectId: project.ProjectId,
            ParentStepGroupId: input.ParentStepGroupId,
            Name: input.Name,
            Description: input.Description ?? null,
        });
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
        return id;
    }, [lib, project, persist]);

    const renameGroup = useCallback<UseStepLibraryApi["renameGroup"]>((id, name) => {
        if (lib === null || project === null) return;
        lib.renameGroup(id, name);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, persist]);

    const deleteGroup = useCallback<UseStepLibraryApi["deleteGroup"]>((id) => {
        if (lib === null || project === null) return;
        lib.deleteGroup(id);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, persist]);

    const moveGroupWithinParent = useCallback<UseStepLibraryApi["moveGroupWithinParent"]>((id, direction) => {
        if (lib === null || project === null) return;
        const all = lib.listGroups(project.ProjectId);
        const target = all.find((g) => g.StepGroupId === id);
        if (target === undefined) return;
        const parent = target.ParentStepGroupId ?? null;
        const siblings = all
            .filter((g) => (g.ParentStepGroupId ?? null) === parent)
            .sort((a, b) => a.OrderIndex - b.OrderIndex || a.Name.localeCompare(b.Name))
            .map((g) => g.StepGroupId);
        const idx = siblings.indexOf(id);
        if (idx === -1) return;
        const swapWith = direction === "up" ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= siblings.length) return; // already at edge
        const next = siblings.slice();
        [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
        lib.reorderGroups(project.ProjectId, parent, next);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, persist]);

    const reorderSiblings = useCallback<UseStepLibraryApi["reorderSiblings"]>((parent, orderedIds) => {
        if (lib === null || project === null) return;
        lib.reorderGroups(project.ProjectId, parent, orderedIds);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, persist]);

    const setGroupArchived = useCallback<UseStepLibraryApi["setGroupArchived"]>((id, archived) => {
        if (lib === null || project === null) return;
        lib.setGroupArchived(id, archived);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, persist]);

    const setStepDisabled = useCallback<UseStepLibraryApi["setStepDisabled"]>((stepId, disabled) => {
        if (lib === null || project === null) return;
        lib.setStepDisabled(stepId, disabled);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, persist]);

    const setGroupInput = useCallback<UseStepLibraryApi["setGroupInput"]>((id, bag) => {
        writeGroupInput(id, bag);
        // Snapshot the bag with a defensive copy so a consumer who
        // mutates the value after the call cannot rewrite our state.
        setGroupInputs((prev) => {
            const next = new Map(prev);
            next.set(id, bag);
            return next;
        });
    }, []);

    const clearGroupInput = useCallback<UseStepLibraryApi["clearGroupInput"]>((id) => {
        clearGroupInputStorage(id);
        setGroupInputs((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Map(prev);
            next.delete(id);
            return next;
        });
    }, []);

    const appendStep = useCallback<UseStepLibraryApi["appendStep"]>((input) => {
        if (lib === null || project === null) {
            throw new Error("appendStep: library not initialised");
        }
        const id = lib.appendStep(input);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
        return id;
    }, [lib, project, persist]);

    const updateStep = useCallback<UseStepLibraryApi["updateStep"]>((input) => {
        if (lib === null || project === null) return;
        lib.updateStep(input);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, persist]);

    const deleteStep = useCallback<UseStepLibraryApi["deleteStep"]>((stepId) => {
        if (lib === null || project === null) return;
        lib.deleteStep(stepId);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, persist]);

    const moveStepWithinGroup = useCallback<UseStepLibraryApi["moveStepWithinGroup"]>((stepId, direction) => {
        if (lib === null || project === null) return;
        // Locate the step's group from the current snapshot — avoids
        // a redundant DB scan and keeps the move atomic with what the
        // user sees on screen.
        let owningGroupId: number | null = null;
        for (const [gid, steps] of stepsByGroup) {
            if (steps.some((s) => s.StepId === stepId)) {
                owningGroupId = gid;
                break;
            }
        }
        if (owningGroupId === null) return;
        const ordered = (stepsByGroup.get(owningGroupId) ?? []).map((s) => s.StepId);
        const idx = ordered.indexOf(stepId);
        if (idx === -1) return;
        const swapWith = direction === "up" ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= ordered.length) return; // already at edge
        const next = ordered.slice();
        [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
        lib.reorderSteps(owningGroupId, next);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, stepsByGroup, persist]);

    const reorderSteps = useCallback<UseStepLibraryApi["reorderSteps"]>((stepGroupId, orderedStepIds) => {
        if (lib === null || project === null) return;
        lib.reorderSteps(stepGroupId, orderedStepIds);
        refreshFromDb(lib, project.ProjectId, setGroups, setStepsByGroup);
        persist();
    }, [lib, project, persist]);

    const resetAll = useCallback(() => {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (caught) {
            logError("useStepLibrary.resetAll", `localStorage.removeItem("${STORAGE_KEY}") failed — bootstrap nonce will still trigger reload`, caught);
        }
        // Force a hard reload of the in-memory DB by re-running bootstrap.
        // Easiest path: reload the page fragment owning the hook.
        window.location.reload();
    }, []);

    /**
     * Re-run the bootstrap effect without a full page reload. Used by
     * the load-error UI's Retry button. Resets the cached sql.js
     * promise so the next attempt actually re-fetches the WASM.
     */
    const retryLoad = useCallback(() => {
        sqlPromise = null;
        setBootstrapNonce((n) => n + 1);
    }, []);

    return useMemo<UseStepLibraryApi>(() => ({
        Loading: loading,
        Error: error,
        LoadError: loadError,
        SqlJs: sql,
        Lib: lib,
        Project: project,
        Groups: groups,
        StepsByGroup: stepsByGroup,
        GroupInputs: groupInputs,
        refresh,
        createGroup,
        renameGroup,
        deleteGroup,
        moveGroupWithinParent,
        reorderSiblings,
        setGroupArchived,
        setStepDisabled,
        appendStep,
        updateStep,
        deleteStep,
        moveStepWithinGroup,
        reorderSteps,
        setGroupInput,
        clearGroupInput,
        resetAll,
        retryLoad,
    }), [loading, error, loadError, sql, lib, project, groups, stepsByGroup, groupInputs, refresh, createGroup, renameGroup, deleteGroup, moveGroupWithinParent, reorderSiblings, setGroupArchived, setStepDisabled, appendStep, updateStep, deleteStep, moveStepWithinGroup, reorderSteps, setGroupInput, clearGroupInput, resetAll, retryLoad]);
}

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

function refreshFromDb(
    lib: StepLibraryDb,
    projectId: number,
    setGroups: (g: ReadonlyArray<StepGroupRow>) => void,
    setStepsByGroup: (m: ReadonlyMap<number, ReadonlyArray<StepRow>>) => void,
): void {
    const groups = lib.listGroups(projectId);
    setGroups(groups);
    const map = new Map<number, ReadonlyArray<StepRow>>();
    for (const g of groups) {
        map.set(g.StepGroupId, lib.listSteps(g.StepGroupId));
    }
    setStepsByGroup(map);
}

/**
 * Seed a small, illustrative tree on first run so the empty state has
 * something to demonstrate. Safe to remove once the panel is wired to
 * the real recorder data.
 */
function seedExampleData(lib: StepLibraryDb, projectId: number): void {
    const onboarding = lib.createGroup({
        ProjectId: projectId,
        ParentStepGroupId: null,
        Name: "Onboarding",
        Description: "End-to-end signup flow",
    });
    const login = lib.createGroup({
        ProjectId: projectId,
        ParentStepGroupId: onboarding,
        Name: "Login",
        Description: "Sign-in subroutine",
    });
    lib.appendStep({
        StepGroupId: onboarding,
        StepKindId: StepKindId.Click,
        Label: "Click Get Started",
        PayloadJson: JSON.stringify({ Selector: "#get-started" }),
    });
    lib.appendStep({
        StepGroupId: onboarding,
        StepKindId: StepKindId.RunGroup,
        Label: "Run Login subroutine",
        TargetStepGroupId: login,
    });
    lib.appendStep({
        StepGroupId: login,
        StepKindId: StepKindId.Type,
        Label: "Type email",
        PayloadJson: JSON.stringify({ Selector: "#email", Value: "{{Email}}" }),
    });
    lib.appendStep({
        StepGroupId: login,
        StepKindId: StepKindId.Click,
        Label: "Click Sign in",
        PayloadJson: JSON.stringify({ Selector: "#signin" }),
    });
    lib.createGroup({
        ProjectId: projectId,
        ParentStepGroupId: null,
        Name: "Checkout",
        Description: "Cart + payment macros",
    });
}

/** StepKind id → human label, for the right-pane preview. */
export function stepKindLabel(id: StepKindId): string {
    switch (id) {
        case StepKindId.Click:    return "Click";
        case StepKindId.Type:     return "Type";
        case StepKindId.Select:   return "Select";
        case StepKindId.JsInline: return "JS";
        case StepKindId.Wait:     return "Wait";
        case StepKindId.RunGroup: return "Run group";
        case StepKindId.Hotkey:      return "Hotkey";
        case StepKindId.UrlTabClick: return "URL tab click";
        default:                     return `Kind ${String(id)}`;
    }
}
