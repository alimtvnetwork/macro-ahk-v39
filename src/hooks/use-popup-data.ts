import { useEffect, useState, useCallback } from "react";
import { sendMessage } from "@/lib/message-client";
import { freezeClickTrail, readFrozenClickTrail, type ClickTrailEntry } from "@/lib/click-trail";
import { logError } from "./hook-logger";

interface ActiveProjectData {
  activeProject: {
    id: string;
    name: string;
    version: string;
    description?: string;
    isGlobal?: boolean;
  } | null;
  allProjects: Array<{
    id: string;
    name: string;
    version: string;
    description?: string;
    isGlobal?: boolean;
  }>;
}

interface InjectionStatus {
  scriptIds: string[];
  timestamp: string;
  projectId: string;
  injectionPath?: string;
  domTarget?: string;
  pipelineDurationMs?: number;
  budgetMs?: number;
  verification?: {
    marcoSdk: boolean;
    extRoot: boolean;
    mcClass: boolean;
    mcInstance: boolean;
    uiContainer: boolean;
    markerEl: boolean;
    verifiedAt: string;
  };
}

interface PopupScript {
  id: string;
  name: string;
  order: number;
  isEnabled: boolean;
  runAt?: string;
}

interface BootErrorContext {
  sql: string | null;
  migrationVersion: number | null;
  migrationDescription: string | null;
  scope: string | null;
}

interface WasmProbeResult {
  url: string;
  status: number | null;
  contentLength: string | null;
  headError: string | null;
  ok: boolean;
  at: string;
}

interface StatusData {
  connection: string;
  token: { status: string; expiresIn: string | null };
  config: { status: string; source: string; lastSyncAt?: string | null };
  loggingMode: string;
  version: string;
  latencyMs?: number;
  bootStep?: string;
  /** Underlying error message if boot failed; null/undefined when boot succeeded. */
  bootError?: string | null;
  /** Underlying error stack trace if boot failed; null/undefined when unavailable. */
  bootErrorStack?: string | null;
  /** Structured operation context (failing SQL/migration step), null/undefined when unavailable. */
  bootErrorContext?: BootErrorContext | null;
  /** Snapshot of the upfront HEAD probe against the bundled WASM asset. */
  wasmProbe?: WasmProbeResult | null;
}

interface OpfsStatusData {
  sessionId: string | null;
  dirExists: boolean;
  files: Array<{ name: string; absolutePath: string; sizeBytes: number; exists: boolean }>;
  healthy: boolean;
}

interface HealthData {
  state: string;
  details: string[];
}

export type { ActiveProjectData, InjectionStatus, PopupScript, StatusData, HealthData, OpfsStatusData, WasmProbeResult };

/**
 * Persisted boot-failure payload mirrored from chrome.storage.local
 * (`marco_last_boot_failure`). Used as a fallback when GET_STATUS races
 * against a fresh service-worker restart and as the source of `failureId`
 * for snapshotting the click trail.
 */
interface PersistedBootFailure {
  step: string;
  message: string;
  stack: string | null;
  at: string;
  failureId: string;
  context: BootErrorContext | null;
  /** WASM HEAD probe captured at the time of the failure. */
  wasmProbe?: WasmProbeResult | null;
}

