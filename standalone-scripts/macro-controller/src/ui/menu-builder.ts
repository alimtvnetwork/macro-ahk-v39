/**
 * MacroLoop Controller — Menu Builder
 * Step 2g: Extracted from macro-looping.ts
 *
 * Builds the ☰ hamburger menu with all submenus:
 * Loop, Force, Export, Read (Session Cookie + Auth Trace), Changelog, Auto Attach, About.
 */

import { log } from '../logging';
import { showDatabaseModal } from './database-modal';
import { exportWorkspacesAsCsv } from '../logging';
import { VERSION, cPanelBg, cPanelFgDim, cPanelFgMuted, cPrimary, cBtnMenuBg, cBtnMenuFg, cSectionHeader, lDropdownRadius, lDropdownShadow, tFontSm, trFast, autoAttachCfg, state } from '../shared-state';
import { LoopDirection, type AutoAttachGroupRuntime, type DiagnosticDump, type ExtensionResponse } from '../types';
import { showToast } from '../toast';
import { nsWrite, nsCallTyped } from '../api-namespace';
import { refreshBearerTokenFromBestSource, getAuthDebugSnapshot } from '../auth';
import { moveToAdjacentWorkspace } from '../workspace-management';
import { createMenuItem, createMenuSep, createSubmenu } from './menu-helpers';
import { showAboutModal } from './about-modal';
import { showChangelogModal } from './changelog-modal';
import { showProjectsModal } from './projects-modal';
import { showCreditTotalsModal } from './credit-totals-modal';
import { resolveAutoAttachConfig, runAutoAttachGroup } from './auto-attach';
import { logError } from '../error-utils';
import { sendToExtension } from './prompt-manager';

import { SECTION_DIVIDER } from '../constants';
export interface MenuBuilderDeps {
  btnStyle: string;
  startLoop: (dir: string) => void;
  stopLoop: () => void;
}

export interface MenuBuilderResult {
  menuContainer: HTMLElement;
  menuBtn: HTMLElement;
  menuDropdown: HTMLElement;
  menuCtx: { menuBtnStyle: string; menuDropdown: HTMLElement };
  forceMoveInFlight: () => boolean;
  setForceMoveInFlight: () => void;
}

// CQ16: Extracted from buildHamburgerMenu closure
function createForceMoveInFlightTracker(): { isInFlight: () => boolean; set: () => void } {
  let inFlight = false;

  return {
    isInFlight: () => inFlight,
    set: () => {
      inFlight = true;
      setTimeout(function() { inFlight = false; }, 8000);
    },
  };
}

/**
 * Build the hamburger menu with all submenus.
 */
