/**
 * ws-hover-card.ts (Phase 4 — workspace-status-tooltip v2.212.0)
 *
 * Rich floating hover card for the workspace name element in the workspace
 * dropdown. Replaces the plain `title=` attribute on the .loop-ws-name span
 * with a styled, semantic, multi-section panel:
 *
 *   ┌─ Workspace name + lifecycle pill
 *   │  Plan · Role · Projects · Git Sync
 *   ├─ Credits (Free / Daily / Rollover / Billing)
 *   ├─ Refill (when applicable)
 *   ├─ Expiry (when applicable)
 *   └─ Created / IDs
 *
 * Single shared `<div>` mounted lazily — positioned next to the hovered name
 * span and hidden on `mouseleave`. No external libraries.
 *
 * Activated only when `enableWorkspaceHoverDetails` is true in the lifecycle
 * config; otherwise the existing `title=` text on the row stays as the
 * fallback tooltip experience.
 */

import type { WorkspaceCredit } from './types/credit-types';
import type { WorkspaceStatus } from './workspace-status';
import {
  getEffectiveStatus,
  formatDateDDMMMYY,
  formatDayCount,
  daysBetween,
  daysUntil,
} from './workspace-status';
import { getWorkspaceLifecycleConfig, type WorkspaceLifecycleConfig } from './workspace-lifecycle-config';
import { explainEffectiveStatus, type StatusExplanation } from './status-explainer';

const HOVERCARD_ID = 'marco-ws-hovercard';
const SEL_WS_ITEM = '.loop-ws-item';
const SEL_WS_NAME = '.loop-ws-name';

/** Lookup workspace by id from the cached credit state. */
type WsLookup = (wsId: string) => WorkspaceCredit | null;

/* ------------------------------------------------------------------ */
/* Pill colors mirror ws-list-renderer.STATUS_PILL_STYLES              */
/* ------------------------------------------------------------------ */

const PILL_STYLES: Record<string, { bg: string; fg: string; border: string }> = {
  'fully-expired':    { bg: 'rgba(127,29,29,0.85)', fg: '#fee2e2', border: '#dc2626' },
  'expired-canceled': { bg: 'rgba(153,27,27,0.65)', fg: '#fecaca', border: '#ef4444' },
  'expired':          { bg: 'rgba(127,29,29,0.55)', fg: '#fca5a5', border: 'transparent' },
  'about-to-expire':  { bg: 'rgba(180,83,9,0.55)',  fg: '#fde68a', border: '#f59e0b' },
  'about-to-refill':  { bg: 'rgba(2,132,199,0.45)', fg: '#bae6fd', border: '#38bdf8' },
};

/* ------------------------------------------------------------------ */
/* HTML helpers                                                        */
/* ------------------------------------------------------------------ */

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SPAN_COLOR_OPEN = '<span style="color:';

function rowHtml(label: string, value: string, valueColor?: string): string {
  const color = valueColor || '#e2e8f0';
  return '<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-size:11px;">'
    + SPAN_COLOR_OPEN + '#94a3b8;">' + escHtml(label) + '</span>'
    + SPAN_COLOR_OPEN + color + ';font-weight:600;">' + value + '</span>'
    + '</div>';
}

function sectionHeaderHtml(text: string): string {
  return '<div style="font-size:9px;font-weight:700;letter-spacing:0.6px;color:#67e8f9;text-transform:uppercase;margin:8px 0 3px;border-bottom:1px solid rgba(103,232,249,0.18);padding-bottom:2px;">'
    + escHtml(text) + '</div>';
}

function pillHtml(status: WorkspaceStatus): string {
  if (status.kind === 'normal') return '';
  const s = PILL_STYLES[status.kind];
  if (!s) return '';
  return '<span style="font-size:9px;color:' + s.fg
    + ';background:' + s.bg
    + ';border:1px solid ' + s.border
    + ';padding:1px 6px;border-radius:3px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;margin-left:6px;vertical-align:middle;">'
    + escHtml(status.label) + '</span>';
}

