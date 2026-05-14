/**
 * Prompt Loader — Loading, caching, config resolution, extension messaging
 *
 * Phase 5D split from ui/prompt-manager.ts.
 * See: spec/04-macro-controller/ts-migration-v2/05-module-splitting.md
 */

import { log, logSub } from '../logging';
import type { ExtensionResponse, PromptEntry, ResolvedPromptsConfig } from '../types';
import type { CachedPromptEntry } from './prompt-cache';
import {
  clearPromptCache,
  clearUISnapshot,
  readPromptCache,
  writePromptCache,
  writeHtmlCopy,
} from './prompt-cache';
import type { TaskNextDeps } from './task-next-ui';
import { normalizePromptEntries } from './prompt-utils';
import { logError } from '../error-utils';
import { showToast } from '../toast';
import { DEFAULT_PASTE_XPATH } from '../constants';
/** Editable prompt — a PromptEntry with an optional DB id. */
export interface EditablePrompt extends PromptEntry {
  id?: string;
}

/** Context type for DOM refs from createUI() */
export interface PromptContext {
  promptsDropdown: HTMLElement;
}

// ============================================
// Fallback prompts
// ============================================
export const DEFAULT_PROMPTS: PromptEntry[] = [
  { name: 'Start Prompt', text: 'Begin session with repository context scan and memory synthesis, then produce a reliability risk report before implementation.', slug: 'start-prompt', id: 'default-start' },
  { name: 'Rejog the Memory v1', text: 'Read and synthesize existing repository context from the memory folder and the full specification set, then produce a reliability risk report before any implementation work begins. Do not implement anything. Only produce a report and specification-side artifacts for memory, suggestions, and planning.', slug: 'rejog-the-memory-v1', id: 'default-rejog' },
  { name: 'Unified AI Prompt v4', text: 'Read and synthesize existing repository context from the memory folder and the full specification set. Follow the Required Execution Order: 1) Scan repo tree, 2) Read memory folders, 3) Read workflow tracker, 4) Read specs, 5) Reconstruct context, 6) Produce reliability report, 7) Propose corrections, 8) Update memory, 9) Update plan, 10) Ask user which task to implement next.', slug: 'unified-ai-prompt-v4', id: 'default-unified' },
  { name: 'Issues Tracking', text: 'Update spec properly so that the mistake doesn\'t appear and update memory and also write the details how you fixed it. Create issue file at /spec/02-app/issues/{seq}-{issueSlugName}.md with: Issue summary, Root cause analysis, Fix description, Iterations history, Prevention and non-regression, TODO and follow-ups, Done checklist.', slug: 'issues-tracking', id: 'default-issues' },
  { name: 'Unit Test Failing', text: 'Fix failing tests: 1) Check code, 2) Check actual method implementation, 3) Check logical implementation of the test, 4) Check test case, 5) Fix logically either the implementation or the test. Document at /spec/05-failing-tests/{seq}-failing-test-name.md with root cause and solution.', slug: 'unit-test-failing', id: 'default-test' },
  { name: 'Audit Spec v1', text: 'Audit the current specification set against the implemented codebase. For each spec:\n\n1. Check if the spec accurately reflects the current implementation\n2. Identify any drift between spec and code\n3. Flag missing specs for implemented features\n4. Flag specs for features not yet implemented\n5. Score each spec on a 6-dimension rubric:\n   - Completeness (25%): Are all requirements documented?\n   - Consistency (25%): Do specs agree with each other?\n   - Alignment (20%): Does the spec match the code?\n   - Clarity (15%): Is the spec unambiguous?\n   - Maintainability (10%): Is the spec easy to update?\n   - Test Coverage (5%): Are acceptance criteria testable?\n\nOutput a report to `.lovable/memory/audit/` with severity and impact scores for each finding. Propose corrections for any inconsistencies found.', slug: 'audit-spec-v1', id: 'default-audit-spec', category: 'general' },
  { name: 'Minor Bump', text: 'Bump all Minor versions for all', category: 'versioning', slug: 'minor-bump', id: 'default-minor-bump' },
  { name: 'Major Bump', text: 'Bump all Major versions for all', category: 'versioning', slug: 'major-bump', id: 'default-major-bump' },
  { name: 'Patch Bump', text: 'Bump all Patch versions for all', category: 'versioning', slug: 'patch-bump', id: 'default-patch-bump' },
  { name: 'Code Coverage Basic', text: 'Based on low-coverage packages (>1000 lines), plan 200-line segments for coverage tests. Cover branches, logical segments. Follow AAA format, naming conventions, Should Be methods.', category: 'code-coverage', slug: 'code-coverage-basic', id: 'default-code-coverage-basic' },
  { name: 'Code Coverage Details', text: 'Plan 200-line segments for low-coverage packages. Follow AAA format, naming conventions. Identify packages >1000 lines, segment into 200-line chunks, cover branches and logical flows.', category: 'code-coverage', slug: 'code-coverage-details', id: 'default-code-coverage-details' },
  { name: 'Next Tasks', text: 'Next,\n\nList out the remaining tasks always, if you finish then in future `next` command, find any remaining tasks from memory and suggest', category: 'automation', slug: 'next-tasks', id: 'default-next-tasks' },
  { name: 'Unit Test Issues V2 Enhanced', text: 'Based on the packages that have low coverage, if a package has more than 1000 lines, then for that specific package we should split it into segments of 200 lines per task.\n\nYou should create a plan where each 200-line segment is treated as one task. Each task should focus on writing meaningful test coverage, including:\n- Branch coverage\n- Logical segment coverage\n- Edge cases\n\nFirst, create a detailed plan outlining:\n- Which packages will be handled\n- How many segments each package will be split into\n- The step-by-step execution plan\n\nEach time I say "next", you should proceed with the next package or segment and work towards achieving 100% code coverage.\n\nYou do not need to ask which package to prioritize. Choose based on logical ordering.\n\nEnsure that tests are written in a way that they are buildable in Go. Even if you cannot run them, ensure correctness through reasoning.\n\nFollow existing test patterns from the testing guideline spec folder.\n\nTesting requirements:\n- Follow AAA pattern (Arrange, Act, Assert)\n- Follow naming conventions (use "Should" style naming)\n- Maintain consistency with existing tests\n\nIf you have any questions or confusion, feel free to ask.\n\nYour task now is to create a detailed execution plan.', category: 'code-coverage', slug: 'unit-test-issues-v2-enhanced', id: 'default-unit-test-issues-v2-enhanced' },
];

