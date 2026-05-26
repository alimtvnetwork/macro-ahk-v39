/**
 * v3.23.0 — Issue 116 RCA test.
 *
 * Asserts that `buildTierBadgeHtml` SUPPRESSES the red "EXPIRED" tier
 * badge when the row also carries the muted "Cancel" status pill — so
 * canceled workspaces render a single badge instead of "EXPIRED + Cancel".
 *
 * Regression guard for the screenshot reported by the user (workspaces
 * P0888, P0891, P0092 each showing both an `EXPIRED` red pill and a
 * `Cancel` gray pill side-by-side).
 */

import { describe, it, expect } from 'vitest';
import { buildTierBadgeHtml } from '../ws-list-renderer';
import type { WorkspaceCredit } from '../types';

function makeWs(overrides: Partial<WorkspaceCredit> = {}): WorkspaceCredit {
  return {
    id: 'ws_test', name: 'Test', fullName: 'Test Workspace',
    dailyFree: 0, dailyUsed: 0, dailyLimit: 0,
    rolloverUsed: 0, rolloverLimit: 0,
    freeGranted: 0, freeRemaining: 0,
    used: 0, limit: 0, topupLimit: 0,
    totalCredits: 0, available: 0, rollover: 0, billingAvailable: 0,
    hasFree: false, totalCreditsUsed: 0,
    subscriptionStatus: 'active', subscriptionStatusChangedAt: '',
    plan: 'pro_1', role: 'owner', tier: 'PRO',
    raw: {}, rawApi: {},
    numProjects: 0, gitSyncEnabled: false, nextRefillAt: '',
    billingPeriodEndAt: '', createdAt: '', membershipRole: '', planType: 'monthly',
    ...overrides,
  };
}

describe('Issue 116 — Cancel suppresses redundant EXPIRED tier badge', () => {
  it('tier=EXPIRED + subscriptionStatus=canceled → renders single Cancel pill, no EXPIRED badge', () => {
    const ws = makeWs({
      tier: 'EXPIRED',
      subscriptionStatus: 'canceled',
      subscriptionStatusChangedAt: '2026-04-20T00:00:00Z',
    });
    const html = buildTierBadgeHtml(ws);

    // The red "EXPIRED" tier badge must NOT appear.
    expect(html).not.toContain('>EXPIRED<');
    // The muted "Cancel" status pill MUST appear, exactly once.
    const cancelMatches = html.match(/>Cancel</g) || [];
    expect(cancelMatches.length).toBe(1);
    // The dark-red tier-badge background must NOT appear (would imply
    // the EXPIRED tier badge slipped through).
    expect(html).not.toContain('#7f1d1d');
  });

  it('Issue 117: tier=EXPIRED + past_due empty wallet → suppresses EXPIRED, shows only Expire/Expired pill', () => {
    const ws = makeWs({
      tier: 'EXPIRED',
      subscriptionStatus: 'past_due',
      subscriptionStatusChangedAt: '2026-05-20T00:00:00Z',
    });
    const html = buildTierBadgeHtml(ws);
    expect(html).not.toContain('>EXPIRED<');
    expect(html).not.toContain('#7f1d1d');
    expect(html).toMatch(/marco-ws-status-(expired|expire-soon)/);
  });

  it('Issue 117: tier=EXPIRED + past_due with live grants → suppresses EXPIRED, shows Refill pill', () => {
    const ws = makeWs({
      tier: 'EXPIRED',
      subscriptionStatus: 'past_due',
      subscriptionStatusChangedAt: '2026-05-20T00:00:00Z',
      available: 225, rollover: 200, billingAvailable: 20,
      billingPeriodEndAt: new Date(Date.now() + 31 * 86_400_000).toISOString(),
    });
    const html = buildTierBadgeHtml(ws);
    expect(html).not.toContain('>EXPIRED<');
    expect(html).toContain('marco-ws-status-refill-soon');
    expect(html).toMatch(/>Refill \d+d</);
  });

  it('Issue 117: tier=EXPIRED + refill-soon (active) → suppresses EXPIRED, shows Refill pill', () => {
    const ws = makeWs({
      tier: 'EXPIRED',
      subscriptionStatus: 'active',
      nextRefillAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    const html = buildTierBadgeHtml(ws);
    expect(html).not.toContain('>EXPIRED<');
    expect(html).toContain('marco-ws-status-refill-soon');
  });

  it('Issue 117: tier=EXPIRED + no lifecycle event (normal) → KEEPS EXPIRED tier badge', () => {
    const ws = makeWs({
      tier: 'EXPIRED',
      subscriptionStatus: 'active',
    });
    const html = buildTierBadgeHtml(ws);
    expect(html).toContain('>EXPIRED<');
  });

  it('tier=PRO + canceled (non-EXPIRED tier) → tier badge kept (no suppression regression)', () => {
    const ws = makeWs({
      tier: 'PRO',
      subscriptionStatus: 'canceled',
      subscriptionStatusChangedAt: '2026-04-20T00:00:00Z',
    });
    const html = buildTierBadgeHtml(ws);
    expect(html).toContain('>PRO<');
    expect((html.match(/>Cancel</g) || []).length).toBe(1);
  });
});
