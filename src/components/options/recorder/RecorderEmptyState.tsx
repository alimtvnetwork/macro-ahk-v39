/**
 * Marco Extension — Recorder Empty State
 *
 * Rendered inside RecorderVisualisationPanel when the active project has
 * zero captured steps. Surfaces the most common root causes with a quick
 * remediation action for each so users aren't stuck staring at a blank tab.
 */

import { AlertCircle, CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CauseStatus = "ok" | "warn" | "error";

export interface RecorderEmptyStateProps {
    readonly projectSlug: string;
    readonly hasDbError: boolean;
    readonly onReload: () => void;
}

interface CauseRow {
    readonly title: string;
    readonly detail: string;
    readonly status: CauseStatus;
    readonly action?: { label: string; onClick: () => void };
}

export function RecorderEmptyState({
    projectSlug,
    hasDbError,
    onReload,
}: RecorderEmptyStateProps): JSX.Element {
    const projectMissing = projectSlug.trim().length === 0;

    const causes: ReadonlyArray<CauseRow> = [
        {
            title: "Project selected",
            detail: projectMissing
                ? "No ProjectSlug is active. Steps cannot be saved without a project."
                : `Active project: ${projectSlug}`,
            status: projectMissing ? "error" : "ok",
        },
        {
            title: "Recorder database initialized",
            detail: hasDbError
                ? "The recorder DB failed to load. Reload to re-initialize the SQLite store."
                : "Recorder DB responded successfully.",
            status: hasDbError ? "error" : "ok",
            action: hasDbError
                ? { label: "Reload data", onClick: onReload }
                : undefined,
        },
        {
            title: "Recording session is active",
            detail:
                "Open any tab and click Start on the floating Marco toolbar (top-right). " +
                "Keyboard: Ctrl+Alt+P resume · Ctrl+Alt+; pause · Ctrl+Alt+. stop.",
            status: "warn",
        },
    ];

    return (
        <div className="border border-border rounded-md bg-card/50 p-6 space-y-4">
            <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                    <h3 className="text-sm font-semibold">No steps recorded yet</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        This project has no captured steps. The most likely causes are listed below.
                    </p>
                </div>
            </div>

            <ul className="space-y-2">
                {causes.map((c) => (
                    <li
                        key={c.title}
                        className="flex items-start gap-3 p-3 rounded-md border border-border/60 bg-background/40"
                    >
                        <CauseIcon status={c.status} />
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium">{c.title}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{c.detail}</div>
                        </div>
                        {c.action !== undefined && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1.5 shrink-0"
                                onClick={c.action.onClick}
                            >
                                <RefreshCw className="h-3 w-3" />
                                {c.action.label}
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function CauseIcon({ status }: { status: CauseStatus }): JSX.Element {
    if (status === "ok") {
        return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
    }
    if (status === "error") {
        return <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />;
    }
    return <Circle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
}
