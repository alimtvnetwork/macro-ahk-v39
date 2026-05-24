/**
 * Integration tests — injection-result-builder
 *
 * Covers the six exported helpers extracted from `injection-handler.ts`
 * in PERF-R2b step 3:
 *   • buildSuccessResult      — happy-path InjectionResult factory
 *   • buildErrorResult        — failure InjectionResult + background warn log
 *   • resolveInjectionPath    — CspInjectionResult → human-readable label
 *   • buildSkipMessage        — SkipReason → user-facing string
 *   • extractMacroVersion     — VERSION constant scraper for cache-stale detection
 *   • buildSyntaxFailureResult — syntax preflight failure shape
 *
 * These helpers are deliberately I/O-free (except the console.warn inside
 * buildErrorResult) so they can be exercised without a browser runtime.
 *
 * @see src/background/handlers/injection-result-builder.ts
 * @see src/background/handlers/injection-handler.ts — consumer
 * @see src/shared/injection-types.ts — InjectionResult / SkipReason contracts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    buildSuccessResult,
    buildErrorResult,
    resolveInjectionPath,
    buildSkipMessage,
    extractMacroVersion,
    buildSyntaxFailureResult,
} from "../../background/handlers/injection-result-builder";
import type { CspInjectionResult } from "../../background/csp-fallback";
import { BgLogTag } from "../../background/bg-logger";

/* ------------------------------------------------------------------ */
/*  Mock background logger (buildErrorResult calls logBgWarnError)     */
/* ------------------------------------------------------------------ */

vi.mock("../../background/bg-logger", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../background/bg-logger")>();
    return {
        ...actual,
        logBgWarnError: vi.fn(),
    };
});

const { logBgWarnError } = await import("../../background/bg-logger");

/* ------------------------------------------------------------------ */
/*  Console silencing                                                  */
/* ------------------------------------------------------------------ */

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logBgWarnError).mockClear();
});

/* ------------------------------------------------------------------ */
/*  buildSuccessResult                                                 */
/* ------------------------------------------------------------------ */

describe("buildSuccessResult", () => {
    it("returns isSuccess=true with all fields populated", () => {
        const start = Date.now();
        const result = buildSuccessResult("s1", start, "main-blob", "body");

        expect(result.scriptId).toBe("s1");
        expect(result.isSuccess).toBe(true);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.injectionPath).toBe("main-blob");
        expect(result.domTarget).toBe("body");
    });

    it("works without optional injectionPath / domTarget", () => {
        const start = Date.now();
        const result = buildSuccessResult("s2", start);

        expect(result.isSuccess).toBe(true);
        expect(result.injectionPath).toBeUndefined();
        expect(result.domTarget).toBeUndefined();
    });

    it("computes plausible durationMs (within 50ms of real elapsed)", () => {
        const start = Date.now();
        const result = buildSuccessResult("s3", start);
        const elapsed = Date.now() - start;
        expect(result.durationMs).toBeGreaterThanOrEqual(1);
        expect(result.durationMs).toBeLessThanOrEqual(elapsed + 50);
    });
});

/* ------------------------------------------------------------------ */
/*  buildErrorResult                                                   */
/* ------------------------------------------------------------------ */

