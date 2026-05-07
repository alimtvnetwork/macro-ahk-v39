/**
 * Payment Banner Hider — Standalone Script
 *
 * Auto-injects on lovable.dev/* pages and hides the sticky "Payment
 * issue detected." banner via a CSS3 transition declared in
 * css/payment-banner-hider.css.
 *
 * Design (per 2026-04-24 RCA — Issue 98):
 *  - Single class entry point with injected BannerLocator dependency.
 *  - State machine driven by the BannerState enum (no magic strings).
 *  - All CSS lives in a sibling .css file referenced from instruction.ts.
 *  - Specificity comes from [data-marco-banner-hider]; no force-overrides.
 *  - Catches log via Logger.error and rethrow; nothing is swallowed.
 *  - No requestAnimationFrame — the CSS transition handles timing.
 */

import "./globals.d";
import { BannerLocator } from "./banner-locator";
import {
    BannerState,
    OBSERVER_DEBOUNCE_MS,
    REMOVE_DELAY_MS,
    STATE_ATTR,
    type PaymentBannerHiderApi,
} from "./types";

const VERSION = "2.233.0";

export class PaymentBannerHider implements PaymentBannerHiderApi {
    public readonly version = VERSION;

    private readonly locator: BannerLocator;
    private observer: MutationObserver | null = null;
    private debounceTimer: number | null = null;

    public constructor(locator: BannerLocator = new BannerLocator()) {
        this.locator = locator;
    }

    /** Boot the script: do an initial pass, then start the observer. */
    public start(): void {
        this.check();

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                this.check();
                this.startObserver();
            });

            return;
        }

        this.startObserver();
    }

    /** Public single-pass entry — also exposed as window.PaymentBannerHider.check(). */
    public check(): void {
        try {
            const target = this.locator.locate();

            if (target === null) {
                return;
            }

            if (target.getAttribute(STATE_ATTR) !== null) {
                return;
            }

            this.hide(target);
        } catch (caught) {
            this.logError("PaymentBannerHider.check", "Detection pass failed", caught);

            throw caught;
        }
    }

    /** Drive the banner through fading → hiding → done states. */
    private hide(el: HTMLElement): void {
        el.setAttribute(STATE_ATTR, BannerState.Fading);

        // The class change above primes the CSS transition declared
        // in css/payment-banner-hider.css; setting the next state in
        // a microtask is enough — no requestAnimationFrame needed.
        queueMicrotask(() => {
            el.setAttribute(STATE_ATTR, BannerState.Hiding);
        });

        window.setTimeout(() => {
            el.setAttribute(STATE_ATTR, BannerState.Done);
            // Banner is fully hidden; observer is no longer needed.
            this.stopObserver();
        }, REMOVE_DELAY_MS);
    }

    /** Watch for SPA re-renders that re-introduce the banner. */
    private startObserver(): void {
        if (this.observer !== null) {
            return;
        }

        if (typeof MutationObserver === "undefined") {
            return;
        }

        const root = document.body ?? document.documentElement;
        this.observer = new MutationObserver(() => {
            this.scheduleCheck();
        });
        this.observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    /** Disconnect the observer and clear any pending debounced check. */
    private stopObserver(): void {
        if (this.observer !== null) {
            this.observer.disconnect();
            this.observer = null;
        }

        if (this.debounceTimer !== null) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    /** Coalesce burst mutations into a single check() call. */
    private scheduleCheck(): void {
        if (this.debounceTimer !== null) {
            return;
        }

        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = null;
            this.check();
        }, OBSERVER_DEBOUNCE_MS);
    }

    /** Logger.error if available, console.error fallback — never swallow. */
    private logError(fn: string, message: string, error: unknown): void {
        const logger = window.RiseupAsiaMacroExt?.Logger;

        if (logger !== undefined) {
            logger.error(fn, message, error);

            return;
        }

        console.error(`[${fn}] ${message}`, error);
    }
}

const instance = new PaymentBannerHider();
window.PaymentBannerHider = instance;
instance.start();
