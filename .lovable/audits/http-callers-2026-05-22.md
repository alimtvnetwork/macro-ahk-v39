# HTTP Callers Audit — 2026-05-22

**Plan:** `.lovable/plans/http-fail-fast-10-step.md` · **Rule:** `mem://constraints/http-error-fail-fast`
**Scope:** All agent-shipped HTTP calls in `src/`, `standalone-scripts/`, `scripts/`. Excludes `node_modules/`, `dist/`, `.release/`, `skipped/`, and page-owned scripts the extension does not author.
**Method:** `rg '\b(fetch|XMLHttpRequest|axios|gitApiFetch)\s*\('` + manual loop-context review of every site.

## Legend

- **C** = Compliant (single call, status checked, no fanout)
- **G** = Needs-guard (single call, missing/weak status check)
- **F** = Loop-fanout-risk (call inside `for` / `forEach` / `Promise.all` / `Promise.allSettled`)
- **R** = Retry violation (explicit retry loop — direct breach of `no-retry-policy` + new HEFF rule)
- **X** = Excluded (comment, generated string, page-owned, type-only reference)

## P0 — Loop fanout & retry violations (fix first)

| Sev | File:Line | Caller | Loop context | Notes |
|-----|-----------|--------|--------------|-------|
| **R** | `src/background/manifest-seeder.ts:399` | `fetch(url)` inside `for (attempt 1..MAX_RETRIES)` | retry loop | **Direct HEFF breach.** Remove retry loop; single attempt + fail-fast. |
| **F** | `src/background/boot.ts:343-352` | `Promise.all(stableScripts.map(path => fetch(url)))` | parallel fanout | Convert to sequential `for...of` with `break` on first non-2xx. |
| **F** | `src/background/cache-warmer.ts:47-75` | `Promise.allSettled(scripts.map(warmOneScript))` → `fetch(url)` | parallel fanout | `allSettled` masks failures; surface first 4xx/5xx and stop. |
| **F** | `src/background/builtin-script-guard.ts:213,236,268` | `fetch(instrAbsUrl)` + `fetch(scriptAbsUrl)` inside `for (scriptName of missingNames)` | sequential loop, no break | Add `break` on first non-2xx; report. |
| **F** | `src/background/script-resolver.ts:82,88` | `fetch(url)` inside `for (candidate of candidates)` | candidate enumeration | Acceptable to try next candidate ONLY on network error; 4xx/5xx must halt — currently does not. |
| **F** | `src/background/handlers/script-info-handler.ts:98,144,193` | `fetch(scriptUrl)` + `fetch(scriptUrl,{HEAD})` per-script | called per script in handler chain | Ensure single-call per request; verify caller does not invoke handler in a loop without break. |
| **F** | `src/background/manifest-seeder.ts:167,401` | `fetch(url)` inside `for (project)` / `for (scriptDef)` | seed fanout | Halt entire seed on first failure. |

## P1 — Single callers missing fail-fast guard

| Sev | File:Line | Notes |
|-----|-----------|-------|
| G | `src/background/boot.ts:250` | `fetch(BUILD_META_URL)` — already has try/catch fallback; verify it doesn't retry. |
| G | `src/background/wasm-integrity.ts:114` | Checksum fetch — must hard-fail integrity check on 4xx/5xx. |
| G | `src/background/db-manager.ts:109,234` | WASM HEAD + GET — single calls, add explicit status report. |
| G | `src/background/hot-reload.ts:82` | `fetch(metaUrl)` polled — verify poll interval halts on 4xx (esp. 405). |
| G | `src/background/handlers/updater-handler.ts:268,293` | Updater calls — must surface 4xx with full URL. |
| G | `src/background/handlers/config-auth-handler.ts:697` | Auth token fetch — already gated by `unified-auth-contract`; confirm no retry on 401. |
| G | `src/background/handlers/prompt-handler.ts:431` | Prompt fetch — single call. |
| G | `src/background/remote-config-fetcher.ts:115` | Remote config — single call, add HEFF report. |
| G | `src/background/recorder/step-library/result-webhook.ts:531` | Already governed by `webhook-fail-fast`. Just route error through shared type. |
| G | `src/components/options/ErrorSwallowAuditView.tsx:161` | UI audit fetch — surface status in banner. |
| G | `src/components/options/ScriptBundleDetailView.tsx:386` | Update-URL fetch — surface status. |
| G | `scripts/print-quality-badges.mjs:149` | Build-time script — must `process.exit(1)` on first 4xx/5xx (not loop to next badge). |
| G | `standalone-scripts/lovable-common/src/api/lovable-http.ts:62` | **Shared HTTP client.** Best place to install `httpFailFast()` once. |

## Page-owned / unsafe to wrap

| Sev | File:Line | Notes |
|-----|-----------|-------|
| X | `src/background/project-namespace-builder.ts:256-270` | Builds string-form `fetch()` injected into page world; page-owned at runtime, but the **string template** must include status check. Treat as P1 follow-up. |
| X | `standalone-scripts/marco-sdk/src/self-namespace.ts:162-190` | SDK exposed to user scripts; user owns retry policy. Document the contract; do not wrap. |
| X | `src/lib/generate-llm-guide.ts:278,495,507` | Example strings inside generated guide text — not executed. |
| X | `src/lib/developer-guide-data.generated.ts:466` | Generated doc string. |
| X | `src/platform/preview-adapter.ts:177,234` | Mock data string for preview UI. |
| X | `src/content-scripts/network-reporter.ts:6` | Comment only. |
| X | `standalone-scripts/macro-controller/src/**` (`ws-*.ts`, `loop-*.ts`, `credit-*.ts`, `rename-*.ts`, `workspace-detection.ts`) | Already migrated to `httpRequest()` (XHR+Promise wrapper) per `v7.40` headers. **Audit `httpRequest()` itself** in Step 3 to confirm it throws on non-2xx. |
| X | `standalone-scripts/macro-controller/src/core/CreditManager.ts:21` | `fetch()` is the local method name, not `window.fetch`. |
| X | `scripts/check-pascalcase-instruction-migration.mjs:382` | Doc comment. |

## Counts

- Total `fetch(`/XHR/axios call sites surfaced: **76 lines**
- Real distinct callers: **~38**
- P0 (fanout/retry): **7 sites**
- P1 (needs guard): **13 sites**
- Excluded (comment/generated/page-owned/already-wrapped): **18 sites**

## Step-3 helper plan (preview)

Two implementations sharing one contract:

```ts
// src/shared/http-fail-fast.ts          (extension code, fetch-based)
// standalone-scripts/macro-controller/src/shared/http-fail-fast.ts  (httpRequest-based)
export class HttpFailFastError extends Error {
  constructor(public status: number, public method: string, public url: string,
              public bodySnippet: string | null, public reason: string) { super(...); }
}
export async function httpFailFast(res: Response, ctx: { method: string; url: string }): Promise<Response>;
```

The shared client `standalone-scripts/lovable-common/src/api/lovable-http.ts:62` is the **single injection point** for the `lovable-common` layer — wrapping it covers ~all macro-controller traffic transitively.

## Out of scope for this plan

- Wrapping `marco-sdk` user-script HTTP surface (user-owned).
- Refactoring `httpRequest()` XHR wrapper internals (Step 3 will only add a status-check assertion).
- Network-reporter interception (read-only telemetry).

---

**Step 1 status:** complete. No code modified. Step 2 will classify each P1 row as wrap-in-place vs route-through-shared-client and produce the work order for Step 4.
