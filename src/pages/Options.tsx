/* eslint-disable @typescript-eslint/no-explicit-any -- untyped extension message types */
import { useState, useEffect, useRef, lazy, Suspense, useCallback } from "react";
import { sendMessage } from "@/lib/message-client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { OptionsSidebar, type SidebarSelection, type SidebarSection } from "@/components/options/OptionsSidebar";
import { ProjectsListView } from "@/components/options/ProjectsListView";
import { ProjectCreateForm } from "@/components/options/ProjectCreateForm";
// Dark-only: ThemeToggle removed
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DraggableOverlay } from "@/components/overlay/DraggableOverlay";
import { ErrorDrawer } from "@/components/options/ErrorDrawer";
import { FloatingControllerHost } from "@/components/recorder/FloatingControllerHost";
import { RecorderControlBar } from "@/components/recorder/RecorderControlBar";
import { useProjects, useScripts, useConfigs, type StoredProject } from "@/hooks/use-projects-scripts";
import { useOnboarding } from "@/hooks/use-onboarding";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { PanelRightOpen, Loader2 } from "lucide-react";

// Lazy-loaded heavy panels
const ProjectDetailView = lazy(() => import("@/components/options/ProjectDetailView"));
const GlobalScriptsView = lazy(() => import("@/components/options/GlobalScriptsView"));
const ScriptBundleDetailView = lazy(() => import("@/components/options/ScriptBundleDetailView"));
const GlobalDiagnosticsView = lazy(() => import("@/components/options/GlobalDiagnosticsView"));
const GlobalAboutView = lazy(() => import("@/components/options/GlobalAboutView"));
const SettingsView = lazy(() => import("@/components/options/SettingsView"));
const StorageBrowserView = lazy(() => import("@/components/options/StorageBrowserView"));
const ApiExplorerView = lazy(() => import("@/components/options/ApiExplorerView"));
const PromptManagerPanel = lazy(() => import("@/components/options/PromptManagerPanel"));
const PromptChainPanel = lazy(() => import("@/components/options/PromptChainPanel"));
const UpdaterManagementView = lazy(() => import("@/components/options/UpdaterManagementView"));
const AutomationView = lazy(() => import("@/components/automation/AutomationView"));
const ActivityLogTimeline = lazy(() => import("@/components/options/ActivityLogTimeline"));
const LibraryView = lazy(() => import("@/components/options/LibraryView"));
const StepGroupLibraryPanel = lazy(() => import("@/components/options/StepGroupLibraryPanel"));
const StepGroupListPanel = lazy(() => import("@/components/options/StepGroupListPanel"));
const ErrorSwallowAuditView = lazy(() => import("@/components/options/ErrorSwallowAuditView"));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-sm">Loading panel…</span>
    </div>
  );
}

/**
 * Wraps the onboarding loading spinner with a stuck-detection timer. After
 * `STUCK_TIMEOUT_MS` it swaps the spinner for a visible, testable error so
 * E2E tests fail with the real reason ("onboarding state never resolved")
 * instead of a generic locator timeout.
 */
