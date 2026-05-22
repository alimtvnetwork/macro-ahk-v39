/**
 * Token Seeder Diagnostics Cache
 *
 * Persists the most recent token-seeder diagnostics snapshot in
 * localStorage so the System Status indicator and full diagnostics
 * panel can hydrate immediately on mount — letting the cooldown
 * countdown resume correctly when the operator reopens the options
 * page instead of flashing empty until the next background poll.
 *
 * The cache is intentionally short-lived: snapshots older than the
 * MAX cooldown window are discarded because every blocked tab will
 * have either retried or been cleared by the background by then.
 */

export interface InaccessibleSeedTargetCacheEntry {
    tabId: number;
    tabUrl: string;
    reason: string;
    code: string;
    firstFailureAt: number;
    lastFailureAt: number;
    attemptCount: number;
    cooldownMs: number;
}

export interface TokenSeederDiagnosticsCache {
    targets: InaccessibleSeedTargetCacheEntry[];
    cooldownMs: number;
    capturedAt: string;
}

const STORAGE_KEY = "marco.tokenSeeder.diagnosticsCache.v1";
// Max age past the longest cooldown before we treat the cache as stale.
const MAX_STALE_GRACE_MS = 5 * 60_000; // 5 minutes

function getStorage(): Storage | null {
    try {
        if (typeof window === "undefined") return null;
        return window.localStorage;
    } catch {
        return null;
    }
}

export function loadDiagnosticsCache(): TokenSeederDiagnosticsCache | null {
    const storage = getStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as TokenSeederDiagnosticsCache;
        if (!parsed || !Array.isArray(parsed.targets)) return null;

        // Drop snapshots whose youngest failure is older than cooldown + grace.
        const now = Date.now();
        const maxLastFailure = parsed.targets.reduce(
            (acc, t) => Math.max(acc, t.lastFailureAt ?? 0),
            0,
        );
        const cooldown = parsed.cooldownMs ?? 0;
        if (
            maxLastFailure > 0 &&
            now - maxLastFailure > cooldown + MAX_STALE_GRACE_MS
        ) {
            storage.removeItem(STORAGE_KEY);
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

export function saveDiagnosticsCache(snapshot: TokenSeederDiagnosticsCache | null): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        if (!snapshot || snapshot.targets.length === 0) {
            storage.removeItem(STORAGE_KEY);
            return;
        }
        storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (caught) {
        logError("tokenSeederDiagnosticsCache.save", "localStorage quota or serialization failure — cache write skipped (non-fatal)", caught);
    }
}

export function clearDiagnosticsCache(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.removeItem(STORAGE_KEY);
    } catch (caught) {
        logError("tokenSeederDiagnosticsCache.clear", "localStorage.removeItem failed — cache entry may persist until next overwrite", caught);
    }
}
