/**
 * Settings Modal — v2.218.0
 *
 * Floating modal that lets the user override two `__MARCO_CONFIG__` keys
 * persisted in chrome.storage.local:
 *   • expiryGracePeriodDays       — days after status_changed_at before
 *                                    Expired escalates to Fully Expired
 *   • refillWarningThresholdDays  — days before refill date to start
 *                                    showing About To Refill
 *
 * Each input shows three values inline:
 *   • Effective (current resolved value, computed live)
 *   • JSON config (read-only; what __MARCO_CONFIG__ supplied)
 *   • Default (named constant from constants.ts)
 *
 * Save / Reset / Cancel — Save persists, Reset clears the override (so the
 * JSON config / default takes over), Cancel discards staged edits.
 */

import { cPanelBg, cPanelFg, cPanelBorder, cPrimary, cPrimaryLight, lDropdownRadius } from './shared-state';
import { getSettingsOverrides, saveSettingsOverrides, clearSettingsOverrides, type SettingsOverrides } from './settings-store';
import { getWorkspaceLifecycleConfig } from './workspace-lifecycle-config';
import { DEFAULT_EXPIRY_GRACE_PERIOD_DAYS, DEFAULT_REFILL_WARNING_THRESHOLD_DAYS, DEFAULT_PROJECTS_CACHE_TTL_HOURS } from './constants';
import { PRO_ZERO_CACHE_TTL_DEFAULT_MIN } from './pro-zero/pro-zero-constants';
import { getProZeroCacheTtlMinutes } from './pro-zero/pro-zero-cache-ttl';
import { showToast } from './toast';
import { logError } from './error-utils';
import { log } from './logging';

const MODAL_ID = 'marco-settings-modal';
const BACKDROP_ID = 'marco-settings-modal-backdrop';
const Z_INDEX = 100003;

interface ModalState {
  submitting: boolean;
  error: string;
  /** Empty string = "use JSON / default". */
  graceInput: string;
  refillInput: string;
  /** pro_0 IndexedDB cache TTL (minutes). Empty string = use default. */
  proZeroTtlInput: string;
}

interface ModalHandlerStore {
  _marcoSettingsKey?: (e: KeyboardEvent) => void;
}

function readJsonConfigValue(key: 'expiryGracePeriodDays' | 'refillWarningThresholdDays'): number | undefined {
  const cfg = (window.__MARCO_CONFIG__ || {}) as Record<string, unknown>;
  const credit = (cfg.creditStatus || {}) as Record<string, unknown>;
  const lifecycle = (credit.lifecycle || {}) as Record<string, unknown>;
  const v = lifecycle[key];
  return typeof v === 'number' ? v : undefined;
}

function buildField(args: {
  label: string; help: string; valueEl: string;
  effective: number; jsonValue: number | undefined; defaultValue: number;
}): string {
  const jsonText = args.jsonValue !== undefined ? String(args.jsonValue) : '— (not set)';
  return ''
    + '<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#cbd5e1;">'
    +   '<span style="font-weight:600;color:#e2e8f0;">' + args.label + '</span>'
    +   '<span style="font-size:10px;color:#94a3b8;line-height:1.4;">' + args.help + '</span>'
    +   args.valueEl
    +   '<div style="display:flex;gap:10px;font-size:10px;color:#94a3b8;flex-wrap:wrap;">'
    +     '<span>Effective: <b style="color:#7dd3fc;">' + args.effective + '</b></span>'
    +     '<span>JSON: <b style="color:#cbd5e1;">' + jsonText + '</b></span>'
    +     '<span>Default: <b style="color:#cbd5e1;">' + args.defaultValue + '</b></span>'
    +   '</div>'
    + '</label>';
}

function inputHtml(elName: string, value: string, disabled: string): string {
  return '<input type="number" min="0" step="1" data-marco-el="' + elName + '" value="' + value + '" '
    + 'placeholder="(use JSON / default)" ' + disabled
    + ' style="background:rgba(0,0,0,0.35);color:#f1f5f9;border:1px solid ' + cPanelBorder + ';'
    + 'border-radius:4px;padding:6px 8px;font-size:12px;font-family:inherit;outline:none;width:100%;box-sizing:border-box;" />';
}