/* ------------------------------------------------------------------ */
/* Card body builder                                                   */
/* ------------------------------------------------------------------ */

/**
 * Legacy sub-header builder — kept for diagnostic exports that still inline
 * the plan/role/projects/git-sync metadata row. Not used by the v3.4.3 compact
 * tooltip; the same data is surfaced via the plan chip + Meta section.
 */
export function buildSubHeader(ws: WorkspaceCredit): string {
  const parts: string[] = [];
  parts.push(escHtml(String(ws.planType || ws.tier || 'FREE')));
  if (ws.membershipRole || ws.role) parts.push(escHtml(String(ws.membershipRole || ws.role)));
  if (typeof ws.numProjects === 'number' && ws.numProjects > 0) {
    parts.push(ws.numProjects + ' project' + (ws.numProjects === 1 ? '' : 's'));
  }
  if (ws.gitSyncEnabled) parts.push('Git Sync ✓');
  return '<div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">' + parts.join(' · ') + '</div>';
}

function buildCreditsSection(ws: WorkspaceCredit): string {
  const out: string[] = [sectionHeaderHtml('Credits')];
  out.push(rowHtml('Available', String(Math.round(ws.available || 0)), '#34d399'));
  if ((ws.freeRemaining || 0) > 0 || (ws.freeGranted || 0) > 0) {
    out.push(rowHtml('Free Trial',
      Math.round(ws.freeRemaining || 0) + ' / ' + Math.round(ws.freeGranted || 0)));
  }
  out.push(rowHtml('Daily',
    Math.round(ws.dailyFree || 0) + ' / ' + Math.round(ws.dailyLimit || 0)));
  if ((ws.rolloverLimit || 0) > 0) {
    out.push(rowHtml('Rollover',
      Math.round(ws.rollover || 0) + ' / ' + Math.round(ws.rolloverLimit || 0)));
  }
  out.push(rowHtml('Billing',
    Math.round(ws.billingAvailable || 0) + ' / ' + Math.round(ws.limit || 0)));
  return out.join('');
}

/**
 * Subscription section — always rendered when subscriptionStatus is present.
 * Shows the current status string and, when available, the
 * `subscription_status_changed_at` date with a "(Nd ago)" suffix so users can
 * see when the workspace last transitioned (active → past_due → canceled etc.).
 */
function buildSubscriptionSection(ws: WorkspaceCredit): string {
  const subStatus = (ws.subscriptionStatus || '').trim();
  const changedIso = (ws.subscriptionStatusChangedAt || '').trim();
  if (!subStatus && !changedIso) return '';
  const out: string[] = [sectionHeaderHtml('Subscription')];
  if (subStatus) {
    const norm = subStatus.toLowerCase();
    let color = '#e2e8f0';
    if (norm === 'active' || norm === 'trialing') color = '#34d399';
    else if (norm === 'past_due' || norm === 'unpaid') color = '#fde68a';
    else if (norm === 'canceled' || norm === 'cancelled' || norm === 'expired') color = '#fca5a5';
    out.push(rowHtml('Status', escHtml(subStatus), color));
  }
  if (changedIso) {
    const date = formatDateDDMMMYY(changedIso);
    const days = daysBetween(changedIso);
    const suffix = days > 0 ? ' (' + formatDayCount(days) + ')' : '';
    out.push(rowHtml('Changed', date + suffix));
  }
  return out.join('');
}

/** Status kind constant — used to gate the active vs estimate refill rows. */
const KIND_ABOUT_TO_REFILL: WorkspaceStatus['kind'] = 'about-to-refill';

/** ISO date used for the always-on refill estimate. nextRefillAt wins, then
 *  billingPeriodEndAt — same waterfall the status engine uses internally. */
function pickRefillEstimateIso(ws: WorkspaceCredit): string {
  return (ws.nextRefillAt || ws.billingPeriodEndAt || '').trim();
}

