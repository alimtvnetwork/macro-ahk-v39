/**
 * Marco Extension — XPath Capture Coalescer (PERF-R6)
 *
 * Buffers `XPATH_CAPTURED` payloads on the content-script side and flushes
 * them as a single `RECORDER_CAPTURE_PERSIST_BATCH` message instead of one
 * sendMessage per click. Reduces IPC + service-worker wake-ups for rapid
 * recording sessions (typing into a form fires many captures inside the
 * same task).
 *
 * Contract:
 *   - Flush triggers (whichever fires first):
 *       1. queue length reaches MAX_BATCH (8)
 *       2. DEBOUNCE_MS (200) elapses since the last enqueue
 *       3. pagehide / explicit flushNow() from the lifecycle teardown
 *   - Single in-flight flush — additional flushes are queued behind it so
 *     we never reorder captures or hammer the worker.
 *   - Fail-fast: a flush error is logged once and the failing batch is
 *     dropped (no retry, no backoff — honours `no-retry-policy`). The next
 *     enqueue starts a fresh queue.
 *
 * @see spec/31-macro-recorder/13-capture-to-step-bridge.md
 * @see mem://constraints/no-retry-policy
 */

const MAX_BATCH = 8;
const DEBOUNCE_MS = 200;

export interface CapturePayload {
    readonly type: "XPATH_CAPTURED";
    readonly XPathFull: string;
    readonly [key: string]: unknown;
}

type SendFn = (msg: unknown) => Promise<unknown>;

interface CoalescerState {
    queue: CapturePayload[];
    timerId: number | null;
    flushing: Promise<void> | null;
}

const state: CoalescerState = {
    queue: [],
    timerId: null,
    flushing: null,
};

/** Default sender — chrome.runtime.sendMessage wrapped in a Promise. */
function defaultSend(msg: unknown): Promise<unknown> {
    return chrome.runtime.sendMessage(msg);
}

let sendImpl: SendFn = defaultSend;

/** Test seam — swap the underlying transport. */
export function __setSendForTests(fn: SendFn | null): void {
    sendImpl = fn ?? defaultSend;
}

/** Test seam — reset all internal state. */
export function __resetForTests(): void {
    if (state.timerId !== null) {
        clearTimeout(state.timerId);
    }
    state.queue = [];
    state.timerId = null;
    state.flushing = null;
}

/** Returns the current queue length (test-only inspection). */
export function __queueLength(): number {
    return state.queue.length;
}

/**
 * Enqueues a capture for batched delivery. Triggers an immediate flush
 * when the queue reaches MAX_BATCH; otherwise schedules a debounced flush.
 */
export function enqueueCapture(payload: CapturePayload): void {
    state.queue.push(payload);

    if (state.queue.length >= MAX_BATCH) {
        cancelTimer();
        void flushNow();
        return;
    }

    if (state.timerId === null) {
        state.timerId = (globalThis.setTimeout as typeof setTimeout)(() => {
            state.timerId = null;
            void flushNow();
        }, DEBOUNCE_MS) as unknown as number;
    }
}

/**
 * Flushes the queue immediately. Safe to call from pagehide. Returns when
 * the in-flight send settles. Sequential — never starts a parallel flush.
 */
export async function flushNow(): Promise<void> {
    cancelTimer();
    if (state.flushing !== null) {
        await state.flushing;
    }
    if (state.queue.length === 0) return;

    const batch = state.queue.splice(0, state.queue.length);
    const send = sendImpl;

    state.flushing = (async () => {
        try {
            if (batch.length === 1) {
                // Single-capture path stays compatible with the original
                // RECORDER_CAPTURE_PERSIST handler so existing callers/tests
                // continue to work.
                await send({
                    type: "RECORDER_CAPTURE_PERSIST",
                    payload: batch[0],
                });
            } else {
                await send({
                    type: "RECORDER_CAPTURE_PERSIST_BATCH",
                    payloads: batch,
                });
            }
        } catch (err) {
            // Fail-fast: log once, drop the batch, no retry.
            console.warn(
                "[Marco] xpath capture batch flush failed — dropping",
                batch.length,
                "captures",
                err,
            );
        } finally {
            state.flushing = null;
        }
    })();

    await state.flushing;
}

function cancelTimer(): void {
    if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
    }
}
