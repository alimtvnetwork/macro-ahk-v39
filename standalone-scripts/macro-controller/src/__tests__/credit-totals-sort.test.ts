/**
 * Step 9 — Credit Totals: sortable columns.
 * Covers pure `sortWorkspaces` + `nextSortDir`, and DOM header-click cycle.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  sortWorkspaces,
  nextSortDir,
  buildBreakdownTable,
  type SortState,
} from '../ui/credit-totals-modal';
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
  ws({ id: 'a', fullName: 'Alpha', plan: 'pro_3', totalCreditsUsed: 50, available: 100, totalCredits: 150 }),
  ws({ id: 'b', fullName: 'Bravo', plan: 'pro_0', totalCreditsUsed: 500, available: 0, totalCredits: 500 }),
  ws({ id: 'c', fullName: 'Charlie', plan: 'free', totalCreditsUsed: 10, available: 25, totalCredits: 35 }),
];

describe('sortWorkspaces', () => {
  it('returns input unchanged when dir is none', () => {
    const out = sortWorkspaces(SAMPLE, { key: 'used', dir: 'none' });
    expect(out.map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by numeric key descending', () => {
    const out = sortWorkspaces(SAMPLE, { key: 'used', dir: 'desc' });
    expect(out.map((w) => w.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by numeric key ascending', () => {
    const out = sortWorkspaces(SAMPLE, { key: 'rem', dir: 'asc' });
    expect(out.map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by total descending', () => {
    const out = sortWorkspaces(SAMPLE, { key: 'total', dir: 'desc' });
    expect(out.map((w) => w.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by name (text) ascending case-insensitive', () => {
    const mixed = [
      ws({ id: '1', fullName: 'banana' }),
      ws({ id: '2', fullName: 'Apple' }),
      ws({ id: '3', fullName: 'cherry' }),
    ];
    const out = sortWorkspaces(mixed, { key: 'name', dir: 'asc' });
    expect(out.map((w) => w.id)).toEqual(['2', '1', '3']);
  });

  it('does not mutate the input array', () => {
    const input = SAMPLE.slice();
    sortWorkspaces(input, { key: 'used', dir: 'desc' });
    expect(input.map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('nextSortDir', () => {
  it('numeric key from none → desc', () => {
    expect(nextSortDir('used', { key: 'used', dir: 'none' })).toEqual({ key: 'used', dir: 'desc' });
  });
  it('numeric cycle: desc → asc → none', () => {
    const s1: SortState = { key: 'used', dir: 'desc' };
    const s2 = nextSortDir('used', s1);
    expect(s2).toEqual({ key: 'used', dir: 'asc' });
    expect(nextSortDir('used', s2)).toEqual({ key: 'used', dir: 'none' });
  });
  it('text cycle: none → asc → desc → none', () => {
    let s: SortState = { key: 'name', dir: 'none' };
    s = nextSortDir('name', s);
    expect(s.dir).toBe('asc');
    s = nextSortDir('name', s);
    expect(s.dir).toBe('desc');
    s = nextSortDir('name', s);
    expect(s.dir).toBe('none');
  });
  it('switching column starts at default dir for that column', () => {
    const s = nextSortDir('used', { key: 'name', dir: 'desc' });
    expect(s).toEqual({ key: 'used', dir: 'desc' });
    const t = nextSortDir('name', { key: 'used', dir: 'asc' });
    expect(t).toEqual({ key: 'name', dir: 'asc' });
  });
});

describe('buildBreakdownTable — header click sorting', () => {
  let table: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    table = buildBreakdownTable(SAMPLE);
    document.body.appendChild(table);
  });

  function rowIds(): string[] {
    const rows = table.querySelectorAll('[data-credit-totals-row]');
    return Array.from(rows).map((r) => {
      const name = r.querySelector('[data-cell="name"]');
      return (name?.textContent || '').toLowerCase();
    });
  }

  function clickHeader(key: string): void {
    const h = table.querySelector('[data-sort-key="' + key + '"]') as HTMLElement;
    h.click();
  }

  it('renders all sortable headers with click handlers', () => {
    const keys = Array.from(table.querySelectorAll('[data-sort-key]')).map((c) => c.getAttribute('data-sort-key'));
    expect(keys).toEqual(['name', 'plan', 'used', 'rem', 'total']);
  });

  it('clicking Used header sorts desc then asc then none', () => {
    clickHeader('used');
    expect(rowIds()).toEqual(['bravo', 'alpha', 'charlie']);
    clickHeader('used');
    expect(rowIds()).toEqual(['charlie', 'alpha', 'bravo']);
    clickHeader('used');
    expect(rowIds()).toEqual(['alpha', 'bravo', 'charlie']); // back to insertion order
  });

  it('clicking Workspace header sorts asc by name', () => {
    clickHeader('name');
    expect(rowIds()).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('shows active arrow in active column header only', () => {
    clickHeader('rem');
    const remHeader = table.querySelector('[data-sort-key="rem"]') as HTMLElement;
    expect(remHeader.textContent).toMatch(/▼|▲/);
    const usedHeader = table.querySelector('[data-sort-key="used"]') as HTMLElement;
    expect(usedHeader.textContent).not.toMatch(/▼|▲/);
  });
});
