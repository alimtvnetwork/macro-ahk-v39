/**
 * Marco Extension — Shared Constants
 *
 * Storage keys, limits, and default values.
 * See spec 12-project-model-and-url-rules.md §Storage.
 */

export const EXTENSION_VERSION = "3.9.0";

/* ------------------------------------------------------------------ */
/*  Storage Keys                                                       */
/* ------------------------------------------------------------------ */

export const STORAGE_KEY_ACTIVE_PROJECT = "marco_active_project";
export const STORAGE_KEY_ALL_PROJECTS = "marco_projects";
export const STORAGE_KEY_ALL_SCRIPTS = "marco_scripts";
export const STORAGE_KEY_ALL_CONFIGS = "marco_configs";
export const STORAGE_KEY_CONFIG_OVERRIDES = "marco_config_overrides";
export const STORAGE_KEY_STATE = "marco_state";
export const STORAGE_KEY_FIRST_RUN = "marco_first_run";
export const STORAGE_KEY_LEGACY_PRUNED = "marco_legacy_pruned";
export const STORAGE_KEY_LAST_BUILD_ID = "marco_last_build_id";
/** Per-project record of the latest auto-attach evaluation decisions. */
export const STORAGE_KEY_AUTO_ATTACH_DECISIONS = "marco_auto_attach_decisions";

/* ------------------------------------------------------------------ */
/*  Limits                                                             */
/* ------------------------------------------------------------------ */

export const MAX_SCRIPT_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_CONFIG_SIZE_BYTES = 1 * 1024 * 1024;
export const MAX_REGEX_LENGTH = 500;
export const LOG_PAGE_SIZE = 50;
export const KEEPALIVE_INTERVAL_MINUTES = 0.483;

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_TIMEOUT_MS = 5000;
export const MAX_RETRY_COUNT = 3;
export const DEFAULT_PROJECT_ID = "default-lovable";
export const DEFAULT_GLOBAL_VAR_NAME = "__marcoConfig";
export const SDK_PROJECT_ID = "marco-sdk";
