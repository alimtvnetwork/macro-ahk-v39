/**
 * Marco Extension — Custom Keyword Events store
 *
 * Each KeywordEvent associates a user-defined keyword/label with an ordered
 * list of {@link KeywordEventStep}s that should fire during playback. Steps
 * are either a key press (e.g. `Enter`, `Ctrl+Tab`) or a wait period in ms.
 *
 * Persistence: localStorage under `marco-keyword-events-v1` (JSON array).
 * Pure presentation/state — playback wiring is consumed elsewhere.
 */

import { useCallback, useEffect, useState } from "react";
import { logError } from "./hook-logger";

const STORAGE_KEY = "marco-keyword-events-v1";

/**
 * Per-step optional flags. Both default to "absent = on/no-label" so older
 * persisted events without these fields keep their current behaviour:
 *   • `Enabled` — `false` skips the step at playback time. Absent / `true`
 *     runs as before. Set in bulk by the step-row right-click context menu.
 *   • `Label`   — free-form display name shown next to the step's
 *     Combo/Wait summary. Used by the "Rename in sequence" bulk action so
 *     selected steps can be relabelled to "Login 01", "Login 02", … without
 *     touching the underlying Combo (which carries real keystroke data).
 */
export interface KeywordEventStepCommon {
    readonly Enabled?: boolean;
    readonly Label?: string;
}
export type KeywordEventStep =
    | (KeywordEventStepCommon & { readonly Kind: "Key"; readonly Id: string; readonly Combo: string })
    | (KeywordEventStepCommon & { readonly Kind: "Wait"; readonly Id: string; readonly DurationMs: number });

/**
 * Where the synthetic key events should be dispatched.
 *   - `ActiveElement` — current `document.activeElement` at dispatch time
 *     (legacy default; preserves the prior playback behaviour).
 *   - `Body`          — always `document.body`.
 *   - `Selector`      — first match of `Selector` (a CSS selector). Falls back
 *     to `document.body` when the selector matches nothing so playback never
 *     silently no-ops.
 */
export type KeywordEventTarget =
    | { readonly Kind: "ActiveElement" }
    | { readonly Kind: "Body" }
    | { readonly Kind: "Selector"; readonly Selector: string };

export const DEFAULT_KEYWORD_EVENT_TARGET: KeywordEventTarget = { Kind: "ActiveElement" };

export interface KeywordEvent {
    readonly Id: string;
    readonly Keyword: string;
    readonly Description: string;
    readonly Steps: readonly KeywordEventStep[];
    readonly Enabled: boolean;
    /**
     * Target picker for the synthetic keystrokes. Optional — older persisted
     * events without this field default to {@link DEFAULT_KEYWORD_EVENT_TARGET}
     * so existing data keeps working.
     */
    readonly Target?: KeywordEventTarget;
    /**
     * Optional per-event override for the inter-event pause used by
     * `runKeywordEventChain`. When set to a finite, non-negative number,
     * this value replaces the chain's global `PauseMs` for the gap
     * *after* this event finishes. When undefined, the chain's global
     * pause applies. Clamped to `[0, 60_000]` ms by the chain runner
     * before being honored.
     */
    readonly PauseAfterMs?: number;
    /**
     * Optional flat list of tags (also called "labels" in the UI). Used by
     * the bulk-actions context menu to group/categorise events. Persisted
     * as-is by `updateEvent`. Older persisted events without this field
     * are treated as tag-less.
     */
    readonly Tags?: readonly string[];
    /**
     * Optional single category. Mirrors the `Prompts.Category` field in the
     * SQLite bundle contract: a single denormalised string, NOT a flat list
     * — keeps the runtime model simple while still letting the bulk UI
     * group events by a primary bucket. Empty string and undefined both
     * mean "uncategorised".
     */
    readonly Category?: string;
}

export interface UseKeywordEventsApi {
    readonly events: readonly KeywordEvent[];
    readonly addEvent: (keyword: string, description?: string) => string;
    readonly removeEvent: (id: string) => void;
    readonly updateEvent: (id: string, patch: Partial<Omit<KeywordEvent, "Id">>) => void;
    readonly addStep: (eventId: string, step: Omit<KeywordEventStep, "Id">) => void;
    readonly removeStep: (eventId: string, stepId: string) => void;
    readonly moveStep: (eventId: string, stepId: string, direction: "up" | "down") => void;
    /**
     * Bulk delete a set of steps inside a single event. No-op when the id list
     * is empty or none of the ids resolve. Kept event-scoped so the right-click
     * menu can never accidentally drop steps from a sibling event.
     */
    readonly removeSteps: (eventId: string, stepIds: readonly string[]) => void;
    /**
     * Bulk set the `Enabled` flag on a set of steps. Pass `true` to enable
     * (clears the field — absent means enabled), `false` to mark them
     * skipped at playback time.
     */
    readonly setStepsEnabled: (eventId: string, stepIds: readonly string[], enabled: boolean) => void;
    /**
     * Bulk overwrite each step's `Label` with the provided ordered list. The
     * caller is responsible for matching `labels[i]` to `stepIds[i]`. Skips
     * any id that does not resolve in the event so a stale selection cannot
     * corrupt the list.
     */
    readonly relabelSteps: (eventId: string, stepIds: readonly string[], labels: readonly string[]) => void;
    /**
     * Reorder the persisted events list. `fromId` is the event being dragged,
     * `toId` is the event it was dropped onto. Both ids must reference
     * existing events; otherwise the call is a no-op so a stale drag from a
     * concurrently-removed row cannot corrupt the list.
     */
    readonly reorderEvents: (fromId: string, toId: string) => void;
}

