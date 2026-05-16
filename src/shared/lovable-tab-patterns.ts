/**
 * Shared chrome.tabs.query() match patterns for Lovable platform tabs.
 *
 * Previously duplicated by convention in 4 files (auth-health-handler,
 * cookie-watcher, config-auth-handler, open-tabs-handler). Consolidated here
 * per plan.md "Open Lovable Tabs → Workspace Mapping" follow-up #4.
 *
 * Order is significant: bare hostname first, then wildcard subdomain — Chrome
 * evaluates them as a union, but keeping the order stable makes log diffs
 * deterministic across modules.
 *
 * To add a new platform host, update this array; the four callers will inherit.
 */
export const LOVABLE_TAB_PATTERNS: readonly string[] = [
    "https://lovable.dev/*",
    "https://*.lovable.dev/*",
    "https://lovable.app/*",
    "https://*.lovable.app/*",
] as const;