export function buildHamburgerMenu(deps: MenuBuilderDeps): MenuBuilderResult {
  const { btnStyle, startLoop } = deps;
  const menuBtnStyle = 'display:flex;align-items:center;gap:4px;width:100%;padding:5px 10px;border:none;background:transparent;color:' + cPanelFgMuted + ';font-size:' + tFontSm + ';cursor:pointer;text-align:left;border-radius:3px;transition:background ' + trFast + ';';

  const menuContainer = document.createElement('div');
  menuContainer.style.cssText = 'position:relative;display:inline-block;min-width:0;';
  const menuBtn = document.createElement('button');
  menuBtn.textContent = '☰';
  menuBtn.title = 'More actions';
  menuBtn.style.cssText = btnStyle + 'background:' + cBtnMenuBg + ';color:' + cBtnMenuFg + ';font-size:14px;padding:5px 10px;';
  const menuDropdown = document.createElement('div');
  menuDropdown.style.cssText = 'display:none;position:fixed;min-width:180px;background:' + cPanelBg + ';border:1px solid ' + cPrimary + ';border-radius:' + lDropdownRadius + ';z-index:100003;box-shadow:' + lDropdownShadow + ';padding:4px 0;';

  const menuCtx = { menuBtnStyle: menuBtnStyle, menuDropdown: menuDropdown };
  const forceMoveTracker = createForceMoveInFlightTracker();

  // Submenus
  _addLoopSubmenu(menuCtx, menuDropdown, startLoop);
  _addForceSubmenu(menuCtx, menuDropdown, forceMoveTracker);
  _addExportSubmenu(menuCtx, menuDropdown);
  _addReadSubmenu(menuCtx, menuDropdown);

  menuDropdown.appendChild(createMenuSep());
  menuDropdown.appendChild(createMenuItem(menuCtx, '📜', 'Changelog', 'View version history and recent changes', function() { showChangelogModal(); }));
  menuDropdown.appendChild(createMenuItem(menuCtx, '🗄️', 'Database', 'Browse project database tables and rows', function() { showDatabaseModal(); }));
  menuDropdown.appendChild(createMenuItem(menuCtx, '📂', 'Projects', 'Show open Lovable projects grouped by workspace', function() { showProjectsModal(); }));
  menuDropdown.appendChild(createMenuItem(menuCtx, '💰', 'Credit Totals', 'Show aggregated credit usage across workspaces', function() { showCreditTotalsModal(); }));

  _addAutoAttachSection(menuCtx, menuDropdown);

  menuDropdown.appendChild(createMenuSep());
  menuDropdown.appendChild(createMenuItem(menuCtx, 'ℹ️', 'About', 'About MacroLoop Controller', function() { showAboutModal(); }));

  // Menu button click handler
  menuBtn.onclick = function(e: Event) {
    e.stopPropagation();
    const isOpen = menuDropdown.style.display !== 'none';
    if (isOpen) {
      menuDropdown.style.display = 'none';
    } else {
      const rect = menuBtn.getBoundingClientRect();
      menuDropdown.style.top = (rect.bottom + 2) + 'px';
      menuDropdown.style.right = (window.innerWidth - rect.right) + 'px';
      menuDropdown.style.left = 'auto';
      menuDropdown.style.display = 'block';
    }
  };
  document.addEventListener('click', function() {
    menuDropdown.style.display = 'none';
    const subs = document.querySelectorAll('[data-marco-submenu]');
    for (const sub of Array.from(subs)) { (sub as HTMLElement).style.display = 'none'; }
  });
  menuContainer.appendChild(menuBtn);
  document.body.appendChild(menuDropdown);

  return {
    menuContainer, menuBtn, menuDropdown, menuCtx,
    forceMoveInFlight: () => forceMoveTracker.isInFlight(),
    setForceMoveInFlight: forceMoveTracker.set,
  };
}

// ── Loop Submenu ──
function _addLoopSubmenu(menuCtx: { menuBtnStyle: string; menuDropdown: HTMLElement }, menuDropdown: HTMLElement, startLoop: (dir: string) => void): void {
  const loopMenu = createSubmenu(menuCtx, '🔄', 'Loop');
  loopMenu.panel.appendChild(createMenuItem(menuCtx, '▲', 'Loop Up', 'Start loop in UP direction', function() {
    state.direction = LoopDirection.Up; log('Direction set to: UP'); startLoop('up');
  }));
  loopMenu.panel.appendChild(createMenuItem(menuCtx, '▼', 'Loop Down', 'Start loop in DOWN direction', function() {
    state.direction = LoopDirection.Down; log('Direction set to: DOWN'); startLoop('down');
  }));
  menuDropdown.appendChild(loopMenu.el);
}

// ── Force Submenu ──
function _addForceSubmenu(menuCtx: { menuBtnStyle: string; menuDropdown: HTMLElement }, menuDropdown: HTMLElement, forceMoveTracker: { isInFlight: () => boolean; set: () => void }): void {
  const forceMenu = createSubmenu(menuCtx, '⚡', 'Force');
  forceMenu.panel.appendChild(createMenuItem(menuCtx, '⏫', 'Force Move Up', 'Force move project to previous workspace via API (Ctrl+Up)', function() {
    if (forceMoveTracker.isInFlight()) { log('Force move: cooldown active', 'warn'); return; }
    forceMoveTracker.set(); moveToAdjacentWorkspace('up');
  }));
  forceMenu.panel.appendChild(createMenuItem(menuCtx, '⏬', 'Force Move Down', 'Force move project to next workspace via API (Ctrl+Down)', function() {
    if (forceMoveTracker.isInFlight()) { log('Force move: cooldown active', 'warn'); return; }
    forceMoveTracker.set(); moveToAdjacentWorkspace('down');
  }));
  menuDropdown.appendChild(forceMenu.el);
}