// eslint-disable-next-line max-lines-per-function -- HTML template assembly: header + 2 fields + footer in one declarative pass
function buildHtml(state: ModalState): string {
  const cfg = getWorkspaceLifecycleConfig();
  const submittingDisabled = state.submitting ? 'disabled' : '';

  const errorHtml = state.error
    ? '<div data-marco-el="error" style="margin:6px 0 0 0;padding:6px 8px;background:rgba(220,38,38,0.18);'
      + 'border:1px solid rgba(248,113,113,0.5);border-radius:4px;color:#fca5a5;font-size:11px;'
      + 'word-break:break-word;line-height:1.4;">' + state.error + '</div>'
    : '';

  return ''
    + '<div style="padding:12px 14px;border-bottom:1px solid ' + cPanelBorder + ';display:flex;justify-content:space-between;align-items:center;">'
    +   '<div style="font-size:13px;font-weight:700;color:#f1f5f9;">⚙️ Marco Settings</div>'
    +   '<button type="button" data-marco-action="close" title="Close (Esc)" ' + submittingDisabled
    +     ' style="background:transparent;color:#94a3b8;border:none;font-size:16px;cursor:pointer;line-height:1;padding:0 4px;">✕</button>'
    + '</div>'
    + '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:14px;">'
    +   '<div style="font-size:10px;color:#94a3b8;line-height:1.5;padding:6px 8px;background:rgba(0,122,204,0.10);'
    +     'border-left:2px solid ' + cPrimaryLight + ';border-radius:2px;">'
    +     'Leave a field empty to use the value from your JSON config (or built-in default). '
    +     'Overrides persist in chrome.storage.local across reloads.'
    +   '</div>'
    +   buildField({
          label: 'Expiry Grace Period (days)',
          help: 'Days after subscription_status_changed_at before Expired escalates to Fully Expired.',
          valueEl: inputHtml('grace', state.graceInput, submittingDisabled),
          effective: cfg.expiryGracePeriodDays,
          jsonValue: readJsonConfigValue('expiryGracePeriodDays'),
          defaultValue: DEFAULT_EXPIRY_GRACE_PERIOD_DAYS,
        })
    +   buildField({
          label: 'Refill Warning Threshold (days)',
          help: 'Days before refill date to start showing the About To Refill pill.',
          valueEl: inputHtml('refill', state.refillInput, submittingDisabled),
          effective: cfg.refillWarningThresholdDays,
          jsonValue: readJsonConfigValue('refillWarningThresholdDays'),
          defaultValue: DEFAULT_REFILL_WARNING_THRESHOLD_DAYS,
        })
    +   buildField({
          label: 'Pro_0 Credit-Balance Cache TTL (minutes)',
          help: 'How long to cache /credit-balance results in IndexedDB before refetching for pro_0 plan workspaces.',
          valueEl: inputHtml('proZeroTtl', state.proZeroTtlInput, submittingDisabled),
          effective: getProZeroCacheTtlMinutes(),
          jsonValue: undefined,
          defaultValue: PRO_ZERO_CACHE_TTL_DEFAULT_MIN,
        })
    +   errorHtml
    + '</div>'
    + '<div style="padding:10px 14px;border-top:1px solid ' + cPanelBorder + ';display:flex;justify-content:space-between;gap:8px;background:rgba(0,0,0,0.20);">'
    +   '<button type="button" data-marco-action="reset" title="Clear all overrides" ' + submittingDisabled
    +     ' style="background:rgba(220,38,38,0.20);color:#fca5a5;border:1px solid rgba(248,113,113,0.4);'
    +     'border-radius:4px;padding:5px 12px;font-size:11px;cursor:pointer;">↺ Reset to JSON</button>'
    +   '<div style="display:flex;gap:8px;">'
    +     '<button type="button" data-marco-action="cancel" ' + submittingDisabled
    +       ' style="background:rgba(100,116,139,0.30);color:#e2e8f0;border:1px solid ' + cPanelBorder + ';'
    +       'border-radius:4px;padding:5px 12px;font-size:11px;cursor:pointer;">Cancel</button>'
    +     '<button type="button" data-marco-action="submit" ' + submittingDisabled
    +       ' style="background:' + cPrimary + ';color:#fff;border:1px solid ' + cPrimaryLight + ';'
    +       'border-radius:4px;padding:5px 14px;font-size:11px;font-weight:700;cursor:' + (state.submitting ? 'wait' : 'pointer') + ';">'
    +       (state.submitting ? '⏳ Saving…' : '💾 Save') + '</button>'
    +   '</div>'
    + '</div>';
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
    'min-width:380px', 'max-width:480px',
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
  if (store._marcoSettingsKey) {
    document.removeEventListener('keydown', store._marcoSettingsKey, true);
    delete store._marcoSettingsKey;
  }
}