const newId = (): string =>
    (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `ke_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function load(): KeywordEvent[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((e): e is KeywordEvent =>
            !!e && typeof e === "object" && typeof (e as KeywordEvent).Id === "string",
        );
    } catch (caught) {
        logError("useKeywordEvents.load", `localStorage read/parse failed for key "${STORAGE_KEY}" — returning empty event list`, caught);
        return [];
    }
}

function save(events: readonly KeywordEvent[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch (caught) {
        logError("useKeywordEvents.save", `localStorage write failed for key "${STORAGE_KEY}" (quota exceeded or SSR) — events not persisted`, caught);
    }
}

// eslint-disable-next-line max-lines-per-function -- single hook owns the full event+step API surface
export function useKeywordEvents(): UseKeywordEventsApi {
    const [events, setEvents] = useState<readonly KeywordEvent[]>(() => load());

    useEffect(() => { save(events); }, [events]);

    const addEvent = useCallback((keyword: string, description = ""): string => {
        const id = newId();
        const next: KeywordEvent = {
            Id: id,
            Keyword: keyword.trim() || "untitled",
            Description: description,
            Steps: [],
            Enabled: true,
            Target: DEFAULT_KEYWORD_EVENT_TARGET,
        };
        setEvents(prev => [...prev, next]);
        return id;
    }, []);

    const removeEvent = useCallback((id: string) => {
        setEvents(prev => prev.filter(e => e.Id !== id));
    }, []);

    const updateEvent = useCallback((id: string, patch: Partial<Omit<KeywordEvent, "Id">>) => {
        setEvents(prev => prev.map(e => e.Id === id ? { ...e, ...patch } : e));
    }, []);

    const addStep = useCallback((eventId: string, step: Omit<KeywordEventStep, "Id">) => {
        const withId = { ...step, Id: newId() } as KeywordEventStep;
        setEvents(prev => prev.map(e =>
            e.Id === eventId ? { ...e, Steps: [...e.Steps, withId] } : e,
        ));
    }, []);

    const removeStep = useCallback((eventId: string, stepId: string) => {
        setEvents(prev => prev.map(e =>
            e.Id === eventId ? { ...e, Steps: e.Steps.filter(s => s.Id !== stepId) } : e,
        ));
    }, []);

    const moveStep = useCallback((eventId: string, stepId: string, direction: "up" | "down") => {
        setEvents(prev => prev.map(e => {
            if (e.Id !== eventId) return e;
            const idx = e.Steps.findIndex(s => s.Id === stepId);
            if (idx < 0) return e;
            const target = direction === "up" ? idx - 1 : idx + 1;
            if (target < 0 || target >= e.Steps.length) return e;
            const copy = [...e.Steps];
            const [moved] = copy.splice(idx, 1);
            copy.splice(target, 0, moved);
            return { ...e, Steps: copy };
        }));
    }, []);

    const removeSteps = useCallback((eventId: string, stepIds: readonly string[]) => {
        if (stepIds.length === 0) return;
        const drop = new Set(stepIds);
        setEvents(prev => prev.map(e =>
            e.Id === eventId ? { ...e, Steps: e.Steps.filter(s => !drop.has(s.Id)) } : e,
        ));
    }, []);

    const setStepsEnabled = useCallback(
        (eventId: string, stepIds: readonly string[], enabled: boolean) => {
            if (stepIds.length === 0) return;
            const target = new Set(stepIds);
            setEvents(prev => prev.map(e => {
                if (e.Id !== eventId) return e;
                return {
                    ...e,
                    Steps: e.Steps.map(s => {
                        if (!target.has(s.Id)) return s;
                        // `Enabled === undefined` already means enabled, so when
                        // enabling we strip the field to keep persisted JSON tidy.
                        if (enabled) {
                            const { Enabled: _drop, ...rest } = s as KeywordEventStep & { Enabled?: boolean };
                            void _drop;
                            return rest as KeywordEventStep;
                        }
                        return { ...s, Enabled: false } as KeywordEventStep;
                    }),
                };
            }));
        },
        [],
    );

    const relabelSteps = useCallback(
        (eventId: string, stepIds: readonly string[], labels: readonly string[]) => {
            if (stepIds.length === 0) return;
            const labelById = new Map<string, string>();
            stepIds.forEach((id, i) => { labelById.set(id, labels[i] ?? ""); });
            setEvents(prev => prev.map(e => {
                if (e.Id !== eventId) return e;
                return {
                    ...e,
                    Steps: e.Steps.map(s => {
                        const next = labelById.get(s.Id);
                        if (next === undefined) return s;
                        const trimmed = next.trim();
                        if (trimmed.length === 0) {
                            const { Label: _drop, ...rest } = s as KeywordEventStep & { Label?: string };
                            void _drop;
                            return rest as KeywordEventStep;
                        }
                        return { ...s, Label: trimmed } as KeywordEventStep;
                    }),
                };
            }));
        },
        [],
    );

    const reorderEvents = useCallback((fromId: string, toId: string) => {
        if (fromId === toId) { return; }
        setEvents(prev => {
            const fromIdx = prev.findIndex(e => e.Id === fromId);
            const toIdx = prev.findIndex(e => e.Id === toId);
            if (fromIdx < 0 || toIdx < 0) { return prev; }
            const next = [...prev];
            const [moved] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, moved);
            return next;
        });
    }, []);

    return {
        events, addEvent, removeEvent, updateEvent,
        addStep, removeStep, moveStep,
        removeSteps, setStepsEnabled, relabelSteps,
        reorderEvents,
    };
}
