/**
 * Issue 115 Step 3 — renderer composition tests.
 *
 * The badge HTML in `ws-list-renderer.ts` is built by composing
 * `classifyFromStatus` + `resolveBadgeStyle`. These tests assert that
 * composition end-to-end (so a future refactor that drifts one of the
 * two halves will fail loudly).
 */

import { describe, it, expect } from 'vitest';
import { classifyFromStatus } from '../workspace-display-status';
import { resolveBadgeStyle, styleContainsRedPalette } from '../workspace-badge-styles';
import type { WorkspaceCredit } from '../types';
import type { WorkspaceStatus } from '../workspace-status';

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

function mockStatus(overrides: Partial<WorkspaceStatus>): WorkspaceStatus {
  return {
    kind: 'normal', label: '', sinceIso: '', refillIso: '',
    daysSince: 0, daysToRefill: -1,
    ...overrides,
  };
}

/** Mirror of the production composition in `buildStatusPillHtml`. */
function buildBadgeFragment(status: WorkspaceStatus, ws: WorkspaceCredit): string {
  const display = classifyFromStatus(status, ws);
  if (display.kind === 'normal' || !display.label) return '';
  const style = resolveBadgeStyle(display.tone);
  return '[' + display.kind + '|' + display.label + '|' + style.fg + '|' + style.bg + ']';
}

describe('Issue 115 Step 3 — Cancel collapse in renderer', () => {
  it('expired-canceled produces a single Cancel badge (gray, no red)', () => {
    const status = mockStatus({ kind: 'expired-canceled', sinceIso: '2026-04-20T00:00:00Z' });
    const fragment = buildBadgeFragment(status, makeWs());
    expect(fragment).toContain('|Cancel|');
    expect(fragment).toContain('[canceled|');
    expect(styleContainsRedPalette({
      bg: fragment, fg: fragment, border: fragment,
    })).toBe(false);
  });

  it('fully-expired ALSO renders Cancel (collapse rule)', () => {
    const status = mockStatus({ kind: 'fully-expired', sinceIso: '2025-01-01T00:00:00Z' });
    const fragment = buildBadgeFragment(status, makeWs());
    expect(fragment).toContain('|Cancel|');
  });

  it('plain expired ALSO renders Cancel (collapse rule)', () => {
    const status = mockStatus({ kind: 'expired', sinceIso: '2026-04-20T00:00:00Z' });
    const fragment = buildBadgeFragment(status, makeWs());
    expect(fragment).toContain('|Cancel|');
  });

  it('about-to-refill renders Refill {N}d (single info badge)', () => {
    const status = mockStatus({ kind: 'about-to-refill', daysToRefill: 5, refillIso: '2026-04-27T00:00:00Z' });
    const fragment = buildBadgeFragment(status, makeWs());
    expect(fragment).toContain('|Refill 5d|');
    expect(fragment).toContain('[refill-soon|');
  });

  it('normal status renders nothing', () => {
    expect(buildBadgeFragment(mockStatus({ kind: 'normal' }), makeWs())).toBe('');
  });
});
