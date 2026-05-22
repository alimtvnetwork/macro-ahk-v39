/**
 * Lightweight hook that fetches the error/warning count
 * for the sidebar badge. Listens for real-time ERROR_COUNT_CHANGED
 * broadcasts from the background service worker for instant updates,
 * with a polling fallback for environments without chrome.runtime.
 *
 * Polling rules (idle-loop audit, 2026-04-25):
 *   - When the broadcast listener is attached, the polling fallback is
 *     skipped entirely — broadcasts are authoritative and a redundant
 *     timer would just waste cycles + leak across re-renders.
 *   - When the page is hidden (`document.hidden === true`) the polling
 *     interval is suspended. Becoming visible triggers a single immediate
 *     refresh and re-arms the interval.
 */

import { useEffect, useState, useCallback } from "react";
import { sendMessage } from "@/lib/message-client";
import { logError } from "./hook-logger";

// eslint-disable-next-line max-lines-per-function -- hook with broadcast listener + visibility-aware polling fallback
export function useErrorCount(pollIntervalMs = 30_000) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const result = await sendMessage<{ errors: Array<{ id: string }> }>({ type: "GET_ACTIVE_ERRORS" });
      setCount(result.errors?.length ?? 0);
    } catch (caught) {
      logError("useErrorCount.refresh", "GET_ACTIVE_ERRORS failed — badge will show 0 until next poll", caught);
      setCount(0);
    }
  }, []);

  useEffect(() => {
    void refresh();

    // Real-time listener for ERROR_COUNT_CHANGED broadcasts
    const runtime = (typeof chrome !== "undefined" ? chrome.runtime : undefined) as
      | { onMessage?: { addListener: (fn: (msg: unknown) => void) => void; removeListener: (fn: (msg: unknown) => void) => void } }
      | undefined;

    const hasChromeRuntime = runtime?.onMessage !== undefined;
    let listenerAttached = false;

    const handleBroadcast = (
      message: unknown,
    ) => {
      const msg = message as { type?: string; count?: number } | null;
      const isErrorCountChange = msg?.type === "ERROR_COUNT_CHANGED";

      if (isErrorCountChange) {
        setCount(msg!.count ?? 0);
      }
    };

    if (hasChromeRuntime) {
      try {
        runtime!.onMessage!.addListener(handleBroadcast);
        listenerAttached = true;
      } catch (caught) {
        logError("useErrorCount.attachBroadcast", "chrome.runtime.onMessage.addListener threw — extension context likely invalidated, falling back to polling", caught);
      }
    }

    // ── Polling fallback ───────────────────────────────────────────────
    // Only runs when the broadcast listener is NOT attached. When the
    // page is hidden, the timer is suspended and resumed on visibility.
    let pollId: ReturnType<typeof setInterval> | null = null;
    const pollingDisabled = listenerAttached;

    const startPolling = () => {
      if (pollingDisabled) { return; }
      if (pollId !== null) { return; }
      pollId = setInterval(() => void refresh(), pollIntervalMs);
    };

    const stopPolling = () => {
      if (pollId !== null) {
        clearInterval(pollId);
        pollId = null;
      }
    };

    const handleVisibility = () => {
      if (pollingDisabled) { return; }
      if (typeof document === "undefined") { return; }
      if (document.hidden) {
        stopPolling();
      } else {
        // Catch up on anything we missed while hidden, then resume polling.
        void refresh();
        startPolling();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    // Kick off polling only if the page is currently visible (or there's
    // no `document` to consult, e.g. SSR safety).
    const isInitiallyVisible = typeof document === "undefined" || !document.hidden;
    if (isInitiallyVisible) { startPolling(); }

    return () => {
      stopPolling();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
      if (listenerAttached) {
        try {
          runtime!.onMessage!.removeListener(handleBroadcast);
        } catch (caught) {
          logError("useErrorCount.detachBroadcast", "chrome.runtime.onMessage.removeListener threw — context already invalidated", caught);
        }
      }
    };
  }, [refresh, pollIntervalMs]);

  return { count, refresh };
}
