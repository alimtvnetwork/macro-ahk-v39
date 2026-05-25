/**
 * v3.16.1 bug fix — Refill-soon filter must apply refill-priority sort.
 *
 * When the "Refill-soon" filter chip is active, ALL surviving rows are by
 * definition refill-soon (often with identical daysToRefill, e.g. "1d"),
 * so the raw API order leaves zero-credit workspaces on top. The filter
 * branch in `ws-list-renderer.ts::filterAndSortWorkspaces` must therefore
 * apply `sortByRefillPriority` even when the dedicated refill-priority
 * sort toggle is off.
 *
 * Source-invariant test (so we don't drift back to the broken behaviour)
 * + a behavioural test on the pure sort helper covering the exact tie
 * shape from the screenshot.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortByRefillPriority } from '../workspace-refill-priority';
import type { WorkspaceCredit } from '../types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'ws-list-renderer.ts');

let source = '';
beforeAll(() => { source = readFileSync(SRC, 'utf-8'); });

describe('Refill-soon filter — invariants', () => {
  it('filterAndSortWorkspaces applies refill-priority sort when refillSoon filter is on', () => {
    expect(source).toMatch(/getRefillPriority\(\)\s*\|\|\s*fs\.refillSoon/);
  });
});

function mkWs(id: string, available: number, daysToRefill: number): WorkspaceCredit {
  const refillIso = new Date(Date.now() + daysToRefill * 86_400_000).toISOString();
  return {
    id,
    name: id,
    plan: 'pro',
    available,
    used: 0,
    total: 205,
    nextRefillAt: refillIso,
    billingPeriodEndAt: refillIso,
    monthlyRefillAt: refillIso,
  } as unknown as WorkspaceCredit;
}

describe('sortByRefillPriority — screenshot scenario (all 1d, mixed credits)', () => {
  it('orders highest available first when daysToRefill ties', () => {
    // Mirror of the user-reported screenshot: 7 workspaces, all "Refill 1d".
    const rows = [
      mkWs('A0081', 0,   1),
      mkWs('A0082', 0,   1),
      mkWs('A0083', 0,   1),
      mkWs('A0084', 169, 1),
      mkWs('A0086', 15,  1),
      mkWs('A0087', 200, 1),
      mkWs('A0088', 63,  1),
    ].map((ws, i) => ({ ws, wsIndex: i }));

    const sorted = sortByRefillPriority(rows, 10);
    const ids = sorted.map((r) => r.ws.id);

    // Highest available first; zero-credit rows fall to the bottom (id asc).
    expect(ids).toEqual(['A0087', 'A0084', 'A0088', 'A0086', 'A0081', 'A0082', 'A0083']);
  });
});
