/**
 * Unit tests for workspace-status.ts (Phase 2)
 *
 * Spec: spec/22-app-issues/workspace-status-tooltip/01-overview.md
 */

import { describe, it, expect } from 'vitest';
import {
  daysBetween,
  daysUntil,
  formatDateDDMMMYY,
  formatDayCount,
  getEffectiveStatus,
  applyCanceledCreditOverride,
  shouldApplyCanceledOverride,
} from '../workspace-status';
import type { WorkspaceCredit } from '../types';
import type { WorkspaceLifecycleConfig } from '../workspace-lifecycle-config';

const CFG: WorkspaceLifecycleConfig = {
  expiryGracePeriodDays: 30,
  refillWarningThresholdDays: 7,
  enableWorkspaceStatusLabels: true,
  enableWorkspaceHoverDetails: true,
};

const NOW = Date.parse('2026-04-22T00:00:00Z');

function makeWs(overrides: Partial<WorkspaceCredit>): WorkspaceCredit {
  return {
    id: 'ws_test', name: 'Test', fullName: 'Test Workspace',
    dailyFree: 5, dailyUsed: 0, dailyLimit: 5,
    rolloverUsed: 0, rolloverLimit: 0,
    freeGranted: 0, freeRemaining: 0,
    used: 0, limit: 0, topupLimit: 0,
    totalCredits: 100, available: 50, rollover: 20, billingAvailable: 30,
    hasFree: false, totalCreditsUsed: 0,
    subscriptionStatus: 'active', subscriptionStatusChangedAt: '',
    plan: 'pro_1', role: 'owner', tier: 'PRO',
    raw: {}, rawApi: {},
    numProjects: 0, gitSyncEnabled: false, nextRefillAt: '',
    billingPeriodEndAt: '', createdAt: '', membershipRole: '', planType: 'monthly',
    ...overrides,
  };
}

describe('formatDateDDMMMYY', () => {
  it('formats ISO as DD MMM YY', () => {
    expect(formatDateDDMMMYY('2026-04-09T12:00:00Z')).toMatch(/^\d{2} Apr 26$/);
  });
  it('returns empty for missing/invalid input', () => {
    expect(formatDateDDMMMYY('')).toBe('');
    expect(formatDateDDMMMYY('not-a-date')).toBe('');
  });
});

describe('daysBetween / daysUntil', () => {
  it('counts past days correctly', () => {
    expect(daysBetween('2026-04-19T00:00:00Z', NOW)).toBe(3);
  });
  it('returns 0 for future timestamps in daysBetween', () => {
    expect(daysBetween('2026-05-01T00:00:00Z', NOW)).toBe(0);
  });
  it('counts future days correctly via daysUntil', () => {
    expect(daysUntil('2026-04-29T00:00:00Z', NOW)).toBe(7);
  });
  it('daysUntil returns -1 for past or invalid', () => {
    expect(daysUntil('2026-04-01T00:00:00Z', NOW)).toBe(-1);
    expect(daysUntil('', NOW)).toBe(-1);
  });
});

describe('formatDayCount', () => {
  it('handles small days', () => { expect(formatDayCount(3)).toBe('3d'); });
  it('handles months', () => { expect(formatDayCount(64)).toBe('2mo 4d'); });
  it('handles whole months', () => { expect(formatDayCount(60)).toBe('2mo'); });
  it('handles years', () => { expect(formatDayCount(400)).toBe('1y 1mo'); });
});

