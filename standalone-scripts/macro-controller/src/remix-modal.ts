/**
 * Remix Modal — v2.217.0
 *
 * Manual configuration popup opened by "Remix" dropdown action. Renders:
 *   • ProjectName text input (prefilled with current project name)
 *   • IncludeHistory checkbox (default from RemixConfig)
 *   • IncludeCustomKnowledge checkbox (default from RemixConfig)
 *   • Confirm / Cancel buttons + inline error block
 *
 * Single-mount modal at `#marco-remix-modal`. Re-opening cleans up stale
 * listeners. Esc / outside click / ✕ all dismiss when not submitting.
 */

import { cPanelBg, cPanelFg, cPanelBorder, cPrimary, cPrimaryLight, lDropdownRadius } from './shared-state';
import { getRemixConfig, openRemixRedirect } from './remix-config';
import { submitRemix } from './remix-fetch';
import { recordRemix } from './remix-history';
import { showToast } from './toast';
import { logError } from './error-utils';
import { log } from './logging';

const MODAL_ID = 'marco-remix-modal';
const BACKDROP_ID = 'marco-remix-modal-backdrop';
const Z_INDEX = 100003;

export interface RemixModalOpts {
  projectId: string;
  workspaceId: string;
  currentProjectName: string;
  /** Optional pre-resolved name (used when chained from Remix Next). */
  prefillName?: string;
}

