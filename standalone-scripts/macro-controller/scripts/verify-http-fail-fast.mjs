#!/usr/bin/env bun
/**
 * HEFF Step 9 — Macro-controller verification suite.
 *
 * Goes beyond the in-tree `scripts/verify-http-fail-fast.mjs` smoke test:
 *
 *  (a) Asserts `httpFailFast` throws on 4xx/5xx with the spec §5 report shape.
 *  (b) Asserts NO second HTTP call is issued after the first non-2xx, by
 *      wiring a counting mock `fetch` against a representative caller pattern
 *      (sequential `for...of` loop — the canonical compliant shape).
 *  (c) Asserts the `marco:http-fail-fast` window CustomEvent fires exactly
 *      once per HttpFailFastError construction (UI banner surfacing contract).
 *  (d) Asserts retry/backoff patterns are NOT present in compliant code paths
 *      by checking the helper module text for forbidden tokens.
 *
 * Run:  bun standalone-scripts/macro-controller/scripts/verify-http-fail-fast.mjs
 * Exit: 0 = clean, 1 = any assertion failed.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
    httpFailFast,
    httpFetchOrThrow,
    HttpFailFastError,
    HTTP_FAIL_FAST_EVENT,
} from "../../../src/shared/http-fail-fast.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

let passed = 0;
let failed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };
const bad = (name, err) => { failed++; console.error(`  ✗ ${name}: ${err}`); };

const mkResponse = (status, body = "") =>
    new Response(body, { status, statusText: `HTTP ${status}` });

// ----------------------------------------------------------------------------
// (a) Spec §5 report shape across representative status codes
// ----------------------------------------------------------------------------
const SHAPE_CASES = [
    { status: 401, url: "/auth/me",            method: "GET",  reasonNeedle: "Unauthorized" },
    { status: 403, url: "/projects/x",         method: "GET",  reasonNeedle: "Forbidden" },
    { status: 404, url: "/projects/x/git",     method: "GET",  reasonNeedle: "Not Found" },
    { status: 405, url: "/projects/x/git",     method: "GET",  reasonNeedle: "Method Not Allowed" },
    { status: 429, url: "/api/limited",        method: "POST", reasonNeedle: "Rate Limited" },
    { status: 500, url: "/api/boom",           method: "POST", reasonNeedle: "Server Error 500" },
    { status: 503, url: "/api/down",           method: "GET",  reasonNeedle: "Server Error 503" },
];

for (const { status, url, method, reasonNeedle } of SHAPE_CASES) {
    try {
        await httpFailFast(mkResponse(status, "x"), { method, url });
        bad(`${status} throws`, "did not throw");
    } catch (e) {
        if (!(e instanceof HttpFailFastError)) { bad(`${status} throws HEFF`, e.message); continue; }
        const report = e.toReportString();
        const checks = {
            statusLine: report.includes(`HTTP ${status} on ${method} ${url}`),
            body:       report.includes("Body: x"),
            reason:     report.includes(`Reason: `) && report.includes(reasonNeedle),
            halt:       report.includes("Loop halted. Awaiting user instruction."),
        };
        const allOk = Object.values(checks).every(Boolean);
        if (allOk) ok(`${status} ${method} → report shape compliant`);
        else bad(`${status} report shape`, JSON.stringify(checks));
    }
}

// ----------------------------------------------------------------------------
// (b) Sequential loop MUST halt on first non-2xx — no second call issued
// ----------------------------------------------------------------------------
{
    const callLog = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        callLog.push(String(url));
        // First URL fails with 404; remaining would succeed IF reached.
        if (callLog.length === 1) return mkResponse(404, "missing");
        return mkResponse(200, "ok");
    };
    const URLS = ["https://t.test/a", "https://t.test/b", "https://t.test/c"];
    let caught = null;
    try {
        for (const u of URLS) {
            await httpFetchOrThrow(u);
        }
    } catch (e) { caught = e; }
    globalThis.fetch = origFetch;

    if (!(caught instanceof HttpFailFastError)) {
        bad("sequential loop halts on first non-2xx", `expected throw, got ${caught}`);
    } else if (callLog.length !== 1) {
        bad("sequential loop halts on first non-2xx", `expected 1 call, got ${callLog.length}: ${callLog.join(",")}`);
    } else {
        ok("sequential loop halts on first non-2xx (1 call, no fanout)");
    }
}

// ----------------------------------------------------------------------------
// (c) UI surfacing — `marco:http-fail-fast` event fires once per error
// ----------------------------------------------------------------------------
{
    // Minimal window shim so the helper's `typeof window !== 'undefined'`
    // branch executes during this Bun run.
    const events = [];
    globalThis.window = {
        dispatchEvent: (evt) => { events.push(evt); return true; },
    };
    // CustomEvent fallback for environments without DOM
    if (typeof globalThis.CustomEvent !== "function") {
        globalThis.CustomEvent = class CustomEvent {
            constructor(type, init) { this.type = type; this.detail = init?.detail ?? null; }
        };
    }
    try {
        await httpFailFast(mkResponse(418, "teapot"), { method: "GET", url: "/tea" });
    } catch { /* expected */ }
    delete globalThis.window;

    const heffEvents = events.filter((e) => e.type === HTTP_FAIL_FAST_EVENT);
    if (heffEvents.length !== 1) {
        bad("UI event fires once", `got ${heffEvents.length} events`);
    } else {
        const d = heffEvents[0].detail;
        const shapeOk =
            d && d.status === 418 && d.method === "GET" && d.url === "/tea" &&
            typeof d.report === "string" && d.report.includes("Loop halted");
        if (shapeOk) ok("UI event fires once with correct detail payload");
        else bad("UI event payload", JSON.stringify(d));
    }
}

// ----------------------------------------------------------------------------
// (d) Helper module MUST NOT contain retry/backoff tokens
// ----------------------------------------------------------------------------
{
    const helperPath = resolve(REPO_ROOT, "src/shared/http-fail-fast.ts");
    const text = readFileSync(helperPath, "utf8");
    const FORBIDDEN = [
        /\bMAX_RETRIES\b/,
        /\battempt\s*<\s*\d+/,
        /\bexponential[_ ]?backoff\b/i,
        /\bsetTimeout\s*\([^)]*\*\s*\*\s*\d/, // 2 ** i style backoff
    ];
    const hits = FORBIDDEN.filter((re) => re.test(text));
    if (hits.length === 0) ok("helper module contains no retry/backoff tokens");
    else bad("helper module retry-free", hits.map(String).join(", "));
}

// ----------------------------------------------------------------------------
// (e) Network error discriminator
// ----------------------------------------------------------------------------
{
    const netOk = HttpFailFastError.isNetworkError(new TypeError("fetch failed")) === true;
    const heffNotNet = HttpFailFastError.isNetworkError(
        new HttpFailFastError({ status: 500, method: "GET", url: "/x", bodySnippet: null, reason: "r" })
    ) === false;
    if (netOk && heffNotNet) ok("isNetworkError discriminates TypeError vs HEFF");
    else bad("isNetworkError discriminator", `netOk=${netOk} heffNotNet=${heffNotNet}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
