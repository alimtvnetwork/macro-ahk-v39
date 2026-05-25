/**
 * Issue 116 — Credit Totals component integration tests.
 *
 * Exercises buildBreakdownTable end-to-end: filter chips, header sort
 * clicks, manual drag-drop reorder, row double-click navigation, and the
 * footer CSV export button. Complements the per-feature unit suites.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildBreakdownTable,
  showCreditTotalsModal,
  removeCreditTotalsModal,
} from '../ui/credit-totals-modal';
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

const SAMPLE: ReadonlyArray<WorkspaceCredit> = [
  ws({ id: 'a', fullName: 'Alpha', plan: 'pro_3', totalCreditsUsed: 100, available: 900, totalCredits: 1000, numProjects: 3 }),
  ws({ id: 'b', fullName: 'Bravo', plan: 'pro_0', totalCreditsUsed: 50,  available: 50,  totalCredits: 100,  numProjects: 1, hasFree: true }),
  ws({ id: 'c', fullName: 'Charlie', plan: 'pro_3', totalCreditsUsed: 480, available: 20, totalCredits: 500, numProjects: 7 }),
  ws({ id: 'd', fullName: 'Delta', plan: 'pro_0', totalCreditsUsed: 300, available: 0,  totalCredits: 300, numProjects: 0 }),
];

beforeEach(() => {
  loopCreditState.perWorkspace = SAMPLE.slice();
  loopCreditState.lastCheckedAt = Date.now();
});

afterEach(() => {
  removeCreditTotalsModal();
  vi.restoreAllMocks();
});

function rowNames(table: HTMLElement): string[] {
  const rows = table.querySelectorAll<HTMLElement>('[data-credit-totals-row]');
  return Array.from(rows).map((r) => {
    const n = r.querySelector<HTMLElement>('[data-cell="name"]');
    return (n?.textContent || '').trim();
  });
}

describe('buildBreakdownTable — integration', () => {
  it('renders one row per workspace by default (manual order preserved)', () => {
    const table = buildBreakdownTable(SAMPLE);
    expect(rowNames(table)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('numeric header click cycles desc → asc → none (manual order)', () => {
    const table = buildBreakdownTable(SAMPLE);
    const remHeader = table.querySelector<HTMLElement>('[data-sort-key="rem"]')!;
    remHeader.click();
    // desc by remaining: 900, 50, 20, 0
    expect(rowNames(table)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    remHeader.click();
    // asc: 0, 20, 50, 900
    expect(rowNames(table)).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']);
    remHeader.click();
    // cleared -> manual order
    expect(rowNames(table)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  it('Low filter chip narrows rows to 0 < remaining < 100', () => {
    const table = buildBreakdownTable(SAMPLE);
    const lowChip = table.querySelector<HTMLElement>('[data-chip="low"]')!;
    lowChip.click();
    // Bravo(50), Charlie(20) qualify; Delta(0) is "empty", not "low"
    expect(rowNames(table).sort()).toEqual(['Bravo', 'Charlie']);
  });

  it('Empty + Free filters combine with OR logic', () => {
    const table = buildBreakdownTable(SAMPLE);
    table.querySelector<HTMLElement>('[data-chip="empty"]')!.click();
    table.querySelector<HTMLElement>('[data-chip="free"]')!.click();
    // Delta (empty) OR Bravo (hasFree)
    expect(rowNames(table).sort()).toEqual(['Bravo', 'Delta']);
  });

  it('shows the "no match" empty state when filters exclude everything', () => {
    const table = buildBreakdownTable([
      ws({ id: 'x', fullName: 'Xeno', available: 5000, hasFree: false }),
    ]);
    table.querySelector<HTMLElement>('[data-chip="empty"]')!.click();
    expect(table.textContent || '').toContain('No workspaces match the active filters');
  });

  it('row double-click opens the projects page in a new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const table = buildBreakdownTable(SAMPLE);
    const firstRow = table.querySelector<HTMLElement>('[data-credit-totals-row]')!;
    firstRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(openSpy).toHaveBeenCalledWith('https://lovable.dev/projects', '_blank', 'noopener');
  });

  it('drag-drop reorders rows when no sort is active', () => {
    const table = buildBreakdownTable(SAMPLE);
    const rows = table.querySelectorAll<HTMLElement>('[data-credit-totals-row]');
    const fromRow = rows[0]; // Alpha
    const toRow = rows[2];   // Charlie

    const dt = {
      effectAllowed: '',
      dropEffect: '',
      _data: '',
      setData(_t: string, v: string) { this._data = v; },
      getData(_t: string) { return this._data; },
    };
    fromRow.dispatchEvent(Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer: dt }));
    toRow.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer: dt, preventDefault: () => {} }));

    expect(rowNames(table)).toEqual(['Bravo', 'Charlie', 'Alpha', 'Delta']);
  });
});

describe('showCreditTotalsModal — wired footer', () => {
  it('renders the CSV export button in the footer', () => {
    showCreditTotalsModal();
    const btn = document.querySelector('[data-credit-totals-csv]') as HTMLElement;
    expect(btn).not.toBeNull();
    expect((btn.textContent || '')).toContain('CSV');
  });

  it('CSV button click invokes the download path (URL.createObjectURL)', () => {
    const createFn = vi.fn().mockReturnValue('blob:mock');
    const revokeFn = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createFn });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeFn });
    showCreditTotalsModal();
    const btn = document.querySelector('[data-credit-totals-csv]') as HTMLElement;
    btn.click();
    expect(createFn).toHaveBeenCalledTimes(1);
    expect(revokeFn).toHaveBeenCalledWith('blob:mock');
  });
});
