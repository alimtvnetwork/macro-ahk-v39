/**
 * Issue 116 Task 1 — Credit Totals aggregator tests.
 *
 * Covers: empty list, single workspace, multi-workspace sum, missing-data
 * exclusion, daily MAX, MYT-midnight reset computation, and FREE_DAILY_CAP
 * clamp.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateCreditTotals,
  computeNextMytMidnight,
  FREE_DAILY_CAP,
} from '../credit-totals';
import type { WorkspaceCredit } from '../types';

function ws(partial: Partial<WorkspaceCredit>): WorkspaceCredit {
  return {
    id: 'w', name: 'w', fullName: 'w',
    dailyFree: 0, dailyUsed: 0, dailyLimit: 5,
    rolloverUsed: 0, rolloverLimit: 0,
    freeGranted: 0, freeRemaining: 0,
    used: 0, limit: 0, topupLimit: 0,
    totalCredits: 0, available: 0, rollover: 0, billingAvailable: 0,
    hasFree: false, totalCreditsUsed: 0,
    subscriptionStatus: 'active', subscriptionStatusChangedAt: '',
    plan: 'pro_3', role: 'owner', tier: 'PRO',
    raw: {}, rawApi: {},
    numProjects: 0, gitSyncEnabled: false,
    nextRefillAt: '', billingPeriodEndAt: '', createdAt: '',
    membershipRole: 'owner', planType: 'monthly',
    ...partial,
  };
}

describe('aggregateCreditTotals', () => {
  it('returns zeros for an empty workspace list', () => {
    const result = aggregateCreditTotals([], new Date('2026-05-25T12:00:00Z'));
    expect(result.used).toBe(0);
    expect(result.remaining).toBe(0);
    expect(result.granted).toBe(0);
    expect(result.freeDailyRemaining).toBe(0);
    expect(result.freeDailyCap).toBe(FREE_DAILY_CAP);
    expect(result.missingCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  it('sums used / remaining / granted across mixed plans', () => {
    const result = aggregateCreditTotals([
      ws({ id: 'a', plan: 'pro_3', totalCreditsUsed: 320, available: 80, totalCredits: 400 }),
      ws({ id: 'b', plan: 'pro_0', totalCreditsUsed: 45, available: 15, totalCredits: 60 }),
      ws({ id: 'c', plan: 'pro_3', totalCreditsUsed: 1000, available: 500, totalCredits: 1500 }),
    ]);
    expect(result.used).toBe(1365);
    expect(result.remaining).toBe(595);
    expect(result.granted).toBe(1960);
    expect(result.totalCount).toBe(3);
    expect(result.missingCount).toBe(0);
  });

  it('excludes workspaces with no credit fields and reports missingCount', () => {
    const broken = ws({ id: 'broken' });
    // Force the three primary fields to NaN to simulate a row that never
    // received any credit data.
    (broken as unknown as Record<string, number>).totalCreditsUsed = Number.NaN;
    (broken as unknown as Record<string, number>).available = Number.NaN;
    (broken as unknown as Record<string, number>).totalCredits = Number.NaN;

    const result = aggregateCreditTotals([
      ws({ id: 'ok', totalCreditsUsed: 10, available: 20, totalCredits: 30 }),
      broken,
    ]);
    expect(result.used).toBe(10);
    expect(result.remaining).toBe(20);
    expect(result.granted).toBe(30);
    expect(result.missingCount).toBe(1);
    expect(result.totalCount).toBe(2);
  });

  it('takes the MAX of dailyFree across workspaces (per-account semantics)', () => {
    const result = aggregateCreditTotals([
      ws({ id: 'a', totalCredits: 1, dailyFree: 2 }),
      ws({ id: 'b', totalCredits: 1, dailyFree: 4 }),
      ws({ id: 'c', totalCredits: 1, dailyFree: 1 }),
    ]);
    expect(result.freeDailyRemaining).toBe(4);
  });

  it('clamps freeDailyRemaining to FREE_DAILY_CAP', () => {
    const result = aggregateCreditTotals([
      ws({ id: 'a', totalCredits: 1, dailyFree: 99 }),
    ]);
    expect(result.freeDailyRemaining).toBe(FREE_DAILY_CAP);
  });

  it('rounds non-integer sums (defensive — server sometimes returns fractions)', () => {
    const result = aggregateCreditTotals([
      ws({ id: 'a', totalCreditsUsed: 10.4, available: 20.6, totalCredits: 31 }),
      ws({ id: 'b', totalCreditsUsed: 5.1, available: 0.4, totalCredits: 5.5 }),
    ]);
    expect(result.used).toBe(16);   // 10.4 + 5.1 = 15.5 → 16
    expect(result.remaining).toBe(21); // 20.6 + 0.4 = 21
    expect(result.granted).toBe(37);   // 31 + 5.5 = 36.5 → 37
  });
});

describe('computeNextMytMidnight', () => {
  it('returns next MYT midnight as ISO when now is mid-day UTC', () => {
    // 2026-05-25 12:00 UTC = 2026-05-25 20:00 MYT → next MYT midnight is 2026-05-26 00:00 MYT = 2026-05-25 16:00 UTC.
    const result = computeNextMytMidnight(new Date('2026-05-25T12:00:00Z'));
    expect(result).toBe('2026-05-25T16:00:00.000Z');
  });

  it('rolls to the next calendar day in MYT when now is just before MYT midnight', () => {
    // 2026-05-25 15:30 UTC = 2026-05-25 23:30 MYT → next midnight = 2026-05-26 00:00 MYT = 2026-05-25 16:00 UTC.
    const result = computeNextMytMidnight(new Date('2026-05-25T15:30:00Z'));
    expect(result).toBe('2026-05-25T16:00:00.000Z');
  });

  it('rolls forward when now is just past MYT midnight', () => {
    // 2026-05-25 16:30 UTC = 2026-05-26 00:30 MYT → next midnight = 2026-05-27 00:00 MYT = 2026-05-26 16:00 UTC.
    const result = computeNextMytMidnight(new Date('2026-05-25T16:30:00Z'));
    expect(result).toBe('2026-05-26T16:00:00.000Z');
  });
});
