/**
 * Marco Extension — Live-DOM Replay Executor
 *
 * Phase 09 — Macro Recorder.
 *
 * Consumes a list of persisted Steps + their selectors, locates each target
 * in the live DOM via {@link resolveStepSelector}, and dispatches a real
 * browser event (`click`, `input`, `change`, …) on it. This is the missing
 * caller side — the resolver is pure, and this module is the imperative
 * actuator.
 *
 * Pure event dispatch only — no chrome.* or messaging. Caller supplies the
 * Document and the binding/value lookup so the same code is unit-testable
 * under jsdom and shippable in the content script.
 *
 * @see ./replay-resolver.ts          — Pure selector resolution.
 * @see ./field-reference-resolver.ts — `{{Column}}` substitution for Type values.
 * @see spec/31-macro-recorder/12-record-replay-e2e-contract.md
 */

import { resolveStepSelector, type ResolvedSelector } from "./replay-resolver";
import {
    resolveFieldReferences,
    resolveFieldReferencesDetailed,
    type FieldRow,
    type VariableContext,
} from "./field-reference-resolver";
import type { PersistedSelector } from "./step-persistence";
import {
    saveReplayRun,
    type PersistedReplayRun,
    type ReplayStepResultDraft,
} from "./replay-run-persistence";
import {
    logFailure,
    type FailureReasonCode,
    type FailureReport,
} from "./failure-logger";
import { evaluateAllSelectors } from "./selector-attempt-evaluator";
import { resolveVerboseLogging } from "./verbose-logging";
import { waitForElement, type WaitForSpec } from "./wait-for-element";
import { readStepWait, type WaitConfig } from "./step-library/step-wait";
import {
    waitForCondition,
    type Condition,
    type ConditionWaitOutcome,
} from "./condition-evaluator";

const SOURCE_FILE = "src/background/recorder/live-dom-replay.ts";

export interface ReplayStepInput {
    readonly StepId: number;
    readonly Index: number;
    readonly Kind: "Click" | "Type" | "Select" | "Wait";
    readonly Selectors: ReadonlyArray<PersistedSelector>;
    /** For Type/Select — the literal value or a `{{Column}}` template. */
    readonly Value?: string;
    /** For Wait — milliseconds. */
    readonly WaitMs?: number;
    /**
     * Optional backend-controlled gate: after the action dispatches the
     * executor polls the live DOM until this selector resolves to an
     * `HTMLElement`, or fails the step on timeout. Applies to Click /
     * Type / Select only — Wait steps ignore it. See
     * {@link WaitForSpec} for the selector grammar.
     */
    readonly WaitFor?: WaitForSpec;
    /**
     * Spec-19 canonical pre-condition gate. When present, the executor
     * polls `Condition` against the live DOM **before** actuating the
     * step. On timeout:
     *   - `OnTimeout = "Fail"` → step fails with `ConditionTimeout`.
     *   - `OnTimeout = "Skip"` → step is skipped (no actuation, not a
     *     failure).
     */
    readonly Gate?: StepGate;
}

export interface StepGate {
    readonly Condition: Condition;
    readonly TimeoutMs: number;
    readonly PollMs?: number;
    readonly OnTimeout: "Fail" | "Skip";
}

export interface ReplayPersistOptions {
    /** Project slug whose per-project DB receives the run row. */
    readonly ProjectSlug: string;
    /** Optional free-text notes attached to the persisted ReplayRun. */
    readonly Notes?: string;
}

export interface ReplayOptions {
    readonly Doc: Document;
    /** Active data-source row used to resolve `{{Column}}` templates in Value. */
    readonly Row?: FieldRow;
    /** Sleep implementation — injected so tests can fast-forward. */
    readonly Sleep?: (ms: number) => Promise<void>;
    /** Wall-clock provider — injected so tests get deterministic timestamps. */
    readonly Now?: () => Date;
    /**
     * When provided, the run + per-step results are persisted to the project
     * DB after `executeReplay` finishes. Tests omit this to stay pure.
     */
    readonly Persist?: ReplayPersistOptions;
    /**
     * Verbose-logging override. When `undefined` (default), the replay
     * resolves the toggle via
     * `resolveVerboseLogging(Persist?.ProjectSlug)`. When set explicitly,
     * the value wins — used by tests and by callers who already know the
     * effective flag (e.g. settings preview). Per
     * `mem://standards/verbose-logging-and-failure-diagnostics`, default
     * remains OFF; callers must opt in.
     */
    readonly Verbose?: boolean;
}