describe("buildErrorResult", () => {
    it("returns isSuccess=false with Error.message", () => {
        const start = Date.now();
        const err = new Error("boom");
        const result = buildErrorResult("s1", start, err);

        expect(result.scriptId).toBe("s1");
        expect(result.isSuccess).toBe(false);
        expect(result.errorMessage).toBe("boom");
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("logs a background warning with INJECTION tag", () => {
        buildErrorResult("s2", Date.now(), new Error("bang"));
        expect(logBgWarnError).toHaveBeenCalledOnce();
        const call = vi.mocked(logBgWarnError).mock.calls[0];
        expect(call[0]).toBe(BgLogTag.INJECTION);
        expect(call[1]).toMatch(/s2/);
        expect(call[1]).toMatch(/bang/);
    });

    it("coerces a string error into the message", () => {
        const result = buildErrorResult("s3", Date.now(), "plain string failure");
        expect(result.errorMessage).toBe("plain string failure");
    });

    it("coerces an object-with-message error", () => {
        const result = buildErrorResult("s4", Date.now(), { message: "obj err" });
        expect(result.errorMessage).toBe("obj err");
    });

    it("handles null / undefined / number without throwing", () => {
        expect(buildErrorResult("s5", Date.now(), null).errorMessage).toBe("null");
        expect(buildErrorResult("s6", Date.now(), undefined).errorMessage).toBe("undefined");
        expect(buildErrorResult("s7", Date.now(), 42).errorMessage).toBe("42");
    });
});

/* ------------------------------------------------------------------ */
/*  resolveInjectionPath                                               */
/* ------------------------------------------------------------------ */

describe("resolveInjectionPath", () => {
    it("maps USER_SCRIPT world → userScripts", () => {
        const result: CspInjectionResult = {
            isSuccess: true,
            world: "USER_SCRIPT",
            isFallback: false,
        };
        expect(resolveInjectionPath(result)).toBe("userScripts");
    });

    it("maps ISOLATED + isFallback → isolated-blob", () => {
        const result: CspInjectionResult = {
            isSuccess: true,
            world: "ISOLATED",
            isFallback: true,
        };
        expect(resolveInjectionPath(result)).toBe("isolated-blob");
    });

    it("maps MAIN world → main-blob", () => {
        const result: CspInjectionResult = {
            isSuccess: true,
            world: "MAIN",
            isFallback: false,
        };
        expect(resolveInjectionPath(result)).toBe("main-blob");
    });

    it("maps ISOLATED without fallback → main-blob (default)", () => {
        const result: CspInjectionResult = {
            isSuccess: true,
            world: "ISOLATED",
            isFallback: false,
        };
        expect(resolveInjectionPath(result)).toBe("main-blob");
    });
});

/* ------------------------------------------------------------------ */
/*  buildSkipMessage                                                   */
/* ------------------------------------------------------------------ */

describe("buildSkipMessage", () => {
    it("disabled → enable-it message", () => {
        const msg = buildSkipMessage("disabled", "Foo");
        expect(msg).toMatch(/disabled/);
        expect(msg).toMatch(/Foo/);
        expect(msg).toMatch(/enable/);
    });

    it("missing → not-found message", () => {
        const msg = buildSkipMessage("missing", "Bar");
        expect(msg).toMatch(/not found/);
        expect(msg).toMatch(/Bar/);
    });

    it("resolver_mismatch → format mismatch message", () => {
        const msg = buildSkipMessage("resolver_mismatch", "Baz");
        expect(msg).toMatch(/doesn't match/);
        expect(msg).toMatch(/Baz/);
    });

    it("empty_code → empty code message", () => {
        const msg = buildSkipMessage("empty_code", "Qux");
        expect(msg).toMatch(/code is empty/);
        expect(msg).toMatch(/Qux/);
    });

    it("unknown reason → fallback message", () => {
        const msg = buildSkipMessage("unknown_reason" as unknown as "disabled", "Xyzzy");
        expect(msg).toMatch(/unknown reason/);
        expect(msg).toMatch(/Xyzzy/);
    });
});

/* ------------------------------------------------------------------ */
/*  extractMacroVersion                                                */
/* ------------------------------------------------------------------ */

describe("extractMacroVersion", () => {
    it("extracts single-quoted VERSION", () => {
        expect(extractMacroVersion("const VERSION = '1.2.3';")).toBe("1.2.3");
    });

    it("extracts double-quoted VERSION", () => {
        expect(extractMacroVersion('const VERSION = "4.5.6";')).toBe("4.5.6");
    });

    it("returns null when pattern absent", () => {
        expect(extractMacroVersion("const x = 1;")).toBeNull();
    });

    it("returns null for empty string", () => {
        expect(extractMacroVersion("")).toBeNull();
    });

    it("returns the first match when multiple VERSION lines exist", () => {
        const code = "const VERSION = '7.8.9';\nconst VERSION = '0.0.1';";
        expect(extractMacroVersion(code)).toBe("7.8.9");
    });

    it("tolerates extra whitespace around operator", () => {
        expect(extractMacroVersion("VERSION   =   '3.4.5'")).toBe("3.4.5");
    });
});

/* ------------------------------------------------------------------ */
/*  buildSyntaxFailureResult                                             */
/* ------------------------------------------------------------------ */

describe("buildSyntaxFailureResult", () => {
    it("returns the required failure shape with scriptName", () => {
        const start = Date.now();
        const result = buildSyntaxFailureResult("s1", "Broken Script", "Unexpected token", start);

        expect(result.scriptId).toBe("s1");
        expect(result.scriptName).toBe("Broken Script");
        expect(result.isSuccess).toBe(false);
        expect(result.errorMessage).toBe("Unexpected token");
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("allows scriptName to be undefined", () => {
        const result = buildSyntaxFailureResult("s2", undefined, "Bad syntax", Date.now());
        expect(result.scriptName).toBeUndefined();
        expect(result.scriptId).toBe("s2");
    });

    it("always sets isSuccess to false", () => {
        const r = buildSyntaxFailureResult("x", "Y", "msg", Date.now());
        expect(r.isSuccess).toBe(false);
    });
});

/* ------------------------------------------------------------------ */
/*  Cross-helper consistency                                           */
/* ------------------------------------------------------------------ */

describe("result-builder cross-helper consistency", () => {
    it("buildSuccessResult and buildErrorResult agree on duration semantics", () => {
        const start = Date.now();
        const success = buildSuccessResult("a", start);
        const error = buildErrorResult("b", start, new Error("e"));
        expect(success.durationMs).toBeGreaterThanOrEqual(0);
        expect(error.durationMs).toBeGreaterThanOrEqual(1);
        // Both derive from Date.now() - start, so neither should be negative.
        expect(success.durationMs).toBeLessThan(1000);
        expect(error.durationMs).toBeLessThan(1000);
    });

    it("buildSyntaxFailureResult mirrors buildErrorResult in shape", () => {
        const start = Date.now();
        const syntax = buildSyntaxFailureResult("s1", "N", "syntax bad", start);
        const runtime = buildErrorResult("s2", start, new Error("runtime bad"));

        const keys = (o: object) => Object.keys(o).sort();
        expect(keys(syntax)).toEqual(keys(runtime));
    });
});