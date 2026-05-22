/**
 * Settings Store — v2.218.0
 *
 * User-editable overrides for selected `__MARCO_CONFIG__` keys, persisted in
 * `chrome.storage.local` so they survive page reloads. The base JSON config
 * remains the source of truth; the override layer is overlaid only when a
 * field is explicitly present (and valid).
 *
 * Currently overridable keys:
 *   - expiryGracePeriodDays            (number ≥ 0)
 *   - refillWarningThresholdDays       (number ≥ 0)
 *
 * Design rules:
 *   - In-memory cache populated on `loadSettingsOverrides()`; subsequent
 *     `getSettingsOverrides()` calls are sync + cheap.
 *   - Subscribers are notified on change so dependent UI can re-render.
 *   - Per `mem://constraints/no-retry-policy` — chrome.storage failures are
 *     surfaced fail-fast, never auto-retried.
 */

import { logError } from './error-utils';
import { log } from './logging';

const STORAGE_KEY = 'marco_settings_overrides_v1';

/** Per-workspace lifecycle override (overrides global override + JSON for one wsId). */
export interface PerWorkspaceLifecycleOverride {
  expiryGracePeriodDays?: number;
  refillWarningThresholdDays?: number;
}

export interface SettingsOverrides {
  expiryGracePeriodDays?: number;
  refillWarningThresholdDays?: number;
  /** pro_0 credit-balance IndexedDB cache TTL (minutes). Spec §9.1 / §11. */
  proZeroCreditBalanceCacheTtlMinutes?: number;
  /** Projects-list SQLite cache TTL (hours). Default 48. */
  projectsCacheTtlHours?: number;
  /** Master switch for the canceled/expired credit override. Default true. */
  enableCanceledCreditOverride?: boolean;
  /** Show inline status labels under each workspace row. */
  enableWorkspaceStatusLabels?: boolean;
  /** Show the rich hover-card with credit details on workspace rows. */
  enableWorkspaceHoverDetails?: boolean;
  /**
   * Per-workspace lifecycle overrides keyed by workspace id (string UUID).
   * Values here override the global `expiryGracePeriodDays` /
   * `refillWarningThresholdDays` for the matching workspace only.
   */
  perWorkspace?: Record<string, PerWorkspaceLifecycleOverride>;
}

type SettingsListener = (overrides: SettingsOverrides) => void;

interface SettingsCache {
  loaded: boolean;
  overrides: SettingsOverrides;
}

const cache: SettingsCache = { loaded: false, overrides: {} };
const listeners = new Set<SettingsListener>();

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function sanitizePerWorkspace(
  raw: unknown,
): Record<string, PerWorkspaceLifecycleOverride> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, PerWorkspaceLifecycleOverride> = {};
  for (const [wsId, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!wsId || typeof wsId !== 'string') continue;
    if (!val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    const entry: PerWorkspaceLifecycleOverride = {};
    if (isFiniteNonNegative(v.expiryGracePeriodDays)) {
      entry.expiryGracePeriodDays = Math.floor(v.expiryGracePeriodDays);
    }
    if (isFiniteNonNegative(v.refillWarningThresholdDays)) {
      entry.refillWarningThresholdDays = Math.floor(v.refillWarningThresholdDays);
    }
    if (entry.expiryGracePeriodDays !== undefined || entry.refillWarningThresholdDays !== undefined) {
      out[wsId] = entry;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitize(raw: unknown): SettingsOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: SettingsOverrides = {};
  if (isFiniteNonNegative(r.expiryGracePeriodDays)) {
    out.expiryGracePeriodDays = Math.floor(r.expiryGracePeriodDays);
  }
  if (isFiniteNonNegative(r.refillWarningThresholdDays)) {
    out.refillWarningThresholdDays = Math.floor(r.refillWarningThresholdDays);
  }
  if (isFiniteNonNegative(r.proZeroCreditBalanceCacheTtlMinutes)) {
    out.proZeroCreditBalanceCacheTtlMinutes = Math.floor(r.proZeroCreditBalanceCacheTtlMinutes);
  }
  if (isFiniteNonNegative(r.projectsCacheTtlHours)) {
    out.projectsCacheTtlHours = Math.floor(r.projectsCacheTtlHours);
  }
  if (typeof r.enableCanceledCreditOverride === 'boolean') {
    out.enableCanceledCreditOverride = r.enableCanceledCreditOverride;
  }
  if (typeof r.enableWorkspaceStatusLabels === 'boolean') {
    out.enableWorkspaceStatusLabels = r.enableWorkspaceStatusLabels;
  }
  if (typeof r.enableWorkspaceHoverDetails === 'boolean') {
    out.enableWorkspaceHoverDetails = r.enableWorkspaceHoverDetails;
  }
  const perWs = sanitizePerWorkspace(r.perWorkspace);
  if (perWs) {
    out.perWorkspace = perWs;
  }
  return out;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined'
    && !!chrome.storage
    && !!chrome.storage.local;
}

/** Load overrides from chrome.storage.local into the in-memory cache. Idempotent. */
export async function loadSettingsOverrides(): Promise<SettingsOverrides> {
  if (!hasChromeStorage()) {
    cache.loaded = true;
    cache.overrides = {};
    return cache.overrides;
  }
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    cache.overrides = sanitize(result[STORAGE_KEY]);
    cache.loaded = true;
    log('[Settings] loaded overrides: ' + JSON.stringify(cache.overrides), 'info');
    return cache.overrides;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('SettingsStore', 'load failed: ' + msg);
    cache.loaded = true;
    cache.overrides = {};
    return cache.overrides;
  }
}

/** Sync read of cached overrides. Returns {} when not yet loaded. */
export function getSettingsOverrides(): SettingsOverrides {
  return cache.overrides;
}

/** Persist new overrides. Pass {} to reset to JSON defaults. */
export async function saveSettingsOverrides(next: SettingsOverrides): Promise<void> {
  const sanitized = sanitize(next);
  if (!hasChromeStorage()) {
    throw new Error('chrome.storage.local unavailable — cannot persist settings');
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: sanitized });
  cache.overrides = sanitized;
  cache.loaded = true;
  log('[Settings] saved overrides: ' + JSON.stringify(sanitized), 'success');
  listeners.forEach(function (fn) {
    try { fn(sanitized); } catch (e: unknown) {
      logError('SettingsStore', 'listener threw: ' + (e instanceof Error ? e.message : String(e)));
    }
  });
}

/** Convenience: clear all overrides (revert to JSON config / defaults). */
export function clearSettingsOverrides(): Promise<void> {
  return saveSettingsOverrides({});
}

/** Subscribe to override changes. Returns an unsubscribe fn. */
export function onSettingsChange(fn: SettingsListener): () => void {
  listeners.add(fn);
  return function () { listeners.delete(fn); };
}
