/**
 * Marco Extension — Step Editor Dialog
 *
 * Add/Edit form for a single Step inside a StepGroup. Used by the
 * Step Group Library panel's right-hand step preview.
 *
 * Modes:
 *   - "create": appended to the end of the parent group via
 *     `useStepLibrary.appendStep`. Returns focus on save.
 *   - "edit":  patches an existing step in place via
 *     `useStepLibrary.updateStep` (preserves OrderIndex).
 *
 * The form keeps the (StepKindId, TargetStepGroupId) invariant the
 * DB enforces: RunGroup steps require a target group; every other
 * kind hides the target picker.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import type { StepGroupRow, StepRow } from "@/background/recorder/step-library/db";
import { StepKindId } from "@/background/recorder/step-library/schema";
import { stepKindLabel } from "@/hooks/use-step-library";
import { HotkeyChordCapture } from "@/components/recorder/HotkeyChordCapture";

/* ------------------------------------------------------------------ */
/*  Public surface                                                     */
/* ------------------------------------------------------------------ */

export type StepEditorMode =
    | { Kind: "create"; StepGroupId: number }
    | { Kind: "edit"; Step: StepRow };

export interface StepEditorDialogProps {
    readonly open: boolean;
    readonly mode: StepEditorMode | null;
    readonly groups: ReadonlyArray<StepGroupRow>;
    readonly onCancel: () => void;
    readonly onSubmit: (input: {
        StepKindId: StepKindId;
        Label: string | null;
        PayloadJson: string | null;
        TargetStepGroupId: number | null;
    }) => void;
}

/* ------------------------------------------------------------------ */
/*  Available kinds (RunGroup is conditional — see below)              */
/* ------------------------------------------------------------------ */

const KIND_OPTIONS: ReadonlyArray<StepKindId> = [
    StepKindId.Click,
    StepKindId.Type,
    StepKindId.Select,
    StepKindId.JsInline,
    StepKindId.Wait,
    StepKindId.RunGroup,
    StepKindId.Hotkey,
    StepKindId.UrlTabClick,
];

/**
 * Heuristic placeholder for the payload textarea so the user knows
 * what shape the runner expects. Mirrors the bridge translator in
 * `replay-bridge.ts` (Selector / Value / WaitMs).
 */
function payloadPlaceholderFor(kind: StepKindId): string {
    switch (kind) {
        case StepKindId.Click:
            return '{ "Selector": "#submit-button" }';
        case StepKindId.Type:
            return '{ "Selector": "#email", "Value": "user@example.com" }';
        case StepKindId.Select:
            return '{ "Selector": "#country", "Value": "US" }';
        case StepKindId.JsInline:
            return '{ "Script": "document.title = \\"hi\\";" }';
        case StepKindId.Wait:
            return '{ "WaitMs": 1000 }';
        case StepKindId.RunGroup:
            return "(payload not used — pick a target group below)";
        case StepKindId.Hotkey:
            return '{ "Keys": ["Ctrl+S","Tab","Enter"], "WaitMs": 500 }';
        case StepKindId.UrlTabClick:
            return "(use the URL tab click form below)";
        default:
            return "{ }";
    }
}

/* ------------------------------------------------------------------ */
/*  UrlTabClick form state                                             */
/* ------------------------------------------------------------------ */

type UrlMatchDialect = "Exact" | "Prefix" | "Glob" | "Regex";
type UrlTabClickMode = "OpenNew" | "FocusExisting" | "OpenOrFocus";
type SelectorKindOption = "Auto" | "XPath" | "Css";

interface UrlTabClickFormState {
    UrlPattern: string;
    UrlMatch: UrlMatchDialect;
    Mode: UrlTabClickMode;
    Selector: string;
    SelectorKind: SelectorKindOption;
    TimeoutMs: string;
    DirectOpen: boolean;
    Url: string;
}

const URL_TAB_CLICK_DEFAULTS: UrlTabClickFormState = {
    UrlPattern: "",
    UrlMatch: "Glob",
    Mode: "OpenOrFocus",
    Selector: "",
    SelectorKind: "Auto",
    TimeoutMs: "",
    DirectOpen: false,
    Url: "",
};

