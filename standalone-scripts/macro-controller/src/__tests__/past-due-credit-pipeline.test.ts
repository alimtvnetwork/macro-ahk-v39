/**
 * Issue 117 — End-to-end pipeline test using the exact JSON from the RCA.
 *
 * Spec: spec/22-app-issues/117-past-due-badge-credit-display-rca.md §4
 *
 * Feeds the verbatim Workspace + CreditBalance payload reported by the user
 * (A0064 D3v064 WG, workspace_01kq3zeytyeb88r0739ht84vvj) through:
 *
 *   pro-zero-credit-calculator  →  produces MacroCreditSummary
 *   →  WorkspaceCredit assembly (mirrors what enrichment writes)
 *   →  getEffectiveStatus / classifyFromStatus
 *   →  buildTierBadgeHtml
 *
 * Asserts every observable surface that was wrong in the screenshot:
 *   - AvailableCredits = 225 (NOT 5)
 *   - Status pill kind = refill-soon, label = "Refill 31d"
 *   - Single badge in the row (no red "EXPIRED" tier badge)
 *   - Invariant: total_remaining > 0 ⇒ ws.available > 0 after override
 *   - Invariant: row with status pill ⇒ no EXPIRED tier badge
 */

import { describe, it, expect } from 'vitest';
import { calculateProZeroCreditSummary } from '../pro-zero/pro-zero-credit-calculator';
import { CreditGrantType } from '../pro-zero/credit-grant-type';
import type { CreditBalanceResponseTyped } from '../pro-zero/credit-balance-response-typed';
import {
  getEffectiveStatus,
  shouldApplyCanceledOverride,
  applyCanceledCreditOverride,
} from '../workspace-status';
import { classifyFromStatus } from '../workspace-display-status';
import { buildTierBadgeHtml } from '../ws-list-renderer';
import type { WorkspaceCredit } from '../types';
import type { WorkspaceLifecycleConfig } from '../workspace-lifecycle-config';

// Fixed "now" matched to the user-reported subscription_status_changed_at so
// that billing_period_end - now = ~31 days (matches the screenshot label).
const NOW_MS = Date.parse('2026-05-26T08:00:00Z');

const RCA_CREDIT_BALANCE: CreditBalanceResponseTyped = {
  ledger_enabled: false,
  total_remaining: 225,
  total_granted: 225,
  daily_remaining: 5,
  daily_limit: 5,
  total_billing_period_used: 0,
  expiring_grants: [
    { grant_type: CreditGrantType.ROLLOVER, credits: 200, expires_at: '2026-06-26T08:00:00Z' },
    { grant_type: CreditGrantType.BILLING,  credits: 20,  expires_at: '2026-07-26T08:00:00Z' },
  ],
  grant_type_balances: [
    { grant_type: CreditGrantType.DAILY,    granted: 5,   remaining: 5   },
    { grant_type: CreditGrantType.BILLING,  granted: 20,  remaining: 20  },
    { grant_type: CreditGrantType.ROLLOVER, granted: 200, remaining: 200 },
  ],
};

const CFG: WorkspaceLifecycleConfig = {
  expiryGracePeriodDays: 30,
  refillWarningThresholdDays: 7,
  enableWorkspaceStatusLabels: true,
  enableWorkspaceHoverDetails: true,
};