export interface ReplayStepResult {
    readonly StepId: number;
    readonly Index: number;
    readonly Ok: boolean;
    readonly Error?: string;
    readonly ResolvedXPath?: string;
    readonly StartedAt: string;
    readonly FinishedAt: string;
    readonly DurationMs: number;
    /** Structured failure report — populated only when `Ok === false`. */
    readonly FailureReport?: FailureReport;
    /**
     * When `true`, the step was intentionally skipped because its
     * pre-condition gate timed out with `OnTimeout = "Skip"`. Not a
     * failure — `Ok` is also `true`.
     */
    readonly Skipped?: true;
}

export interface ReplayRunOutcome {
    readonly Results: ReadonlyArray<ReplayStepResult>;
    readonly StartedAt: string;
    readonly FinishedAt: string;
    /** Populated only when `options.Persist` was supplied and the save succeeded. */
    readonly PersistedRun: PersistedReplayRun | null;
}

export async function executeReplay(
    steps: ReadonlyArray<ReplayStepInput>,
    options: ReplayOptions,
): Promise<ReplayRunOutcome> {
    const sleep = options.Sleep ?? defaultSleep;
    const now = options.Now ?? defaultNow;
    const runStarted = now();

    const results: ReplayStepResult[] = [];
    for (const step of steps) {
        results.push(await executeStep(step, options, sleep, now));
    }

    const runFinished = now();
    const startedAt = toIso(runStarted);
    const finishedAt = toIso(runFinished);

    let persistedRun: PersistedReplayRun | null = null;
    if (options.Persist !== undefined) {
        persistedRun = await saveReplayRun(options.Persist.ProjectSlug, {
            StartedAt: startedAt,
            FinishedAt: finishedAt,
            Notes: options.Persist.Notes ?? "",
            StepResults: results.map(toStepResultDraft),
        });
    }

    return {
        Results: results,
        StartedAt: startedAt,
        FinishedAt: finishedAt,
        PersistedRun: persistedRun,
    };
}