function hydrateUrlTabClickForm(payloadJson: string | null): UrlTabClickFormState {
    if (payloadJson === null || payloadJson === "") return { ...URL_TAB_CLICK_DEFAULTS };
    try {
        const p = JSON.parse(payloadJson) as Partial<Record<keyof UrlTabClickFormState, unknown>>;
        return {
            UrlPattern:   typeof p.UrlPattern === "string" ? p.UrlPattern : "",
            UrlMatch:     (p.UrlMatch === "Exact" || p.UrlMatch === "Prefix" || p.UrlMatch === "Glob" || p.UrlMatch === "Regex") ? p.UrlMatch : "Glob",
            Mode:         (p.Mode === "OpenNew" || p.Mode === "FocusExisting" || p.Mode === "OpenOrFocus") ? p.Mode : "OpenOrFocus",
            Selector:     typeof p.Selector === "string" ? p.Selector : "",
            SelectorKind: (p.SelectorKind === "XPath" || p.SelectorKind === "Css" || p.SelectorKind === "Auto") ? p.SelectorKind : "Auto",
            TimeoutMs:    typeof p.TimeoutMs === "number" ? String(p.TimeoutMs) : "",
            DirectOpen:   p.DirectOpen === true,
            Url:          typeof p.Url === "string" ? p.Url : "",
        };
    } catch {
        return { ...URL_TAB_CLICK_DEFAULTS };
    }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StepEditorDialog(props: StepEditorDialogProps): JSX.Element {
    const { open, mode, groups, onCancel, onSubmit } = props;

    const [kind, setKind] = useState<StepKindId>(StepKindId.Click);
    const [label, setLabel] = useState("");
    const [payloadJson, setPayloadJson] = useState("");
    const [targetGroupId, setTargetGroupId] = useState<number | null>(null);
    /** Hotkey-specific state. The chord list + waitMs are serialised
     *  into PayloadJson on submit; when editing an existing Hotkey we
     *  hydrate from the stored PayloadJson on open. */
    const [hotkeyChords, setHotkeyChords] = useState<readonly string[]>([]);
    const [hotkeyWaitMs, setHotkeyWaitMs] = useState<string>("");
    /** UrlTabClick-specific structured form. Serialised into PayloadJson
     *  on submit and hydrated from PayloadJson when editing. */
    const [urlTabClick, setUrlTabClick] = useState<UrlTabClickFormState>(URL_TAB_CLICK_DEFAULTS);
    const patchUrlTabClick = (patch: Partial<UrlTabClickFormState>): void =>
        setUrlTabClick((prev) => ({ ...prev, ...patch }));

    // Reset form whenever the dialog (re-)opens with a new mode.
    useEffect(() => {
        if (!open || mode === null) return;
        if (mode.Kind === "create") {
            setKind(StepKindId.Click);
            setLabel("");
            setPayloadJson("");
            setTargetGroupId(null);
            setHotkeyChords([]);
            setHotkeyWaitMs("");
        } else {
            setKind(mode.Step.StepKindId);
            setLabel(mode.Step.Label ?? "");
            setPayloadJson(mode.Step.PayloadJson ?? "");
            setTargetGroupId(mode.Step.TargetStepGroupId);
            // Hydrate hotkey form from PayloadJson when editing.
            if (mode.Step.StepKindId === StepKindId.Hotkey && mode.Step.PayloadJson !== null) {
                try {
                    const parsed = JSON.parse(mode.Step.PayloadJson) as { Keys?: unknown; WaitMs?: unknown };
                    setHotkeyChords(Array.isArray(parsed.Keys) ? parsed.Keys.filter((k): k is string => typeof k === "string") : []);
                    setHotkeyWaitMs(typeof parsed.WaitMs === "number" ? String(parsed.WaitMs) : "");
                } catch {
                    setHotkeyChords([]);
                    setHotkeyWaitMs("");
                }
            } else {
                setHotkeyChords([]);
                setHotkeyWaitMs("");
            }
        }
    }, [open, mode]);

    /**
     * Forbid self-reference and (lightly) descendant-loops at the UI
     * level by hiding the current group and its descendants from the
     * target picker. Cycle detection still ultimately lives in the
     * runner, but blocking the obvious case here keeps the form sane.
     */
    const targetCandidates = useMemo(() => {
        if (mode === null) return groups;
        const ownerId = mode.Kind === "create"
            ? mode.StepGroupId
            : mode.Step.StepGroupId;
        // Compute descendant set of `ownerId` (BFS over ParentStepGroupId).
        const descendants = new Set<number>([ownerId]);
        let grew = true;
        while (grew) {
            grew = false;
            for (const g of groups) {
                if (
                    g.ParentStepGroupId !== null &&
                    descendants.has(g.ParentStepGroupId) &&
                    !descendants.has(g.StepGroupId)
                ) {
                    descendants.add(g.StepGroupId);
                    grew = true;
                }
            }
        }
        return groups.filter((g) => !descendants.has(g.StepGroupId) && !g.IsArchived);
    }, [groups, mode]);

    const handleSubmit = (): void => {
        // Hotkey kind has its own structured form — synthesise the
        // PayloadJson from the captured chord list + WaitMs.
        if (kind === StepKindId.Hotkey) {
            if (hotkeyChords.length === 0) {
                toast.error("Add at least one key combination for the Hotkey step.");
                return;
            }
            const waitTrim = hotkeyWaitMs.trim();
            const waitMs = waitTrim === "" ? undefined : Number(waitTrim);
            if (waitMs !== undefined && (!Number.isFinite(waitMs) || waitMs < 0)) {
                toast.error("Wait (ms) must be a non-negative number.");
                return;
            }
            const payload = waitMs === undefined
                ? { Keys: [...hotkeyChords] }
                : { Keys: [...hotkeyChords], WaitMs: waitMs };
            onSubmit({
                StepKindId: kind,
                Label: label.trim() === "" ? null : label.trim(),
                PayloadJson: JSON.stringify(payload),
                TargetStepGroupId: null,
            });
            return;
        }
        // Light JSON validation when a payload was provided. We allow
        // a blank payload (some kinds don't need one), but reject
        // obvious typos before they round-trip through the DB.
        const trimmedPayload = payloadJson.trim();
        if (trimmedPayload !== "" && kind !== StepKindId.RunGroup) {
            try {
                JSON.parse(trimmedPayload);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                toast.error("Payload is not valid JSON", { description: msg });
                return;
            }
        }
        if (kind === StepKindId.RunGroup && targetGroupId === null) {
            toast.error("Select a target group for the RunGroup step.");
            return;
        }
        onSubmit({
            StepKindId: kind,
            Label: label.trim() === "" ? null : label.trim(),
            PayloadJson: trimmedPayload === "" ? null : trimmedPayload,
            TargetStepGroupId: kind === StepKindId.RunGroup ? targetGroupId : null,
        });
    };

    const isEdit = mode?.Kind === "edit";

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => { if (!o) onCancel(); }}
        >
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "Edit step" : "Add step"}</DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "Change the kind, label, or payload. Order is preserved — use the up/down buttons to move the step."
                            : "Append a new step to the end of this group."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="step-kind">Kind</Label>
                        <Select
                            value={String(kind)}
                            onValueChange={(v) => {
                                const next = Number(v) as StepKindId;
                                setKind(next);
                                // Clear target when leaving RunGroup so
                                // the DB invariant (target=null) holds.
                                if (next !== StepKindId.RunGroup) setTargetGroupId(null);
                            }}
                        >
                            <SelectTrigger id="step-kind">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {KIND_OPTIONS.map((k) => (
                                    <SelectItem key={k} value={String(k)}>
                                        {stepKindLabel(k)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="step-label">Label</Label>
                        <Input
                            id="step-label"
                            value={label}
                            maxLength={200}
                            placeholder="Optional human-readable name"
                            onChange={(e) => setLabel(e.target.value)}
                        />
                    </div>

                    {kind === StepKindId.RunGroup ? (
                        <div className="space-y-1">
                            <Label htmlFor="step-target">Target group</Label>
                            <Select
                                value={targetGroupId === null ? "" : String(targetGroupId)}
                                onValueChange={(v) => setTargetGroupId(v === "" ? null : Number(v))}
                            >
                                <SelectTrigger id="step-target">
                                    <SelectValue placeholder="Select a group to invoke" />
                                </SelectTrigger>
                                <SelectContent>
                                    {targetCandidates.length === 0 ? (
                                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                            No eligible groups (a RunGroup step cannot reference its
                                            own group or descendants).
                                        </div>
                                    ) : targetCandidates.map((g) => (
                                        <SelectItem key={g.StepGroupId} value={String(g.StepGroupId)}>
                                            {g.Name} (#{g.StepGroupId})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    ) : kind === StepKindId.Hotkey ? (
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <Label htmlFor="hotkey-capture">Key combinations</Label>
                                <HotkeyChordCapture
                                    id="hotkey-capture"
                                    value={hotkeyChords}
                                    onChange={setHotkeyChords}
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Each chord is dispatched in order during playback (AutoHotkey-style).
                                    Backspace removes the last chord; Esc stops listening.
                                </p>
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="hotkey-wait">Wait after (ms, optional)</Label>
                                <Input
                                    id="hotkey-wait"
                                    type="number"
                                    min={0}
                                    value={hotkeyWaitMs}
                                    placeholder="e.g. 500"
                                    onChange={(e) => setHotkeyWaitMs(e.target.value)}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <Label htmlFor="step-payload">Payload JSON</Label>
                            <Textarea
                                id="step-payload"
                                value={payloadJson}
                                rows={6}
                                spellCheck={false}
                                placeholder={payloadPlaceholderFor(kind)}
                                onChange={(e) => setPayloadJson(e.target.value)}
                                className="font-mono text-xs"
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Leave blank when the kind doesn't need a payload. The runner
                                expects PascalCase keys (Selector, Value, WaitMs, …).
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                    <Button onClick={handleSubmit}>
                        {isEdit
                            ? <><Save className="mr-1 h-4 w-4" /> Save</>
                            : <><Plus className="mr-1 h-4 w-4" /> Add step</>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
