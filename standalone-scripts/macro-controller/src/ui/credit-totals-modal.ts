/**
 * MacroLoop Controller — Credit Totals Modal (Issue 116, Task 2)
 *
 * Floating popup (chrome derived from `projects-modal.ts`) showing aggregate
 * credit usage across all workspaces currently in `loopCreditState.perWorkspace`.
 *
 * Read-only — does NOT trigger a network refresh on open. A `↻ Refresh`
 * button (wired in Task 3) re-requests credits for the visible workspaces.
 *
 * Standards:
 *   - mem://constraints/no-retry-policy — pure render, no retries.
 *   - mem://preferences/dark-only-theme — dark surfaces only.
 *   - mem://standards/error-logging-via-namespace-logger — logErrors only.
 */

import { cPanelBg, cPrimary, cPrimaryBgA, cPrimaryLighter, cPanelFgDim, loopCreditState } from '../shared-state';
import { aggregateCreditTotals, type CreditTotals } from '../credit-totals';
import type { WorkspaceCredit } from '../types';

const DIALOG_ID = 'marco-credit-totals-modal';

/** Format a number with thousands separators (en-US, no decimals). */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Convert an ISO timestamp into a short MYT clock string ("Tue 00:00 MYT"). */
export function formatMytReset(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const mytDate = new Date(d.getTime() + MYT_OFFSET_MS);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][mytDate.getUTCDay()];
  const hh = String(mytDate.getUTCHours()).padStart(2, '0');
  const mm = String(mytDate.getUTCMinutes()).padStart(2, '0');
  return weekday + ' ' + hh + ':' + mm + ' MYT';
}

/** Build a single summary card (heading + 3 stat rows). */
export function buildCard(heading: string, rows: ReadonlyArray<{ label: string; value: string; tone?: 'ok' | 'warn' | 'muted' }>): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = 'background:rgba(0,0,0,0.30);border:1px solid rgba(124,58,237,0.30);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;min-width:160px;flex:1;';

  const h = document.createElement('div');
  h.style.cssText = 'font-size:9px;color:' + cPrimaryLighter + ';text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:2px;';
  h.textContent = heading;
  card.appendChild(h);

  for (const r of rows) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:11px;';
    const label = document.createElement('span');
    label.style.cssText = 'color:' + cPanelFgDim + ';';
    label.textContent = r.label;
    const value = document.createElement('span');
    const tone = r.tone === 'warn' ? '#fbbf24' : r.tone === 'muted' ? cPanelFgDim : '#e0e0e0';
    value.style.cssText = 'color:' + tone + ';font-weight:600;font-variant-numeric:tabular-nums;';
    value.textContent = r.value;
    row.appendChild(label);
    row.appendChild(value);
    card.appendChild(row);
  }
  return card;
}

/** Build the per-workspace breakdown table. */
export function buildBreakdownTable(workspaces: ReadonlyArray<WorkspaceCredit>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'background:rgba(0,0,0,0.30);border:1px solid rgba(124,58,237,0.30);border-radius:6px;overflow:hidden;';

  const header = document.createElement('div');
  header.style.cssText = 'display:grid;grid-template-columns:1.6fr 0.7fr 0.7fr 0.7fr 0.7fr;gap:6px;padding:5px 8px;font-size:9px;color:' + cPrimaryLighter + ';text-transform:uppercase;letter-spacing:0.5px;font-weight:700;background:rgba(124,58,237,0.10);border-bottom:1px solid rgba(124,58,237,0.20);';
  for (const h of ['Workspace', 'Plan', 'Used', 'Rem', 'Total']) {
    const cell = document.createElement('span');
    cell.textContent = h;
    if (h !== 'Workspace' && h !== 'Plan') cell.style.textAlign = 'right';
    header.appendChild(cell);
  }
  wrap.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = 'max-height:260px;overflow-y:auto;';
  body.setAttribute('data-credit-totals-rows', '1');

  if (workspaces.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:14px 10px;text-align:center;color:' + cPanelFgDim + ';font-size:11px;font-style:italic;';
    empty.textContent = 'No workspaces cached. Open the workspace panel to sync.';
    body.appendChild(empty);
  } else {
    for (const ws of workspaces) {
      body.appendChild(buildRow(ws));
    }
  }
  wrap.appendChild(body);
  return wrap;
}

