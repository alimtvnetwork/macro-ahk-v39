import { useCallback, useEffect, useState } from "react";
import { sendMessage } from "@/lib/message-client";

const ONBOARDING_KEY = "marco_onboarding_complete";
const STORAGE_TIMEOUT_MS = 400;

/* ------------------------------------------------------------------ */
/*  Chrome API accessor (typed, no `as any`)                           */
/* ------------------------------------------------------------------ */

interface ChromeStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

interface ChromePermissionsApi {
  getAll(): Promise<{ origins?: string[] }>;
  request(permissions: { origins: string[] }): Promise<boolean>;
}

interface ChromeWindow {
  chrome?: {
    storage?: { local?: ChromeStorageArea };
    permissions?: ChromePermissionsApi;
  };
}

function getChromeStorage(): ChromeStorageArea | undefined {
  return (globalThis as ChromeWindow).chrome?.storage?.local;
}

function getChromePermissions(): ChromePermissionsApi | undefined {
  return (globalThis as ChromeWindow).chrome?.permissions;
}

/* ------------------------------------------------------------------ */
/*  Onboarding hook                                                    */
/* ------------------------------------------------------------------ */

/** Hook to check and manage onboarding state. */
// eslint-disable-next-line max-lines-per-function
export function useOnboarding() {
  const [isComplete, setIsComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log("[useOnboarding] mount → checking state", {
      hasChromeStorage: Boolean(getChromeStorage()),
      timeoutMs: STORAGE_TIMEOUT_MS,
    });
    checkOnboardingState();
  }, []);

  const checkOnboardingState = async () => {
    const t0 = performance.now();
    try {
      const storage = getChromeStorage();

      if (storage) {
        const result = await Promise.race([
          storage.get(ONBOARDING_KEY),
          new Promise<Record<string, unknown>>((_, reject) => {
            setTimeout(() => reject(new Error("storage-timeout")), STORAGE_TIMEOUT_MS);
          }),
        ]);
        const isDone = result[ONBOARDING_KEY] === true;
        console.log("[useOnboarding] chrome.storage resolved", {
          rawValue: result[ONBOARDING_KEY],
          isDone,
          elapsedMs: Math.round(performance.now() - t0),
        });
        setIsComplete(isDone);
      } else {
        // Dev fallback — skip onboarding by default for browser preview
        const isDone = localStorage.getItem(ONBOARDING_KEY) !== "false";
        console.log("[useOnboarding] no chrome.storage → localStorage fallback", {
          rawValue: localStorage.getItem(ONBOARDING_KEY),
          isDone,
        });
        setIsComplete(isDone);
      }
    } catch {
      // In preview/sandbox, chrome storage can exist as a shim but never resolve.
      // Fall back to localStorage and always unblock UI.
      const isDone = localStorage.getItem(ONBOARDING_KEY) !== "false";
      console.warn("[useOnboarding] chrome.storage threw/timed out → localStorage fallback", {
        rawValue: localStorage.getItem(ONBOARDING_KEY),
        isDone,
        elapsedMs: Math.round(performance.now() - t0),
      });
      setIsComplete(isDone);
    } finally {
      console.log("[useOnboarding] loading=false");
      setLoading(false);
    }
  };

  const completeOnboarding = useCallback(async () => {
    const storage = getChromeStorage();

    if (storage) {
      await storage.set({ [ONBOARDING_KEY]: true });
    } else {
      localStorage.setItem(ONBOARDING_KEY, "true");
    }
    setIsComplete(true);
  }, []);

  const resetOnboarding = useCallback(async () => {
    const storage = getChromeStorage();

    if (storage) {
      await storage.remove(ONBOARDING_KEY);
    } else {
      localStorage.removeItem(ONBOARDING_KEY);
    }
    setIsComplete(false);
  }, []);

  return { isComplete, loading, completeOnboarding, resetOnboarding };
}

/* ------------------------------------------------------------------ */
/*  Permissions hook                                                   */
/* ------------------------------------------------------------------ */

/** Hook to manage optional host permissions. */
export function usePermissions() {
  const [granted, setGranted] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const checkPermissions = useCallback(async () => {
    const permissions = getChromePermissions();

    if (permissions) {
      const perms = await permissions.getAll();
      setGranted(perms.origins ?? []);
    }
  }, []);

  useEffect(() => {
    void checkPermissions();
  }, [checkPermissions]);

  const requestPermission = useCallback(async (origin: string): Promise<boolean> => {
    const permissions = getChromePermissions();

    if (permissions) {
      setLoading(true);
      try {
        const isGranted = await permissions.request({ origins: [origin] });

        if (isGranted) {
          setGranted((prev) => [...prev, origin]);
        }
        setLoading(false);
        return isGranted;
      } catch {
        setLoading(false);
        return false;
      }
    }

    // Dev fallback
    setGranted((prev) => [...prev, origin]);
    return true;
  }, []);

  return { granted, loading, requestPermission, checkPermissions };
}
