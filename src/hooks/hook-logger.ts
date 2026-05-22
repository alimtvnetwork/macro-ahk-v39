/**
 * Hook-level logger shim — neutral logger for hooks not tied to a specific
 * surface (popup / options). Mirrors lib-logger so caught errors are surfaced
 * via `console.error` instead of being silently swallowed.
 *
 * Per `mem://standards/no-error-swallowing`: every catch block must call
 * `logError(...)` (or rethrow) — never return a sentinel silently.
 */

const SCOPE_PREFIX = "Hook.";

export function logError(scope: string, message: string, caught?: unknown): void {
    const fullScope = `${SCOPE_PREFIX}${scope}`;
    if (caught !== undefined) {
        console.error(`[${fullScope}] ${message}`, caught);
    } else {
        console.error(`[${fullScope}] ${message}`);
    }
}
