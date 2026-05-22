/**
 * Marco Extension — Auto-run keyword event chain after recording
 *
 * Watches the recorder session (`useRecordingSession().session`) for the
 * transition `Recording`/`Paused` → Idle (i.e. the user just stopped a
 * session) and, when {@link KeywordEventChainSettings.RunAfterRecording}
 * is enabled, fires {@link runKeywordEventChain} once per stop event.
 *
 * Designed as a thin React binding so the chain runner stays pure and
 * testable without a DOM. The hook itself is covered by integration
 * tests that drive a fake session prop through the store.
 */

import { useEffect, useRef } from "react";
import { logError } from "./hook-logger";

import type { RecordingSession } from "@/background/recorder/recorder-session-types";
import type { KeywordEvent } from "@/hooks/use-keyword-events";
import {
    runKeywordEventChain,
    type ChainRunOptions,
    type ChainRunResult,
    type KeywordEventChainSettings,
} from "@/lib/keyword-event-chain";

export interface UseAutoRunChainOptions {
    /** Live chain settings (toggle + global pause). */
    readonly settings: KeywordEventChainSettings;
    /** Live event list to chain. Filtered for `Enabled` by the runner. */
    readonly events: ReadonlyArray<KeywordEvent>;
    /** Current recorder session — `null` once the user stops recording. */
    readonly session: RecordingSession | null;
    /**
     * Called immediately before the chain runs. Optional — useful for the
     * panel to surface a banner / spinner while the chain executes after
     * an auto-trigger.
     */
    readonly onAutoRunStart?: (events: ReadonlyArray<KeywordEvent>) => void;
    /** Called after the chain finishes (or aborts). */
    readonly onAutoRunEnd?: (result: ChainRunResult) => void;
    /**
     * Test seam — defaults to {@link runKeywordEventChain}. Tests inject a
     * stub so they can assert call args without touching the DOM.
     */
    readonly chainRunner?: (
        events: ReadonlyArray<KeywordEvent>,
        options?: ChainRunOptions,
    ) => Promise<ChainRunResult>;
}

/**
 * Decide whether a session transition should fire the auto-run chain.
 *
 *   prev session was actively Recording or Paused, AND
 *   next session is null (the store collapses Idle to null) OR Phase Idle.
 *
 * Pure helper — exported for tests so we can verify edge cases without
 * mounting React.
 */
export function shouldAutoRun(
    prev: RecordingSession | null,
    next: RecordingSession | null,
): boolean {
    if (prev === null) { return false; }
    const wasActive = prev.Phase === "Recording" || prev.Phase === "Paused";
    if (!wasActive) { return false; }
    const isIdle = next === null || next.Phase === "Idle";
    return isIdle;
}

export function useAutoRunChainAfterRecording(opts: UseAutoRunChainOptions): void {
    const { settings, events, session, onAutoRunStart, onAutoRunEnd, chainRunner } = opts;
    const prevSessionRef = useRef<RecordingSession | null>(null);
    // Keep the *latest* values in refs so the effect closes over only
    // `session` — we don't want to re-fire the chain just because the
    // settings or events list changed mid-recording.
    const settingsRef = useRef<KeywordEventChainSettings>(settings);
    const eventsRef = useRef<ReadonlyArray<KeywordEvent>>(events);
    const startCbRef = useRef<UseAutoRunChainOptions["onAutoRunStart"]>(onAutoRunStart);
    const endCbRef = useRef<UseAutoRunChainOptions["onAutoRunEnd"]>(onAutoRunEnd);
    const runnerRef = useRef<UseAutoRunChainOptions["chainRunner"]>(chainRunner);

    useEffect(() => { settingsRef.current = settings; }, [settings]);
    useEffect(() => { eventsRef.current = events; }, [events]);
    useEffect(() => { startCbRef.current = onAutoRunStart; }, [onAutoRunStart]);
    useEffect(() => { endCbRef.current = onAutoRunEnd; }, [onAutoRunEnd]);
    useEffect(() => { runnerRef.current = chainRunner; }, [chainRunner]);

    useEffect(() => {
        const prev = prevSessionRef.current;
        prevSessionRef.current = session;

        if (!shouldAutoRun(prev, session)) { return; }
        if (!settingsRef.current.RunAfterRecording) { return; }

        const runnable = eventsRef.current.filter((e) => e.Enabled && e.Steps.length > 0);
        if (runnable.length === 0) { return; }

        const runner = runnerRef.current ?? runKeywordEventChain;
        let cancelled = false;

        startCbRef.current?.(runnable);
        runner(runnable, { pauseMs: settingsRef.current.PauseMs })
            .then((result) => {
                if (cancelled) { return; }
                endCbRef.current?.(result);
            })
            .catch((caught: unknown) => {
                // The chain runner traps its own errors and resolves with a
                // result; this catch is purely defensive against custom
                // runners passed in by tests.
                logError("useAutoRunChainAfterRecording", "Custom runner rejected — default runner always resolves; investigate test/runner injection", caught);
            });

        return () => { cancelled = true; };
    }, [session]);
}
