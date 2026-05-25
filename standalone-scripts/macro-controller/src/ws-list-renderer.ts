/**
 * MacroLoop Controller — Workspace List Renderer & Dropdown Populator
 * Phase 5A: Extracted from ws-selection-ui.ts
 *
 * Contains: renderLoopWorkspaceList, populateLoopWorkspaceDropdown,
 * invalidateWsDropdownHash, wsRenderStats, buildLoopTooltipText,
 * local state (compact mode, free-only filter)
 */

import type {
  WorkspaceCredit,
  HTMLElementWithHandlers,
} from './types';
import {
  loopCreditState,
  state,
  getLoopWsCheckedIds,
  cPrimaryLight,
  cPrimaryHL,
  cPrimaryBgAL,
} from './shared-state';
import { log } from './logging';
import { calcTotalCredits, renderCreditBar } from './credit-api';
import {
  fetchLoopCredits,
  WS_TIER_LABELS,
  isExpiredWs,
  expiredDays,
  formatExpiryStartDate,
  formatExpiredDuration,
  getEffectiveStatus,
  getWorkspaceLifecycleConfig,
  formatDateDDMMMYY,
  formatDayCount,
} from './credit-fetch';
import type { WorkspaceStatus } from './credit-fetch';
import { moveToWorkspace } from './workspace-management';
import { attachWorkspaceHoverCard, hideWorkspaceHoverCard } from './ws-hover-card';
import { autoDetectLoopCurrentWorkspace } from './workspace-detection';
import {
  handleWsCheckboxClick,
  setLoopWsNavIndex,
} from './ws-checkbox-handler';
import { showWsContextMenu } from './ws-context-menu';
import { logError } from './error-utils';

// ── Centralized constants ──
import { SEL_LOOP_WS_ITEM, REFILL_PRIORITY_WINDOW_DAYS } from './constants';
import { DataAttr, DomId } from './types';
import { sortByRefillPriority, daysToRefillForWs } from './workspace-refill-priority';
// Issue 115 — collapsed display classifier + centralised tone resolver.
import { classifyFromStatus, type WorkspaceDisplayStatus } from './workspace-display-status';
import { resolveBadgeStyle } from './workspace-badge-styles';

const CSS_BG = ';background:';

// ============================================
// CQ11/CQ17: Encapsulated view-filter state
// ============================================

/** Manages workspace list view state (compact mode, free-only filter, expired-with-credits filter, refill-soon filter, refill-priority sort). */
class WsListViewState {
  private static instance: WsListViewState | null = null;
  private isFreeOnly = false;
  private isExpiredWithCredits = false;
  private isRefillSoon = false;
  private isCompactMode: boolean;
  private isRefillPriority: boolean;

  private constructor() {
    this.isCompactMode = this.loadBool('ml_compact_mode', true);
    this.isRefillPriority = this.loadBool('ml_refill_priority', false);
  }

  static getInstance(): WsListViewState {
    if (!WsListViewState.instance) {
      WsListViewState.instance = new WsListViewState();
    }

    return WsListViewState.instance;
  }

  private loadBool(key: string, fallback: boolean): boolean {
    try {
      const stored: string | null = localStorage.getItem(key);

      return stored === null ? fallback : stored === 'true';
    } catch (e: unknown) {

      logError('viewState.load', 'Failed to read "' + key + '" from localStorage', e);

      return fallback;
    }
  }

  getCompactMode(): boolean { return this.isCompactMode; }
  setCompactMode(val: boolean): void { this.isCompactMode = val; }

  getFreeOnly(): boolean { return this.isFreeOnly; }
  setFreeOnly(val: boolean): void { this.isFreeOnly = val; }

  getExpiredWithCredits(): boolean { return this.isExpiredWithCredits; }
  setExpiredWithCredits(val: boolean): void { this.isExpiredWithCredits = val; }

  getRefillSoon(): boolean { return this.isRefillSoon; }
  setRefillSoon(val: boolean): void { this.isRefillSoon = val; }

  getRefillPriority(): boolean { return this.isRefillPriority; }

  setRefillPriority(val: boolean): void {
    this.isRefillPriority = val;
    try {
      localStorage.setItem('ml_refill_priority', val ? 'true' : 'false');
    } catch (e: unknown) {
      logError('viewState.setRefillPriority', 'Failed to persist refill priority flag', e);
    }
  }
}


/** Shorthand for singleton access. */
function viewState(): WsListViewState {

  return WsListViewState.getInstance();
}

/** Get compact mode state. */
export function getLoopWsCompactMode(): boolean { return viewState().getCompactMode(); }

/** Set compact mode state. */
export function setLoopWsCompactMode(val: boolean): void { viewState().setCompactMode(val); }

/** Get free-only filter state. */
export function getLoopWsFreeOnly(): boolean { return viewState().getFreeOnly(); }

