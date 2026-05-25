---
name: injection-pipeline-split-session
description: Session log — injection pipeline split + recorder xpath batch protocol (PERF-R6); steps 1-8 done, 9-10 (E2E) pending
type: feature
---

# Injection Pipeline Split + Recorder XPath Batch Session

10-step plan tracked across multiple `next` sessions. Outcome: pipeline split into a dedicated runner module, recorder writes coalesced into batched IPC, integration tests landed, build errors swept.

## Steps

| # | Step | Status |
|---|------|--------|
| 1 | Preflight checks added to injection handler | ✅ Done |
| 2 | Result builder extracted | ✅ Done |
| 3 | Injection pipeline split into `injection-pipeline.ts` | ✅ Done |
| 4 | Handler delegates to pipeline runner | ✅ Done |
| 5 | Regression test `injection-pipeline.test.ts` | ✅ Done |
| 6 | PERF-R6 — `xpath-capture-coalescer.ts` + batch message type | ✅ Done |
| 7 | Recorder capture batch handler + registry wiring | ✅ Done |
| 8 | Integration tests `recorder-xpath-batch.test.ts` (14 cases) | ✅ Done |
| 9 | E2E `tests/e2e/e2e-21-injection-pipeline-split.spec.ts` (skeleton, test.skip) | ✅ Done |
| 10 | E2E `tests/e2e/e2e-22-recorder-xpath-batch.spec.ts` (skeleton, test.skip) | ✅ Done |

## Key files
- `src/background/handlers/injection-handler.ts` — thin delegator
- `src/background/handlers/injection-pipeline.ts` — preflight + run + result builder
- `src/content-scripts/xpath-capture-coalescer.ts` — debounce, MAX_BATCH=8, serialized `flushNow()`
- `src/background/handlers/recorder-capture-handler.ts` — `handleRecorderCapturePersistBatch`
- `src/shared/messages.ts` + `src/background/message-registry.ts` — `RECORDER_CAPTURE_PERSIST_BATCH`
- `src/test/regression/injection-pipeline.test.ts`
- `src/test/regression/recorder-xpath-batch.test.ts`

## TypeScript sweep (build error cleanup)
- `src/platform/chrome-api-types.ts` — added `chrome.scripting`, `chrome.userScripts` (incl. `execute`, `worldId`), `chrome.storage.session`; broadened `tabs.query` and `storage.local.get`.
- `src/background/bg-logger.ts` — `type CaughtError = unknown` (resolved ~12 errors).
- Targeted casts in `csp-fallback.ts`, `settings-handler.ts`, `state-manager.ts`, `pages/Options.tsx` for stricter `@types/chrome` namespace conflicts.

## CI fix
- Uppercase `.md` lint failure — `CHANGELOG.md` → `changelog.md`; refs updated in `scripts/bump-version.mjs` and `standalone-scripts/types/instruction/primitives/schema-version.ts`. CI `find … | grep '[A-Z]'` now clean.

## Next session resume point
Implement **Step 9**: `e2e-21-injection-pipeline-split.spec.ts` — playwright E2E that loads the extension, triggers script injection on a fixture page, and asserts the timing/structure boundaries between preflight, run, and result-builder stages. Then **Step 10**: `e2e-22-recorder-xpath-batch.spec.ts` — drive the recorder, capture ≥8 events quickly, assert single batch IPC + correct sequencing.
