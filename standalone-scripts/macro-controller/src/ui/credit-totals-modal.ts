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
const ATTR_ARIA_LABEL = 'aria-label';

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

/** Tone palette for credit numbers — colourful, dark-theme safe (Step 7). */
export type CreditTone = 'ok' | 'warn' | 'used' | 'total' | 'muted' | 'accent';
const TONE_COLOR: Record<CreditTone, string> = {
  ok: '#86efac',      // green — remaining / healthy
  warn: '#fbbf24',    // amber — alerts
  used: '#fb923c',    // orange — consumption
  total: '#a78bfa',   // purple — totals / grants
  accent: '#67e8f9',  // cyan — plan / meta
  muted: cPanelFgDim,
};
function toneColor(tone: CreditTone | undefined): string {
  if (tone && TONE_COLOR[tone]) return TONE_COLOR[tone];
  return '#e0e0e0';
}

/** Build a single summary card (heading + 3 stat rows). */
export function buildCard(heading: string, rows: ReadonlyArray<{ label: string; value: string; tone?: CreditTone }>): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = 'background:rgba(0,0,0,0.30);border:1px solid rgba(124,58,237,0.30);border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:170px;flex:1;';

  const h = document.createElement('div');
  h.style.cssText = 'font-size:10px;color:' + cPrimaryLighter + ';text-transform:uppercase;letter-spacing:0.6px;font-weight:700;margin-bottom:2px;';
  h.textContent = heading;
  card.appendChild(h);

  for (const r of rows) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12px;';
    const label = document.createElement('span');
    label.style.cssText = 'color:' + cPanelFgDim + ';font-size:11px;';
    label.textContent = r.label;
    const value = document.createElement('span');
    const color = toneColor(r.tone);
    const isNumeric = /^[\d,.\s\/—–-]+$/.test(r.value);
    const size = isNumeric ? '16px' : '12px';
    value.style.cssText = 'color:' + color + ';font-weight:700;font-variant-numeric:tabular-nums;font-size:' + size + ';letter-spacing:0.2px;';
    value.textContent = r.value;
    row.appendChild(label);
    row.appendChild(value);
    card.appendChild(row);
  }
  return card;
}

/** One-time injection of row hover + zebra stripe CSS (Step 8). */
const ZEBRA_STYLE_ID = 'marco-credit-totals-style';
function ensureRowStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(ZEBRA_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = ZEBRA_STYLE_ID;
  s.textContent =
    '[data-credit-totals-row]{transition:background-color 120ms ease,color 120ms ease;}'
    + '[data-credit-totals-row][data-zebra="1"]{background:rgba(124,58,237,0.04);}'
    + '[data-credit-totals-row]:hover{background:rgba(124,58,237,0.18) !important;color:#ffffff;cursor:default;}'
    + '[data-credit-totals-row]:hover [data-cell="name"]{color:#ffffff;}';
  document.head.appendChild(s);
}

/** Sort key + direction for the breakdown table (Step 9). */
export type SortKey = 'name' | 'plan' | 'used' | 'rem' | 'total';
export type SortDir = 'asc' | 'desc' | 'none';
export interface SortState { key: SortKey; dir: SortDir; }

const NUMERIC_KEYS: ReadonlySet<SortKey> = new Set(['used', 'rem', 'total']);

/** Pure: returns a new array sorted by the given state. `none` returns input order. */
export function sortWorkspaces(
  workspaces: ReadonlyArray<WorkspaceCredit>,
  state: SortState,
): ReadonlyArray<WorkspaceCredit> {
  if (state.dir === 'none') return workspaces;
  const mult = state.dir === 'asc' ? 1 : -1;
  const arr = workspaces.slice();
  arr.sort((a, b) => {
    const av = pickSortValue(a, state.key);
    const bv = pickSortValue(b, state.key);
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * mult;
    }
    return String(av).localeCompare(String(bv), 'en', { sensitivity: 'base' }) * mult;
  });
  return arr;
}