/** Build the highlighted "Next refill (in Nd)" row when in the warning window. */
function activeRefillRow(status: WorkspaceStatus): string {
  if (status.kind !== KIND_ABOUT_TO_REFILL || !status.refillIso) return '';
  return rowHtml('Next refill',
    formatDateDDMMMYY(status.refillIso) + ' (in ' + formatDayCount(status.daysToRefill) + ')',
    '#bae6fd');
}

/** Build the always-on "Estimated next refill" row, with source tag when the
 *  estimate falls back from billingPeriodEndAt. Skipped when the highlighted
 *  active row above already covers the same date. */
function estimatedRefillRow(ws: WorkspaceCredit, status: WorkspaceStatus, estimateIso: string): string {
  if (!estimateIso || status.kind === KIND_ABOUT_TO_REFILL) return '';
  const days = daysUntil(estimateIso);
  const inSuffix = days > 0 ? ' (in ' + formatDayCount(days) + ')' : '';
  const sourceTag = ws.nextRefillAt ? '' : ' [from billing_period_end]';
  return rowHtml('Estimated next refill',
    formatDateDDMMMYY(estimateIso) + inSuffix + sourceTag);
}

/** Calendar projection of the active refill warning threshold:
 *    warningStart = estimateIso − cfg.refillWarningThresholdDays
 *  Lets the user see exactly which day the "About To Refill" pill will trigger. */
function warningStartRow(estimateIso: string, refillWarningDays: number): string {
  if (!estimateIso || refillWarningDays <= 0) return '';
  const refillMs = Date.parse(estimateIso);
  if (!Number.isFinite(refillMs)) return '';
  const warnMs = refillMs - refillWarningDays * 86_400_000;
  const warnDate = formatDateDDMMMYY(new Date(warnMs).toISOString());
  const now = Date.now();
  let suffix = '';
  if (warnMs > now) {
    suffix = ' (in ' + formatDayCount(Math.ceil((warnMs - now) / 86_400_000)) + ')';
  } else if (refillMs > now) {
    suffix = ' (active now)';
  }
  return rowHtml('Warning starts on',
    warnDate + ' · −' + formatDayCount(refillWarningDays) + suffix);
}

function buildRefillSection(
  ws: WorkspaceCredit,
  status: WorkspaceStatus,
  cfg: WorkspaceLifecycleConfig,
): string {
  const estimateIso = pickRefillEstimateIso(ws);
  if (!estimateIso && status.kind !== KIND_ABOUT_TO_REFILL) return '';
  const rows = [
    activeRefillRow(status),
    estimatedRefillRow(ws, status, estimateIso),
    warningStartRow(estimateIso, cfg.refillWarningThresholdDays),
  ].filter((s) => s.length > 0);
  if (rows.length === 0) return '';
  return sectionHeaderHtml('Refill') + rows.join('');
}


function expiryLabelFor(kind: WorkspaceStatus['kind']): string {
  if (kind === 'expired-canceled') return 'Canceled on';
  if (kind === 'fully-expired') return 'Fully expired since';
  if (kind === 'about-to-expire') return 'Past due since';
  if (kind === 'expired') return 'Expired since';
  return 'Since';
}

function buildExpirySection(ws: WorkspaceCredit, status: WorkspaceStatus): string {
  if (status.kind === 'normal' || status.kind === KIND_ABOUT_TO_REFILL) return '';
  const out: string[] = [sectionHeaderHtml('Expiry')];
  if (status.sinceIso) {
    const date = formatDateDDMMMYY(status.sinceIso);
    const dur = formatDayCount(status.daysSince);
    const color = status.kind === 'about-to-expire' ? '#fde68a' : '#fca5a5';
    out.push(rowHtml(expiryLabelFor(status.kind), date + ' (' + dur + ')', color));
  } else {
    out.push(rowHtml('Status', escHtml(status.label), '#fca5a5'));
  }
  if (ws.billingPeriodEndAt) {
    out.push(rowHtml('Billing period ends', formatDateDDMMMYY(ws.billingPeriodEndAt)));
  }
  return out.join('');
}

