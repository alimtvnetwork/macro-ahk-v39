/**
 * Marco Extension — Step Group Library Panel
 *
 * Two-pane Options page surface for browsing the recorder's step
 * groups, selecting them for import/export, and performing CRUD.
 *
 * Layout:
 *   ┌──────────────── Toolbar ──────────────┐
 *   │  Project · selected count · [New]     │
 *   │  [Import ZIP]  [Export Selected]      │
 *   ├────────────────┬──────────────────────┤
 *   │  Tree pane     │  Step preview pane   │
 *   │  (checkboxes,  │  (active group's     │
 *   │  ⋯ row menu)   │   ordered steps)     │
 *   └────────────────┴──────────────────────┘
 *
 * Data layer is the in-memory `useStepLibrary` hook (sql.js, persisted
 * to localStorage). All export/import calls go through the pure
 * modules (`runStepGroupExport` / `runStepGroupImport`) so the same
 * code paths the unit tests cover are what the user clicks.
 *
 * @see src/hooks/use-step-library.ts
 * @see src/background/recorder/step-library/export-bundle.ts
 * @see src/background/recorder/step-library/import-bundle.ts
 */

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import {
    Archive,
    ArchiveRestore,
    ArrowDown,
    ArrowUp,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ChevronDown as ChevronDownIcon,
    Download,
    FileJson,
    FileSpreadsheet,
    FilePlus2,
    FolderTree,
    Globe,
    GripVertical,
    MoreHorizontal,
    Pencil,
    Play,
    Plus,
    Search,
    Trash2,
    Upload,
    Webhook,
    Timer,
    X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";

import { stepKindLabel, useStepLibrary } from "@/hooks/use-step-library";
import { useRecorderSelection } from "@/hooks/use-recorder-selection";
import {
    decodeNullableNumber,
    decodeNumberSet,
    usePersistedState,
} from "@/hooks/use-persisted-state";
import type { StepGroupRow, StepRow } from "@/background/recorder/step-library/db";
import { StepKindId } from "@/background/recorder/step-library/schema";
import { runStepGroupExport, previewStepGroupExport, type StepGroupExportPreview } from "@/background/recorder/step-library/export-bundle";
import { useStepGroupImport } from "@/hooks/use-step-group-import";
import ImportSummaryDialog from "./ImportSummaryDialog";
import BatchRunDialog from "./BatchRunDialog";
import RunGroupDialog from "./RunGroupDialog";
import BundleExchangePanel, {
    type LastExportSummary,
    type LastImportSummary,
} from "./BundleExchangePanel";
import ImportErrorDialog from "./ImportErrorDialog";
import ExportPreviewDialog from "./ExportPreviewDialog";
import StepEditorDialog, { type StepEditorMode } from "./StepEditorDialog";

import ExportErrorDialog from "./ExportErrorDialog";
import StepLibraryErrorState from "./StepLibraryErrorState";
import BatchRenameDialog, { type BatchRenameChange } from "./BatchRenameDialog";
import BatchDeleteDialog from "./BatchDeleteDialog";
import {
    buildDeletePreview,
    useStepGroupBatchActions,
} from "@/hooks/use-step-group-batch-actions";
import {
    explainExportFailure,
    type ExportErrorExplanation,
} from "@/background/recorder/step-library/export-error-explainer";
import { GroupInputsDialog } from "./GroupInputsDialog";
import { CsvInputDialog } from "./CsvInputDialog";
import WebhookSettingsDialog from "./WebhookSettingsDialog";
import InputSourceDialog from "./InputSourceDialog";
import StepWaitDialog from "./StepWaitDialog";
import {
    readAllStepWaits,
    type WaitConfig,
} from "@/background/recorder/step-library/step-wait";


/* ------------------------------------------------------------------ */
/*  Tree shape                                                         */
/* ------------------------------------------------------------------ */

interface TreeNode {
    readonly Group: StepGroupRow;
    readonly Children: TreeNode[];
}

function buildTree(groups: ReadonlyArray<StepGroupRow>): TreeNode[] {
    const byParent = new Map<number | null, StepGroupRow[]>();
    for (const g of groups) {
        const key = g.ParentStepGroupId ?? null;
        const arr = byParent.get(key) ?? [];
        arr.push(g);
        byParent.set(key, arr);
    }
    const visit = (parentId: number | null): TreeNode[] => {
        const kids = byParent.get(parentId) ?? [];
        kids.sort((a, b) => a.OrderIndex - b.OrderIndex || a.Name.localeCompare(b.Name));
        return kids.map((g) => ({ Group: g, Children: visit(g.StepGroupId) }));
    };
    return visit(null);
}

function collectDescendantIds(node: TreeNode, out: Set<number>): void {
    out.add(node.Group.StepGroupId);
    for (const c of node.Children) collectDescendantIds(c, out);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StepGroupLibraryPanel() {
    const lib = useStepLibrary();
    const [selected, setSelected] = useState<Set<number>>(new Set());
    /**
     * Caller-visible insertion order of `selected`. Plain JS Sets do
     * preserve insertion order, but we keep an explicit array because
     * `toggleSubtree` adds many ids at once and we want the **first
     * encountered** ordering (top-of-tree first), which we cannot
     * recover from a Set after re-toggles.
     */
    const [selectionOrder, setSelectionOrder] = useState<ReadonlyArray<number>>([]);
    /**
     * Active selection + expanded folders are persisted per-project so
     * the two-pane layout restores exactly where the user left off
     * across full page refreshes. Keys are namespaced by project id;
     * the no-project case uses a `__noproject__` slot. A post-load
     * effect prunes stale ids that no longer exist (e.g. groups
     * deleted in another tab).
     */
    const projectKey = lib.Project?.ProjectId ?? "__noproject__";
    const [activeGroupId, setActiveGroupId] = usePersistedState<number | null>(
        `marco.library.activeGroup.${projectKey}`,
        null,
        decodeNullableNumber,
    );
    const [expanded, setExpanded] = usePersistedState<Set<number>>(
        `marco.library.expanded.${projectKey}`,
        new Set(),
        decodeNumberSet,
    );

    /**
     * Bi-directional selection sync with the in-page Floating
     * Controller's live tree panel. When a user clicks a group in
     * Options we broadcast it; when the controller clicks a node we
     * adopt it. Echo suppression is handled inside the hook by
     * tagging dispatches with `Source = "options"`.
     */
    const recorderSel = useRecorderSelection("options");
    useEffect(() => {
        recorderSel.select({ StepGroupId: activeGroupId, StepId: null });
        // Only react to local activeGroupId changes — the hook's
        // setter is stable and re-broadcasting on every render would
        // ping-pong with the controller.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeGroupId]);
    useEffect(() => {
        if (recorderSel.selection.StepGroupId === activeGroupId) { return; }
        setActiveGroupId(recorderSel.selection.StepGroupId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recorderSel.selection.StepGroupId]);
    const [showArchived, setShowArchived] = useState(false);
    const [batchOpen, setBatchOpen] = useState(false);
    /**
     * Single-group run surface. We keep the targeted group on the
     * dialog state itself (not a stale `activeGroupId` snapshot) so
     * the dialog renders the right name even if the user clicks a
     * different tree row while the run is in flight.
     */
    const [runGroupDialog, setRunGroupDialog] = useState<{ open: boolean; group: StepGroupRow | null }>({
        open: false, group: null,
    });
    const [batchRenameOpen, setBatchRenameOpen] = useState(false);
    const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
    const [webhookOpen, setWebhookOpen] = useState(false);
    const [inputSourceOpen, setInputSourceOpen] = useState(false);
    const [waitDialog, setWaitDialog] = useState<{ open: boolean; stepId: number | null; stepLabel: string | null }>({
        open: false, stepId: null, stepLabel: null,
    });
    const [stepWaits, setStepWaits] = useState<ReadonlyMap<number, WaitConfig>>(() => readAllStepWaits());
    const refreshStepWaits = () => setStepWaits(readAllStepWaits());
    const [lastExport, setLastExport] = useState<LastExportSummary | null>(null);
    /**
     * Import pipeline lives in `useStepGroupImport`. The hook owns the
     * file → ZIP → merge dance plus both dialog states (success summary
     * + structured error). The list panel uses the same hook, so the
     * UX stays identical across both browsers.
     */
    const importApi = useStepGroupImport({
        lib: { Lib: lib.Lib, Project: lib.Project, SqlJs: lib.SqlJs },
        onAfterImport: lib.refresh,
    });
    const lastImport: LastImportSummary | null = importApi.lastImport;
    /**
     * Pre-download preview state. `Pending` holds the resolved selection
     * + descendants flag captured at the moment the user clicked Export
     * so the eventual confirmation downloads exactly what was previewed,
     * even if the underlying selection changes while the dialog is open.
     */
    const [exportPreview, setExportPreview] = useState<{
        readonly Open: boolean;
        readonly Preview: StepGroupExportPreview | null;
        readonly Pending: {
            readonly Ids: ReadonlyArray<number>;
            readonly IncludeDescendants: boolean;
        } | null;
    }>({ Open: false, Preview: null, Pending: null });
    /**
     * Structured export-failure dialog state. Mirrors `importError` so
     * both sides of the bundle UI surface failures in a dialog the user
     * can read, copy from, and act on — not a fleeting toast.
     */
    const [exportError, setExportError] = useState<{
        readonly Open: boolean;
        readonly Explanation: ExportErrorExplanation | null;
    }>({ Open: false, Explanation: null });

    /**
     * Tracks the *exact* (innermost) StepGroup row currently under the
     * cursor. Lifted to panel scope so a hovered child does not also
     * light up its ancestor `<li>` wrappers — only the deepest node
     * with `hoveredId === id` renders the highlighter.
     */
    const [hoveredId, setHoveredId] = useState<number | null>(null);

    // Dialog state
    const [createDialog, setCreateDialog] = useState<{ open: boolean; parent: number | null; name: string }>({
        open: false, parent: null, name: "",
    });
    const [renameDialog, setRenameDialog] = useState<{ open: boolean; group: StepGroupRow | null; name: string }>({
        open: false, group: null, name: "",
    });
    const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; group: StepGroupRow | null }>({
        open: false, group: null,
    });
    /**
     * Per-group input-data dialog. We track the *target* group on the
     * dialog itself rather than relying on `activeGroupId` so opening
     * from a row dropdown menu doesn't have to first activate the row.
     */
    const [inputsDialog, setInputsDialog] = useState<{ open: boolean; group: StepGroupRow | null }>({
        open: false, group: null,
    });
    /**
     * Per-group CSV importer dialog. Same target shape as the JSON
     * variant — both feed `setGroupInput` with the resulting bag.
     */
    const [csvDialog, setCsvDialog] = useState<{ open: boolean; group: StepGroupRow | null }>({
        open: false, group: null,
    });
    /**
     * Step editor dialog state. `Mode` carries either the parent
     * group id (create) or the existing step row (edit). The dialog
     * resets its form whenever this changes — see StepEditorDialog.
     */
    const [stepEditor, setStepEditor] = useState<{ open: boolean; mode: StepEditorMode | null }>({
        open: false, mode: null,
    });
    const [deleteStepDialog, setDeleteStepDialog] = useState<{ open: boolean; step: StepRow | null }>({
        open: false, step: null,
    });

    const fileInputRef = useRef<HTMLInputElement>(null);

    /**
     * ────── Optimistic reorder overrides ──────
     *
     * Drag-and-drop applies the new order to the screen *before* the
     * persistence call so the row jumps to its new slot under the
     * cursor without waiting for a refresh round-trip. The overrides
     * are cleared on the next snapshot that already reflects the
     * change (the success path) or rolled back to `null` if the
     * underlying mutation throws (the failure path).
     *
     *   `pendingGroupOrder`  — keyed by parent id ("root" for
     *                          top-level), value = full sibling order.
     *   `pendingStepOrder`   — keyed by StepGroupId, value = full
     *                          step order in that group.
     */
    const [pendingGroupOrder, setPendingGroupOrder] = useState<ReadonlyMap<number | "root", ReadonlyArray<number>>>(
        () => new Map(),
    );
    const [pendingStepOrder, setPendingStepOrder] = useState<ReadonlyMap<number, ReadonlyArray<number>>>(
        () => new Map(),
    );

    // Filter archived groups out of the tree by default. When the user
    // flips the toggle they remain visible but render greyed-out (the
    // TreeNodeRow handles the visual state via `node.Group.IsArchived`).
    const visibleGroups = useMemo(
        () => (showArchived ? lib.Groups : lib.Groups.filter((g) => !g.IsArchived)),
        [lib.Groups, showArchived],
    );

    /**
     * Apply pending sibling overrides on top of the loaded data so the
     * tree renders the optimistic order. The override is a *complete*
     * sibling list per parent, so we just look it up and use it as the
     * sort key. Any group missing from the override falls through to
     * its DB OrderIndex.
     */
    const orderedGroups = useMemo(() => {
        if (pendingGroupOrder.size === 0) return visibleGroups;
        const positionByParent = new Map<number | "root", Map<number, number>>();
        for (const [parentKey, ids] of pendingGroupOrder) {
            const m = new Map<number, number>();
            ids.forEach((id, i) => m.set(id, i));
            positionByParent.set(parentKey, m);
        }
        return [...visibleGroups].sort((a, b) => {
            const aKey = (a.ParentStepGroupId ?? "root") as number | "root";
            const bKey = (b.ParentStepGroupId ?? "root") as number | "root";
            if (aKey !== bKey) return 0; // different parents — keep relative order
            const positions = positionByParent.get(aKey);
            if (positions === undefined) return 0;
            const ai = positions.get(a.StepGroupId);
            const bi = positions.get(b.StepGroupId);
            if (ai === undefined || bi === undefined) return 0;
            return ai - bi;
        });
    }, [visibleGroups, pendingGroupOrder]);

    const tree = useMemo(() => buildTree(orderedGroups), [orderedGroups]);

    /**
     * Drop the optimistic group override once the loaded snapshot
     * already matches it — that's our success signal in lieu of an
     * async confirmation. Same idea for steps below.
     */
    useEffect(() => {
        if (pendingGroupOrder.size === 0) return;
        let allSettled = true;
        for (const [parentKey, ids] of pendingGroupOrder) {
            const parentId = parentKey === "root" ? null : parentKey;
            const actual = lib.Groups
                .filter((g) => (g.ParentStepGroupId ?? null) === parentId)
                .sort((a, b) => a.OrderIndex - b.OrderIndex || a.Name.localeCompare(b.Name))
                .map((g) => g.StepGroupId);
            if (actual.length !== ids.length || actual.some((id, i) => id !== ids[i])) {
                allSettled = false;
                break;
            }
        }
        if (allSettled) setPendingGroupOrder(new Map());
    }, [lib.Groups, pendingGroupOrder]);

    /**
     * Free-text search over group names. Empty string disables filtering.
     * The filter keeps any node whose name matches AND every ancestor
     * along the path so the tree shape stays readable. When a query is
     * active we also auto-expand all matching paths so results aren't
     * hidden behind collapsed parents.
     */
    const [query, setQuery] = useState("");
    const trimmedQuery = query.trim().toLowerCase();
    const { filteredTree, autoExpand } = useMemo(() => {
        if (trimmedQuery === "") {
            return { filteredTree: tree, autoExpand: null as Set<number> | null };
        }
        const expandIds = new Set<number>();
        const filterNodes = (nodes: ReadonlyArray<TreeNode>): TreeNode[] => {
            const out: TreeNode[] = [];
            for (const n of nodes) {
                const selfMatch = n.Group.Name.toLowerCase().includes(trimmedQuery);
                const kids = filterNodes(n.Children);
                if (selfMatch || kids.length > 0) {
                    if (kids.length > 0) expandIds.add(n.Group.StepGroupId);
                    out.push({ Group: n.Group, Children: kids });
                }
            }
            return out;
        };
        const filtered = filterNodes(tree);
        return { filteredTree: filtered, autoExpand: expandIds };
    }, [tree, trimmedQuery]);

    /**
     * Effective expanded set used by the renderer. When a search is
     * active, we union the user's manual expansion with the auto-expand
     * set so matched ancestors open without mutating the user's saved
     * expansion state (clearing the query restores their original view).
     */
    const effectiveExpanded = useMemo(() => {
        if (autoExpand === null) return expanded;
        const merged = new Set(expanded);
        for (const id of autoExpand) merged.add(id);
        return merged;
    }, [expanded, autoExpand]);

    const activeGroup = useMemo(
        () => lib.Groups.find((g) => g.StepGroupId === activeGroupId) ?? null,
        [lib.Groups, activeGroupId],
    );
    const activeSteps: ReadonlyArray<StepRow> = useMemo(() => {
        if (activeGroupId === null) return [];
        const loaded = lib.StepsByGroup.get(activeGroupId) ?? [];
        const override = pendingStepOrder.get(activeGroupId);
        if (override === undefined) return loaded;
        // Materialise the override against the loaded rows. Any step
        // missing from the override (rare race after a concurrent
        // append) is appended to the end so nothing disappears.
        const byId = new Map(loaded.map((s) => [s.StepId, s] as const));
        const out: StepRow[] = [];
        for (const id of override) {
            const row = byId.get(id);
            if (row !== undefined) {
                out.push(row);
                byId.delete(id);
            }
        }
        for (const remaining of byId.values()) out.push(remaining);
        return out;
    }, [activeGroupId, lib.StepsByGroup, pendingStepOrder]);

    /** Same settle-and-clear pattern as `pendingGroupOrder`. */
    useEffect(() => {
        if (pendingStepOrder.size === 0) return;
        let allSettled = true;
        for (const [gid, ids] of pendingStepOrder) {
            const actual = (lib.StepsByGroup.get(gid) ?? []).map((s) => s.StepId);
            if (actual.length !== ids.length || actual.some((id, i) => id !== ids[i])) {
                allSettled = false;
                break;
            }
        }
        if (allSettled) setPendingStepOrder(new Map());
    }, [lib.StepsByGroup, pendingStepOrder]);
    const groupsById = useMemo(() => {
        const m = new Map<number, StepGroupRow>();
        for (const g of lib.Groups) m.set(g.StepGroupId, g);
        return m;
    }, [lib.Groups]);

    /**
     * Prune persisted ids that no longer exist in the loaded library.
     * This handles the case where a group was deleted in another tab
     * (or by an import-with-replace) between sessions. We only run
     * after groups have been loaded at least once — `lib.Project`
     * being non-null is our readiness signal.
     */
    useEffect(() => {
        if (lib.Project === null) return;
        if (activeGroupId !== null && !groupsById.has(activeGroupId)) {
            setActiveGroupId(null);
        }
        let needsPrune = false;
        for (const id of expanded) {
            if (!groupsById.has(id)) {
                needsPrune = true;
                break;
            }
        }
        if (needsPrune) {
            const next = new Set<number>();
            for (const id of expanded) {
                if (groupsById.has(id)) next.add(id);
            }
            setExpanded(next);
        }
    }, [lib.Project, groupsById, activeGroupId, expanded, setActiveGroupId, setExpanded]);


    /* ------------------------ Selection --------------------------- */

    const applySelection = (on: boolean, ids: ReadonlyArray<number>) => {
        setSelected((prev) => {
            const next = new Set(prev);
            for (const id of ids) {
                if (on) next.add(id); else next.delete(id);
            }
            return next;
        });
        setSelectionOrder((prev) => {
            if (!on) return prev.filter((id) => !ids.includes(id));
            const seen = new Set(prev);
            const additions = ids.filter((id) => !seen.has(id));
            return additions.length === 0 ? prev : [...prev, ...additions];
        });
    };

    const toggleOne = (id: number, on: boolean) => {
        applySelection(on, [id]);
    };

    const toggleSubtree = (node: TreeNode, on: boolean) => {
        const ids = new Set<number>();
        collectDescendantIds(node, ids);
        applySelection(on, Array.from(ids));
    };

    const clearSelection = () => {
        setSelected(new Set());
        setSelectionOrder([]);
    };

    /* ------------------------ Batch actions ----------------------- */

    const batchActions = useStepGroupBatchActions(lib);
    const selectedGroups = useMemo(
        () => lib.Groups.filter((g) => selected.has(g.StepGroupId)),
        [lib.Groups, selected],
    );
    const deletePreview = useMemo(
        () => buildDeletePreview(Array.from(selected), lib.Groups, lib.StepsByGroup),
        [selected, lib.Groups, lib.StepsByGroup],
    );

    const handleBatchRenameApply = (changes: ReadonlyArray<BatchRenameChange>) => {
        const outcome = batchActions.applyBatchRename(changes);
        if (outcome.Error !== null && outcome.Applied === 0) {
            toast.error("Batch rename failed", { description: outcome.Error });
            return;
        }
        const verb = outcome.Error === null ? "Renamed" : "Partially renamed";
        toast.success(`${verb} ${outcome.Applied} group${outcome.Applied === 1 ? "" : "s"}`, {
            description: outcome.Error ?? "Click Undo to revert.",
            action: {
                label: "Undo",
                onClick: () => {
                    const undone = outcome.undo();
                    if (undone.Error !== null && undone.Applied === 0) {
                        toast.error("Undo failed", { description: undone.Error });
                    } else {
                        toast.success(`Reverted ${undone.Applied} rename${undone.Applied === 1 ? "" : "s"}`);
                    }
                },
            },
            duration: 8000,
        });
    };

    const handleBatchDeleteConfirm = (ids: ReadonlyArray<number>) => {
        let deleted = 0;
        let firstError: string | null = null;
        for (const id of ids) {
            try {
                lib.deleteGroup(id);
                deleted += 1;
            } catch (err) {
                firstError = err instanceof Error ? err.message : String(err);
                break;
            }
        }
        setSelected((prev) => {
            const next = new Set(prev);
            for (const id of ids) next.delete(id);
            return next;
        });
        setSelectionOrder((prev) => prev.filter((sid) => !ids.includes(sid)));
        if (activeGroupId !== null && ids.includes(activeGroupId)) {
            setActiveGroupId(null);
        }
        if (firstError !== null && deleted === 0) {
            toast.error("Batch delete failed", { description: firstError });
        } else {
            toast.success(`Deleted ${deleted} group${deleted === 1 ? "" : "s"}`, {
                description: firstError ?? "This action cannot be undone.",
            });
        }
    };

    const toggleExpanded = (id: number) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    /* ------------------------ Mutations --------------------------- */

    const handleCreate = () => {
        const name = createDialog.name.trim();
        if (name === "") {
            toast.error("Group name is required");
            return;
        }
        try {
            const newId = lib.createGroup({ Name: name, ParentStepGroupId: createDialog.parent });
            setCreateDialog({ open: false, parent: null, name: "" });
            setActiveGroupId(newId);
            if (createDialog.parent !== null) {
                setExpanded((p) => new Set(p).add(createDialog.parent as number));
            }
            toast.success(`Created “${name}”`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Create failed");
        }
    };

    const handleRename = () => {
        if (renameDialog.group === null) return;
        const name = renameDialog.name.trim();
        if (name === "") {
            toast.error("Group name is required");
            return;
        }
        try {
            lib.renameGroup(renameDialog.group.StepGroupId, name);
            toast.success(`Renamed to “${name}”`);
            setRenameDialog({ open: false, group: null, name: "" });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Rename failed");
        }
    };

    const handleDelete = () => {
        if (deleteDialog.group === null) return;
        const id = deleteDialog.group.StepGroupId;
        try {
            lib.deleteGroup(id);
            setSelected((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            setSelectionOrder((prev) => prev.filter((sid) => sid !== id));
            if (activeGroupId === id) setActiveGroupId(null);
            toast.success(`Deleted “${deleteDialog.group.Name}”`);
            setDeleteDialog({ open: false, group: null });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed");
        }
    };

    const handleMove = (id: number, direction: "up" | "down") => {
        try {
            lib.moveGroupWithinParent(id, direction);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Move failed");
        }
    };

    const handleArchiveToggle = (group: StepGroupRow) => {
        const next = !group.IsArchived;
        try {
            lib.setGroupArchived(group.StepGroupId, next);
            toast.success(next ? `Archived “${group.Name}”` : `Restored “${group.Name}”`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Archive failed");
        }
    };

    /* ------------------------ Step handlers ------------------------ */

    const handleStepEditorSubmit = (input: {
        StepKindId: StepKindId;
        Label: string | null;
        PayloadJson: string | null;
        TargetStepGroupId: number | null;
    }): void => {
        const mode = stepEditor.mode;
        if (mode === null) return;
        try {
            if (mode.Kind === "create") {
                lib.appendStep({
                    StepGroupId: mode.StepGroupId,
                    StepKindId: input.StepKindId,
                    Label: input.Label,
                    PayloadJson: input.PayloadJson,
                    TargetStepGroupId: input.TargetStepGroupId,
                });
                toast.success("Step added");
            } else {
                lib.updateStep({
                    StepId: mode.Step.StepId,
                    StepKindId: input.StepKindId,
                    Label: input.Label,
                    PayloadJson: input.PayloadJson,
                    TargetStepGroupId: input.TargetStepGroupId,
                });
                toast.success("Step updated");
            }
            setStepEditor({ open: false, mode: null });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Save failed");
        }
    };

    const handleStepMove = (stepId: number, direction: "up" | "down"): void => {
        try {
            lib.moveStepWithinGroup(stepId, direction);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Move failed");
        }
    };

    const handleStepDeleteConfirm = (): void => {
        const target = deleteStepDialog.step;
        if (target === null) return;
        try {
            lib.deleteStep(target.StepId);
            toast.success(`Deleted step “${target.Label ?? target.StepId}”`);
            setDeleteStepDialog({ open: false, step: null });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed");
        }
    };

    /**
     * Drag-and-drop within siblings ONLY. Cross-parent drag is
     * intentionally out of scope here — moving across parents has
     * additional invariants (depth check, name uniqueness) that
     * deserve their own dialog. Sibling-only drag covers the common
     * "I want this group above that one" case without surprises.
     */
    const handleDropReorder = (
        parentId: number | null,
        sourceId: number,
        targetId: number,
    ) => {
        if (sourceId === targetId) return;
        // Source-of-truth siblings come from `lib.Groups` (not the
        // optimistic `orderedGroups` projection) so a chain of rapid
        // drops always recomputes against the persisted state.
        const siblings = lib.Groups
            .filter((g) => !g.IsArchived || showArchived)
            .filter((g) => (g.ParentStepGroupId ?? null) === parentId)
            .sort((a, b) => a.OrderIndex - b.OrderIndex || a.Name.localeCompare(b.Name))
            .map((g) => g.StepGroupId);
        const fromIdx = siblings.indexOf(sourceId);
        const toIdx = siblings.indexOf(targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        const next = siblings.slice();
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, sourceId);
        // 1. Optimistic — paint the new order immediately.
        const parentKey = (parentId ?? "root") as number | "root";
        setPendingGroupOrder((prev) => {
            const m = new Map(prev);
            m.set(parentKey, next);
            return m;
        });
        // 2. Persist — on failure, roll back the override.
        try {
            lib.reorderSiblings(parentId, next);
        } catch (err) {
            setPendingGroupOrder((prev) => {
                const m = new Map(prev);
                m.delete(parentKey);
                return m;
            });
            toast.error(err instanceof Error ? err.message : "Reorder failed");
        }
    };

    /**
     * Same shape as `handleDropReorder`, but for steps inside the
     * active StepGroup. Sibling-only — cross-group step move would
     * require renumbering both groups and isn't supported yet.
     */
    const handleStepDropReorder = (
        stepGroupId: number,
        sourceStepId: number,
        targetStepId: number,
    ): void => {
        if (sourceStepId === targetStepId) return;
        const ordered = (lib.StepsByGroup.get(stepGroupId) ?? []).map((s) => s.StepId);
        const fromIdx = ordered.indexOf(sourceStepId);
        const toIdx = ordered.indexOf(targetStepId);
        if (fromIdx === -1 || toIdx === -1) return;
        const next = ordered.slice();
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, sourceStepId);
        setPendingStepOrder((prev) => {
            const m = new Map(prev);
            m.set(stepGroupId, next);
            return m;
        });
        try {
            lib.reorderSteps(stepGroupId, next);
        } catch (err) {
            setPendingStepOrder((prev) => {
                const m = new Map(prev);
                m.delete(stepGroupId);
                return m;
            });
            toast.error(err instanceof Error ? err.message : "Reorder failed");
        }
    };

    /* ------------------------ Export / Import --------------------- */

    /**
     * Actually package + download the bundle. Called only after the
     * preview dialog is confirmed (or for code paths that intentionally
     * skip the preview, like programmatic exports).
     */
    const performExport = async (
        ids: ReadonlyArray<number>,
        includeDescendants: boolean,
    ) => {
        if (lib.Lib === null || lib.Project === null || lib.SqlJs === null) {
            toast.error("Library not ready");
            return;
        }
        const result = await runStepGroupExport({
            Source: lib.Lib,
            ProjectId: lib.Project.ProjectId,
            SelectedStepGroupIds: ids,
            IncludeDescendants: includeDescendants,
            BundleName: `${lib.Project.Name} — ${ids.length} group(s)`,
            SqlJs: lib.SqlJs,
            JsZip: JSZip,
        });
        if (result.Reason !== "Ok") {
            const explanation = explainExportFailure(result);
            setExportError({ Open: true, Explanation: explanation });
            toast.error(explanation.Title, { description: "See dialog for details" });
            return;
        }
        // Trigger browser download via blob URL.
        const blob = new Blob([result.ZipBytes as BlobPart], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.ZipFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setLastExport({
            FileName: result.ZipFileName,
            GroupCount: result.Manifest.Counts.StepGroups,
            StepCount: result.Manifest.Counts.Steps,
            At: new Date().toISOString(),
        });
        toast.success(
            `Exported ${result.Manifest.Counts.StepGroups} group(s)`,
            { description: `${result.Manifest.Counts.Steps} steps · ${result.ZipFileName}` },
        );
    };

    /**
     * User-facing entrypoint: validate the selection, compute a dry-run
     * preview (counts + RunGroup-ref warnings), and open the preview
     * dialog. The actual download is gated on the dialog's confirm.
     */
    const handleExport = (
        idsOverride?: ReadonlyArray<number>,
        includeDescendants: boolean = true,
    ) => {
        if (lib.Lib === null || lib.Project === null || lib.SqlJs === null) {
            toast.error("Library not ready");
            return;
        }
        const ids = idsOverride ?? Array.from(selected);
        if (ids.length === 0) {
            toast.error("Select at least one group to export");
            return;
        }
        const preview = previewStepGroupExport({
            Source: lib.Lib,
            ProjectId: lib.Project.ProjectId,
            SelectedStepGroupIds: ids,
            IncludeDescendants: includeDescendants,
        });
        if (preview.Reason !== "Ok") {
            const explanation = explainExportFailure(preview);
            setExportError({ Open: true, Explanation: explanation });
            toast.error(explanation.Title, { description: "See dialog for details" });
            return;
        }
        setExportPreview({
            Open: true,
            Preview: preview,
            Pending: { Ids: ids, IncludeDescendants: includeDescendants },
        });
    };

    const confirmExport = async () => {
        const pending = exportPreview.Pending;
        setExportPreview({ Open: false, Preview: null, Pending: null });
        if (pending === null) return;
        await performExport(pending.Ids, pending.IncludeDescendants);
    };


    const handleImportClick = () => fileInputRef.current?.click();

    /**
     * Thin adapter so the existing `BundleExchangePanel` + hidden file
     * input keep their `(file: File) => Promise<void>` contract. All
     * actual work — read, merge, dialog routing — is delegated to the
     * shared `useStepGroupImport` hook.
     */
    const handleImportFile = async (file: File) => {
        await importApi.importFile(file);
    };

    /* ------------------------ Render ------------------------------ */

    if (lib.Loading) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground">
                Loading step library…
            </div>
        );
    }
    if (lib.LoadError !== null) {
        return (
            <StepLibraryErrorState
                error={lib.LoadError}
                onRetry={lib.retryLoad}
                onReset={lib.resetAll}
            />
        );
    }

    const selectedCount = selected.size;

    return (
        <div className="flex h-full min-h-[600px] w-full flex-col gap-4 p-6">
            <Toaster />

            {/* ---------- Toolbar ---------- */}
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <FolderTree className="h-5 w-5 text-primary" />
                    <h1 className="text-xl font-semibold tracking-tight">
                        Step Group Library
                    </h1>
                    {lib.Project !== null && (
                        <span className="text-sm text-muted-foreground">
                            · {lib.Project.Name}
                        </span>
                    )}
                    <a
                        href="#step-groups-list"
                        className="ml-2 text-xs text-primary underline-offset-2 hover:underline"
                        title="Switch to a flat searchable list"
                    >
                        Open list view
                    </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                        <Switch
                            checked={showArchived}
                            onCheckedChange={setShowArchived}
                            aria-label="Show archived groups"
                        />
                        Show archived
                    </label>
                    <Separator orientation="vertical" className="h-6" />
                    <span className="text-sm text-muted-foreground">
                        {selectedCount} selected
                    </span>
                    {selectedCount > 0 && (
                        <Button variant="ghost" size="sm" onClick={clearSelection}>
                            Clear
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCreateDialog({ open: true, parent: null, name: "" })}
                    >
                        <Plus className="mr-1 h-4 w-4" />
                        New group
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleImportClick}
                    >
                        <Upload className="mr-1 h-4 w-4" />
                        Import ZIP
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setInputSourceOpen(true)}
                        title="Configure run-time input source"
                    >
                        <Globe className="mr-1 h-4 w-4" />
                        Input source
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWebhookOpen(true)}
                        title="Configure result webhook"
                    >
                        <Webhook className="mr-1 h-4 w-4" />
                        Webhook
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={selectedCount === 0}
                        onClick={() => setBatchOpen(true)}
                    >
                        <Play className="mr-1 h-4 w-4" />
                        Run selected
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={selectedCount === 0}
                        onClick={() => setBatchRenameOpen(true)}
                        title="Rename every selected group with a shared transform"
                    >
                        <Pencil className="mr-1 h-4 w-4" />
                        Rename selected
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        disabled={selectedCount === 0}
                        onClick={() => setBatchDeleteOpen(true)}
                        title="Delete every selected group (cascades to children + steps)"
                    >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Delete selected
                    </Button>
                    <Button
                        size="sm"
                        disabled={selectedCount === 0}
                        onClick={() => handleExport()}
                    >
                        <Download className="mr-1 h-4 w-4" />
                        Export selected
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".zip,application/zip"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file !== undefined) {
                                handleImportFile(file);
                                e.target.value = "";
                            }
                        }}
                    />
                </div>
            </header>

            <Separator />

            <BundleExchangePanel
                selectedCount={selectedCount}
                onExport={(includeDescendants) => handleExport(undefined, includeDescendants)}
                onImportFile={handleImportFile}
                lastExport={lastExport}
                lastImport={lastImport}
                disabled={lib.Lib === null || lib.Project === null || lib.SqlJs === null}
            />

            {/* ---------- Two-pane body ---------- */}
            <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
                {/* ---- Left: tree ---- */}
                <Card className="flex min-h-[400px] flex-col overflow-hidden">
                    <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-sm font-medium text-muted-foreground">
                        <span>Groups</span>
                        {trimmedQuery !== "" && (
                            <span className="text-xs font-normal">
                                {filteredTree.length === 0
                                    ? "No matches"
                                    : `Filtered by “${query.trim()}”`}
                            </span>
                        )}
                    </div>
                    {/* Search field — filters by name (descendants included so
                        a deeply-nested match still surfaces its parents). */}
                    <div className="border-b px-3 py-2">
                        <div className="relative">
                            <Search
                                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search groups by name…"
                                aria-label="Search step groups"
                                className="h-8 pl-7 pr-7 text-sm"
                            />
                            {query !== "" && (
                                <button
                                    type="button"
                                    onClick={() => setQuery("")}
                                    aria-label="Clear search"
                                    className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                    <ScrollArea className="flex-1">
                        {tree.length === 0 ? (
                            <EmptyTreeState
                                onCreate={() => setCreateDialog({ open: true, parent: null, name: "" })}
                                onImport={handleImportClick}
                            />
                        ) : filteredTree.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
                                <Search className="h-8 w-8 text-muted-foreground/40" />
                                <p>No groups match “{query.trim()}”.</p>
                                <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                                    Clear search
                                </Button>
                            </div>
                        ) : (
                            <ul className="py-2">
                                {filteredTree.map((node, idx) => (
                                    <TreeNodeRow
                                        key={node.Group.StepGroupId}
                                        node={node}
                                        depth={0}
                                        siblingIndex={idx}
                                        siblingCount={filteredTree.length}
                                        selected={selected}
                                        expanded={effectiveExpanded}
                                        activeGroupId={activeGroupId}
                                        hoveredId={hoveredId}
                                        onHover={setHoveredId}
                                        onToggleSelect={toggleOne}
                                        onToggleSubtree={toggleSubtree}
                                        onToggleExpanded={toggleExpanded}
                                        onActivate={setActiveGroupId}
                                        onCreateChild={(parentId) =>
                                            setCreateDialog({ open: true, parent: parentId, name: "" })
                                        }
                                        onRename={(g) =>
                                            setRenameDialog({ open: true, group: g, name: g.Name })
                                        }
                                        onDelete={(g) =>
                                            setDeleteDialog({ open: true, group: g })
                                        }
                                        onExportThis={(id) => handleExport([id])}
                                        onMove={handleMove}
                                        onArchiveToggle={handleArchiveToggle}
                                        onApplyInputs={(g) => setInputsDialog({ open: true, group: g })}
                                        onImportCsvInputs={(g) => setCsvDialog({ open: true, group: g })}
                                        hasInputs={(gid) => lib.GroupInputs.has(gid)}
                                        onDropReorder={handleDropReorder}
                                    />
                                ))}
                            </ul>
                        )}
                    </ScrollArea>
                </Card>

                {/* ---- Right: step preview ---- */}
                <Card className="flex min-h-[400px] flex-col overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="truncate text-sm font-medium text-muted-foreground">
                                {activeGroup === null
                                    ? "Select a group to preview its steps"
                                    : `${activeGroup.Name} — ${activeSteps.length} step(s)`}
                            </div>
                            {activeGroup !== null && lib.GroupInputs.has(activeGroup.StepGroupId) && (
                                <span
                                    className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
                                    title={`${Object.keys(lib.GroupInputs.get(activeGroup.StepGroupId) ?? {}).length} input variable(s) bound`}
                                >
                                    Inputs bound
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {activeGroup?.Description != null && activeGroup.Description !== "" && (
                                <div className="hidden max-w-[40ch] truncate text-xs text-muted-foreground sm:block">
                                    {activeGroup.Description}
                                </div>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={activeGroup === null}
                                onClick={() => activeGroup !== null && setInputsDialog({ open: true, group: activeGroup })}
                                title={activeGroup === null ? "Select a group first" : "Apply input data to this group"}
                            >
                                <FileJson className="mr-1 h-4 w-4" />
                                JSON
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={activeGroup === null}
                                onClick={() => activeGroup !== null && setCsvDialog({ open: true, group: activeGroup })}
                                title={activeGroup === null ? "Select a group first" : "Import CSV input for this group"}
                            >
                                <FileSpreadsheet className="mr-1 h-4 w-4" />
                                CSV
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={activeGroup === null}
                                onClick={() => activeGroup !== null && setStepEditor({
                                    open: true,
                                    mode: { Kind: "create", StepGroupId: activeGroup.StepGroupId },
                                })}
                                title={activeGroup === null ? "Select a group first" : "Add a new step to this group"}
                            >
                                <Plus className="mr-1 h-4 w-4" />
                                Add step
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={activeGroup === null || activeSteps.length === 0}
                                onClick={() => activeGroup !== null && setRunGroupDialog({ open: true, group: activeGroup })}
                                title={
                                    activeGroup === null
                                        ? "Select a group first"
                                        : activeSteps.length === 0
                                            ? "Group has no steps to run"
                                            : "Execute this group and view its trace + failure reason"
                                }
                            >
                                <Play className="mr-1 h-4 w-4" />
                                Run group
                            </Button>
                        </div>
                    </div>
                    <ScrollArea className="flex-1">
                        {activeGroup === null ? (
                            <div className="flex h-full items-center justify-center px-4 py-12 text-sm text-muted-foreground">
                                Click a group on the left to see its steps.
                            </div>
                        ) : activeSteps.length === 0 ? (
                            <div className="flex h-full items-center justify-center px-4 py-12 text-sm text-muted-foreground">
                                This group has no steps yet.
                            </div>
                        ) : (
                            <ol className="divide-y">
                                {activeSteps.map((s, idx) => {
                                    const wait = stepWaits.get(s.StepId);
                                    const waitLabel = wait === undefined ? null : `Wait · ${wait.Condition}`;
                                    const waitTitle = wait === undefined
                                        ? null
                                        : `Wait for ${wait.Kind} "${wait.Selector}" to ${wait.Condition} (${wait.TimeoutMs} ms)`;
                                    return (
                                        <StepRowItem
                                            key={s.StepId}
                                            step={s}
                                            index={idx}
                                            total={activeSteps.length}
                                            stepGroupId={activeGroup!.StepGroupId}
                                            waitLabel={waitLabel}
                                            waitTitle={waitTitle}
                                            onMove={handleStepMove}
                                            onDropReorder={handleStepDropReorder}
                                            onToggleDisabled={(step, nextDisabled) => {
                                                lib.setStepDisabled(step.StepId, nextDisabled);
                                                toast.success(
                                                    nextDisabled
                                                        ? `Step "${step.Label ?? step.StepId}" disabled — will be skipped on run`
                                                        : `Step "${step.Label ?? step.StepId}" enabled`,
                                                );
                                            }}
                                            onEdit={(step) => setStepEditor({ open: true, mode: { Kind: "edit", Step: step } })}
                                            onEditWait={(step) => setWaitDialog({ open: true, stepId: step.StepId, stepLabel: step.Label })}
                                            onDelete={(step) => setDeleteStepDialog({ open: true, step })}
                                        />
                                    );
                                })}
                            </ol>
                        )}
                    </ScrollArea>
                </Card>
            </div>

            {/* ---------- Create dialog ---------- */}
            <Dialog
                open={createDialog.open}
                onOpenChange={(open) => setCreateDialog((p) => ({ ...p, open }))}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {createDialog.parent === null
                                ? "Create top-level group"
                                : "Create child group"}
                        </DialogTitle>
                        <DialogDescription>
                            Groups bundle related steps and can nest up to 8 levels deep.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="new-group-name">Name</Label>
                        <Input
                            id="new-group-name"
                            value={createDialog.name}
                            maxLength={120}
                            placeholder="e.g. Checkout flow"
                            onChange={(e) => setCreateDialog((p) => ({ ...p, name: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => setCreateDialog({ open: false, parent: null, name: "" })}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleCreate}>
                            <FilePlus2 className="mr-1 h-4 w-4" /> Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ---------- Rename dialog ---------- */}
            <Dialog
                open={renameDialog.open}
                onOpenChange={(open) => setRenameDialog((p) => ({ ...p, open }))}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename group</DialogTitle>
                        <DialogDescription>
                            Sibling group names must be unique within the same parent.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="rename-group-name">New name</Label>
                        <Input
                            id="rename-group-name"
                            value={renameDialog.name}
                            maxLength={120}
                            onChange={(e) => setRenameDialog((p) => ({ ...p, name: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => setRenameDialog({ open: false, group: null, name: "" })}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleRename}>Rename</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ---------- Delete confirmation ---------- */}
            <AlertDialog
                open={deleteDialog.open}
                onOpenChange={(open) => setDeleteDialog((p) => ({ ...p, open }))}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete “{deleteDialog.group?.Name}”?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This permanently removes the group and every nested
                            group + step inside it. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <BatchRenameDialog
                open={batchRenameOpen}
                onOpenChange={setBatchRenameOpen}
                targets={selectedGroups}
                allGroups={lib.Groups}
                onApply={handleBatchRenameApply}
            />
            <BatchDeleteDialog
                open={batchDeleteOpen}
                onOpenChange={setBatchDeleteOpen}
                rows={deletePreview}
                onConfirm={handleBatchDeleteConfirm}
            />

            <BatchRunDialog
                open={batchOpen}
                onOpenChange={setBatchOpen}
                db={lib.Lib}
                projectId={lib.Project?.ProjectId ?? null}
                initialOrder={selectionOrder}
                groupsById={groupsById}
                groupInputs={lib.GroupInputs}
                onApplyMergedInput={(gid, bag) => lib.setGroupInput(gid, bag)}
            />

            <RunGroupDialog
                open={runGroupDialog.open}
                onOpenChange={(o) => setRunGroupDialog((p) => ({ ...p, open: o }))}
                db={lib.Lib}
                projectId={lib.Project?.ProjectId ?? null}
                group={runGroupDialog.group}
                groupName={(id) => groupsById.get(id)?.Name ?? `Group #${id}`}
            />

            <WebhookSettingsDialog
                open={webhookOpen}
                onOpenChange={setWebhookOpen}
            />

            <InputSourceDialog
                open={inputSourceOpen}
                onOpenChange={setInputSourceOpen}
            />

            <StepWaitDialog
                open={waitDialog.open}
                onOpenChange={(o) => setWaitDialog((p) => ({ ...p, open: o }))}
                stepId={waitDialog.stepId}
                stepLabel={waitDialog.stepLabel}
                onChange={refreshStepWaits}
            />

            <ImportErrorDialog
                open={importApi.errorState.Open}
                onOpenChange={importApi.setErrorOpen}
                explanation={importApi.errorState.Explanation}
                fileName={importApi.errorState.FileName}
            />
            <ImportSummaryDialog
                open={importApi.summaryState.Open}
                onOpenChange={importApi.setSummaryOpen}
                summary={importApi.summaryState.Summary}
                fileName={importApi.summaryState.FileName}
            />

            <ExportPreviewDialog
                open={exportPreview.Open}
                onOpenChange={(o) =>
                    setExportPreview((p) => (o ? { ...p, Open: true } : { Open: false, Preview: null, Pending: null }))
                }
                preview={exportPreview.Preview}
                includeDescendants={exportPreview.Pending?.IncludeDescendants ?? true}
                onConfirm={() => void confirmExport()}
            />

            <ExportErrorDialog
                open={exportError.Open}
                onOpenChange={(o) =>
                    setExportError((p) => (o ? { ...p, Open: true } : { Open: false, Explanation: null }))
                }
                explanation={exportError.Explanation}
            />

            <GroupInputsDialog
                open={inputsDialog.open}
                groupName={inputsDialog.group?.Name ?? null}
                groupId={inputsDialog.group?.StepGroupId ?? null}
                currentBag={inputsDialog.group === null
                    ? null
                    : (lib.GroupInputs.get(inputsDialog.group.StepGroupId) ?? null)}
                onOpenChange={(o) => setInputsDialog((p) => ({ ...p, open: o }))}
                onApply={(gid, bag) => lib.setGroupInput(gid, bag)}
                onClear={(gid) => lib.clearGroupInput(gid)}
            />

            <CsvInputDialog
                open={csvDialog.open}
                groupName={csvDialog.group?.Name ?? null}
                groupId={csvDialog.group?.StepGroupId ?? null}
                onOpenChange={(o) => setCsvDialog((p) => ({ ...p, open: o }))}
                onApply={(gid, bag) => lib.setGroupInput(gid, bag)}
            />

            {/* ---------- Step editor (add / edit) ---------- */}
            <StepEditorDialog
                open={stepEditor.open}
                mode={stepEditor.mode}
                groups={lib.Groups}
                onCancel={() => setStepEditor({ open: false, mode: null })}
                onSubmit={handleStepEditorSubmit}
            />

            {/* ---------- Step delete confirmation ---------- */}
            <AlertDialog
                open={deleteStepDialog.open}
                onOpenChange={(open) => setDeleteStepDialog((p) => ({ ...p, open }))}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this step?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteStepDialog.step === null
                                ? "No step selected."
                                : `“${deleteStepDialog.step.Label ?? `Step #${deleteStepDialog.step.StepId}`}” will be removed from this group. This cannot be undone.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setDeleteStepDialog({ open: false, step: null })}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleStepDeleteConfirm}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete step
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Tree row                                                           */
/* ------------------------------------------------------------------ */

interface TreeNodeRowProps {
    readonly node: TreeNode;
    readonly depth: number;
    readonly siblingIndex: number;
    readonly siblingCount: number;
    readonly selected: ReadonlySet<number>;
    readonly expanded: ReadonlySet<number>;
    readonly activeGroupId: number | null;
    readonly hoveredId: number | null;
    readonly onHover: (id: number | null) => void;
    readonly onToggleSelect: (id: number, on: boolean) => void;
    readonly onToggleSubtree: (node: TreeNode, on: boolean) => void;
    readonly onToggleExpanded: (id: number) => void;
    readonly onActivate: (id: number) => void;
    readonly onCreateChild: (parentId: number) => void;
    readonly onRename: (g: StepGroupRow) => void;
    readonly onDelete: (g: StepGroupRow) => void;
    readonly onExportThis: (id: number) => void;
    readonly onMove: (id: number, direction: "up" | "down") => void;
    readonly onArchiveToggle: (g: StepGroupRow) => void;
    readonly onApplyInputs: (g: StepGroupRow) => void;
    readonly onImportCsvInputs: (g: StepGroupRow) => void;
    readonly hasInputs: (id: number) => boolean;
    readonly onDropReorder: (parentId: number | null, sourceId: number, targetId: number) => void;
}

const DRAG_MIME = "application/x-marco-step-group";
const STEP_DRAG_MIME = "application/x-marco-step";

/* ------------------------------------------------------------------ */
/*  Step row (right-pane, draggable)                                   */
/* ------------------------------------------------------------------ */

interface StepRowItemProps {
    readonly step: StepRow;
    readonly index: number;
    readonly total: number;
    readonly stepGroupId: number;
    readonly waitLabel: string | null;
    readonly waitTitle: string | null;
    readonly onMove: (stepId: number, direction: "up" | "down") => void;
    readonly onDropReorder: (stepGroupId: number, sourceStepId: number, targetStepId: number) => void;
    readonly onToggleDisabled: (step: StepRow, nextDisabled: boolean) => void;
    readonly onEdit: (step: StepRow) => void;
    readonly onEditWait: (step: StepRow) => void;
    readonly onDelete: (step: StepRow) => void;
}

function StepRowItem(props: StepRowItemProps): JSX.Element {
    const {
        step: s, index: idx, total, stepGroupId, waitLabel, waitTitle,
        onMove, onDropReorder, onToggleDisabled, onEdit, onEditWait, onDelete,
    } = props;
    const isDisabled = s.IsDisabled;
    const [dragOver, setDragOver] = useState(false);
    const [dragging, setDragging] = useState(false);

    const handleDragStart = (e: React.DragEvent<HTMLLIElement>): void => {
        // Encode source step id + owning group so the drop target can
        // reject cross-group drops (cross-group step moves require
        // renumbering both groups — out of scope for the basic DnD).
        e.dataTransfer.setData(STEP_DRAG_MIME, JSON.stringify({ stepId: s.StepId, stepGroupId }));
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
    };

    const handleDragEnd = (): void => setDragging(false);

    const handleDragOver = (e: React.DragEvent<HTMLLIElement>): void => {
        const types = Array.from(e.dataTransfer.types);
        if (!types.includes(STEP_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!dragOver) setDragOver(true);
    };

    const handleDragLeave = (): void => {
        if (dragOver) setDragOver(false);
    };

    const handleDrop = (e: React.DragEvent<HTMLLIElement>): void => {
        e.preventDefault();
        setDragOver(false);
        const raw = e.dataTransfer.getData(STEP_DRAG_MIME);
        if (raw === "") return;
        try {
            const payload = JSON.parse(raw) as { stepId: number; stepGroupId: number };
            // Reject cross-group drops at the UI level — the runner has
            // no concept of "move a step into another group" yet.
            if (payload.stepGroupId !== stepGroupId) return;
            if (payload.stepId === s.StepId) return;
            onDropReorder(stepGroupId, payload.stepId, s.StepId);
        } catch (caught) {
            logError("StepGroupLibraryPanel.handleDropReorder.step", "Malformed drag payload — DataTransfer JSON.parse failed", caught);
        }
    };

    return (
        <li
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={[
                "flex items-start gap-3 px-4 py-3 transition-all",
                isDisabled ? "opacity-50" : "",
                dragging ? "opacity-30" : "",
                dragOver ? "bg-primary/10 outline outline-2 outline-primary" : "",
            ].join(" ").trim()}
        >
            <span
                className="mt-0.5 inline-flex h-6 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
                title="Drag to reorder"
                aria-hidden="true"
            >
                <GripVertical className="h-4 w-4" />
            </span>
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {stepKindLabel(s.StepKindId)}
                    </span>
                    <span className={`truncate text-sm font-medium ${isDisabled ? "line-through" : ""}`}>
                        {s.Label ?? "(no label)"}
                    </span>
                    {isDisabled && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Skipped
                        </span>
                    )}
                    {waitLabel !== null && (
                        <span
                            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                            title={waitTitle ?? undefined}
                        >
                            {waitLabel}
                        </span>
                    )}
                </div>
                {s.StepKindId === StepKindId.RunGroup && s.TargetStepGroupId !== null && (
                    <p className="mt-1 text-xs text-muted-foreground">
                        Invokes group #{s.TargetStepGroupId}
                    </p>
                )}
                {s.PayloadJson !== null && s.PayloadJson !== "" && (
                    <pre className="mt-1 overflow-x-auto rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                        {s.PayloadJson}
                    </pre>
                )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === 0}
                    onClick={() => onMove(s.StepId, "up")}
                    title={idx === 0 ? "Already at the top" : "Move step up"}
                    aria-label="Move step up"
                >
                    <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === total - 1}
                    onClick={() => onMove(s.StepId, "down")}
                    title={idx === total - 1 ? "Already at the bottom" : "Move step down"}
                    aria-label="Move step down"
                >
                    <ArrowDown className="h-4 w-4" />
                </Button>
                <Switch
                    checked={!isDisabled}
                    onCheckedChange={(checked) => onToggleDisabled(s, !checked)}
                    aria-label={isDisabled ? "Enable step" : "Disable step"}
                    title={isDisabled
                        ? "Disabled — runner will skip this step"
                        : "Enabled — runner will execute this step"}
                />
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onEdit(s)}
                    title="Edit step"
                    aria-label="Edit step"
                >
                    <Pencil className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onEditWait(s)}
                    title={waitLabel === null ? "Add wait condition" : "Edit wait condition"}
                >
                    <Timer className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => onDelete(s)}
                    title="Delete step"
                    aria-label="Delete step"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </li>
    );
}

function TreeNodeRow(props: TreeNodeRowProps) {
    const {
        node, depth, siblingIndex, siblingCount,
        selected, expanded, activeGroupId, hoveredId, onHover,
        onToggleSelect, onToggleSubtree, onToggleExpanded,
        onActivate, onCreateChild, onRename, onDelete, onExportThis,
        onMove, onArchiveToggle, onApplyInputs, onImportCsvInputs, hasInputs, onDropReorder,
    } = props;
    const id = node.Group.StepGroupId;
    const parentId = node.Group.ParentStepGroupId ?? null;
    const hasChildren = node.Children.length > 0;
    const isOpen = expanded.has(id);
    const isActive = activeGroupId === id;
    const isChecked = selected.has(id);
    const isArchived = node.Group.IsArchived;
    const isFirst = siblingIndex === 0;
    const isLast  = siblingIndex === siblingCount - 1;
    // Only the *exact* (innermost) row under the cursor lights up.
    // Ancestor rows whose `<li>` wraps the hovered child stay neutral.
    const isHovered = hoveredId === id;

    const [dragOver, setDragOver] = useState(false);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        // Encode source id + parent so the drop target can validate
        // sibling-only reorder without poking React state.
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ id, parentId }));
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        // Only accept drops from siblings of the SAME parent.
        const types = Array.from(e.dataTransfer.types);
        if (!types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!dragOver) setDragOver(true);
    };

    const handleDragLeave = () => {
        if (dragOver) setDragOver(false);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (raw === "") return;
        try {
            const payload = JSON.parse(raw) as { id: number; parentId: number | null };
            if (payload.parentId !== parentId) {
                // Cross-parent drag — ignored intentionally; see handleDropReorder doc.
                return;
            }
            if (payload.id === id) return;
            onDropReorder(parentId, payload.id, id);
        } catch (caught) {
            logError("StepGroupLibraryPanel.handleDropReorder.group", "Malformed drag payload — DataTransfer JSON.parse failed", caught);
        }
    };

    return (
        <li>
            <div
                draggable
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onMouseEnter={(e) => {
                    // stopPropagation keeps ancestor rows from re-claiming
                    // hover when the cursor moves inside one of their
                    // descendant rows — guarantees "exact" highlight.
                    e.stopPropagation();
                    onHover(id);
                }}
                onMouseLeave={(e) => {
                    e.stopPropagation();
                    // Only clear if we are still the active hover target.
                    // A racing enter on a sibling may have already moved
                    // the highlight elsewhere — don't clobber it.
                    if (hoveredId === id) onHover(null);
                }}
                data-hovered={isHovered ? "true" : undefined}
                className={[
                    "group relative flex items-center gap-1 rounded px-2 py-1.5 text-sm transition-colors",
                    isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
                    isHovered && !isActive ? "bg-accent/60 ring-1 ring-primary/50 shadow-sm" : "",
                    isHovered && isActive ? "ring-1 ring-primary/70 shadow-sm" : "",
                    isArchived ? "opacity-50" : "",
                    dragOver ? "ring-2 ring-primary/60" : "",
                ].join(" ")}
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
                {/* Left accent bar — appears only on the exact hovered row. */}
                {isHovered && (
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-1 left-0 w-1 rounded-r bg-primary"
                    />
                )}
                <GripVertical
                    className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/40 opacity-0 group-hover:opacity-100 active:cursor-grabbing"
                    aria-hidden="true"
                />
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={() => onToggleExpanded(id)}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                        aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                ) : (
                    <span className="h-5 w-5 shrink-0" />
                )}
                <Checkbox
                    checked={isChecked}
                    onCheckedChange={(v) => onToggleSelect(id, v === true)}
                    aria-label={`Select ${node.Group.Name}`}
                    className="shrink-0"
                />
                <button
                    type="button"
                    onClick={() => onActivate(id)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={node.Group.Name}
                >
                    {node.Group.Name}
                    {hasInputs(id) && (
                        <span
                            className="ml-2 inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
                            title="This group has input data bound"
                        >
                            <FileJson className="h-2.5 w-2.5" /> Inputs
                        </span>
                    )}
                    {isArchived && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Archived
                        </span>
                    )}
                </button>

                {/* Up / Down arrows — visible on hover, disabled at edges. */}
                <div className="flex items-center opacity-0 group-hover:opacity-100">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={isFirst}
                        onClick={() => onMove(id, "up")}
                        aria-label={`Move ${node.Group.Name} up`}
                    >
                        <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={isLast}
                        onClick={() => onMove(id, "down")}
                        aria-label={`Move ${node.Group.Name} down`}
                    >
                        <ChevronDownIcon className="h-3.5 w-3.5" />
                    </Button>
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                            aria-label={`Actions for ${node.Group.Name}`}
                        >
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onSelect={() => onCreateChild(id)}>
                            <Plus className="mr-2 h-4 w-4" /> New child group
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onRename(node.Group)}>
                            <Pencil className="mr-2 h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onMove(id, "up")} disabled={isFirst}>
                            <ChevronUp className="mr-2 h-4 w-4" /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onMove(id, "down")} disabled={isLast}>
                            <ChevronDownIcon className="mr-2 h-4 w-4" /> Move down
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onToggleSubtree(node, true)}>
                            Select with descendants
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onToggleSubtree(node, false)}>
                            Deselect with descendants
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onExportThis(id)}>
                            <Download className="mr-2 h-4 w-4" /> Export this group
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onApplyInputs(node.Group)}>
                            <FileJson className="mr-2 h-4 w-4" />
                            {hasInputs(id) ? "Edit input data…" : "Apply input data…"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onImportCsvInputs(node.Group)}>
                            <FileSpreadsheet className="mr-2 h-4 w-4" />
                            Import from CSV…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onArchiveToggle(node.Group)}>
                            {isArchived ? (
                                <><ArchiveRestore className="mr-2 h-4 w-4" /> Restore from archive</>
                            ) : (
                                <><Archive className="mr-2 h-4 w-4" /> Archive</>
                            )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onSelect={() => onDelete(node.Group)}
                            className="text-destructive focus:text-destructive"
                        >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {hasChildren && isOpen && (
                <ul>
                    {node.Children.map((child, idx) => (
                        <TreeNodeRow
                            key={child.Group.StepGroupId}
                            {...props}
                            node={child}
                            depth={depth + 1}
                            siblingIndex={idx}
                            siblingCount={node.Children.length}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyTreeState({ onCreate, onImport }: { onCreate: () => void; onImport?: () => void }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center text-sm text-muted-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <FolderTree className="h-7 w-7" />
            </div>
            <div className="space-y-1">
                <p className="font-medium text-foreground">No step groups yet</p>
                <p className="max-w-[34ch] text-xs">
                    Step groups bundle related actions you can replay later.
                    Create your first one or import a ZIP bundle from another
                    project.
                </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <Button size="sm" onClick={onCreate}>
                    <Plus className="mr-1 h-4 w-4" /> Create your first group
                </Button>
                {onImport !== undefined && (
                    <Button variant="outline" size="sm" onClick={onImport}>
                        <Upload className="mr-1 h-4 w-4" /> Import ZIP
                    </Button>
                )}
            </div>
        </div>
    );
}