function pickSortValue(ws: WorkspaceCredit, key: SortKey): number | string {
  if (key === 'name') return (ws.fullName || ws.name || ws.id || '').toString();
  if (key === 'plan') return (ws.plan || '').toString();
  if (key === 'used') return Number(ws.totalCreditsUsed) || 0;
  if (key === 'rem') return Number(ws.available) || 0;
  return Number(ws.totalCredits) || 0;
}

/** Next sort dir in the cycle: none → desc (numeric) / asc (text) → asc/desc → none. */
export function nextSortDir(key: SortKey, current: SortState): SortState {
  const isNumeric = NUMERIC_KEYS.has(key);
  if (current.key !== key) {
    return { key, dir: isNumeric ? 'desc' : 'asc' };
  }
  if (current.dir === 'none') return { key, dir: isNumeric ? 'desc' : 'asc' };
  if (current.dir === (isNumeric ? 'desc' : 'asc')) return { key, dir: isNumeric ? 'asc' : 'desc' };
  return { key, dir: 'none' };
}

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'name', label: 'Workspace', align: 'left' },
  { key: 'plan', label: 'Plan', align: 'left' },
  { key: 'used', label: 'Used', align: 'right' },
  { key: 'rem', label: 'Rem', align: 'right' },
  { key: 'total', label: 'Total', align: 'right' },
];

