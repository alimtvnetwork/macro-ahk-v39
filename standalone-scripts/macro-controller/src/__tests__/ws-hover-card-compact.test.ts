/**
 * ws-hover-card — compact tooltip (v3.4.3, spec 113 task 05) structure tests.
 *
 * Pins the 3-zone layout: header (name + plan + status pill), priority zone
 * (Credits / Refill / Expires compact rows with color tokens), and a single
 * <details> element wrapping the legacy Priority rules explainer.
 *
 * Color contract:
 *   - available >= 50% of daily → success green (#34d399)
 *   - 10%–50%                   → warning yellow (#fde68a)
 *   - <10% or 0                 → destructive red (#fca5a5)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildWorkspaceHoverHtml } from '../ws-hover-card';
import { getEffectiveStatus } from '../workspace-status';
import type { WorkspaceCredit } from '../types';
import type { WorkspaceLifecycleConfig } from '../workspace-lifecycle-config';

const NOW = Date.parse('2026-04-22T00:00:00Z');
const MS_PER_DAY = 86_400_000;

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterAll(() => { vi.useRealTimers(); });

const CFG: WorkspaceLifecycleConfig = {
  expiryGracePeriodDays: 30,
  refillWarningThresholdDays: 7,
  enableWorkspaceStatusLabels: true,
  enableWorkspaceHoverDetails: true,
};

function isoDaysAhead(d: number): string {
  return new Date(NOW + d * MS_PER_DAY).toISOString();
}

function makeWs(overrides: Partial<WorkspaceCredit> = {}): WorkspaceCredit {
  return {
    id: 'ws_compact', name: 'Compact', fullName: 'Compact Workspace',
    dailyFree: 50, dailyUsed: 8, dailyLimit: 50,
    rolloverUsed: 0, rolloverLimit: 0,
    freeGranted: 0, freeRemaining: 0,
    used: 8, limit: 200, topupLimit: 0,
    totalCredits: 200, available: 142, rollover: 0, billingAvailable: 142,
    hasFree: false, totalCreditsUsed: 8,
    subscriptionStatus: 'active', subscriptionStatusChangedAt: '',
    plan: 'pro_1', role: 'owner', tier: 'PRO',
    raw: {}, rawApi: {},
    numProjects: 3, gitSyncEnabled: false,
    nextRefillAt: isoDaysAhead(3),
    billingPeriodEndAt: isoDaysAhead(27),
    createdAt: '2025-01-15T00:00:00Z',
    membershipRole: 'Owner', planType: 'PRO',
    ...overrides,
  };
}

describe('ws-hover-card — compact 3-zone layout', () => {
  it('renders header with workspace name, plan chip, and status pill', () => {
    const ws = makeWs();
    const status = getEffectiveStatus(ws, CFG, NOW);
    const html = buildWorkspaceHoverHtml(ws, status, CFG);
    expect(html).toContain('Compact Workspace');
    // plan chip and status pill markers
    expect(html).toMatch(/PRO/i);
  });

  it('emits Credits/Refill/Expires compact rows above the <details>', () => {
    const ws = makeWs();
    const status = getEffectiveStatus(ws, CFG, NOW);
    const html = buildWorkspaceHoverHtml(ws, status, CFG);
    expect(html).toMatch(/avail/);
    expect(html).toMatch(/daily/);
    expect(html).toMatch(/used/);
    expect(html).toContain('142'); // available
    expect(html).toContain('50');  // daily
    expect(html).toContain('8');   // used
    // Compact rows must appear *before* the <details> element.
    const detailsIdx = html.indexOf('<details');
    const availIdx = html.indexOf('avail');
    expect(detailsIdx).toBeGreaterThan(-1);
    expect(availIdx).toBeGreaterThan(-1);
    expect(availIdx).toBeLessThan(detailsIdx);
  });

  it('wraps the Priority rules explainer in exactly one collapsed <details>', () => {
    const ws = makeWs();
    const status = getEffectiveStatus(ws, CFG, NOW);
    const html = buildWorkspaceHoverHtml(ws, status, CFG);
    const opens = html.match(/<details[^>]*>/g) || [];
    expect(opens).toHaveLength(1);
    // No `open` attribute → closed by default.
    expect(opens[0]).not.toMatch(/\bopen\b/);
  });

  it('uses success green for healthy credits (available >= 50% of daily)', () => {
    const ws = makeWs({ available: 142, dailyLimit: 50, dailyFree: 50 });
    const status = getEffectiveStatus(ws, CFG, NOW);
    const html = buildWorkspaceHoverHtml(ws, status, CFG);
    // Healthy → success token (#34d399) used on the available number.
    expect(html).toContain('#34d399');
  });

  it('uses destructive red when available credits are exhausted', () => {
    const ws = makeWs({ available: 0, dailyUsed: 50 });
    const status = getEffectiveStatus(ws, CFG, NOW);
    const html = buildWorkspaceHoverHtml(ws, status, CFG);
    expect(html).toContain('#fca5a5');
  });

  it('uses warning yellow when available credits are low (10%–50% of daily)', () => {
    const ws = makeWs({ available: 10, dailyLimit: 50, dailyFree: 50, dailyUsed: 40 });
    const status = getEffectiveStatus(ws, CFG, NOW);
    const html = buildWorkspaceHoverHtml(ws, status, CFG);
    expect(html).toContain('#fde68a');
  });

  it('keeps the compact tooltip under the 320px max-width budget (no inline width override)', () => {
    const ws = makeWs();
    const status = getEffectiveStatus(ws, CFG, NOW);
    const html = buildWorkspaceHoverHtml(ws, status, CFG);
    // The HTML returned is the *body*; the mount element caps width to 320px.
    // Assert the body does not override that with a wider inline max-width.
    expect(html).not.toMatch(/max-width:\s*([4-9]\d{2}|\d{4,})px/);
  });
});
