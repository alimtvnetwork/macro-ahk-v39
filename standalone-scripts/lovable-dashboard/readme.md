# lovable-dashboard

Auto-injected standalone project for the Lovable.dev dashboard home screen.

- **Target URL**: `https://lovable.dev/dashboard` (exact match only — no
  glob, no path prefix, no trailing slash variant).
- **World**: MAIN
- **Run at**: document_idle
- **Auto-inject**: yes

This project hosts the home-screen experience that previously lived inside
`src/content-scripts/home-screen/` and was bundled into the
`macro-controller` extension entry. It now ships as a separate auto-injected
script, gated by the exact dashboard URL via the standard auto-injector
pipeline.

## Why exact match

The home-screen mutates the dashboard layout (search bar replacement, nav
controls, credit panel). Earlier `ROOT` / `ROOT_SLASH` variants were dropped
per the user directive ("It should be only the dashboard from now on") to
prevent unwanted activation on `/` or other lovable.dev pages.

## Layout

```
standalone-scripts/lovable-dashboard/
├── info.json              # Marketplace metadata
├── readme.md              # this file
└── src/
    ├── instruction.ts     # PascalCase manifest (auto-inject + exact URL)
    ├── index.ts           # IIFE entry — boots the home-screen
    └── ...                # moved from src/content-scripts/home-screen/
```
