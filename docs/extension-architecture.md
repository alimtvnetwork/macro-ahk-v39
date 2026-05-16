# Marco Chrome Extension — Operator Architecture Reference

> **Audience:** Operators, reviewers, future maintainers.
> **Purpose:** A single document combining the live `manifest.json`, the permission validator's current output, and the content-script injection strategy audit. Read this before approving any permission change, content-script change, or Chrome Web Store submission.
> **Generated from:** `manifest.json` (v2.170.0), `scripts/check-manifest-permissions.mjs`, `spec/21-app/02-features/chrome-extension/91-content-script-injection-strategy-audit.md`.
> **Last updated:** 2026-04-20

---

## Table of contents

1. [At-a-glance summary](#1-at-a-glance-summary)
2. [Manifest declarations](#2-manifest-declarations)
3. [Permissions — what each one does and why we need it](#3-permissions--what-each-one-does-and-why-we-need-it)
4. [Live permission validator output](#4-live-permission-validator-output)
5. [Content-script injection strategy](#5-content-script-injection-strategy)
6. [Web-accessible resources](#6-web-accessible-resources)
7. [Keyboard commands](#7-keyboard-commands)
8. [Build-time validation pipeline](#8-build-time-validation-pipeline)
9. [Change checklist](#9-change-checklist)
10. [Cross-references](#10-cross-references)
11. [Companion repositories](#11-companion-repositories)

---

## 1. At-a-glance summary

| Field | Value |
|---|---|
| **Manifest version** | 3 (V2 is rejected by the Chrome Web Store) |
| **Extension version** | 2.170.0 |
| **Background** | Service worker (ES module) — `background/index.js` |
| **Permissions** | 9 declared (`storage`, `tabs`, `activeTab`, `scripting`, `cookies`, `webNavigation`, `alarms`, `contextMenus`, `unlimitedStorage`) |
| **Host permissions** | `<all_urls>` — required because the user can target any chat/automation site |
| **Static content scripts** | 1 (`message-relay.js` only) |
| **Dynamic content scripts** | 3 (`prompt-injector.js`, `xpath-recorder.js`, `network-reporter.js`) — injected on demand via `chrome.scripting.executeScript` |
| **Web-accessible resources** | 9 entries (WASM, prompts, project assets, the 3 dynamic content scripts) |
| **Keyboard commands** | 2 (`run-scripts`, `force-run-scripts`) |
| **Validators** | `scripts/check-manifest-version.mjs` + `scripts/check-manifest-permissions.mjs` — both run on every `pnpm run build:extension` and inside `Build-Extension` in the PowerShell pipeline |

---

## 2. Manifest declarations

The current `manifest.json` (top-level fields only — see the live file for the source of truth):

```json
{
    "manifest_version": 3,
    "name": "Marco Macro Extension",
    "version": "2.170.0",
    "description": "Riseup Asia Marco — macro automation, XPath recording, and prompt management.",
    "permissions": [
        "storage", "tabs", "activeTab", "scripting", "cookies",
        "webNavigation", "alarms", "contextMenus", "unlimitedStorage"
    ],
    "host_permissions": ["<all_urls>"],
    "background": { "service_worker": "background/index.js", "type": "module" },
    "action": {
        "default_popup": "src/popup/popup.html",
        "default_title": "Marco",
        "default_icon": { "16": "favicon.png", "48": "favicon.png", "128": "favicon.png" }
    },
    "icons": { "16": "favicon.png", "48": "favicon.png", "128": "favicon.png" },
    "options_page": "src/options/options.html",
    "content_scripts": [
        {
            "matches": ["<all_urls>"],
            "js": ["content-scripts/message-relay.js"],
            "run_at": "document_start",
            "all_frames": false
        }
    ],
    "commands": { "run-scripts": { ... }, "force-run-scripts": { ... } },
    "web_accessible_resources": [
        {
            "resources": [
                "wasm/sql-wasm.wasm", "build-meta.json",
                "prompts/macro-prompts.json", "projects/seed-manifest.json",
                "projects/scripts/*/*",
                "content-scripts/xpath-recorder.js",
                "content-scripts/network-reporter.js",
                "content-scripts/prompt-injector.js"
            ],
            "matches": ["<all_urls>"]
        }
    ]
}
```

---

## 3. Permissions — what each one does and why we need it

Every entry below is justified by an actual `chrome.<api>` call in `src/`. Permissions without detectable namespaces (`activeTab`, `unlimitedStorage`) are documented as policy decisions.

| Permission | Chrome API used | Where in `src/` | Why we need it |
|---|---|---|---|
| `storage` | `chrome.storage.{local,sync,session}` | `bg-logger.ts`, `prompt-chain-handler.ts`, all settings handlers | Persistent state: prompt cache, projects, configs, session args handoff |
| `tabs` | `chrome.tabs.query`, `chrome.tabs.sendMessage` | `prompt-chain-handler.ts`, `xpath-handler.ts`, popup | Locate the active tab to inject into and post messages |
| `activeTab` | (no namespace — granted on user gesture) | implicit | Lets `chrome.scripting.executeScript` target the focused tab without a host-permission grant prompt for that one tab |
| `scripting` | `chrome.scripting.executeScript({ files \| func })` | `prompt-chain-handler.ts`, `xpath-handler.ts`, dynamic content-script injection | The single mechanism for ALL three dynamic content scripts |
| `cookies` | `chrome.cookies.get` | `auth-bridge` token retrieval | Read the bearer token from the user's Marco web session cookie |
| `webNavigation` | `chrome.webNavigation.onCommitted` etc. | `injection-lifecycle.ts` | Detect SPA navigation so we can re-inject user scripts after route changes |
| `alarms` | `chrome.alarms.create`, `chrome.alarms.onAlarm` | log pruning, token refresh scheduler | Periodic background work that survives service-worker suspension |
| `contextMenus` | `chrome.contextMenus.create`, `chrome.contextMenus.onClicked` | `context-menu-handler.ts` | Right-click "Run Marco scripts" / "Stop XPath recorder" entries |
| `unlimitedStorage` | (no namespace — quota lift) | SQLite OPFS log store | Allows the SQLite log database (`mem://architecture/session-logging-system`) to exceed the default ~5 MB quota |

### Host permissions

| Pattern | Why |
|---|---|
| `<all_urls>` | The user chooses which site to automate — any chat surface (ChatGPT, Claude, Gemini, custom) plus arbitrary internal tools. Narrowing this list would require user re-authorization on every new target. The privacy boundary is enforced by **dynamic injection** of the sensitive content scripts (see §5), NOT by host narrowing. |

---

## 4. Live permission validator output

Run on demand:

```bash
node scripts/check-manifest-permissions.mjs
```

**Current output (run 2026-04-20 against v2.170.0):**

```
[OK] Manifest permissions validated: 9 declared, 7 chrome.* API namespaces used
     (alarms, contextMenus, cookies, scripting, storage, tabs, webNavigation)
```

**What the validator checks:**

1. **Used → Declared** — every `chrome.<namespace>.…` call found in `src/**/*.{ts,tsx}` (with comments and string-literal contents stripped) maps to a permission listed in `manifest.json` `permissions[]`. A miss is a **hard failure** — the build aborts.
2. **Declared → Used** — every permission in `manifest.json` `permissions[]` either:
   - Has a corresponding `chrome.<namespace>` call in `src/`, **or**
   - Is on the soft-allowlist (`activeTab`, `unlimitedStorage`, `background`) — these have no detectable namespace because they are policy/quota grants. An unused declared permission is a **hard failure** to keep our Chrome Web Store review surface small.
3. The validator runs **before** Vite in `pnpm run build:extension` and inside the PowerShell `Build-Extension` job (`scripts/ps-modules/preflight.ps1` → `Invoke-ManifestPermissionCheck`).

The 2-permission gap (9 declared − 7 detected = 2) is exactly `activeTab` + `unlimitedStorage`, which is the expected steady state.

A second validator (`scripts/check-manifest-version.mjs`) runs alongside it and confirms `manifest.json` exists and its `version` matches `EXTENSION_VERSION` from `src/shared/constants.ts`.

---

## 5. Content-script injection strategy

The extension declares **only one** content script statically. The other three are injected on demand. This split is intentional and security-driven.

### Decision matrix

| Question | Answer = Static (`content_scripts`) | Answer = Dynamic (`chrome.scripting`) |
|---|---|---|
| Must run at `document_start`? | ✅ | ❌ (any timing works) |
| Required on every page the user visits? | ✅ | ❌ (only when feature is activated) |
| Pure observer (no monkey-patching of native APIs)? | ✅ | ❌ (mutates page state) |
| User has explicitly opted in (clicked a button, chose "record")? | ❌ | ✅ |

### The four scripts

| Script | Manifest `content_scripts`? | How it reaches the page | Why this design |
|---|---|---|---|
| **`message-relay.js`** | ✅ YES | Static declaration, `run_at: document_start`, top frame only | Must exist on every page from the very first byte to bridge `window.postMessage` ↔ `chrome.runtime.sendMessage`. Static declaration is the only way to guarantee `document_start` timing. Pure forwarder — no DOM listeners, no API patching. |
| **`prompt-injector.js`** | ❌ NO | `chrome.scripting.executeScript({ files: ["content-scripts/prompt-injector.js"] })` from `prompt-chain-handler.ts` (v2.170.0+) | Runs **on demand** only when the user clicks "Run Chain". Args handed off via `chrome.storage.session.marco_prompt_args[<correlationId>]`; result posted back via `chrome.runtime.sendMessage({ type: "PROMPT_INJECT_RESULT", correlationId, ... })` with a 10s one-shot listener and timeout. |
| **`xpath-recorder.js`** | ❌ NO | `chrome.scripting.executeScript({ files: [...] })` from `xpath-handler.ts → startRecording()` | Runs **on demand** only when the user toggles XPath recording. Static injection on every page would attach `click` listeners on **every** site — privacy-hostile. |
| **`network-reporter.js`** | ❌ NO | `chrome.scripting.executeScript({ files: [...] })` (currently bundled but not yet auto-injected) | Monkey-patches `XMLHttpRequest.prototype.open/send` and `window.fetch`. Forcing this on every page would corrupt every site's network stack permanently for the session. Must be opt-in per-tab. |

### What would break if we made the dynamic scripts static?

| Script | Symptom of moving to static `content_scripts` |
|---|---|
| `prompt-injector` | Wasted JS payload in every page load. Cannot return injection result to background — the entire chain feature would need re-architecting through round-trip messaging anyway. |
| `xpath-recorder` | Every site the user visits gets a global click listener — Chrome Web Store flags this as covert tracking and rejects the extension. |
| `network-reporter` | Every site's `XMLHttpRequest` and `fetch` are monkey-patched. Banks, OAuth flows, and anti-bot vendors (Cloudflare, hCaptcha, Akamai) refuse to load. Extension becomes unusable. |

### Why `message-relay.js` IS static

```json
{
    "matches": ["<all_urls>"],
    "js": ["content-scripts/message-relay.js"],
    "run_at": "document_start",
    "all_frames": false
}
```

Reasons:
1. **`document_start` requirement** — must establish the `window.postMessage` listener before any user script (injected later by `chrome.scripting.executeScript({ world: "MAIN" })`) tries to send messages. Dynamic injection cannot guarantee this ordering.
2. **Universal need** — every Marco-injected user script (macro-looping, custom project scripts, SDK calls) talks through this relay.
3. **Pure forwarder** — only listens for messages with the magic source string (`marco-controller`, `marco-sdk`, `marco-extension`); does not modify any page state, attach DOM listeners, or patch native APIs.
4. **Top-frame only (`all_frames: false`)** — sandboxed iframes don't run user scripts, so the relay is unnecessary there.

---

## 6. Web-accessible resources

| Resource | Consumer | Purpose |
|---|---|---|
| `wasm/sql-wasm.wasm` | background SQLite | Loaded by `sql.js` for the log store |
| `build-meta.json` | injection cache | Build hash for cache invalidation (see `mem://architecture/injection-cache-management`) |
| `prompts/macro-prompts.json` | popup prompt cache | Initial prompt seed |
| `projects/seed-manifest.json` | first-run seeding | Declarative seed manifest |
| `projects/scripts/*/*` | seeded user scripts | Built-in scripts shipped with the extension |
| `content-scripts/xpath-recorder.js` | `chrome.scripting.executeScript({ files })` | Dynamic injection (see §5) |
| `content-scripts/network-reporter.js` | `chrome.scripting.executeScript({ files })` | Dynamic injection (see §5) |
| `content-scripts/prompt-injector.js` | `chrome.scripting.executeScript({ files })` | Dynamic injection (see §5) — newly wired in v2.170.0 |

All entries match `<all_urls>` because Marco can target any user-chosen site.

---

## 7. Keyboard commands

| Command id | Default shortcut (Win/Linux) | Default shortcut (Mac) | Action |
|---|---|---|---|
| `run-scripts` | `Ctrl+Shift+Down` | `Command+Shift+Down` | Run the active project's scripts in the current tab |
| `force-run-scripts` | `Ctrl+Shift+Up` | `Command+Shift+Up` | Force re-run scripts, bypassing the idempotency cache |

Handled by `src/background/handlers/shortcut-command-handler.ts`. Users can rebind both shortcuts at `chrome://extensions/shortcuts`.

---

## 8. Build-time validation pipeline

Two manifest-related checks gate every extension build (both `pnpm run build:extension` and the PowerShell `Build-Extension` job):

```
1. check-manifest-version.mjs       — manifest exists + version matches EXTENSION_VERSION + valid Chrome MV3 version syntax
2. check-manifest-permissions.mjs   — used Chrome APIs ⊆ declared permissions, AND declared permissions ⊆ {used APIs ∪ soft-allowlist}
3. (then) check-axios-version, lint-const-reassign, compile-instruction (×3),
   check-standalone-dist, check-version-sync, build:prompts, vite build
```

Both validators are wired into:
- `package.json` `build:extension` chain
- `scripts/ps-modules/preflight.ps1` (`Invoke-ManifestPreflight`, `Invoke-ManifestPermissionCheck`)
- Called from `Build-Extension` in `scripts/ps-modules/extension-build.ps1`

A failure prints the exact path, what's missing, and the reason — per the [file-path error logging code-red rule](mem://constraints/file-path-error-logging-code-red.md).

---

## 9. Change checklist

Before changing **any** of the following, re-read this doc and update it:

- ☐ Adding a permission → add the corresponding `chrome.<namespace>` call OR add to `API_TO_PERMISSION` in `check-manifest-permissions.mjs`. Document the justification in §3.
- ☐ Removing a permission → grep `src/` for any remaining `chrome.<namespace>` use; the validator will catch surface misses but verify manually too.
- ☐ Adding a content script → decide static vs dynamic using §5's decision matrix. Default to dynamic.
- ☐ Bumping version → use `node scripts/bump-version.mjs <version|patch|minor|major>` — it bumps `manifest.json` AND `EXTENSION_VERSION` AND all `instruction.ts` files atomically.
- ☐ Adding a web-accessible resource → ensure it's actually emitted by Vite (check `vite.config.extension.ts` rollup inputs OR `viteStaticCopy` targets) and document its consumer in §6.
- ☐ Adding a keyboard command → register it in `manifest.json` `commands{}` AND wire a handler in `shortcut-command-handler.ts`.

---

## 11. Companion repositories

### macro-ahk — AutoHotkey sidecar

Marco ships alongside an AutoHotkey v2 sidecar that drives keyboard/mouse automation on Windows. The extension communicates with AHK scripts via `window.postMessage` bridges for native OS automation that Chrome extensions cannot perform directly.

**Repository:** `https://github.com/alimtvnetwork/macro-ahk-v33`  
**Clone command:**

```bash
git clone https://github.com/alimtvnetwork/macro-ahk-v33 "macro-ahk"
```

Or via package.json script:

```bash
pnpm clone:ahk
```

**Required folder layout:**

The `macro-ahk/` folder must sit adjacent to this repository root:

```
marco-extension/          # This Chrome extension repo
├── chrome-extension/
├── standalone-scripts/
├── docs/
└── ...

macro-ahk/                # Clone target (sidecar)
├── scripts/
├── lib/
└── ...
```

**What the sidecar does:**

| Function | Purpose |
|----------|---------|
| Keyboard simulation | Sends keystrokes to target applications |
| Mouse automation | Clicks, drags, scrolls outside browser context |
| Window management | Activates, resizes, positions desktop windows |
| Clipboard bridge | Synchronizes clipboard between browser and OS |
| File I/O | Reads/writes local files beyond browser sandbox |

**Integration point:**

The `macro-looping.js` controller (via `standalone-scripts/macro-controller`) detects the AHK sidecar presence through a `window.postMessage` handshake on `localhost:8787` (configurable). If the sidecar responds with the correct protocol version, macro chains can include `AHK.*` actions that serialize to the sidecar for execution.

**Version coupling:**

- Extension v2.170.0+ requires AHK sidecar v23.x (macro-ahk-v33 branch)
- Mismatched versions log a warning but do not block core browser automation

See also: `readme.md` §"Companion Repositories" for contributor setup instructions.

---

## Storage Migration Policy

> ⛔ **Phase 2c-storage v2 is permanently banned.** Rewriting `StoredProject` keys in `chrome.storage.local` from camelCase to PascalCase would break ~50+ downstream consumers. Three enforcement layers (runtime guard, unit test, CI check) block it.

### Banned behavior

- Renaming/rewriting persisted `StoredProject` keys (e.g. `name` → `Name`, `urlPatterns` → `UrlPatterns`).
- Registering any migration whose `version > MAX_ALLOWED_STORAGE_SCHEMA_VERSION` (currently `1`).
- Helpers like `renameStorageKey`, `migrateStoredProjectKeys`, `pascalCaseStoredProject`.
- `chrome.storage.local.set({ PascalKey: ... })` writes against project payloads.

### Permitted migration behavior

| Allowed | Notes |
|---------|-------|
| Add new optional fields | Additive, backward-compatible only |
| Bump schema version | Bump `CURRENT_STORAGE_SCHEMA_VERSION` **and** `MAX_ALLOWED_STORAGE_SCHEMA_VERSION` in lockstep |
| In-memory PascalCase compat snapshot | e.g. `compile-instruction` dual-emit; persisted shape stays camelCase |
| Read-side normalization | Accept both shapes on read; always write camelCase |
| Destructive rename/delete | Only with a written RFC and explicit user sign-off |

### Enforcement layers

1. **Runtime guard** — `assertNoPascalCaseStorageMigration()` in `src/background/storage-migration.ts` throws before any out-of-range migration runs.
2. **Unit test** — `src/background/__tests__/storage-migration-guard.test.ts`.
3. **CI check** — `pnpm run check:no-storage-pascalcase-rewrite` (wired into `build` and `build:dev`); scans `src/` + `standalone-scripts/` for violating writes and helper identifiers.
4. **Memory rule** — `mem://constraints/no-storage-pascalcase-migration` blocks the agent from re-proposing it.
