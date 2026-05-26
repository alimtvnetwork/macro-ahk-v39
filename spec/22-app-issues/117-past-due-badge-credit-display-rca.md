# Issue 117 — `past_due` Workspace Shows Wrong Badge & Zero Credits

**Status:** RCA (Step 1 of 5)
**Version target:** v3.24.0 (minor bump)
**Reporter sample:** `A0064 D3v064 WG` — `workspace_01kq3zeytyeb88r0739ht84vvj`
**Date:** 2026-05-26

---

## 1. Symptoms (from user screenshot + JSON payload)

The workspace row renders:

```
[ A0064 D3v064 WG ] [ EXPIRED ]  [ Expire 31d ]   ... 0 0 0 5 5/5
```

But the API payload for the same workspace says:

| Field | Value |
|---|---|
| `Workspace.plan` | `pro_0` |
| `Workspace.subscription_status` | `past_due` |
| `Workspace.subscription_status_changed_at` | `2026-05-26T06:18:47Z` (today) |
| `Workspace.billing_period_end_date` | `2026-06-26T05:17:43Z` (≈31d ahead) |
| `CreditBalance.total_remaining` | **225** |
| `CreditBalance.total_granted` | **225** |
| `CreditBalance.daily_remaining` | 5 / 5 |
| `CreditBalance.grant_type_balances` | `daily 5/5`, `billing 20/20`, `rollover 200/200` |
| `CreditBalance.expiring_grants[*].expires_at` | `2026-06-26` (rollover) & `2026-07-26` (billing) |

So:
1. **Two redundant lifecycle badges**: `EXPIRED` (red, tier) AND `Expire 31d` (amber, status pill) — the user already mandated (Issue 116 + Memory `mem://features/macro-controller/workspace-badge-display`) that only **one** flag should appear and that `EXPIRED` must never sit next to a status pill.
2. **Credit numbers wrong**: shows `0` rollover, `0` billing, `5/5` daily. Real spendable balance is **225**.

---

## 2. Root Cause

Two independent bugs in the same code path:

### 2a. Badge duplication (UI layer)

`standalone-scripts/macro-controller/src/ws-list-renderer.ts` → `buildTierBadgeHtml`

The v3.22.0 fix (Issue 116) only suppresses the red `EXPIRED` tier badge when the **display kind === `'canceled'`**:

```ts
if (wsTier === 'EXPIRED') {
  const display = classifyFromStatus(status, ws);
  if (display.kind === 'canceled') suppressTierBadge = true;   // <-- only canceled
}
```

For a `past_due` workspace, `classifyFromStatus` returns `'expire-soon'` (or `'expired'` once `daysSince > 0`), **not** `'canceled'`, so the red `EXPIRED` tier badge survives and is rendered next to the amber `Expire 31d` pill. The user's directive in this turn — *"just keep cancel flag. There is no need to keep the expired flag"* — means the suppression must extend to every non-normal display kind (`canceled`, `expired`, `expire-soon`, `refill-soon`). Whenever the status pill renders, the tier badge `EXPIRED` is by definition redundant.

### 2b. Zero-credit override on `past_due` (data layer)

`standalone-scripts/macro-controller/src/workspace-status.ts` → `shouldApplyCanceledOverride`

```ts
export function shouldApplyCanceledOverride(status: WorkspaceStatus): boolean {
  return status.kind === 'expired-canceled'
      || status.kind === 'fully-expired'
      || status.kind === 'expired'
      || status.kind === 'about-to-expire';   // <-- THIS
}
```

`about-to-expire` is the bucket for `subscription_status === 'past_due'`. The override zeros out `ws.rollover`, `ws.billingAvailable`, and recomputes `ws.available` from only `free + daily`. That is correct for **canceled** workspaces (subscription ended) but **wrong for `past_due`**:

- Stripe's `past_due` means the renewal payment failed but the **grants are still valid until their `expires_at`**.
- The API itself proves this: `total_remaining = 225`, `grant_type_balances.rollover.remaining = 200`, both `expiring_grants[*].expires_at` are weeks in the future.
- We are throwing away 220 spendable credits and forcing the user into the "no credits" fallback path even though they have a full month of credits.