/** Set free-only filter state. */
export function setLoopWsFreeOnly(val: boolean): void { viewState().setFreeOnly(val); }

/**
 * Minimum `available` credit threshold for a workspace to surface in the
 * "Expired with credits" filter. Workspaces marked EXPIRED but holding
 * more than this many credits are recovery candidates worth reviewing.
 */
export const EXPIRED_WITH_CREDITS_MIN = 5;

/** Get expired-with-credits filter state. */
export function getLoopWsExpiredWithCredits(): boolean {
  return viewState().getExpiredWithCredits();
}

/** Get refill-soon filter state (only show workspaces with display kind = refill-soon). */
export function getLoopWsRefillSoon(): boolean {
  return viewState().getRefillSoon();
}

/** Set refill-soon filter state. */
export function setLoopWsRefillSoon(val: boolean): void {
  viewState().setRefillSoon(val);
}


/** Set expired-with-credits filter state. */
export function setLoopWsExpiredWithCredits(val: boolean): void {
  viewState().setExpiredWithCredits(val);
}

/** Get refill-priority sort state. */
export function getLoopWsRefillPriority(): boolean {
  return viewState().getRefillPriority();
}

/** Set refill-priority sort state. */
export function setLoopWsRefillPriority(val: boolean): void {
  viewState().setRefillPriority(val);
}

// ============================================
// Helper: fetch credits with auto-detect (used by ws-context-menu)
// ============================================
export function fetchLoopCreditsWithDetect(isRetry?: boolean): void {
  fetchLoopCredits(isRetry, autoDetectLoopCurrentWorkspace);
}

function buildTooltipProfileLines(ws: WorkspaceCredit): string[] {
  const lines: string[] = ['🪪 PROFILE:'];
  lines.push('  Plan: ' + (ws.planType || ws.tier || 'FREE'));
  lines.push('  Role: ' + (ws.membershipRole || ws.role || 'N/A'));
  if (typeof ws.numProjects === 'number' && ws.numProjects > 0) {
    lines.push('  Projects: ' + ws.numProjects);
  }
  lines.push('  Git Sync: ' + (ws.gitSyncEnabled ? 'enabled' : 'disabled'));
  if (ws.subscriptionStatus) lines.push('  Subscription Status: ' + ws.subscriptionStatus);
  if (ws.subscriptionStatusChangedAt) {
    const days = (function () {
      const t = Date.parse(ws.subscriptionStatusChangedAt);
      if (!Number.isFinite(t)) return 0;
      const diff = Date.now() - t;
      return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
    })();
    const suffix = days > 0 ? ' (' + days + 'd ago)' : '';
    lines.push('  Status Changed: ' + ws.subscriptionStatusChangedAt + suffix);
  }
  if (ws.nextRefillAt) lines.push('  Next Refill: ' + ws.nextRefillAt);
  if (ws.billingPeriodEndAt) lines.push('  Billing Period Ends: ' + ws.billingPeriodEndAt);
  if (ws.createdAt) lines.push('  Created: ' + ws.createdAt);
  return lines;
}

function buildTooltipCalculatedLines(ws: WorkspaceCredit): string[] {
  const lines: string[] = ['📊 CALCULATED:'];
  lines.push('  🆓 Daily Free: ' + (ws.dailyFree || 0) + ' (' + ws.dailyLimit + ' - ' + ws.dailyUsed + ')');
  lines.push('  🔄 Rollover: ' + (ws.rollover || 0) + ' (' + ws.rolloverLimit + ' - ' + ws.rolloverUsed + ')');
  lines.push('  💰 Available: ' + (ws.available || 0) + ' (total:' + (ws.totalCredits || 0) + ' - rUsed:' + (ws.rolloverUsed || 0) + ' - dUsed:' + (ws.dailyUsed || 0) + ' - bUsed:' + (ws.used || 0) + ')');
  lines.push('  📦 Billing Only: ' + (ws.billingAvailable || 0) + ' (' + ws.limit + ' - ' + ws.used + ')');
  const _tc = ws.totalCredits ?? calcTotalCredits(ws.freeGranted, ws.dailyLimit, ws.limit, ws.topupLimit, ws.rolloverLimit, ws.plan);
  lines.push('  ⚡ Total Credits: ' + _tc + ' (granted:' + (ws.freeGranted || 0) + ' + daily:' + (ws.dailyLimit || 0) + ' + billing:' + (ws.limit || 0) + ' + topup:' + (ws.topupLimit || 0) + ' + rollover:' + (ws.rolloverLimit || 0) + ')');
  return lines;
}

