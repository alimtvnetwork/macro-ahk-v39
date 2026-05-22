/**
 * Credit Parser — API response parsing and tier resolution
 *
 * Extracted from credit-fetch.ts (module splitting).
 * Contains: parseLoopApiResponse, syncCreditStateFromApi, resolveWsTier, WsTier, WS_TIER_LABELS.
 */

import { log, logSub } from './logging';
import { CreditSource } from './types';
import { calcTotalCredits, calcAvailableCredits } from './credit-api';
import { loopCreditState, state } from './shared-state';
import { getEffectiveStatus, shouldApplyCanceledOverride, applyCanceledCreditOverride } from './workspace-status';
import { getWorkspaceLifecycleConfig } from './workspace-lifecycle-config';
import { getSettingsOverrides } from './settings-store';
import { enrichProZeroWorkspaces } from './pro-zero/pro-zero-enrichment';

// ============================================
// Workspace Tier Enum
// ============================================
export const enum WsTier {
  FREE     = 'FREE',
  LITE     = 'LITE',
  PRO      = 'PRO',
  EXPIRED  = 'EXPIRED',
}

export const WS_TIER_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  FREE:    { label: 'FREE',    bg: 'rgba(255,255,255,0.08)', fg: '#94a3b8' },
  LITE:    { label: 'LITE',    bg: '#3b82f6',                fg: '#fff' },
  PRO:     { label: 'PRO',     bg: '#F59E0B',                fg: '#1a1a2e' },
  EXPIRED: { label: 'EXPIRED', bg: '#7f1d1d',                fg: '#fca5a5' },
};

/**
 * Derive workspace tier from plan name + subscription status + billing limit.
 * - plan "free" or empty + no billing → FREE
 * - plan "ktlo" or "lite" → LITE
 * - plan "free" + subStatus "canceled"/"cancelled" → EXPIRED (was pro, now canceled)
 * - billing limit > 0 + subStatus "active" → PRO
 * - billing limit > 0 + subStatus canceled → EXPIRED
 */
export function resolveWsTier(plan: string, subStatus: string, billingLimit: number): string {
  const p = (plan || '').toLowerCase().trim();
  const s = (subStatus || '').toLowerCase().trim();

  // Lite / ktlo plan
  if (p === 'ktlo' || p === 'lite') return 'LITE';

  // Has billing = was/is pro
  if (billingLimit > 0 || (p && p !== 'free')) {
    if (s === 'active') return 'PRO';
    if (s === 'canceled' || s === 'cancelled' || s === 'past_due') return 'EXPIRED';
    return 'PRO'; // default if billing exists
  }

  // Free plan + canceled sub = expired trial/pro
  if (s === 'canceled' || s === 'cancelled') return 'EXPIRED';

  return 'FREE';
}

// ============================================
// Expiry helpers — used by ws-list-renderer & filter logic
// ============================================

/**
 * Returns true when the workspace is in an "expired" subscription state.
 * Uses subscription_status (canonical signal): canceled / cancelled / past_due / unpaid.
 * Centralised here so the filter, badge, and sort code share one definition.
 */
export function isExpiredWs(ws: import('./types').WorkspaceCredit): boolean {
  const s = (ws.subscriptionStatus || '').toLowerCase().trim();
  return s === 'canceled' || s === 'cancelled' || s === 'past_due' || s === 'unpaid';
}

/**
 * Returns the integer number of full days since the workspace's
 * subscription_status last changed (i.e. since it became expired).
 * Returns null when no timestamp is available or it cannot be parsed.
 */
export function expiredDays(ws: import('./types').WorkspaceCredit): number | null {
  const iso = ws.subscriptionStatusChangedAt;
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000);
}

/**
 * Format the workspace expiry-start date as DD/MMM/YY (e.g. 09/Apr/26).
 * Time is intentionally omitted per UX requirement.
 * Returns null when no timestamp is available or cannot be parsed.
 */
export function formatExpiryStartDate(ws: import('./types').WorkspaceCredit): string | null {
  const iso = ws.subscriptionStatusChangedAt;
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayPart = String(d.getDate()).padStart(2, '0');
  const monPart = months[d.getMonth()];
  const yearPart = String(d.getFullYear() % 100).padStart(2, '0');
  return dayPart + '/' + monPart + '/' + yearPart;
}

/**
 * Human-readable duration since expiry started, e.g. "12d", "3mo 4d", "1y 2mo".
 * Returns null when no timestamp is available.
 */