/** Pure: move element at `from` to `to`, returning a new array. (Step 10) */
export function reorderArray<T>(arr: ReadonlyArray<T>, from: number, to: number): ReadonlyArray<T> {
  if (from === to) return arr.slice();
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr.slice();
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Active filter predicates for the breakdown table (Step 11). */
export interface FilterState {
  low: boolean;
  empty: boolean;
  free: boolean;
}

/** Pure: apply active chip filters to the workspace list. */
export function applyFilters(
  workspaces: ReadonlyArray<WorkspaceCredit>,
  filters: FilterState,
): ReadonlyArray<WorkspaceCredit> {
  const anyActive = filters.low || filters.empty || filters.free;
  if (!anyActive) return workspaces;
  return workspaces.filter((ws) => {
    const rem = Number(ws.available);
    if (filters.low && rem < 100 && rem > 0) return true;
    if (filters.empty && rem <= 0) return true;
    if (filters.free && ws.hasFree) return true;
    return false;
  });
}

/** Build a single filter chip pill. */
function buildChip(
  label: string,
  active: boolean,
  onToggle: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.setAttribute('data-active', active ? 'true' : 'false');
  const bg = active ? 'rgba(124,58,237,0.35)' : 'transparent';
  const fg = active ? '#ffffff' : cPanelFgDim;
  btn.style.cssText =
    'background:' + bg +
    ';border:1px solid ' + (active ? cPrimaryLighter : 'rgba(124,58,237,0.35)') +
    ';color:' + fg +
    ';padding:2px 8px;border-radius:10px;font-size:10px;cursor:pointer;font-family:monospace;transition:background 120ms,color 120ms;';
  btn.onmouseover = function () { if (!active) btn.style.background = 'rgba(124,58,237,0.15)'; };
  btn.onmouseout = function () { if (!active) btn.style.background = 'transparent'; };
  btn.onclick = function () { onToggle(); };
  return btn;
}

/** Build the filter chips bar above the breakdown table. */
function buildFilterBar(
  filters: FilterState,
  onChange: (next: FilterState) => void,
): HTMLElement {
  const bar = document.createElement('div');
  bar.setAttribute('data-credit-totals-filters', '1');
  bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding:6px 8px;';

  const chipLow = buildChip('⚠ Low', filters.low, function () {
    onChange({ ...filters, low: !filters.low });
  });
  chipLow.setAttribute('data-chip', 'low');

  const chipEmpty = buildChip('🅾 Empty', filters.empty, function () {
    onChange({ ...filters, empty: !filters.empty });
  });
  chipEmpty.setAttribute('data-chip', 'empty');

  const chipFree = buildChip('🆓 Free', filters.free, function () {
    onChange({ ...filters, free: !filters.free });
  });
  chipFree.setAttribute('data-chip', 'free');

  bar.appendChild(chipLow);
  bar.appendChild(chipEmpty);
  bar.appendChild(chipFree);
  return bar;
}

/** Build the per-workspace breakdown table. */
export function buildBreakdownTable(workspaces: ReadonlyArray<WorkspaceCredit>): HTMLElement {
  ensureRowStyles();
  const wrap = document.createElement('div');
  wrap.setAttribute('data-credit-totals-table', '1');
  wrap.style.cssText = 'background:rgba(0,0,0,0.30);border:1px solid rgba(124,58,237,0.30);border-radius:6px;overflow:hidden;';

  let sortState: SortState = { key: 'rem', dir: 'none' };
  // Mutable manual order (Step 10). Drag-drop edits this; sort uses it as input.
  let order: ReadonlyArray<WorkspaceCredit> = workspaces.slice();
  let filters: FilterState = { low: false, empty: false, free: false };

  let filterBar: HTMLElement;
  function handleFilterChange(next: FilterState): void {
    filters = next;
    const newBar = buildFilterBar(filters, handleFilterChange);
    wrap.replaceChild(newBar, filterBar);
    filterBar = newBar;
    renderBody();
  }
  filterBar = buildFilterBar(filters, handleFilterChange);

  const header = document.createElement('div');
  header.setAttribute('data-credit-totals-header', '1');
  header.style.cssText = 'display:grid;grid-template-columns:1.6fr 0.7fr 0.7fr 0.7fr 0.7fr;gap:6px;padding:5px 8px;font-size:9px;color:' + cPrimaryLighter + ';text-transform:uppercase;letter-spacing:0.5px;font-weight:700;background:rgba(124,58,237,0.10);border-bottom:1px solid rgba(124,58,237,0.20);';

  const body = document.createElement('div');
  body.style.cssText = 'max-height:260px;overflow-y:auto;';
  body.setAttribute('data-credit-totals-rows', '1');

  function renderHeader(): void {
    while (header.firstChild) header.removeChild(header.firstChild);
    for (const col of COLUMNS) {
      const cell = document.createElement('span');
      cell.setAttribute('data-sort-key', col.key);
      cell.style.cursor = 'pointer';
      cell.style.userSelect = 'none';
      cell.style.textAlign = col.align;
      const isActive = sortState.key === col.key && sortState.dir !== 'none';
      const arrow = isActive ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
      cell.textContent = col.label + arrow;
      if (isActive) cell.style.color = '#ffffff';
      cell.onclick = function (): void {
        sortState = nextSortDir(col.key, sortState);
        renderHeader();
        renderBody();
      };
      header.appendChild(cell);
    }
  }

  function attachDrag(row: HTMLElement, dispIdx: number): void {
    const isManualOrder = sortState.dir === 'none';
    row.draggable = isManualOrder;
    row.style.cursor = isManualOrder ? 'grab' : 'default';
    row.setAttribute('data-row-index', String(dispIdx));
    if (!isManualOrder) return;

    row.addEventListener('dragstart', (e: DragEvent) => {
      row.style.opacity = '0.4';
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dispIdx));
      }
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      body.querySelectorAll<HTMLElement>('[data-drop-target="1"]').forEach((el) => {
        el.removeAttribute('data-drop-target');
        el.style.borderTop = '';
      });
    });
    row.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      row.setAttribute('data-drop-target', '1');
      row.style.borderTop = '2px solid ' + cPrimaryLighter;
    });
    row.addEventListener('dragleave', () => {
      row.removeAttribute('data-drop-target');
      row.style.borderTop = '';
    });
    row.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      const fromStr = e.dataTransfer?.getData('text/plain') || '';
      const from = Number(fromStr);
      const to = dispIdx;
      if (!Number.isFinite(from) || from === to) return;
      order = reorderArray(order, from, to);
      renderBody();
    });
  }

  function renderBody(): void {
    while (body.firstChild) body.removeChild(body.firstChild);
    if (order.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:14px 10px;text-align:center;color:' + cPanelFgDim + ';font-size:11px;font-style:italic;';
      empty.textContent = 'No workspaces cached. Open the workspace panel to sync.';
      body.appendChild(empty);
      return;
    }
    const filtered = applyFilters(order, filters);
    const sorted = sortWorkspaces(filtered, sortState);
    if (sorted.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:14px 10px;text-align:center;color:' + cPanelFgDim + ';font-size:11px;font-style:italic;';
      empty.textContent = 'No workspaces match the active filters.';
      body.appendChild(empty);
      return;
    }
    sorted.forEach((ws, idx) => {
      const row = buildRow(ws, idx);
      attachDrag(row, idx);
      body.appendChild(row);
    });
  }

  renderHeader();
  renderBody();
  wrap.appendChild(filterBar);
  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

