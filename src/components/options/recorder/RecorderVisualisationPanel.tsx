/**
 * Marco Extension — Recorder Visualisation Panel (Phase 10)
 *
 * Project-scoped tab that visualises persisted Macro Recorder data:
 *   - Step graph (left rail) — ordered list of `Step` rows
 *   - Detail panel (right) — selectors, field binding, variable rename
 *   - Data Source summary chips
 *
 * All data flows through `useRecorderProjectData(projectSlug)` which calls
 * the existing `RECORDER_STEP_LIST`, `RECORDER_DATA_SOURCE_LIST`, and
 * `RECORDER_FIELD_BINDING_LIST` background handlers (Phases 07-09).
 *
 * @see spec/31-macro-recorder/10-project-visualisation.md
 */

import { useCallback, useEffect, useState } from "react";
import {
    useRecorderProjectData,
    type SelectorRow,
} from "@/hooks/use-recorder-project-data";
import { sendMessage } from "@/lib/message-client";
import { RecorderStepGraph } from "./RecorderStepGraph";
import { RecorderStepDetail } from "./RecorderStepDetail";
import { RecorderEmptyState } from "./RecorderEmptyState";
import { downloadRecorderExport, type ExportFormat } from "./recorder-export";
import { runRecorderSelfTest, RecorderSelfTestError } from "./recorder-self-test";
import { Loader2, Database, Download, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { logError } from "../options-logger";

interface Props {
    projectSlug: string;
}

export default function RecorderVisualisationPanel({ projectSlug }: Props) {
    const {
        data,
        loading,
        error,
        reload,
        loadSelectors,
        tagsByStep,
        updateStepMeta,
        setStepTags,
        setStepLink,
    } = useRecorderProjectData(projectSlug);
    const [selectedStepId, setSelectedStepId] = useState<number | null>(null);
    const [selectors, setSelectors] = useState<ReadonlyArray<SelectorRow>>([]);
    const [selectorsLoading, setSelectorsLoading] = useState(false);
    const [selfTestRunning, setSelfTestRunning] = useState(false);

    const handleSelfTest = useCallback(async () => {
        setSelfTestRunning(true);
        try {
            const result = await runRecorderSelfTest(projectSlug);
            await reload();
            toast.success(
                `Self-test passed — wrote StepId ${result.InsertedStepId}, verified, cleaned up (${result.DurationMs}ms)`,
            );
        } catch (err) {
            const phase = err instanceof RecorderSelfTestError ? err.Phase : "unknown";
            const msg = err instanceof Error ? err.message : "Self-test failed";
            toast.error(`Recorder self-test failed (${phase}): ${msg}`);
            logError(
                "RecorderVisualisationPanel.selfTest",
                `runRecorderSelfTest failed at phase='${phase}' for project='${projectSlug}': ${msg}`,
                err,
            );
        } finally {
            setSelfTestRunning(false);
        }
    }, [projectSlug, reload]);

    /* Auto-select the first Step when data loads / refreshes. */
    useEffect(() => {
        if (data === null || data.steps.length === 0) {
            setSelectedStepId(null);
            return;
        }
        const stillExists = data.steps.some((s) => s.StepId === selectedStepId);
        if (!stillExists) {
            setSelectedStepId(data.steps[0].StepId);
        }
    }, [data, selectedStepId]);

    /* Refetch selectors whenever the active step changes. */
    useEffect(() => {
        if (selectedStepId === null) {
            setSelectors([]);
            return;
        }
        let cancelled = false;
        setSelectorsLoading(true);
        loadSelectors(selectedStepId)
            .then((rows) => {
                if (!cancelled) setSelectors(rows);
            })
            .finally(() => {
                if (!cancelled) setSelectorsLoading(false);
            });
        return () => { cancelled = true; };
    }, [selectedStepId, loadSelectors]);

    const handleRename = useCallback(
        async (stepId: number, newName: string) => {
            try {
                await sendMessage({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    type: "RECORDER_STEP_RENAME" as any,
                    projectSlug,
                    stepId,
                    newVariableName: newName,
                });
                toast.success(`Renamed step #${stepId} → ${newName}`);
                await reload();
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to rename step";
                toast.error(msg);
                logError(
                    "RecorderVisualisationPanel.rename",
                    `RECORDER_STEP_RENAME failed for project='${projectSlug}' stepId=${stepId} newName='${newName}': ${msg}`,
                    err,
                );
                throw err;
            }
        },
        [projectSlug, reload],
    );

    const handleDelete = useCallback(
        async (stepId: number) => {
            const confirmed = confirm(`Delete step #${stepId}? This cannot be undone.`);
            if (!confirmed) return;
            try {
                await sendMessage({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    type: "RECORDER_STEP_DELETE" as any,
                    projectSlug,
                    stepId,
                });
                toast.success("Step deleted");
                await reload();
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to delete step";
                toast.error(msg);
                logError(
                    "RecorderVisualisationPanel.delete",
                    `RECORDER_STEP_DELETE failed for project='${projectSlug}' stepId=${stepId}: ${msg}`,
                    err,
                );
            }
        },
        [projectSlug, reload],
    );

    /* -------- Phase 14 — meta / tags / link refreshers --------------- */

    const handleDescriptionSave = useCallback(
        async (stepId: number, description: string | null) => {
            try {
                await updateStepMeta(stepId, { Description: description });
                toast.success("Description updated");
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to update description";
                toast.error(msg);
                logError(
                    "RecorderVisualisationPanel.description",
                    `updateStepMeta(Description) failed for project='${projectSlug}' stepId=${stepId}: ${msg}`,
                    err,
                );
                throw err;
            }
        },
        [projectSlug, updateStepMeta],
    );

    const handleTagsSave = useCallback(
        async (stepId: number, tags: ReadonlyArray<string>) => {
            try {
                await setStepTags(stepId, tags);
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to update tags";
                toast.error(msg);
                logError(
                    "RecorderVisualisationPanel.tags",
                    `setStepTags failed for project='${projectSlug}' stepId=${stepId} tags=[${tags.join(",")}]: ${msg}`,
                    err,
                );
                throw err;
            }
        },
        [projectSlug, setStepTags],
    );

    const handleLinkChange = useCallback(
        async (
            stepId: number,
            slot: "OnSuccessProjectId" | "OnFailureProjectId",
            targetProjectSlug: string | null,
        ) => {
            try {
                await setStepLink(stepId, slot, targetProjectSlug);
                toast.success(
                    targetProjectSlug === null
                        ? `${slot} cleared`
                        : `${slot} → ${targetProjectSlug}`,
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to update link";
                toast.error(msg);
                logError(
                    "RecorderVisualisationPanel.link",
                    `setStepLink(${slot}=${targetProjectSlug ?? "null"}) failed for project='${projectSlug}' stepId=${stepId}: ${msg}`,
                    err,
                );
                throw err;
            }
        },
        [projectSlug, setStepLink],
    );

    /* Forward load failures into the global Error Drawer (once per error). */
    useEffect(() => {
        if (error === null) { return; }
        logError(
            "RecorderVisualisationPanel.load",
            `useRecorderProjectData failed for project='${projectSlug}': ${error}`,
        );
    }, [error, projectSlug]);

    const handleExport = useCallback(
        (format: ExportFormat) => {
            if (data === null) { return; }
            if (data.steps.length === 0) {
                toast.error("Nothing to export — no steps recorded yet.");
                return;
            }
            try {
                downloadRecorderExport({ projectSlug, data, tagsByStep }, format);
                toast.success(`Exported ${data.steps.length} step(s) as ${format.toUpperCase()}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Export failed";
                toast.error(msg);
                logError(
                    "RecorderVisualisationPanel.export",
                    `downloadRecorderExport(format='${format}') failed for project='${projectSlug}' steps=${data.steps.length}: ${msg}`,
                    err,
                );
            }
        },
        [data, projectSlug, tagsByStep],
    );
    if (loading) {
        return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading recorder data…
            </div>
        );
    }
    if (error) {
        return (
            <div className="space-y-3">
                <div className="text-xs text-destructive p-3 border border-destructive/40 rounded-md bg-destructive/5 font-mono">
                    {error}
                </div>
                <RecorderEmptyState
                    projectSlug={projectSlug}
                    hasDbError={true}
                    onReload={() => { void reload(); }}
                />
            </div>
        );
    }
    if (data === null) return null;

    const selectedStep = data.steps.find((s) => s.StepId === selectedStepId) ?? null;

    return (
        <div className="space-y-4">
            {/* Header: data sources summary + export */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Data Sources:
                </span>
                {data.dataSources.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">none attached</span>
                ) : (
                    data.dataSources.map((ds) => (
                        <Badge key={ds.DataSourceId} variant="outline" className="gap-1.5 font-mono text-[10px]">
                            <Database className="h-3 w-3" />
                            {ds.FilePath} · {ds.RowCount}r × {ds.Columns.length}c
                        </Badge>
                    ))
                )}
                <div className="ml-auto flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => { void handleSelfTest(); }}
                        disabled={selfTestRunning}
                        title="Insert a dummy step, verify it appears, and clean it up. Failures land in the Error Drawer."
                    >
                        {selfTestRunning ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <FlaskConical className="h-3.5 w-3.5" />
                        )}
                        Run self-test
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5"
                                disabled={data.steps.length === 0}
                                title={
                                    data.steps.length === 0
                                        ? "Record at least one step before exporting"
                                        : `Export ${data.steps.length} step(s)`
                                }
                            >
                                <Download className="h-3.5 w-3.5" />
                                Export
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleExport("json")}>
                                Download as JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExport("csv")}>
                                Download as CSV
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Two-column layout — or empty-state when no steps recorded */}
            {data.steps.length === 0 ? (
                <RecorderEmptyState
                    projectSlug={projectSlug}
                    hasDbError={false}
                    onReload={() => { void reload(); }}
                />
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,1fr)_2fr] gap-4">
                    <div className="space-y-2">
                        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            Steps ({data.steps.length})
                        </h3>
                        <RecorderStepGraph
                            steps={data.steps}
                            selectedStepId={selectedStepId}
                            onSelect={setSelectedStepId}
                            onDelete={handleDelete}
                        />
                    </div>
                    <div className="border border-border rounded-md bg-card/50 p-4">
                        {selectedStep === null ? (
                            <p className="text-xs text-muted-foreground italic">
                                Select a step from the list to inspect its selectors and binding.
                            </p>
                        ) : selectorsLoading ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading selectors…
                            </div>
                        ) : (
                            <RecorderStepDetail
                                step={selectedStep}
                                selectors={selectors}
                                dataSources={data.dataSources}
                                bindings={data.bindings}
                                tags={tagsByStep.get(selectedStep.StepId) ?? []}
                                onRename={handleRename}
                                onDescriptionSave={handleDescriptionSave}
                                onTagsSave={handleTagsSave}
                                onLinkChange={handleLinkChange}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
