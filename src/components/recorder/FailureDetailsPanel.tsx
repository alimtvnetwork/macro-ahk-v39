/**
 * Marco Extension — Failure Details Panel
 *
 * Pure presentational view of a {@link FailureReport}, designed to live
 * inside the drift / selector-comparison flow so the user (and any AI they
 * paste this into) can see the full diagnostic surface at a glance:
 *
 *   - Top-level `Reason` short-code + `ReasonDetail` sentence.
 *   - `ResolvedXPath` actually evaluated against the live DOM.
 *   - Every `SelectorAttempt` with strategy, expression, resolved
 *     expression, primary flag, match outcome, and per-attempt
 *     `FailureReason` + `FailureDetail`.
 *   - Every `VariableContext` with name, source, row/column, resolved
 *     value, type, and per-variable `FailureReason` + `FailureDetail`.
 *
 * Conformance: mem://standards/verbose-logging-and-failure-diagnostics —
 * "Display the full failure details (selector/XPath, reason, and variable
 *  diagnostics) in the drift/comparison UI when a selector fails."
 *
 * Pure: no DOM mutation, no chrome.*, no async. Renders whatever the
 * caller passes; absent fields collapse silently.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    AlertOctagon,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Crosshair,
    FileWarning,
    Variable,
} from "lucide-react";
import type {
    FailureReport,
    FailureReasonCode,
    SelectorAttempt,
} from "@/background/recorder/failure-logger";
import type { VariableContext } from "@/background/recorder/field-reference-resolver";
import { FormSnapshotTable } from "./FormSnapshotTable";

interface FailureDetailsPanelProps {
    readonly report: FailureReport;
    /** Hide the outer Card chrome — useful when embedding inside another card. */
    readonly embedded?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Reason classification                                              */
/* ------------------------------------------------------------------ */

type ReasonGroup = "variable" | "selector" | "syntax" | "timeout" | "other";

const REASON_GROUP: Readonly<Record<FailureReasonCode, ReasonGroup>> = {
    VariableMissing:        "variable",
    VariableNull:           "variable",
    VariableUndefined:      "variable",
    VariableEmpty:          "variable",
    VariableTypeMismatch:   "variable",
    ZeroMatches:            "selector",
    PrimaryMissedFallbackOk:"selector",
    NoSelectors:            "selector",
    XPathSyntaxError:       "syntax",
    CssSyntaxError:         "syntax",
    UnresolvedAnchor:       "syntax",
    EmptyExpression:        "syntax",
    Timeout:                "timeout",
    ConditionTimeout:       "timeout",
    JsThrew:                "other",
    Unknown:                "other",
};

const GROUP_TONE: Readonly<Record<ReasonGroup, string>> = {
    variable: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    selector: "border-destructive/40 bg-destructive/10 text-destructive",
    syntax:   "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    timeout:  "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    other:    "border-border bg-muted/40 text-foreground",
};

