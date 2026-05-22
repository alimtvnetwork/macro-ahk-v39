/**
 * Unit tests for evaluateAutoAttach — one per skip reason C1..C8.
 * See mem://features/auto-attach-policy.md.
 */
import { describe, it, expect } from "vitest";
import { evaluateAutoAttach, type LibraryScriptForAttach } from "../auto-attach";
import type { StoredProject } from "../../shared/project-types";

function makeProject(over: Partial<StoredProject> = {}): StoredProject {
    return {
        id: "p1",
        schemaVersion: 1,
        name: "Proj",
        version: "1.0.0",
        targetUrls: [{ pattern: "https://example.com/*", matchType: "glob" }],
        scripts: [],
        settings: { autoStart: true },
        createdAt: "",
        updatedAt: "",
        ...over,
    };
}

function makeScript(over: Partial<LibraryScriptForAttach["instruction"]> = {}, id = "s1", name = "script-a"): LibraryScriptForAttach {
    return {
        id,
        name,
        instruction: {
            UrlMatches: ["https://example.com/*"],
            ...over,
        },
    };
}

const LIB = new Set(["s1", "dep-1"]);

describe("evaluateAutoAttach", () => {
    it("C1 skips when autoStart is off", () => {
        const r = evaluateAutoAttach(makeProject({ settings: { autoStart: false } }), makeScript(), LIB);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("AUTOATTACH_SKIPPED_AUTOSTART_OFF");
    });

    it("C4 skips when script opts out via AutoAttach=false", () => {
        const r = evaluateAutoAttach(makeProject(), makeScript({ AutoAttach: false }), LIB);
        expect(r.reason).toBe("AUTOATTACH_SKIPPED_OPT_OUT");
    });

    it("C2 skips when URL patterns do not overlap", () => {
        const r = evaluateAutoAttach(makeProject(), makeScript({ UrlMatches: ["https://other.com/*"] }), LIB);
        expect(r.reason).toBe("AUTOATTACH_SKIPPED_URL_NO_MATCH");
    });

    it("C8 skips when script already attached", () => {
        const p = makeProject({ scripts: [{ path: "s1", order: 0 }] });
        const r = evaluateAutoAttach(p, makeScript(), LIB);
        expect(r.reason).toBe("AUTOATTACH_ALREADY_ATTACHED");
    });

    it("C5 skips when World is incompatible (ISOLATED)", () => {
        const r = evaluateAutoAttach(makeProject(), makeScript({ World: "ISOLATED" }), LIB);
        expect(r.reason).toBe("AUTOATTACH_SKIPPED_INCOMPATIBLE_RUN_CONTEXT");
    });

    it("C6 skips when required cookie binding is missing", () => {
        const r = evaluateAutoAttach(makeProject(), makeScript({ RequiredCookies: ["session_token"] }), LIB);
        expect(r.reason).toBe("AUTOATTACH_SKIPPED_COOKIE_BINDING_MISSING");
    });

    it("C7 skips when a declared dependency is not in the library", () => {
        const r = evaluateAutoAttach(makeProject(), makeScript({ Dependencies: ["missing-dep"] }), LIB);
        expect(r.reason).toBe("AUTOATTACH_SKIPPED_DEP_MISSING");
    });

    it("C3 skips when InjectionConditions.requireCookie has no project binding", () => {
        const r = evaluateAutoAttach(
            makeProject(),
            makeScript({ InjectionConditions: { requireCookie: "auth_token", requireElement: null, minDelayMs: 0, requireOnline: false } }),
            LIB,
        );
        expect(r.reason).toBe("AUTOATTACH_SKIPPED_CONDITION_FAIL");
    });

    it("returns OK when every C1..C8 is satisfied", () => {
        const r = evaluateAutoAttach(makeProject(), makeScript(), LIB);
        expect(r.ok).toBe(true);
        expect(r.reason).toBe("OK");
    });
});
