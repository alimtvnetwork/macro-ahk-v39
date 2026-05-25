/**
 * Issue 116 Task 2 — Credit Totals modal render tests.
 *
 * Asserts the pure builder functions and the show/remove lifecycle work
 * correctly without depending on the real `loopCreditState`. JSDOM env
 * supplied by root vitest.config.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildBody,
  buildCard,
  buildBreakdownTable,
  showCreditTotalsModal,
  removeCreditTotalsModal,
  formatCount,
  formatMytReset,
  formatSnapshotAge,
} from '../ui/credit-totals-modal';
import { aggregateCreditTotals } from '../credit-totals';
import { loopCreditState } from '../shared-state';
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

beforeEach(() => {
  loopCreditState.perWorkspace = [];
  loopCreditState.lastCheckedAt = null;
});

afterEach(() => {
  removeCreditTotalsModal();
});

describe('formatCount', () => {
  it('formats with thousands separators and no decimals', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(0)).toBe('0');
  });
  it('returns em-dash for non-finite numbers', () => {
    expect(formatCount(Number.NaN)).toBe('—');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatMytReset', () => {
  it('renders ISO timestamp as a short MYT clock', () => {
    // 2026-05-25 16:00 UTC = 2026-05-26 00:00 MYT (Tuesday).
    expect(formatMytReset('2026-05-25T16:00:00.000Z')).toBe('Tue 00:00 MYT');
  });
  it('returns em-dash for invalid input', () => {
    expect(formatMytReset('')).toBe('—');
    expect(formatMytReset('not-a-date')).toBe('—');
  });
});

describe('formatSnapshotAge', () => {
  it('returns "never" when never checked', () => {
    expect(formatSnapshotAge(null)).toBe('never');
  });
  it('formats seconds / minutes / hours', () => {
    const now = Date.now();
    expect(formatSnapshotAge(now - 5_000)).toMatch(/^[0-9]+s ago$/);
    expect(formatSnapshotAge(now - 120_000)).toMatch(/^[0-9]+m ago$/);
    expect(formatSnapshotAge(now - 3_600_000 * 2)).toMatch(/^[0-9]+h ago$/);
  });
});

describe('buildCard', () => {
  it('renders heading + each label/value pair', () => {
    const card = buildCard('Test', [
      { label: 'Foo', value: '123' },
      { label: 'Bar', value: '456', tone: 'warn' },
    ]);
    const text = card.textContent || '';
    expect(text).toContain('Test');
    expect(text).toContain('Foo');
    expect(text).toContain('123');
    expect(text).toContain('Bar');
    expect(text).toContain('456');
  });
});

describe('buildBreakdownTable', () => {
  it('renders empty-state copy when no workspaces are passed', () => {
    const table = buildBreakdownTable([]);
    expect((table.textContent || '')).toContain('No workspaces cached');
  });

  it('renders a row per workspace with name / plan / used / rem / total', () => {
    const table = buildBreakdownTable([
      ws({ id: 'a', fullName: 'A0001 D3v001', plan: 'pro_3', totalCreditsUsed: 320, available: 80, totalCredits: 400 }),
      ws({ id: 'b', fullName: 'A0002 D3v002', plan: 'pro_0', totalCreditsUsed: 45, available: 15, totalCredits: 60 }),
    ]);
    const body = table.querySelector('[data-credit-totals-rows]') as HTMLElement;
    expect(body.children).toHaveLength(2);
    const text = body.textContent || '';
    expect(text).toContain('A0001 D3v001');
    expect(text).toContain('pro_3');
    expect(text).toContain('320');
    expect(text).toContain('A0002 D3v002');
    expect(text).toContain('pro_0');
  });
});

describe('buildBody', () => {
  it('surfaces a missing-data warning row when missingCount > 0', () => {
    const workspaces = [ws({ id: 'a', totalCreditsUsed: 10, available: 20, totalCredits: 30 })];
    const totals = { used: 10, remaining: 20, granted: 30, freeDailyRemaining: 3, freeDailyCap: 5, resetAtMyt: '2026-05-25T16:00:00.000Z', missingCount: 2, totalCount: 3 };
    const body = buildBody(totals, workspaces);
    const warn = body.querySelector('[data-credit-totals-warning]');
    expect(warn).not.toBeNull();
    expect((warn!.textContent || '')).toContain('2 of 3');
  });

  it('omits the warning when missingCount is zero', () => {
    const totals = aggregateCreditTotals([ws({ totalCreditsUsed: 10, available: 20, totalCredits: 30 })]);
    const body = buildBody(totals, [ws({ totalCreditsUsed: 10, available: 20, totalCredits: 30 })]);
    expect(body.querySelector('[data-credit-totals-warning]')).toBeNull();
  });
});

describe('showCreditTotalsModal / removeCreditTotalsModal', () => {
  it('mounts a single dialog with role="dialog" and aria-label', () => {
    loopCreditState.perWorkspace = [
      ws({ id: 'a', fullName: 'A0001 D3v001', plan: 'pro_3', totalCreditsUsed: 100, available: 50, totalCredits: 150 }),
    ];
    showCreditTotalsModal();
    const dialog = document.getElementById('marco-credit-totals-modal');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('role')).toBe('dialog');
    expect(dialog!.getAttribute('aria-label')).toBe('Credit Totals');
    expect((dialog!.textContent || '')).toContain('💰 Credit Totals');
    expect((dialog!.textContent || '')).toContain('A0001 D3v001');
  });

  it('calling show twice replaces (does not stack) the dialog', () => {
    showCreditTotalsModal();
    showCreditTotalsModal();
    expect(document.querySelectorAll('#marco-credit-totals-modal')).toHaveLength(1);
  });

  it('close button (✕) removes the dialog from the DOM', () => {
    showCreditTotalsModal();
    const closeIcon = document.querySelector('#marco-credit-totals-modal [aria-label="Close"]') as HTMLElement;
    expect(closeIcon).not.toBeNull();
    closeIcon.click();
    expect(document.getElementById('marco-credit-totals-modal')).toBeNull();
  });

  it('ESC key closes the dialog', () => {
    showCreditTotalsModal();
    expect(document.getElementById('marco-credit-totals-modal')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('marco-credit-totals-modal')).toBeNull();
  });

  it('sets aria-modal=true and is focusable', () => {
    showCreditTotalsModal();
    const dialog = document.getElementById('marco-credit-totals-modal');
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    expect(dialog!.tabIndex).toBe(-1);
  });
});
