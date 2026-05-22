/**
 * Workspace Status & Date Helpers — Pure Functions
 *
 * Spec: spec/22-app-issues/workspace-status-tooltip/01-overview.md (Phase 2)
 *
 * Single source of truth for:
 *   - Effective lifecycle status (canceled / fully-expired / expired / past-due / about-to-refill / normal)
 *   - DD MMM YY date formatting
 *   - "Nd ago" / "in Nd" duration formatting
 *   - Canceled-workspace credit override (zeros billing + rollover)
 *
 * No DOM access. No side effects. Fully unit-testable.
 */

import type { WorkspaceCredit } from './types';
import type { WorkspaceLifecycleConfig } from './workspace-lifecycle-config';

/* ------------------------------------------------------------------ */
/*  Status kinds                                                       */
/* ------------------------------------------------------------------ */

export type WorkspaceStatusKind =
  | 'fully-expired'
  | 'expired-canceled'
  | 'expired'
  | 'about-to-expire'
  | 'about-to-refill'
  | 'normal';

export interface WorkspaceStatus {
  kind: WorkspaceStatusKind;
  label: string;
  /** ISO date that drove the decision (status change OR refill date). Empty when none. */
  sinceIso: string;
  /** ISO refill date, only set when kind === 'about-to-refill'. */
  refillIso: string;
  /** Days since `sinceIso` (>=0). 0 when no relevant date. */
  daysSince: number;
  /** Days until refill. -1 when not applicable. */
  daysToRefill: number;
}

/** Human labels — kept inside this module so consumers stay in sync. */
const STATUS_LABELS: Record<WorkspaceStatusKind, string> = {
  'fully-expired':   'Fully Expired',
  'expired-canceled': 'Expired (Canceled)',
  'expired':         'Expired',
  'about-to-expire': 'About To Expire',
  'about-to-refill': 'About To Refill',
  'normal':          '',
};

/* ------------------------------------------------------------------ */
/*  Date helpers                                                       */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 86_400_000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Days between two timestamps (UTC-day floor). Returns 0 for negatives.
 * `nowMs` defaults to Date.now() — kept injectable for tests.
 */
export function daysBetween(isoOrMs: string | number, nowMs?: number): number {
  const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(t)) return 0;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const diffMs = now - t;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / MS_PER_DAY);
}

/** Days until a future ISO timestamp. Returns -1 when invalid or in the past. */
export function daysUntil(iso: string, nowMs?: number): number {
  if (!iso) return -1;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return -1;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const diffMs = t - now;
  if (diffMs < 0) return -1;
  return Math.ceil(diffMs / MS_PER_DAY);
}

/**
 * Format an ISO date as "DD MMM YY" — e.g. "09 Apr 26".
 * Returns empty string for missing or unparseable input.
 */
export function formatDateDDMMMYY(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = MONTH_NAMES[d.getMonth()];
  const yr = String(d.getFullYear() % 100).padStart(2, '0');
  return day + ' ' + mon + ' ' + yr;
}

/** "3d", "2mo 1d", "1y 2mo" — shared by past/future durations. */
export function formatDayCount(days: number): string {
  if (days < 1) return '<1d';
  if (days < 30) return days + 'd';
  if (days < 365) {
    const months = Math.floor(days / 30);
    const remDays = days % 30;
    return remDays > 0 ? months + 'mo ' + remDays + 'd' : months + 'mo';
  }
  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days % 365) / 30);
  return remMonths > 0 ? years + 'y ' + remMonths + 'mo' : years + 'y';
}

export function formatDaysAgo(days: number): string {
  return formatDayCount(days) + ' ago';
}

export function formatDaysIn(days: number): string {
  return 'in ' + formatDayCount(days);
}

/* ------------------------------------------------------------------ */
/*  Status resolution                                                  */
/* ------------------------------------------------------------------ */

function normalizeStatus(s: string): string {
  return (s || '').toLowerCase().trim();
}

function pickRefillIso(ws: WorkspaceCredit): string {
  if (ws.nextRefillAt) return ws.nextRefillAt;
  if (ws.billingPeriodEndAt) return ws.billingPeriodEndAt;
  return '';
}

function buildStatus(
  kind: WorkspaceStatusKind,
  opts: { sinceIso?: string; refillIso?: string; daysSince?: number; daysToRefill?: number },
): WorkspaceStatus {
  return {
    kind,
    label: STATUS_LABELS[kind],
    sinceIso: opts.sinceIso || '',
    refillIso: opts.refillIso || '',
    daysSince: opts.daysSince || 0,
    daysToRefill: typeof opts.daysToRefill === 'number' ? opts.daysToRefill : -1,
  };
}

