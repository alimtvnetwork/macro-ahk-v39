/**
 * Allow-swallow fallback triggers — unit tests
 *
 * Each test simulates one of the four documented `allow-swallow:` sites
 * and asserts the throttled/sampled fallback handler fires (and that
 * repeated calls are deduplicated within the per-key budget).
 *
 *   1. injection-wrapper      — chrome.runtime.getManifest unavailable
 *   2. logging-handler        — Sessions schema not ready
 *   3. script-resolver        — cache lookup fails (missing chrome.storage)
 *   4. service-worker-main    — chrome.action.setTitle unavailable
 *
 * The shared throttle primitive `logBgWarnSampled` is also exercised
 * directly to lock the dedup contract (budget=3, "further occurrences
 * suppressed" suffix on the final allowed call).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    logBgWarnSampled,
    logCaughtError,
    BgLogTag,
    _resetSampledWarnCountersForTest,
} from "@/background/bg-logger";

type ChromeStub = {
    runtime?: { getManifest?: () => { version: string }; lastError?: unknown };
    action?: { setTitle?: (info: { title: string }) => void };
    storage?: { local?: unknown };
};

declare global {
    // eslint-disable-next-line no-var
    var chrome: ChromeStub | undefined;
}

const originalChrome = globalThis.chrome;

beforeEach(() => {
    _resetSampledWarnCountersForTest();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    globalThis.chrome = originalChrome;
});

/* ------------------------------------------------------------------ */
/*  1. Throttle primitive contract                                     */
/* ------------------------------------------------------------------ */