// ============================================
// PromptLoaderState — encapsulated module state (CQ11, CQ17)
//
// Conversion (CQ10):
//   Before: 5 module-level `let` vars (_loadedJsonPrompts, _jsonPromptsLoading,
//           _promptCategoryFilter, _revalidateCtx, _renderDropdownFn).
//   After:  `PromptLoaderState` singleton class with private fields and getters/setters.
// ============================================

class PromptLoaderState {
  private _loadedJsonPrompts: PromptEntry[] | null = null;
  private _jsonPromptsLoading = false;
  private _promptCategoryFilter: string | null = null;
  private _revalidateCtx: { ctx: PromptContext; taskNextDeps: TaskNextDeps } | null = null;
  private _renderDropdownFn: ((ctx: PromptContext, deps: TaskNextDeps) => void) | null = null;
  private _pendingCallbacks: Array<(prompts: PromptEntry[] | null) => void> = [];

  get loadedJsonPrompts(): PromptEntry[] | null { return this._loadedJsonPrompts; }
  set loadedJsonPrompts(value: PromptEntry[] | null) { this._loadedJsonPrompts = value; }

  get jsonPromptsLoading(): boolean { return this._jsonPromptsLoading; }
  set jsonPromptsLoading(value: boolean) { this._jsonPromptsLoading = value; }