function buildTooltipRawLines(ws: WorkspaceCredit): string[] {
  const lines: string[] = ['📋 RAW DATA:'];
  lines.push('  ID: ' + ws.id);
  lines.push('  Billing: ' + ws.used + '/' + ws.limit + ' used');
  lines.push('  Rollover: ' + ws.rolloverUsed + '/' + ws.rolloverLimit + ' used');
  lines.push('  Daily: ' + ws.dailyUsed + '/' + ws.dailyLimit + ' used');
  if (ws.freeGranted > 0) lines.push('  Trial: ' + ws.freeRemaining + '/' + ws.freeGranted + ' remaining');
  lines.push('  Status: ' + (ws.subscriptionStatus || 'N/A'));
  if (isExpiredWs(ws)) {
    const startDate = formatExpiryStartDate(ws);
    const duration = formatExpiredDuration(ws);
    if (startDate || duration) {
      const datePart = startDate || 'unknown date';
      const durPart = duration ? ' (' + duration + ')' : '';
      lines.push('  Expired since: ' + datePart + durPart);
    }
  }
  if (ws.raw) {
    const r = ws.raw;
    if (r.last_trial_credit_period) lines.push('  Trial Period: ' + r.last_trial_credit_period);
    if (r.subscription_status) lines.push('  Subscription: ' + r.subscription_status);
  }
  return lines;
}

/**
 * Build detailed tooltip text for a workspace row.
 *
 * Phase 4 (workspace-status-tooltip v2.212.0): adds Plan / Projects / Refill /
 * Git Sync lines so the plain `title=` fallback carries the same data the
 * hover card shows.
 */
export function buildLoopTooltipText(ws: WorkspaceCredit): string {
  const lines: string[] = ['━━━ ' + (ws.fullName || ws.name) + ' ━━━', ''];
  lines.push(...buildTooltipProfileLines(ws));
  lines.push('');
  lines.push(...buildTooltipCalculatedLines(ws));
  lines.push('');
  lines.push(...buildTooltipRawLines(ws));
  return lines.join('\n');
}

/** Active filter state used during rendering. */
interface WsFilterState {
  filter: string;
  freeOnly: boolean;
  rolloverOnly: boolean;
  billingOnly: boolean;
  minCredits: number;
  expiredWithCredits: boolean;
  refillSoon: boolean;
}

/** Read filter state from DOM elements once, outside the loop. */
function readFilterState(filter: string): WsFilterState {
  const rolloverEl = document.getElementById('loop-ws-rollover-filter');
  const billingEl = document.getElementById('loop-ws-billing-filter');
  const minEl = document.getElementById('loop-ws-min-credits');
  return {
    filter,
    freeOnly: viewState().getFreeOnly(),
    rolloverOnly: rolloverEl?.getAttribute(DataAttr.Active) === 'true',
    billingOnly: billingEl?.getAttribute(DataAttr.Active) === 'true',
    minCredits: minEl ? parseInt((minEl as HTMLInputElement).value, 10) || 0 : 0,
    expiredWithCredits: viewState().getExpiredWithCredits(),
    refillSoon: viewState().getRefillSoon(),
  };
}

/** Check if a workspace matches the current name (fuzzy). */
function isCurrentWorkspace(ws: WorkspaceCredit, currentName: string): boolean {
  if (!currentName) return false;
  if (ws.fullName === currentName || ws.name === currentName) return true;
  const lcn = currentName.toLowerCase();
  return (ws.fullName || '').toLowerCase().indexOf(lcn) !== -1 ||
         lcn.indexOf((ws.fullName || '').toLowerCase()) !== -1;
}

/** Check if a workspace currently classifies as "refill-soon" (about-to-refill). */
function isRefillSoonWs(ws: WorkspaceCredit): boolean {
  try {
    const cfg = getWorkspaceLifecycleConfig();
    const source = getEffectiveStatus(ws, cfg);
    const display = classifyFromStatus(source, ws);
    return display.kind === 'refill-soon';
  } catch (e: unknown) {
    logError('passesFilters.refillSoon', 'Failed to classify workspace for refill-soon filter', e);
    return false;
  }
}

/** Check text match against workspace name / fullName. */
function matchesTextFilter(ws: WorkspaceCredit, filter: string): boolean {
  if (!filter) return true;
  return ws.fullName.toLowerCase().indexOf(filter.toLowerCase()) !== -1 ||
    ws.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1;
}

/** Check expired-with-credits filter sub-conditions. */
function matchesExpiredWithCreditsFilter(ws: WorkspaceCredit): boolean {
  if (!isExpiredWs(ws)) return false;
  if ((ws.available || 0) <= EXPIRED_WITH_CREDITS_MIN) return false;
  return true;
}

/** Check if a workspace passes all active filters. */
function passesFilters(ws: WorkspaceCredit, fs: WsFilterState): boolean {
  if (!matchesTextFilter(ws, fs.filter || '')) return false;
  if (fs.freeOnly && (ws.dailyFree || 0) <= 0) return false;
  if (fs.rolloverOnly && (ws.rollover || 0) <= 0) return false;
  if (fs.billingOnly && (ws.billingAvailable || 0) <= 0) return false;
  if (fs.minCredits > 0 && (ws.available || 0) < fs.minCredits) return false;
  if (fs.expiredWithCredits && !matchesExpiredWithCreditsFilter(ws)) return false;
  if (fs.refillSoon && !isRefillSoonWs(ws)) return false;
  return true;
}