function buildMetaSection(ws: WorkspaceCredit): string {
  if (!ws.createdAt && !ws.id) return '';
  const out: string[] = [sectionHeaderHtml('Meta')];
  if (ws.createdAt) out.push(rowHtml('Created', formatDateDDMMMYY(ws.createdAt)));
  if (ws.id) out.push(rowHtml('ID', escHtml(String(ws.id))));
  return out.join('');
}

/**
 * Thresholds section — shows the active lifecycle config values driving the
 * status pill calculation, so users can see at a glance which grace period and
 * refill warning window are currently in effect (including any user override
 * applied via the Settings modal).
 */
function buildThresholdsSection(cfg: WorkspaceLifecycleConfig): string {
  const out: string[] = [sectionHeaderHtml('Thresholds (active)')];
  out.push(rowHtml('Expiry grace', formatDayCount(cfg.expiryGracePeriodDays)));
  out.push(rowHtml('Refill warning', formatDayCount(cfg.refillWarningThresholdDays)));
  return out.join('');
}

/**
 * Status Trace section — debug view explaining how `getEffectiveStatus`
 * arrived at the current status. Shows:
 *   • The inputs consulted (subscription_status, tier, status_changed_at,
 *     daysSinceChange, refill date + daysToRefill, active grace + refill
 *     warning thresholds).
 *   • Each rule in the priority ladder marked ✓ (matched) or ✗ (skipped),
 *     with the skip reason inline.
 *
 * Stays in lockstep with workspace-status.ts via status-explainer.ts.
 */
function traceLineHtml(matched: boolean, rule: string, descOrReason: string): string {
  const icon = matched ? '✓' : '✗';
  const iconColor = matched ? '#34d399' : '#64748b';
  const ruleColor = matched ? '#bbf7d0' : '#94a3b8';
  const textColor = matched ? '#e2e8f0' : '#94a3b8';
  return '<div style="display:flex;gap:6px;padding:1px 0;font-size:10px;line-height:1.4;">'
    + SPAN_COLOR_OPEN + iconColor + ';font-weight:700;flex-shrink:0;">' + icon + '</span>'
    + '<div style="flex:1;min-width:0;">'
    +   SPAN_COLOR_OPEN + ruleColor + ';font-weight:600;">' + escHtml(rule) + '</span>'
    +   SPAN_COLOR_OPEN + textColor + ';"> — ' + escHtml(descOrReason) + '</span>'
    + '</div>'
    + '</div>';
}

function buildStatusTraceSection(explanation: StatusExplanation): string {
  const inp = explanation.inputs;
  const out: string[] = [sectionHeaderHtml('Status trace (debug)')];

  // Inputs snapshot — compact one-liners.
  out.push(rowHtml('subscription_status', escHtml(inp.subscriptionStatus || '—')));
  out.push(rowHtml('tier', escHtml(inp.tier || '—')));
  if (inp.subscriptionStatusChangedAt) {
    out.push(rowHtml('status_changed_at',
      formatDateDDMMMYY(inp.subscriptionStatusChangedAt) + ' (' + formatDayCount(inp.daysSinceChange) + ')'));
  } else {
    out.push(rowHtml('status_changed_at', '—'));
  }
  if (inp.refillIsoUsed) {
    const inDays = inp.daysToRefill >= 0 ? ' (in ' + formatDayCount(inp.daysToRefill) + ')' : ' (past)';
    out.push(rowHtml('refill date',
      formatDateDDMMMYY(inp.refillIsoUsed) + inDays
      + (inp.refillIsoUsed === inp.nextRefillAt ? '' : ' [from billing_period_end]')));
  } else {
    out.push(rowHtml('refill date', '—'));
  }
  out.push(rowHtml('grace / refill window',
    formatDayCount(inp.expiryGracePeriodDays) + ' / ' + formatDayCount(inp.refillWarningThresholdDays)));

  // Rule ladder.
  out.push('<div style="margin:6px 0 0;padding-top:4px;border-top:1px dashed rgba(148,163,184,0.2);">');
  out.push('<div style="font-size:9px;color:#94a3b8;margin-bottom:3px;">Priority ladder (top wins):</div>');
  for (const step of explanation.steps) {
    const text = step.matched ? step.description : (step.skippedReason || 'skipped');
    out.push(traceLineHtml(step.matched, step.rule, text));
  }
  out.push('</div>');

  out.push('<div style="margin-top:6px;font-size:10px;color:#94a3b8;">'
    + 'Result: <b style="color:#7dd3fc;">'
    + escHtml(explanation.status.kind) + '</b>'
    + (explanation.status.label ? ' (' + escHtml(explanation.status.label) + ')' : '')
    + '</div>');

  return out.join('');
}

