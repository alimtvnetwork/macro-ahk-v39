/**
 * Step 10 — Credit Totals: drag-drop reorder.
 * Pure helper + JSDOM integration via synthetic DragEvent / DataTransfer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reorderArray, buildBreakdownTable } from '../ui/credit-totals-modal';
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
  ws({ id: 'a', fullName: 'Alpha' }),
  ws({ id: 'b', fullName: 'Bravo' }),
  ws({ id: 'c', fullName: 'Charlie' }),
  ws({ id: 'd', fullName: 'Delta' }),
];

describe('reorderArray', () => {
  it('moves element forward', () => {
    const out = reorderArray([1, 2, 3, 4], 0, 2);
    expect(out).toEqual([2, 3, 1, 4]);
  });

  it('moves element backward', () => {
    const out = reorderArray([1, 2, 3, 4], 3, 1);
    expect(out).toEqual([1, 4, 2, 3]);
  });

  it('returns a copy when from === to', () => {
    const input = [1, 2, 3];
    const out = reorderArray(input, 1, 1);
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(input);
  });

  it('returns a copy when indices are out of bounds (safe no-op)', () => {
    const input = [1, 2, 3];
    expect(reorderArray(input, -1, 0)).toEqual([1, 2, 3]);
    expect(reorderArray(input, 0, 99)).toEqual([1, 2, 3]);
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3, 4];
    reorderArray(input, 0, 3);
    expect(input).toEqual([1, 2, 3, 4]);
  });
});

describe('buildBreakdownTable — drag-drop', () => {
  let table: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    table = buildBreakdownTable(SAMPLE);
    document.body.appendChild(table);
  });

  function rowNames(): string[] {
    return Array.from(table.querySelectorAll('[data-credit-totals-row]'))
      .map((r) => (r.querySelector('[data-cell="name"]')?.textContent || '').toLowerCase());
  }

  function makeDt(data: Record<string, string> = {}): DataTransfer {
    const store: Record<string, string> = { ...data };
    return {
      data: store,
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: (k: string, v: string) => { store[k] = v; },
      getData: (k: string) => store[k] || '',
    } as unknown as DataTransfer;
  }

  function fire(el: Element, type: string, dt: DataTransfer): boolean {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer?: DataTransfer };
    ev.dataTransfer = dt;
    return el.dispatchEvent(ev);
  }

  it('rows are draggable by default (sort dir = none)', () => {
    const rows = table.querySelectorAll<HTMLElement>('[data-credit-totals-row]');
    rows.forEach((r) => {
      expect(r.draggable).toBe(true);
      expect(r.style.cursor).toBe('grab');
    });
  });

  it('dropping row 0 onto row 2 reorders the list', () => {
    const rows = table.querySelectorAll<HTMLElement>('[data-credit-totals-row]');
    const dt = makeDt();
    fire(rows[0], 'dragstart', dt);
    fire(rows[2], 'dragover', dt);
    fire(rows[2], 'drop', dt);
    expect(rowNames()).toEqual(['bravo', 'charlie', 'alpha', 'delta']);
  });

  it('drop is a no-op when from === to', () => {
    const rows = table.querySelectorAll<HTMLElement>('[data-credit-totals-row]');
    const dt = makeDt();
    fire(rows[1], 'dragstart', dt);
    fire(rows[1], 'drop', dt);
    expect(rowNames()).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });

  it('drag is disabled while a sort direction is active', () => {
    document.body.innerHTML = '';
    table = buildBreakdownTable(SAMPLE);
    document.body.appendChild(table);
    const usedHeader = table.querySelector('[data-sort-key="used"]') as HTMLElement;
    usedHeader.click(); // activates sort
    const rows = table.querySelectorAll<HTMLElement>('[data-credit-totals-row]');
    rows.forEach((r) => {
      expect(r.draggable).toBe(false);
    });
  });
});
