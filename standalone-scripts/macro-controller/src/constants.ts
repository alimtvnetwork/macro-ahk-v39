/**
 * MacroLoop Controller — Centralized Constants (non-enum)
 *
 * Enum-groupable constants have been moved to `types/` as string enums:
 *   DomId, DataAttr, StyleId, StorageKey, ApiPath, PromptCacheKey, Label, CssFragment
 *
 * This file retains: numeric limits, timing values, arrays, one-off strings,
 * and other values that don't form logical enum groups.
 *
 * NOTE: Config-derived constants (IDS, TIMING, CONFIG) remain in shared-state.ts
 * because they are resolved at runtime from __MARCO_CONFIG__.
 *
 * @see types/dom-ids.ts, types/data-attrs.ts, types/style-ids.ts, etc.
 */

/* ------------------------------------------------------------------ */
/*  CSS Selector (not grouped — only one)                              */
/* ------------------------------------------------------------------ */

export const SEL_LOOP_WS_ITEM = '.loop-ws-item';

/* ------------------------------------------------------------------ */
/*  Numeric Limits                                                     */
/* ------------------------------------------------------------------ */

export const LOG_MAX_ENTRIES = 500;
export const WS_HISTORY_MAX_ENTRIES = 50;
export const DB_PROMPTS_CACHE_VERSION = 3;
export const DB_PAGE_SIZE = 25;
export const MAX_ACTIVITY_LINES = 100;

/* ------------------------------------------------------------------ */
/*  Timing Constants                                                   */
/* ------------------------------------------------------------------ */

export const BRIDGE_TIMEOUT_MS = 5000;

// Rename
export const RENAME_DEFAULT_DELAY_MS = 750;
export const RENAME_MIN_DELAY_MS = 100;
export const RENAME_MAX_DELAY_MS = 10000;
export const RENAME_OP_WINDOW = 5;
export const RENAME_HISTORY_MAX = 20;
export const RENAME_MAX_CONSECUTIVE_FAILURES = 3;

// Panel layout
export const PANEL_EDGE_MARGIN = 8;
export const PANEL_MIN_VISIBLE_HEIGHT = 220;
export const PANEL_MIN_VISIBLE_WIDTH = 360;
export const DEFAULT_BACKDROP_OPACITY = 0;

// Auth / token
export const DEFAULT_TOKEN_TTL_MS = 120_000;
export const MIN_CREDIT_CALL_GAP_MS = 10_000;
export const COOKIE_DIAGNOSTIC_COOLDOWN_MS = 60_000;
export const TOKEN_POLL_INTERVAL_MS = 250;
export const TOKEN_REFRESH_RETRY_MS = 1500;

// Workspace lifecycle defaults (spec/22-app-issues/workspace-status-tooltip)
// Overridable via __MARCO_CONFIG__.creditStatus.lifecycle
export const DEFAULT_EXPIRY_GRACE_PERIOD_DAYS = 30;
export const DEFAULT_REFILL_WARNING_THRESHOLD_DAYS = 7;
/** Default TTL for the Projects modal SQLite cache (hours). */
export const DEFAULT_PROJECTS_CACHE_TTL_HOURS = 48;
export const DEFAULT_ENABLE_WORKSPACE_STATUS_LABELS = true;
export const DEFAULT_ENABLE_WORKSPACE_HOVER_DETAILS = true;

// Startup / retry
export const MAX_SDK_ATTEMPTS = 3;
export const SDK_RETRY_DELAY_MS = 500;
export const MAX_UI_CREATE_RETRIES = 10;
export const RETRY_MAX_RETRIES = 3;
export const RETRY_BACKOFF_MS = 2000;
export const STARTUP_WS_MAX_RETRIES = 2;

// Toast
export const TOAST_AUTO_DISMISS_MS = 10_000;
export const TOAST_FADE_DURATION_MS = 300;
export const TOAST_QUEUE_MAX = 20;
export const TOAST_QUEUE_POLL_MS = 250;
export const TOAST_QUEUE_TTL_MS = 30_000;
export const TOAST_MAX_STACK = 3;

// Logging
export const LOG_FLUSH_INTERVAL_MS = 1000;
export const CREDIT_CACHE_TTL_S = 30;
export const RECENT_ERRORS_MAX = 50;

