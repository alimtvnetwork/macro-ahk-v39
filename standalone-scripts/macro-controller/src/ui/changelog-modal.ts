/**
 * MacroLoop Controller — Changelog Modal
 * Step 2g: Extracted from macro-looping.ts
 */

import { log } from '../logging';

import { cPanelBg, cPanelFg, cPanelText, cPrimary, cSectionBg, cSuccess, lModalRadius, lModalShadow, tFont } from '../shared-state';

import { DATE_CHANGELOG_2026_03_21 as DATE_2026_03_21 } from '../constants';
export interface ChangelogEntry {
  ver: string;
  date: string;
  changes: string[];
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  { ver: 'v2.240.0', date: '2026-05-14', changes: [
    'Changelog modal updated with recent prompt additions and macro-controller UI fixes'
  ]},
  { ver: 'v2.239.0', date: '2026-05-14', changes: [
    'Unified AI Prompt v4 updated — 3-part framework (analysis, spec fix, test failures)'
  ]},
  { ver: 'v2.238.0', date: '2026-05-14', changes: [
    'Rejog the Memory v1 prompt updated — reliability reports and suggestions workflow'
  ]},
  { ver: 'v2.237.0', date: '2026-05-14', changes: [
    'Coding Guidelines prompt added for project synthesis and task planning'
  ]},
  { ver: 'v2.236.0', date: '2026-05-14', changes: [
    'Write Memory prompt added for session-end memory persistence'
  ]},
  { ver: 'v2.235.0', date: '2026-05-14', changes: [
    'Minor Bump and Major Bump prompts added for automated version bumps'
  ]},
  { ver: 'v2.234.0', date: '2026-05-14', changes: [
    'Read Memory prompt added for AI assistant onboarding'
  ]},
  { ver: 'v7.41', date: DATE_2026_03_21, changes: [
    'Configurable LogManager with per-level enable/disable',
    'New Logging tab in Settings dialog (Ctrl+,)',
    'Console output, persistence, and activity UI individually toggleable',
    'Log settings persisted to localStorage'
  ]},
  { ver: 'v7.40', date: DATE_2026_03_21, changes: [
    'Panel [ - ] / [ + ] toggle button now has direct click handler',
    'Workspace detection uses text-fragment extraction for composite dialog nodes',
    'Added non-regression rule R11 for dialog workspace matching'
  ]},
  { ver: 'v7.39', date: DATE_2026_03_21, changes: [
    'Auth recovery lock prevents parallel retry storms (RCA-4)',
    'Toast deduplication suppresses duplicate notifications (RCA-3)',
    'Single controlled retry on 401/403 instead of recursive retries (RCA-1)',
    'markBearerTokenExpired now actually clears cached token (RCA-5)',
    'Workspace name preserved during detection — no destructive clear',
    'Exact matching for workspace names — no loose indexOf matching'
  ]},
  { ver: 'v7.38', date: DATE_2026_03_21, changes: [
    'Icon-only Start/Stop buttons (▶/⏹) — no text labels',
    'Menu overflow fix: dropdown and submenus render outside panel via fixed positioning',
    'Save Prompt button relocated to chatbox toolbar via XPath injection',
    'Non-blocking error toasts with close (✕) and copy (📋) buttons',
    'Error-level toasts auto-stop loop to prevent cascading failures',
    'Global error/rejection handlers catch uncaught errors and halt loop',
    'Source URL directives for meaningful DevTools stack traces',
    'Header title consistency fix (flex-shrink:0 + spacer)',
    'Fixed duplicate menuBtn.onclick handler bug',
    'Submenu panels tagged with data-marco-submenu for clean dismissal'
  ]},
  { ver: 'v7.35', date: '2026-03-20', changes: [
    'Check button resolves auth token before running check (Issue 46)',
    'Startup immediately loads workspaces after auth resolution',
    'Added Changelog menu item',
    'Version bump: extension 1.48.0, script 7.35'
  ]},
  { ver: 'v7.34', date: '2026-03-20', changes: [
    'Startup auth: extension bridge → localStorage → cookie → error (v7.27)',
    'runCycle 401/403 retry with token refresh',
    'startLoop pre-flight: auth → credits → timers',
    'Enhanced error diagnostics (URL, token source, retry state)'
  ]},
  { ver: 'v7.33', date: '2026-03-19', changes: [
    'Dual theme presets (Dark+/Light+) with localStorage persistence',
    'Theme toggle in hamburger menu',
    'Schema v2 theme tokens'
  ]},
  { ver: 'v7.32', date: '2026-03-18', changes: [
    'Token fallback chain: session bridge → extension bridge → cookie',
    'Credit bar segmented display (bonus/billing/rollover/daily)',
    'Workspace auto-detect via Tier 1 API + Tier 2 XPath'
  ]}
];

/**
 * Show the changelog modal overlay.
 */
export function showChangelogModal(): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100001;display:flex;align-items:center;justify-content:center;';
  overlay.onclick = function(e: Event) { if (e.target === overlay) overlay.remove(); };

  const modal = document.createElement('div');
  modal.style.cssText = 'background:' + cPanelBg + ';border:1px solid ' + cPrimary + ';border-radius:' + lModalRadius + ';padding:20px;max-width:480px;width:90%;max-height:70vh;overflow-y:auto;box-shadow:' + lModalShadow + ';font-family:' + tFont + ';color:' + cPanelFg + ';';

  const title = document.createElement('h3');
  title.style.cssText = 'margin:0 0 12px 0;color:' + cPrimary + ';font-size:14px;';
  title.textContent = '📜 Changelog — MacroLoop Controller';
  modal.appendChild(title);

  for (const entry of CHANGELOG_ENTRIES) {
    const entryDiv = document.createElement('div');
    entryDiv.style.cssText = 'margin-bottom:12px;padding:8px;background:' + cSectionBg + ';border-radius:4px;';

    const verLabel = document.createElement('div');
    verLabel.style.cssText = 'font-weight:bold;color:' + cSuccess + ';font-size:12px;margin-bottom:4px;';
    verLabel.textContent = entry.ver + ' — ' + entry.date;
    entryDiv.appendChild(verLabel);

    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:0;padding-left:16px;font-size:11px;color:' + cPanelText + ';';

    for (const change of entry.changes) {
      const li = document.createElement('li');
      li.style.cssText = 'margin-bottom:2px;';
      li.textContent = change;
      ul.appendChild(li);
    }

    entryDiv.appendChild(ul);
    modal.appendChild(entryDiv);
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'margin-top:8px;padding:6px 16px;background:' + cPrimary + ';color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;';
  closeBtn.onclick = function() { overlay.remove(); };
  modal.appendChild(closeBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  log('Changelog opened', 'info');
}
