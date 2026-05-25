# Issue 98: Payment Banner Hider — Coding Guideline Violation RCA + Refactor Brief

**Version**: v2.228.0 (issue logged) — refactor target: next minor
**Date**: 2026-04-24
**Status**: Open — refactor pending sign-off
**Reference file**: `standalone-scripts/payment-banner-hider/src/index.ts`
**Upstream**: https://github.com/alimtvnetwork/macro-ahk-v37/blob/main/standalone-scripts/payment-banner-hider/src/index.ts

---

## Issue Summary

### What happened

The `payment-banner-hider` standalone script was written in a single pass without consulting the existing standards. The resulting `src/index.ts` violates **eight** documented project rules simultaneously: `!important` spam, error swallowing, inline `<style>` injection, free-function entry point, magic strings, `as unknown` cast, missing blank-line-before-return, and unjustified `requestAnimationFrame` usage.

### Where it happened

- **Feature**: Payment Banner Hider (auto-hides "Payment issue detected." sticky banner on lovable.dev)
- **Files**: `standalone-scripts/payment-banner-hider/src/index.ts` (sole file — no `css/`, no class split, no `instruction.ts` typing pass)
- **Functions**: `injectStyles()`, `getTargetNode()`, `hideBanner()`, `checkAndHide()`, `startObserver()` — all top-level free functions

### Symptoms and impact

- Style overrides cannot be themed or customised because every rule carries `!important`.
- Failures inside `getTargetNode()` are silently swallowed — `catch { return null; }` — so a broken XPath is invisible in diagnostics.
- The handled-state machine uses raw string literals (`"fading"`, `"hiding"`, `"done"`) that drift from any consumer.
- `(window as unknown as { PaymentBannerHider: typeof PaymentBannerHider }).PaymentBannerHider = …` defeats the type system at the publish site.
- Inline `<style>` blob bypasses the build pipeline (no autoprefixer, no minification, no source map, no LESS compile).
- Free-function design makes injection of test doubles or alternative matchers impossible.

### How it was discovered

User code review on 2026-04-24 — see verbatim instruction stored alongside this RCA in `.lovable/memory/rca/`.

---

## Root Cause Analysis

### Direct cause

The agent generated the file by drafting from intuition rather than from the standards index. It produced "code that works in the browser" rather than "code that complies with the project standards." Each violation has a corresponding documented rule that was not consulted:

| Violation in `index.ts` | Rule that already existed |
|---|---|
| `!important` (16 occurrences) | `mem://standards/no-css-important` |
| `catch { return null; }` in `getTargetNode()` | `mem://standards/no-error-swallowing`, `mem://standards/error-logging-via-namespace-logger` |
| Inline `<style>` injection in `injectStyles()` | `mem://standards/standalone-scripts-css-in-own-file` |
| Free-function entry point (no `class`) | `mem://standards/class-based-standalone-scripts` |
| Magic strings `"fading"` / `"hiding"` / `"done"` | `mem://standards/code-quality-improvement` (CQ3) |
| `as unknown as { … }` on `window` | `mem://standards/no-type-casting`, `mem://standards/unknown-usage-policy` |
| Missing blank line before multiple `return` | `mem://standards/blank-line-before-return` |
| `requestAnimationFrame` with no documented animation reason | (new — added by this RCA) |

### Contributing factors

1. **Standards index not consulted** before writing. `mem://standards/pre-write-check` is the explicit precondition for new files; it was bypassed.
2. **Sibling files not read.** `standalone-scripts/macro-controller` and `standalone-scripts/xpath` already demonstrate the class-based + sibling-CSS pattern. Neither was opened.
3. **"Move fast" framing.** The task was treated as a tiny one-off because the visible output is small (~100 lines). The standards apply equally to small files.
4. **No pre-merge grep.** The four standards (`no-css-important`, `no-type-casting`, `standalone-scripts-css-in-own-file`, `no-error-swallowing`) all explicitly mandate a pre-merge grep (`!important`, `\bas [A-Z]`, `<style`, `catch \{`). None ran.
5. **`requestAnimationFrame` cargo-culted from animation tutorials** — used to "force a paint" before applying a class change, but the same effect is achieved by toggling a class once when the CSS transition is already declared.

### Triggering conditions

Any new standalone script written without first executing the `pre-write-check` workflow (read `.lovable/memory/standards/`, read at least one sibling file, restate compliance in the response).

### Why the existing spec did not prevent it

The standards exist and are correct — every violation maps to a documented rule. The gap is **enforcement**: there is no automated lint that runs across `standalone-scripts/**` blocking `!important`, `as `, `<style`, or `catch \{` patterns. Until the planned ESLint config (`plan.md` Task 0.8) is wired, the precondition rests entirely on the agent reading the standards before writing — and that step was skipped.

---

## Required Refactor (acceptance criteria)

