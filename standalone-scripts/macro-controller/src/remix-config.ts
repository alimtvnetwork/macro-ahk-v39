/**
 * Remix Config Resolver — v2.217.0
 *
 * Reads `__MARCO_CONFIG__.remix` and merges with named-constant defaults.
 * Per `mem://architecture/config-defaults-extraction` — no inline defaults
 * inside feature modules.
 *
 * Config keys (all optional):
 *   remix.defaultIncludeHistory          (boolean)
 *   remix.defaultIncludeCustomKnowledge  (boolean)
 *   remix.nextSuffixSeparator            (string, e.g. '-' or '')
 *   remix.maxCollisionIncrements         (number, safety cap)
 *   remix.openInCurrentTab               (boolean) — when true, redirect navigates current tab
 */

import {
  DEFAULT_REMIX_INCLUDE_HISTORY,
  DEFAULT_REMIX_INCLUDE_CUSTOM_KNOWLEDGE,
  DEFAULT_REMIX_NEXT_SUFFIX_SEPARATOR,
  DEFAULT_REMIX_NEXT_MAX_COLLISION_INCREMENTS,
  DEFAULT_REMIX_OPEN_IN_CURRENT_TAB,
  DEFAULT_REMIX_NEXT_V_CASING,
} from './constants';

export type RemixVCasing = 'preserve' | 'upper' | 'lower';

export interface RemixConfig {
  defaultIncludeHistory: boolean;
  defaultIncludeCustomKnowledge: boolean;
  nextSuffixSeparator: string;
  maxCollisionIncrements: number;
  openInCurrentTab: boolean;
  nextVCasing: RemixVCasing;
}

interface RemixConfigInput {
  defaultIncludeHistory?: boolean;
  defaultIncludeCustomKnowledge?: boolean;
  nextSuffixSeparator?: string;
  maxCollisionIncrements?: number;
  openInCurrentTab?: boolean;
  nextVCasing?: RemixVCasing;
}

function readRaw(): Partial<RemixConfigInput> {
  const cfg = (window.__MARCO_CONFIG__ || {}) as Record<string, unknown>;
  const remix = cfg.remix as Partial<RemixConfigInput> | undefined;
  return remix || {};
}

function isVCasing(v: RemixVCasing | undefined): v is RemixVCasing {
  return v === 'preserve' || v === 'upper' || v === 'lower';
}

/** Resolved remix config with named-constant defaults applied. */
export function getRemixConfig(): RemixConfig {
  const raw = readRaw();
  return {
    defaultIncludeHistory: typeof raw.defaultIncludeHistory === 'boolean'
      ? raw.defaultIncludeHistory
      : DEFAULT_REMIX_INCLUDE_HISTORY,
    defaultIncludeCustomKnowledge: typeof raw.defaultIncludeCustomKnowledge === 'boolean'
      ? raw.defaultIncludeCustomKnowledge
      : DEFAULT_REMIX_INCLUDE_CUSTOM_KNOWLEDGE,
    nextSuffixSeparator: typeof raw.nextSuffixSeparator === 'string'
      ? raw.nextSuffixSeparator
      : DEFAULT_REMIX_NEXT_SUFFIX_SEPARATOR,
    maxCollisionIncrements: typeof raw.maxCollisionIncrements === 'number' && raw.maxCollisionIncrements > 0
      ? Math.floor(raw.maxCollisionIncrements)
      : DEFAULT_REMIX_NEXT_MAX_COLLISION_INCREMENTS,
    openInCurrentTab: typeof raw.openInCurrentTab === 'boolean'
      ? raw.openInCurrentTab
      : DEFAULT_REMIX_OPEN_IN_CURRENT_TAB,
    nextVCasing: isVCasing(raw.nextVCasing)
      ? raw.nextVCasing
      : DEFAULT_REMIX_NEXT_V_CASING,
  };
}

/**
 * Navigate to a remix redirect URL honoring the `openInCurrentTab` toggle.
 * - true  → replaces current tab (window.location.href)
 * - false → opens a new tab (window.open with noopener)
 */
export function openRemixRedirect(redirectUrl: string): void {
  const cfg = getRemixConfig();
  if (cfg.openInCurrentTab) {
    window.location.href = redirectUrl;
    return;
  }
  window.open(redirectUrl, '_blank', 'noopener');
}
