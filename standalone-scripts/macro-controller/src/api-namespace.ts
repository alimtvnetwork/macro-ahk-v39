/**
 * MacroLoop Controller — API Namespace (Issue 79, Phase 9A–9D)
 *
 * Builds the structured namespace on RiseupAsiaMacroExt.Projects.MacroController
 * and provides write/read helpers. Phase 9D: window.__* globals are NO LONGER
 * written — the namespace is the single source of truth.
 *
 * Namespace structure:
 *   .meta       — version, displayName
 *   .api        — public console API (loop, credits, auth, workspace, ui, config, autoAttach)
 *   ._internal  — internal callbacks NOT for external use
 */

import { VERSION } from './shared-state';
import { logError } from './error-utils';
import { showToast } from './toast';
import { toErrorMessage } from './error-utils';

import type { MacroController } from './core/MacroController';
import type { ControllerState } from './types/config-types';
import type { DiagnosticDump, LoopCreditState } from './types/credit-types';
import type { RenameHistoryEntry } from './types/workspace-types';
import type { AutoAttachGroupRuntime } from './types/ui-types';
import type { IntervalSnapshot } from './interval-registry';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Functions exposed on `api.loop` — loop lifecycle and diagnostics. */
export interface LoopApi {
  start: (direction?: string) => boolean;
  stop: () => boolean;
  check: () => void;
  state: () => ControllerState;
  setInterval: (ms: number) => void;
  diagnostics: () => DiagnosticDump;
}

/** Functions exposed on `api.credits` — credit fetch + state read. */
export interface CreditsApi {
  fetch: (isRetry?: boolean) => void;
  /**
   * Read the latest hydrated credit state. Returns null only when
   * the namespace has been built but no fetch has yet completed.
   * Consumers (e.g. the standalone `lovable-dashboard` script) MUST call `fetch()`
   * once before relying on the returned `perWorkspace` array.
   */
  getState: () => LoopCreditState | null;
}

/** Functions exposed on `api.auth` — authentication token access. */
export interface AuthApi {
  getToken: () => string;
}

/** Functions exposed on `api.workspace` — workspace navigation and rename. */
export interface WorkspaceApi {
  moveTo: (wsId: string, wsName: string) => Promise<void>;
  forceSwitch: (direction: string) => void;
  bulkRename: (template: string, prefix: string, suffix: string, startNum?: number | Record<string, number>) => void;
  getRenameDelay: () => number;
  setRenameDelay: (ms: number) => void;
  cancelRename: () => void;
  undoRename: () => void;
  renameHistory: () => RenameHistoryEntry[];
}

/** Functions exposed on `api.ui` — UI lifecycle and refresh. */
export interface UiApi {
  refreshStatus: () => void;
  startStatusRefresh: () => void;
  stopStatusRefresh: () => void;
  destroy: () => void;
  toast: (message: string, level?: string) => void;
}

/** Functions exposed on `api.config` — runtime configuration setters. */
export interface ConfigApi {
  setProjectButtonXPath: (xpath: string) => void;
  setProgressXPath: (xpath: string) => void;
}

/** Functions exposed on `api.autoAttach` — auto-attach group runner. */
export interface AutoAttachApi {
  runGroup: (group: AutoAttachGroupRuntime) => void;
}

/** Functions exposed on `api.metrics` — runtime diagnostics counters. */
export interface MetricsApi {
  /** Snapshot of currently-active polling intervals (per label + total). */
  intervals: () => IntervalSnapshot;
}

/** The public console API surface of the MacroController namespace. */
export interface MacroControllerApi {
  loop: LoopApi;
  credits: CreditsApi;
  auth: AuthApi;
  workspace: WorkspaceApi;
  ui: UiApi;
  config: ConfigApi;
  autoAttach: AutoAttachApi;
  metrics: MetricsApi;
  mc: MacroController;
  [key: string]: unknown;
}