  get promptCategoryFilter(): string | null { return this._promptCategoryFilter; }
  set promptCategoryFilter(value: string | null) { this._promptCategoryFilter = value; }

  get revalidateCtx(): { ctx: PromptContext; taskNextDeps: TaskNextDeps } | null { return this._revalidateCtx; }
  set revalidateCtx(value: { ctx: PromptContext; taskNextDeps: TaskNextDeps } | null) { this._revalidateCtx = value; }

  get renderDropdownFn(): ((ctx: PromptContext, deps: TaskNextDeps) => void) | null { return this._renderDropdownFn; }
  set renderDropdownFn(value: ((ctx: PromptContext, deps: TaskNextDeps) => void) | null) { this._renderDropdownFn = value; }

  enqueuePendingCallback(callback: (prompts: PromptEntry[] | null) => void): void {
    this._pendingCallbacks.push(callback);
  }

  flushPendingCallbacks(prompts: PromptEntry[] | null): void {
    const pending = this._pendingCallbacks.slice();
    this._pendingCallbacks = [];
    for (const callback of pending) {
      try {
        callback(prompts);
      } catch (e) {
        logError('parsePromptFile', 'Prompt callback execution failed', e);
        showToast('❌ Prompt callback failed', 'error');
      }
    }
  }
}

const promptLoaderState = new PromptLoaderState();

/** @deprecated Use promptLoaderState.promptCategoryFilter directly. */
export const _promptCategoryFilter: string | null = null;
export function getPromptCategoryFilter(): string | null { return promptLoaderState.promptCategoryFilter; }
export function setPromptCategoryFilter(value: string | null): void {
  promptLoaderState.promptCategoryFilter = value;
}

/** Invalidate prompt cache (e.g. after save/delete) */
export function invalidatePromptCache(): void {
  promptLoaderState.loadedJsonPrompts = null;
  // Also invalidate SDK cache if available
  const sdk = window.marco as { prompts?: { invalidateCache(): Promise<void> } } | undefined;
  if (sdk && sdk.prompts && typeof sdk.prompts.invalidateCache === 'function') {
    sdk.prompts.invalidateCache().catch(function(e: unknown) { log('[PromptLoader] SDK cache invalidation failed: ' + (e instanceof Error ? e.message : String(e)), 'warn'); });
  }
  clearPromptCache().then(function() {
    log('[PromptCache] Cache cleared (invalidated)', 'info');
  });
  clearUISnapshot().then(function() {
    log('[UISnapshot] Snapshot cleared (invalidated)', 'info');
  });
}

/** Check if prompts are already loaded in memory */
export function isPromptsCached(): boolean {
  return promptLoaderState.loadedJsonPrompts !== null && promptLoaderState.loadedJsonPrompts.length > 0;
}

/** Clear in-memory loaded prompts (used after save/delete) */
export function clearLoadedPrompts(): void {
  promptLoaderState.loadedJsonPrompts = null;
  // Also invalidate SDK cache
  const sdk = window.marco as { prompts?: { invalidateCache(): Promise<void> } } | undefined;
  if (sdk && sdk.prompts && typeof sdk.prompts.invalidateCache === 'function') {
    sdk.prompts.invalidateCache().catch(function(e: unknown) { log('[PromptLoader] SDK cache invalidation failed: ' + (e instanceof Error ? e.message : String(e)), 'warn'); });
  }
}

// ============================================
// CQ16: Extracted message relay context
// ============================================

interface RelayCtx {
  settled: boolean;
  requestId: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (resp: ExtensionResponse) => void;
  _onResponse?: (event: MessageEvent) => void;
}

// CQ16: Extracted from sendToExtension closure
function finishRelay(ctx: RelayCtx, resp: ExtensionResponse): void {
  if (ctx.settled) return;
  ctx.settled = true;
  window.removeEventListener('message', ctx._onResponse!);
  clearTimeout(ctx.timeout);
  ctx.resolve(resp);
}

