/* eslint-disable @typescript-eslint/no-explicit-any -- chrome runtime detection via globalThis */
import type { ScriptEntry } from "@/shared/project-types";
import type { InjectScriptsResponse, InjectionResult } from "@/shared/injection-types";
import { normalizeInjectScriptsResponse } from "@/shared/injection-types";
import { useState, useCallback, useRef } from "react";
import { sendMessage } from "@/lib/message-client";
import { getPlatform } from "@/platform";
import { toast } from "sonner";
import { logError } from "./popup-logger";
import {
  exportAllAsSqliteZip,
  importFromSqliteZip,
  mergeFromSqliteZip,
  previewSqliteZip,
  type BundlePreview,
} from "@/lib/sqlite-bundle";

export interface InjectionResultSummary {
  scriptId: string;
  scriptName?: string;
  isSuccess: boolean;
  skipReason?: string;
}

/**
 * Local row alias — the popup only consumes a subset of `InjectionResult`
 * fields, but the alias guarantees we stay structurally compatible with
 * the shared type. If `InjectionResult` ever drops one of these fields,
 * TypeScript will fail this assignment.
 */
type InjectionResultEntry = Pick<
  InjectionResult,
  "scriptId" | "scriptName" | "isSuccess" | "errorMessage" | "skipReason" | "durationMs"