function buildRow(ws: WorkspaceCredit): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1.6fr 0.7fr 0.7fr 0.7fr 0.7fr;gap:6px;padding:4px 8px;font-size:10px;color:#cbd5e1;border-bottom:1px solid rgba(124,58,237,0.08);font-variant-numeric:tabular-nums;';

  const name = document.createElement('span');
  name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  name.title = ws.fullName || ws.name;
  name.textContent = ws.fullName || ws.name || ws.id;

  const plan = document.createElement('span');
  plan.style.cssText = 'color:' + cPanelFgDim + ';';
  plan.textContent = ws.plan || '—';

  const used = document.createElement('span');
  used.style.cssText = 'text-align:right;';
  used.textContent = formatCount(Number(ws.totalCreditsUsed));

  const rem = document.createElement('span');
  rem.style.cssText = 'text-align:right;color:' + (Number(ws.available) > 0 ? '#86efac' : cPanelFgDim) + ';';
  rem.textContent = formatCount(Number(ws.available));

  const total = document.createElement('span');
  total.style.cssText = 'text-align:right;';
  total.textContent = formatCount(Number(ws.totalCredits));

  row.appendChild(name);
  row.appendChild(plan);
  row.appendChild(used);
  row.appendChild(rem);
  row.appendChild(total);
  return row;
}

/** Build the body (cards + breakdown). Exposed for tests. */
export function buildBody(totals: CreditTotals, workspaces: ReadonlyArray<WorkspaceCredit>): HTMLElement {
  const body = document.createElement('div');
  body.style.cssText = 'padding:10px 12px;display:flex;flex-direction:column;gap:10px;overflow:auto;';
  body.setAttribute('data-credit-totals-body', '1');

  const cardsRow = document.createElement('div');
  cardsRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  cardsRow.appendChild(buildCard('This Billing Cycle', [
    { label: 'Used', value: formatCount(totals.used) },
    { label: 'Remaining', value: formatCount(totals.remaining), tone: 'ok' },
    { label: 'Total grant', value: formatCount(totals.granted), tone: 'muted' },
  ]));
  cardsRow.appendChild(buildCard('Free Daily Credits', [
    { label: 'Today remaining', value: totals.freeDailyRemaining + ' / ' + totals.freeDailyCap, tone: totals.freeDailyRemaining > 0 ? 'ok' : 'muted' },
    { label: 'Resets at', value: formatMytReset(totals.resetAtMyt), tone: 'muted' },
    { label: 'Workspaces', value: formatCount(totals.totalCount), tone: 'muted' },
  ]));
  body.appendChild(cardsRow);

  if (totals.missingCount > 0) {
    const warn = document.createElement('div');
    warn.setAttribute('data-credit-totals-warning', '1');
    warn.style.cssText = 'background:rgba(251,191,36,0.10);border:1px solid rgba(251,191,36,0.35);border-radius:6px;padding:6px 10px;font-size:10px;color:#fbbf24;';
    warn.textContent = '⚠️ ' + totals.missingCount + ' of ' + totals.totalCount + ' workspaces missing credit data — refresh to retry.';
    body.appendChild(warn);
  }

  body.appendChild(buildBreakdownTable(workspaces));
  return body;
}

