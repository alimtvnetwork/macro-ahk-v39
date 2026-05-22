/**
 * Token Seeder Status Indicator
 *
 * Compact row for the System Status panel that surfaces JWT seed
 * failures on inaccessible tabs and shows a live countdown until the
 * next retry attempt across all blocked tabs.
 *
 * Hides itself when no tabs are currently throttled. Clicking the row
 * toggles an inline expandable details drawer that lists every blocked
 * tab — its tabId, origin URL, classified failure reason, and how many
 * times Chrome has rejected the seed attempt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ShieldOff, Timer, ChevronDown } from "lucide-react";
import { sendMessage } from "@/lib/message-client";
import {
    loadDiagnosticsCache,
    saveDiagnosticsCache,
} from "./token-seeder-diagnostics-cache";

interface InaccessibleSeedTarget {
    tabId: number;
    tabUrl: string;
    reason: string;
    code: string;
    firstFailureAt: number;
    lastFailureAt: number;
    attemptCount: number;
    cooldownMs: number;
}

interface TokenSeederDiagnostics {
    targets: InaccessibleSeedTarget[];
    cooldownMs: number;
    capturedAt: string;
}

const POLL_INTERVAL_MS = 5_000;
const TICK_INTERVAL_MS = 500;

type ErrorCategory = "host-permission" | "scripting-blocked" | "restricted-scheme" | "other";

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
    "host-permission": "Host permission",
    "scripting-blocked": "Scripting blocked",
    "restricted-scheme": "Restricted scheme",
    other: "Other",
};

function categorizeCode(code: string): ErrorCategory {
    switch (code) {
        case "RESPECTIVE_HOST_PERMISSION":
        case "MISSING_HOST_PERMISSION":
        case "NO_HOST_PATTERN":
        case "PERMISSION_NOT_GRANTED":
            return "host-permission";
        case "PAGE_CONTENTS_BLOCKED":
        case "EXTENSIONS_GALLERY_BLOCKED":
        case "GENERIC_CANNOT_SCRIPT":
            return "scripting-blocked";
        case "RESTRICTED_SCHEME":
            return "restricted-scheme";
        default:
            return "other";
    }
}

function formatRemaining(ms: number): string {
    if (ms <= 0) return "ready";
    return `${Math.ceil(ms / 1000)}s`;
}

function formatRetryTimestamp(ts: number): string {
    try {
        return new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kuala_Lumpur",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).format(new Date(ts));
    } catch {
        return new Date(ts).toISOString();
    }
}

function formatOrigin(url: string): string {
    if (!url) return "(unknown)";
    try {
        const u = new URL(url);
        return u.origin;
    } catch {
        return url.length > 48 ? `${url.slice(0, 48)}…` : url;
    }
}

export function TokenSeederStatusIndicator() {
    const [data, setData] = useState<TokenSeederDiagnostics | null>(() => loadDiagnosticsCache());
    const [now, setNow] = useState<number>(() => Date.now());
    const [open, setOpen] = useState<boolean>(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchDiagnostics = useCallback(async () => {
        try {
            const res = await sendMessage<TokenSeederDiagnostics>({
                type: "GET_TOKEN_SEEDER_DIAGNOSTICS",
            });
            setData(res);
            saveDiagnosticsCache(res);
        } catch (caught) {
            logError("TokenSeederStatusIndicator.fetchDiagnostics", "GET_TOKEN_SEEDER_DIAGNOSTICS failed — background may not be ready, will retry on next poll", caught);
        }
    }, []);

    useEffect(() => {
        void fetchDiagnostics();
        pollRef.current = setInterval(() => void fetchDiagnostics(), POLL_INTERVAL_MS);
        tickRef.current = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
            if (tickRef.current) clearInterval(tickRef.current);
        };
    }, [fetchDiagnostics]);

    const targets = data?.targets ?? [];

    const { nextRetryMs, nextRetryAt } = useMemo(() => {
        if (targets.length === 0) return { nextRetryMs: 0, nextRetryAt: 0 };
        let minRemaining = Number.POSITIVE_INFINITY;
        let minRetryAt = 0;
        for (const t of targets) {
            const retryAt = t.lastFailureAt + t.cooldownMs;
            const remaining = Math.max(0, retryAt - now);
            if (remaining < minRemaining) {
                minRemaining = remaining;
                minRetryAt = retryAt;
            }
        }
        return {
            nextRetryMs: minRemaining === Number.POSITIVE_INFINITY ? 0 : minRemaining,
            nextRetryAt: minRetryAt,
        };
    }, [targets, now]);

    const categoryCounts = useMemo(() => {
        const counts = new Map<ErrorCategory, number>();
        for (const t of targets) {
            const cat = categorizeCode(t.code);
            counts.set(cat, (counts.get(cat) ?? 0) + 1);
        }
        return counts;
    }, [targets]);

    if (targets.length === 0) {
        return null;
    }

    const isReady = nextRetryMs <= 0;

    const categorySummary = Array.from(categoryCounts.entries())
        .map(([cat, count]) => `${CATEGORY_LABELS[cat]}: ${count}`)
        .join(" · ");

    const retryLine = isReady
        ? "Retrying on next poll."
        : `Next retry at ${formatRetryTimestamp(nextRetryAt)} MYT (in ${formatRemaining(nextRetryMs)}).`;

    const tooltip =
        `${targets.length} tab(s) blocked Chrome scripting access.\n` +
        `Categories — ${categorySummary || "Unknown"}.\n` +
        `${retryLine}\n` +
        `Click to view per-tab details.`;

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-left transition-colors hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={tooltip}
                    aria-label="Toggle token seeder failure details"
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <ShieldOff className="h-4 w-4 text-warning shrink-0" />
                        <span className="text-sm">Token Seed Blocked</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                            {targets.length} tab{targets.length === 1 ? "" : "s"}
                        </Badge>
                        <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                            <Timer className="h-3 w-3" />
                            {isReady ? "retrying…" : `retry in ${formatRemaining(nextRetryMs)}`}
                        </span>
                        <ChevronDown
                            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                        />
                    </div>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="mt-2 rounded-md border border-warning/30 bg-background/40">
                    <ul
                        className="divide-y divide-border max-h-64 overflow-y-auto"
                        aria-label="Blocked tabs"
                    >
                        {targets.map((t) => {
                            const remaining = Math.max(0, t.cooldownMs - (now - t.lastFailureAt));
                            return (
                                <li
                                    key={t.tabId}
                                    className="px-3 py-2 text-xs space-y-1"
                                    data-tab-id={t.tabId}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-muted-foreground">
                                            tab #{t.tabId}
                                        </span>
                                        <Badge variant="outline" className="text-[10px]">
                                            {t.attemptCount} attempt{t.attemptCount === 1 ? "" : "s"}
                                        </Badge>
                                    </div>
                                    <div
                                        className="truncate text-foreground"
                                        title={t.tabUrl || "(unknown)"}
                                    >
                                        {formatOrigin(t.tabUrl)}
                                    </div>
                                    <div
                                        className="text-warning/90 break-words"
                                        title={t.reason}
                                    >
                                        <span className="font-mono text-[10px] uppercase tracking-wide text-warning">
                                            {t.code}
                                        </span>
                                        <span className="mx-1 text-muted-foreground">·</span>
                                        <span>{t.reason}</span>
                                    </div>
                                    <div className="flex items-center justify-end text-[10px] font-mono text-muted-foreground">
                                        {remaining <= 0
                                            ? "ready to retry"
                                            : `next retry in ${formatRemaining(remaining)}`}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

export default TokenSeederStatusIndicator;