export function formatExpiredDuration(ws: import('./types').WorkspaceCredit): string | null {
  const days = expiredDays(ws);
  if (days === null) return null;
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

// ============================================
// Phase 1 (workspace-status-tooltip): lifecycle / meta extraction.
// Pulled out of parseWorkspaceItem to keep that function under the
// max-lines-per-function limit.
// ============================================
interface LifecycleMeta {
  numProjects: number;
  nextRefillAt: string;
  billingPeriodEndAt: string;
  createdAt: string;
  planType: string;
  gitSyncEnabled: boolean;
  membershipRole: string;
}

function extractLifecycleMeta(readField: (key: string) => unknown): LifecycleMeta {
  const expFeatures = (readField('experimental_features') || {}) as Record<string, unknown>;
  const membership = (readField('membership') || {}) as Record<string, unknown>;
  return {
    numProjects: Number(readField('num_projects') || 0) || 0,
    nextRefillAt: (readField('next_monthly_credit_grant_date') || '') as string,
    billingPeriodEndAt: (readField('billing_period_end_date') || '') as string,
    createdAt: (readField('created_at') || '') as string,
    planType: (readField('plan_type') || '') as string,
    gitSyncEnabled: expFeatures.gitsync_github === true,
    membershipRole: ((membership.role as string) || '') as string,
  };
}

// ============================================
// parseWorkspaceItem — extract a single workspace from API response
// ============================================
function parseWorkspaceItem(rawItem: Record<string, unknown>, wsIdx: number): import('./types').WorkspaceCredit {
  const rawWs = rawItem as Record<string, unknown>;
  const ws = (rawWs.workspace || rawWs) as Record<string, number | string>;
  const bUsed = (ws.billing_period_credits_used as number) || 0;
  const bLimit = (ws.billing_period_credits_limit as number) || 0;
  const dUsed = (ws.daily_credits_used as number) || 0;
  const dLimit = (ws.daily_credits_limit as number) || 0;
  const rUsed = (ws.rollover_credits_used as number) || 0;
  const rLimit = (ws.rollover_credits_limit as number) || 0;
  const freeGranted = (ws.credits_granted as number) || 0;
  const freeUsed = (ws.credits_used as number) || 0;
  const topupLimit = Math.round((ws.topup_credits_limit as number) || 0);
  const totalCredits = calcTotalCredits(freeGranted, dLimit, bLimit, topupLimit, rLimit);
  // Helper: read a field that may live either on rawWs (when nested under .workspace) or on the inner ws record (flat shape).
  const readField = (key: string): unknown => rawWs.workspace
    ? (rawWs as Record<string, unknown>)[key]
    : (ws as Record<string, unknown>)[key];
  const subStatus = (readField('subscription_status') || '') as string;
  const plan = (readField('plan') || (rawWs.plan as string) || '') as string;
  const meta = extractLifecycleMeta(readField);
  return {
    id: (ws.id as string) || '',
    name: ((ws.name as string) || 'WS' + wsIdx).substring(0, 12),
    fullName: (ws.name as string) || 'WS' + wsIdx,
    dailyFree: Math.max(0, Math.round(dLimit - dUsed)), dailyLimit: Math.round(dLimit), dailyUsed: Math.round(dUsed),
    rollover: Math.max(0, Math.round(rLimit - rUsed)), rolloverLimit: Math.round(rLimit), rolloverUsed: Math.round(rUsed),
    available: calcAvailableCredits(totalCredits, rUsed, dUsed, bUsed, freeUsed),
    billingAvailable: Math.max(0, Math.round(bLimit - bUsed)),
    used: Math.round(bUsed), limit: Math.round(bLimit),
    freeGranted: Math.round(freeGranted), freeRemaining: Math.max(0, Math.round(freeGranted - freeUsed)),
    hasFree: freeGranted > 0 && freeUsed < freeGranted,
    topupLimit, totalCreditsUsed: Math.round((ws.total_credits_used as number) || 0), totalCredits,
    subscriptionStatus: subStatus,
    subscriptionStatusChangedAt: (readField('subscription_status_changed_at') || '') as string,
    plan, role: (readField('role') || 'N/A') as string,
    tier: resolveWsTier(plan, subStatus, bLimit),
    raw: ws, rawApi: rawWs as Record<string, unknown>,
    numProjects: meta.numProjects, gitSyncEnabled: meta.gitSyncEnabled,
    nextRefillAt: meta.nextRefillAt, billingPeriodEndAt: meta.billingPeriodEndAt,
    createdAt: meta.createdAt, membershipRole: meta.membershipRole, planType: meta.planType,
  };
}

// ============================================
// applyLifecycleOverrides — single chokepoint
// (Phase 5 — workspace-status-tooltip v2.213.0)
//
// For canceled / fully-expired / expired workspaces, zero out billing +
// rollover and recompute `available` from surviving sources only. Runs
// BEFORE aggregateCreditTotals so global totals reflect post-override values
// and every downstream consumer (status bar segments, row credit chips,
// hover card, focus-current summary, CSV export) reads consistent numbers.
//
// Idempotent — re-running on the same array is a no-op.
// ============================================
function applyLifecycleOverrides(perWs: import('./types').WorkspaceCredit[]): void {
  const cfg = getWorkspaceLifecycleConfig();
  // Default true — only opt-out disables the override.
  const enabled = getSettingsOverrides().enableCanceledCreditOverride !== false;
  if (!enabled) {
    log('Lifecycle overrides disabled via enableCanceledCreditOverride=false', 'info');
    return;
  }
  let overridden = 0;
  for (const ws of perWs) {
    const status = getEffectiveStatus(ws, cfg);
    if (!shouldApplyCanceledOverride(status)) continue;
    const beforeAvail = ws.available || 0;
    const beforeBilling = ws.billingAvailable || 0;
    const beforeRollover = ws.rollover || 0;
    applyCanceledCreditOverride(ws, status);
    overridden++;
    logSub(
      'lifecycle override [' + status.kind + '] ' + (ws.fullName || ws.name)
        + ': available ' + beforeAvail + ' → ' + ws.available
        + ' (billing ' + beforeBilling + ' → 0, rollover ' + beforeRollover + ' → 0)',
      2,
    );
  }
  if (overridden > 0) {
    log('Lifecycle overrides applied to ' + overridden + ' workspace(s)', 'info');
  }
}

// ============================================
// aggregateCreditTotals — sum per-workspace credits (post-override)
// ============================================
function aggregateCreditTotals(perWs: import('./types').WorkspaceCredit[]): void {
  let tdf = 0, tr = 0, ta = 0, tba = 0;
  for (const ws of perWs) {
    tdf += ws.dailyFree;
    tr += ws.rollover;
    ta += ws.available;
    tba += ws.billingAvailable;
  }
  loopCreditState.totalDailyFree = tdf;
  loopCreditState.totalRollover = tr;
  loopCreditState.totalAvailable = ta;
  loopCreditState.totalBillingAvail = tba;
}

// ============================================
// matchCurrentWorkspace — find current ws by name
// ============================================
function matchCurrentWorkspace(perWs: import('./types').WorkspaceCredit[]): void {
  if (!state.workspaceName || perWs.length === 0) return;
  for (const ws of perWs) {
    if (ws.fullName === state.workspaceName || ws.name === state.workspaceName) {
      loopCreditState.currentWs = ws;
      return;
    }
  }
}

// ============================================
// buildWsByIdIndex — O(1) lookup dictionary
// ============================================
function buildWsByIdIndex(perWs: import('./types').WorkspaceCredit[]): void {
  loopCreditState.wsById = {};
  for (const ws of perWs) {
    if (ws.id) loopCreditState.wsById[ws.id] = ws;
  }
}

// ============================================
// parseLoopApiResponse — parse /user/workspaces API response
// ============================================
export function parseLoopApiResponse(data: Record<string, unknown>): boolean {
  const workspaces = (data.workspaces || data || []) as Array<Record<string, unknown>>;
  if (!Array.isArray(workspaces)) {
    log('parseLoopApiResponse: unexpected response shape', 'warn');
    return false;
  }

  const perWs = workspaces.map((raw, idx) => parseWorkspaceItem(raw, idx));

  loopCreditState.perWorkspace = perWs;
  loopCreditState.lastCheckedAt = Date.now();

  applyLifecycleOverrides(perWs);
  aggregateCreditTotals(perWs);
  matchCurrentWorkspace(perWs);
  buildWsByIdIndex(perWs);

  loopCreditState.source = CreditSource.Api;
  log('Credit API: parsed ' + perWs.length + ' workspaces — dailyFree=' + loopCreditState.totalDailyFree + ' rollover=' + loopCreditState.totalRollover + ' available=' + loopCreditState.totalAvailable + ' | wsById keys=' + Object.keys(loopCreditState.wsById).length, 'success');
  return true;
}

/**
 * Run pro_0 enrichment over the current `perWorkspace` snapshot, then
 * re-aggregate totals + rebuild indices so downstream consumers reflect the
 * authoritative /credit-balance numbers.
 *
 * Spec: spec/22-app-issues/110-macro-controller-pro-zero-credit-balance.md §3, §8
 *
 * Returns the count of rows mutated. No-op (returns 0) when no rows match
 * the PRO_ZERO branch.
 */
export async function applyProZeroEnrichment(): Promise<number> {
  const perWs = loopCreditState.perWorkspace || [];
  if (perWs.length === 0) return 0;
  const mutated = await enrichProZeroWorkspaces(perWs);
  if (mutated === 0) return 0;

  // Re-run dependent passes so totals + currentWs reflect enriched values.
  applyLifecycleOverrides(perWs);
  aggregateCreditTotals(perWs);
  matchCurrentWorkspace(perWs);
  buildWsByIdIndex(perWs);
  log('[ProZero] Enriched ' + mutated + ' workspace(s) — re-aggregated totals', 'success');
  return mutated;
}

// ============================================
// syncCreditStateFromApi — sync loop state from API data
// ============================================
export function syncCreditStateFromApi(): void {
  const cws = loopCreditState.currentWs;
  if (!cws) {
    logSub('syncCreditState: no currentWs — cannot determine credit', 1);
    return;
  }
  const dailyFree = cws.dailyFree || 0;
  const hasCredit = dailyFree > 0;
  state.hasFreeCredit = hasCredit;
  state.isIdle = !hasCredit;
  state.lastStatusCheck = Date.now();
  log('API Credit Sync: ' + cws.fullName + ' dailyFree=' + dailyFree + ' (available=' + cws.available + ') → ' + (hasCredit ? '[Y] FREE CREDIT' : '[N] NO FREE CREDIT → will move'), hasCredit ? 'success' : 'warn');
}
