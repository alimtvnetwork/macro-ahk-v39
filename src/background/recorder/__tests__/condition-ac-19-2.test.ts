/**
 * Spec 19 §2.4 — AC-19.2.1 .. AC-19.2.7
 *
 * AC-tagged coverage for `waitForCondition`, `waitForElement`, and
 * `executeReplay` Gate behaviour. Each `it` name mirrors the AC id per
 * the test-writing convention recorded in `spec/31-macro-recorder/llm-guide.md` §11.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import {
    waitForCondition,
    type Condition,
} from "../condition-evaluator";
import { waitForElement } from "../wait-for-element";
import { executeReplay, type ReplayStepInput } from "../live-dom-replay";
import { SelectorKindId } from "../../recorder-db-schema";
import type { PersistedSelector } from "../step-persistence";

function cssSelector(stepId: number, expr: string): PersistedSelector[] {
    return [{
        SelectorId: stepId * 10,
        StepId: stepId,
        SelectorKindId: SelectorKindId.Css,
        Expression: expr,
        AnchorSelectorId: null,
        IsPrimary: 1,
    }];
}

describe("Spec 19 §2.4 — Appearance-Wait AC suite", () => {
    it("AC-19.2.1: Gate with Visible(sel) + OnTimeout=Fail polls before actuating", async () => {
        document.body.innerHTML = `<button id="go">Go</button>`;
        const btn = document.getElementById("go")!;

        // The gate waits for #target to become visible; we inject it after a tick.
        let injected = false;
        btn.addEventListener("click", () => {
            setTimeout(() => {
                document.body.insertAdjacentHTML(
                    "beforeend",
                    `<div id="target" style="display:block">Loaded</div>`,
                );
                injected = true;
            }, 0);
        });

        const steps: ReplayStepInput[] = [{
            StepId: 1, Index: 1, Kind: "Click",
            Selectors: cssSelector(1, "#go"),
            Gate: {
                Condition: { Selector: "#target", Matcher: { Kind: "Visible" } },
                TimeoutMs: 500,
                PollMs: 5,
                OnTimeout: "Fail",
            },
        }];

        const outcome = await executeReplay(steps, { Doc: document });
        expect(outcome.Results[0]!.Ok).toBe(true);
        expect(document.getElementById("target")).not.toBeNull();
    });

    it("AC-19.2.2: OnTimeout=Fail produces ConditionTimeout failure report with trace", async () => {
        document.body.innerHTML = `<button id="go">Go</button>`;

        const steps: ReplayStepInput[] = [{
            StepId: 2, Index: 1, Kind: "Click",
            Selectors: cssSelector(2, "#go"),
            Gate: {
                Condition: { Selector: "#never", Matcher: { Kind: "Exists" } },
                TimeoutMs: 30,
                PollMs: 5,
                OnTimeout: "Fail",
            },
        }];

        const outcome = await executeReplay(steps, { Doc: document });
        const r = outcome.Results[0]!;
        expect(r.Ok).toBe(false);
        expect(r.FailureReport).toBeDefined();
        expect(r.FailureReport!.Reason).toBe("ConditionTimeout");
        expect(r.FailureReport!.ReasonDetail).toContain("Gate condition not met");
        expect(r.FailureReport!.ReasonDetail).toContain("polls=");
    });

    it("AC-19.2.3: OnTimeout=Skip skips actuation and marks step Skipped", async () => {
        document.body.innerHTML = `<button id="go">Go</button>`;

        const steps: ReplayStepInput[] = [{
            StepId: 3, Index: 1, Kind: "Click",
            Selectors: cssSelector(3, "#go"),
            Gate: {
                Condition: { Selector: "#absent", Matcher: { Kind: "Exists" } },
                TimeoutMs: 20,
                PollMs: 5,
                OnTimeout: "Skip",
            },
        }];

        const outcome = await executeReplay(steps, { Doc: document });
        const r = outcome.Results[0]!;
        expect(r.Ok).toBe(true);
        expect(r.Skipped).toBe(true);
    });

    it("AC-19.2.4: Legacy WaitFor row is synthesised as Exists gate with no user-visible diff", async () => {
        // waitForElement synthesises an Exists condition internally.
        document.body.innerHTML = ``;
        const outcome = await waitForElement(
            { Expression: "#legacy", TimeoutMs: 50, PollMs: 10 },
            { Doc: document },
        );
        expect(outcome.Ok).toBe(false);
        if (!outcome.Ok) {
            // The unified primitive still surfaces a timeout — legacy callers
            // see the same "Timeout" reason they always have.
            expect(outcome.Reason).toBe("Timeout");
        }
    });

    it("AC-19.2.6: waitForCondition polls at least twice even when TimeoutMs < PollMs * 2", async () => {
        let polls = 0;
        const condition: Condition = { Selector: "#miss", Matcher: { Kind: "Exists" } };
        const result = await waitForCondition(condition, {
            Doc: document,
            TimeoutMs: 0,
            PollMs: 50,
            Now: () => 0,
            Sleep: async () => { polls++; },
        });
        expect(result.Ok).toBe(false);
        if (result.Ok === false) {
            // The loop must evaluate at least twice (initial probe + retry).
            expect(result.Polls).toBeGreaterThanOrEqual(2);
        }
    });

    it("AC-19.2.7: Successful wait records DurationMs and Polls for diagnostics", async () => {
        document.body.innerHTML = `<div id="ready"></div>`;
        const result = await waitForCondition(
            { Selector: "#ready", Matcher: { Kind: "Exists" } },
            { Doc: document, TimeoutMs: 100, PollMs: 10 },
        );
        expect(result.Ok).toBe(true);
        if (result.Ok) {
            expect(result.DurationMs).toBeGreaterThanOrEqual(0);
            expect(result.Polls).toBeGreaterThanOrEqual(1);
        }
    });
});