// CQ16: Extracted from sendToExtension closure
function handleRelayResponse(ctx: RelayCtx, event: MessageEvent): void {
  if (event.data && event.data.source === 'marco-extension' && event.data.requestId === ctx.requestId) {
    finishRelay(ctx, event.data.payload);
  }
}

/**
 * Send a message to the extension via chrome.runtime or window.postMessage relay.
 * Returns a Promise that resolves with the extension response.
 */
export function sendToExtension(type: string, payload: Record<string, unknown>): Promise<ExtensionResponse> {
  return new Promise<ExtensionResponse>(function(resolve) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const msg = Object.assign({ type: type }, payload);
        chrome.runtime.sendMessage(msg, function(resp: ExtensionResponse) {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            log('Extension message error: ' + (lastError.message || ''), 'warn');
            resolve({ isOk: false, errorMessage: lastError.message || 'runtime error' });
            return;
          }
          resolve(resp);
        });
        return;
      } catch (e) { logSub('chrome.runtime.sendMessage unavailable, falling through to relay: ' + (e instanceof Error ? e.message : String(e)), 1); }
    }

    // Relay via window.postMessage (content script bridge)
    const requestId = 'pr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);

    const ctx: RelayCtx = {
      settled: false,
      requestId,
      timeout: setTimeout(function() {
        log('Extension relay timed out for ' + type, 'warn');
        finishRelay(ctx, { isOk: false, errorMessage: 'Extension relay timeout' });
      }, 5000),
      resolve,
    };

    ctx._onResponse = function(event: MessageEvent) { handleRelayResponse(ctx, event); };

    window.addEventListener('message', ctx._onResponse);
    window.postMessage({ source: 'marco-controller', requestId: requestId, ...(payload || {}), type: type }, '*');
  });
}

// ============================================
// Prompt loading
// ============================================

/**
 * Try loading prompts via chrome.runtime or relay, returns Promise.
 */
function tryLoadByMessage(type: string): Promise<PromptEntry[] | null> {
  return sendToExtension(type, {}).then(function(response: ExtensionResponse) {
    if (!response) return null;
    const prompts = normalizePromptEntries((response.prompts) as Partial<PromptEntry>[]);
    return prompts.length > 0 ? prompts : null;
  });
}

export function setRevalidateContext(ctx: PromptContext, taskNextDeps: TaskNextDeps): void {
  promptLoaderState.revalidateCtx = { ctx, taskNextDeps };
}

/** Register the renderPromptsDropdown function (called from prompt-dropdown to break circular dep) */
export function setRenderDropdownFn(fn: (ctx: PromptContext, deps: TaskNextDeps) => void): void {
  promptLoaderState.renderDropdownFn = fn;
}

