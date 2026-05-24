/**
 * Marco Extension — Seen Origins
 *
 * Tracks origins where auto-attach has *ever* surfaced to the user
 * (via the first-attach toast). Used as the "first-attach intent"
 * gate: only show the toast when an origin matches projects AND is
 * not yet in this set AND is not dismissed (C9).
 *
 * Persisted across SW restarts under `chrome.storage.local`:
 *   marco_seen_origins → string[]
 *
 * Hot-path read is sync (`isOriginSeen`); writes are async and
 * fire-and-forget. No retry/backoff (mem://constraints/no-retry-policy).
 */

import { logCaughtError, BgLogTag } from "./bg-logger";

export const STORAGE_KEY_SEEN_ORIGINS = "marco_seen_origins";

const seen: Set<string> = new Set();
let hydrated = false;

function safeOrigin(url: string): string {
    try {
        return new URL(url).origin;
    } catch {
        return "";
    }
}

async function hydrate(): Promise<void> {
    if (hydrated) return;
    try {
        const raw = await chrome.storage.local.get(STORAGE_KEY_SEEN_ORIGINS);
        const list = raw[STORAGE_KEY_SEEN_ORIGINS];
        if (Array.isArray(list)) {
            for (const o of list) {
                if (typeof o === "string" && o.length > 0) seen.add(o);
            }
        }
        hydrated = true;
    } catch (err) {
        logCaughtError(
            BgLogTag.MARCO,
            "[seen-origins] hydrate failed; treating set as empty",
            err as Error,
        );
        hydrated = true;
    }
}

/** Boot-time preload so `isOriginSeen` is hot from first navigation. */
export async function preloadSeenOrigins(): Promise<void> {
    await hydrate();
}

/** Sync, hot-path read. Requires preloadSeenOrigins() to have run. */
export function isOriginSeen(url: string): boolean {
    const origin = safeOrigin(url);
    if (origin === "") return true; // unparseable → never show toast
    return seen.has(origin);
}

/** Mark origin as seen (idempotent). Returns true if newly added. */
export async function markOriginSeen(url: string): Promise<boolean> {
    const origin = safeOrigin(url);
    if (origin === "") return false;
    await hydrate();
    if (seen.has(origin)) return false;
    seen.add(origin);
    try {
        await chrome.storage.local.set({
            [STORAGE_KEY_SEEN_ORIGINS]: Array.from(seen),
        });
    } catch (err) {
        logCaughtError(
            BgLogTag.MARCO,
            `[seen-origins] persist failed for origin=${origin}`,
            err as Error,
        );
    }
    return true;
}

/** Test-only reset. */
export function _resetSeenOriginsForTests(): void {
    seen.clear();
    hydrated = false;
}