/**
 * Resolve the effective lifecycle status of a workspace.
 *
 * Priority (highest first):
 *   1. canceled + grace exceeded → fully-expired
 *   2. canceled                  → expired-canceled
 *   3. tier === EXPIRED + grace  → fully-expired
 *   4. tier === EXPIRED          → expired
 *   5. past_due                  → about-to-expire
 *   6. refill within window      → about-to-refill (suppressed for past_due/canceled/expired)
 *   7. otherwise                 → normal
 */
export function getEffectiveStatus(
  ws: WorkspaceCredit,
  cfg: WorkspaceLifecycleConfig,
  nowMs?: number,
): WorkspaceStatus {
  const status = normalizeStatus(ws.subscriptionStatus);
  const tier = (ws.tier || '').toUpperCase();
  const changedIso = ws.subscriptionStatusChangedAt;
  const daysSinceChange = changedIso ? daysBetween(changedIso, nowMs) : 0;
  const grace = cfg.expiryGracePeriodDays;

  const isCanceled = status === 'canceled' || status === 'cancelled';
  const isPastDue = status === 'past_due' || status === 'unpaid';

  // 1 & 2: canceled
  if (isCanceled) {
    if (changedIso && daysSinceChange >= grace) {
      return buildStatus('fully-expired', { sinceIso: changedIso, daysSince: daysSinceChange });
    }
    return buildStatus('expired-canceled', { sinceIso: changedIso, daysSince: daysSinceChange });
  }

  // 3 & 4: tier-driven expired (covers past_due workspaces that resolveWsTier marks as EXPIRED)
  // We split past_due out below so that tier === 'EXPIRED' here only fires for non-past_due.
  if (tier === 'EXPIRED' && !isPastDue) {
    if (changedIso && daysSinceChange >= grace) {
      return buildStatus('fully-expired', { sinceIso: changedIso, daysSince: daysSinceChange });
    }
    return buildStatus('expired', { sinceIso: changedIso, daysSince: daysSinceChange });
  }

  // 5: past_due
  if (isPastDue) {
    return buildStatus('about-to-expire', { sinceIso: changedIso, daysSince: daysSinceChange });
  }

  // 6: about-to-refill
  const refillIso = pickRefillIso(ws);
  if (refillIso) {
    const dToRefill = daysUntil(refillIso, nowMs);
    if (dToRefill >= 0 && dToRefill <= cfg.refillWarningThresholdDays) {
      return buildStatus('about-to-refill', { refillIso, daysToRefill: dToRefill });
    }
  }

  // 7: normal
  return buildStatus('normal', {});
}

/* ------------------------------------------------------------------ */
/*  Canceled credit override (second-layer)                            */
/* ------------------------------------------------------------------ */

/**
 * Returns true when the override should apply.
 *
 * Scope:
 *   - expired-canceled, fully-expired, expired — subscription has lapsed
 *   - about-to-expire (past_due / unpaid) — payment is overdue, billing &
 *     rollover should not be counted as spendable until resolved
 */
export function shouldApplyCanceledOverride(status: WorkspaceStatus): boolean {
  return status.kind === 'expired-canceled'
      || status.kind === 'fully-expired'
      || status.kind === 'expired'
      || status.kind === 'about-to-expire';
}

/**
 * Apply the canceled credit override in-place.
 *
 * Rule: when the workspace is effectively expired/canceled, billing & rollover
 * credits are forfeited. Only free + daily count toward `available`.
 *
 * Mutates the passed object so downstream consumers read the same numbers.
 * Idempotent — safe to call repeatedly (already-zero values stay zero).
 */
export function applyCanceledCreditOverride(ws: WorkspaceCredit, status: WorkspaceStatus): void {
  if (!shouldApplyCanceledOverride(status)) return;

  ws.rollover = 0;
  ws.billingAvailable = 0;
  // Recompute available from surviving sources only.
  const free = ws.freeRemaining || 0;
  const daily = ws.dailyFree || 0;
  ws.available = Math.max(0, free + daily);
  // totalCredits represents the *theoretical* ceiling — drop billing + rollover from it too.
  ws.totalCredits = Math.max(0, (ws.freeGranted || 0) + (ws.dailyLimit || 0) + (ws.topupLimit || 0));
}