// Overlay / UI
export const MAX_OVERLAY_ERRORS = 30;
export const REINJECT_COOLDOWN_MS = 5000;
export const LOOP_JS_HISTORY_MAX = 20;
export const WORKSPACE_OBSERVER_MAX_RETRIES = 10;

/* ------------------------------------------------------------------ */
/*  Panel Defaults                                                     */
/* ------------------------------------------------------------------ */

export const PANEL_DEFAULT_WIDTH = 494;
export const PANEL_DEFAULT_HEIGHT = 517;

/* ------------------------------------------------------------------ */
/*  Config Validator Schema Versions                                   */
/* ------------------------------------------------------------------ */

export const SUPPORTED_CONFIG_SCHEMA = 1;
export const SUPPORTED_THEME_SCHEMA = 2;

/* ------------------------------------------------------------------ */
/*  Bloated Key Patterns (localStorage cleanup)                        */
/* ------------------------------------------------------------------ */

export const BLOATED_KEY_PATTERNS = ['console-history', 'previously-viewed-files', 'ai-code-completion'];

/* ------------------------------------------------------------------ */
/*  Auth Constants (arrays)                                            */
/* ------------------------------------------------------------------ */

export const SESSION_BRIDGE_KEYS = [
  'marco_bearer_token',
  'lovable-session-id',
  'lovable-session-id-v2',
  'lovable-session-id.id',
  'ahk_bearer_token',
];

export const FALLBACK_SESSION_COOKIE_NAMES = [
  'lovable-session-id-v2',
  'lovable-session-id.id',
  '__Secure-lovable-session-id.id',
  '__Host-lovable-session-id.id',
  'lovable-session-id',
];

/* ------------------------------------------------------------------ */
/*  One-off String Constants                                           */
/* ------------------------------------------------------------------ */

export const FILE_NAME = 'macro-looping.js';
export const MACRO_CONTROLLER_NS = 'macro-controller';
export const SECTION_DIVIDER = '// ============================================\n';
export const DEFAULT_PRESET_NAME = 'Default';
export const DEFAULT_PASTE_XPATH = '/html/body/div[3]/div/div[2]/main/div/div/div[1]/div/div[2]/div/form/div[3]/div/div/div/div';
// Legacy (left-side) chatbox toolbar container — kept as a fallback for older Lovable DOM layouts.
export const SAVE_PROMPT_XPATH = '/html/body/div[3]/div/div[2]/main/div/div/div[1]/div/div[2]/div/form/div[2]/div';
// Preferred (right-side) action row: the row containing Build/mic/send and (when present) the
// "Play and Add more" middle button. Buttons must be prepended here, before button[1].
// Two roots are supported because Lovable mounts at div[2] in some shells and div[3] in others.
export const SAVE_PROMPT_ACTION_ROW_XPATHS: ReadonlyArray<string> = [
  '/html/body/div[3]/div/div[2]/main/div/div/div[1]/div/div[2]/div/form/div[3]/div',
  '/html/body/div[2]/main/div/div[2]/div/div/div/div[1]/div/div[2]/form/div[3]/div',
];
export const DATE_CHANGELOG_2026_03_21 = '2026-03-21';

/* ------------------------------------------------------------------ */
/*  Remix Defaults (v2.217.0)                                          */
/*  Per `mem://architecture/config-defaults-extraction` — no inline    */
/*  default objects in modules; resolved by `getRemixConfig()`.        */
/* ------------------------------------------------------------------ */

export const DEFAULT_REMIX_INCLUDE_HISTORY = false;
export const DEFAULT_REMIX_INCLUDE_CUSTOM_KNOWLEDGE = false;
export const DEFAULT_REMIX_NEXT_SUFFIX_SEPARATOR = '-';
export const DEFAULT_REMIX_NEXT_MAX_COLLISION_INCREMENTS = 50;
export const DEFAULT_REMIX_OPEN_IN_CURRENT_TAB = false;
/** 'preserve' (default) keeps the V/v casing from input; 'upper' forces V; 'lower' forces v. */
export const DEFAULT_REMIX_NEXT_V_CASING: 'preserve' | 'upper' | 'lower' = 'preserve';