>;

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// eslint-disable-next-line max-lines-per-function
export function usePopupActions() {
  const [logsLoading, setLogsLoading] = useState(false);
  const [lastRunResults, setLastRunResults] = useState<InjectionResultSummary[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [dbExportLoading, setDbExportLoading] = useState(false);
  const [dbImportLoading, setDbImportLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [reinjectLoading, setReinjectLoading] = useState(false);
  const [importPreview, setImportPreview] = useState<BundlePreview | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const fileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importModeRef = useRef<"merge" | "replace">("replace");

  /** Run all enabled scripts into the active tab. */
  // eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
  const handleRun = useCallback(async (options?: { forceReload?: boolean }) => {
    const isForce = options?.forceReload === true;
    setRunLoading(true);
    setLastRunResults([]);
    console.log("[popup:handleRun] Starting injection flow...%s", isForce ? " (FORCE RUN)" : "");
    try {
      const platform = getPlatform();
      const tabId = await platform.tabs.getActiveTabId();
      console.log("[popup:handleRun] Active tab ID:", tabId);

      if (tabId === null) {
        logError("handleRun", "No active tab found\n  Path: chrome.tabs.query(active)\n  Missing: active tab id\n  Reason: getActiveTabId() returned null");
        toast.error("No active tab found");
        return;
      }

      console.log("[popup:handleRun] Fetching active project...");
      const projRes = await sendMessage<{
        activeProject?: { scripts?: ScriptEntry[] } | null;
      }>({ type: "GET_ACTIVE_PROJECT" });
      console.log("[popup:handleRun] Active project response:", JSON.stringify(projRes?.activeProject?.scripts?.length ?? 0), "scripts");

      const scripts = projRes?.activeProject?.scripts ?? [];
      if (!Array.isArray(scripts) || scripts.length === 0) {
        logError("handleRun", "No scripts found in active project\n  Path: GET_ACTIVE_PROJECT response.activeProject.scripts\n  Missing: at least one ScriptEntry\n  Reason: scripts array is empty or missing");
        toast.error("No scripts to run — check your active project");
        return;
      }

      console.log("[popup:handleRun] Sending INJECT_SCRIPTS for tab %d with %d scripts...%s", tabId, scripts.length, isForce ? " forceReload=true" : "");
      const rawResult = await sendMessage<InjectScriptsResponse>({
        type: "INJECT_SCRIPTS",
        tabId,
        scripts,
        launchSource: "manual",
        ...(isForce ? { forceReload: true } : {}),
      });
      // Normalize tolerates older backgrounds that omit
      // `inlineSyntaxErrorDetected` — without this, downstream
      // `if (result.inlineSyntaxErrorDetected)` checks would silently
      // misbehave when talking to a pre-flag service worker.
      const result = normalizeInjectScriptsResponse(rawResult);
      if (result.inlineSyntaxFlagSource === "legacy-default") {
        console.warn(
          "[popup:handleRun] Background did not return inlineSyntaxErrorDetected — falling back to false (older background build).",
        );
      }
      console.log("[popup:handleRun] Injection result: %d scripts, inlineSyntaxErrorDetected=%s (source=%s)",
        result.results.length, result.inlineSyntaxErrorDetected, result.inlineSyntaxFlagSource);

      setLastRunResults(
        result.results.map((r) => ({
          scriptId: r.scriptId,
          scriptName: r.scriptName,
          isSuccess: r.isSuccess,
          skipReason: r.skipReason,
        })),
      );

      const successes = result.results.filter((r) => r.isSuccess).length;
      const failures = result.results.filter((r) => !r.isSuccess && !r.skipReason).length;
      const skipped = result.results.filter((r) => r.skipReason).length;

      if (failures > 0) {
        const failedNames = result.results
          .filter((r) => !r.isSuccess && !r.skipReason)
          .map((r) => `${r.scriptName ?? r.scriptId}: ${r.errorMessage ?? "unknown"}`)
          .join("\n");
        toast.error(`${failures} script(s) failed:\n${failedNames}`);
      } else {
        if (successes > 0 && skipped === 0) {
          toast.success("✅ " + successes + " injected");
        } else if (successes > 0 && skipped > 0) {
          const skipDetails = result.results
            .filter((r) => r.skipReason)
            .map((r) => `${r.scriptName ?? r.scriptId}: ${formatSkipReason(r.skipReason)}`)
            .join("\n");
          toast.success(`✅ ${successes} injected, ${skipped} skipped:\n${skipDetails}`);
        } else if (skipped > 0) {
          const skipDetails = result.results
            .filter((r) => r.skipReason)
            .map((r) => `${r.scriptName ?? r.scriptId}: ${formatSkipReason(r.skipReason)}`)
            .join("\n");
          toast.error(`⚠️ 0 injected, ${skipped} skipped:\n${skipDetails}`);
        } else {
          toast.info("No scripts were processed");
        }
      }
    } catch (err) {
      logError("handleRun", `Run failed\n  Path: usePopupActions.handleRun → INJECT_SCRIPTS\n  Missing: completed injection round-trip\n  Reason: ${err instanceof Error ? err.message : String(err)}`, err);
      const msg = err instanceof Error ? err.message : "Run failed";
      toast.error(msg);
    } finally {
      setRunLoading(false);
    }
  }, []);

function formatSkipReason(reason?: string): string {
  switch (reason) {
    case "disabled": return "script is disabled";
    case "missing": return "script not found in store — try reinstalling the extension";
    case "empty_code": return "script code is empty — filePath fetch may have failed";
    case "resolver_mismatch": return "script format not recognized";
    default: return reason ?? "unknown reason";
  }
}

  /** Re-inject: same as run — injection pipeline handles version-check teardown. */
  const handleReinject = useCallback(async () => {
    setReinjectLoading(true);
    try {
      await handleRun();
    } finally {
      setReinjectLoading(false);
    }
  }, [handleRun]);

  /** Force Run: bypasses the IndexedDB cache gate, rebuilds from scratch. */
  const handleForceRun = useCallback(async () => {
    await handleRun({ forceReload: true });
  }, [handleRun]);

  const handleViewLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await sendMessage<{
        sessionId: string;
        logs: Record<string, string | number | null>[];
        errors: Record<string, string | number | null>[];
      }>({ type: "GET_SESSION_LOGS" });

      const logCount = data.logs?.length ?? 0;
      const errorCount = data.errors?.length ?? 0;
      toast.info(`Session ${data.sessionId}: ${logCount} logs, ${errorCount} errors`);

      const win = globalThis as any;
      const hasChromeRuntime = win.chrome?.runtime?.getURL;
      const optionsUrl = hasChromeRuntime
        ? win.chrome.runtime.getURL("src/options/options.html#activity")
        : "/#activity";
      window.open(optionsUrl, "_blank");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load logs";
      toast.error(msg);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const handleExport = useCallback(async () => {
    setExportLoading(true);
    try {
      const zipRes = await sendMessage<{
        dataUrl: string | null;
        filename: string;
      }>({ type: "EXPORT_LOGS_ZIP" });

      if (zipRes.dataUrl) {
        triggerDownload(zipRes.dataUrl, zipRes.filename);
        toast.success(`Exported ${zipRes.filename}`);
        return;
      }

      const jsonRes = await sendMessage<{
        json: string;
        filename: string;
      }>({ type: "EXPORT_LOGS_JSON" });

      const blob = new Blob([jsonRes.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, jsonRes.filename);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${jsonRes.filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      toast.error(msg);
    } finally {
      setExportLoading(false);
    }
  }, []);

  const handleDbExport = useCallback(async () => {
    setDbExportLoading(true);
    try {
      await exportAllAsSqliteZip();
      toast.success("SQLite bundle exported");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "DB export failed";
      toast.error(msg);
    } finally {
      setDbExportLoading(false);
    }
  }, []);

  const handleDbImport = useCallback((mode: "merge" | "replace") => {
    importModeRef.current = mode;

    if (!fileInputRef.current) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".zip";
      input.style.display = "none";
      input.addEventListener("change", handleFileSelected);
      document.body.appendChild(input);
      fileInputRef.current = input;
    }

    fileInputRef.current.value = "";
    fileInputRef.current.click();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileSelected = useCallback(async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    fileRef.current = file;
    setPreviewLoading(true);
    setImportPreviewOpen(true);
    setImportPreview(null);

    try {
      const preview = await previewSqliteZip(file);
      setImportPreview(preview);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to read bundle";
      toast.error(msg);
      setImportPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleConfirmImport = useCallback(async () => {
    const file = fileRef.current;
    if (!file) return;

    const mode = importModeRef.current;
    setDbImportLoading(true);

    try {
      const importFn = mode === "merge" ? mergeFromSqliteZip : importFromSqliteZip;
      const result = await importFn(file);
      toast.success(
        `Imported ${result.projectCount} projects, ${result.scriptCount} scripts, ${result.configCount} configs, ${result.promptCount} prompts (${mode})`
      );
      setImportPreviewOpen(false);
      setImportPreview(null);
      fileRef.current = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "DB import failed";
      toast.error(msg);
    } finally {
      setDbImportLoading(false);
    }
  }, []);

  const handleCancelImport = useCallback(() => {
    setImportPreviewOpen(false);
    setImportPreview(null);
    fileRef.current = null;
  }, []);

  return {
    logsLoading,
    exportLoading,
    dbExportLoading,
    dbImportLoading,
    previewLoading,
    runLoading,
    reinjectLoading,
    importPreview,
    importPreviewOpen,
    setImportPreviewOpen,
    importMode: importModeRef,
    handleViewLogs,
    handleExport,
    handleDbExport,
    handleDbImport,
    handleRun,
    handleReinject,
    handleForceRun,
    lastRunResults,
    handleConfirmImport,
    handleCancelImport,
  };
}