### 1. Class structure
- `PaymentBannerHider` is the **single entry point** and the only top-level export besides bootstrapping.
- Helpers split into their own classes and **constructor-injected**:
  - `BannerMatcher` — XPath resolution + text-content match (returns `HTMLElement | undefined`, never `null`-as-sentinel-on-error).
  - `BannerObserver` — wraps `MutationObserver` lifecycle (`start()`, `stop()`).
  - `BannerHidingStrategy` — applies the `hide` class; nothing else.
- No top-level free functions. Bootstrap is `new PaymentBannerHider({ matcher, observer, strategy }).start();`.

### 2. Hiding mechanism
- Single CSS class `hide` with `display: none` and a CSS transition. No inline styles. No `!important`.
- All rules live in `standalone-scripts/payment-banner-hider/css/payment-banner-hider.css`.
- Referenced from `instruction.ts` via `assets.css: [{ file: "css/payment-banner-hider.css", injectInto: AssetInjectTarget.Head }]`.

### 3. Enum usage (no magic strings)
- `BannerSelector` enum for selectors (XPath, attribute hooks).
- `BannerClassName` enum for class names (`Hide`, `HandledHook`).
- `BannerEvent` enum for events (`MutationDetected`, `Matched`, `Hidden`).
- `BannerState` enum for state values (`Pending`, `Matched`, `Hidden`).
- Globally registered enums (anything `RiseupAsiaMacroExt` exposes) live in `globals.d.ts` under `declare global { … }` — no module-local copies.

### 4. Error handling
- `catch` blocks call `RiseupAsiaMacroExt.Logger.error("PaymentBannerHider.<method>", "<reason>", caught)` and either rethrow or return a typed `Result.err(...)`.
- No `catch { return null; }`. No `catch (_) {}`.

### 5. Type safety
- No `as unknown as T`. No `expression as T` (other than `as const`).
- `window` extension done via `declare global { interface Window { PaymentBannerHider?: PaymentBannerHider } }` — no cast at the assignment site.

### 6. Formatting
- Blank line before every `return` that is not the first statement in its block.
- CQ14 braces, CQ15 newlines, defensive property access (`?.`, `??`).

### 7. No `requestAnimationFrame`
- Removed entirely. The CSS transition on the `hide` class handles animation timing without forcing a paint from JS.

### 8. File layout
```
standalone-scripts/payment-banner-hider/
├── css/
│   └── payment-banner-hider.css
├── src/
│   ├── index.ts          ← imports, enums (or import from global), class definitions, bootstrap
│   ├── banner-matcher.ts
│   ├── banner-observer.ts
│   ├── banner-hiding-strategy.ts
│   └── instruction.ts    ← assets.css reference
```

### 9. CSS section content (minimum)
```css
.marco-banner-hider {
    transition: opacity 200ms ease, visibility 200ms ease;
}
.marco-banner-hider.hide {
    display: none;
    opacity: 0;
    visibility: hidden;
}
```
No `!important` anywhere. Use `[data-marco-banner-hider]` scoping to win specificity.

---

## Acceptance Criteria (final review checklist)

| # | Criterion | Status |
|---|---|---|
| AC-1 | Zero occurrences of `!important` in any file under `standalone-scripts/payment-banner-hider/` | ☐ |
| AC-2 | Zero `catch` blocks return `null` / `undefined` / silent default | ☐ |
| AC-3 | Every non-first `return` is preceded by a blank line | ☐ |
| AC-4 | Zero `requestAnimationFrame` usage (or each one carries a justifying comment) | ☐ |
| AC-5 | Hiding implemented exclusively by toggling the `hide` class | ☐ |
| AC-6 | All logic lives inside `PaymentBannerHider` or classes injected into it | ☐ |
| AC-7 | No magic strings — selectors, class names, events, states are enums | ☐ |
| AC-8 | Globally registered enums live in `globals.d.ts` under `declare global` | ☐ |
| AC-9 | Zero `as unknown` and zero general `as` casts (except `as const`) | ☐ |
| AC-10 | Dedicated `css/payment-banner-hider.css` exists, referenced from `instruction.ts` | ☐ |
| AC-11 | RCA stored in memory + standards updated (this document) | ☑ |
| AC-12 | New rule added: always read coding guideline + previous code before writing | ☑ (already in `pre-write-check`) |

---

## Spec rules added by this RCA

1. **`requestAnimationFrame` requires a documented justification.** Default-deny; the comment must explain why a CSS transition or a single class toggle is insufficient.
2. **Pre-merge greps are mandatory** for new standalone scripts: `!important`, `\bas [A-Z](?!const)`, `<style`, `catch \{`, `catch \(_\) \{` — any hit blocks the change.

---

```
if you have any question and confusion, feel free to ask, and if you are creating tasks for creating multiple tasks, and if it is bigger ones, then uh do it in a way so that if we say next, you do those remaining tasks. Do you understand? Always add this part at the end of the writing inside the code block. Do you understand? Can you please do that?
```