interface ModalState {
  submitting: boolean;
  error: string;
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(opts: RemixModalOpts, state: ModalState): string {
  const cfg = getRemixConfig();
  const initialName = opts.prefillName || opts.currentProjectName;
  const histChecked = cfg.defaultIncludeHistory ? 'checked' : '';
  const knowChecked = cfg.defaultIncludeCustomKnowledge ? 'checked' : '';
  const submittingDisabled = state.submitting ? 'disabled' : '';
  const submitLabel = state.submitting ? '⏳ Remixing…' : '🔀 Remix';

  const errorHtml = state.error
    ? '<div data-marco-el="error" style="margin:6px 0 0 0;padding:6px 8px;background:rgba(220,38,38,0.18);'
      + 'border:1px solid rgba(248,113,113,0.5);border-radius:4px;color:#fca5a5;font-size:11px;'
      + 'word-break:break-word;line-height:1.4;">' + escHtml(state.error) + '</div>'
    : '';

  return ''
    + '<div style="padding:12px 14px;border-bottom:1px solid ' + cPanelBorder + ';display:flex;justify-content:space-between;align-items:center;">'
    +   '<div style="font-size:13px;font-weight:700;color:#f1f5f9;">🔀 Remix Project</div>'
    +   '<button type="button" data-marco-action="close" title="Close (Esc)" ' + submittingDisabled
    +     ' style="background:transparent;color:#94a3b8;border:none;font-size:16px;cursor:pointer;line-height:1;padding:0 4px;">✕</button>'
    + '</div>'
    + '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px;">'
    +   '<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#cbd5e1;">'
    +     '<span style="font-weight:600;color:#e2e8f0;">New Project Name</span>'
    +     '<input type="text" data-marco-el="name" value="' + escHtml(initialName) + '" ' + submittingDisabled
    +       ' style="background:rgba(0,0,0,0.35);color:#f1f5f9;border:1px solid ' + cPanelBorder + ';'
    +       'border-radius:4px;padding:6px 8px;font-size:12px;font-family:inherit;outline:none;" />'
    +   '</label>'
    +   '<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#cbd5e1;cursor:pointer;">'
    +     '<input type="checkbox" data-marco-el="hist" ' + histChecked + ' ' + submittingDisabled
    +       ' style="cursor:pointer;accent-color:' + cPrimary + ';" />'
    +     '<span>Include conversation history</span>'
    +   '</label>'
    +   '<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#cbd5e1;cursor:pointer;">'
    +     '<input type="checkbox" data-marco-el="know" ' + knowChecked + ' ' + submittingDisabled
    +       ' style="cursor:pointer;accent-color:' + cPrimary + ';" />'
    +     '<span>Include custom knowledge</span>'
    +   '</label>'
    +   errorHtml
    + '</div>'
    + '<div style="padding:10px 14px;border-top:1px solid ' + cPanelBorder + ';display:flex;justify-content:flex-end;gap:8px;background:rgba(0,0,0,0.20);">'
    +   '<button type="button" data-marco-action="cancel" ' + submittingDisabled
    +     ' style="background:rgba(100,116,139,0.30);color:#e2e8f0;border:1px solid ' + cPanelBorder + ';'
    +     'border-radius:4px;padding:5px 12px;font-size:11px;cursor:pointer;">Cancel</button>'
    +   '<button type="button" data-marco-action="submit" ' + submittingDisabled
    +     ' style="background:' + cPrimary + ';color:#fff;border:1px solid ' + cPrimaryLight + ';'
    +     'border-radius:4px;padding:5px 14px;font-size:11px;font-weight:700;cursor:' + (state.submitting ? 'wait' : 'pointer') + ';">'
    +     submitLabel + '</button>'
    + '</div>';
}

interface ModalHandlerStore {
  _marcoRemixKey?: (e: KeyboardEvent) => void;
}

function ensureBackdrop(): HTMLDivElement {
  let bd = document.getElementById(BACKDROP_ID) as HTMLDivElement | null;
  if (bd) return bd;
  bd = document.createElement('div');
  bd.id = BACKDROP_ID;
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:' + (Z_INDEX - 1) + ';display:none;';
  document.body.appendChild(bd);
  return bd;
}

function ensureModalEl(): HTMLDivElement {
  let el = document.getElementById(MODAL_ID) as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = MODAL_ID;
  el.style.cssText = [
    'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
    'z-index:' + Z_INDEX,
    'min-width:340px', 'max-width:440px',
    'background:' + cPanelBg, 'color:' + cPanelFg,
    'border:1px solid ' + cPrimaryLight,
    'border-radius:' + lDropdownRadius,
    'box-shadow:0 16px 40px rgba(0,0,0,0.7)',
    'font-family:system-ui,-apple-system,sans-serif',
    'display:none',
  ].join(';') + ';';
  document.body.appendChild(el);
  return el;
}

function detachKeyHandler(): void {
  const el = document.getElementById(MODAL_ID);
  if (!el) return;
  const store = el as HTMLElement & ModalHandlerStore;
  if (store._marcoRemixKey) {
    document.removeEventListener('keydown', store._marcoRemixKey, true);
    delete store._marcoRemixKey;
  }
}

/** Hide and clean up. Safe to call when not mounted. */
export function hideRemixModal(): void {
  detachKeyHandler();
  const el = document.getElementById(MODAL_ID);
  const bd = document.getElementById(BACKDROP_ID);
  if (el) el.style.display = 'none';
  if (bd) bd.style.display = 'none';
}

/** Show the modal. Re-mounts handlers fresh on every call. */
// eslint-disable-next-line max-lines-per-function -- modal lifecycle: render + attach + submit + key handler all need shared state closure
export function showRemixModal(opts: RemixModalOpts): void {
  if (!opts.projectId || !opts.workspaceId) {
    showToast('Remix unavailable — missing project or workspace id', 'warn');
    return;
  }
  const bd = ensureBackdrop();
  const el = ensureModalEl();
  let state: ModalState = { submitting: false, error: '' };

  function rerender(): void {
    el.innerHTML = buildHtml(opts, state);
    attach();
  }

  function attach(): void {
    el.onclick = function (e: MouseEvent): void {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const action = t.getAttribute('data-marco-action');
      if (action === 'close' || action === 'cancel') {
        if (state.submitting) return;
        e.stopPropagation();
        hideRemixModal();
      } else if (action === 'submit') {
        e.stopPropagation();
        void doSubmit();
      }
    };
    bd.onclick = function (): void { if (!state.submitting) hideRemixModal(); };
  }

  async function doSubmit(): Promise<void> {
    const nameInput = el.querySelector<HTMLInputElement>('[data-marco-el="name"]');
    const histInput = el.querySelector<HTMLInputElement>('[data-marco-el="hist"]');
    const knowInput = el.querySelector<HTMLInputElement>('[data-marco-el="know"]');
    if (!nameInput || !histInput || !knowInput) return;
    const projectName = nameInput.value.trim();
    if (!projectName) {
      state = { submitting: false, error: 'Project name cannot be empty.' };
      rerender();
      nameInput.focus();
      return;
    }
    state = { submitting: true, error: '' };
    rerender();
    try {
      const result = await submitRemix({
        projectId: opts.projectId,
        workspaceId: opts.workspaceId,
        projectName,
        includeHistory: histInput.checked,
        includeCustomKnowledge: knowInput.checked,
      });
      log('[Remix] ✅ created "' + projectName + '" id=' + (result.newProjectId || '?'), 'success');
      showToast('🔀 Remixed → "' + projectName + '"', 'success');
      recordRemix({
        timestamp: Date.now(),
        source: opts.currentProjectName,
        destination: projectName,
        workspaceId: opts.workspaceId,
        mode: 'manual',
      });
      hideRemixModal();
      if (result.redirectUrl) {
        openRemixRedirect(result.redirectUrl);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('RemixModal', 'Remix failed for "' + projectName + '": ' + msg);
      state = { submitting: false, error: msg };
      rerender();
    }
  }

  // Mount + show.
  rerender();
  bd.style.display = 'block';
  el.style.display = 'block';

  // Esc handler.
  detachKeyHandler();
  const onKey = function (e: KeyboardEvent): void {
    if (e.key === 'Escape' && !state.submitting) hideRemixModal();
  };
  (el as HTMLElement & ModalHandlerStore)._marcoRemixKey = onKey;
  setTimeout(function () { document.addEventListener('keydown', onKey, true); }, 10);

  // Focus name input for quick edit.
  setTimeout(function () {
    const ni = el.querySelector<HTMLInputElement>('[data-marco-el="name"]');
    if (ni) { ni.focus(); ni.select(); }
  }, 30);
}