/** Internal callbacks NOT for external use. */
export interface MacroControllerInternal {
  resolvedToken?: string;
  destroyed?: boolean;
  exportBundle?: string;
  delegateComplete?: () => void;
  updateStartStopBtn?: (running: boolean) => void;
  updateAuthDiag?: () => void;
  createUIWrapper?: () => void;
  createUIManager?: () => object;
  createWorkspaceManager?: () => object;
  createAuthManager?: () => object;
  createCreditManager?: () => object;
  createLoopEngine?: () => object;
  [key: string]: unknown;
}

/** Full namespace shape on RiseupAsiaMacroExt.Projects.MacroController. */
export interface MacroControllerNamespace {
  meta: {
    version: string;
    displayName: string;
  };
  api: MacroControllerApi;
  _internal: MacroControllerInternal;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Typed path map — every valid namespace path with its value type     */
/* ------------------------------------------------------------------ */

/**
 * NsPathMap enumerates every known namespace path and its concrete type.
 * Used by nsWrite / nsReadTyped / nsCallTyped for compile-time safety
 * instead of dynamic `split('.')` traversal.
 */
export interface NsPathMap {
  // _internal
  '_internal.resolvedToken': string;
  '_internal.destroyed': boolean;
  '_internal.exportBundle': string;
  '_internal.delegateComplete': () => void;
  '_internal.updateStartStopBtn': (running: boolean) => void;
  '_internal.updateAuthDiag': () => void;
  '_internal.createUIWrapper': () => void;
  '_internal.createUIManager': () => object;
  '_internal.createWorkspaceManager': () => object;
  '_internal.createAuthManager': () => object;
  '_internal.createCreditManager': () => object;
  '_internal.createLoopEngine': () => object;
  // api (top-level)
  'api.mc': MacroController;
  // api.loop
  'api.loop.start': LoopApi['start'];
  'api.loop.stop': LoopApi['stop'];
  'api.loop.check': LoopApi['check'];
  'api.loop.state': LoopApi['state'];
  'api.loop.setInterval': LoopApi['setInterval'];
  'api.loop.diagnostics': LoopApi['diagnostics'];
  // api.credits
  'api.credits.fetch': CreditsApi['fetch'];
  'api.credits.getState': CreditsApi['getState'];
  // api.auth
  'api.auth.getToken': AuthApi['getToken'];
  // api.workspace
  'api.workspace.moveTo': WorkspaceApi['moveTo'];
  'api.workspace.forceSwitch': WorkspaceApi['forceSwitch'];
  'api.workspace.bulkRename': WorkspaceApi['bulkRename'];
  'api.workspace.getRenameDelay': WorkspaceApi['getRenameDelay'];
  'api.workspace.setRenameDelay': WorkspaceApi['setRenameDelay'];
  'api.workspace.cancelRename': WorkspaceApi['cancelRename'];
  'api.workspace.undoRename': WorkspaceApi['undoRename'];
  'api.workspace.renameHistory': WorkspaceApi['renameHistory'];
  // api.ui
  'api.ui.refreshStatus': UiApi['refreshStatus'];
  'api.ui.startStatusRefresh': UiApi['startStatusRefresh'];
  'api.ui.stopStatusRefresh': UiApi['stopStatusRefresh'];
  'api.ui.destroy': UiApi['destroy'];
  'api.ui.toast': UiApi['toast'];
  // api.config
  'api.config.setProjectButtonXPath': ConfigApi['setProjectButtonXPath'];
  'api.config.setProgressXPath': ConfigApi['setProgressXPath'];
  // api.autoAttach
  'api.autoAttach.runGroup': AutoAttachApi['runGroup'];
  // api.metrics
  'api.metrics.intervals': MetricsApi['intervals'];
}

/* ------------------------------------------------------------------ */
/*  Namespace resolution                                               */
/* ------------------------------------------------------------------ */

// CQ11: Singleton for cached namespace reference
class NamespaceCache {
  private _ns: MacroControllerNamespace | null = null;