function buildRow(ws: WorkspaceCredit, index: number = 0): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('data-credit-totals-row', '1');
  if (index % 2 === 1) row.setAttribute('data-zebra', '1');
  row.style.cssText = 'display:grid;grid-template-columns:1.6fr 0.7fr 0.7fr 0.7fr 0.7fr;gap:6px;padding:5px 8px;font-size:10px;color:#cbd5e1;border-bottom:1px solid rgba(124,58,237,0.08);font-variant-numeric:tabular-nums;';

  const name = document.createElement('span');
  name.setAttribute('data-cell', 'name');
  name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e2e8f0;font-weight:600;';
  name.title = ws.fullName || ws.name;
  name.textContent = ws.fullName || ws.name || ws.id;

  const plan = document.createElement('span');
  plan.style.cssText = 'color:#67e8f9;font-weight:600;font-size:10px;';
  plan.textContent = ws.plan || '—';

  const usedN = Number(ws.totalCreditsUsed);
  const used = document.createElement('span');
  used.style.cssText = 'text-align:right;color:#fb923c;font-weight:700;font-size:11px;';
  used.textContent = formatCount(usedN);

  const remN = Number(ws.available);
  const rem = document.createElement('span');
  const remColor = remN <= 0 ? cPanelFgDim : remN < 100 ? '#fbbf24' : '#86efac';
  rem.style.cssText = 'text-align:right;color:' + remColor + ';font-weight:700;font-size:11px;';
  rem.textContent = formatCount(remN);

  const total = document.createElement('span');
  total.style.cssText = 'text-align:right;color:#a78bfa;font-weight:700;font-size:11px;';
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
    { label: 'Used', value: formatCount(totals.used), tone: 'used' },
    { label: 'Remaining', value: formatCount(totals.remaining), tone: 'ok' },
    { label: 'Total grant', value: formatCount(totals.granted), tone: 'total' },
  ]));
  cardsRow.appendChild(buildCard('Free Daily Credits', [
    { label: 'Today remaining', value: totals.freeDailyRemaining + ' / ' + totals.freeDailyCap, tone: totals.freeDailyRemaining > 0 ? 'ok' : 'muted' },
    { label: 'Resets at', value: formatMytReset(totals.resetAtMyt), tone: 'accent' },
    { label: 'Workspaces', value: formatCount(totals.totalCount), tone: 'total' },
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
  panel.setAttribute(ATTR_ARIA_LABEL, 'Credit Totals');
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
  closeBtn.setAttribute(ATTR_ARIA_LABEL, 'Close');
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
  refresh.setAttribute(ATTR_ARIA_LABEL, 'Refresh credit snapshot');
  refresh.style.cssText = 'background:transparent;border:1px solid ' + cPrimary + ';color:' + cPrimaryLighter + ';padding:3px 10px;border-radius:4px;font-size:10px;cursor:pointer;';
  refresh.onclick = function (): void { showCreditTotalsModal(); };
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.setAttribute(ATTR_ARIA_LABEL, 'Close dialog');
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