/* ------------------------------------------------------------------ */
/* Compact zone (spec/22-app-issues/113 — v3.4.3+)                      */
/*                                                                       */
/*  Single ~280px tooltip with 3 zones:                                  */
/*    1. Header — name + plan chip + status pill                         */
/*    2. Priority facts — one-line credits, refill, expires              */
/*    3. <details> Priority rules — collapsed by default                 */
/* ------------------------------------------------------------------ */

const C_SUCCESS = '#34d399';
const C_WARNING = '#fde68a';
const C_DESTRUCTIVE = '#fca5a5';
const C_ACCENT = '#67e8f9';
const C_MUTED = '#94a3b8';

function availableColor(available: number, daily: number): string {
  if (available <= 0) return C_DESTRUCTIVE;
  const denom = daily > 0 ? daily : Math.max(1, available);
  const ratio = available / denom;
  if (ratio < 0.1) return C_DESTRUCTIVE;
  if (ratio < 0.5) return C_WARNING;
  return C_SUCCESS;
}

function dateColor(daysUntilEvent: number, expired = false): string {
  if (expired || daysUntilEvent < 0) return C_DESTRUCTIVE;
  if (daysUntilEvent <= 1) return C_WARNING;
  return C_ACCENT;
}

function planChipHtml(ws: WorkspaceCredit): string {
  const plan = String(ws.planType || ws.tier || 'FREE').toUpperCase();
  return '<span style="font-size:9px;color:' + C_ACCENT
    + ';background:rgba(103,232,249,0.12);border:1px solid rgba(103,232,249,0.35)'
    + ';padding:1px 5px;border-radius:3px;font-weight:700;letter-spacing:0.3px;'
    + 'margin-left:6px;vertical-align:middle;">' + escHtml(plan) + '</span>';
}

function compactRow(label: string, valueHtml: string): string {
  return '<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-size:11px;line-height:1.45;">'
    + SPAN_COLOR_OPEN + C_MUTED + ';">' + escHtml(label) + '</span>'
    + '<span style="color:#e2e8f0;font-weight:600;text-align:right;">' + valueHtml + '</span>'
    + '</div>';
}

function creditsCompactRow(ws: WorkspaceCredit): string {
  const avail = Math.round(ws.available || 0);
  const daily = Math.round(ws.dailyLimit || ws.dailyFree || 0);
  const used = Math.round(ws.totalCreditsUsed || 0);
  const aColor = availableColor(avail, daily);
  const html = SPAN_COLOR_OPEN + aColor + ';font-weight:700;">' + avail + '</span>'
    + SPAN_COLOR_OPEN + C_MUTED + ';font-weight:400;"> avail · </span>'
    + SPAN_COLOR_OPEN + '#e2e8f0;">' + daily + '</span>'
    + SPAN_COLOR_OPEN + C_MUTED + ';font-weight:400;"> daily · </span>'
    + SPAN_COLOR_OPEN + '#e2e8f0;">' + used + '</span>'
    + SPAN_COLOR_OPEN + C_MUTED + ';font-weight:400;"> used</span>';
  return compactRow('Credits', html);
}

