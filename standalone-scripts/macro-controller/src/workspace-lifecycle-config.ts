/**
 * Workspace Lifecycle Config Resolver
 *
 * Reads __MARCO_CONFIG__.creditStatus.lifecycle and merges with named-constant defaults.
 * Per memory: architecture/config-defaults-extraction — no inline default objects.
 *
 * Spec: spec/22-app-issues/workspace-status-tooltip/01-overview.md (Phase 1)
 */

import {
  DEFAULT_EXPIRY_GRACE_PERIOD_DAYS,
  DEFAULT_REFILL_WARNING_THRESHOLD_DAYS,
  DEFAULT_ENABLE_WORKSPACE_STATUS_LABELS,
  DEFAULT_ENABLE_WORKSPACE_HOVER_DETAILS,
} from './constants';
import type { WorkspaceLifecycleConfigInput } from './types/config-types';
import { getSettingsOverrides } from './settings-store';

/** Resolved (non-optional) lifecycle config used by status helpers and renderers. */
export interface WorkspaceLifecycleConfig {
  expiryGracePeriodDays: number;
  refillWarningThresholdDays: number;
  enableWorkspaceStatusLabels: boolean;
  enableWorkspaceHoverDetails: boolean;
}

function readRawLifecycleConfig(): Partial<WorkspaceLifecycleConfigInput> {
  const cfg = (window.__MARCO_CONFIG__ || {}) as Record<string, unknown>;
  const creditStatus = (cfg.creditStatus || {}) as Record<string, unknown>;
  return (creditStatus.lifecycle || {}) as Partial<WorkspaceLifecycleConfigInput>;
}

/**
 * Returns the resolved lifecycle config with defaults applied.
 * Override priority (highest → lowest):
 *   1. chrome.storage.local override (settings-store) — user-edited via Settings modal
 *   2. window.__MARCO_CONFIG__.creditStatus.lifecycle — JSON-provided
 *   3. DEFAULT_* named constants
 *
 * Safe to call repeatedly — cheap, no side effects.
 */
export function getWorkspaceLifecycleConfig(): WorkspaceLifecycleConfig {
  return getWorkspaceLifecycleConfigFor(undefined);
}

/**
 * Per-workspace resolver. When `wsId` is provided and a matching entry exists
 * in `overrides.perWorkspace`, its `expiryGracePeriodDays` /
 * `refillWarningThresholdDays` win over the global override.
 *
 * Override priority (highest → lowest):
 *   1. settings-store `perWorkspace[wsId]` (when wsId provided)
 *   2. settings-store global override
 *   3. window.__MARCO_CONFIG__.creditStatus.lifecycle
 *   4. DEFAULT_* named constants
 */
export function getWorkspaceLifecycleConfigFor(wsId: string | undefined): WorkspaceLifecycleConfig {
  const raw = readRawLifecycleConfig();
  const overrides = getSettingsOverrides();
  const perWs = wsId && overrides.perWorkspace ? overrides.perWorkspace[wsId] : undefined;

  const grace = typeof perWs?.expiryGracePeriodDays === 'number'
    ? perWs.expiryGracePeriodDays
    : (typeof overrides.expiryGracePeriodDays === 'number'
      ? overrides.expiryGracePeriodDays
      : (typeof raw.expiryGracePeriodDays === 'number' && raw.expiryGracePeriodDays >= 0
        ? raw.expiryGracePeriodDays
        : DEFAULT_EXPIRY_GRACE_PERIOD_DAYS));

  const refill = typeof perWs?.refillWarningThresholdDays === 'number'
    ? perWs.refillWarningThresholdDays
    : (typeof overrides.refillWarningThresholdDays === 'number'
      ? overrides.refillWarningThresholdDays
      : (typeof raw.refillWarningThresholdDays === 'number' && raw.refillWarningThresholdDays >= 0
        ? raw.refillWarningThresholdDays
        : DEFAULT_REFILL_WARNING_THRESHOLD_DAYS));

  const rawLabels = raw.enableWorkspaceStatusLabels !== false
    ? (raw.enableWorkspaceStatusLabels !== undefined ? raw.enableWorkspaceStatusLabels : DEFAULT_ENABLE_WORKSPACE_STATUS_LABELS)
    : false;
  const rawHover = raw.enableWorkspaceHoverDetails !== false
    ? (raw.enableWorkspaceHoverDetails !== undefined ? raw.enableWorkspaceHoverDetails : DEFAULT_ENABLE_WORKSPACE_HOVER_DETAILS)
    : false;

  return {
    expiryGracePeriodDays: grace,
    refillWarningThresholdDays: refill,
    enableWorkspaceStatusLabels: typeof overrides.enableWorkspaceStatusLabels === 'boolean'
      ? overrides.enableWorkspaceStatusLabels
      : rawLabels,
    enableWorkspaceHoverDetails: typeof overrides.enableWorkspaceHoverDetails === 'boolean'
      ? overrides.enableWorkspaceHoverDetails
      : rawHover,
  };
}