/** Public: open or replace the Credit Totals modal. */
export function showCreditTotalsModal(): void {
  removeCreditTotalsModal();

  const panel = document.createElement('div');
  panel.id = DIALOG_ID;
  panel.style.cssText =
    'position:fixed;top:80px;right:40px;z-index:100002;background:' + cPanelBg
    + ';border:1px solid ' + cPrimary
    + ';border-radius:8px;padding:0;min-width:460px;max-width:640px;'
    + 'box-shadow:0 8px 32px rgba(0,0,0,.6);font-family:monospace;overflow:hidden;';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Credit Totals');
  panel.tabIndex = -1;

  panel.appendChild(buildTitleBar());

  const workspaces = loopCreditState.perWorkspace || [];
  const totals = aggregateCreditTotals(workspaces);
  panel.appendChild(buildBody(totals, workspaces));
  panel.appendChild(buildFooter(totals));

  document.body.appendChild(panel);
  installA11yHandlers(panel);
  // Focus the panel so ESC works immediately.
  try { panel.focus(); } catch { /* ignore */ }
}

/** ESC-to-close + focus trap. Idempotent; cleaned up by removeCreditTotalsModal. */
function installA11yHandlers(panel: HTMLElement): void {
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      removeCreditTotalsModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button, [href], [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onKey, true);
  // Stash cleanup on the element so removeCreditTotalsModal can run it.
  (panel as HTMLElement & { __marcoCleanup?: () => void }).__marcoCleanup = function (): void {
    document.removeEventListener('keydown', onKey, true);
  };
}

/** Public: remove the modal if present. */
export function removeCreditTotalsModal(): void {
  const existing = document.getElementById(DIALOG_ID);
  if (existing && existing.parentNode) {
    const cleanup = (existing as HTMLElement & { __marcoCleanup?: () => void }).__marcoCleanup;
    if (typeof cleanup === 'function') cleanup();
    existing.parentNode.removeChild(existing);
  }
}

function buildTitleBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:' + cPrimaryBgA
    + ';user-select:none;border-bottom:1px solid rgba(124,58,237,0.3);';
  const title = document.createElement('span');
  title.style.cssText = 'font-size:11px;color:' + cPrimaryLighter + ';font-weight:700;';
  title.textContent = '💰 Credit Totals';
  const closeBtn = document.createElement('span');
  closeBtn.style.cssText = 'cursor:pointer;color:#94a3b8;font-size:14px;padding:0 4px;';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('role', 'button');
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.onclick = function (): void { removeCreditTotalsModal(); };
  bar.appendChild(title);
  bar.appendChild(closeBtn);
  return bar;
}

function buildFooter(totals: CreditTotals): HTMLElement {
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:rgba(0,0,0,0.20);border-top:1px solid rgba(124,58,237,0.20);font-size:10px;color:' + cPanelFgDim + ';';
  const left = document.createElement('span');
  left.textContent = 'Snapshot age: ' + formatSnapshotAge(loopCreditState.lastCheckedAt) + '  ·  ' + totals.totalCount + ' workspace' + (totals.totalCount === 1 ? '' : 's');
  const right = document.createElement('span');
  right.style.cssText = 'display:flex;gap:6px;';
  const refresh = document.createElement('button');
  refresh.textContent = '↻ Refresh';
  refresh.setAttribute('aria-label', 'Refresh credit snapshot');
  refresh.style.cssText = 'background:transparent;border:1px solid ' + cPrimary + ';color:' + cPrimaryLighter + ';padding:3px 10px;border-radius:4px;font-size:10px;cursor:pointer;';
  refresh.onclick = function (): void { showCreditTotalsModal(); };
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close dialog');
  close.style.cssText = 'background:rgba(124,58,237,0.20);border:1px solid ' + cPrimary + ';color:' + cPrimaryLighter + ';padding:3px 10px;border-radius:4px;font-size:10px;cursor:pointer;';
  close.onclick = function (): void { removeCreditTotalsModal(); };
  right.appendChild(refresh);
  right.appendChild(close);
  footer.appendChild(left);
  footer.appendChild(right);
  return footer;
}

export function formatSnapshotAge(lastCheckedAt: number | null): string {
  if (lastCheckedAt === null || !Number.isFinite(lastCheckedAt)) return 'never';
  const ageMs = Date.now() - lastCheckedAt;
  if (ageMs < 0) return 'just now';
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  return hr + 'h ago';
}