  get ns(): MacroControllerNamespace | null {
    return this._ns;
  }

  set ns(v: MacroControllerNamespace | null) {
    this._ns = v;
  }
}

const nsCache = new NamespaceCache();

/**
 * Build a structured, machine-grep-able diagnostic for namespace failures.
 * Format is intentionally multi-line so it is readable in toasts AND in logs.
 *
 * Required fields (per project standard):
 *   - version       : exact MacroController version
 *   - lookup        : full window.* path that was attempted
 *   - missing       : the specific key that was not found / not writable
 *   - calledBy      : caller function + file
 *   - reason        : root-cause diagnosis
 *   - stackFiltered : stack trace with chunk-* / assets/* lines removed
 */
function buildNamespaceDiagnostic(opts: {
  lookup: string;
  missing: string;
  calledBy: string;
  reason: string;
  error?: unknown;
}): string {
  const stack = opts.error instanceof Error && typeof opts.error.stack === 'string'
    ? opts.error.stack
        .split('\n')
        .filter((l) => !/chunk-[a-z0-9]+\.js|\/assets\/[^)]*\.js/i.test(l))
        .slice(0, 6)
        .join('\n')
    : '(no stack)';

  return [
    '❌ [MacroController v' + VERSION + '] Namespace access failed',
    'Lookup:   ' + opts.lookup,
    'Missing:  ' + opts.missing,
    'CalledBy: ' + opts.calledBy,
    'Reason:   ' + opts.reason,
    'Cause:    ' + toErrorMessage(opts.error ?? 'n/a'),
    'Stack:',
    stack,
  ].join('\n');
}

/**
 * Recursively unfreeze a namespace branch by replacing any frozen / non-extensible
 * sub-object with a shallow mutable clone. Returns the (possibly new) mutable root.
 *
 * This handles the collision case where the generic per-project namespace builder
 * pre-registered `Projects.MacroController = Object.freeze({ api: Object.freeze({...}), ... })`
 * before the controller's own runtime namespace had a chance to claim the slot.
 */
function ensureMutableBranch<T extends object>(node: T): T {
  if (Object.isExtensible(node)) {
    // Top-level is mutable — also heal known sub-branches that may be frozen.
    const n = node as unknown as Record<string, unknown>;
    for (const key of ['api', '_internal', 'meta'] as const) {
      const child = n[key];
      if (child && typeof child === 'object' && !Object.isExtensible(child)) {
        n[key] = { ...(child as Record<string, unknown>) };
      }
    }
    return node;
  }
  // Whole node frozen — shallow clone, then heal children.
  const clone = { ...(node as unknown as Record<string, unknown>) };
  for (const key of ['api', '_internal', 'meta'] as const) {
    const child = clone[key];
    if (child && typeof child === 'object' && !Object.isExtensible(child)) {
      clone[key] = { ...(child as Record<string, unknown>) };
    }
  }
  return clone as unknown as T;
}

/**
 * Get or create the MacroController namespace on RiseupAsiaMacroExt.
 * Safe to call multiple times — idempotent.
 */
// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity -- namespace bootstrap: cache check + window guards + Projects.MacroController hydration all need shared scope
export function getNamespace(): MacroControllerNamespace | null {
  if (nsCache.ns) return nsCache.ns;

  const root = (typeof window !== 'undefined'
    ? (window as Window).RiseupAsiaMacroExt
    : undefined) as RiseupAsiaMacroExtNamespace | undefined;

  if (!root) {
    logError('getNamespace', buildNamespaceDiagnostic({
      lookup: 'window.RiseupAsiaMacroExt',
      missing: 'RiseupAsiaMacroExt (root SDK namespace)',
      calledBy: 'getNamespace() @ api-namespace.ts',
      reason: 'SDK script (marco-sdk.js) has not executed yet in this MAIN-world context',
    }));
    return null;
  }
  if (!root.Projects) {
    logError('getNamespace', buildNamespaceDiagnostic({
      lookup: 'window.RiseupAsiaMacroExt.Projects',
      missing: 'Projects (project registry container)',
      calledBy: 'getNamespace() @ api-namespace.ts',
      reason: 'SDK initialized but Projects container missing — likely a partial SDK build',
    }));
    return null;
  }

  try {
    const existing = root.Projects.MacroController as Record<string, unknown> | undefined;
    if (!existing) {
      root.Projects.MacroController = {
        meta: { version: VERSION, displayName: 'Macro Controller' },
        api: {} as MacroControllerApi,
        _internal: {} as MacroControllerInternal,
      } as unknown as RiseupAsiaProject;
    } else {
      // Heal frozen branches (collision with generic namespace builder).
      const healed = ensureMutableBranch(existing);
      if (healed !== existing) {
        root.Projects.MacroController = healed as unknown as RiseupAsiaProject;
      }
    }

    const mc = root.Projects.MacroController as unknown as MacroControllerNamespace;

    if (!mc.meta || typeof mc.meta !== 'object' || !Object.isExtensible(mc.meta)) mc.meta = { version: '', displayName: '' };
    if (!mc.api || typeof mc.api !== 'object' || !Object.isExtensible(mc.api)) mc.api = {} as MacroControllerApi;
    const api = mc.api;
    if (!api.loop || typeof api.loop !== 'object' || !Object.isExtensible(api.loop)) api.loop = {} as LoopApi;
    if (!api.credits || typeof api.credits !== 'object' || !Object.isExtensible(api.credits)) api.credits = {} as CreditsApi;
    if (!api.auth || typeof api.auth !== 'object' || !Object.isExtensible(api.auth)) api.auth = {} as AuthApi;
    if (!api.workspace || typeof api.workspace !== 'object' || !Object.isExtensible(api.workspace)) api.workspace = {} as WorkspaceApi;
    if (!api.ui || typeof api.ui !== 'object' || !Object.isExtensible(api.ui)) api.ui = {} as UiApi;
    if (!api.config || typeof api.config !== 'object' || !Object.isExtensible(api.config)) api.config = {} as ConfigApi;
    if (!api.autoAttach || typeof api.autoAttach !== 'object' || !Object.isExtensible(api.autoAttach)) api.autoAttach = {} as AutoAttachApi;
    if (!mc._internal || typeof mc._internal !== 'object' || !Object.isExtensible(mc._internal)) mc._internal = {} as MacroControllerInternal;

    mc.meta.version = VERSION;
    mc.meta.displayName = 'Macro Controller';

    nsCache.ns = mc;
    return nsCache.ns;
  } catch (e) {
    const diag = buildNamespaceDiagnostic({
      lookup: 'window.RiseupAsiaMacroExt.Projects.MacroController',
      missing: 'mutable MacroController namespace (write into a frozen sub-object failed)',
      calledBy: 'getNamespace() @ api-namespace.ts (called from nsWrite/nsReadTyped/macro-looping bootstrap)',
      reason: 'A frozen object (likely registered by the generic per-project namespace builder) blocks runtime initialization. Healing pass attempted but assignment still threw.',
      error: e,
    });
    logError('getNamespace', diag, e);
    // Single toast — short user-visible summary, full diagnostic stays in the log.
    showToast('❌ [MacroController v' + VERSION + '] Namespace blocked at Projects.MacroController — see console for full diagnostic.', 'error');
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Typed write/read helpers (no dynamic path traversal)               */
/* ------------------------------------------------------------------ */

/**
 * Write a value to a typed namespace path.
 * Phase 10: replaces dynamic `dualWrite` — all paths are compile-time checked.
 */
export function nsWrite<P extends keyof NsPathMap>(path: P, value: NsPathMap[P]): void {
  const ns = getNamespace();
  if (!ns) return;

  // 2-segment: _internal.* or api.mc
  const dot1 = path.indexOf('.');
  const dot2 = path.indexOf('.', dot1 + 1);

  if (dot2 === -1) {
    // _internal.key or api.key
    const section = path.slice(0, dot1);
    const key = path.slice(dot1 + 1);
    if (section === '_internal') {
      ns._internal[key as keyof MacroControllerInternal] = value as MacroControllerInternal[keyof MacroControllerInternal];
    } else {
      ns.api[key as keyof MacroControllerApi] = value as MacroControllerApi[keyof MacroControllerApi];
    }
  } else {
    // 3-segment: api.section.key
    const section = path.slice(dot1 + 1, dot2) as keyof MacroControllerApi;
    const key = path.slice(dot2 + 1);
    const target = ns.api[section];
    if (target && typeof target === 'object') {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

/**
 * Read a value from a typed namespace path.
 * Phase 10: replaces dynamic `nsRead` — all paths are compile-time checked.
 */
export function nsReadTyped<P extends keyof NsPathMap>(path: P): NsPathMap[P] | undefined {
  const ns = getNamespace();
  if (!ns) return undefined;

  const dot1 = path.indexOf('.');
  const dot2 = path.indexOf('.', dot1 + 1);

  if (dot2 === -1) {
    const section = path.slice(0, dot1);
    const key = path.slice(dot1 + 1);
    if (section === '_internal') {
      return ns._internal[key as keyof MacroControllerInternal] as NsPathMap[P] | undefined;
    }
    return ns.api[key as keyof MacroControllerApi] as NsPathMap[P] | undefined;
  }

  const section = path.slice(dot1 + 1, dot2) as keyof MacroControllerApi;
  const key = path.slice(dot2 + 1);
  const target = ns.api[section];
  if (target && typeof target === 'object') {
    return (target as Record<string, unknown>)[key] as NsPathMap[P] | undefined;
  }
  return undefined;
}

/**
 * Call a function stored at a typed namespace path.
 * Phase 10: replaces dynamic `nsCall` — all paths are compile-time checked.
 * No-op if the function doesn't exist.
 */
export function nsCallTyped<P extends keyof NsPathMap>(
  path: P,
  ...args: NsPathMap[P] extends (...a: infer A) => unknown ? A : never[]
): NsPathMap[P] extends (...a: never[]) => infer R ? R | undefined : undefined {
  const fn = nsReadTyped(path);
  if (typeof fn === 'function') {
    return (fn as (...a: unknown[]) => unknown)(...args) as NsPathMap[P] extends (...a: never[]) => infer R ? R | undefined : undefined;
  }
  return undefined as NsPathMap[P] extends (...a: never[]) => infer R ? R | undefined : undefined;
}

/* ------------------------------------------------------------------ */
/*  Legacy aliases (deprecated — use nsWrite / nsReadTyped / nsCallTyped) */
/* ------------------------------------------------------------------ */

/** @deprecated Use nsWrite() instead. */
export function dualWrite(_windowKey: string, nsPath: string, value: unknown): void {
  nsWrite(nsPath as keyof NsPathMap, value as NsPathMap[keyof NsPathMap]);
}

/** @deprecated Use nsWrite() in a loop instead. */
export function dualWriteAll(entries: Array<[string, string, unknown]>): void {
  for (const [, nsPath, value] of entries) {
    nsWrite(nsPath as keyof NsPathMap, value as NsPathMap[keyof NsPathMap]);
  }
}

/** @deprecated Use nsReadTyped() instead. */
export function nsRead(_windowKey: string, nsPath: string): unknown {
  return nsReadTyped(nsPath as keyof NsPathMap);
}

/** @deprecated Use nsCallTyped() instead. */
export function nsCall(_windowKey: string, nsPath: string, ...args: unknown[]): unknown {
  const fn = nsReadTyped(nsPath as keyof NsPathMap);
  if (typeof fn === 'function') return (fn as (...a: unknown[]) => unknown)(...args);
}