// ── Export Submenu ──
function buildBundleHeader(bundle: string, now: Date): string {
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
  let header = SECTION_DIVIDER;
  header += '// MACROLOOP BUNDLE EXPORT (self-contained)\n';
  header += '// Generated: ' + timestamp + '\n';
  header += '// Version:   v' + VERSION + '\n';
  header += '// Contents:  xpath-utils.js + macro-looping.js\n';
  header += '// Length:    ' + bundle.length + ' chars\n';
  header += SECTION_DIVIDER;
  header += '// All __PLACEHOLDER__ tokens have been resolved.\n';
  header += '// Paste this entire script into any browser DevTools Console.\n';
  header += '// TIP: If Domain Guard blocks, run: window.__comboForceInject = true  first.\n';
  header += '// ============================================\n\n';
  return header;
}

function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

async function fetchBundledMacroControllerSource(): Promise<ExtensionResponse> {
  return sendToExtension('HOT_RELOAD_SCRIPT', { scriptName: 'macroController' });
}

async function fetchBundleSource(): Promise<string | null> {
  const response = await fetchBundledMacroControllerSource();
  const scriptSource = typeof response?.scriptSource === 'string' ? response.scriptSource : '';
  if (!response?.isOk || scriptSource.length < 100) {
    const reason = response?.errorMessage || 'Bundled macro controller source is unavailable';
    logError('Export', reason);
    showToast('❌ ' + reason, 'error');
    return null;
  }
  return scriptSource;
}

function formatDiagnosticDump(diag: DiagnosticDump): string {
  const lines: string[] = [];
  lines.push('=== DIAGNOSTIC DUMP ===');
  for (const key in diag) {
    const value = diag[key];
    const formatted = Array.isArray(value) ? '[' + value.join(', ') + ']' : String(value);
    lines.push(key + ': ' + formatted);
  }
  return lines.join('\n');
}

function _addExportSubmenu(menuCtx: { menuBtnStyle: string; menuDropdown: HTMLElement }, menuDropdown: HTMLElement): void {
  const exportMenu = createSubmenu(menuCtx, '📦', 'Export');
  exportMenu.panel.appendChild(createMenuItem(menuCtx, '📋', 'Export CSV', 'Export all workspaces + credits as CSV', function() { exportWorkspacesAsCsv(); }));
  exportMenu.panel.appendChild(createMenuItem(menuCtx, '📥', 'Download Bundle', 'Download bundle (xpath-utils + macro-looping) as .js file', function() {
    void fetchBundleSource().then(function(bundle) {
      if (!bundle) return;
      const now = new Date();
      const fullExport = buildBundleHeader(bundle, now) + bundle;
      downloadTextFile('automator-bundle-v' + VERSION + '-' + now.toISOString().replace(/[:.]/g, '-').substring(0, 19) + '.js', fullExport, 'application/javascript');
      log('Export: Downloaded bundle (' + fullExport.length + ' chars)', 'success');
      showToast('Bundle downloaded ✓', 'success');
    });
  }));
  exportMenu.panel.appendChild(createMenuItem(menuCtx, '📋', 'JS Bundle', 'Copy bundle to clipboard', function() {
    void fetchBundleSource().then(function(bundle) {
      if (!bundle) return;
      navigator.clipboard.writeText(bundle).then(function() {
        log('Copy JS: Copied to clipboard (' + bundle.length + ' chars)', 'success');
        showToast('JS bundle copied ✓', 'success');
      }).catch(function(err: Error) {
        log('Copy JS: Clipboard failed: ' + err.message, 'warn');
        showToast('❌ Clipboard copy failed', 'error');
      });
    });
  }));
  exportMenu.panel.appendChild(createMenuItem(menuCtx, '🔧', 'Diagnostic Dump', 'Run diagnostic dump', function() {
    const result = nsCallTyped('api.loop.diagnostics');
    if (result === undefined) {
      log('Diagnostic dump not available', 'warn');
      showToast('⚠️ Diagnostic dump not available', 'warn');
      return;
    }
    const now = new Date();
    const text = formatDiagnosticDump(result);
    downloadTextFile('macroloop-diagnostic-dump-' + now.toISOString().replace(/[:.]/g, '-').substring(0, 19) + '.txt', text, 'text/plain');
    log('Diagnostic dump exported (' + text.length + ' chars)', 'success');
    showToast('Diagnostic dump downloaded ✓', 'success');
  }));
  menuDropdown.appendChild(exportMenu.el);
}

