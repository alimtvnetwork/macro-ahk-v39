/**
 * Marco Extension — Auto-Attach Runner
 *
 * Wires the AND-gated `evaluateAutoAttach` policy
 * (mem://features/auto-attach-policy.md) into the project save flow.
 *
 * For every script in the library, decide whether it should be appended
 * to `project.scripts`. EVERY skip MUST emit a structured log line — no
 * silent early returns (mem://standards/no-silent-failures.md).
 *
 * Note on StoredScript ↔ LibraryScriptForAttach mapping: the canonical
 * compiled `instruction.json` lives in script-resolver. To avoid a
 * cross-cutting refactor at wire-time, we read whatever per-script meta
 * the StoredScript record already carries (UrlMatches / AutoAttach /
 * Dependencies / RunAt / RequiredCookies / InjectionConditions / World)
 * via a typed view. If a script has no UrlMatches metadata the evaluator
 * will (correctly) skip with AUTOATTACH_SKIPPED_URL_NO_MATCH — URL-only
 * is never enough, but neither is "no URL info" → attach. Safe default.
 */

import type { StoredProject, ScriptEntry } from "../shared/project-types";
import type { StoredScript } from "../shared/script-config-types";
import {
    evaluateAutoAttach,
    buildAttachedScriptEntry,
    type LibraryScriptForAttach,
    type AttachDecision,
} from "./auto-attach";
import { logBgWarnError, BgLogTag, logCaughtError } from "./bg-logger";
import { STORAGE_KEY_AUTO_ATTACH_DECISIONS } from "../shared/constants";

export interface PersistedAutoAttachDecision {
    scriptId: string;
    scriptName: string;
    ok: boolean;
    reason: AttachDecision["reason"];
    detail: string;
}

export interface PersistedAutoAttachRecord {
    projectId: string;
    projectName: string;
    evaluatedAt: string;
    decisions: PersistedAutoAttachDecision[];
}

const TAG = BgLogTag.SCRIPT_RESOLVER;

/** Optional instruction-shaped extras some StoredScript records carry. */
interface ScriptAttachExtras {
    urlMatches?: string[];
    autoAttach?: boolean;
    world?: "MAIN" | "ISOLATED";
    requiredCookies?: string[];
    injectionConditions?: LibraryScriptForAttach["instruction"]["InjectionConditions"];
}

function toLibraryScriptForAttach(s: StoredScript): LibraryScriptForAttach {
    const extras = s as unknown as ScriptAttachExtras;
    return {
        id: s.id,
        name: s.name,
        instruction: {
            UrlMatches: extras.urlMatches,
            AutoAttach: extras.autoAttach ?? s.autoInject,
            RunAt: s.runAt,
            World: extras.world,
            RequiredCookies: extras.requiredCookies,
            Dependencies: s.dependencies,
            InjectionConditions: extras.injectionConditions,
        },
    };
}

/**
 * Iterates the library and returns a project copy with newly auto-attached
 * entries appended to `project.scripts`. Every skip is logged with its
 * reason code; the returned project is a no-op clone when nothing matches.
 */
export function runAutoAttach(
    project: StoredProject,
    library: StoredScript[],
): { project: StoredProject; attached: ScriptEntry[]; decisions: Array<{ scriptId: string; decision: AttachDecision }> } {
    const libraryIds = new Set(library.map((s) => s.id));
    const startingOrder = project.scripts.length;
    const attached: ScriptEntry[] = [];
    const decisions: Array<{ scriptId: string; decision: AttachDecision }> = [];

    for (const stored of library) {
        const view = toLibraryScriptForAttach(stored);
        const decision = evaluateAutoAttach(project, view, libraryIds);
        decisions.push({ scriptId: stored.id, decision });

        if (decision.ok) {
            attached.push(buildAttachedScriptEntry(view, startingOrder + attached.length));
            continue;
        }

        // Non-silent: surface every skip. WARN for binding/dep issues, INFO otherwise.
        const isWarn =
            decision.reason === "AUTOATTACH_SKIPPED_COOKIE_BINDING_MISSING" ||
            decision.reason === "AUTOATTACH_SKIPPED_DEP_MISSING";
        const line = `auto-attach skip [${decision.reason}] project="${project.name}" script="${stored.name}" — ${decision.detail}`;
        if (isWarn) {
            logBgWarnError(TAG, line);
        } else {
            console.info(`${TAG} ${line}`);
        }
    }

    if (attached.length === 0) {
        return { project, attached, decisions };
    }

    return {
        project: { ...project, scripts: [...project.scripts, ...attached] },
        attached,
        decisions,
    };
}
