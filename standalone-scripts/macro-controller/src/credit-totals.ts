/**
 * Macro Controller — Credit Totals Aggregator (Issue 116, Task 1)
 *
 * Pure function: given the current `WorkspaceCredit[]` snapshot, produce
 * aggregate totals for the "💰 Credit Totals" modal.
 *
 * Aggregation rules (see spec/22-app-issues/116-credit-totals-modal.md §2.3):
 *  - used / remaining / granted: SUM of the post-enrichment normalized
 *    fields `totalCreditsUsed`, `available`, `totalCredits`. These already
 *    respect the pro_0 vs other-plan split (the pro_0 enrichment overwrites
 *    them with `total_billing_period_used` / `total_remaining` / `total_granted`).
 *    See `mem://features/macro-controller/pro-zero-credit-balance`.
 *  - freeDailyRemaining: MAX of `dailyFree` across workspaces. Lovable's
 *    daily free credits are per-account, not per-workspace; taking the max
 *    treats whichever snapshot is freshest as authoritative.
 *  - freeDailyCap: constant 5 (Lovable Free plan daily credit cap).
 *  - resetAtMyt: next 00:00 in Asia/Kuala_Lumpur (project Core timezone).
 *  - missingCount: rows that had no usable credit fields and were excluded.
 *
 * No retry, no network, no side effects. Pure.
 */

import type { WorkspaceCredit } from './types';

/** Lovable Free plan: 5 daily credits per account. */
export const FREE_DAILY_CAP = 5;

/** IANA timezone for the project (Core rule: Asia/Kuala_Lumpur). */
export const PROJECT_TIMEZONE = 'Asia/Kuala_Lumpur';

export interface CreditTotals {
  /** Sum of credits used this billing cycle across all workspaces. */
  used: number;
  /** Sum of credits remaining this billing cycle. */
  remaining: number;
  /** Sum of total granted credits this billing cycle. */
  granted: number;
  /** Today's remaining free daily credits (max across workspace snapshots). */
  freeDailyRemaining: number;
  /** Free daily cap (constant). */
  freeDailyCap: number;
  /** ISO 8601 timestamp of next free-daily reset (00:00 MYT). */
  resetAtMyt: string;
  /** Workspaces excluded due to entirely-missing credit fields. */
  missingCount: number;
  /** Total workspaces considered. */
  totalCount: number;
}

/** True when none of the three primary credit fields are usable numbers. */
function isMissingCreditData(ws: WorkspaceCredit): boolean {
  const hasUsed = typeof ws.totalCreditsUsed === 'number' && Number.isFinite(ws.totalCreditsUsed);
  const hasAvail = typeof ws.available === 'number' && Number.isFinite(ws.available);
  const hasGranted = typeof ws.totalCredits === 'number' && Number.isFinite(ws.totalCredits);
  return !hasUsed && !hasAvail && !hasGranted;
}

/** Safe number-or-zero coercion. */
function num(value: number | undefined | null): number {
  if (typeof value !== 'number') return 0;
  if (!Number.isFinite(value)) return 0;
  return value;
}

/**
 * Compute the next 00:00 in Asia/Kuala_Lumpur (UTC+8, no DST) as ISO string.
 *
 * Note: MYT has no DST, so a fixed +8h offset is correct. We deliberately
 * avoid `Intl.DateTimeFormat` to keep this fully unit-testable without
 * timezone-data dependencies in the JSDOM test env.
 */
export function computeNextMytMidnight(now: Date): string {
  const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const mytNowMs = now.getTime() + MYT_OFFSET_MS;
  const mytNow = new Date(mytNowMs);
  // Compute next MYT midnight by zeroing the time-of-day in MYT space.
  const nextMytMidnightMs = Date.UTC(
    mytNow.getUTCFullYear(),
    mytNow.getUTCMonth(),
    mytNow.getUTCDate() + 1,
    0, 0, 0, 0,
  ) - MYT_OFFSET_MS;
  return new Date(nextMytMidnightMs).toISOString();
}

/**
 * Aggregate per-workspace credits into totals for the Credit Totals modal.
 *
 * @param workspaces  Normalized snapshot (post pro-zero enrichment).
 * @param now         Reference clock — defaults to `new Date()`.
 */
export function aggregateCreditTotals(
  workspaces: WorkspaceCredit[],
  now: Date = new Date(),
): CreditTotals {
  let used = 0;
  let remaining = 0;
  let granted = 0;
  let freeDailyRemaining = 0;
  let missingCount = 0;

  for (const ws of workspaces) {
    if (isMissingCreditData(ws)) {
      missingCount += 1;
      continue;
    }
    used += num(ws.totalCreditsUsed);
    remaining += num(ws.available);
    granted += num(ws.totalCredits);

    const dailyFree = num(ws.dailyFree);
    if (dailyFree > freeDailyRemaining) {
      freeDailyRemaining = dailyFree;
    }
  }

  // Clamp free-daily remaining to the documented cap (defensive — server
  // occasionally over-reports during grant rollover).
  if (freeDailyRemaining > FREE_DAILY_CAP) {
    freeDailyRemaining = FREE_DAILY_CAP;
  }

  return {
    used: Math.round(used),
    remaining: Math.round(remaining),
    granted: Math.round(granted),
    freeDailyRemaining,
    freeDailyCap: FREE_DAILY_CAP,
    resetAtMyt: computeNextMytMidnight(now),
    missingCount,
    totalCount: workspaces.length,
  };
}