/**
 * Recovery score for the "expired with credits" sort.
 *
 * Multiplicative on purpose: a workspace with BOTH high credits AND long
 * expiry rises above rows that score high on only one axis. Days since expiry
 * is clamped to a +1 floor so a freshly-expired workspace still ranks by its
 * credit value (rather than collapsing to 0).
 *
 *   score = max(credits, 0) × max(daysExpired, 0) + max(credits, 0)
 *
 * The trailing `+ credits` term keeps ranking sensible when expiredDays() is
 * unavailable (returns null → 0): credits-only ordering is preserved as a
 * graceful fallback.
 */
function _expiredRecoveryScore(ws: WorkspaceCredit): number {
  const credits = Math.max(ws.available || 0, 0);
  const days = Math.max(expiredDays(ws) || 0, 0);
  return credits * days + credits;
}

/** Resolve the status emoji for a workspace row. */
function wsStatusEmoji(isCurrent: boolean, available: number, limitInt: number): string {
  if (isCurrent) return '📍';
  if (available <= 0) return '🔴';
  if (available <= limitInt * 0.2) return '🟡';
  return '🟢';
}

/** Compute row background style. */
function wsRowBgStyle(isCurrent: boolean, isSel: boolean): string {
  if (isCurrent) return 'background:' + cPrimaryHL + ';border-left:3px solid #a78bfa;';
  return isSel ? 'border-left:3px solid #facc15;' : 'border-left:3px solid transparent;';
}

/**
 * Build the lifecycle status pill HTML.
 *
 * Issue 115 (v3.12.0): collapses the granular `WorkspaceStatus` into a single
 * display badge via `classifyFromStatus`. The legacy duplicated badge pair
 * (`EXPIRED` + `EXPIRED (CANCELED)`, `ABOUT TO EXPIRE` + `EXPIRED`) is gone:
 * each row now renders **at most one** status pill with one short label
 * (`Cancel`, `Refill 5d`, `Expire 3d`, `Expired 2d`).
 *
 * Returns empty string for `normal` rows.
 */
