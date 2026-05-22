/**
 * Remix History — v2.249.x
 *
 * In-memory log of remixes performed during the current session. Bounded
 * ring buffer, no persistence (per "no Supabase / no chrome.storage rewrite"
 * constraints — session-only scope is the intentional design).
 *
 * Consumed by the header dropdown "📜 Remix history" item, which renders
 * a small panel listing recent remixes. Entries are recorded by both
 * `actionRemixManual` (via remix-modal) and `actionRemixNext`.
 */

import { cPanelBg, cPanelFg, cPanelBorder, cPrimaryLight, lDropdownRadius } from './shared-state';
import { showToast } from './toast';

const HISTORY_PANEL_ID = 'marco-remix-history-panel';
const MAX_HISTORY_ENTRIES = 50;

export interface RemixHistoryEntry {
  /** Epoch ms when the remix completed (Asia/Kuala_Lumpur formatted at render). */
  timestamp: number;
  source: string;
  destination: string;
  workspaceId: string;
  /** 'manual' = Remix… modal, 'next' = Remix Next auto-resolver. */
  mode: 'manual' | 'next';
}

const entries: RemixHistoryEntry[] = [];

export function recordRemix(entry: RemixHistoryEntry): void {
  entries.unshift(entry);
  if (entries.length > MAX_HISTORY_ENTRIES) {
    entries.length = MAX_HISTORY_ENTRIES;
  }
}

export function getRemixHistory(): readonly RemixHistoryEntry[] {
  return entries;
}

export function clearRemixHistory(): void {
  entries.length = 0;
}

/* ------------------------------------------------------------------ */
/*  Panel UI                                                           */
/* ------------------------------------------------------------------ */

function removeHistoryPanel(): void {
  const old = document.getElementById(HISTORY_PANEL_ID);
  if (old) old.remove();
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, function (ch) {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

function buildEntryRow(e: RemixHistoryEntry): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'padding:6px 10px;border-bottom:1px solid rgba(148,163,184,0.10);'
    + 'font-size:11px;color:' + cPanelFg + ';display:flex;flex-direction:column;gap:1px;';
  const modeIcon = e.mode === 'next' ? '⏭️' : '🔀';
  row.innerHTML =
    '<div style="display:flex;justify-content:space-between;gap:8px;">'
      + '<span style="font-weight:600;">' + modeIcon + ' ' + escapeHtml(e.destination) + '</span>'
      + '<span style="font-size:9px;color:#94a3b8;">' + formatTimestamp(e.timestamp) + '</span>'
    + '</div>'
    + '<div style="font-size:9px;color:#94a3b8;">from "' + escapeHtml(e.source) + '"</div>';
  return row;
}

export function showRemixHistoryPanel(anchorEl: HTMLElement): void {
  removeHistoryPanel();
  const rect = anchorEl.getBoundingClientRect();
  const panel = document.createElement('div');
  panel.id = HISTORY_PANEL_ID;
  panel.style.cssText = [
    'position:fixed',
    'top:' + (rect.bottom + 4) + 'px',
    'left:' + Math.max(8, rect.right - 280) + 'px',
    'z-index:100002',
    'width:280px',
    'max-height:340px',
    'overflow-y:auto',
    'background:' + cPanelBg,
    'color:' + cPanelFg,
    'border:1px solid ' + cPrimaryLight,
    'border-radius:' + lDropdownRadius,
    'box-shadow:0 6px 16px rgba(0,0,0,0.55)',
  ].join(';') + ';';

  // Header.
  const header = document.createElement('div');
  header.style.cssText = 'padding:6px 10px;display:flex;justify-content:space-between;'
    + 'align-items:center;border-bottom:1px solid ' + cPanelBorder + ';font-size:11px;'
    + 'font-weight:600;background:rgba(0,122,204,0.10);';
  header.innerHTML = '<span>📜 Remix history (session)</span>';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear';
  clearBtn.style.cssText = 'background:transparent;border:1px solid ' + cPanelBorder
    + ';color:' + cPanelFg + ';font-size:10px;padding:1px 6px;border-radius:3px;cursor:pointer;';
  clearBtn.onclick = function (e: MouseEvent): void {
    e.stopPropagation();
    clearRemixHistory();
    showToast('🧹 Remix history cleared', 'info');
    removeHistoryPanel();
  };
  header.appendChild(clearBtn);
  panel.appendChild(header);

  // Body.
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:14px 10px;font-size:11px;color:#94a3b8;text-align:center;';
    empty.textContent = 'No remixes recorded this session.';
    panel.appendChild(empty);
  } else {
    for (const e of entries) {
      panel.appendChild(buildEntryRow(e));
    }
    const lastRow = panel.lastElementChild as HTMLElement | null;
    if (lastRow) lastRow.style.borderBottom = 'none';
  }

  document.body.appendChild(panel);
  setTimeout(function () {
    document.addEventListener('click', removeHistoryPanel, { once: true });
  }, 10);
}