// CQ16: Extracted from loadPromptsFromJson legacy path closure
function finishLegacyLoad(
  prompts: PromptEntry[] | null,
  source: string,
): PromptEntry[] | null {
  promptLoaderState.jsonPromptsLoading = false;
  if (prompts && prompts.length > 0) {
    promptLoaderState.loadedJsonPrompts = prompts;
    log('Loaded ' + prompts.length + ' prompts from ' + source, 'success');
    writePromptCache(prompts as CachedPromptEntry[]).then(function() {
      log('[PromptCache] Cached ' + prompts.length + ' prompts to IndexedDB', 'info');
    });
    promptLoaderState.flushPendingCallbacks(promptLoaderState.loadedJsonPrompts);
    return promptLoaderState.loadedJsonPrompts;
  }
  promptLoaderState.flushPendingCallbacks(null);
  return null;
}

 
export function loadPromptsFromJson(): Promise<PromptEntry[] | null> {
  const loadStartMs = Date.now();

  // ── SDK delegation (preferred path) ──
  const sdk = window.marco as { prompts?: { getAll(): Promise<unknown[]> } } | undefined;
  if (sdk && sdk.prompts && typeof sdk.prompts.getAll === 'function') {
    if (promptLoaderState.loadedJsonPrompts) {
      log('[PromptLoad] ✅ In-memory cache hit (' + promptLoaderState.loadedJsonPrompts.length + ' prompts, 0ms)', 'info');
      return Promise.resolve(promptLoaderState.loadedJsonPrompts);
    }
    log('[PromptLoad] Fetching via SDK marco.prompts.getAll()...', 'info');
    return sdk.prompts.getAll().then(function(entries: unknown[]) {
      const prompts = normalizePromptEntries(entries as Partial<PromptEntry>[]);
      const elapsed = Date.now() - loadStartMs;
      if (prompts.length > 0) {
        promptLoaderState.loadedJsonPrompts = prompts;
        log('[PromptLoad] ✅ SDK returned ' + prompts.length + ' prompts (' + elapsed + 'ms)', 'success');
        promptLoaderState.flushPendingCallbacks(prompts);
        return prompts;
      }
      log('[PromptLoad] ⚠️ SDK returned empty — falling back to defaults (' + elapsed + 'ms)', 'warn');
      promptLoaderState.loadedJsonPrompts = DEFAULT_PROMPTS;
      promptLoaderState.flushPendingCallbacks(DEFAULT_PROMPTS);
      return DEFAULT_PROMPTS;
    }).catch(function(e: unknown) {
      const elapsed = Date.now() - loadStartMs;
      log('[PromptLoad] ❌ SDK prompts.getAll() failed (' + elapsed + 'ms): ' + (e instanceof Error ? e.message : String(e)) + ' — using defaults', 'warn');
      promptLoaderState.loadedJsonPrompts = DEFAULT_PROMPTS;
      promptLoaderState.flushPendingCallbacks(DEFAULT_PROMPTS);
      return DEFAULT_PROMPTS;
    });
  }

  // ── Legacy path (SDK not available) ──
  log('[PromptLoad] SDK not available — using legacy load path', 'info');

  // 1. In-memory cache
  if (promptLoaderState.loadedJsonPrompts) {
    log('[PromptLoad] ✅ In-memory cache hit (' + promptLoaderState.loadedJsonPrompts.length + ' prompts, 0ms)', 'info');
    return Promise.resolve(promptLoaderState.loadedJsonPrompts);
  }
  if (promptLoaderState.jsonPromptsLoading) {
    return new Promise<PromptEntry[] | null>(function(resolve) {
      promptLoaderState.enqueuePendingCallback(resolve);
    });
  }
  promptLoaderState.jsonPromptsLoading = true;

  // 2. Try IndexedDB cache first (instant) — no SWR, no background revalidation
  return readPromptCache().then(function(cached) {
    if (cached && cached.entries && cached.entries.length > 0) {
      promptLoaderState.loadedJsonPrompts = cached.entries as PromptEntry[];
      promptLoaderState.jsonPromptsLoading = false;
      const age = Math.round((Date.now() - cached.fetchedAt) / 1000);
      log('[PromptCache] Loaded ' + cached.entries.length + ' prompts from IndexedDB JsonCopy (age=' + age + 's)', 'success');
      promptLoaderState.flushPendingCallbacks(promptLoaderState.loadedJsonPrompts);

      return promptLoaderState.loadedJsonPrompts;
    }

    // No cache — fetch directly from extension
    log('[PromptCache] No IndexedDB cache — fetching from extension...', 'info');

    return fetchAndCacheFromExtension();
  }).catch(function(e: unknown) {
    logError('loadPrompts', 'Prompt loading failed', e);
    showToast('❌ Prompt loading failed', 'error');
    return fetchAndCacheFromExtension();
  });
}

// ============================================
// Extension fetch with fallback chain
// ============================================

/** Fetch from extension, fall back to preamble or defaults. */
function fetchAndCacheFromExtension(): Promise<PromptEntry[] | null> {
  return tryLoadByMessage('GET_PROMPTS').then(function(prompts: PromptEntry[] | null) {
    if (prompts && prompts.length > 0) {
      return finishLegacyLoad(prompts, 'extension bridge GET_PROMPTS (SQLite)');
    }

    return loadFromPreambleOrDefaults();
  });
}

