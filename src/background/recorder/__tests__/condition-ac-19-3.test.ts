/**
 * Spec 19 §3.7 — AC-19.3.1 .. AC-19.3.10
 *
 * AC-tagged coverage for `validateCondition`, `evaluateCondition`,
 * `waitForCondition`, and `buildConditionFailureRecord`. Each `it` name
 * mirrors the AC id per the test-writing convention recorded in
 * `spec/31-macro-recorder/llm-guide.md` §11.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import {
    evaluateCondition,
    resolveSelectorKind,
    validateCondition,
    waitForCondition,
    type Condition,
    type PredicateEvaluation,
} from "../condition-evaluator";
import { buildConditionFailureRecord } from "../condition-failure-record";

describe("Spec 19 §3.7 — Condition AC suite", () => {
    it("AC-19.3.1: Auto-detects XPath when selector starts with '/html/body/...'", () => {
        expect(resolveSelectorKind("Auto", "/html/body/div[1]")).toBe("XPath");
    });

    it("AC-19.3.2: Auto-detects CSS for '#submit'", () => {
        expect(resolveSelectorKind("Auto", "#submit")).toBe("Css");
    });

    it("AC-19.3.3: Visible returns false for display:none even when Exists is true", () => {
        document.body.innerHTML = `<div id="x" style="display:none">hi</div>`;
        const exists: Condition = { Selector: "#x", Matcher: { Kind: "Exists" } };
        const visible: Condition = { Selector: "#x", Matcher: { Kind: "Visible" } };
        expect(evaluateCondition(exists,  { Doc: document })).toBe(true);
        expect(evaluateCondition(visible, { Doc: document })).toBe(false);
    });

    it("AC-19.3.4: Count.gte returns true iff N >= threshold", () => {
        document.body.innerHTML = `<p class="r"></p><p class="r"></p><p class="r"></p>`;
        const ge3: Condition = { Selector: ".r", Matcher: { Kind: "Count", Op: "gte", N: 3 } };
        const ge4: Condition = { Selector: ".r", Matcher: { Kind: "Count", Op: "gte", N: 4 } };
        expect(evaluateCondition(ge3, { Doc: document })).toBe(true);
        expect(evaluateCondition(ge4, { Doc: document })).toBe(false);
    });

    it("AC-19.3.5: All:[] is true; Any:[] is false; Not(true) is false", () => {
        expect(evaluateCondition({ All: [] }, { Doc: document })).toBe(true);
        expect(evaluateCondition({ Any: [] }, { Doc: document })).toBe(false);
        expect(
            evaluateCondition({ Not: { All: [] } }, { Doc: document }),
        ).toBe(false);
    });

    it("AC-19.3.6: depth-9 tree is rejected with InvalidSelector pointing at deepest node", () => {
        let node: Condition = { Selector: "#x", Matcher: { Kind: "Exists" } };
        for (let i = 0; i < 9; i++) node = { Not: node };
        expect(() => validateCondition(node)).toThrow(/InvalidSelector.*exceeds depth 8 at Not\.Not/);
    });

    it("AC-19.3.7: TextRegex '(unclosed' is rejected with InvalidSelector + pattern echo", () => {
        const c: Condition = {
            Selector: "#s",
            Matcher: { Kind: "TextRegex", Pattern: "(unclosed" },
        };
        expect(() => validateCondition(c)).toThrow(/InvalidSelector: bad regex \/\(unclosed\//);
    });

    it("AC-19.3.8: failed waitForCondition returns ConditionTimeout with non-empty LastEvaluation", async () => {
        document.body.innerHTML = ``;
        let t = 0;
        const outcome = await waitForCondition(
            { Selector: "#missing", Matcher: { Kind: "Exists" } },
            {
                Doc: document,
                TimeoutMs: 5,
                PollMs: 1,
                Now: () => (t += 10),
                Sleep: () => Promise.resolve(),
            },
        );
        expect(outcome.Ok).toBe(false);
        if (outcome.Ok === false) {
            expect(outcome.Reason).toBe("ConditionTimeout");
            expect(outcome.LastEvaluation.length).toBeGreaterThan(0);
        }
    });

    it("AC-19.3.9: evaluateCondition appends one Trace entry per leaf visited in evaluation order", () => {
        document.body.innerHTML = `<div id="a"></div><div id="b"></div>`;
        const trace: PredicateEvaluation[] = [];
        const tree: Condition = {
            All: [
                { Selector: "#a", Matcher: { Kind: "Exists" } },
                { Selector: "#b", Matcher: { Kind: "Exists" } },
            ],
        };
        evaluateCondition(tree, { Doc: document, Trace: trace });
        expect(trace.map((t) => t.Selector)).toEqual(["#a", "#b"]);
    });

    it("AC-19.3.10: runner-style save-time gate refuses to persist a step whose Gate fails validateCondition", () => {
        // Simulates the inspector save-point check: any Gate that throws from
        // validateCondition MUST surface synchronously, before replay.
        const badGate: Condition = {
            Selector: "#s",
            Matcher: { Kind: "TextRegex", Pattern: "(unclosed" },
        };
        const persist = (gate: Condition): void => {
            validateCondition(gate); // throws => save aborted
        };
        expect(() => persist(badGate)).toThrow(/InvalidSelector/);

        // And: when validation fails, the failure record carries the
        // structured Reason so the inspector can render it.
        const rec = buildConditionFailureRecord({
            Condition: badGate,
            Outcome: {
                Ok: false,
                DurationMs: 0,
                Polls: 0,
                Reason: "InvalidSelector",
                Detail: "bad regex /(unclosed/",
                LastEvaluation: [],
            },
        });
        expect(rec.Reason).toBe("InvalidSelector");
        expect(rec.ConditionSerialized).toContain("(unclosed");
    });
});