const ONBOARDING_STUCK_TIMEOUT_MS = 8000;
function OnboardingLoadingGate({ children }: { children: React.ReactNode }) {
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsStuck(true), ONBOARDING_STUCK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!isStuck) {
    return <>{children}</>;
  }

  return (
    <div
      className="min-h-screen bg-background flex items-center justify-center p-6"
      data-testid="onboarding-load-error"
    >
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-xl font-bold tracking-tight">
          Onboarding failed to load
        </h1>
        <p
          className="text-sm text-destructive font-mono break-words"
          data-testid="onboarding-load-error-message"
        >
          Onboarding state did not resolve within {ONBOARDING_STUCK_TIMEOUT_MS}ms.
          Check chrome.storage.local and the service worker logs.
        </p>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface ChromeRuntimeLike {
  id?: string;
  getManifest?: () => { version: string };
  getURL?: (path: string) => string;
  openOptionsPage?: () => void;
}

/** Safe accessor for chrome.runtime that avoids `as any` casts. */
function getChromeRuntime(): ChromeRuntimeLike | undefined {
  const win = globalThis as { chrome?: { runtime?: ChromeRuntimeLike } };
  return win.chrome?.runtime;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
const OptionsPage = () => {
  const mountTime = useRef(performance.now());
  const mountBudgetMs = useRef(1000);
  const { isComplete, loading: onboardingLoading, completeOnboarding } = useOnboarding();
  const { projects, loading: pLoading, save: pSave, remove: pRemove } = useProjects();
  const { scripts, loading: sLoading, save: sSave, remove: sRemove } = useScripts();
  const { configs, loading: cLoading, save: cSave, remove: cRemove } = useConfigs();

  // Load the configurable mount budget from extension settings
  useEffect(() => {
    sendMessage<{ settings?: { optionsMountBudgetMs?: number } }>({ type: "GET_SETTINGS" as any })
      .then((res) => {
        if (res.settings?.optionsMountBudgetMs) {
          mountBudgetMs.current = res.settings.optionsMountBudgetMs;
        }
      })
      .catch(() => { /* keep default */ });
  }, []);

  // eslint-disable-next-line sonarjs/cognitive-complexity -- perf budget check with multi-field breakdown
  useEffect(() => {
    if (!pLoading && !sLoading && !cLoading && !onboardingLoading) {
      const ms = Math.round((performance.now() - mountTime.current) * 10) / 10;
      const budget = mountBudgetMs.current;
      console.log("[Options] ── INTERACTIVE ── mount-to-interactive=%.1fms (budget=%dms)", ms, budget);
      if (ms > budget) {
        console.warn(
          "[Options] ⚠ PERF BUDGET EXCEEDED ── mount-to-interactive %.1fms > %dms budget. " +
          "Breakdown: projects=%s scripts=%s configs=%s onboarding=%s",
          ms,
          budget,
          pLoading ? "pending" : "ready",
          sLoading ? "pending" : "ready",
          cLoading ? "pending" : "ready",
          onboardingLoading ? "pending" : "ready",
        );
      }
    }
  }, [pLoading, sLoading, cLoading, onboardingLoading]);

  /**
   * Deep-link: parse hash to set initial sidebar section (e.g. `#activity`,
   * `#logging`). Two extra aliases route to the in-page Step Group panel:
   *
   *   - `#step-groups`        → Step Groups section, tree sub-view
   *   - `#step-groups-list`   → Step Groups section, list sub-view
   *
   * These replace the old standalone `/step-groups` and
   * `/step-groups/list` pages so the panel renders inside the real
   * Options shell (sidebar + header + main).
   */
  const parseHash = (): { section: SidebarSection; stepGroupView: "tree" | "list" } => {
    const hash = window.location.hash.replace("#", "").trim();
    const validSections: SidebarSection[] = [
      "projects", "scripts", "prompts", "activity", "logging",
      "automation", "updaters", "timing", "data", "network",
      "storage", "api", "library", "step-groups", "settings", "about", "audit",
    ];
    if (hash === "step-groups-list") {
      return { section: "step-groups", stepGroupView: "list" };
    }
    if (hash !== "" && validSections.includes(hash as SidebarSection)) {
      return { section: hash as SidebarSection, stepGroupView: "tree" };
    }
    return { section: "projects", stepGroupView: "tree" };
  };
  const initialHash = parseHash();

  const [selection, setSelection] = useState<SidebarSelection>({
    type: "section",
    section: initialHash.section,
  });
  /**
   * Sub-view for the Step Groups section. The tree view is the default
   * (richer); the list view is a flat searchable browser. Both panels
   * live inside `<main>` so the user never leaves Options.
   */
  const [stepGroupView, setStepGroupView] = useState<"tree" | "list">(
    initialHash.stepGroupView,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [errorDrawerOpen, setErrorDrawerOpen] = useState(false);
  /** Tracks navigation direction for view transition animation. */
  const [viewDirection, setViewDirection] = useState<"forward" | "back">("forward");
  const extensionVersion = getChromeRuntime()?.getManifest?.().version ?? null;

  /**
   * React to runtime hash changes (e.g. when a panel-internal link
   * navigates to `/#step-groups-list`). Without this, only the very
   * first render honours the hash and subsequent in-app links would
   * silently no-op.
   */
  useEffect(() => {
    const onHashChange = () => {
      const next = parseHash();
      setSelection({ type: "section", section: next.section });
      setStepGroupView(next.stepGroupView);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleSidebarSelect = useCallback((s: SidebarSelection) => {
    setIsCreating(false);
    // Navigating to a section from a detail view = going back
    setViewDirection(s.type === "section" ? "back" : "forward");
    setSelection(s);
  }, []);

  // E2E diagnostic marker — expose live state to tests via DOM + console.
  // The marker is always present (visually hidden) so Playwright can read it
  // without waiting for a specific render branch.
  useEffect(() => {
    const branch =
      onboardingLoading ? "loading"
      : isComplete !== true ? "onboarding-flow"
      : "ready";
    console.log("[Options] render branch", {
      branch,
      onboardingLoading,
      isComplete,
      pLoading,
      sLoading,
      cLoading,
    });
    // Mirror onto window for tests that prefer a JS handle over DOM scraping.
    (globalThis as unknown as { __MARCO_OPTIONS_STATE__?: unknown }).__MARCO_OPTIONS_STATE__ = {
      branch,
      onboardingLoading,
      isComplete,
      pLoading,
      sLoading,
      cLoading,
      ts: Date.now(),
    };
  }, [onboardingLoading, isComplete, pLoading, sLoading, cLoading]);

  const stateMarker = (
    <div
      data-testid="options-state-marker"
      data-branch={onboardingLoading ? "loading" : isComplete !== true ? "onboarding-flow" : "ready"}
      data-onboarding-loading={String(onboardingLoading)}
      data-onboarding-complete={String(isComplete)}
      data-projects-loading={String(pLoading)}
      data-scripts-loading={String(sLoading)}
      data-configs-loading={String(cLoading)}
      style={{ position: "fixed", width: 1, height: 1, opacity: 0, pointerEvents: "none", left: -9999, top: -9999 }}
      aria-hidden="true"
    />
  );

  if (onboardingLoading) {
    return (
      <OnboardingLoadingGate>
        <div className="min-h-screen bg-background flex items-center justify-center">
          {stateMarker}
          <div className="h-8 w-8 rounded-lg bg-primary animate-pulse" />
        </div>
      </OnboardingLoadingGate>
    );
  }

  if (isComplete !== true) {
    return (
      <>
        {stateMarker}
        <Toaster />
        <OnboardingFlow onComplete={completeOnboarding} />
      </>
    );
  }

  const handleNewProject = () => {
    setIsCreating(true);
    setSelection({ type: "section", section: "projects" });
  };

  const handleProjectCreated = async (project: Parameters<typeof pSave>[0]) => {
    try {
      await pSave(project);
      setIsCreating(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save project";
      toast.error(msg);
    }
  };

  const handleEditProject = (projectId: string) => {
    setIsCreating(false);
    setViewDirection("forward");
    setSelection({ type: "project", projectId });
  };

  const handleDuplicateProject = async (project: StoredProject) => {
    const duplicate: Partial<StoredProject> = {
      ...project,
      id: crypto.randomUUID(),
      name: `${project.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await pSave(duplicate);
    toast.success(`Duplicated "${project.name}"`);
  };

  const handleDeleteProject = async (id: string) => {
    await pRemove(id);
    toast.success("Project deleted");
    if (selection.type === "project" && selection.projectId === id) {
      setViewDirection("back");
      setSelection({ type: "section", section: "projects" });
    }
  };

  const handleImportProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const manifest = JSON.parse(e.target?.result as string);
        const newProject = {
          id: crypto.randomUUID(),
          schemaVersion: manifest.schemaVersion ?? 1,
          name: manifest.name ?? file.name.replace(/\.json$/, ""),
          version: manifest.version ?? "1.0.0",
          description: manifest.description ?? "",
          targetUrls: manifest.targetUrls ?? [],
          scripts: manifest.scripts ?? [],
          configs: manifest.configs ?? [],
          variables: manifest.variables ? JSON.stringify(manifest.variables) : "{}",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await pSave(newProject);
        toast.success(`Imported "${newProject.name}"`);
      } catch {
        toast.error("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
  };

  const handleNewScript = () => {
    // Create a blank script and navigate to it
    const blankScript = {
      name: "My Macro Script",
      code: "// New script\n",
      order: scripts.length,
      isEnabled: true,
    };
    sSave(blankScript).then(() => {
      // After saving, the scripts list will refresh — find the new one
      // For now, stay on scripts section (user will see it in the list)
      setSelection({ type: "section", section: "scripts" });
    });
  };

  const handleEditScript = (scriptId: string) => {
    setIsCreating(false);
    setViewDirection("forward");
    setSelection({ type: "script", scriptId });
  };

  const handleDeleteScript = async (id: string) => {
    await sRemove(id);
    if (selection.type === "script" && selection.scriptId === id) {
      setViewDirection("back");
      setSelection({ type: "section", section: "scripts" });
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        {stateMarker}
        <Toaster />
        <FloatingControllerHost />
        <OptionsSidebar selection={selection} onSelect={handleSidebarSelect} onErrorDrawerOpen={() => setErrorDrawerOpen(true)} />

        <div className="flex-1 flex flex-col">
          {/* Header */}
          <header className="h-12 flex items-center border-b border-border bg-card/80 backdrop-blur-xl px-4 gap-3 sticky top-0 z-10 shadow-[0_1px_12px_-2px_hsl(var(--primary)/0.15)]">
            <SidebarTrigger className="hover:bg-primary/15 hover:text-primary transition-all duration-200" />
            <h1 className="text-sm font-bold tracking-tight">Marco Extension</h1>
            <RecorderControlBar />
            <div className="ml-auto flex items-center gap-1">
              {extensionVersion && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  v{extensionVersion}
                </Badge>
              )}
              {!getChromeRuntime()?.id && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 text-amber-500 border-amber-500/40 bg-amber-500/10"
                >
                  DEV
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowOverlay(v => !v)}
                title="Toggle overlay panel"
              >
                <PanelRightOpen className={`h-4 w-4 ${showOverlay ? "text-primary" : ""}`} />
              </Button>
              {/* Dark-only: theme toggle removed */}
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 p-6 overflow-auto">
            <div
              className={`max-w-5xl mx-auto ${viewDirection === "forward" ? "view-enter-forward" : "view-enter-back"}`}
              key={selection.type === "project" ? selection.projectId : selection.type === "script" ? selection.scriptId : (isCreating ? "__creating__" : selection.section)}
            >
              <Suspense fallback={<LazyFallback />}>
              <ErrorBoundary section={selection.type === "project" ? "Project Detail" : selection.type === "script" ? "Script Detail" : selection.section}>
              {isCreating ? (
              <ProjectCreateForm
                  availableScripts={scripts}
                  availableConfigs={configs}
                  onSave={handleProjectCreated}
                  onCancel={() => setIsCreating(false)}
                />
              ) : selection.type === "script" ? (
                (() => {
                  const scriptObj = scripts.find((s) => s.id === selection.scriptId);
                  if (!scriptObj) return <div className="text-sm text-muted-foreground">Script not found</div>;
                  return (
                    <ScriptBundleDetailView
                      script={scriptObj}
                      configs={configs}
                      onSave={sSave}
                      onSaveConfig={cSave}
                      onDelete={handleDeleteScript}
                      onBack={() => { setViewDirection("back"); setSelection({ type: "section", section: "scripts" }); }}
                    />
                  );
                })()
              ) : selection.type === "project" ? (
                (() => {
                  const proj = projects.find((p) => p.id === selection.projectId);
                  if (!proj) return <div className="text-sm text-muted-foreground">Project not found</div>;
                  return (
                    <ProjectDetailView
                      project={proj}
                      allProjects={projects}
                      availableScripts={scripts}
                      availableConfigs={configs}
                      onSave={pSave}
                      onDelete={handleDeleteProject}
                      onBack={() => { setViewDirection("back"); setSelection({ type: "section", section: "projects" }); }}
                    />
                  );
                })()
              ) : selection.section === "projects" ? (
                <ProjectsListView
                  projects={projects}
                  onEdit={handleEditProject}
                  onNewProject={handleNewProject}
                  onDuplicate={handleDuplicateProject}
                  onDelete={handleDeleteProject}
                  onImport={handleImportProject}
                />
              ) : selection.section === "scripts" ? (
                <GlobalScriptsView
                  scripts={scripts}
                  scriptsLoading={sLoading}
                  onSaveScript={sSave}
                  onDeleteScript={handleDeleteScript}
                  configs={configs}
                  configsLoading={cLoading}
                  onSaveConfig={cSave}
                  onDeleteConfig={cRemove}
                  onNewScript={handleNewScript}
                  onEditScript={handleEditScript}
                />
              ) : selection.section === "prompts" ? (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <h2 className="text-lg font-bold tracking-tight">Prompts</h2>
                    <p className="text-xs text-muted-foreground">
                      Manage prompts for macro injection. Custom prompts sync across Chrome instances.
                    </p>
                    <PromptManagerPanel />
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-lg font-bold tracking-tight">Prompt Chains</h2>
                    <p className="text-xs text-muted-foreground">
                      Create chains to run multiple prompts in sequence with idle detection between steps.
                    </p>
                    <PromptChainPanel />
                  </div>
                </div>
              ) : selection.section === "activity" ? (
                <ActivityLogTimeline />
              ) : selection.section === "logging" ? (
                <GlobalDiagnosticsView />
              ) : selection.section === "automation" ? (
                <AutomationView />
              ) : selection.section === "updaters" ? (
                <UpdaterManagementView />
              ) : selection.section === "timing" ? (
                <div className="space-y-4">
                  <h2 className="text-lg font-bold tracking-tight">Timing</h2>
                  <p className="text-xs text-muted-foreground">Performance timing and cycle metrics.</p>
                  <GlobalDiagnosticsView />
                </div>
              ) : selection.section === "data" ? (
                <div className="space-y-4">
                  <h2 className="text-lg font-bold tracking-tight">Data</h2>
                  <p className="text-xs text-muted-foreground">Data flow inspection and payload viewer.</p>
                  <StorageBrowserView />
                </div>
              ) : selection.section === "network" ? (
                <div className="space-y-4">
                  <h2 className="text-lg font-bold tracking-tight">Network</h2>
                  <p className="text-xs text-muted-foreground">Network request logs and API call history.</p>
                  <GlobalDiagnosticsView />
                </div>
              ) : selection.section === "storage" ? (
                <StorageBrowserView />
              ) : selection.section === "library" ? (
                <LibraryView />
              ) : selection.section === "step-groups" ? (
                <StepGroupsSection
                  view={stepGroupView}
                  onViewChange={(v: "tree" | "list") => {
                    setStepGroupView(v);
                    // Keep the URL in sync so refresh / share preserves the sub-view.
                    const nextHash = v === "list" ? "step-groups-list" : "step-groups";
                    if (window.location.hash !== `#${nextHash}`) {
                      history.replaceState(null, "", `#${nextHash}`);
                    }
                  }}
                />
              ) : selection.section === "api" ? (
                <ApiExplorerView />
              ) : selection.section === "settings" ? (
                <SettingsView />
              ) : selection.section === "about" ? (
                <GlobalAboutView />
              ) : selection.section === "audit" ? (
                <ErrorSwallowAuditView />
              ) : null}
              </ErrorBoundary>
              </Suspense>
            </div>
          </main>
        </div>
      </div>

      {/* Draggable Overlay (T-5) */}
      {showOverlay && (
        <DraggableOverlay
          title="Marco Controller"
          headerExtra={
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowOverlay(false)}>
              <span className="text-xs">✕</span>
            </Button>
          }
        >
          <div className="space-y-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-medium">Loop: Idle</span>
            </div>
            <div className="rounded-md border border-border p-2 bg-muted/30">
              <p className="text-muted-foreground">Drag the header to move. Resize from the bottom-right corner. Double-click header to reset position.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border p-2 text-center">
                <p className="text-muted-foreground text-[10px]">Cycles</p>
                <p className="font-bold text-lg">27</p>
              </div>
              <div className="rounded-md border border-border p-2 text-center">
                <p className="text-muted-foreground text-[10px]">Success Rate</p>
                <p className="font-bold text-lg">85%</p>
              </div>
            </div>
          </div>
        </DraggableOverlay>
      )}

      {/* Error Drawer */}
      <ErrorDrawer open={errorDrawerOpen} onOpenChange={setErrorDrawerOpen} />
    </SidebarProvider>
  );
};

export default OptionsPage;

/* ------------------------------------------------------------------ */
/*  Step Groups section                                                */
/* ------------------------------------------------------------------ */

/**
 * Wrapper that hosts both Step-Group browsers (tree + list) inside the
 * Options shell. A small toggle at the top swaps between them without
 * leaving the page, so the panels keep all their existing toolbar +
 * dialog behaviour while sitting inside the real sidebar layout.
 */
function StepGroupsSection(props: {
  view: "tree" | "list";
  onViewChange: (view: "tree" | "list") => void;
}) {
  const { view, onViewChange } = props;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Step Groups</h2>
          <p className="text-xs text-muted-foreground">
            Browse, edit, import and export step-group bundles for the current project.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => onViewChange("tree")}
            className={`rounded px-3 py-1 transition-colors ${
              view === "tree"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={view === "tree"}
          >
            Tree
          </button>
          <button
            type="button"
            onClick={() => onViewChange("list")}
            className={`rounded px-3 py-1 transition-colors ${
              view === "list"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={view === "list"}
          >
            List
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {view === "tree" ? <StepGroupLibraryPanel /> : <StepGroupListPanel />}
      </div>
    </div>
  );
}
