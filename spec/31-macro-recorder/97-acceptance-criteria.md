# Macro Recorder — Acceptance Criteria Index

> Authoritative list of every AC-19.* identifier defined under
> `spec/31-macro-recorder/`. Tests, code reviewers, and downstream LLM
> agents MUST cite these IDs verbatim — the `AC-<spec>.<section>.<n>` shape
> is load-bearing for cross-document traceability.

**Source**: `spec/31-macro-recorder/19-url-tabs-appearance-waits-conditions.md`
**Status**: Spec'd; implementation phased per `.lovable/plan.md` rows 19.1 (✅) / 19.2 / 19.3 / 19.4 (✅) / 19.5 / 19.6.

---

## Spec 19 — URL Tabs, Appearance Waits, Condition Rules

### §1.6 URL Tab Clicks (`StepKindId = 9`)

| ID | Summary |
|---|---|
| **AC-19.1.1** | Capture: `<a target="_blank" href="…">` → `UrlTabClick` step with `Mode = "OpenNew"` and a derived URL pattern. |
| **AC-19.1.2** | Capture: `window.open(url)` → `UrlTabClick` step whose `UrlPattern` matches `url`. |
| **AC-19.1.3** | Replay `Mode = "FocusExisting"` against a workspace with a matching tab → focuses that tab (no new tab created). |
| **AC-19.1.4** | Replay `Mode = "FocusExisting"` against a workspace with **no** matching tab → fails with `TabNotFound`. |
| **AC-19.1.5** | Replay `Mode = "OpenOrFocus"` opens a new tab when none match; focuses the first match when one or more exist. |
| **AC-19.1.6** | Replay `DirectOpen = true` with `Url` empty → fails with `InvalidUrlPattern` (no fallback to capture-derived pattern). |
| **AC-19.1.7** | A `Regex` pattern that throws on `new RegExp(...)` is rejected at save time with `InvalidUrlPattern`. |
| **AC-19.1.8** | When the new tab opens but its final URL never matches the pattern within `Timeout` → `UrlTabClickTimeout`. |
| **AC-19.1.9** | Pattern matching is case-sensitive for path/query and case-insensitive for scheme/host (matches WHATWG URL semantics). |
| **AC-19.1.10** | `executeUrlTabClick` rebinds the runner's active tab handle to the resolved tab before returning. |

### §2.4 Element-Appearance Waiting (`waitForCondition`)

| ID | Summary |
|---|---|
| **AC-19.2.1** | A step with `Gate = { Condition: Visible(sel), TimeoutMs, OnTimeout: "Fail" }` polls until the element is visible or timeout. |
| **AC-19.2.2** | `OnTimeout = "Fail"` produces a failure report with `Reason = "GateTimeout"` plus the full condition trace. |
| **AC-19.2.3** | `OnTimeout = "Skip"` skips the step's actuation and continues; the skip is logged but not treated as a failure. |
| **AC-19.2.4** | A legacy `WaitFor`-only row is read by the runner as an `Exists` gate (back-compat shim, no migration required). |
| **AC-19.2.5** | `PollMs < 1` is rejected at save time with `InvalidPollInterval`. |
| **AC-19.2.6** | The waiter polls at least twice before timing out, even when `TimeoutMs < PollMs * 2` (one initial probe + one retry). |
| **AC-19.2.7** | When the wait succeeds, the failure report module records the elapsed poll count + final match for verbose-logging diagnostics. |

### §3.7 XPath/CSS Conditional Rules (`validateCondition`)

| ID | Summary |
|---|---|
| **AC-19.3.1** | A leaf predicate with no `SelectorKind` and a selector starting with `/` or `(` auto-detects as `XPath`. |
| **AC-19.3.2** | A leaf predicate with no `SelectorKind` and any other selector auto-detects as `Css`. |
| **AC-19.3.3** | `Visible` returns `false` for a `display:none` element (matches spec 18 visibility predicate). |
| **AC-19.3.4** | `Count.gte` against a snapshot of `N` elements returns `true` iff `N >= threshold`. |
| **AC-19.3.5** | `All:[]` evaluates to `true`; `Any:[]` evaluates to `false` (vacuous-truth conventions). |
| **AC-19.3.6** | A condition tree of depth ≥ 9 is rejected at save with `ConditionTooDeep` (perf guard, spec §3.6). |
| **AC-19.3.7** | A `TextRegex` predicate with `Pattern = "(unclosed"` is rejected at save with `InvalidRegex`. |
| **AC-19.3.8** | A failed `waitForCondition` returns a `ConditionFailureRecord` carrying every leaf's evaluated value + selector match count. |
| **AC-19.3.9** | `evaluateCondition` invoked with a `Trace[]` accumulator argument appends one entry per leaf evaluated (in evaluation order). |
| **AC-19.3.10** | The runner refuses to persist a step whose `Gate.Condition` references a `SelectorId` that does not exist in the same project. |

---

## Implementation status (mirrors `.lovable/plan.md` § Macro Recorder Spec 19)

| Task | Description | Status | ACs covered |
|------|-------------|--------|-------------|
| 19.1 | `UrlTabClick` capture + replay | ✅ 2026-04-27 | AC-19.1.1 .. AC-19.1.10 (replay-side suite green; capture suite green) |
| 19.2 | Unify appearance waits behind `waitForCondition` | 📋 Spec'd | AC-19.2.1 .. AC-19.2.7 |
| 19.3 | `validateCondition` + `ConditionFailureRecord` | 📋 Spec'd | AC-19.3.1 .. AC-19.3.10 |
| 19.4 | Migration `005` — seed `StepKind (9, 'UrlTabClick')` | ✅ 2026-04-27 | (schema-level — no AC-19.* row, covered by migration test) |
| 19.5 | Step inspector UI for `UrlTabClick` editor | 📋 Spec'd | (UI — covered indirectly by AC-19.1.*) |
| 19.6 | Append AC-19.* into `97-acceptance-criteria.md` + LlmGuide cookbook | ✅ 2026-05-16 (this file) | (meta) |

---

## How to add a new AC row

1. Add the bullet in the originating spec section (e.g. `spec/31-macro-recorder/19-…md` §1.6).
2. Append a row to the matching table above, in numeric order.
3. If a new section is being introduced, add a fresh `### §X.Y …` block and update the "Implementation status" table.
4. Update `spec/31-macro-recorder/llm-guide.md` Section 11 (Spec 19 cookbook) only if the new behavior changes the **how-to** flow, not just the contract.

Numbering rule: `AC-<spec-number>.<section-number>.<n>` — strictly sequential within a section, never renumbered after publication.