The "Refill 31d" / "Expire 31d" pill computed from `billing_period_end_date` is also misleading — for a `past_due` row that still has credits, **`Refill 31d` is the correct label** (subscription will retry/renew on that date), not `Expire 31d`. Today the classifier picks `'expire-soon'` because `about-to-expire` short-circuits before the refill check in `getEffectiveStatus`.

### Why this slipped past existing tests

- `__tests__/workspace-status.test.ts` asserts that `applyCanceledCreditOverride` zeros credits but never asserts the **opposite** for `past_due` rows with live grants.
- `__tests__/ws-tier-badge-cancel-suppression.test.ts` (added v3.23.0) only covers the `canceled` display kind. No case exercises `EXPIRED` tier + `expire-soon` / `expired` display.
- No fixture wires the `CreditBalance` JSON shown above through the full pipeline (`pro-zero` adapter → enrichment → list renderer).
- No E2E asserts what a `past_due` row visually shows.

---

## 3. Fix Plan (executed across Steps 2-5)

| Step | Change |
|---|---|
| **2** | **Data fix.** Narrow `shouldApplyCanceledOverride` to only fire for genuinely-dead workspaces (`canceled` / `expired` / `fully-expired`). Add a separate helper `isPastDueWithLiveGrants(ws)` that checks `CreditBalance.total_remaining > 0` OR `expiring_grants[*].expires_at > now`. Reroute `past_due` rows in `getEffectiveStatus` so that when grants are still live the row reports `about-to-refill` using `billing_period_end_date` (label becomes "Refill Nd" instead of "Expire Nd"). Add unit tests for both. |
| **3** | **UI fix.** In `buildTierBadgeHtml`, suppress the `EXPIRED` tier badge whenever **any** status pill renders (`display.kind !== 'normal'`). Add unit tests covering `expire-soon`, `expired`, `refill-soon`, `canceled`, and `normal`. |
| **4** | **Pipeline test.** Add an integration test that feeds the exact JSON from this RCA through `adaptWorkspaceInfoTyped` + `pro-zero-credit-calculator` + `buildTierBadgeHtml` + `buildStatusPillHtml` and asserts: one badge only, label `Refill 31d`, `available=225`, `rollover=200`, `billingAvail=20`, `dailyFree=5`. |
| **5** | **E2E + release.** Add `tests/e2e/specs/past-due-workspace-badge.spec.ts` exercising the rendered DOM with the same fixture. Bump version 3.23.0 → 3.24.0, sync all version files, pin in `readme.md`, append `changelog.md` entry referencing this RCA. |

---

## 4. Regression Guard

- New invariants test (`__tests__/badge-credit-invariants.test.ts`):
  - "Any row with `total_remaining > 0` MUST have `available > 0` in the rendered model."
  - "Any row that renders a `marco-ws-status-pill` MUST NOT also render the `EXPIRED` tier badge."
- Both invariants are wired into the existing Vitest suite so CI fails immediately if a future refactor reintroduces either bug.

---

## 5. Affected Files (for Steps 2-5)

- `standalone-scripts/macro-controller/src/workspace-status.ts`
- `standalone-scripts/macro-controller/src/ws-list-renderer.ts`
- `standalone-scripts/macro-controller/src/__tests__/workspace-status.test.ts` (extend)
- `standalone-scripts/macro-controller/src/__tests__/ws-tier-badge-cancel-suppression.test.ts` (extend)
- `standalone-scripts/macro-controller/src/__tests__/past-due-credit-pipeline.test.ts` (new)
- `standalone-scripts/macro-controller/src/__tests__/badge-credit-invariants.test.ts` (new)
- `tests/e2e/specs/past-due-workspace-badge.spec.ts` (new)
- `manifest.json`, all `instruction.ts`, `shared-state.ts`, `constants.ts` — version bump
- `readme.md`, `changelog.md` — pin + changelog entry
