/**
 * Marco Extension — Prompt Injector logger shim
 *
 * Mirrors `standalone-scripts/lovable-dashboard/src/logger.ts`: a thin wrapper around
 * `RiseupAsiaMacroExt.Logger` (memory `error-logging-via-namespace-logger`)
 * that falls back to `console.error` when the namespace SDK isn't injected
 * (e.g. when the prompt-injector content script runs on a page that hasn't
 * received the macro-controller MAIN-world bundle).
 *
 * NEVER call `console.error` directly from prompt-injector feature code —
 * always go through `logError` so failures surface through the same
 * namespace-logger pipeline as the rest of the extension.
 */

const SCOPE_PREFIX = "PromptInjector.";

interface NamespaceLogger {
    error: (scope: string, caught: unknown) => void;
    warn?: (scope: string, message: string) => void;
}

interface MaybeNamespaceWindow {
    RiseupAsiaMacroExt?: { Logger?: NamespaceLogger };
}

function getLogger(): NamespaceLogger | null {
    try {
        const w = window as unknown as MaybeNamespaceWindow;
        return w.RiseupAsiaMacroExt?.Logger ?? null;
    } catch {
        return null;
    }
}

/**
 * Logs an error with a fully-qualified scope. `message` should already
 * follow the project's CODE-RED convention (exact path, what was missing,
 * reason) — see `mem://constraints/file-path-error-logging-code-red.md`.
 */
export function logError(scope: string, message: string, caught?: unknown): void {
    const fullScope = `${SCOPE_PREFIX}${scope}`;
    const logger = getLogger();
    if (logger) {
        logger.error(fullScope, caught ?? new Error(message));
        return;
    }
    if (caught !== undefined) {
        console.error(`[${fullScope}] ${message}`, caught);
    } else {
        console.error(`[${fullScope}] ${message}`);
    }
}
