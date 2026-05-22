/**
 * Marco Extension — Auto-Attach Evaluator
 *
 * Implements the AND-gated auto-attach policy defined in
 * mem://features/auto-attach-policy.md.
 *
 * A library script is auto-attached to a project ONLY when ALL of C1..C8
 * hold. URL match alone is NEVER sufficient. Every skip MUST return a
 * structured reason — never a silent early return.
 *
 * See also:
 * - mem://standards/no-silent-failures.md
 * - src/background/condition-evaluator.ts (reused for C3 at inject-time)
 */

import type { StoredProject, ScriptEntry } from "../shared/project-types";
import { isUrlMatch } from "./url-matcher";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Minimal shape of a library script's compiled instruction needed here. */
export interface LibraryScriptForAttach {
    /** Stable identifier — used both as scriptId and ScriptEntry.path. */
    id: string;
    name: string;
    instruction: {
        UrlMatches?: string[];
        AutoAttach?: boolean;
        RunAt?: ScriptEntry["runAt"];
        World?: "MAIN" | "ISOLATED";
        RequiredCookies?: string[];
        Dependencies?: string[];
        InjectionConditions?: {
            requireElement?: string | null;
            requireCookie?: string | null;
            minDelayMs?: number;
            requireOnline?: boolean;
        };
    };
}

export type SkipReason =
    | "AUTOATTACH_SKIPPED_AUTOSTART_OFF"            // C1
    | "AUTOATTACH_SKIPPED_OPT_OUT"                  // C4
    | "AUTOATTACH_SKIPPED_URL_NO_MATCH"             // C2
    | "AUTOATTACH_ALREADY_ATTACHED"                 // C8
    | "AUTOATTACH_SKIPPED_INCOMPATIBLE_RUN_CONTEXT" // C5
    | "AUTOATTACH_SKIPPED_COOKIE_BINDING_MISSING"   // C6
    | "AUTOATTACH_SKIPPED_DEP_MISSING"              // C7
    | "AUTOATTACH_SKIPPED_CONDITION_FAIL";          // C3

export interface AttachDecision {
    ok: boolean;
    reason: SkipReason | "OK";
    detail: string;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Evaluates whether `script` should be auto-attached to `project`.
 * Cheap → expensive ordering; short-circuits on first failure.
 *
 * Note: C3 (runtime InjectionConditions) is checked structurally here.
 * Live element/cookie/online evaluation happens at inject-time via
 * condition-evaluator.ts; at attach-time we only reject if the declared
 * conditions are obviously unresolvable (e.g. requireCookie names a cookie
 * the project has no binding for).
 */
export function evaluateAutoAttach(
    project: StoredProject,
    script: LibraryScriptForAttach,
    libraryIds: ReadonlySet<string>,
): AttachDecision {
    // C1 — autoStart gate
    const isAutoStartOn = project.settings?.autoStart === true;
    if (!isAutoStartOn) {
        return {
            ok: false,
            reason: "AUTOATTACH_SKIPPED_AUTOSTART_OFF",
            detail: `Project "${project.name}" has autoStart=false`,
        };
    }

    // C4 — script opt-out
    const isOptedOut = script.instruction.AutoAttach === false;
    if (isOptedOut) {
        return {
            ok: false,
            reason: "AUTOATTACH_SKIPPED_OPT_OUT",
            detail: `Script "${script.name}" declared AutoAttach=false`,
        };
    }

    // C2 — URL match
    const urlMatches = script.instruction.UrlMatches ?? [];
    const projectPatterns = project.targetUrls.map((r) => r.pattern);
    const hasUrlOverlap = urlMatches.some((scriptPattern) =>
        projectPatterns.some((projectPattern) =>
            isUrlMatch(projectPattern, {
                pattern: scriptPattern,
                matchType: "glob",
            }),
        ),
    );
    if (!hasUrlOverlap) {
        return {
            ok: false,
            reason: "AUTOATTACH_SKIPPED_URL_NO_MATCH",
            detail: `Script UrlMatches [${urlMatches.join(", ")}] do not overlap project URLs [${projectPatterns.join(", ")}]`,
        };
    }

    // C8 — idempotent
    const isAlreadyAttached = project.scripts.some(
        (s) => s.path === script.id || s.path === script.name,
    );
    if (isAlreadyAttached) {
        return {
            ok: false,
            reason: "AUTOATTACH_ALREADY_ATTACHED",
            detail: `Script "${script.name}" already in project.scripts`,
        };
    }

    // C5 — run context compatibility (current pipeline only injects MAIN world)
    const declaredWorld = script.instruction.World;
    const isIncompatibleWorld =
        declaredWorld !== undefined && declaredWorld !== "MAIN";
    if (isIncompatibleWorld) {
        return {
            ok: false,
            reason: "AUTOATTACH_SKIPPED_INCOMPATIBLE_RUN_CONTEXT",
            detail: `Script declares World="${declaredWorld}"; pipeline requires MAIN`,
        };
    }

    // C6 — cookie bindings present on project
    const requiredCookies = script.instruction.RequiredCookies ?? [];
    const projectCookieNames = new Set(
        (project.cookies ?? []).map((c) => c.cookieName),
    );
    const missingCookie = requiredCookies.find(
        (name) => !projectCookieNames.has(name),
    );
    if (missingCookie !== undefined) {
        return {
            ok: false,
            reason: "AUTOATTACH_SKIPPED_COOKIE_BINDING_MISSING",
            detail: `Project has no cookie binding for "${missingCookie}"`,
        };
    }

    // C7 — dependencies present in library
    const declaredDeps = script.instruction.Dependencies ?? [];
    const missingDep = declaredDeps.find((depId) => !libraryIds.has(depId));
    if (missingDep !== undefined) {
        return {
            ok: false,
            reason: "AUTOATTACH_SKIPPED_DEP_MISSING",
            detail: `Dependency "${missingDep}" is not in the library`,
        };
    }

    // C3 — structural feasibility of InjectionConditions at attach-time
    const cond = script.instruction.InjectionConditions;
    const hasCookieRequirement =
        cond !== undefined && cond.requireCookie != null;
    if (hasCookieRequirement) {
        const cookieName = cond!.requireCookie as string;
        const isCookieBindable = projectCookieNames.has(cookieName);
        if (!isCookieBindable) {
            return {
                ok: false,
                reason: "AUTOATTACH_SKIPPED_CONDITION_FAIL",
                detail: `InjectionConditions.requireCookie="${cookieName}" has no project binding`,
            };
        }
    }

    return {
        ok: true,
        reason: "OK",
        detail: `All C1..C8 satisfied for "${script.name}"`,
    };
}

/**
 * Builds a ScriptEntry from a library script for insertion into project.scripts.
 * Caller is responsible for persisting the project and logging the attach.
 */
export function buildAttachedScriptEntry(
    script: LibraryScriptForAttach,
    order: number,
): ScriptEntry {
    return {
        path: script.id,
        order,
        runAt: script.instruction.RunAt ?? "document_idle",
    };
}