function refillCompactRow(ws: WorkspaceCredit, status: WorkspaceStatus): string {
  const iso = status.kind === KIND_ABOUT_TO_REFILL && status.refillIso
    ? status.refillIso
    : pickRefillEstimateIso(ws);
  if (!iso) return '';
  const days = daysUntil(iso);
  const date = formatDateDDMMMYY(iso);
  const rel = days < 0 ? 'overdue' : (days === 0 ? 'today' : 'in ' + formatDayCount(days));
  const color = dateColor(days);
  const html = SPAN_COLOR_OPEN + color + ';font-weight:700;">' + rel + '</span>'
    + SPAN_COLOR_OPEN + C_MUTED + ';font-weight:400;"> (' + escHtml(date) + ')</span>';
  return compactRow('Refill', html);
}

function expiresCompactRow(ws: WorkspaceCredit, status: WorkspaceStatus): string {
  const iso = (ws.billingPeriodEndAt || '').trim();
  const expired = status.kind === 'expired' || status.kind === 'fully-expired' || status.kind === 'expired-canceled';
  if (!iso && !expired) return '';
  if (!iso && status.sinceIso) {
    const days = daysBetween(status.sinceIso);
    const html = SPAN_COLOR_OPEN + C_DESTRUCTIVE + ';font-weight:700;">expired ' + formatDayCount(days) + ' ago</span>'
      + SPAN_COLOR_OPEN + C_MUTED + ';font-weight:400;"> (' + escHtml(formatDateDDMMMYY(status.sinceIso)) + ')</span>';
    return compactRow('Expires', html);
  }
  if (!iso) return '';
  const days = daysUntil(iso);
  const date = formatDateDDMMMYY(iso);
  const rel = days < 0 ? 'expired ' + formatDayCount(-days) + ' ago' : (days === 0 ? 'today' : 'in ' + formatDayCount(days));
  const color = dateColor(days, expired);
  const html = SPAN_COLOR_OPEN + color + ';font-weight:700;">' + rel + '</span>'
    + SPAN_COLOR_OPEN + C_MUTED + ';font-weight:400;"> (' + escHtml(date) + ')</span>';
  return compactRow('Expires', html);
}

function buildPriorityDetailsHtml(
  ws: WorkspaceCredit,
  status: WorkspaceStatus,
  cfg: WorkspaceLifecycleConfig,
  explanation: StatusExplanation,
): string {
  const inner = buildCreditsSection(ws)
    + buildSubscriptionSection(ws)
    + buildRefillSection(ws, status, cfg)
    + buildExpirySection(ws, status)
    + buildMetaSection(ws)
    + buildThresholdsSection(cfg)
    + buildStatusTraceSection(explanation);
  return '<details data-marco-tip-details style="margin-top:8px;border-top:1px solid rgba(148,163,184,0.18);padding-top:6px;">'
    + '<summary style="cursor:pointer;font-size:10px;font-weight:700;color:' + C_ACCENT
    + ';letter-spacing:0.4px;text-transform:uppercase;list-style:none;user-select:none;">▸ Priority rules &amp; details</summary>'
    + '<div style="margin-top:4px;">' + inner + '</div>'
    + '</details>';
}

/** Build the inner HTML of the hover card for the given workspace. */
export function buildWorkspaceHoverHtml(
  ws: WorkspaceCredit,
  status: WorkspaceStatus,
  cfg: WorkspaceLifecycleConfig = getWorkspaceLifecycleConfig(),
): string {
  const explanation = explainEffectiveStatus(ws, cfg);
  const header = '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;'
    + 'font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:6px;line-height:1.3;">'
    + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
    + escHtml(ws.fullName || ws.name) + '</span>'
    + planChipHtml(ws)
    + pillHtml(status)
    + '</div>';
  const priority = creditsCompactRow(ws)
    + refillCompactRow(ws, status)
    + expiresCompactRow(ws, status);
  return header + priority + buildPriorityDetailsHtml(ws, status, cfg, explanation);
}


/* ------------------------------------------------------------------ */
/* DOM mount + positioning                                             */
/* ------------------------------------------------------------------ */