function buildStatusPillHtml(status: WorkspaceStatus, ws: WorkspaceCredit): string {
  const display: WorkspaceDisplayStatus = classifyFromStatus(status, ws);
  if (display.kind === 'normal' || !display.label) return '';
  const style = resolveBadgeStyle(display.tone);

  // Tooltip carries the long-form context (date, internal reason). The
  // custom hover card consumes this via `data-marco-tip`; native `title=`
  // is intentionally omitted (spec/22-app-issues/113).
  const tipParts: string[] = [display.label];
  if (display.tooltip) tipParts.push(display.tooltip);
  if (status.kind === 'about-to-refill' && status.refillIso) {
    tipParts.push('Refills ' + formatDateDDMMMYY(status.refillIso)
      + ' (in ' + formatDayCount(status.daysToRefill) + ')');
  } else if (status.sinceIso) {
    const date = formatDateDDMMMYY(status.sinceIso);
    tipParts.push('Since ' + date + ' (' + formatDayCount(status.daysSince) + ')');
  }
  const tip = tipParts.join(' — ').replace(/"/g, '&quot;');

  return '<span class="marco-ws-status-pill marco-ws-status-' + display.kind
    + '" style="font-size:9px;color:' + style.fg
    + CSS_BG + style.bg
    + ';border:1px solid ' + style.border
    + ';padding:1px 5px;border-radius:3px;font-weight:700;margin-left:5px;vertical-align:middle;letter-spacing:0.3px;text-transform:none;"'
    + ' data-marco-tip="' + tip + '">' + display.label + '</span>';
}

/**
 * Build the inline `R Nd` refill badge for a workspace row. Returns empty
 * string when no usable refill date or refill is beyond the priority
 * window. Colors follow the about-to-refill warning palette:
 *   - 0 days  → sky-400 (today)
 *   - 1–3d    → amber-400 (urgent)
 *   - 4–10d   → slate-400 (heads-up)
 *
 * v3.10.0 — spec/22-app-issues/refill-priority-filter/01-overview.md §4.
 */
function buildRefillBadgeHtml(ws: WorkspaceCredit): string {
  const days = daysToRefillForWs(ws);
  if (days === null) return '';
  if (days > REFILL_PRIORITY_WINDOW_DAYS) return '';
  let fg = '#cbd5e1';
  let bg = 'rgba(71,85,105,0.35)';
  let border = 'rgba(148,163,184,0.5)';
  if (days === 0) {
    fg = '#bae6fd'; bg = 'rgba(2,132,199,0.45)'; border = '#38bdf8';
  } else if (days <= 3) {
    fg = '#fde68a'; bg = 'rgba(180,83,9,0.45)'; border = '#f59e0b';
  }
  return '<span class="loop-ws-refill-badge" style="font-size:9px;color:' + fg
    + CSS_BG + bg + ';border:1px solid ' + border
    + ';padding:1px 5px;border-radius:3px;font-weight:700;margin-left:5px;vertical-align:middle;letter-spacing:0.3px;">R '
    + days + 'd</span>';
}

/** Build the inner HTML for a workspace row. */
function buildTierBadgeHtml(ws: WorkspaceCredit): string {
  const wsTier = ws.tier || 'FREE';
  const tierMeta = WS_TIER_LABELS[wsTier] || WS_TIER_LABELS['FREE'];
  let tierBadge = '<span style="font-size:10px;color:' + tierMeta.fg + CSS_BG + tierMeta.bg + ';padding:2px 5px;border-radius:3px;font-weight:700;margin-left:6px;vertical-align:middle;letter-spacing:0.3px;">' + tierMeta.label + '</span>';

  const cfg = getWorkspaceLifecycleConfig();
  if (cfg.enableWorkspaceStatusLabels) {
    const status = getEffectiveStatus(ws, cfg);
    tierBadge += buildStatusPillHtml(status, ws);
  } else if (wsTier === 'EXPIRED') {
    const days = expiredDays(ws);
    if (days !== null) {
      const startDate = formatExpiryStartDate(ws);
      const duration = formatExpiredDuration(ws);
      const tipParts = ['Expired'];
      if (startDate) tipParts.push('since ' + startDate);
      if (duration) tipParts.push('(' + duration + ')');
      const tip = tipParts.join(' ').replace(/"/g, '&quot;');
      tierBadge += '<span style="font-size:10px;color:#fca5a5;background:rgba(127,29,29,0.55);padding:2px 5px;border-radius:3px;font-weight:600;margin-left:3px;vertical-align:middle;" data-marco-tip="' + tip + '">·' + days + 'd</span>';
    }
  }
  if (!cfg.enableWorkspaceStatusLabels) {
    tierBadge += buildRefillBadgeHtml(ws);
  }
  return tierBadge;
}

function buildWsRowInnerHtml(
  ws: WorkspaceCredit, isCurrent: boolean, isChecked: boolean,
  emoji: string, creditBarHtml: string,
): string {
  const tierBadge = buildTierBadgeHtml(ws);
  const nameColor = isCurrent ? '#67e8f9' : '#e2e8f0';
  const nameBold = isCurrent ? 'font-weight:800;' : 'font-weight:500;';

  let html = '<span class="loop-ws-checkbox" style="font-size:11px;cursor:pointer;color:' + (isChecked ? '#a78bfa' : '#64748b') + ';user-select:none;flex-shrink:0;">' + (isChecked ? '☑' : '☐') + '</span>'
    + '<span style="font-size:12px;">' + emoji + '</span>'
    + '<div style="flex:1;min-width:0;">'
    + '<div class="loop-ws-name" style="color:' + nameColor + ';font-size:11px;' + nameBold + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (ws.fullName || ws.name) + tierBadge + '</div>'
    + '<div style="display:flex;align-items:center;gap:4px;margin-top:2px;">' + creditBarHtml + '</div>'
    + '</div>';
  if (isCurrent) {
    html += '<span style="font-size:8px;color:' + cPrimaryLight + CSS_BG + cPrimaryBgAL + ';padding:1px 4px;border-radius:3px;font-weight:700;">NOW</span>';
  }
  return html;
}

/** Build a single workspace row DOM element. */
function buildWsRow(
  ws: WorkspaceCredit, wsIndex: number, isCurrent: boolean,
  count: number, maxTotalCredits: number,
): HTMLDivElement {
  const available = Math.round(ws.available || 0);
  const limitInt = Math.round(ws.limit || 0);
  const emoji = wsStatusEmoji(isCurrent, available, limitInt);
  const wsId = String(ws.id || (ws.raw && ws.raw.id) || '');
  const selEl = document.getElementById(DomId.LoopWsSelected);
  const isSel = selEl ? selEl.getAttribute(DataAttr.SelectedId) === wsId : false;
  const isChecked = !!getLoopWsCheckedIds()[wsId];
  // spec/22-app-issues/113: the custom hover card (ws-hover-card.ts) is the
  // single source of truth for workspace hover info. Stash the fallback text
  // on a data- attribute (consumed by the hover card / debug tools) instead
  // of `row.title`, which would re-introduce the native browser tooltip and
  // produce the duplicate-tooltip bug.
  const tooltip = buildLoopTooltipText(ws).replace(/"/g, '&quot;');

  const row = document.createElement('div');
  row.className = 'loop-ws-item';
  row.setAttribute(DataAttr.WsId, wsId);
  row.setAttribute(DataAttr.WsName, ws.fullName || ws.name);
  row.setAttribute(DataAttr.WsCurrent, isCurrent ? 'true' : 'false');
  row.setAttribute('data-ws-idx', String(count));
  row.setAttribute('data-ws-raw-idx', String(wsIndex));
  row.setAttribute('data-marco-tip', tooltip);
  // v2.195.0: padding bumped 5px/6px → 7px/8px to give the larger EXPIRED
  // badge room to breathe without crowding adjacent rows.
  row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 8px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);transition:background 0.15s;font-size:11px;' + wsRowBgStyle(isCurrent, isSel);

  const dailyFree = Math.round(ws.dailyFree || 0);
  const rollover = Math.round(ws.rollover || 0);
  const billingAvail = Math.round(ws.billingAvailable || 0);
  const totalCap = Math.round(ws.totalCredits ?? calcTotalCredits(ws.freeGranted, ws.dailyLimit, ws.limit, ws.topupLimit, ws.rolloverLimit, ws.plan));
  const creditBarHtml = renderCreditBar({
    totalCredits: totalCap, available: Math.round(ws.available || 0), totalUsed: ws.totalCreditsUsed || 0,
    freeRemaining: Math.round(ws.freeRemaining || 0), billingAvail, rollover, dailyFree,
    compact: viewState().getCompactMode(), maxTotalCredits,
  });

  row.innerHTML = buildWsRowInnerHtml(ws, isCurrent, isChecked, emoji, creditBarHtml);
  return row;
}

/**
 * Render the workspace list with filtering, credit bars, and event delegation.
 */
function computeMaxTotalCredits(workspaces: WorkspaceCredit[]): number {
  let maxTotalCredits = 1;
  for (const ws of workspaces) {
    const mtc = Math.round(ws.totalCredits ?? calcTotalCredits(ws.freeGranted, ws.dailyLimit, ws.limit, ws.topupLimit, ws.rolloverLimit, ws.plan));
    if (mtc > maxTotalCredits) maxTotalCredits = mtc;
  }
  return maxTotalCredits;
}

function filterAndSortWorkspaces(
  workspaces: WorkspaceCredit[],
  filter: string,
): Array<{ ws: WorkspaceCredit; wsIndex: number }> {
  const fs = readFilterState(filter);
  const survivors: Array<{ ws: WorkspaceCredit; wsIndex: number }> = [];
  for (const [wsIndex, ws] of workspaces.entries()) {
    if (!passesFilters(ws, fs)) continue;
    survivors.push({ ws, wsIndex });
  }

  if (fs.expiredWithCredits) {
    survivors.sort(function (a, b) {
      return _expiredRecoveryScore(b.ws) - _expiredRecoveryScore(a.ws);
    });
  } else if (viewState().getRefillPriority() || fs.refillSoon) {
    // v3.16.1 bug fix — When the "Refill-soon" filter is active, ALL surviving rows
    // are refill-soon (often with identical `daysToRefill`, e.g. all "1d"), so the
    // natural API order leaves zero-credit workspaces at the top. Apply the refill
    // priority sort unconditionally in that case so the highest-credit workspaces
    // float up. `sortByRefillPriority` already breaks score ties by `available` desc.
    const sorted = sortByRefillPriority(survivors, REFILL_PRIORITY_WINDOW_DAYS);
    survivors.length = 0;
    for (const r of sorted) survivors.push(r);
  }

  return survivors;
}

function updateWsCountLabel(count: number, total: number, filter: string): void {
  const countLabel = document.getElementById('loop-ws-count-label');
  if (!countLabel) return;
  countLabel.textContent = (filter || getLoopWsFreeOnly() || getLoopWsExpiredWithCredits() || getLoopWsRefillSoon() || count !== total)
    ? 'Workspaces (' + count + '/' + total + ')'
    : 'Workspaces (' + total + ')';
}

export function renderLoopWorkspaceList(
  workspaces: WorkspaceCredit[],
  currentName: string,
  filter: string,
): void {
  const listEl = document.getElementById('loop-ws-list');
  if (!listEl) return;

  let count = 0;
  let currentIdx = -1;
  const maxTotalCredits = computeMaxTotalCredits(workspaces);
  const survivors = filterAndSortWorkspaces(workspaces, filter);

  const frag = document.createDocumentFragment();
  for (const { ws, wsIndex } of survivors) {
    const isCurrent = isCurrentWorkspace(ws, currentName);
    if (isCurrent) currentIdx = count;
    frag.appendChild(buildWsRow(ws, wsIndex, isCurrent, count, maxTotalCredits));
    count++;
  }

  if (count === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.style.cssText = 'padding:8px;color:' + cPrimaryLight + ';font-size:10px;text-align:center;';
    emptyEl.textContent = '🔍 No matches';
    frag.appendChild(emptyEl);
  }

  listEl.innerHTML = '';
  listEl.appendChild(frag);

  updateWsCountLabel(count, workspaces.length, filter);
  attachWsListEventDelegation(listEl, currentIdx, filter);
  attachHoverCardForList(listEl);
}

/** Phase 4 (workspace-status-tooltip v2.212.0): mount the rich hover card. */
function attachHoverCardForList(listEl: HTMLElement): void {
  attachWorkspaceHoverCard(listEl, function (id: string) {
    const list = loopCreditState.perWorkspace || [];
    for (const w of list) {
      const wid = String(w.id || (w.raw && w.raw.id) || '');
      if (wid === id) return w;
    }
    return null;
  });
  hideWorkspaceHoverCard();
}

/**
 * Attach event delegation handlers on the workspace list container.
 */
function attachWsListEventDelegation(
  listEl: HTMLElement,
  currentIdx: number,
  filter: string,
): void {
  const elWithHandlers = listEl as HTMLElementWithHandlers;

  if (elWithHandlers._wsDelegateHandler) {
    listEl.removeEventListener('click', elWithHandlers._wsDelegateHandler);
    listEl.removeEventListener('dblclick', elWithHandlers._wsDblHandler!);
    listEl.removeEventListener('contextmenu', elWithHandlers._wsCtxHandler!);
    listEl.removeEventListener('mouseover', elWithHandlers._wsHoverHandler!);
    listEl.removeEventListener('mouseout', elWithHandlers._wsOutHandler!);
  }

  elWithHandlers._wsDelegateHandler = _createClickHandler();
  elWithHandlers._wsDblHandler = _createDblClickHandler();
  elWithHandlers._wsCtxHandler = _createCtxHandler();
  elWithHandlers._wsHoverHandler = _createHoverHandler();
  elWithHandlers._wsOutHandler = _createOutHandler();

  listEl.addEventListener('click', elWithHandlers._wsDelegateHandler);
  listEl.addEventListener('dblclick', elWithHandlers._wsDblHandler);
  listEl.addEventListener('contextmenu', elWithHandlers._wsCtxHandler);
  listEl.addEventListener('mouseover', elWithHandlers._wsHoverHandler);
  listEl.addEventListener('mouseout', elWithHandlers._wsOutHandler);

  // Auto-scroll to current workspace, but do NOT auto-select it as a move target.
  // This avoids a misleading no-op where the Move button targets the current workspace.
  if (currentIdx >= 0 && !filter) {
    setTimeout(function () {
      const currentItem = listEl.querySelector('.loop-ws-item[data-ws-current="true"]');
      if (currentItem) {
        currentItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 50);
  }
}

function _createClickHandler(): (e: MouseEvent) => void {
  return function (e: MouseEvent) {
    const item = (e.target as HTMLElement).closest(SEL_LOOP_WS_ITEM) as HTMLElement | null;
    if (!item) return;
    if ((e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains('loop-ws-checkbox')) {
      e.preventDefault();
      e.stopPropagation();
      // v2.148.0: pass DOM-visible index so shift-click range respects active filters
      handleWsCheckboxClick(
        item.getAttribute(DataAttr.WsId) || '',
        parseInt(item.getAttribute('data-ws-idx') || '0', 10),
        e.shiftKey,
      );
      return;
    }
    setLoopWsNavIndex(parseInt(item.getAttribute('data-ws-idx') || '0', 10));
    log('Selected workspace: ' + item.getAttribute(DataAttr.WsName), 'success');
  };
}

function _createDblClickHandler(): (e: MouseEvent) => void {
  return function (e: MouseEvent) {
    const item = (e.target as HTMLElement).closest(SEL_LOOP_WS_ITEM) as HTMLElement | null;
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    if (item.getAttribute(DataAttr.WsCurrent) === 'true') {
      log('Double-click on current workspace "' + item.getAttribute(DataAttr.WsName) + '" — no move needed', 'warn');
      return;
    }
    log('Double-click move -> ' + item.getAttribute(DataAttr.WsName) + ' (id=' + item.getAttribute(DataAttr.WsId) + ')', 'delegate');
    moveToWorkspace(item.getAttribute(DataAttr.WsId) || '', item.getAttribute(DataAttr.WsName) || '');
  };
}

function _createCtxHandler(): (e: MouseEvent) => void {
  return function (e: MouseEvent) {
    const item = (e.target as HTMLElement).closest(SEL_LOOP_WS_ITEM) as HTMLElement | null;
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    showWsContextMenu(
      item.getAttribute(DataAttr.WsId) || '',
      item.getAttribute(DataAttr.WsName) || '',
      e.clientX, e.clientY,
    );
  };
}

function _createHoverHandler(): (e: MouseEvent) => void {
  return function (e: MouseEvent) {
    const item = (e.target as HTMLElement).closest(SEL_LOOP_WS_ITEM) as HTMLElement | null;
    if (!item || item.getAttribute(DataAttr.WsCurrent) === 'true') return;
    const selEl = document.getElementById(DomId.LoopWsSelected);
    const selId = selEl ? selEl.getAttribute(DataAttr.SelectedId) : '';
    const itemId = item.getAttribute(DataAttr.WsId);
    if (selId && selId === itemId) return;
    item.style.background = 'rgba(59,130,246,0.15)';
  };
}

function _createOutHandler(): (e: MouseEvent) => void {
  return function (e: MouseEvent) {
    const item = (e.target as HTMLElement).closest(SEL_LOOP_WS_ITEM) as HTMLElement | null;
    if (!item || item.getAttribute(DataAttr.WsCurrent) === 'true') return;
    const selEl = document.getElementById(DomId.LoopWsSelected);
    const selId = selEl ? selEl.getAttribute(DataAttr.SelectedId) : '';
    const itemId = item.getAttribute(DataAttr.WsId);
    if (selId && selId === itemId) return;
    item.style.background = 'transparent';
  };
}
// ============================================

/** Manages dropdown hash and render stats for dirty-flag optimization. */
class WsDropdownState {
  private static instance: WsDropdownState | null = null;
  private hash = '';
  private renderSkipped = 0;
  private renderExecuted = 0;

  static getInstance(): WsDropdownState {
    if (!WsDropdownState.instance) {
      WsDropdownState.instance = new WsDropdownState();
    }

    return WsDropdownState.instance;
  }

  getHash(): string {

    return this.hash;
  }

  setHash(val: string): void {
    this.hash = val;
  }

  invalidate(): void {
    this.hash = '';
  }

  recordSkip(): void {
    this.renderSkipped++;
  }

  recordExecution(): void {
    this.renderExecuted++;
  }

  get stats(): { skipped: number; executed: number } {

    return { skipped: this.renderSkipped, executed: this.renderExecuted };
  }
}

/** Shorthand for singleton access. */
function dropdownState(): WsDropdownState {

  return WsDropdownState.getInstance();
}

/** P1 performance counters — facade object with live getters */
export const wsRenderStats = {
  get skipped() { return dropdownState().stats.skipped; },
  get executed() { return dropdownState().stats.executed; },
};

/**
 * Populate workspace dropdown — dirty-flag guard to skip re-render when unchanged.
 */
export function populateLoopWorkspaceDropdown(): void {
  const listEl = document.getElementById('loop-ws-list');
  if (!listEl) return;
  const workspaces = loopCreditState.perWorkspace || [];
  if (workspaces.length === 0) {
    if (dropdownState().getHash() === '_empty') { dropdownState().recordSkip(); return; }
    dropdownState().setHash('_empty');
    dropdownState().recordExecution();
    listEl.innerHTML = '<div style="padding:6px;color:' + cPrimaryLight + ';font-size:10px;">📭 No workspaces loaded — click 💰 Credits to retry</div>';

    return;
  }
  const currentName = state.workspaceName || '';
  const searchEl = document.getElementById('loop-ws-search');
  const filter = searchEl ? (searchEl as HTMLInputElement).value.trim() : '';

  // P1 fix: comprehensive hash including all view/filter/credit state
  const rolloverEl = document.getElementById('loop-ws-rollover-filter');
  const billingEl = document.getElementById('loop-ws-billing-filter');
  const minCreditsEl = document.getElementById('loop-ws-min-credits');
  const checkedCount = Object.keys(getLoopWsCheckedIds()).length;

  const hash = [
    workspaces.length,
    currentName,
    filter,
    loopCreditState.lastCheckedAt || 0,
    viewState().getFreeOnly() ? 1 : 0,
    viewState().getCompactMode() ? 1 : 0,
    rolloverEl ? rolloverEl.getAttribute(DataAttr.Active) : '',
    billingEl ? billingEl.getAttribute(DataAttr.Active) : '',
    minCreditsEl ? (minCreditsEl as HTMLInputElement).value : '',
    viewState().getExpiredWithCredits() ? 1 : 0,
    viewState().getRefillPriority() ? 1 : 0,
    checkedCount,
  ].join('|');

  if (hash === dropdownState().getHash()) { dropdownState().recordSkip(); return; }
  dropdownState().setHash(hash);
  dropdownState().recordExecution();
  renderLoopWorkspaceList(workspaces, currentName, filter);
  log(
    'Workspace dropdown populated: ' + workspaces.length +
    ' workspaces (rendered:' + wsRenderStats.executed +
    ' skipped:' + wsRenderStats.skipped + ')',
    'success',
  );
}

/** Force-invalidate the dropdown hash so the next populate call re-renders. */
export function invalidateWsDropdownHash(): void {
  dropdownState().invalidate();
}