/** Hide and clean up. Safe to call when not mounted. */
export function hideSettingsModal(): void {
  detachKeyHandler();
  const el = document.getElementById(MODAL_ID);
  const bd = document.getElementById(BACKDROP_ID);
  if (el) el.style.display = 'none';
  if (bd) bd.style.display = 'none';
}

/**
 * Read the input box value into a parsed override entry.
 * Empty string → undefined (use JSON / default). Negative or NaN → throw.
 */
function parseInput(raw: string, label: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(label + ' must be a non-negative number (got "' + raw + '")');
  }
  return Math.floor(n);
}

/** Show the modal. Re-mounts handlers fresh on every call. */
// eslint-disable-next-line max-lines-per-function -- modal lifecycle: render + attach + submit + key handler all need shared state closure
export function showSettingsModal(): void {
  const bd = ensureBackdrop();
  const el = ensureModalEl();
  const current = getSettingsOverrides();
  let state: ModalState = {
    submitting: false,
    error: '',
    graceInput: typeof current.expiryGracePeriodDays === 'number' ? String(current.expiryGracePeriodDays) : '',
    refillInput: typeof current.refillWarningThresholdDays === 'number' ? String(current.refillWarningThresholdDays) : '',
    proZeroTtlInput: typeof current.proZeroCreditBalanceCacheTtlMinutes === 'number'
      ? String(current.proZeroCreditBalanceCacheTtlMinutes) : '',
  };

  function snapshotInputs(): void {
    const g = el.querySelector<HTMLInputElement>('[data-marco-el="grace"]');
    const r = el.querySelector<HTMLInputElement>('[data-marco-el="refill"]');
    const p = el.querySelector<HTMLInputElement>('[data-marco-el="proZeroTtl"]');
    if (g) state.graceInput = g.value;
    if (r) state.refillInput = r.value;
    if (p) state.proZeroTtlInput = p.value;
  }

  function rerender(): void {
    el.innerHTML = buildHtml(state);
    attach();
  }

  function attach(): void {
    el.onclick = function (e: MouseEvent): void {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const action = t.getAttribute('data-marco-action');
      if (!action) return;
      e.stopPropagation();
      if (state.submitting) return;
      if (action === 'close' || action === 'cancel') hideSettingsModal();
      else if (action === 'submit') { snapshotInputs(); void doSubmit(); }
      else if (action === 'reset') void doReset();
    };
    bd.onclick = function (): void { if (!state.submitting) hideSettingsModal(); };
  }

  async function doSubmit(): Promise<void> {
    let next: SettingsOverrides;
    try {
      next = {
        expiryGracePeriodDays: parseInput(state.graceInput, 'Expiry Grace Period'),
        refillWarningThresholdDays: parseInput(state.refillInput, 'Refill Warning Threshold'),
        proZeroCreditBalanceCacheTtlMinutes: parseInput(state.proZeroTtlInput, 'Pro_0 Cache TTL'),
      };
    } catch (err: unknown) {
      state = { ...state, error: err instanceof Error ? err.message : String(err) };
      rerender();
      return;
    }
    state = { ...state, submitting: true, error: '' };
    rerender();
    try {
      await saveSettingsOverrides(next);
      log('[Settings] saved: ' + JSON.stringify(next), 'success');
      showToast('⚙️ Settings saved', 'success');
      hideSettingsModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('SettingsModal', 'save failed: ' + msg);
      state = { ...state, submitting: false, error: msg };
      rerender();
    }
  }

  async function doReset(): Promise<void> {
    state = { ...state, submitting: true, error: '' };
    rerender();
    try {
      await clearSettingsOverrides();
      showToast('↺ Overrides cleared — using JSON config', 'info');
      hideSettingsModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('SettingsModal', 'reset failed: ' + msg);
      state = { ...state, submitting: false, error: msg };
      rerender();
    }
  }

  rerender();
  bd.style.display = 'block';
  el.style.display = 'block';

  detachKeyHandler();
  const onKey = function (e: KeyboardEvent): void {
    if (e.key === 'Escape' && !state.submitting) hideSettingsModal();
  };
  (el as HTMLElement & ModalHandlerStore)._marcoSettingsKey = onKey;
  setTimeout(function () { document.addEventListener('keydown', onKey, true); }, 10);

  setTimeout(function () {
    const gi = el.querySelector<HTMLInputElement>('[data-marco-el="grace"]');
    if (gi) gi.focus();
  }, 30);
}