/** Try __MARCO_PROMPTS__ preamble, then hardcoded defaults. */
function loadFromPreambleOrDefaults(): PromptEntry[] | null {
  const preamble = window.__MARCO_PROMPTS__;
  const hasPreamble = preamble && Array.isArray(preamble) && preamble.length > 0;

  if (hasPreamble) {
    return finishLegacyLoad(normalizePromptEntries(preamble), '__MARCO_PROMPTS__ preamble');
  }

  log('No prompts from bridge or preamble — using hardcoded defaults', 'warn');

  return finishLegacyLoad(DEFAULT_PROMPTS, 'hardcoded DEFAULT_PROMPTS');
}

// ============================================
// Manual Load — forceLoadFromDb
// ============================================

/**
 * Force-load prompts from the extension DB (bypasses in-memory + IndexedDB cache).
 * Called by the "Load" button in the prompt dropdown header.
 */
export function forceLoadFromDb(): Promise<PromptEntry[] | null> {
  log('[PromptLoad] Manual load triggered — clearing caches and fetching from DB...', 'check');
  promptLoaderState.loadedJsonPrompts = null;
  promptLoaderState.jsonPromptsLoading = false;

  return clearPromptCache()
    .then(function() { return clearUISnapshot(); })
    .then(function() { return tryLoadByMessage('GET_PROMPTS'); })
    .then(function(prompts: PromptEntry[] | null) {
      return handleForceLoadResult(prompts);
    });
}

/** Process force-load result and cache it. */
function handleForceLoadResult(prompts: PromptEntry[] | null): PromptEntry[] | null {
  if (prompts && prompts.length > 0) {
    return finishLegacyLoad(prompts, 'manual load from DB');
  }

  log('[PromptLoad] Manual load returned empty — using defaults', 'warn');

  return finishLegacyLoad(DEFAULT_PROMPTS, 'defaults (manual load empty)');
}

// ============================================
// HTML Copy — save rendered dropdown HTML for MacroController
// ============================================

/** Save rendered dropdown HTML as HtmlCopy in IndexedDB. */
export function saveHtmlCopy(options: { html: string; promptCount: number; dataHash: string }): Promise<void> {
  return writeHtmlCopy(options);
}

/**
 * Resolve prompts config from multiple sources.
 */
export function getPromptsConfig(): ResolvedPromptsConfig {
  const promptsCfg = (window.__MARCO_CONFIG__ || {}).prompts || {};
  const rawEntries = (promptsCfg.entries || promptsCfg.prompts || []) as Array<Partial<PromptEntry> & { id?: string; isDefault?: boolean }>;
  let entries: PromptEntry[] = normalizePromptEntries(Array.isArray(rawEntries) ? rawEntries : []);

  const loaded = promptLoaderState.loadedJsonPrompts;

  if (loaded && loaded.length > 0) {
    const merged: PromptEntry[] = loaded.slice();
    const seen: Record<string, boolean> = {};
    for (const prompt of merged) {
      seen[(prompt.name || '').toLowerCase()] = true;
    }

    for (const p of entries) {
      const key = (p.name || '').toLowerCase();

      if (p.name && p.text && !seen[key]) {
        merged.push(p);
        seen[key] = true;
      }
    }
    entries = merged;
  }

  if (entries.length === 0) {
    entries = DEFAULT_PROMPTS;
  }

  return {
    entries: entries,
    pasteTargetXPath: promptsCfg.pasteTargetXPath || (promptsCfg.pasteTarget && promptsCfg.pasteTarget.xpath) || DEFAULT_PASTE_XPATH,
    pasteTargetSelector: promptsCfg.pasteTargetSelector || (promptsCfg.pasteTarget && promptsCfg.pasteTarget.selector) || ''
  };
}
