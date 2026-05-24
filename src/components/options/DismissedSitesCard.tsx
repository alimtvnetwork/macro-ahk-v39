/**
 * DismissedSitesCard — Options panel for the C9 auto-attach gate.
 *
 * Lets users review and revoke origins they have dismissed via the
 * (future) first-attach toast. Reads from `marco_dismissed_origins` in
 * `chrome.storage.local` through `dismissed-origins.ts` and calls
 * `unpersistDismissOrigin` on click.
 *
 * See: mem://features/auto-attach-policy (C9)
 */

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import {
    listPersistedDismissedOrigins,
    unpersistDismissOrigin,
} from "@/background/dismissed-origins";
import { logError } from "./options-logger";

export function DismissedSitesCard() {
    const [origins, setOrigins] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const list = await listPersistedDismissedOrigins();
            setOrigins(list);
        } catch (err) {
            logError("DismissedSitesCard", "refresh failed", err);
            toast.error("Failed to load dismissed sites");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const onForget = useCallback(
        async (origin: string) => {
            setPending(origin);
            try {
                await unpersistDismissOrigin(origin);
                setOrigins((prev) => prev.filter((o) => o !== origin));
                toast.success(`Re-enabled auto-attach for ${origin}`);
            } catch (err) {
                logError(`DismissedSitesCard.unpersist ${origin}`, err);
                toast.error(`Failed to forget ${origin}`);
            } finally {
                setPending(null);
            }
        },
        [],
    );

    const hasOrigins = origins.length > 0;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    Sites where you chose <span className="font-medium">"Don't ask for this site"</span> in the auto-attach prompt. Removing a site re-enables the prompt next time you visit it.
                </p>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void refresh()}
                    disabled={loading}
                    aria-label="Refresh dismissed sites"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
            </div>

            {loading && origins.length === 0 ? (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
                    Loading…
                </div>
            ) : !hasOrigins ? (
                <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                    <ShieldOff className="h-5 w-5 opacity-60" />
                    No sites dismissed. Auto-attach will prompt on first visit to any matching project URL.
                </div>
            ) : (
                <ul className="divide-y divide-border rounded-md border border-border bg-background">
                    {origins.map((origin) => (
                        <li
                            key={origin}
                            className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                            <code className="text-sm font-mono text-foreground truncate">
                                {origin}
                            </code>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void onForget(origin)}
                                disabled={pending === origin}
                                aria-label={`Forget ${origin}`}
                            >
                                <Trash2 className="h-4 w-4" />
                                <span className="ml-1.5">Forget</span>
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
