# 02 — URL Activation Guard

**Coding rules:** see file 10. File ≤ 100 lines. Function ≤ 8 lines. No magic strings. Enums first.

## Enum (mandatory, no magic strings)

```ts
export enum AllowedHomeUrl {
    DASHBOARD = "https://lovable.dev/dashboard",
}
```

Confirmed by user (supersedes earlier 3-URL variant): **only** the exact
`/dashboard` URL must activate. `ROOT` and `ROOT_SLASH` were removed because
activation on the bare origin caused unwanted mutations on non-dashboard
pages. Any change here is a behavior change — update this spec first, then
`standalone-scripts/lovable-dashboard/src/allowed-home-url.enum.ts`.

## Guard contract

- Compare `window.location.href` **exactly** against every `AllowedHomeUrl` value.
- No normalization, no `startsWith`, no regex.
- If no match → exit silently: do not mount UI, do not bind handlers, do not scrape.

## Reference implementation (≤ 8-line functions)

```ts
import { AllowedHomeUrl } from "./allowed-home-url.enum";

function getAllowedUrls(): readonly string[] {
    return Object.values(AllowedHomeUrl);
}

export function isHomeUrlAllowed(href: string): boolean {
    return getAllowedUrls().includes(href);
}

export function shouldActivateHomeScreen(): boolean {
    try {
        return isHomeUrlAllowed(window.location.href);
    } catch (caught) {
        logGuardFailure(caught);
        return false;
    }
}
```

`logGuardFailure` MUST call `RiseupAsiaMacroExt.Logger.error("HomeScreenGuard", ...)`.

## Negative-`if` policy

Use early-return on the positive condition only. Example:

```ts
export function activateHomeScreen(): void {
    if (shouldActivateHomeScreen()) {
        mountHomeScreenFeatures();
        return;
    }
}
```

Do **not** write `if (!shouldActivateHomeScreen())`.

## Re-evaluation

Re-run `shouldActivateHomeScreen()` on:

1. Initial content-script load.
2. SPA navigation events (Lovable is a React SPA — listen to `popstate` and patch `pushState` / `replaceState` once at boot).
3. URL hash changes are NOT a trigger (hash never appears in allowed values).

If the URL leaves the allowed set after activation, call `unmountHomeScreenFeatures()` to remove all injected nodes and detach handlers.

## Acceptance

1. On `https://lovable.dev/dashboard` → activates.
2. On `https://lovable.dev/` → does NOT activate.
3. On `https://lovable.dev` → does NOT activate.
4. On `https://lovable.dev/projects/abc` → does NOT activate.
5. On `https://lovable.dev/dashboard?x=1` → does NOT activate (exact match).
6. SPA navigation away from `/dashboard` unmounts the UI.