function ensureCardElement(): HTMLDivElement {
  let el = document.getElementById(HOVERCARD_ID) as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = HOVERCARD_ID;
  el.style.cssText = [
    'position:fixed', 'z-index:2147483646', 'pointer-events:auto',
    'min-width:240px', 'max-width:320px', 'padding:8px 10px',
    'background:rgba(15,23,42,0.97)', 'border:1px solid rgba(103,232,249,0.35)',
    'border-radius:6px', 'box-shadow:0 8px 24px rgba(0,0,0,0.5)',
    'color:#e2e8f0', 'font-family:system-ui,-apple-system,sans-serif',
    'line-height:1.4', 'display:none',
  ].join(';') + ';';
  // Hide on leaving the card itself so the <details> toggle can be clicked
  // without dismissing the panel.
  el.addEventListener('mouseleave', hideCard);
  document.body.appendChild(el);
  return el;
}

function positionCard(card: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  // Show below-right of the name span by default; flip up if no room.
  card.style.visibility = 'hidden';
  card.style.display = 'block';
  const cardRect = card.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = r.left;
  let top = r.bottom + 6;
  if (left + cardRect.width > vw - 8) left = Math.max(8, vw - cardRect.width - 8);
  if (top + cardRect.height > vh - 8) top = Math.max(8, r.top - cardRect.height - 6);
  card.style.left = left + 'px';
  card.style.top = top + 'px';
  card.style.visibility = 'visible';
}

function hideCard(): void {
  const el = document.getElementById(HOVERCARD_ID);
  if (el) el.style.display = 'none';
}

/* ------------------------------------------------------------------ */
/* Public attach                                                       */
/* ------------------------------------------------------------------ */

interface WsHoverHandlerStore {
  _wsHoverCardOver?: (e: MouseEvent) => void;
  _wsHoverCardOut?: (e: MouseEvent) => void;
}

/**
 * Attach delegated `mouseover`/`mouseout` listeners to the workspace list
 * container. Triggers only when the cursor enters a `.loop-ws-name` span.
 *
 * Idempotent — re-attaches on every render and tears down prior handlers.
 */
export function attachWorkspaceHoverCard(listEl: HTMLElement, lookup: WsLookup): void {
  const store = listEl as HTMLElement & WsHoverHandlerStore;
  if (store._wsHoverCardOver) {
    listEl.removeEventListener('mouseover', store._wsHoverCardOver);
  }
  if (store._wsHoverCardOut) {
    listEl.removeEventListener('mouseout', store._wsHoverCardOut);
  }

  const overHandler = function (e: MouseEvent): void {
    const cfg = getWorkspaceLifecycleConfig();
    if (!cfg.enableWorkspaceHoverDetails) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const nameEl = target.closest(SEL_WS_NAME) as HTMLElement | null;
    if (!nameEl) return;
    const item = nameEl.closest(SEL_WS_ITEM) as HTMLElement | null;
    if (!item) return;
    const wsId = item.getAttribute('data-ws-id') || '';
    if (!wsId) return;
    const ws = lookup(wsId);
    if (!ws) return;
    const status = getEffectiveStatus(ws, cfg);
    const card = ensureCardElement();
    card.innerHTML = buildWorkspaceHoverHtml(ws, status, cfg);
    positionCard(card, nameEl);
  };

  const outHandler = function (e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (!target.closest(SEL_WS_NAME)) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && related.closest(SEL_WS_NAME)) return;
    // Don't hide if the pointer moved onto the hover card itself —
    // allow user to expand <details>.
    if (related && related.closest('#' + HOVERCARD_ID)) return;
    hideCard();
  };

  store._wsHoverCardOver = overHandler;
  store._wsHoverCardOut = outHandler;
  listEl.addEventListener('mouseover', overHandler);
  listEl.addEventListener('mouseout', outHandler);
}

/** Manual hide — exposed for callers that re-render the list. */
export function hideWorkspaceHoverCard(): void {
  hideCard();
}