async function executeStep(
    step: ReplayStepInput,
    options: ReplayOptions,
    sleep: (ms: number) => Promise<void>,
    now: () => Date,
): Promise<ReplayStepResult> {
    const startedAt = now();
    let target: HTMLElement | null = null;
    let resolvedXPath: string | undefined;
    let variables: ReadonlyArray<VariableContext> = [];
    try {
        if (step.Kind === "Wait") {
            await sleep(step.WaitMs ?? 0);
            return finalize(step, options, startedAt, now(), { Ok: true });
        }

        // Spec 19 §2 — pre-condition gate (checked before actuation).
        if (step.Gate !== undefined) {
            const gateOutcome = await waitForCondition(step.Gate.Condition, {
                Doc: options.Doc,
                TimeoutMs: step.Gate.TimeoutMs,
                PollMs: step.Gate.PollMs,
                Sleep: sleep,
                Now: () => now().getTime(),
            });
            if (!gateOutcome.Ok) {
                if (step.Gate.OnTimeout === "Skip") {
                    return finalize(step, options, startedAt, now(), {
                        Ok: true,
                        Skipped: true,
                        Error: new Error(
                            "Skipped: gate condition not met within " + step.Gate.TimeoutMs + "ms " +
                            "(polls=" + gateOutcome.Polls + ", elapsed=" + gateOutcome.DurationMs + "ms)",
                        ),
                    });
                }
                return finalize(step, options, startedAt, now(), {
                    Ok: false,
                    Reason: "ConditionTimeout",
                    ReasonDetail:
                        "Gate condition not met within " + step.Gate.TimeoutMs + "ms " +
                        "(polls=" + gateOutcome.Polls + ", elapsed=" + gateOutcome.DurationMs + "ms). " +
                        "Last evaluation: " + JSON.stringify(gateOutcome.LastEvaluation),
                    Error: new Error("Gate condition not met within " + step.Gate.TimeoutMs + "ms"),
                });
            }
        }

        // Resolve {{Token}} variables FIRST (per
        // mem://standards/verbose-logging-and-failure-diagnostics): the
        // detailed resolver returns one VariableContext per token with
        // Name + ResolvedValue + ValueType + FailureReason so we can fail
        // fast with a precise reason BEFORE the DOM lookup ever runs.
        if ((step.Kind === "Type" || step.Kind === "Select") && step.Value !== undefined && step.Value !== "") {
            const detailed = resolveFieldReferencesDetailed(step.Value, options.Row ?? {}, {
                Source: options.Row !== undefined ? "Row" : "NoActiveRow",
                ExpectedType: "string",
            });
            variables = detailed.Variables;
            if (detailed.FirstFailure !== null) {
                return finalize(step, options, startedAt, now(), {
                    Ok: false,
                    Variables: variables,
                    Error: new Error(detailed.FirstFailure.FailureDetail ?? `Variable {{${detailed.FirstFailure.Name}}} failed`),
                });
            }
        }

        const resolved = resolveStepSelector(step.Selectors);
        resolvedXPath = resolved.Expression;
        target = locateElement(resolved, options.Doc);
        if (target === null) {
            return finalize(step, options, startedAt, now(), {
                Ok: false,
                ResolvedXPath: resolved.Expression,
                Variables: variables,
                Error: new Error(`Element not found for selector '${resolved.Expression}'`),
            });
        }

        if (step.Kind === "Click")  { dispatchClick(target); }
        if (step.Kind === "Type")   { dispatchType(target,   resolveValue(step.Value, options.Row)); }
        if (step.Kind === "Select") { dispatchSelect(target, resolveValue(step.Value, options.Row)); }

        // Resolve the wait gate. Inline `step.WaitFor` (set programmatically
        // by tests / advanced callers) wins; otherwise fall back to the
        // per-step config persisted via the StepWaitDialog UI. Both feed
        // the same `waitForElement` helper.
        const effectiveWait: WaitForSpec | null =
            step.WaitFor !== undefined
                ? step.WaitFor
                : persistedWaitToSpec(readStepWait(step.StepId));
        if (effectiveWait !== null) {
            const waitOutcome = await waitForElement(effectiveWait, {
                Doc: options.Doc,
                Sleep: sleep,
                Now: () => now().getTime(),
            });
            if (!waitOutcome.Ok) {
                // Build a structured failure so the FailureDetailsPanel /
                // failure-toast UI surfaces the selector, kind, configured
                // timeout, and the actual elapsed time. The classification
                // is "Timeout" for the polling-budget exhaustion case and
                // "XPathSyntaxError" / "CssSyntaxError" for compile errors
                // — chosen so the existing ReasonBanner colours apply.
                const declaredKind = effectiveWait.Kind ?? "Auto";
                const resolvedKind: "XPath" | "Css" =
                    declaredKind === "XPath" ? "XPath"
                        : declaredKind === "Css" ? "Css"
                            : effectiveWait.Expression.trim().startsWith("/")
                                ? "XPath" : "Css";
                const reasonCode =
                    waitOutcome.Reason === "InvalidSelector"
                        ? (resolvedKind === "XPath" ? "XPathSyntaxError" : "CssSyntaxError")
                        : "Timeout";
                const reasonDetail =
                    waitOutcome.Reason === "Timeout"
                        ? `WaitFor selector '${effectiveWait.Expression}' (Kind=${resolvedKind}) ` +
                          `did not appear within ${effectiveWait.TimeoutMs} ms ` +
                          `(elapsed ${waitOutcome.DurationMs} ms).`
                        : `WaitFor selector '${effectiveWait.Expression}' (Kind=${resolvedKind}) ` +
                          `is invalid: ${waitOutcome.Detail}`;
                return finalize(step, options, startedAt, now(), {
                    Ok: false,
                    ResolvedXPath: resolved.Expression,
                    Variables: variables,
                    Target: target,
                    Reason: reasonCode,
                    ReasonDetail: reasonDetail,
                    Error: new Error(reasonDetail),
                });
            }
        }

        return finalize(step, options, startedAt, now(), { Ok: true, ResolvedXPath: resolved.Expression });
    } catch (err) {
        return finalize(step, options, startedAt, now(), {
            Ok: false,
            ResolvedXPath: resolvedXPath,
            Variables: variables,
            Error: err,
            Target: target,
        });
    }
}

function finalize(
    step: ReplayStepInput,
    options: ReplayOptions,
    started: Date,
    finished: Date,
    outcome: {
        Ok: boolean;
        Error?: unknown;
        ResolvedXPath?: string;
        Target?: HTMLElement | null;
        Variables?: ReadonlyArray<VariableContext>;
        /** Caller-supplied classification — overrides auto-derivation in `logFailure`. */
        Reason?: FailureReasonCode;
        ReasonDetail?: string;
        Skipped?: boolean;
    },
): ReplayStepResult {
    if (outcome.Ok) {
        return {
            StepId: step.StepId,
            Index: step.Index,
            Ok: true,
            Skipped: outcome.Skipped === true ? true : undefined,
            ResolvedXPath: outcome.ResolvedXPath,
            StartedAt: toIso(started),
            FinishedAt: toIso(finished),
            DurationMs: Math.max(0, finished.getTime() - started.getTime()),
        };
    }

    // Evaluate every persisted selector against the live DOM so the
    // failure log carries the full XPath/CSS expression that was tried,
    // its Matched outcome, MatchCount, and per-attempt FailureReason
    // (per mem://standards/verbose-logging-and-failure-diagnostics).
    // Wait steps have no selectors — skip evaluation.
    const evaluatedAttempts = step.Kind === "Wait"
        ? undefined
        : evaluateAllSelectors(step.Selectors, options.Doc);

    const verbose = options.Verbose !== undefined
        ? options.Verbose
        : resolveVerboseLogging(options.Persist?.ProjectSlug);

    const report = logFailure({
        Phase: "Replay",
        Error: outcome.Error,
        StepId: step.StepId,
        Index: step.Index,
        StepKind: step.Kind,
        Selectors: step.Selectors,
        EvaluatedAttempts: evaluatedAttempts,
        Target: outcome.Target ?? null,
        DataRow: options.Row,
        Variables: outcome.Variables,
        ResolvedXPath: outcome.ResolvedXPath,
        SourceFile: SOURCE_FILE,
        Reason: outcome.Reason,
        ReasonDetail: outcome.ReasonDetail,
        Verbose: verbose,
        Now: options.Now,
    });

    return {
        StepId: step.StepId,
        Index: step.Index,
        Ok: false,
        Error: report.Message,
        ResolvedXPath: outcome.ResolvedXPath,
        StartedAt: toIso(started),
        FinishedAt: toIso(finished),
        DurationMs: Math.max(0, finished.getTime() - started.getTime()),
        FailureReport: report,
    };
}

