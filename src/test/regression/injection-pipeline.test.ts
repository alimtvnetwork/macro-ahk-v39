/**
 * Integration tests — injection-pipeline (PERF-R2b step 6)
 *
 * Covers the Stage 3/4 machinery extracted from `injection-handler.ts`:
 *   • hashScriptCode         — deterministic 8-hex digest
 *   • buildRequestFingerprint — order-stable, content-aware cache key
 *   • partitionBySyntax      — splits scripts on parse success vs SyntaxError
 *   • injectAllScripts       — batch path, CSS-forced sequential, fallback on
 *                              batch throw, empty-list short-circuit
 *   • executeInTab           — success + throw on CSP-fallback failure
 *
 * I/O dependencies (chrome.scripting, csp-fallback, wrap, cache writes,
 * telemetry, state-manager) are all mocked.
 *
 * @see src/background/handlers/injection-pipeline.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must precede import-under-test) ──────────────────────────────
vi.mock("../../background/csp-fallback", () => ({
    injectWithCspFallback: vi.fn(),
}));
vi.mock("../../background/handlers/injection-wrapper", () => ({
    wrapWithIsolation: vi.fn((script: { code: string; id: string }) => `/*W:${script.id}*/${script.code}`),
}));
vi.mock("../../background/handlers/logging-handler", () => ({
    handleLogEntry: vi.fn().mockResolvedValue(undefined),
    handleLogError: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../background/state-manager", () => ({
    getActiveProjectId: vi.fn(() => "proj-1"),
}));
vi.mock("../../background/injection-cache", () => ({
    cacheSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../background/bg-logger", () => ({
    logBgWarnError: vi.fn(),
    logCaughtError: vi.fn(),
    BgLogTag: { INJECTION: "INJECTION" },
}));

// chrome.scripting.insertCSS mock for the CSS path of injectSingleScript
(globalThis as unknown as { chrome: unknown }).chrome = {
    scripting: { insertCSS: vi.fn().mockResolvedValue(undefined) },
};

import {
    hashScriptCode,
    buildRequestFingerprint,
    partitionBySyntax,
    injectAllScripts,
    executeInTab,
    type PreparedScript,
} from "../../background/handlers/injection-pipeline";
import { injectWithCspFallback } from "../../background/csp-fallback";
import type { InjectableScript } from "../../shared/injection-types";

const mockedInject = injectWithCspFallback as unknown as ReturnType<typeof vi.fn>;

function makeScript(id: string, code = "var x = 1;", extras: Partial<InjectableScript> = {}): InjectableScript {
    return {
        id,
        name: id,
        code,
        order: 0,
        configBinding: undefined,
        ...extras,
    } as InjectableScript;
}

function prep(id: string, code = "var x = 1;", extras: Partial<InjectableScript> = {}): PreparedScript {
    return { injectable: makeScript(id, code, extras), configJson: null, themeJson: null };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockedInject.mockResolvedValue({
        isSuccess: true,
        world: "MAIN",
        isFallback: false,
        domTarget: "document",
    });
});

/* ------------------------------------------------------------------ */
/*  hashScriptCode                                                     */
/* ------------------------------------------------------------------ */

describe("hashScriptCode", () => {
    it("returns deterministic 8-char hex for same input", () => {
        const h1 = hashScriptCode("hello world");
        const h2 = hashScriptCode("hello world");
        expect(h1).toBe(h2);
        expect(h1).toMatch(/^[0-9a-f]{8}$/);
    });

    it("differs for different inputs", () => {
        expect(hashScriptCode("a")).not.toBe(hashScriptCode("b"));
    });

    it("handles empty string", () => {
        expect(hashScriptCode("")).toBe("00000000");
    });
});

/* ------------------------------------------------------------------ */
/*  buildRequestFingerprint                                            */
/* ------------------------------------------------------------------ */

describe("buildRequestFingerprint", () => {
    it("is stable regardless of input order (sorted by order then id)", () => {
        const a = makeScript("a", "x", { order: 1 });
        const b = makeScript("b", "y", { order: 2 });
        expect(buildRequestFingerprint([a, b])).toBe(buildRequestFingerprint([b, a]));
    });

    it("changes when code changes", () => {
        const f1 = buildRequestFingerprint([makeScript("a", "x")]);
        const f2 = buildRequestFingerprint([makeScript("a", "y")]);
        expect(f1).not.toBe(f2);
    });

    it("uses 'store' sentinel for non-string code", () => {
        const f = buildRequestFingerprint([{ id: "x", name: "x", order: 0 } as unknown as InjectableScript]);
        expect(f).toContain(":store");
    });
});

/* ------------------------------------------------------------------ */
/*  partitionBySyntax                                                  */
/* ------------------------------------------------------------------ */

describe("partitionBySyntax", () => {
    it("routes parseable scripts to `good`", () => {
        const result = partitionBySyntax([prep("a", "var x = 1;")], Date.now(), undefined);
        expect(result.good).toHaveLength(1);
        expect(result.syntaxFailures).toHaveLength(0);
    });

    it("routes broken scripts to `syntaxFailures` with InjectionResult shape", () => {
        const result = partitionBySyntax([prep("bad", "function (")], Date.now(), undefined);
        expect(result.good).toHaveLength(0);
        expect(result.syntaxFailures).toHaveLength(1);
        const f = result.syntaxFailures[0];
        expect(f.scriptId).toBe("bad");
        expect(f.isSuccess).toBe(false);
        expect(f.errorMessage).toMatch(/syntax error/i);
    });

    it("splits a mixed batch", () => {
        const result = partitionBySyntax(
            [prep("ok1", "1;"), prep("bad", "function ("), prep("ok2", "2;")],
            Date.now(),
            "proj",
        );
        expect(result.good.map((g) => g.injectable.id)).toEqual(["ok1", "ok2"]);
        expect(result.syntaxFailures.map((f) => f.scriptId)).toEqual(["bad"]);
    });
});

/* ------------------------------------------------------------------ */
/*  executeInTab                                                       */
/* ------------------------------------------------------------------ */

describe("executeInTab", () => {
    it("returns path + domTarget on success", async () => {
        mockedInject.mockResolvedValueOnce({ isSuccess: true, world: "MAIN", isFallback: false, domTarget: "document" });
        const r = await executeInTab(1, "code");
        expect(r.path).toMatch(/MAIN/i);
        expect(r.domTarget).toBe("document");
    });

    it("throws when CSP fallback reports failure", async () => {
        mockedInject.mockResolvedValueOnce({ isSuccess: false, errorMessage: "CSP blocked" });
        await expect(executeInTab(1, "code")).rejects.toThrow(/CSP blocked/);
    });

    it("falls back to default error message when none provided", async () => {
        mockedInject.mockResolvedValueOnce({ isSuccess: false });
        await expect(executeInTab(1, "code")).rejects.toThrow(/Injection failed/);
    });
});

/* ------------------------------------------------------------------ */
/*  injectAllScripts                                                   */
/* ------------------------------------------------------------------ */

describe("injectAllScripts", () => {
    it("short-circuits on empty list", async () => {
        const results = await injectAllScripts(1, []);
        expect(results).toEqual([]);
        expect(mockedInject).not.toHaveBeenCalled();
    });

    it("batches multiple clean scripts into ONE executeInTab call", async () => {
        const results = await injectAllScripts(1, [prep("a"), prep("b"), prep("c")]);
        expect(mockedInject).toHaveBeenCalledTimes(1);
        expect(results).toHaveLength(3);
        expect(results.every((r) => r.isSuccess)).toBe(true);
    });

    it("reports syntax failures alongside successful batch", async () => {
        const results = await injectAllScripts(1, [
            prep("ok", "1;"),
            prep("bad", "function ("),
        ]);
        expect(mockedInject).toHaveBeenCalledTimes(1); // only good script batched
        const ok = results.find((r) => r.scriptId === "ok")!;
        const bad = results.find((r) => r.scriptId === "bad")!;
        expect(ok.isSuccess).toBe(true);
        expect(bad.isSuccess).toBe(false);
        expect(bad.errorMessage).toMatch(/syntax error/i);
    });

    it("forces sequential when any script has CSS assets", async () => {
        await injectAllScripts(1, [
            prep("a"),
            { injectable: makeScript("b", "y;", { assets: { css: "b.css" } as unknown as InjectableScript["assets"] }), configJson: null, themeJson: null },
        ]);
        // sequential = one executeInTab per non-CSS script (CSS-only side effect is insertCSS)
        expect(mockedInject).toHaveBeenCalledTimes(2);
    });

    it("falls back to sequential when batch executeInTab throws", async () => {
        mockedInject
            .mockResolvedValueOnce({ isSuccess: false, errorMessage: "batch boom" }) // batch attempt throws
            .mockResolvedValue({ isSuccess: true, world: "MAIN", isFallback: false, domTarget: "doc" });
        const results = await injectAllScripts(1, [prep("a"), prep("b")]);
        // 1 batch + 2 sequential = 3 calls
        expect(mockedInject).toHaveBeenCalledTimes(3);
        expect(results.filter((r) => r.isSuccess)).toHaveLength(2);
    });

    it("sorts scripts by `order` before batching", async () => {
        await injectAllScripts(1, [
            prep("z", "z;", { order: 5 }),
            prep("a", "a;", { order: 1 }),
        ]);
        const combinedCode = mockedInject.mock.calls[0][1] as string;
        expect(combinedCode.indexOf("/*W:a*/")).toBeLessThan(combinedCode.indexOf("/*W:z*/"));
    });
});
