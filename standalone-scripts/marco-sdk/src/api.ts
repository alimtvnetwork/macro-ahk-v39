/**
 * Riseup Macro SDK — API Module
 *
 * Auto-generated typed methods from the API registry.
 * Provides `marco.api.<group>.<method>(params?, body?)` calls.
 *
 * Config-driven registry underneath; typed wrappers on top.
 */

import { httpClient } from "./http";
import { apiRegistry, resolveUrl } from "./api-registry";
import type { EndpointConfig } from "./api-registry";
import type { AxiosRequestConfig, AxiosResponse } from "axios";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ApiCallOptions {
    params?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
    baseUrl?: string;
    timeoutMs?: number;
}

export interface ApiResponse<T = unknown> {
    readonly ok: boolean;
    readonly status: number;
    readonly data: T;
    readonly headers: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  Generic caller                                                     */
/* ------------------------------------------------------------------ */

async function callEndpoint<T = unknown>(
    endpoint: EndpointConfig,
    options?: ApiCallOptions,
): Promise<ApiResponse<T>> {
    const baseUrl = options?.baseUrl ?? "";
    const url = baseUrl + resolveUrl(endpoint.url, options?.params);

    const axiosConfig: AxiosRequestConfig = {
        method: endpoint.method,
        url,
        timeout: options?.timeoutMs ?? endpoint.timeoutMs,
        headers: options?.headers,
        validateStatus: () => true, // Never throw on HTTP status — caller decides
    };

    if (options?.body !== undefined) {
        axiosConfig.data = options.body;
    }

    if (!endpoint.auth) {
        (axiosConfig as unknown as Record<string, unknown>).__skipAuth = true;
    }

    const response: AxiosResponse<T> = await httpClient.request<T>(axiosConfig);

    const responseHeaders: Record<string, string> = {};
    for (const key of Object.keys(response.headers)) {
        const val = response.headers[key];
        if (typeof val === "string") {
            responseHeaders[key] = val;
        }
    }

    return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        data: response.data,
        headers: responseHeaders,
    };
}

/* ------------------------------------------------------------------ */
/*  Generic call-by-path (config-driven)                               */
/* ------------------------------------------------------------------ */

function call<T = unknown>(
    path: string,
    options?: ApiCallOptions,
): Promise<ApiResponse<T>> {
    const parts = path.split(".");

    if (parts.length !== 2) {
        return Promise.reject(new Error(`[marco.api] Invalid path "${path}" — expected "group.endpoint"`));
    }

    const group = apiRegistry[parts[0]];

    if (!group) {
        return Promise.reject(new Error(`[marco.api] Unknown group "${parts[0]}"`));
    }

    const endpoint = group[parts[1]];

    if (!endpoint) {
        return Promise.reject(new Error(`[marco.api] Unknown endpoint "${path}"`));
    }

    return callEndpoint<T>(endpoint, options);
}

/* ------------------------------------------------------------------ */
/*  Typed method wrappers                                              */
/* ------------------------------------------------------------------ */

const credits = Object.freeze({
    fetchWorkspaces(options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.credits.fetchWorkspaces, options);
    },

    fetchBalance(wsId: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.credits.fetchBalance, {
            ...options,
            params: { wsId, ...options?.params },
        });
    },

    resolve(wsId: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.credits.resolve, {
            ...options,
            params: { wsId, ...options?.params },
        });
    },
});

const workspace = Object.freeze({
    move(projectId: string, targetWsId: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.workspace.move, {
            ...options,
            params: { projectId, ...options?.params },
            body: { workspace_id: targetWsId, ...((options?.body as Record<string, unknown>) ?? {}) },
        });
    },

    rename(wsId: string, newName: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.workspace.rename, {
            ...options,
            params: { wsId, ...options?.params },
            body: { name: newName, ...((options?.body as Record<string, unknown>) ?? {}) },
        });
    },

    markViewed(projectId: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.workspace.markViewed, {
            ...options,
            params: { projectId, ...options?.params },
            body: options?.body ?? {},
        });
    },

    probe(options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.workspace.probe, options);
    },

    resolveByProject(projectId: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.workspace.resolveByProject, {
            ...options,
            params: { projectId, ...options?.params },
        });
    },

    switchContext(wsId: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.workspace.switchContext, {
            ...options,
            params: { wsId, ...options?.params },
        });
    },
});

const memberships = Object.freeze({
    /**
     * Search active members of a workspace.
     *
     * Returns up to 20 members. Server-side `status=active&limit=20` is baked
     * into the URL template; sorting and additional filtering are performed
     * client-side by the caller.
     */
    search(wsId: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.memberships.search, {
            ...options,
            params: { wsId, ...options?.params },
        });
    },

    /**
     * Invite a user to a workspace by email.
     * PENDING-VERIFY: confirm endpoint shape on first live call.
     */
    invite(
        wsId: string,
        email: string,
        role: "member" | "owner",
        options?: ApiCallOptions,
    ): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.memberships.invite, {
            ...options,
            params: { wsId, ...options?.params },
            body: { email, role, ...((options?.body as Record<string, unknown>) ?? {}) },
        });
    },

    /** Remove a member from a workspace. PENDING-VERIFY. */
    remove(wsId: string, userId: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.memberships.remove, {
            ...options,
            params: { wsId, userId, ...options?.params },
        });
    },

    /** Change a member's role (typically promote to owner). PENDING-VERIFY. */
    updateRole(
        wsId: string,
        userId: string,
        role: "member" | "owner",
        options?: ApiCallOptions,
    ): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.memberships.updateRole, {
            ...options,
            params: { wsId, userId, ...options?.params },
            body: { role, ...((options?.body as Record<string, unknown>) ?? {}) },
        });
    },
});

const projects = Object.freeze({
    /** List projects in a workspace (used for remix-name collision pre-check
     * and Projects-modal enrichment — list response carries `name`,
     * `github_repo`, `github_branch`, `last_message_at` per project). */
    list(wsId: string, options?: ApiCallOptions): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.projects.list, {
            ...options,
            params: { wsId, ...options?.params },
        });
    },

    // NOTE: `get(projectId)` was removed 2026-05-22 — the bare
    // `GET /projects/{id}` route returns HTTP 405. All metadata callers
    // need is already present in the list response; see Q52 in
    // `.lovable/question-and-ambiguity/52-projects-get-405.md`.
});

const remix = Object.freeze({
    /**
     * Initialize a remix of an existing project. Body keys are snake_case
     * per upstream API contract; callers pass camelCase fields and this
     * wrapper performs the conversion.
     */
    init(
        projectId: string,
        body: {
            workspaceId: string;
            projectName: string;
            includeHistory: boolean;
            includeCustomKnowledge: boolean;
        },
        options?: ApiCallOptions,
    ): Promise<ApiResponse> {
        return callEndpoint(apiRegistry.remix.init, {
            ...options,
            params: { projectId, ...options?.params },
            body: {
                workspace_id: body.workspaceId,
                project_name: body.projectName,
                include_history: body.includeHistory,
                include_custom_knowledge: body.includeCustomKnowledge,
            },
        });
    },
});

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface MarcoApiModule {
    call<T = unknown>(path: string, options?: ApiCallOptions): Promise<ApiResponse<T>>;
    credits: typeof credits;
    workspace: typeof workspace;
    memberships: typeof memberships;
    projects: typeof projects;
    remix: typeof remix;
}

export function createApiModule(): MarcoApiModule {
    return {
        call,
        credits,
        workspace,
        memberships,
        projects,
        remix,
    };
}
