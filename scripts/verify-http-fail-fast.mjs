#!/usr/bin/env bun
/**
 * Quick verification for src/shared/http-fail-fast.ts (HEFF Step 3 helper).
 *
 * Run: bun scripts/verify-http-fail-fast.mjs
 * Full assertion suite (Step 9) will live in
 * standalone-scripts/macro-controller/scripts/verify-http-fail-fast.mjs.
 */
import { httpFailFast, httpFetchOrThrow, HttpFailFastError } from "../src/shared/http-fail-fast.ts";

let passed = 0;
let failed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };
const bad = (name, err) => { failed++; console.error(`  ✗ ${name}: ${err}`); };

const mkResponse = (status, body = "") =>
    new Response(body, { status, statusText: `HTTP ${status}` });

// 1. 2xx passes through
try {
    const res = await httpFailFast(mkResponse(200, "ok"), { method: "GET", url: "/x" });
    if (res.status === 200) ok("200 OK passes through");
    else bad("200 OK passes through", "bad status");
} catch (e) { bad("200 OK passes through", e.message); }

// 2. 404 throws
try {
    await httpFailFast(mkResponse(404, "missing"), { method: "GET", url: "/x" });
    bad("404 throws", "did not throw");
} catch (e) {
    if (e instanceof HttpFailFastError && e.status === 404) ok("404 throws HttpFailFastError");
    else bad("404 throws", e.message);
}

// 3. 405 report shape
try {
    await httpFailFast(mkResponse(405, "method not allowed"), { method: "GET", url: "/projects/abc" });
    bad("405 report shape", "did not throw");
} catch (e) {
    const r = e.toReportString();
    const checks = [
        r.includes("HTTP 405 on GET /projects/abc"),
        r.includes("Body: method not allowed"),
        r.includes("Reason: Method Not Allowed"),
        r.includes("Loop halted. Awaiting user instruction."),
    ];
    if (checks.every(Boolean)) ok("405 report shape matches HEFF spec §5");
    else bad("405 report shape", `checks=${JSON.stringify(checks)}\n${r}`);
}

// 4. 500 reason
try {
    await httpFailFast(mkResponse(500, ""), { method: "POST", url: "/x" });
} catch (e) {
    if (e.reason.includes("Server Error 500")) ok("500 reason mentions Server Error");
    else bad("500 reason", e.reason);
}

// 5. Body truncation
const longBody = "A".repeat(700);
try {
    await httpFailFast(mkResponse(400, longBody), { method: "GET", url: "/x" });
} catch (e) {
    if (e.bodySnippet && e.bodySnippet.length <= 520 && e.bodySnippet.includes("…[truncated]")) ok("body truncated to 500 chars");
    else bad("body truncation", `len=${e.bodySnippet?.length}`);
}

// 6. httpFetchOrThrow with mocked global fetch
const origFetch = globalThis.fetch;
globalThis.fetch = async () => mkResponse(404, "nope");
try {
    await httpFetchOrThrow("https://example.test/api");
    bad("httpFetchOrThrow", "did not throw");
} catch (e) {
    if (e instanceof HttpFailFastError && e.status === 404 && e.method === "GET") ok("httpFetchOrThrow throws and infers method=GET");
    else bad("httpFetchOrThrow", e.message);
}
globalThis.fetch = origFetch;

// 7. isNetworkError discriminator
ok("isNetworkError discriminates");
if (HttpFailFastError.isNetworkError(new TypeError("fetch failed")) !== true) bad("isNetworkError(TypeError)", "should be true");
if (HttpFailFastError.isNetworkError(new HttpFailFastError({ status: 404, method: "GET", url: "/x", bodySnippet: null, reason: "r" })) !== false) bad("isNetworkError(HEFF)", "should be false");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