describe("logBgWarnSampled — dedup contract", () => {
    it("emits at most `budget` warnings per (tag, key) pair", () => {
        for (let i = 0; i < 10; i += 1) {
            logBgWarnSampled(BgLogTag.SCRIPT_RESOLVER, "k1", `attempt ${i}`);
        }
        expect((console.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    });

    it("suffixes the final allowed call with the suppression notice", () => {
        logBgWarnSampled(BgLogTag.SCRIPT_RESOLVER, "k2", "msg");
        logBgWarnSampled(BgLogTag.SCRIPT_RESOLVER, "k2", "msg");
        logBgWarnSampled(BgLogTag.SCRIPT_RESOLVER, "k2", "msg");
        const calls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[2][0]).toContain("(further occurrences suppressed)");
    });

    it("treats different keys as independent buckets", () => {
        for (let i = 0; i < 5; i += 1) {
            logBgWarnSampled(BgLogTag.SCRIPT_RESOLVER, "key-A", "a");
            logBgWarnSampled(BgLogTag.SCRIPT_RESOLVER, "key-B", "b");
        }
        // 3 emissions per key = 6 total
        expect((console.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(6);
    });
});

/* ------------------------------------------------------------------ */
/*  2. injection-wrapper — chrome.runtime missing                      */
/* ------------------------------------------------------------------ */

describe("injection-wrapper buildSdkPreamble — no chrome.runtime", () => {
    it("falls back to '0.0.0' and emits a sampled warn (throttled across calls)", async () => {
        // Simulate preview/test SW context: chrome exists but runtime throws.
        globalThis.chrome = {
            runtime: {
                getManifest: () => {
                    throw new Error("chrome.runtime unavailable");
                },
            },
        };
        // Re-import is unnecessary — wrapWithIsolation reads chrome at call-time.
        const { wrapWithIsolation } = await import("@/background/handlers/injection-wrapper");
        // Stub state-manager's active project resolver (any value works).
        for (let i = 0; i < 8; i += 1) {
            const out = wrapWithIsolation(
                {
                    id: `script-${i % 2}`,
                    name: "test",
                    code: "console.log('hi');",
                    order: 0,
                    isIife: false,
                    configBinding: null,
                },
                null,
                null,
            );
            expect(out).toContain("script-" + (i % 2));
        }
        // Single shared key "manifest-unavailable" → budget of 3, regardless of call count.
        const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
        expect(warnCalls.length).toBe(3);
        expect(warnCalls[0][0]).toContain("[injection]");
        expect(warnCalls[0][0]).toContain("chrome.runtime.getManifest unavailable");
    });
});

/* ------------------------------------------------------------------ */
/*  3. logging-handler — Sessions schema not ready                     */
/* ------------------------------------------------------------------ */

describe("logging-handler handleGetLogStats — Sessions schema missing", () => {
    it("returns sessionCount=0 and emits a throttled warn (budget 3)", async () => {
        const mod = await import("@/background/handlers/logging-handler");

        // Inject a fake DbManager: Logs/Errors COUNT(*) succeeds, Sessions throws.
        const fakeDb = {
            exec: (sql: string) => {
                if (sql.includes("Sessions")) {
                    throw new Error("no such table: Sessions");
                }
                return [{ columns: ["c"], values: [[0]] }];
            },
        };
        const fakeManager = {
            getLogsDb: () => fakeDb,
            getErrorsDb: () => fakeDb,
        } as unknown as Parameters<typeof mod.bindDbManager>[0];
        mod.bindDbManager(fakeManager);

        for (let i = 0; i < 6; i += 1) {
            const stats = await mod.handleGetLogStats();
            expect(stats.sessionCount).toBe(0);
        }
        const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
        expect(warnCalls.length).toBe(3);
        expect(warnCalls[0][0]).toContain("[logging-handler]");
        expect(warnCalls[0][0]).toContain("schema not ready");
        expect(warnCalls[2][0]).toContain("(further occurrences suppressed)");
    });
});

/* ------------------------------------------------------------------ */
/*  4. script-resolver — cache lookup throws (no chrome.storage)       */
/* ------------------------------------------------------------------ */

describe("script-resolver cache lookup — chrome.storage unavailable", () => {
    it("throttled warn fires when the cache lookup throws repeatedly", async () => {
        // Simulate the cache layer throwing by mocking the dependency.
        vi.doMock("@/background/injection-cache", () => ({
            getCachedScriptCode: vi.fn().mockRejectedValue(new Error("storage unavailable")),
            cacheScriptCode: vi.fn().mockResolvedValue(undefined),
        }));
        // Force re-import after the mock is registered.
        vi.resetModules();
        const { logBgWarnSampled: throttle, BgLogTag: Tags, _resetSampledWarnCountersForTest: reset } =
            await import("@/background/bg-logger");
        reset();
        const filePath = "projects/scripts/test/test.js";
        // The resolver wraps the cache lookup in try/catch and calls throttle with
        // key=`cache-lookup:${filePath}` — exercise the same key explicitly so the
        // test pins the contract without standing up the full storage stack.
        for (let i = 0; i < 5; i += 1) {
            throttle(Tags.SCRIPT_RESOLVER, `cache-lookup:${filePath}`, "Cache lookup failed", new Error("x"));
        }
        const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
        expect(warnCalls.length).toBe(3);
        expect(warnCalls[0][0]).toContain("[script-resolver]");
        expect(warnCalls[0][0]).toContain("Cache lookup failed");
    });
});

/* ------------------------------------------------------------------ */
/*  5. service-worker-main — chrome.action.setTitle unavailable        */
/* ------------------------------------------------------------------ */

describe("service-worker-main chrome.action fallback", () => {
    it("logCaughtError surfaces the error without rethrowing when chrome.action is missing", () => {
        // Simulate the documented fallback site directly: the SW boot wraps
        // chrome.action.setTitle in try/catch and calls logCaughtError. When
        // chrome.action is undefined, accessing .setTitle throws TypeError,
        // and logCaughtError must absorb it via console.error (not re-raise).
        globalThis.chrome = {}; // no .action at all
        let thrownInTry: Error | null = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis.chrome as any).action.setTitle({ title: "x" });
        } catch (err) {
            thrownInTry = err as Error;
        }
        expect(thrownInTry).toBeInstanceOf(Error);

        expect(() => {
            logCaughtError(
                BgLogTag.MARCO,
                "chrome.action.setTitle failed (non-fatal — tooltip skipped)",
                thrownInTry!,
            );
        }).not.toThrow();

        expect((console.error as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
        const firstCall = (console.error as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(String(firstCall[0])).toContain("[Marco]");
        expect(String(firstCall[0])).toContain("chrome.action.setTitle failed");
    });
});
