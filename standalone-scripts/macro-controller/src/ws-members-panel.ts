/**
 * Workspace Members Panel — v2.216.0
 *
 * Floating panel that lists active members of a workspace, opened from the
 * right-click context menu on a workspace row. Single shared mount point
 * (`#marco-ws-members-panel`) — calling `showWsMembersPanel` re-uses the
 * existing element, repositions it, and re-renders the body.
 *
 * Lifecycle:
 *   showWsMembersPanel(wsId, wsName, x, y)
 *     → render loading → fetch → render success / error
 *     → click outside / Esc → hide
 *
 * Renders all 8 fields per member, with a header showing the workspace name +
 * total member count and a refresh button. Sorted by `total_credits_used`
 * descending (handled in `ws-members-fetch.ts`).
 */

import { cPanelBg, cPanelFg, cPanelBorder, cPrimary, cPrimaryLight, lDropdownRadius } from './shared-state';
import { fetchWorkspaceMembers, clearMembersCache, DEFAULT_MEMBERS_PAGE_LIMIT, MEMBERS_PAGE_LIMIT_STEPS, type WorkspaceMember } from './ws-members-fetch';
import { logError } from './error-utils';
import { formatDateDDMMMYY } from './workspace-status';
import { inviteMember, removeMember, updateMemberRole } from './ws-members-mutations';
import { showToast } from './toast';
import { onCreditPollTick } from './credit-poll-events';

const PANEL_ID = 'marco-ws-members-panel';
const Z_INDEX = 100002;
const CSS_BG = 'background:';

/** Copy text via Clipboard API with legacy textarea fallback; toast on result. */
function copyToClipboard(value: string, label: string): void {
  if (!value) {
    showToast('⚠️ Nothing to copy', 'info');
    return;
  }
  const preview = value.length > 40 ? value.slice(0, 37) + '…' : value;
  const onOk = function (): void { showToast('📋 ' + label + ' copied: ' + preview, 'success'); };
  const onFail = function (msg: string): void { showToast('❌ Copy failed: ' + msg, 'error'); };
  const nav = navigator as Navigator & { clipboard?: { writeText: (s: string) => Promise<void> } };
  if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    nav.clipboard.writeText(value).then(onOk).catch(function (err: unknown) {
      onFail(err instanceof Error ? err.message : String(err));
    });
    return;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) onOk(); else onFail('execCommand returned false');
  } catch (err: unknown) {
    onFail(err instanceof Error ? err.message : String(err));
  }
}

/** Escape a single CSV field per RFC 4180 (quote if needed, double inner quotes). */
function csvField(value: string | number): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Slugify a workspace name for use in a download filename. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workspace';
}

/** Build a CSV blob for the loaded members and trigger a browser download. */
function exportMembersCsv(wsName: string, members: WorkspaceMember[]): void {
  if (!members.length) {
    showToast('⚠️ No members to export', 'info');
    return;
  }
  const headers = [
    'rank', 'display_name', 'username', 'email', 'role',
    'total_credits_used', 'total_credits_used_in_billing_period',
    'joined_at', 'invited_at', 'user_id',
  ];
  const lines = [headers.join(',')];
  members.forEach(function (m, i) {
    lines.push([
      i + 1,
      csvField(m.display_name),
      csvField(m.username),
      csvField(m.email),
      csvField(m.role),
      m.total_credits_used,
      m.total_credits_used_in_billing_period,
      csvField(m.joined_at),
      csvField(m.invited_at),
      csvField(m.user_id),
    ].join(','));
  });
  // BOM so Excel opens UTF-8 cleanly.
  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = 'members-' + slugify(wsName) + '-' + stamp + '.csv';
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('📄 Exported ' + members.length + ' members → ' + filename, 'success');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('❌ CSV export failed: ' + msg, 'error');
  }
}

/* ------------------------------------------------------------------ */
/*  HTML helpers                                                       */
/* ------------------------------------------------------------------ */

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  // Show up to 2 decimals only when fractional part is non-trivial.
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1);
}

