---
name: url-trigger-sentinel-cache
description: Three-trigger URL gate (load/refresh/activate) with per-tab fingerprint cache and DOM sentinel marker
type: architecture
---

# URL Trigger + Sentinel Cache (v2.244.0)

The extension evaluates URL match rules at **most three times** per page lifetime, never in a loop. Anything reading "does this extension apply here?" should use the cache or the sentinel — never re-run `evaluateUrlMatches()`.

## The three triggers (the only ones)

| ID | Source | When |
|----|--------|------|
| T1 | `webNavigation.onCompleted` (frameId === 0) | Initial page load |
| T2 | `webNavigation.onCommitted` where `transitionType === "reload"` | User refresh |
| T3 | `chrome.tabs.onActivated` | User switches tabs |

Hash-only navigation (`onReferenceFragmentUpdated`) is **NOT** wired — fingerprint strips hashes. `onHistoryStateUpdated` (pushState) is handled separately by `spa-reinject.ts` with its own dedup map.

## Dedup gate

`urlFingerprint(url)` = `origin + pathname + sorted(searchParams)`. Hash stripped. Sorted so `?a=1&b=2` ≡ `?b=2&a=1`.

`state-manager.isSameDecisionFingerprint(tabId, fp)` returns true → gate short-circuits. No log, no eval, no executeScript.

## DOM sentinel

`<div id="__marco_sentinel__" data-fp data-projects data-can-run data-trigger data-decided-at style="display:none">`

Appended once to `document.body` per (tab, fingerprint). Page-side scripts read it via `src/content-scripts/sentinel-reader.ts` (`readSentinel()`, `isExtensionApplicableHere()`).

**Trust model**: the sentinel is a HINT, not authority. A hostile page can spoof attributes. Background `tabDecisionCache` is the source of truth. Never gate privileged operations on the sentinel.

## Hard rules (do not violate)

- No `setInterval` polling — gates are event-driven only.
- No retry / no backoff inside listeners — fail-fast, log, return.
- Never `throw` from a chrome event listener — would unregister it.
- Sub-frames always ignored.
- `tabs.onRemoved` → `removeTabInjection(tabId)` → also clears `tabDecisionCache` entry (one call, both maps).

## Files

- `src/background/url-fingerprint.ts` — pure util + tests
- `src/background/url-trigger.ts` — the three listeners + sentinel injector
- `src/background/state-manager.ts` — `tabDecisionCache`, `getTabDecision`, `setTabDecision`, `isSameDecisionFingerprint`, `clearTabDecision`
- `src/content-scripts/sentinel-reader.ts` — page-side O(1) reader
- `src/background/spa-reinject.ts` — also uses `urlFingerprint` for its own pushState dedup (U-2)
- `src/background/cookie-watcher.ts` — 200ms trailing debounce (U-8)
- `standalone-scripts/macro-controller/src/spa-route-guard.ts` — page-side popstate/pushState guard; stops loop on project-id change or `pagehide` (U-5, v2.245.0). Idempotent via `window.__marcoRouteGuardInstalled`.

Audit: `.lovable/audits/2026-05-16-url-trigger-and-energy-audit.md`.
