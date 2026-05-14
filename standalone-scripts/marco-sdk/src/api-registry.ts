/**
 * Riseup Macro SDK — API Registry
 *
 * Config-driven endpoint definitions. Each entry defines URL pattern,
 * method, auth requirement, and optional retry/timeout overrides.
 *
 * URL params use `{paramName}` placeholders, resolved at call time.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface EndpointConfig {
    readonly url: string;
    readonly method: HttpMethod;
    readonly auth: boolean;
    readonly description: string;
    readonly timeoutMs?: number;
    readonly retries?: number;
}

export interface EndpointGroup {
    readonly [endpointName: string]: EndpointConfig;
}

export interface ApiRegistry {
    readonly [groupName: string]: EndpointGroup;
}

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

export const apiRegistry: ApiRegistry = Object.freeze({
    credits: Object.freeze({
        fetchWorkspaces: Object.freeze({
            url: "/user/workspaces",
            method: "GET" as const,
            auth: true,
            description: "Fetch all user workspaces with credit info",
        }),
        fetchBalance: Object.freeze({
            url: "/workspaces/{wsId}/credit-balance",
            method: "GET" as const,
            auth: true,
            description: "Fetch credit balance for a specific workspace",
        }),
        resolve: Object.freeze({
            url: "/workspaces/{wsId}/credit-balance",
            method: "GET" as const,
            auth: true,
            description: "Resolve workspace credit balance with fallback",
        }),
    }),

    workspace: Object.freeze({
        move: Object.freeze({
            url: "/projects/{projectId}/move-to-workspace",
            method: "PUT" as const,
            auth: true,
            description: "Move project to a different workspace",
        }),
        rename: Object.freeze({
            url: "/user/workspaces/{wsId}",
            method: "PUT" as const,
            auth: true,
            description: "Rename a workspace",
        }),
        markViewed: Object.freeze({
            url: "/projects/{projectId}/mark-viewed",
            method: "POST" as const,
            auth: true,
            description: "Mark project as recently viewed (returns workspace_id)",
        }),
        probe: Object.freeze({
            url: "/user/workspaces",
            method: "GET" as const,
            auth: true,
            description: "Probe workspace list for connectivity check",
            timeoutMs: 8_000,
        }),
        resolveByProject: Object.freeze({
            url: "/projects/{projectId}/workspace",
            method: "GET" as const,
            auth: true,
            description: "Resolve workspace for a given project",
        }),
        switchContext: Object.freeze({
            url: "/workspaces/{wsId}/workspace-access-requests",
            method: "GET" as const,
            auth: true,
            description: "Switch active workspace context without moving a project (fallback when no project ID available)",
        }),
    }),

    memberships: Object.freeze({
        /**
         * Search workspace members.
         *
         * Query string defaults: `status=active&limit=20`. Caller may pass
         * `q` and override `limit` via `headers["x-marco-query"]` is NOT
         * supported — instead the caller should append the query string to
         * the workspaceId by using `marco.api.call` with a pre-built path or
         * pass overrides through the `params` map (which uses path-template
         * substitution, not real query params). For the macro-controller use
         * case (top-N members sorted by credit usage) the defaults are fine.
         */
        search: Object.freeze({
            url: "/workspaces/{wsId}/memberships/search?status=active&limit=20",
            method: "GET" as const,
            auth: true,
            description: "Search active members of a workspace (top 20)",
            timeoutMs: 10_000,
        }),
    }),

    projects: Object.freeze({
        /**
         * List projects in a workspace. Used by the remix-name resolver to
         * pre-check name collisions before issuing the remix POST.
         *
         * NOTE: server response shape is `{ projects: [{ id, name, ... }] }`.
         * Caller cares only about `name` (string) for collision detection.
         */
        list: Object.freeze({
            url: "/workspaces/{wsId}/projects?limit=200",
            method: "GET" as const,
            auth: true,
            description: "List up to 200 projects in a workspace (used for remix-name collision check)",
            timeoutMs: 10_000,
        }),
        /**
         * Fetch a single project's metadata (used to read GitHub repo / branch
         * for the Projects-modal CSV export). Tolerates partial responses —
         * caller treats missing `github_repo` / `github_branch` as blank.
         */
        get: Object.freeze({
            url: "/projects/{projectId}",
            method: "GET" as const,
            auth: true,
            description: "Get a project's metadata (id, name, github_repo, github_branch, last_message_at, …)",
            timeoutMs: 10_000,
        }),
    }),

    remix: Object.freeze({
        /**
         * Initialize a remix of an existing project. Body keys are snake_case
         * per upstream API contract (do not change).
         */
        init: Object.freeze({
            url: "/projects/{projectId}/remix/init",
            method: "POST" as const,
            auth: true,
            description: "Initialize a project remix into the target workspace",
            timeoutMs: 30_000,
        }),
    }),
});

/* ------------------------------------------------------------------ */
/*  URL resolver                                                       */
/* ------------------------------------------------------------------ */

export function resolveUrl(
    urlTemplate: string,
    params?: Record<string, string>,
): string {
    if (!params) {
        return urlTemplate;
    }

    let resolved = urlTemplate;

    for (const key of Object.keys(params)) {
        resolved = resolved.replace(`{${key}}`, encodeURIComponent(params[key]));
    }

    return resolved;
}