const GROUP_LABEL: Readonly<Record<ReasonGroup, string>> = {
    variable: "Variable failure",
    selector: "Selector failure",
    syntax:   "Selector syntax error",
    timeout:  "Timeout",
    other:    "Failure",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function FailureDetailsPanel({ report, embedded }: FailureDetailsPanelProps) {
    const group = REASON_GROUP[report.Reason] ?? "other";
    const targetXPath = report.DomContext?.XPath ?? null;
    const body = (
        <div className="space-y-3">
            <ReasonBanner
                reason={report.Reason}
                detail={report.ReasonDetail}
                phase={report.Phase}
                group={group}
                verbose={report.Verbose}
            />
            {report.ResolvedXPath !== null && (
                <ResolvedXPathRow label="Resolved XPath" xpath={report.ResolvedXPath} />
            )}
            {targetXPath !== null && targetXPath.length > 0 && targetXPath !== report.ResolvedXPath && (
                <ResolvedXPathRow label="Target XPath" xpath={targetXPath} />
            )}
            {report.Selectors.length > 0 && <SelectorAttemptsBlock attempts={report.Selectors} />}
            {report.Variables.length > 0 && <VariablesBlock variables={report.Variables} />}
            {report.FormSnapshot !== null && (
                <FormSnapshotTable snapshot={report.FormSnapshot} title="Form data at failure" />
            )}
            {report.Verbose && report.CapturedHtml !== null && (
                <CapturedHtmlBlock html={report.CapturedHtml} />
            )}
            <SourceFooter file={report.SourceFile} timestamp={report.Timestamp} stepId={report.StepId} stepKind={report.StepKind} />
        </div>
    );

    if (embedded === true) {
        return (
            <section
                aria-label="Failure details"
                data-testid="failure-details-panel"
                className="rounded-md border border-border bg-card/40 p-3"
            >
                {body}
            </section>
        );
    }

    return (
        <Card data-testid="failure-details-panel">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <FileWarning className="h-4 w-4 text-destructive" />
                    Failure details
                    <Badge variant="outline" className="ml-1 text-[10px]">
                        {report.Phase}
                    </Badge>
                </CardTitle>
            </CardHeader>
            <CardContent>{body}</CardContent>
        </Card>
    );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ReasonBanner({
    reason,
    detail,
    phase,
    group,
    verbose,
}: {
    readonly reason: FailureReasonCode;
    readonly detail: string;
    readonly phase: string;
    readonly group: ReasonGroup;
    readonly verbose: boolean;
}) {
    return (
        <div
            role="alert"
            data-testid="failure-reason-banner"
            data-reason={reason}
            data-group={group}
            data-verbose={verbose}
            className={`rounded-md border px-3 py-2 text-xs ${GROUP_TONE[group]}`}
        >
            <div className="flex items-center gap-2 flex-wrap">
                <AlertOctagon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="font-semibold uppercase tracking-wide">{GROUP_LABEL[group]}</span>
                <Badge variant="outline" className="text-[10px] font-mono">
                    {reason}
                </Badge>
                {verbose && (
                    <Badge
                        variant="default"
                        className="text-[10px]"
                        title="Verbose logging was ON when this report was captured"
                    >
                        VERBOSE
                    </Badge>
                )}
                <span className="ml-auto text-[10px] opacity-70">{phase}</span>
            </div>
            <p className="mt-1 break-words whitespace-pre-wrap">{detail}</p>
        </div>
    );
}

function ResolvedXPathRow({ label, xpath }: { readonly label: string; readonly xpath: string }) {
    return (
        <div
            data-testid="failure-resolved-xpath"
            data-label={label}
            className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
        >
            <div className="flex items-center gap-2 text-muted-foreground">
                <Crosshair className="h-3 w-3" aria-hidden />
                <span className="uppercase tracking-wide font-medium">{label}</span>
            </div>
            <code className="mt-1 block break-all font-mono text-foreground">{xpath}</code>
        </div>
    );
}

function CapturedHtmlBlock({ html }: { readonly html: string }) {
    return (
        <section
            data-testid="failure-captured-html"
            className="rounded-md border border-border bg-muted/30 p-2.5 text-xs space-y-1.5"
        >
            <header className="flex items-center gap-2 text-muted-foreground">
                <FileWarning className="h-3 w-3" aria-hidden />
                <span className="uppercase tracking-wide font-medium">Captured HTML (verbose)</span>
                <Badge variant="outline" className="ml-auto text-[10px]">
                    {html.length.toLocaleString()} chars
                </Badge>
            </header>
            <ScrollArea className="max-h-48">
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
                    {html}
                </pre>
            </ScrollArea>
        </section>
    );
}

function SelectorAttemptsBlock({ attempts }: { attempts: ReadonlyArray<SelectorAttempt> }) {
    return (
        <section data-testid="failure-selector-attempts" className="space-y-1.5">
            <header className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Crosshair className="h-3 w-3" aria-hidden />
                Selector attempts
                <Badge variant="secondary" className="text-[10px]">{attempts.length}</Badge>
            </header>
            <ScrollArea className="max-h-56 pr-2">
                <ul className="space-y-1.5">
                    {attempts.map((a, i) => (
                        <SelectorAttemptRow key={`${a.SelectorId ?? "noid"}-${i}`} attempt={a} />
                    ))}
                </ul>
            </ScrollArea>
        </section>
    );
}

function SelectorAttemptRow({ attempt }: { attempt: SelectorAttempt }) {
    const Icon = attempt.Matched ? CheckCircle2 : XCircle;
    const tone = attempt.Matched ? "text-emerald-500" : "text-destructive";
    const border = attempt.IsPrimary
        ? attempt.Matched ? "border-emerald-500/40" : "border-destructive/40"
        : "border-border";
    const expr = attempt.ResolvedExpression.length > 0
        ? attempt.ResolvedExpression
        : attempt.Expression;
    const showResolvedDistinct =
        attempt.ResolvedExpression !== attempt.Expression && attempt.Expression.length > 0;

    return (
        <li
            data-testid="failure-attempt-row"
            data-matched={attempt.Matched}
            data-primary={attempt.IsPrimary}
            className={`rounded-md border ${border} bg-card p-2 text-xs space-y-1`}
        >
            <div className="flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden />
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{attempt.Strategy}</Badge>
                {attempt.IsPrimary && (
                    <Badge variant="default" className="text-[10px] px-1.5 py-0">PRIMARY</Badge>
                )}
                <code className="text-muted-foreground truncate" title={expr}>
                    {expr}
                </code>
                <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
                    {attempt.MatchCount} match{attempt.MatchCount === 1 ? "" : "es"}
                </Badge>
            </div>
            {showResolvedDistinct && (
                <div className="pl-5 text-[11px] text-muted-foreground">
                    Stored: <code className="break-all">{attempt.Expression}</code>
                </div>
            )}
            {!attempt.Matched && (
                <div className="pl-5 text-[11px] text-destructive flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
                    <span>
                        <span className="font-mono">{attempt.FailureReason}</span>
                        {attempt.FailureDetail !== null && (
                            <> — <span className="break-words">{attempt.FailureDetail}</span></>
                        )}
                    </span>
                </div>
            )}
        </li>
    );
}

function VariablesBlock({ variables }: { variables: ReadonlyArray<VariableContext> }) {
    const failed = variables.filter((v) => v.FailureReason !== "Resolved");
    return (
        <section data-testid="failure-variables" className="space-y-1.5">
            <header className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Variable className="h-3 w-3" aria-hidden />
                Variables
                <Badge variant="secondary" className="text-[10px]">{variables.length}</Badge>
                {failed.length > 0 && (
                    <Badge variant="destructive" className="text-[10px]">{failed.length} failed</Badge>
                )}
            </header>
            <ul className="space-y-1.5">
                {variables.map((v, i) => (
                    <VariableRow key={`${v.Name}-${i}`} variable={v} />
                ))}
            </ul>
        </section>
    );
}

function VariableRow({ variable }: { variable: VariableContext }) {
    const ok = variable.FailureReason === "Resolved";
    const Icon = ok ? CheckCircle2 : XCircle;
    const tone = ok ? "text-emerald-500" : "text-destructive";
    const border = ok ? "border-border" : "border-destructive/40";
    const valueLabel = variable.ResolvedValue === null
        ? "<null>"
        : JSON.stringify(variable.ResolvedValue);

    return (
        <li
            data-testid="failure-variable-row"
            data-resolved={ok}
            className={`rounded-md border ${border} bg-card p-2 text-xs space-y-1`}
        >
            <div className="flex items-center gap-2 flex-wrap">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden />
                <code className="font-mono text-foreground">{`{{${variable.Name}}}`}</code>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{variable.ValueType}</Badge>
                <span className="text-muted-foreground text-[11px]">from {variable.Source}</span>
                {variable.RowIndex !== null && (
                    <span className="text-muted-foreground text-[11px]">
                        · row {variable.RowIndex}
                    </span>
                )}
                {variable.Column !== null && variable.Column !== variable.Name && (
                    <span className="text-muted-foreground text-[11px]">· col {variable.Column}</span>
                )}
            </div>
            <div className="pl-5 text-[11px]">
                <span className="text-muted-foreground">Value: </span>
                <code className="break-all text-foreground">{valueLabel}</code>
            </div>
            {!ok && (
                <div className="pl-5 text-[11px] text-destructive flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
                    <span>
                        <span className="font-mono">{variable.FailureReason}</span>
                        {variable.FailureDetail !== null && (
                            <> — <span className="break-words">{variable.FailureDetail}</span></>
                        )}
                    </span>
                </div>
            )}
        </li>
    );
}

function SourceFooter({
    file,
    timestamp,
    stepId,
    stepKind,
}: {
    readonly file: string;
    readonly timestamp: string;
    readonly stepId: number | null;
    readonly stepKind: string | null;
}) {
    return (
        <footer
            data-testid="failure-source-footer"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[10px] text-muted-foreground border-t border-border"
        >
            <span>at <code className="font-mono">{file}</code></span>
            {stepId !== null && <span>StepId={stepId}</span>}
            {stepKind !== null && <span>Kind={stepKind}</span>}
            <span className="ml-auto font-mono">{timestamp}</span>
        </footer>
    );
}