// ── Read Submenu ──
function _addReadSubmenu(menuCtx: { menuBtnStyle: string; menuDropdown: HTMLElement }, menuDropdown: HTMLElement): void {
  const readMenu = createSubmenu(menuCtx, '🔍', 'Read');
  readMenu.panel.appendChild(createMenuItem(menuCtx, '🍪', 'Session Cookie Read', 'Read session token from extension bridge and save to localStorage for API auth', function() {
    refreshBearerTokenFromBestSource(function(token: string, source: string) {
      if (token) {
        log('Session token refreshed via ' + source + ' and saved to localStorage[marco_bearer_token] (' + token.substring(0, 12) + '...)', 'success');
        showToast('Session token refreshed via ' + source + ' ✓', 'success');
      } else {
        log('No session token found via extension bridge or cookie fallback — user may need to log in', 'warn');
        showToast('No session token found — please log in first', 'warn');
      }
    });
  }));
  readMenu.panel.appendChild(createMenuItem(menuCtx, '🔍', 'Auth Trace', 'Copy auth trace snapshot to clipboard', function() {
    const s = getAuthDebugSnapshot();
    const bridge = !s.bridgeOutcome.attempted ? 'not attempted'
      : s.bridgeOutcome.success ? 'OK via ' + s.bridgeOutcome.source
      : 'FAIL: ' + (s.bridgeOutcome.error || 'unknown');
    const lines = [
      '=== Auth Trace @ ' + new Date().toISOString() + ' ===',
      'Token Source:    ' + s.tokenSource,
      'Has Token:       ' + s.hasResolvedToken,
      'Cookie Bindings: ' + s.sessionCookieNames.join(', '),
      'Visible Cookies: ' + (s.visibleCookieNames.length ? s.visibleCookieNames.join(', ') : '(none)'),
      'Bridge Result:   ' + bridge,
      'Flow:            ' + s.flow,
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(function() {
      showToast('✅ Auth trace copied to clipboard', 'success');
    }).catch(function() { showToast('❌ Failed to copy auth trace', 'error'); });
  }));
  menuDropdown.appendChild(readMenu.el);
}

// ── Auto Attach Section ──
function _addAutoAttachSection(menuCtx: { menuBtnStyle: string; menuDropdown: HTMLElement }, menuDropdown: HTMLElement): void {
  nsWrite('api.autoAttach.runGroup', function(group: AutoAttachGroupRuntime) { runAutoAttachGroup(group, autoAttachCfg as Record<string, unknown>, showToast); });
  menuDropdown.appendChild(createMenuSep());

  const aaHeader = document.createElement('div');
  aaHeader.style.cssText = 'padding:4px 10px;font-size:9px;color:' + cSectionHeader + ';font-weight:700;text-transform:uppercase;letter-spacing:0.5px;';
  aaHeader.textContent = '📎 Auto Attach Files';
  menuDropdown.appendChild(aaHeader);

  const aaGroups = resolveAutoAttachConfig().groups;
  if (aaGroups.length === 0) {
    const noGroups = document.createElement('div');
    noGroups.style.cssText = 'padding:4px 10px;font-size:10px;color:' + cPanelFgDim + ';font-style:italic;';
    noGroups.textContent = 'No groups configured';
    menuDropdown.appendChild(noGroups);
  } else {
    for (const group of aaGroups) {
      const fileCount = (group.files || []).length;
      const label = group.name + ' (' + fileCount + ' file' + (fileCount !== 1 ? 's' : '') + ')';
      menuDropdown.appendChild(createMenuItem(menuCtx, '📁', label, 'Attach files from: ' + group.name + (group.prompt ? '\nPrompt: ' + group.prompt.substring(0, 60) + '...' : ''), function() {
        runAutoAttachGroup(group, autoAttachCfg as Record<string, unknown>, showToast);
      }));
    }
  }
}