function roleBadge(role: string): string {
  const norm = role.toLowerCase();
  let color = '#94a3b8';
  let bg = 'rgba(148,163,184,0.15)';
  if (norm === 'admin' || norm === 'owner') {
    color = '#fde68a';
    bg = 'rgba(180,83,9,0.35)';
  } else if (norm === 'editor' || norm === 'developer') {
    color = '#bae6fd';
    bg = 'rgba(2,132,199,0.30)';
  } else if (norm === 'viewer') {
    color = '#cbd5e1';
    bg = 'rgba(71,85,105,0.30)';
  }
  return '<span style="font-size:9px;color:' + color
    + ';background:' + bg
    + ';padding:1px 5px;border-radius:3px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;">'
    + escHtml(role || 'member') + '</span>';
}

// v3.4.3 (task 12) — Initials avatar from display name / email
function initialsFor(m: WorkspaceMember): string {
  const src = (m.display_name || m.username || m.email || m.user_id || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// v3.4.3 (task 12) — Deterministic avatar color from user_id hash
function avatarBgFor(m: WorkspaceMember): string {
  const key = m.user_id || m.email || m.username || '';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return 'hsl(' + hue + ',45%,32%)';
}

function avatarHtml(m: WorkspaceMember): string {
  return '<span aria-hidden="true" style="flex-shrink:0;width:22px;height:22px;border-radius:50%;'
    + CSS_BG + avatarBgFor(m) + ';color:#f1f5f9;font-size:10px;font-weight:700;'
    + 'display:inline-flex;align-items:center;justify-content:center;letter-spacing:0.3px;">'
    + escHtml(initialsFor(m)) + '</span>';
}

// v3.4.3 (task 12) — ⋯ action menu trigger. Tasks 13/14 wire promote/remove handlers.
function actionMenuHtml(m: WorkspaceMember): string {
  return '<button type="button" data-marco-action="member-menu" '
    + 'data-marco-user-id="' + escHtml(m.user_id) + '" '
    + 'data-marco-user-role="' + escHtml(m.role || 'member') + '" '
    + 'data-marco-user-label="' + escHtml(m.display_name || m.email || m.user_id) + '" '
    + 'title="Member actions" '
    + 'style="flex-shrink:0;background:transparent;color:#94a3b8;border:1px solid transparent;'
    + 'border-radius:3px;padding:0 6px;height:20px;font-size:14px;line-height:1;cursor:pointer;">⋯</button>';
}

function shareBarHtml(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const label = clamped >= 10 ? clamped.toFixed(0) + '%' : clamped.toFixed(1) + '%';
  // Color ramp: low=slate, mid=cyan, high=emerald, dominant=amber
  let fill = '#475569';
  if (clamped >= 40) fill = '#f59e0b';
  else if (clamped >= 20) fill = '#10b981';
  else if (clamped >= 5) fill = '#0ea5e9';
  return '<div title="Share of loaded members\u2019 total credits: ' + label + '" '
    + 'style="display:flex;align-items:center;gap:6px;padding-left:42px;margin-top:2px;">'
    +   '<div style="flex:1;height:4px;background:rgba(148,163,184,0.15);border-radius:2px;overflow:hidden;">'
    +     '<div style="height:100%;width:' + clamped.toFixed(2) + '%;background:' + fill + ';transition:width 200ms ease-out;"></div>'
    +   '</div>'
    +   '<span style="font-size:9px;color:#94a3b8;font-variant-numeric:tabular-nums;min-width:32px;text-align:right;">' + label + '</span>'
    + '</div>';
}

function memberRowHtml(m: WorkspaceMember, idx: number, sumLoaded: number): string {
  const displayName = m.display_name || m.username || m.email || m.user_id;
  const credits = fmtNumber(m.total_credits_used);
  const billingCredits = fmtNumber(m.total_credits_used_in_billing_period);
  const joined = m.joined_at ? formatDateDDMMMYY(m.joined_at) : '—';
  const invited = m.invited_at ? formatDateDDMMMYY(m.invited_at) : '—';
  const sharePct = sumLoaded > 0 ? (m.total_credits_used / sumLoaded) * 100 : 0;

  return '<div data-marco-member-row data-marco-user-id="' + escHtml(m.user_id) + '" '
    + 'style="display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-bottom:1px solid rgba(148,163,184,0.12);font-size:11px;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
    +   '<div style="display:flex;align-items:center;gap:6px;min-width:0;">'
    +     '<span style="color:#64748b;font-size:10px;width:14px;text-align:right;flex-shrink:0;">' + (idx + 1) + '.</span>'
    +     avatarHtml(m)
    +     '<span style="color:#f1f5f9;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(displayName) + '</span>'
    +     roleBadge(m.role)
    +   '</div>'
    +   '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">'
    +     '<span style="color:#34d399;font-weight:700;font-variant-numeric:tabular-nums;" title="Total credits used (all time)">' + credits + ' cr</span>'
    +     actionMenuHtml(m)
    +   '</div>'
    + '</div>'
    + '<div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#94a3b8;padding-left:42px;">'
    +   (m.email
          ? '<span data-marco-action="copy" data-marco-copy-value="' + escHtml(m.email) + '" data-marco-copy-label="Email" '
            + 'style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" '
            + 'title="Click to copy email: ' + escHtml(m.email) + '">' + escHtml(m.email) + '</span>'
          : '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">—</span>')
    +   '<span title="Credits used this billing period">Period: ' + billingCredits + '</span>'
    + '</div>'
    + shareBarHtml(sharePct)
    + '<div style="display:flex;justify-content:space-between;gap:8px;font-size:9px;color:#64748b;padding-left:42px;">'
    +   '<span data-marco-action="copy" data-marco-copy-value="' + escHtml(m.user_id) + '" data-marco-copy-label="User ID" '
    +     'style="cursor:pointer;" '
    +     'title="Click to copy user_id: ' + escHtml(m.user_id) + '">@' + escHtml(m.username || '—') + '</span>'
    +   '<span>Joined ' + escHtml(joined) + ' · Invited ' + escHtml(invited) + '</span>'
    + '</div>'
    + '</div>';
}

function buildBodyHtml(state: PanelState): string {
  if (state.kind === 'loading') {
    return '<div style="padding:14px;text-align:center;color:#94a3b8;font-size:11px;">⏳ Loading members…</div>';
  }
  if (state.kind === 'error') {
    return '<div style="padding:12px;color:#fca5a5;font-size:11px;line-height:1.4;">'
      + '<div style="font-weight:700;margin-bottom:4px;">❌ Failed to load members</div>'
      + '<div style="color:#cbd5e1;font-family:monospace;font-size:10px;word-break:break-word;">' + escHtml(state.error) + '</div>'
      + '</div>';
  }
  if (state.members.length === 0) {
    return '<div style="padding:14px;text-align:center;color:#94a3b8;font-size:11px;">No active members.</div>';
  }
  const sumLoaded = state.members.reduce(function (acc, m) {
    return acc + (Number.isFinite(m.total_credits_used) ? m.total_credits_used : 0);
  }, 0);
  const rows = state.members.map(function (m, i) { return memberRowHtml(m, i, sumLoaded); }).join('');
  return '<div style="max-height:380px;overflow-y:auto;">' + rows + loadMoreRowHtml(state) + '</div>';
}

function loadMoreRowHtml(state: PanelStateSuccess): string {
  const nextLimit = nextPageLimit(state.limit);
  if (nextLimit === null) return '';
  if (state.members.length >= state.total) return '';
  const label = 'Load more (top ' + nextLimit + ' of ' + state.total + ')';
  return '<button type="button" data-marco-action="load-more" '
    + 'style="display:block;width:calc(100% - 16px);margin:8px;padding:6px 10px;'
    + 'background:rgba(0,122,204,0.18);color:#bae6fd;border:1px dashed ' + cPrimary + ';'
    + 'border-radius:3px;font-size:11px;cursor:pointer;line-height:1.2;">'
    + escHtml(label)
    + '</button>';
}

function nextPageLimit(current: number): number | null {
  for (const step of MEMBERS_PAGE_LIMIT_STEPS) {
    if (step > current) return step;
  }
  return null;
}

function headerHtml(wsName: string, state: PanelState): string {
  let countText = '';
  if (state.kind === 'success') {
    countText = state.members.length === state.total
      ? state.members.length + ' member' + (state.members.length === 1 ? '' : 's')
      : 'top ' + state.members.length + ' of ' + state.total;
  } else if (state.kind === 'loading') {
    countText = '…';
  } else {
    countText = 'error';
  }
  // v3.4.3 (task 11) — Rename-style popup chrome: compact header "Members — <ws>" + ×
  return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid ' + cPanelBorder + ';background:rgba(0,0,0,0.25);">'
    + '<div style="min-width:0;">'
    +   '<div style="font-size:12px;font-weight:700;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Members — ' + escHtml(wsName) + '</div>'
    +   '<div style="font-size:9px;color:#94a3b8;letter-spacing:0.3px;text-transform:uppercase;">' + countText + ' · sorted by credits used</div>'
    + '</div>'
    + '<div style="display:flex;gap:4px;flex-shrink:0;">'
    +   '<button type="button" data-marco-action="refresh" title="Refresh"'
    +     ' style="background:rgba(0,122,204,0.25);color:#bae6fd;border:1px solid ' + cPrimary + ';border-radius:3px;padding:2px 6px;font-size:11px;cursor:pointer;line-height:1;">↻</button>'
    +   '<button type="button" data-marco-action="export-csv" title="Export loaded members as CSV"'
    +     ' style="background:rgba(16,185,129,0.22);color:#bbf7d0;border:1px solid #10b981;border-radius:3px;padding:2px 6px;font-size:11px;cursor:pointer;line-height:1;">⬇ CSV</button>'
    +   '<button type="button" data-marco-action="close" title="Close (Esc)"'
    +     ' style="background:rgba(100,116,139,0.35);color:#e2e8f0;border:1px solid ' + cPanelBorder + ';border-radius:3px;padding:2px 7px;font-size:11px;cursor:pointer;line-height:1;">×</button>'
    + '</div>'
    + '</div>';
}

// v3.4.3 (task 13) — Footer renders either the collapsed +Add button or the invite form.
function footerCollapsedHtml(): string {
  return '<button type="button" data-marco-action="add-member-toggle" '
    + 'style="width:100%;background:rgba(0,122,204,0.18);color:#bae6fd;border:1px dashed ' + cPrimary + ';'
    + 'border-radius:3px;padding:4px 6px;font-size:11px;cursor:pointer;line-height:1.2;">'
    + '+ Add member'
    + '</button>';
}

function footerFormHtml(): string {
  return '<form data-marco-action="add-member-submit" '
    + 'style="display:flex;flex-direction:column;gap:6px;">'
    +   '<div style="display:flex;gap:4px;">'
    +     '<input type="email" required name="email" placeholder="user@example.com" '
    +       'data-marco-field="invite-email" '
    +       'style="flex:1;min-width:0;padding:3px 6px;border:1px solid ' + cPrimaryLight + ';'
    +       'border-radius:3px;background:' + cPanelBg + ';color:' + cPanelFg + ';font-size:11px;outline:none;">'
    +     '<select name="role" data-marco-field="invite-role" '
    +       'style="padding:3px 4px;border:1px solid ' + cPrimaryLight + ';border-radius:3px;'
    +       CSS_BG + cPanelBg + ';color:' + cPanelFg + ';font-size:11px;">'
    +       '<option value="member">Member</option>'
    +       '<option value="owner">Owner</option>'
    +     '</select>'
    +   '</div>'
    +   '<div style="display:flex;gap:4px;justify-content:flex-end;">'
    +     '<button type="button" data-marco-action="add-member-cancel" '
    +       'style="background:rgba(100,116,139,0.35);color:#e2e8f0;border:1px solid ' + cPanelBorder + ';'
    +       'border-radius:3px;padding:3px 8px;font-size:11px;cursor:pointer;">Cancel</button>'
    +     '<button type="submit" data-marco-field="invite-submit" '
    +       'style="background:rgba(0,122,204,0.4);color:#e0f2fe;border:1px solid ' + cPrimary + ';'
    +       'border-radius:3px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;">Send invite</button>'
    +   '</div>'
    + '</form>';
}

function footerHtml(expanded = false): string {
  return '<div data-marco-section="members-footer" '
    + 'style="padding:6px 10px;border-top:1px solid ' + cPanelBorder + ';background:rgba(0,0,0,0.2);">'
    + (expanded ? footerFormHtml() : footerCollapsedHtml())
    + '</div>';
}

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

interface PanelStateLoading { kind: 'loading'; }
interface PanelStateError { kind: 'error'; error: string; }
interface PanelStateSuccess { kind: 'success'; members: WorkspaceMember[]; total: number; limit: number; }
type PanelState = PanelStateLoading | PanelStateError | PanelStateSuccess;

/* ------------------------------------------------------------------ */
/*  DOM lifecycle                                                      */
/* ------------------------------------------------------------------ */

interface PanelHandlerStore {
  _marcoMembersOutsideClick?: (e: MouseEvent) => void;
  _marcoMembersKey?: (e: KeyboardEvent) => void;
  _marcoMembersSubmit?: (e: Event) => void;
  _marcoMembersLatest?: { wsName: string; members: WorkspaceMember[]; total: number; limit: number };
  _marcoMembersLimit?: number;
  _marcoMembersPollUnsub?: () => void;
  _marcoMembersAutoBusy?: boolean;
}

function ensurePanelEl(): HTMLDivElement {
  let el = document.getElementById(PANEL_ID) as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = PANEL_ID;
  el.style.cssText = [
    'position:fixed', 'z-index:' + Z_INDEX,
    'min-width:300px', 'max-width:420px',
    CSS_BG + cPanelBg, 'color:' + cPanelFg,
    'border:1px solid ' + cPrimaryLight,
    'border-radius:' + lDropdownRadius,
    'box-shadow:0 12px 32px rgba(0,0,0,0.6)',
    'font-family:system-ui,-apple-system,sans-serif', 'font-size:11px',
    'display:none',
    // v3.4.3 (task 11) — Rename-style open animation: fade + slide-down
    'opacity:0', 'transform:translateY(-4px)',
    'transition:opacity 120ms ease-out, transform 120ms ease-out',
  ].join(';') + ';';
  document.body.appendChild(el);
  return el;
}

function positionPanel(el: HTMLElement, x: number, y: number): void {
  el.style.visibility = 'hidden';
  el.style.display = 'block';
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x;
  let top = y;
  if (left + r.width > vw - 8) left = Math.max(8, vw - r.width - 8);
  if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.visibility = 'visible';
  // v3.4.3 (task 11) — play open animation on next frame
  requestAnimationFrame(function () {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });
}

function render(el: HTMLElement, wsName: string, state: PanelState): void {
  // v3.4.3 (task 11) — 3-section chrome: header + body + footer (Rename-style)
  el.innerHTML = headerHtml(wsName, state) + buildBodyHtml(state) + footerHtml();
}

function findFooter(el: HTMLElement): HTMLElement | null {
  return el.querySelector('[data-marco-section="members-footer"]') as HTMLElement | null;
}

function swapFooter(el: HTMLElement, expanded: boolean): void {
  const footer = findFooter(el);
  if (!footer) return;
  footer.innerHTML = expanded ? footerFormHtml() : footerCollapsedHtml();
  if (expanded) {
    const emailInput = footer.querySelector('[data-marco-field="invite-email"]') as HTMLInputElement | null;
    if (emailInput) emailInput.focus();
  }
}

// v3.4.3 (task 14) — Member action menu (Promote / Demote / Remove) anchored to ⋯
const MEMBER_MENU_ID = 'marco-ws-member-menu';

function closeMemberActionMenu(): void {
  const existing = document.getElementById(MEMBER_MENU_ID);
  if (existing) existing.remove();
}

function buildMenuItem(label: string, color: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText =
    'display:block;width:100%;text-align:left;padding:5px 10px;background:transparent;color:' + color +
    ';border:none;font-size:11px;cursor:pointer;line-height:1.3;';
  btn.onmouseenter = function () { btn.style.background = 'rgba(148,163,184,0.15)'; };
  btn.onmouseleave = function () { btn.style.background = 'transparent'; };
  btn.onclick = function (e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    closeMemberActionMenu();
    onClick();
  };
  return btn;
}

function performRemove(panelEl: HTMLElement, wsId: string, wsName: string, userId: string, label: string): void {
  if (!window.confirm('Remove "' + label + '" from this workspace?')) return;
  const row = panelEl.querySelector('[data-marco-member-row][data-marco-user-id="' + cssEscape(userId) + '"]') as HTMLElement | null;
  const prevOpacity = row ? row.style.opacity : '';
  if (row) {
    row.style.opacity = '0.4';
    row.style.pointerEvents = 'none';
  }
  removeMember(wsId, userId)
    .then(function () {
      showToast('🗑️ Removed ' + label, 'success');
      loadAndRender(panelEl, wsId, wsName);
    })
    .catch(function (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('❌ Remove failed: ' + msg, 'error');
      if (row) {
        row.style.opacity = prevOpacity;
        row.style.pointerEvents = '';
      }
    });
}

function performPromoteDemote(panelEl: HTMLElement, wsId: string, wsName: string, userId: string, label: string, nextRole: 'member' | 'owner'): void {
  const verb = nextRole === 'owner' ? 'Promote to Owner' : 'Demote to Member';
  if (!window.confirm(verb + ': "' + label + '"?')) return;
  updateMemberRole(wsId, userId, nextRole)
    .then(function () {
      showToast('👑 ' + label + ' → ' + nextRole, 'success');
      loadAndRender(panelEl, wsId, wsName);
    })
    .catch(function (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('❌ Role change failed: ' + msg, 'error');
    });
}

// CSS.escape polyfill (Safari/older WebView).
function cssEscape(value: string): string {
  const css = (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
  if (css && typeof css.escape === 'function') return css.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, function (ch) { return '\\' + ch; });
}

function openMemberActionMenu(
  panelEl: HTMLElement,
  anchor: HTMLElement,
  wsId: string,
  wsName: string,
  userId: string,
  role: string,
  label: string,
): void {
  closeMemberActionMenu();
  if (!userId) return;
  const menu = document.createElement('div');
  menu.id = MEMBER_MENU_ID;
  const rect = anchor.getBoundingClientRect();
  menu.style.cssText = [
    'position:fixed', 'z-index:' + (Z_INDEX + 1),
    'min-width:160px',
    CSS_BG + cPanelBg, 'color:' + cPanelFg,
    'border:1px solid ' + cPrimary,
    'border-radius:' + lDropdownRadius,
    'box-shadow:0 8px 20px rgba(0,0,0,0.55)',
    'padding:4px 0', 'font-size:11px',
    'top:' + (rect.bottom + 4) + 'px',
    'left:' + Math.max(8, rect.right - 160) + 'px',
  ].join(';') + ';';

  if (role === 'owner') {
    menu.appendChild(buildMenuItem('↓ Demote to Member', '#fde68a', function () {
      performPromoteDemote(panelEl, wsId, wsName, userId, label, 'member');
    }));
  } else {
    menu.appendChild(buildMenuItem('↑ Promote to Owner', '#fde68a', function () {
      performPromoteDemote(panelEl, wsId, wsName, userId, label, 'owner');
    }));
  }
  menu.appendChild(buildMenuItem('🗑️ Remove member', '#fca5a5', function () {
    performRemove(panelEl, wsId, wsName, userId, label);
  }));

  document.body.appendChild(menu);

  // Dismiss on outside click / Esc.
  setTimeout(function () {
    const outside = function (e: MouseEvent): void {
      const t = e.target as Node | null;
      if (t && menu.contains(t)) return;
      closeMemberActionMenu();
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
    const key = function (e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      closeMemberActionMenu();
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', key, true);
  }, 10);
}



// v3.4.3 (task 13) — Submit invite + optimistic insert. Reverts on failure.
function submitInvite(el: HTMLElement, wsId: string, wsName: string, form: HTMLFormElement): void {
  const emailInput = form.querySelector('[data-marco-field="invite-email"]') as HTMLInputElement | null;
  const roleSelect = form.querySelector('[data-marco-field="invite-role"]') as HTMLSelectElement | null;
  const submitBtn = form.querySelector('[data-marco-field="invite-submit"]') as HTMLButtonElement | null;
  const email = (emailInput?.value || '').trim();
  const roleRaw = (roleSelect?.value || 'member').toLowerCase();
  const role: 'member' | 'owner' = roleRaw === 'owner' ? 'owner' : 'member';
  if (!email) {
    if (emailInput) emailInput.focus();
    return;
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
  }

  // Optimistic placeholder row inserted at the top of the list.
  const body = el.querySelector('div[style*="max-height:380px"]') as HTMLElement | null;
  const optimisticId = 'optimistic-' + Date.now();
  let optimisticEl: HTMLElement | null = null;
  if (body) {
    optimisticEl = document.createElement('div');
    optimisticEl.setAttribute('data-marco-optimistic', optimisticId);
    optimisticEl.style.cssText = 'padding:6px 8px;border-bottom:1px solid rgba(148,163,184,0.12);font-size:11px;color:#bae6fd;opacity:0.75;';
    optimisticEl.textContent = '⏳ Inviting ' + email + ' (' + role + ')…';
    body.insertBefore(optimisticEl, body.firstChild);
  }

  inviteMember(wsId, email, role)
    .then(function () {
      showToast('✉️ Invited ' + email, 'success');
      swapFooter(el, false);
      // Refetch authoritative list — drops optimistic row.
      loadAndRender(el, wsId, wsName);
    })
    .catch(function (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('❌ Invite failed: ' + msg, 'error');
      if (optimisticEl && optimisticEl.parentNode) optimisticEl.parentNode.removeChild(optimisticEl);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send invite';
      }
    });
}

// eslint-disable-next-line max-lines-per-function
function attachActionHandlers(el: HTMLElement, wsId: string, wsName: string): void {
  el.onclick = function (e: MouseEvent): void {
    const target = (e.target as HTMLElement | null)?.closest('[data-marco-action]') as HTMLElement | null;
    if (!target) return;
    const action = target.getAttribute('data-marco-action');
    if (action === 'close') {
      e.stopPropagation();
      hideWsMembersPanel();
    } else if (action === 'refresh') {
      e.stopPropagation();
      clearMembersCache(wsId);
      loadAndRender(el, wsId, wsName);
    } else if (action === 'load-more') {
      e.stopPropagation();
      const store = el as HTMLElement & PanelHandlerStore;
      const current = store._marcoMembersLimit ?? DEFAULT_MEMBERS_PAGE_LIMIT;
      const next = nextPageLimit(current);
      if (next === null) return;
      store._marcoMembersLimit = next;
      loadAndRender(el, wsId, wsName);
    } else if (action === 'export-csv') {
      e.stopPropagation();
      const store = el as HTMLElement & PanelHandlerStore;
      const latest = store._marcoMembersLatest;
      if (!latest || latest.members.length === 0) {
        showToast('⏳ Members not loaded yet', 'info');
        return;
      }
      exportMembersCsv(latest.wsName, latest.members);
    } else if (action === 'add-member-toggle') {
      e.stopPropagation();
      swapFooter(el, true);
    } else if (action === 'add-member-cancel') {
      e.stopPropagation();
      swapFooter(el, false);
    } else if (action === 'member-menu') {
      e.stopPropagation();
      const userId = target.getAttribute('data-marco-user-id') || '';
      const role = (target.getAttribute('data-marco-user-role') || 'member').toLowerCase();
      const label = target.getAttribute('data-marco-user-label') || userId;
      openMemberActionMenu(el, target, wsId, wsName, userId, role, label);
    } else if (action === 'copy') {
      e.stopPropagation();
      const value = target.getAttribute('data-marco-copy-value') || '';
      const lbl = target.getAttribute('data-marco-copy-label') || 'Value';
      copyToClipboard(value, lbl);
    }
  };

  // v3.4.3 (task 13) — Form submit hook (Enter or click on Send invite).
  // Dedupe: remove any previously attached listener before re-binding to the
  // current (wsId, wsName) pair so reopening the panel for a different
  // workspace does not stack invite handlers.
  const store = el as HTMLElement & PanelHandlerStore;
  if (store._marcoMembersSubmit) {
    el.removeEventListener('submit', store._marcoMembersSubmit);
  }
  const submitHandler = function (e: Event): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.getAttribute('data-marco-action') !== 'add-member-submit') return;
    e.preventDefault();
    e.stopPropagation();
    submitInvite(el, wsId, wsName, target as HTMLFormElement);
  };
  store._marcoMembersSubmit = submitHandler;
  el.addEventListener('submit', submitHandler);
}

function attachDismissHandlers(el: HTMLElement): void {
  const store = el as HTMLElement & PanelHandlerStore;
  if (store._marcoMembersOutsideClick) {
    document.removeEventListener('mousedown', store._marcoMembersOutsideClick, true);
  }
  if (store._marcoMembersKey) {
    document.removeEventListener('keydown', store._marcoMembersKey, true);
  }

  const outside = function (e: MouseEvent): void {
    const t = e.target as Node | null;
    if (!t) return;
    if (el.contains(t)) return;
    hideWsMembersPanel();
  };
  const key = function (e: KeyboardEvent): void {
    if (e.key === 'Escape') hideWsMembersPanel();
  };

  store._marcoMembersOutsideClick = outside;
  store._marcoMembersKey = key;
  // Defer attach by a tick so the opening right-click doesn't immediately dismiss.
  setTimeout(function () {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', key, true);
  }, 10);
}

function detachDismissHandlers(): void {
  const el = document.getElementById(PANEL_ID);
  if (!el) return;
  const store = el as HTMLElement & PanelHandlerStore;
  if (store._marcoMembersOutsideClick) {
    document.removeEventListener('mousedown', store._marcoMembersOutsideClick, true);
    delete store._marcoMembersOutsideClick;
  }
  if (store._marcoMembersKey) {
    document.removeEventListener('keydown', store._marcoMembersKey, true);
    delete store._marcoMembersKey;
  }
}

/* ------------------------------------------------------------------ */
/*  Async load                                                         */
/* ------------------------------------------------------------------ */

function loadAndRender(el: HTMLElement, wsId: string, wsName: string): void {
  const store = el as HTMLElement & PanelHandlerStore;
  const limit = store._marcoMembersLimit ?? DEFAULT_MEMBERS_PAGE_LIMIT;
  render(el, wsName, { kind: 'loading' });
  fetchWorkspaceMembers(wsId, false, limit)
    .then(function (entry) {
      if (!document.getElementById(PANEL_ID)) return; // panel was closed
      store._marcoMembersLatest = { wsName: wsName, members: entry.members, total: entry.total, limit: limit };
      render(el, wsName, { kind: 'success', members: entry.members, total: entry.total, limit: limit });
    })
    .catch(function (err: unknown) {
      if (!document.getElementById(PANEL_ID)) return;
      const msg = err instanceof Error ? err.message : String(err);
      logError('WsMembersPanel', 'Members fetch failed for ' + wsId + ': ' + msg);
      render(el, wsName, { kind: 'error', error: msg });
    });
}

/** Silent refetch — used by the credit-poll subscription. Skips loading state. */
function silentRefresh(el: HTMLElement, wsId: string, wsName: string): void {
  const store = el as HTMLElement & PanelHandlerStore;
  if (store._marcoMembersAutoBusy) return;
  if (el.style.display === 'none') return;
  const limit = store._marcoMembersLimit ?? DEFAULT_MEMBERS_PAGE_LIMIT;
  store._marcoMembersAutoBusy = true;
  clearMembersCache(wsId);
  fetchWorkspaceMembers(wsId, true, limit)
    .then(function (entry) {
      if (!document.getElementById(PANEL_ID)) return;
      store._marcoMembersLatest = { wsName: wsName, members: entry.members, total: entry.total, limit: limit };
      render(el, wsName, { kind: 'success', members: entry.members, total: entry.total, limit: limit });
    })
    .catch(function (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('WsMembersPanel', 'Auto-refresh failed for ' + wsId + ': ' + msg);
    })
    .finally(function () { store._marcoMembersAutoBusy = false; });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** Open the members panel for a workspace at the given screen coords. */
export function showWsMembersPanel(wsId: string, wsName: string, x: number, y: number): void {
  if (!wsId) return;
  const el = ensurePanelEl();
  // Reset attach state + page-size before re-rendering for a different workspace.
  detachDismissHandlers();
  const store = el as HTMLElement & PanelHandlerStore;
  store._marcoMembersLimit = DEFAULT_MEMBERS_PAGE_LIMIT;
  // Drop any prior credit-poll subscription before resubscribing for this ws.
  if (store._marcoMembersPollUnsub) {
    store._marcoMembersPollUnsub();
    store._marcoMembersPollUnsub = undefined;
  }
  attachActionHandlers(el, wsId, wsName);
  loadAndRender(el, wsId, wsName);
  // Subscribe to credit-poll ticks so the panel stays in sync while open.
  store._marcoMembersPollUnsub = onCreditPollTick(function () {
    silentRefresh(el, wsId, wsName);
  });
  // First render to measure, then position.
  positionPanel(el, x, y);
  attachDismissHandlers(el);
}

/** Hide and detach listeners. Safe to call when panel is not mounted. */
export function hideWsMembersPanel(): void {
  detachDismissHandlers();
  closeMemberActionMenu(); // v3.4.3 (task 14) — drop any open action menu
  const el = document.getElementById(PANEL_ID);
  if (el) {
    const store = el as HTMLElement & PanelHandlerStore;
    if (store._marcoMembersPollUnsub) {
      store._marcoMembersPollUnsub();
      store._marcoMembersPollUnsub = undefined;
    }
    // v3.4.3 (task 11) — reset animation state so next open re-plays the slide
    el.style.display = 'none';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-4px)';
  }
}
