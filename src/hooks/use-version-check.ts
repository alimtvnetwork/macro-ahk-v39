/* eslint-disable @typescript-eslint/no-explicit-any -- untyped extension message types */
/**
 * Marco Extension — Version Mismatch Detection Hook
 *
 * Compares the extension manifest version against the bundled
 * macro-looping.js instruction.json version (via GET_SCRIPT_INFO).
 * Returns mismatch details for the popup to display a warning.
 */

import { useState, useEffect, useCallback } from "react";
import { sendMessage } from "@/lib/message-client";
import { logError } from "./hook-logger";

interface ScriptInfoResponse {
  isOk: boolean;
  bundledVersion?: string;
  scriptName?: string;
  errorMessage?: string;
}

interface ManifestVersionInfo {
  displayVersion: string | null;
  comparableVersion: string | null;
}

export interface VersionCheckResult {
  loading: boolean;
  hasMismatch: boolean;
  manifestVersion: string | null;
  bundledScriptVersion: string | null;
  error: string | null;
}

/** Extract the numeric version portion from a manifest field. */
function extractVersionNumber(value?: string): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\d+(?:\.\d+)+/);
  return match ? match[0] : null;
}

/** Read the canonical manifest version from chrome.runtime (null outside extension). */
function getManifestVersion(): ManifestVersionInfo {
  try {
    const runtime = (globalThis as Record<string, unknown>).chrome as
      | {
          runtime?: {
            getManifest?: () => { version?: string; version_name?: string };
          };
        }
      | undefined;

    if (typeof runtime?.runtime?.getManifest === "function") {
      const manifest = runtime.runtime.getManifest();
      const displayVersion =
        extractVersionNumber(manifest.version_name) ??
        extractVersionNumber(manifest.version);

      return {
        displayVersion,
        comparableVersion: displayVersion
          ? normaliseVersion(displayVersion)
          : manifest.version
            ? normaliseVersion(manifest.version)
            : null,
      };
    }
  } catch (caught) {
    logError("useVersionCheck.readManifest", "chrome.runtime.getManifest() threw — not in an extension context, returning null version", caught);
  }

  return {
    displayVersion: null,
    comparableVersion: null,
  };
}

/**
 * Normalise a version string for equality checks by stripping build
 * suffixes, removing numeric zero-padding, and collapsing extra
 * trailing ".0" segments beyond semver.
 */
function normaliseVersion(v: string): string {
  const numericVersion = extractVersionNumber(v);
  if (!numericVersion) {
    return v;
  }

  const parts = numericVersion
    .split(".")
    .map((part) => String(Number.parseInt(part, 10)));

  while (parts.length > 3 && parts.at(-1) === "0") {
    parts.pop();
  }

  while (parts.length < 3) {
    parts.push("0");
  }

  return parts.join(".");
}

// eslint-disable-next-line max-lines-per-function
export function useVersionCheck(): VersionCheckResult {
  const [result, setResult] = useState<VersionCheckResult>({
    loading: true,
    hasMismatch: false,
    manifestVersion: null,
    bundledScriptVersion: null,
    error: null,
  });

  // eslint-disable-next-line max-lines-per-function
  const check = useCallback(async () => {
    const manifestVersion = getManifestVersion();
    if (!manifestVersion.displayVersion || !manifestVersion.comparableVersion) {
      // Not running inside a Chrome extension — skip
      setResult({
        loading: false,
        hasMismatch: false,
        manifestVersion: null,
        bundledScriptVersion: null,
        error: null,
      });
      return;
    }

    try {
      const info = await sendMessage<ScriptInfoResponse>({
        type: "GET_SCRIPT_INFO",
        scriptName: "macroController",
      } as any);

      if (!info.isOk || !info.bundledVersion) {
        setResult({
          loading: false,
          hasMismatch: false,
          manifestVersion: manifestVersion.displayVersion,
          bundledScriptVersion: null,
          error: info.errorMessage ?? "Could not read bundled script version",
        });
        return;
      }

      const normManifest = manifestVersion.comparableVersion;
      const normBundled = normaliseVersion(info.bundledVersion);
      const hasMismatch = normManifest !== normBundled;

      setResult({
        loading: false,
        hasMismatch,
        manifestVersion: manifestVersion.displayVersion,
        bundledScriptVersion: info.bundledVersion,
        error: null,
      });
    } catch (err) {
      setResult({
        loading: false,
        hasMismatch: false,
        manifestVersion: manifestVersion.displayVersion,
        bundledScriptVersion: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return result;
}