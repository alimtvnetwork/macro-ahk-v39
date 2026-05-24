/**
 * Marco Extension — First-Attach Toast
 *
 * When auto-attach matches an origin for the *first time* in this
 * profile, we inject a lightweight in-page toast asking the user
 * whether they want Marco to keep attaching here. The toast has
 * three actions:
 *
 *   • Yes, keep attaching      → just mark origin as seen
 *   • Not now                  → tab-scoped dismiss (this tab only)
 *   • Don't ask for this site  → persistent dismiss + seen
 *
 * The toast posts a `window.postMessage` upward; a tiny script
 * shim listens and forwards via `chrome.runtime.sendMessage` to
 * the background bridge registered here.
 *
 * Restricted URLs (chrome://, chrome-extension:// of other
 * extensions, etc.) are skipped — `chrome.scripting.executeScript`
 * would throw and we'd just log + bail.
 *
 * No retry/backoff. Single attempt, fail-fast.
 *
 * See:
 *   - mem://features/auto-attach-policy (C9, first-attach intent)
 *   - .lovable/audits/ link-click "opens the extension" investigation
 */

import { logCaughtError, BgLogTag } from "./bg-logger";
import { isOriginSeen, markOriginSeen } from "./seen-origins";
import {
    isOriginDismissedForTab,
    dismissOriginForTab,
    persistDismissOrigin,
} from "./dismissed-origins";

const MSG_TYPE = "MARCO_FIRST_ATTACH_ACTION";

type ToastAction = "accept" | "dismiss-tab" | "dismiss-persist";

interface ToastActionMessage {
    type: typeof MSG_TYPE;
    action: ToastAction;
    url: string;
}

function isToastActionMessage(m: unknown): m is ToastActionMessage {
    if (m === null || typeof m !== "object") return false;
    const o = m as Record<string, unknown>;
    return o.type === MSG_TYPE
        && (o.action === "accept" || o.action === "dismiss-tab" || o.action === "dismiss-persist")
        && typeof o.url === "string";
}

/**
 * Renders a Marco-branded toast inside the page. Runs in the page's
 * MAIN world via `chrome.scripting.executeScript`.
 *
 * Self-contained: zero deps, inline styles, dark theme matching the
 * extension. Removes itself after any button click or 30s timeout.
 */
function toastPagePayload(origin: string): void {
    const ID = "marco-first-attach-toast";
    if (document.getElementById(ID)) return;

    const root = document.createElement("div");
    root.id = ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Marco auto-attach prompt");
    root.style.cssText = [
        "position:fixed",
        "bottom:20px",
        "right:20px",
        "z-index:2147483647",
        "max-width:340px",
        "padding:14px 16px",
        "background:#1a1a2e",
        "color:#e8edf3",
        "border:1px solid #2d2d4a",
        "border-radius:10px",
        "box-shadow:0 10px 30px rgba(0,0,0,0.45)",
        "font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Marco attached to this site";
    title.style.cssText = "font-weight:600;margin-bottom:4px;color:#fff";

    const body = document.createElement("div");
    body.textContent = `Keep auto-attaching on ${origin}?`;
    body.style.cssText = "color:#b8c0d0;margin-bottom:10px";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";

    function btn(label: string, action: string, primary: boolean): HTMLButtonElement {
        const b = document.createElement("button");
        b.textContent = label;
        b.dataset.action = action;
        b.style.cssText = [
            "padding:6px 10px",
            "border-radius:6px",
            "border:1px solid " + (primary ? "#4f46e5" : "#3a3a5a"),
            "background:" + (primary ? "#4f46e5" : "transparent"),
            "color:" + (primary ? "#fff" : "#e8edf3"),
            "font-size:12px",
            "cursor:pointer",
        ].join(";");
        return b;
    }

    const yes = btn("Yes, keep", "accept", true);
    const notNow = btn("Not now", "dismiss-tab", false);
    const never = btn("Don't ask for this site", "dismiss-persist", false);

    row.append(yes, notNow, never);
    root.append(title, body, row);
    document.documentElement.appendChild(root);

    function send(action: string): void {
        window.postMessage(
            { type: "MARCO_FIRST_ATTACH_ACTION", action, url: window.location.href },
            window.location.origin,
        );
        root.remove();
    }

    root.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        const a = t?.dataset?.action;
        if (typeof a === "string" && a.length > 0) send(a);
    });

    window.setTimeout(() => { if (root.isConnected) root.remove(); }, 30_000);
}

/**
 * Tiny shim that runs alongside the toast: listens for the
 * window.postMessage from the toast and forwards it as a
 * chrome.runtime.sendMessage so the background bridge can react.
 */
function bridgePagePayload(): void {
    if ((window as unknown as { __marcoToastBridge?: boolean }).__marcoToastBridge) return;
    (window as unknown as { __marcoToastBridge?: boolean }).__marcoToastBridge = true;
    window.addEventListener("message", (e: MessageEvent) => {
        if (e.source !== window) return;
        const d = e.data;
        if (d === null || typeof d !== "object") return;
        const o = d as Record<string, unknown>;
        if (o.type !== "MARCO_FIRST_ATTACH_ACTION") return;
        try {
            chrome.runtime.sendMessage(o);
        } catch {
            /* SW asleep — single attempt, fail-fast */
        }
    });
}

/**
 * Inject the toast + bridge into the tab. Skips if origin already
 * seen, dismissed (tab or persistent), or if scripting fails.
 */
export async function maybeShowFirstAttachToast(
    tabId: number,
    url: string,
): Promise<void> {
    if (isOriginDismissedForTab(tabId, url)) return;
    if (isOriginSeen(url)) return;

    let origin = "";
    try { origin = new URL(url).origin; } catch { return; }
    if (origin === "") return;

    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: toastPagePayload,
            args: [origin],
        });
        await chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: bridgePagePayload,
        });
        // Optimistically mark seen so we don't double-fire on bursts;
        // user can still explicitly dismiss via the toast buttons.
        void markOriginSeen(url);
    } catch (err) {
        // Restricted URLs / closed tabs — log once, no retry.
        logCaughtError(
            BgLogTag.MARCO,
            `[first-attach-toast] inject skipped tab=${tabId} url=${url}`,
            err as Error,
        );
    }
}

/**
 * Register the runtime message bridge that handles toast actions.
 * Call once from boot.
 */
export function registerFirstAttachToastBridge(): void {
    chrome.runtime.onMessage.addListener((msg, sender) => {
        if (!isToastActionMessage(msg)) return false;
        const tabId = sender.tab?.id;
        const url = msg.url;
        if (typeof tabId !== "number") return false;

        if (msg.action === "accept") {
            void markOriginSeen(url);
        } else if (msg.action === "dismiss-tab") {
            dismissOriginForTab(tabId, url);
        } else if (msg.action === "dismiss-persist") {
            void persistDismissOrigin(url);
            void markOriginSeen(url);
        }
        console.log(
            `[first-attach-toast] action=${msg.action} tab=${tabId} url=${url}`,
        );
        return false;
    });
}