function buildWsCreditFromSummary(): WorkspaceCredit {
  const summary = calculateProZeroCreditSummary(RCA_CREDIT_BALANCE, NOW_MS);

  // Mirror what pro-zero-enrichment.ts writes into WorkspaceCredit for a
  // past_due workspace with live grants.
  return {
    id: 'workspace_01kq3zeytyeb88r0739ht84vvj',
    name: 'A0064 D3v064 WG',
    fullName: 'A0064 D3v064 WG',
    dailyFree: summary.DailyRemaining,
    dailyUsed: 0,
    dailyLimit: summary.DailyLimit,
    rolloverUsed: 0,
    rolloverLimit: 200,
    freeGranted: 0,
    freeRemaining: 0,
    used: 0,
    limit: 20,
    topupLimit: 0,
    totalCredits: summary.Total,
    available: summary.AvailableCredits,
    rollover: summary.RolloverRemaining,
    billingAvailable: summary.BillingRemaining,
    hasFree: summary.DailyRemaining > 0,
    totalCreditsUsed: summary.TotalUsed,
    subscriptionStatus: 'past_due',
    subscriptionStatusChangedAt: '2026-05-26T06:18:47Z',
    plan: 'pro_0',
    role: 'owner',
    tier: 'EXPIRED', // tier resolver marks past_due workspaces as EXPIRED
    raw: {},
    rawApi: {},
    numProjects: 1,
    gitSyncEnabled: false,
    nextRefillAt: '',
    billingPeriodEndAt: '2026-06-26T05:17:43Z',
    createdAt: '2026-04-26T04:06:18Z',
    membershipRole: 'owner',
    planType: 'monthly',
  };
}

describe('Issue 117 — pipeline: RCA payload → credit summary → badge', () => {
  it('pro-zero calculator: AvailableCredits = 225 (full grant balance preserved)', () => {
    const summary = calculateProZeroCreditSummary(RCA_CREDIT_BALANCE, NOW_MS);
    expect(summary.Total).toBe(225);
    expect(summary.AvailableCredits).toBe(225);
    expect(summary.DailyRemaining).toBe(5);
    expect(summary.BillingRemaining).toBe(20);
    expect(summary.RolloverRemaining).toBe(200);
  });

  it('lifecycle override does NOT wipe credits for past_due with live grants', () => {
    const ws = buildWsCreditFromSummary();
    const status = getEffectiveStatus(ws, CFG, NOW_MS);
    expect(shouldApplyCanceledOverride(status)).toBe(false);
    applyCanceledCreditOverride(ws, status); // should be a no-op
    expect(ws.available).toBe(225);
    expect(ws.rollover).toBe(200);
    expect(ws.billingAvailable).toBe(20);
  });

  it('classifier returns refill-soon with label "Refill 31d"', () => {
    const ws = buildWsCreditFromSummary();
    const status = getEffectiveStatus(ws, CFG, NOW_MS);
    expect(status.kind).toBe('about-to-refill');
    const display = classifyFromStatus(status, ws, NOW_MS);
    expect(display.kind).toBe('refill-soon');
    expect(display.label).toBe('Refill 31d');
  });

  it('rendered badge HTML: single Refill pill, no EXPIRED tier badge', () => {
    const ws = buildWsCreditFromSummary();
    const html = buildTierBadgeHtml(ws);

    // No red EXPIRED tier badge (suppression rule from Step 3).
    expect(html).not.toContain('>EXPIRED<');
    // Exactly one status pill.
    const pillMatches = html.match(/class="marco-ws-status-pill/g) || [];
    expect(pillMatches.length).toBe(1);
    // Pill is the refill variant with the right label.
    expect(html).toContain('marco-ws-status-refill-soon');
    expect(html).toMatch(/>Refill 31d</);
  });

  /* -------- Regression invariants (live forever) --------------------- */

  it('INVARIANT: total_remaining > 0 ⇒ ws.available > 0 after override', () => {
    const ws = buildWsCreditFromSummary();
    expect(RCA_CREDIT_BALANCE.total_remaining).toBeGreaterThan(0);
    const status = getEffectiveStatus(ws, CFG, NOW_MS);
    applyCanceledCreditOverride(ws, status);
    expect(ws.available).toBeGreaterThan(0);
  });

  it('INVARIANT: any row that renders a status pill must NOT render the EXPIRED tier badge', () => {
    const ws = buildWsCreditFromSummary();
    const html = buildTierBadgeHtml(ws);
    const hasPill = /class="marco-ws-status-pill/.test(html);
    const hasExpiredTierBadge = />EXPIRED</.test(html);
    expect(hasPill).toBe(true);
    expect(hasExpiredTierBadge).toBe(false);
  });
});
