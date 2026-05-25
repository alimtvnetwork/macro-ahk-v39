/**
 * Global type declarations for MacroLoop Controller.
 * Extends the Window interface with runtime-injected globals.
 *
 * Phase 9D: All window.__* globals removed except __comboForceInject.
 * APIs live on RiseupAsiaMacroExt.Projects.MacroController.api.*
 *
 * Config/Theme types are imported from ./types.ts — no duplicate definitions.
 */

import type { MacroControllerConfig, MacroThemeRoot, PromptEntry } from './types';

declare global {

interface XPathUtilsAPI {
  version: string;
  setLogger: (info: (fn: string, msg: string) => void, sub: (fn: string, msg: string) => void, warn: (fn: string, msg: string) => void) => void;
  reactClick: (el: Element, xpath?: string) => void;
}

interface MarcoSDKPromptEntry {
  id?: string;
  name: string;
  text: string;
  category?: string;
  categories?: string;
  version?: string;
  order?: number;
  isDefault?: boolean;
  isFavorite?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface MarcoSDKPromptsApi {
  getAll(): Promise<MarcoSDKPromptEntry[]>;
  save(prompt: { name: string; text: string; category?: string; id?: string }): Promise<MarcoSDKPromptEntry>;
  delete(id: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
  inject(text: string, options?: { pasteTargetXPath?: string; pasteTargetSelector?: string }): boolean;
  getConfig(): Promise<{ entries: MarcoSDKPromptEntry[]; pasteTargetXPath: string; pasteTargetSelector: string }>;
  invalidateCache(): Promise<void>;
  preWarm(): Promise<MarcoSDKPromptEntry[]>;
}

interface MarcoSDKApiResponse<T = unknown> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
  readonly headers: Record<string, string>;
}

interface MarcoSDKApiCallOptions {
  params?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  baseUrl?: string;
  timeoutMs?: number;
}

interface MarcoSDKApiCredits {
  fetchWorkspaces(options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
  fetchBalance(wsId: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
  resolve(wsId: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
}

interface MarcoSDKApiWorkspace {
  move(projectId: string, targetWsId: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
  rename(wsId: string, newName: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
  markViewed(projectId: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
  probe(options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
  resolveByProject(projectId: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
  switchContext(wsId: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
}

interface MarcoSDKApiMemberships {
  search(wsId: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
}

interface MarcoSDKApiProjects {
  list(wsId: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
  get(projectId: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
}

interface MarcoSDKRemixInitBody {
  workspaceId: string;
  projectName: string;
  includeHistory: boolean;
  includeCustomKnowledge: boolean;
}

interface MarcoSDKApiRemix {
  init(projectId: string, body: MarcoSDKRemixInitBody, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse>;
}

interface MarcoSDKApiModule {
  call<T = unknown>(path: string, options?: MarcoSDKApiCallOptions): Promise<MarcoSDKApiResponse<T>>;
  credits: MarcoSDKApiCredits;
  workspace: MarcoSDKApiWorkspace;
  memberships: MarcoSDKApiMemberships;
  projects: MarcoSDKApiProjects;
  remix: MarcoSDKApiRemix;
}

interface MarcoSDKAuthResolutionDiag {
  source: 'bridge' | 'localStorage' | 'none';
  durationMs: number;
  bridgeOutcome: 'hit' | 'timeout' | 'error' | 'skipped';
}

interface MarcoSDK {
  auth?: {
    getToken(): Promise<string | null>;
    getSource(): Promise<string>;
    refresh(): Promise<string | null>;
    isExpired(): Promise<boolean>;
    getJwtPayload(): Promise<Record<string, unknown> | null>;
    getLastAuthDiag(): MarcoSDKAuthResolutionDiag | null;
  };
  authUtils?: MarcoSDKAuthTokenUtils;
  api?: MarcoSDKApiModule;
  notify?: {
    toast(message: string, level?: string, opts?: Record<string, unknown>): void;
    dismissAll(): void;
    onError(callback: (error: unknown) => void): void;
    getRecentErrors(): unknown[];
    _setStopLoopCallback(fn: () => void): void;
    _setVersion(v: string): void;
    [key: string]: unknown;
  };
  prompts?: MarcoSDKPromptsApi;
  utils?: {
    withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T>;
    withRetry<T>(fn: () => Promise<T>, options: Record<string, unknown>): Promise<T>;
    createConcurrencyLock<T>(): unknown;
    delay(ms: number): Promise<void>;
    pollUntil<T>(condition: () => T | null | undefined | false, options?: Record<string, unknown>): Promise<T | null>;
    waitForElement(options: Record<string, unknown>): Promise<Element | null>;
    debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void;
    throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void;
    safeJsonParse<T>(json: string, fallback: T): T;
    formatDuration(ms: number): string;
    uid(prefix?: string): string;
    deepClone<T>(value: T): T;
    isObject(value: unknown): value is Record<string, unknown>;
    [key: string]: unknown;
  };
}

// (declare global block opened at top of file)
  interface MacroControllerFacade {
    getInstance?: () => unknown;
    hasInstance?: () => boolean;
    [key: string]: unknown;
  }

  interface MarcoSDKAuthTokenUtils {
    normalizeBearerToken(raw: string): string;
    isJwtToken(raw: string): boolean;
    isUsableToken(raw: string): boolean;
    extractBearerTokenFromUnknown(raw: unknown): string;
    scanSupabaseLocalStorage(
      onFound?: (key: string, tokenLength: number) => void,
      onScanError?: (error: unknown) => void,
    ): string;
    extractSupabaseTokenFromRaw(
      key: string,
      raw: string,
      onFound?: (key: string, tokenLength: number) => void,
    ): string;
  }

  interface Window {
    __MARCO_CONFIG__: MacroControllerConfig;
    __MARCO_THEME__: MacroThemeRoot;
    __MARCO_PROMPTS__?: PromptEntry[];
    XPathUtils: XPathUtilsAPI;

    /** Cached credit bar HTML to avoid re-rendering on every UI update */
    _creditBarCache?: { key: string; html: string };

    // Kept on window — must be set BEFORE script injection
    __comboForceInject?: boolean;

    /** Set by message-relay content script when active */
    __marcoRelayActive?: boolean;

    /** Injection launch source set by the extension before user script execution */
    __MARCO_LAUNCH_SOURCE__?: 'manual' | 'passive';

    // MacroController class — proper name, not a __* global
    MacroController: MacroControllerFacade;

    // Marco SDK (injected by marco-sdk.js)
    marco?: MarcoSDK;

    // SDK namespace
    RiseupAsiaMacroExt?: RiseupAsiaMacroExtNamespace;
  }

  /**
   * NOTE: RiseupAsiaCookieBinding, RiseupAsiaProject, RiseupAsiaMacroExtNamespace,
   * and the bare `RiseupAsiaMacroExt` global are declared in the shared file:
   *   standalone-scripts/types/riseup-namespace.d.ts
   * Do not re-declare them here — TypeScript will merge interfaces but
   * duplicate `const` declarations are an error.
   */
}

export {};
