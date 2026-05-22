/**
 * Marco Extension — Recorder Self-Test
 *
 * Inserts a dummy Step (Wait kind) via RECORDER_STEP_INSERT, lists steps to
 * verify the new row appears, then deletes it via RECORDER_STEP_DELETE so
 * the project is left clean.
 *
 * Throws SelfTestError with phase + reason on any failure so the caller can
 * surface it via toast + logError (Error Drawer).
 */

import { sendMessage } from "@/lib/message-client";
import { logError } from "../options-logger";

/** SelectorKindId.Css per src/background/recorder-db-schema.ts */
const SELECTOR_KIND_CSS = 3;
/** StepKindId.Wait — chosen because it requires no action params. */
const STEP_KIND_WAIT = 5;

export type SelfTestPhase = "insert" | "verify" | "cleanup";

export class RecorderSelfTestError extends Error {
    public readonly Phase: SelfTestPhase;
    public readonly ProjectSlug: string;
    public constructor(phase: SelfTestPhase, projectSlug: string, message: string) {
        super(message);
        this.name = "RecorderSelfTestError";
        this.Phase = phase;
        this.ProjectSlug = projectSlug;
    }
}

export interface SelfTestResult {
    readonly InsertedStepId: number;
    readonly VariableName: string;
    readonly StepCountBefore: number;
    readonly StepCountAfter: number;
    readonly DurationMs: number;
}

interface InsertResponse { isOk: true; step: { StepId: number } }
interface ListResponse  { steps: ReadonlyArray<{ StepId: number; VariableName: string }> }

export async function runRecorderSelfTest(projectSlug: string): Promise<SelfTestResult> {
    if (projectSlug.trim().length === 0) {
        throw new RecorderSelfTestError("insert", projectSlug, "ProjectSlug is empty — select a project first.");
    }

    const startedAt = Date.now();
    const variableName = `__selftest_${startedAt}`;

    const before = await listSteps(projectSlug, "insert");
    const insertedStepId = await insertDummyStep(projectSlug, variableName);

    try {
        const after = await listSteps(projectSlug, "verify");
        const found = after.find((s) => s.StepId === insertedStepId);
        if (found === undefined) {
            throw new RecorderSelfTestError(
                "verify",
                projectSlug,
                `Inserted StepId=${insertedStepId} not present in RECORDER_STEP_LIST after write.`,
            );
        }
        if (found.VariableName !== variableName) {
            throw new RecorderSelfTestError(
                "verify",
                projectSlug,
                `Round-trip mismatch — wrote VariableName='${variableName}', read '${found.VariableName}'.`,
            );
        }

        await deleteStep(projectSlug, insertedStepId);

        return {
            InsertedStepId: insertedStepId,
            VariableName: variableName,
            StepCountBefore: before.length,
            StepCountAfter: after.length,
            DurationMs: Date.now() - startedAt,
        };
    } catch (err) {
        // Best-effort cleanup; do not mask the original error.
        await deleteStep(projectSlug, insertedStepId).catch((cleanupErr: unknown) => {
            logError("recorderSelfTest.cleanup", `deleteStep failed for insertedStepId=${insertedStepId} during error-recovery cleanup — original error will still be rethrown`, cleanupErr);
            return undefined;
        });
        throw err;
    }
}

async function insertDummyStep(projectSlug: string, variableName: string): Promise<number> {
    try {
        const response = await sendMessage<InsertResponse>({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type: "RECORDER_STEP_INSERT" as any,
            projectSlug,
            draft: {
                StepKindId: STEP_KIND_WAIT,
                VariableName: variableName,
                Label: "Recorder self-test (auto-cleanup)",
                InlineJs: null,
                ParamsJson: null,
                IsBreakpoint: false,
                Selectors: [{
                    SelectorKindId: SELECTOR_KIND_CSS,
                    Expression: ".__marco_selftest__",
                    AnchorSelectorId: null,
                    IsPrimary: true,
                }],
            },
        });
        if (typeof response?.step?.StepId !== "number") {
            throw new Error("RECORDER_STEP_INSERT returned no StepId");
        }
        return response.step.StepId;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new RecorderSelfTestError("insert", projectSlug, msg);
    }
}

async function listSteps(projectSlug: string, phase: SelfTestPhase): Promise<ListResponse["steps"]> {
    try {
        const response = await sendMessage<ListResponse>({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type: "RECORDER_STEP_LIST" as any,
            projectSlug,
        });
        return response?.steps ?? [];
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new RecorderSelfTestError(phase, projectSlug, `RECORDER_STEP_LIST failed: ${msg}`);
    }
}

async function deleteStep(projectSlug: string, stepId: number): Promise<void> {
    try {
        await sendMessage({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type: "RECORDER_STEP_DELETE" as any,
            projectSlug,
            stepId,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new RecorderSelfTestError("cleanup", projectSlug, `RECORDER_STEP_DELETE(stepId=${stepId}) failed: ${msg}`);
    }
}
