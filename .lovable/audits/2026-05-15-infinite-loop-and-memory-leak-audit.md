# Infinite-Loop & Memory-Leak Audit — 2026-05-15

**Scope**: `scripts/`, `standalone-scripts/`, `src/background/`, `src/content-scripts/`.
**Trigger**: Browser crashes / freezes reported by user during long sessions.
**Method**: Static scan for `setInterval`, recursive `setTimeout`, `requestAnimationFrame`,
`MutationObserver`, `while(true)`, unbounded arrays/maps. 163 timer call-sites,
119 listener/observer call-sites, 45 cleanup call-sites surveyed.

Every `while(true)` (`step-wait.ts:385`, `library-handler.ts:398`) has a guarded
exit; no truly unbounded loops were found. Findings below are **performance and
leak risks** — not crash bugs by themselves, but plausible cumulative causes of
the freezes.

---

## P0 — workspace-observer can self-reschedule without a cap

**File**: `standalone-scripts/macro-controller/src/workspace-observer.ts:227,277,311`

`startWorkspaceObserver()` resets `wsObserverState.retryCount = 0` on every
**successful** install (line 227). Two re-entry points then call
`setTimeout(startWorkspaceObserver, …)` again:

- `scheduleObserverRetry()` (line 277) — element-not-found retry, capped at
  `WORKSPACE_OBSERVER_MAX_RETRIES` ✅
- `handleObserverMutation()` (line 311) — fires whenever the nav element is
  removed from the DOM, **uncapped**, every 2 s.

If the host SPA briefly re-mounts and re-removes the nav element (Lovable's
preview refresh cycle does exactly this), the chain becomes:

```text
install → mutation: nav removed → setTimeout(2 s)
       → install (retryCount = 0) → mutation: nav removed → setTimeout(2 s) → …
```

Forever, every 2 s, with a fresh `MutationObserver` + closure each round.
Detached observers from previous rounds are GC-able only if the closure chain
is broken — which it isn't, because `wsObserverState.instance` retains the
latest one and the `setTimeout` chain retains the next.

**Fix**: track a separate `mutationReinstallCount` that does **not** reset on
successful install, cap at e.g. 10 within a 60 s rolling window, then surface a
log + stop. Or back off (2 s → 10 s → 60 s).

---

## P1 — recorder-toolbar 1 Hz timer ignores tab visibility

**File**: `src/background/recorder/recorder-toolbar.ts:274`

```ts
const tickInterval = window.setInterval(() => { renderHealth(); }, 1000);
```

`Destroy()` clears it, but as long as the toolbar exists the timer ticks once
per second on **every tab the recorder ever attached to**, including
backgrounded tabs and bfcache-frozen pages. PERF-5 (2026-04-25) already fixed
the same class of bug in `network-reporter.ts` via `pagehide` + visibility
gating. Apply the same pattern here:

- pause when `document.hidden === true`
- stop on `pagehide`
- consider 5 s cadence — health text is human-readable, 1 Hz is overkill.

---

## P1 — startup-persistence MutationObserver never disconnects

**File**: `standalone-scripts/macro-controller/src/startup-persistence.ts:101-108`

```ts
const observer = new MutationObserver(…);
observer.observe(observeTarget, { childList: true });
```

Lifetime = page lifetime, no `disconnect()` path. On Lovable preview pages the
`<body>` `childList` churns frequently (toast portals, dialog mounts), and each
mutation triggers `scheduleReinject()` → `setTimeout` + `requestIdleCallback`.
The debounce cancels stale ones, but the observer callback itself still runs
on every mutation and reads two `getElementById`s.

**Fix**:
1. observe a stable inner container (`#root`) when present, never `body`.
2. expose a `teardown()` that disconnects on `pagehide` for parity with the
   recorder-toolbar fix.

---

## P2 — marco-sdk `pollUntil` uses native `setInterval`

**File**: `standalone-scripts/marco-sdk/src/utils.ts:212`

The macro-controller copy of `pollUntil` (`async-utils.ts:230`) uses
`trackedSetInterval` so leaks show up in the IntervalRegistry heartbeat. The
SDK copy uses native `setInterval` and is therefore invisible to diagnostics.
A leaked SDK poll (caller forgets to unsubscribe, throws inside `condition`
that masks `clearInterval`) silently runs for the page lifetime.

**Fix**: wrap the SDK timer in a tiny tracker (or expose
`trackedSetInterval` from a shared util consumed by both packages).

---

## P2 — message-relay outstanding-callback unboundedness

**File**: `src/content-scripts/message-relay.ts:187`

`chrome.runtime.sendMessage(message, cb)` — the relay enforces a **per-window
sliding rate limit on inbound messages** but does not track outstanding
callbacks. When the MV3 service worker is asleep or recycling, callbacks queue
in V8; nothing prevents thousands of pending closures + payloads from piling
up if the page sends faster than the worker drains.

**Fix**: track in-flight count, drop with a clear error response after e.g.
50 outstanding requests per window. Existing rate limit already gives us the
hook — just gate on `inFlight` too.

---

## P2 — `setTimeout` chains in macro-controller (audit table)

83 `setTimeout` call sites surveyed. None recursively schedule themselves —
all are one-shot UI affordances (clipboard icon reset, dropdown auto-hide,
URL.revokeObjectURL after download, etc.). No findings.

---

## Verified clean

- `while(true)` in `step-wait.ts` and `library-handler.ts` — bounded.
- `interval-registry.ts` heartbeat — self-quietens when `entries.size === 0`.
- `notify._queue` — capped by `MAX_VISIBLE`; `_recentErrors` capped by
  `RECENT_MAX`; `_recentToasts` Map purged by self-stopping 30 s timer.
- `home-screen` rebuild observer — disconnected via teardowns.
- `loop-controls.startStatusRefresh` — period change correctly tears down
  the previous tracked interval before re-installing.
- `hover-highlighter` RAF loop — single-flight via `state.RafToken`.
- `network-reporter` flush — PERF-5 already fixed (re-injection guard +
  `pagehide` cleanup).

---

## Priority summary

| ID  | File                                  | Severity | Suggested fix |
|-----|---------------------------------------|----------|---------------|
| L-1 | workspace-observer.ts (handleObserverMutation) | P0 | Uncapped reset on mutation re-install — add bounded counter + backoff |
| L-2 | recorder-toolbar.ts (renderHealth tick) | P1 | Visibility gate + `pagehide` cleanup; 5 s cadence |
| L-3 | startup-persistence.ts (MutationObserver) | P1 | Observe `#root` not `body`; expose teardown |
| L-4 | marco-sdk/utils.ts (pollUntil)         | P2 | Use a tracked interval wrapper |
| L-5 | message-relay.ts (sendMessage)         | P2 | In-flight callback cap |

All five are added to `.lovable/plan.md` under **Stability — Loop & Leak
Prevention (2026-05-15)**.

---

## Resolution — v2.243.0 (2026-05-15)

All 5 findings (L-1 … L-5) are fixed. See `changelog.md` § v2.243.0 for the
per-item summary and the files touched.