function toStepResultDraft(r: ReplayStepResult): ReplayStepResultDraft {
    // When a structured FailureReport exists, persist it as JSON so the
    // user can later copy the full diagnostic blob from the project DB.
    const errorMessage = r.FailureReport !== undefined
        ? JSON.stringify(r.FailureReport)
        : (r.Skipped === true ? (r.Error ?? "Skipped: gate condition not met") : (r.Error ?? null));
    return {
        StepId: r.StepId,
        OrderIndex: r.Index,
        IsOk: r.Ok || r.Skipped === true,
        ErrorMessage: errorMessage,
        ResolvedXPath: r.ResolvedXPath ?? null,
        StartedAt: r.StartedAt,
        FinishedAt: r.FinishedAt,
        DurationMs: r.DurationMs,
    };
}

function toIso(d: Date): string {
    // SQLite stores `datetime('now')` in 'YYYY-MM-DD HH:MM:SS'; ISO is fine here
    // because the column is TEXT and we read it back verbatim.
    return d.toISOString();
}

function defaultNow(): Date {
    return new Date();
}

function resolveValue(raw: string | undefined, row: FieldRow | undefined): string {
    if (raw === undefined || raw === "") { return ""; }
    if (row === undefined)               { return raw; }
    return resolveFieldReferences(raw, row);
}

/* ------------------------------------------------------------------ */
/*  DOM lookup                                                         */
/* ------------------------------------------------------------------ */

function locateElement(resolved: ResolvedSelector, doc: Document): HTMLElement | null {
    if (resolved.Kind === "XPath") {
        const r = doc.evaluate(resolved.Expression, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = r.singleNodeValue;
        return node instanceof HTMLElement ? node : null;
    }
    if (resolved.Kind === "Css") {
        const el = doc.querySelector(resolved.Expression);
        return el instanceof HTMLElement ? el : null;
    }
    // Aria — minimal support: `[aria-label="…"]`-style expressions are passed straight to querySelector
    const el = doc.querySelector(resolved.Expression);
    return el instanceof HTMLElement ? el : null;
}

/* ------------------------------------------------------------------ */
/*  Event dispatch                                                     */
/* ------------------------------------------------------------------ */

function dispatchClick(el: HTMLElement): void {
    el.focus({ preventScroll: true });
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true }));
}

function dispatchType(el: HTMLElement, value: string): void {
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter !== undefined) {
            setter.call(el, value);
        } else {
            el.value = value;
        }
    } else if (el.isContentEditable) {
        el.textContent = value;
    } else {
        return; // not typeable
    }
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

function dispatchSelect(el: HTMLElement, value: string): void {
    if (!(el instanceof HTMLSelectElement)) { return; }
    el.value = value;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Bridge `WaitConfig` (persisted via the StepWaitDialog UI) into the
 * inline `WaitForSpec` shape that `waitForElement` expects.
 *
 * `wait-for-element.ts` currently implements only the **Appears**
 * predicate (returns when the element is found in the DOM). The
 * `Disappears` and `Visible` modes from the dialog are accepted by the
 * storage layer but cannot be honoured here yet — for those, we still
 * resolve to `Appears` so the user gets *some* gating instead of silent
 * no-op, and we leave a console warning so the discrepancy is traceable.
 *
 * Returns `null` when there's no persisted config so the caller can
 * skip the wait branch entirely.
 */
function persistedWaitToSpec(cfg: WaitConfig | null): WaitForSpec | null {
    if (cfg === null) return null;
    if (cfg.Condition !== "Appears") {
        console.warn(
            `live-dom-replay: persisted wait condition '${cfg.Condition}' is ` +
            `not yet supported by waitForElement; falling back to 'Appears'.`,
        );
    }
    return {
        Expression: cfg.Selector,
        Kind: cfg.Kind === "XPath" ? "XPath" : "Css",
        TimeoutMs: cfg.TimeoutMs,
    };
}