describe('getEffectiveStatus', () => {
  it('returns expired-canceled for canceled within grace', () => {
    const ws = makeWs({
      subscriptionStatus: 'canceled',
      subscriptionStatusChangedAt: '2026-04-17T00:00:00Z',
      tier: 'EXPIRED',
    });
    const s = getEffectiveStatus(ws, CFG, NOW);
    expect(s.kind).toBe('expired-canceled');
    expect(s.label).toBe('Expired (Canceled)');
    expect(s.daysSince).toBe(5);
  });

  it('returns fully-expired for canceled past grace', () => {
    const ws = makeWs({
      subscriptionStatus: 'canceled',
      subscriptionStatusChangedAt: '2026-03-01T00:00:00Z',
      tier: 'EXPIRED',
    });
    const s = getEffectiveStatus(ws, CFG, NOW);
    expect(s.kind).toBe('fully-expired');
    expect(s.label).toBe('Fully Expired');
  });

  it('returns about-to-expire for past_due', () => {
    const ws = makeWs({
      subscriptionStatus: 'past_due',
      subscriptionStatusChangedAt: '2026-04-16T10:05:11Z',
      tier: 'EXPIRED',
    });
    const s = getEffectiveStatus(ws, CFG, NOW);
    expect(s.kind).toBe('about-to-expire');
    expect(s.label).toBe('About To Expire');
  });

  it('returns about-to-refill when refill within window and not past_due/canceled', () => {
    const ws = makeWs({
      subscriptionStatus: 'trialing',
      tier: 'PRO',
      nextRefillAt: '2026-04-28T08:00:00Z', // 6 days out
    });
    const s = getEffectiveStatus(ws, CFG, NOW);
    expect(s.kind).toBe('about-to-refill');
    expect(s.daysToRefill).toBe(7); // ceil((Apr28 08:00 - Apr22 00:00) / day) = 7
  });

  it('refill suppressed when status is past_due', () => {
    const ws = makeWs({
      subscriptionStatus: 'past_due',
      tier: 'EXPIRED',
      nextRefillAt: '2026-04-28T08:00:00Z',
    });
    expect(getEffectiveStatus(ws, CFG, NOW).kind).toBe('about-to-expire');
  });

  it('falls back to billingPeriodEndAt when nextRefillAt missing', () => {
    const ws = makeWs({
      subscriptionStatus: 'active',
      tier: 'PRO',
      billingPeriodEndAt: '2026-04-25T08:00:00Z', // 3 days
    });
    const s = getEffectiveStatus(ws, CFG, NOW);
    expect(s.kind).toBe('about-to-refill');
    expect(s.daysToRefill).toBe(4); // ceil((Apr25 08:00 - Apr22 00:00) / day) = 4
  });

  it('returns normal when nothing applies', () => {
    const ws = makeWs({
      subscriptionStatus: 'active',
      tier: 'PRO',
      nextRefillAt: '2026-06-10T08:00:00Z',
    });
    expect(getEffectiveStatus(ws, CFG, NOW).kind).toBe('normal');
  });
});

describe('applyCanceledCreditOverride', () => {
  it('zeros billing + rollover and recomputes available', () => {
    const ws = makeWs({
      freeRemaining: 10, dailyFree: 5,
      billingAvailable: 100, rollover: 50, available: 165,
      freeGranted: 10, dailyLimit: 5, topupLimit: 0,
    });
    const status = getEffectiveStatus(makeWs({
      subscriptionStatus: 'canceled',
      subscriptionStatusChangedAt: '2026-04-20T00:00:00Z',
      tier: 'EXPIRED',
    }), CFG, NOW);
    applyCanceledCreditOverride(ws, status);
    expect(ws.billingAvailable).toBe(0);
    expect(ws.rollover).toBe(0);
    expect(ws.available).toBe(15); // free + daily only
    expect(ws.totalCredits).toBe(15); // freeGranted + dailyLimit + topupLimit
  });

  it('does not mutate active workspaces', () => {
    const ws = makeWs({ billingAvailable: 100, rollover: 50, available: 165 });
    const status = getEffectiveStatus(ws, CFG, NOW); // 'normal'
    applyCanceledCreditOverride(ws, status);
    expect(ws.billingAvailable).toBe(100);
    expect(ws.rollover).toBe(50);
    expect(ws.available).toBe(165);
  });

  it('shouldApplyCanceledOverride returns true for expired/canceled/fully-expired/about-to-expire only', () => {
    const ws = makeWs({});
    expect(shouldApplyCanceledOverride(getEffectiveStatus(ws, CFG, NOW))).toBe(false);
  });
});