// eslint-disable-next-line max-lines-per-function
export function usePopupData() {
  const [projectData, setProjectData] = useState<ActiveProjectData | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [opfsStatus, setOpfsStatus] = useState<OpfsStatusData | null>(null);
  const [injections, setInjections] = useState<InjectionStatus | null>(null);
  const [scripts, setScripts] = useState<PopupScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [frozenTrail, setFrozenTrail] = useState<ClickTrailEntry[] | null>(null);
  const [persistedFailure, setPersistedFailure] = useState<PersistedBootFailure | null>(null);

  const refresh = useCallback(async () => {
    const t0 = performance.now();
    const [statusRes, healthRes, projRes, scriptsRes, settingsRes] = await Promise.all([
      sendMessage<StatusData>({ type: "GET_STATUS" }),
      sendMessage<HealthData>({ type: "GET_HEALTH_STATUS" }),
      sendMessage<ActiveProjectData>({ type: "GET_ACTIVE_PROJECT" }),
      sendMessage<{ scripts: PopupScript[] }>({ type: "GET_ALL_SCRIPTS" }),
      sendMessage<{ settings?: { debugMode?: boolean } }>({ type: "GET_SETTINGS" }).catch(() => ({ settings: undefined })),
    ]);
    const latencyMs = Math.round(performance.now() - t0);

    setStatus({ ...statusRes, latencyMs });
    setHealth(healthRes);
    setProjectData(projRes);
    setDebugMode(settingsRes.settings?.debugMode === true);

    const enrichedScripts = scriptsRes.scripts.map((s) => ({
      ...s,
      isEnabled: s.isEnabled !== false,
    }));
    setScripts(enrichedScripts);
    setLoading(false);

    // Boot-failure recovery: read the persisted payload (survives SW restarts)
    // and freeze the live click trail under the failure's stable ID so the
    // banner always shows actions captured at the moment of failure — even
    // after the user keeps interacting with the popup.
    void hydrateBootFailureSnapshot(statusRes, setPersistedFailure, setFrozenTrail);

    // Non-critical fetches off the critical path — UI is already visible
    sendMessage<OpfsStatusData>({ type: "GET_OPFS_STATUS" })
      .then((res) => setOpfsStatus(res))
      .catch(() => setOpfsStatus(null));

    sendMessage<{ injections: Record<number, InjectionStatus> }>({
      type: "GET_TAB_INJECTIONS",
      tabId: 0,
    })
      .then((res) => setInjections(Object.values(res.injections)[0] ?? null))
      .catch(() => setInjections(null));
  }, []);

  const setActiveProject = useCallback(async (projectId: string) => {
    await sendMessage({ type: "SET_ACTIVE_PROJECT", projectId });
    await refresh();
  }, [refresh]);

  const toggleScript = useCallback(async (scriptId: string) => {
    setScripts((prev) =>
      prev.map((s) => {
        const isTarget = s.id === scriptId;
        return isTarget ? { ...s, isEnabled: !s.isEnabled } : s;
      }),
    );

    await sendMessage({ type: "TOGGLE_SCRIPT", id: scriptId });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Effective values: prefer live status; fall back to persisted payload when
  // the SW has restarted and bootStep/bootError are not yet populated again.
  const effectiveBootStep = status?.bootStep ?? (persistedFailure ? `failed:${persistedFailure.step}` : undefined);
  const effectiveBootError = status?.bootError ?? persistedFailure?.message ?? null;
  const effectiveBootErrorStack = status?.bootErrorStack ?? persistedFailure?.stack ?? null;
  const effectiveBootErrorContext = status?.bootErrorContext ?? persistedFailure?.context ?? null;
  const effectiveWasmProbe = status?.wasmProbe ?? persistedFailure?.wasmProbe ?? null;
  // Stable correlation handles for support reports — preserved across SW
  // restarts and popup re-opens via marco_last_boot_failure.
  const effectiveFailureId = persistedFailure?.failureId ?? null;
  const effectiveFailureAt = persistedFailure?.at ?? null;

  return {
    projectData,
    status,
    health,
    opfsStatus,
    injections,
    scripts,
    loading,
    debugMode,
    refresh,
    setActiveProject,
    toggleScript,
    /** Frozen click-trail snapshot captured at the moment of the active boot failure. */
    frozenTrail,
    /** Effective boot diagnostics (live status overlaid on the persisted payload). */
    effectiveBootStep,
    effectiveBootError,
    effectiveBootErrorStack,
    effectiveBootErrorContext,
    /** WASM HEAD probe snapshot — captured at boot, persisted across SW restarts. */
    effectiveWasmProbe,
    /** Stable failure fingerprint (`failed:<step>|<msg-prefix>`) — null when boot succeeded or no record persisted. */
    effectiveFailureId,
    /** ISO timestamp of when the failure was first persisted. */
    effectiveFailureAt,
  };
}

/**
 * Reads the persisted boot-failure payload from chrome.storage.local and, if
 * present, freezes the current sessionStorage click trail under the failure's
 * stable `failureId`. Subsequent popup re-opens prefer the frozen snapshot so
 * the "Recent actions" list never drifts away from what was on screen when
 * the failure occurred.
 *
 * No-ops on success boots, when chrome.storage is unavailable, or when the
 * payload is malformed.
 */
async function hydrateBootFailureSnapshot(
  statusRes: StatusData,
  setPersistedFailure: (p: PersistedBootFailure | null) => void,
  setFrozenTrail: (t: ClickTrailEntry[] | null) => void,
): Promise<void> {
  const liveFailed = typeof statusRes.bootStep === "string" && statusRes.bootStep.startsWith("failed:");

  try {
    const chromeRef: typeof chrome | undefined = typeof chrome !== "undefined" ? chrome : undefined;
    if (chromeRef?.storage?.local === undefined) {
      // Preview / non-extension context — fall back to live state alone.
      if (liveFailed) {
        const id = `${statusRes.bootStep}|${(statusRes.bootError ?? "").slice(0, 80)}`;
        setFrozenTrail(freezeClickTrail(id));
      }
      return;
    }

    const stored = await chromeRef.storage.local.get("marco_last_boot_failure");
    const payload = stored.marco_last_boot_failure as PersistedBootFailure | undefined;

    // No persisted failure AND no live failure → nothing to do.
    if (payload === undefined && liveFailed === false) {
      setPersistedFailure(null);
      setFrozenTrail(null);
      return;
    }

    if (payload !== undefined) {
      setPersistedFailure(payload);
      const existing = readFrozenClickTrail(payload.failureId);
      setFrozenTrail(existing ?? freezeClickTrail(payload.failureId));
      return;
    }

    // Live failure but no persisted record yet (race) — synthesise an ID.
    const fallbackId = `${statusRes.bootStep}|${(statusRes.bootError ?? "").slice(0, 80)}`;
    setFrozenTrail(freezeClickTrail(fallbackId));
  } catch (caught) {
    logError("usePopupData.hydrateBootFailureSnapshot", "chrome.storage read failed mid-boot-failure — frozen click trail unavailable, UI will degrade gracefully", caught);
  }
}
