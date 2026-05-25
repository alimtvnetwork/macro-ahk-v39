import { useEffect, useState, useCallback } from "react";
import { AlertOctagon, Copy, Check, X } from "lucide-react";
import { HTTP_FAIL_FAST_EVENT, type HttpFailFastEventDetail } from "@/shared/http-fail-fast";

/**
 * Dismissible global banner that surfaces the most recent
 * `HttpFailFastError` (HEFF) emitted anywhere in the UI layer.
 *
 * Wiring contract (Step 7 of the HEFF rollout):
 *  - `HttpFailFastError` constructor dispatches a `marco:http-fail-fast`
 *    window CustomEvent with the full report string.
 *  - This banner listens for that event and renders the latest failure
 *    until the user dismisses it. Newer failures replace older ones so
 *    the banner never stacks indefinitely.
 *  - Mount once near the root of each UI surface (Options, Popup).
 *
 * Honors the project's no-retry / fail-fast policy: the banner does NOT
 * offer a "Retry" button — only "Copy report" + dismiss.
 */
export function HttpFailFastBanner() {
    const [detail, setDetail] = useState<HttpFailFastEventDetail | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const onEvent = (evt: Event): void => {
            const ce = evt as CustomEvent<HttpFailFastEventDetail>;
            if (ce.detail === null || ce.detail === undefined) return;
            setDetail(ce.detail);
            setCopied(false);
        };
        window.addEventListener(HTTP_FAIL_FAST_EVENT, onEvent);
        return () => window.removeEventListener(HTTP_FAIL_FAST_EVENT, onEvent);
    }, []);

    const handleCopy = useCallback(async () => {
        if (detail === null) return;
        try {
            await navigator.clipboard.writeText(detail.report);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        // allow-swallow: clipboard denied; user can select text manually
        } catch { /* intentionally empty */ }
    }, [detail]);

    if (detail === null) return null;

    const shortUrl = detail.url.length > 80 ? detail.url.slice(0, 77) + "…" : detail.url;

    return (
        <div
            role="alert"
            aria-live="assertive"
            className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] w-[min(680px,calc(100vw-1rem))] rounded-md border border-destructive/50 bg-destructive/10 backdrop-blur-md px-3 py-2.5 shadow-lg"
        >
            <div className="flex items-start gap-2">
                <AlertOctagon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-destructive">
                        HTTP {detail.status} on {detail.method}
                        <span className="ml-1 font-mono font-normal break-all">{shortUrl}</span>
                    </p>
                    <p className="text-[11px] text-destructive/90 mt-0.5 break-words">
                        {detail.reason}
                    </p>
                    {detail.bodySnippet !== null && detail.bodySnippet.length > 0 ? (
                        <pre className="mt-1 text-[10px] font-mono text-destructive/80 bg-background/40 rounded p-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words border border-destructive/20">
                            {detail.bodySnippet}
                        </pre>
                    ) : null}
                </div>
                <div className="shrink-0 flex items-center gap-1">
                    <button
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-destructive/40 hover:bg-destructive/20 text-destructive transition-colors"
                        title="Copy full HEFF report to clipboard"
                    >
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied ? "Copied" : "Copy"}
                    </button>
                    <button
                        onClick={() => setDetail(null)}
                        className="inline-flex items-center justify-center h-6 w-6 rounded border border-destructive/40 hover:bg-destructive/20 text-destructive transition-colors"
                        title="Dismiss"
                        aria-label="Dismiss HTTP fail-fast banner"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default HttpFailFastBanner;
