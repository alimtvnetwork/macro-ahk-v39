/**
 * Marco Extension — Project Data Types
 *
 * Defines the stored project model used by chrome.storage.local.
 * See spec/02-coding-guidelines/chrome-extension-guidelines/06-project-config-schema.md
 */

/** URL matching rule for project activation. */
export interface UrlRule {
    pattern: string;
    matchType: "glob" | "regex" | "exact" | "prefix";
    excludePattern?: string;
}

/** A script entry within a project. */
export interface ScriptEntry {
    path: string;
    order: number;
    runAt?: "document_start" | "document_idle" | "document_end";
    configBinding?: string;
    description?: string;
    /** Inline code — persisted when script is edited or not matched from library */
    code?: string;
}

/** A config file entry within a project. */
export interface ConfigEntry {
    path: string;
    description?: string;
}

/** A cookie binding for automatic token resolution. */
export interface CookieBinding {
    cookieName: string;
    url: string;
    role: "session" | "refresh" | "custom";
    description?: string;
}

/** Project-level injection settings. */
export interface ProjectSettings {
    isolateScripts?: boolean;
    logLevel?: "debug" | "info" | "warn" | "error";
    retryOnNavigate?: boolean;
    /** Project-specific XPath for the chat input element (overrides global default). */
    chatBoxXPath?: string;
    /** When true, scripts only inject when another project depends on this one. */
    onlyRunAsDependency?: boolean;
    /** When true, this project's scripts can dynamically request scripts from other approved projects. */
    allowDynamicRequests?: boolean;
    /**
     * Auto-attach gate (default false). When true AND every other condition in
     * mem://features/auto-attach-policy.md (C1..C8) is satisfied, library scripts
     * whose UrlMatches cover this project's URL are auto-attached on save.
     * URL match alone is NEVER sufficient — see background/auto-attach.ts.
     */
    autoStart?: boolean;
}

/** Dependency on a shared project. See spec/21-app/02-features/devtools-and-injection/sdk-convention.md */
export interface ProjectDependency {
    projectId: string;
    version: string; // exact, ^major, ~minor
}

/** Stored project record in chrome.storage.local. */
export interface StoredProject {
    id: string;
    schemaVersion: number;
    /** URL-safe hyphen-case identifier, auto-derived from name. See spec 65. */
    slug?: string;
    /** PascalCase identifier for SDK namespace key. See spec 67. */
    codeName?: string;
    name: string;
    version: string;
    description?: string;
    targetUrls: UrlRule[];
    scripts: ScriptEntry[];
    configs?: ConfigEntry[];
    cookies?: CookieBinding[];
    settings?: ProjectSettings;
    dependencies?: ProjectDependency[];
    isGlobal?: boolean;
    isRemovable?: boolean;
    createdAt: string;
    updatedAt: string;
}
