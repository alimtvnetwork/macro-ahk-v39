/* eslint-disable @typescript-eslint/no-explicit-any -- untyped extension message types */
import React, { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileCode,
  Globe,
  Braces,
  Clock,
  Crosshair,
  Key,
  Database,
  Wifi,
  Cookie,
  Stethoscope,
  Trash2,
  Download,
  ArrowLeft,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Save,
  BookOpen,
  Info,
  Shield,
  Package,
  Settings,
  Link,
  CheckCircle,
  AlertTriangle,
  ListOrdered,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  RotateCcw,
  Zap,
  Activity,
} from "lucide-react";
import type { StoredProject, StoredScript, StoredConfig } from "@/hooks/use-projects-scripts";
import { DEFAULT_CHATBOX_XPATH } from "@/shared/defaults";
import { ProjectScriptSelector, type ScriptBinding } from "./ProjectScriptSelector";
import { DevGuideSection } from "./DevGuideSection";
import { slugify, toCodeName, toSdkNamespace } from "@/lib/slug-utils";
import { generateLlmGuide } from "@/lib/generate-llm-guide";
import { exportKnowledgeBase } from "@/lib/developer-guide-bundle";
import { generateDts } from "@/lib/generate-dts";
import { toast } from "sonner";
import { logError } from "./options-logger";
import { sendMessage } from "@/lib/message-client";

/* ------------------------------------------------------------------ */
/*  Lazy-loaded sub-tab panels (EXT perf: split 314KB chunk)           */
/* ------------------------------------------------------------------ */

function TabFallback() {
  return <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Loading…</div>;
}

const TimingPanel = lazy(() => import("./TimingPanel").then(m => ({ default: m.TimingPanel })));
const XPathPanel = lazy(() => import("./XPathPanel").then(m => ({ default: m.XPathPanel })));
const AuthConfigPanel = lazy(() => import("./AuthConfigPanel").then(m => ({ default: m.AuthConfigPanel })));
const ProjectStoragePanel = lazy(() => import("./ProjectStoragePanel").then(m => ({ default: m.ProjectStoragePanel })));
const NetworkPanel = lazy(() => import("./NetworkPanel").then(m => ({ default: m.NetworkPanel })));
const CookiesPanel = lazy(() => import("./CookiesPanel").then(m => ({ default: m.CookiesPanel })));
const BootDiagnosticsPanel = lazy(() => import("./BootDiagnosticsPanel").then(m => ({ default: m.BootDiagnosticsPanel })));
const ProjectUrlRulesEditor = lazy(() => import("./ProjectUrlRulesEditor").then(m => ({ default: m.ProjectUrlRulesEditor })));
const ProjectFilesPanel = lazy(() => import("./ProjectFilesPanel").then(m => ({ default: m.ProjectFilesPanel })));
const ProjectVariablesEditor = lazy(() => import("./ProjectVariablesEditor").then(m => ({ default: m.ProjectVariablesEditor })));
const UpdaterPanel = lazy(() => import("./UpdaterPanel").then(m => ({ default: m.UpdaterPanel })));
const RecorderVisualisationPanel = lazy(() => import("./recorder/RecorderVisualisationPanel"));
import { exportProjectAsSqliteZip } from "@/lib/sqlite-bundle";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ProjectTab =
  | "general"
  | "scripts"
  | "urls"
  | "variables"
  | "xpath"
  | "cookies"
  | "updater"
  | "docs"
  | "files"
  | "timing"
  | "auth"
  | "storage"
  | "network"
  | "recorder"
  | "diagnostics";

interface Props {
  project: StoredProject;
  allProjects: StoredProject[];
  availableScripts: StoredScript[];
  availableConfigs: StoredConfig[];
  onSave: (project: Partial<StoredProject>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBack: () => void;
}

/* Helper: bump patch version */
function bumpPatch(v: string): string {
  const parts = v.split(".");
  if (parts.length === 3) {
    parts[2] = String(Number(parts[2] || 0) + 1);
    return parts.join(".");
  }
  return v;
}

/* ------------------------------------------------------------------ */
/*  Tab definitions                                                    */
/* ------------------------------------------------------------------ */

const primaryTabs: Array<{ id: ProjectTab; label: string; icon: typeof FileCode }> = [
  { id: "general", label: "General", icon: Info },
  { id: "scripts", label: "Scripts", icon: FileCode },
  { id: "urls", label: "URL Rules", icon: Globe },
  { id: "variables", label: "Variables", icon: Braces },
  { id: "xpath", label: "XPath", icon: Crosshair },
  { id: "cookies", label: "Cookies", icon: Cookie },
  { id: "updater", label: "Update", icon: RefreshCw },
  { id: "docs", label: "Docs", icon: BookOpen },
];

const overflowTabs: Array<{ id: ProjectTab; label: string; icon: typeof FileCode }> = [
  { id: "files", label: "Files & Storage", icon: FolderOpen },
  { id: "timing", label: "Timing", icon: Clock },
  { id: "auth", label: "Auth", icon: Key },
  { id: "storage", label: "Storage", icon: Database },
  { id: "network", label: "Network", icon: Wifi },
  { id: "recorder", label: "Recorder", icon: Activity },
  { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
export function ProjectDetailView({ project, allProjects, availableScripts, availableConfigs, onSave, onDelete, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<ProjectTab>("general");

  const isOverflowTab = overflowTabs.some((t) => t.id === activeTab);
  const activeOverflowItem = overflowTabs.find((t) => t.id === activeTab);

  const projectSlug = project.slug || slugify(project.name);
  const sdkNamespace = useMemo(() => toSdkNamespace(projectSlug), [projectSlug]);

  return (
    <div className="space-y-4">
      {/* Project Header */}
      <ProjectHeader
        project={project}
        onSave={onSave}
        onDelete={onDelete}
        onBack={onBack}
      />

      {/* Tabbed content */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProjectTab)}>
        <TabsList className="w-full justify-start bg-card border border-border flex-wrap h-auto gap-0.5 p-1">
          {primaryTabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="gap-1.5 text-xs transition-all duration-200 hover:bg-primary/15 hover:text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}

          {/* Overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`inline-flex items-center justify-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 transition-all duration-200 hover:bg-primary/15 hover:text-primary ${
                  isOverflowTab
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                {isOverflowTab && activeOverflowItem ? activeOverflowItem.label : "More"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              {overflowTabs.map((tab) => (
                <DropdownMenuItem
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`gap-2 text-xs cursor-pointer ${
                    activeTab === tab.id ? "bg-primary/10 text-primary font-medium" : ""
                  }`}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </TabsList>

        <div key={activeTab} className="page-enter">
            <TabsContent value="general" className="mt-4" forceMount={activeTab === "general" ? true : undefined}>
              <GeneralTabContent
                project={project}
                allProjects={allProjects}
                onSave={onSave}
              />
            </TabsContent>

            <TabsContent value="scripts" className="mt-4" forceMount={activeTab === "scripts" ? true : undefined}>
              <ScriptsTabContent
                project={project}
                availableScripts={availableScripts}
                availableConfigs={availableConfigs}
                onSave={onSave}
              />
              <DevGuideSection namespace={sdkNamespace} section="scripts" targetUrls={project.targetUrls ?? []} />
            </TabsContent>

            <TabsContent value="urls" className="mt-4" forceMount={activeTab === "urls" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <ProjectUrlRulesEditor
                  targetUrls={project.targetUrls ?? []}
                  onChange={(urls) => onSave({ id: project.id, targetUrls: urls })}
                />
              </Suspense>
              <DevGuideSection namespace={sdkNamespace} section="urls" targetUrls={project.targetUrls ?? []} />
            </TabsContent>

            <TabsContent value="variables" className="mt-4" forceMount={activeTab === "variables" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <ProjectVariablesEditor
                  variables={((project as unknown as Record<string, unknown>).variables as string) ?? "{}"}
                  onChange={(vars) => onSave({ id: project.id, variables: vars } as Partial<StoredProject> & { variables: string })}
                />
              </Suspense>
              <DevGuideSection namespace={sdkNamespace} section="variables" targetUrls={project.targetUrls ?? []} />
            </TabsContent>

            <TabsContent value="xpath" className="mt-4" forceMount={activeTab === "xpath" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <XPathPanel
                  chatBoxXPath={project.settings?.chatBoxXPath}
                  onSaveChatBoxXPath={(xpath) =>
                    onSave({
                      id: project.id,
                      settings: { ...project.settings, chatBoxXPath: xpath },
                    })
                  }
                />
              </Suspense>
              <DevGuideSection namespace={sdkNamespace} section="xpath" targetUrls={project.targetUrls ?? []} />
            </TabsContent>

            <TabsContent value="cookies" className="mt-4" forceMount={activeTab === "cookies" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <CookiesPanel
                  bindings={project.cookies ?? []}
                  onChange={(cookies) => onSave({ id: project.id, cookies })}
                  sdkNamespace={sdkNamespace}
                  legacyRules={(project as unknown as Record<string, unknown>).cookieRules as import("./CookiesPanel").CookieRule[] | undefined}
                />
              </Suspense>
              <DevGuideSection namespace={sdkNamespace} section="cookies" targetUrls={project.targetUrls ?? []} />
            </TabsContent>

            <TabsContent value="updater" className="mt-4" forceMount={activeTab === "updater" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <UpdaterPanel projectId={project.id} />
              </Suspense>
            </TabsContent>

            <TabsContent value="docs" className="mt-4" forceMount={activeTab === "docs" ? true : undefined}>
              <DocsTab namespace={sdkNamespace} slug={projectSlug} targetUrls={project.targetUrls ?? []} />
            </TabsContent>

            <TabsContent value="files" className="mt-4" forceMount={activeTab === "files" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <ProjectFilesPanel projectId={project.id} />
              </Suspense>
              <DevGuideSection namespace={sdkNamespace} section="files" targetUrls={project.targetUrls ?? []} />
            </TabsContent>

            <TabsContent value="timing" className="mt-4" forceMount={activeTab === "timing" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <TimingPanel />
              </Suspense>
            </TabsContent>

            <TabsContent value="auth" className="mt-4" forceMount={activeTab === "auth" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <AuthConfigPanel />
              </Suspense>
            </TabsContent>

            <TabsContent value="storage" className="mt-4" forceMount={activeTab === "storage" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <ProjectStoragePanel projectId={project.id} projectSlug={projectSlug} />
              </Suspense>
            </TabsContent>

            <TabsContent value="network" className="mt-4" forceMount={activeTab === "network" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <NetworkPanel />
              </Suspense>
            </TabsContent>

            <TabsContent value="recorder" className="mt-4" forceMount={activeTab === "recorder" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <RecorderVisualisationPanel projectSlug={projectSlug} />
              </Suspense>
            </TabsContent>

            <TabsContent value="diagnostics" className="mt-4" forceMount={activeTab === "diagnostics" ? true : undefined}>
              <Suspense fallback={<TabFallback />}>
                <BootDiagnosticsPanel />
              </Suspense>
            </TabsContent>
          </div>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CSS3 Tooltip wrapper                                               */
/* ------------------------------------------------------------------ */

/**
 * Icon button with CSS tooltip. Uses forwardRef so Radix primitives (e.g.
 * AlertDialogTrigger asChild) can attach handlers + refs directly to the
 * underlying <button>. Earlier versions wrapped the button in a <span>,
 * which broke `asChild` because Radix attached its onClick to the span,
 * not the button — the click target inside the button never opened the
 * dialog. tests/e2e/e2e-02-project-crud.spec.ts (delete project) timed
 * out for exactly this reason.
 */
const IconButtonWithTooltip = React.forwardRef<
  HTMLButtonElement,
  {
    tooltip: string;
    children: React.ReactNode;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function IconButtonWithTooltip({ tooltip, children, className, ...buttonProps }, ref) {
  return (
    <button
      ref={ref}
      aria-label={tooltip}
      title={tooltip}
      data-tooltip={tooltip}
      className={`css-tooltip-button ${className ?? ""}`.trim()}
      {...buttonProps}
    >
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/*  Project Header                                                     */
/* ------------------------------------------------------------------ */

interface ProjectHeaderProps {
  project: StoredProject;
  onSave: (project: Partial<StoredProject>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBack: () => void;
}

// eslint-disable-next-line max-lines-per-function
function ProjectHeader({ project, onSave, onDelete, onBack }: ProjectHeaderProps) {
  const [editName, setEditName] = useState(project.name);
  const [editVersion, setEditVersion] = useState(project.version);
  const [editDesc, setEditDesc] = useState(project.description ?? "");
  const [isDirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [editingVersion, setEditingVersion] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  useEffect(() => {
    if (editingVersion) versionInputRef.current?.focus();
  }, [editingVersion]);

  const markDirty = () => setDirty(true);

  const handleSaveIdentity = async () => {
    if (!editName.trim()) { toast.error("Project name is required"); return; }
    setIsSaving(true);
    await onSave({
      id: project.id,
      name: editName.trim(),
      version: editVersion.trim(),
      description: editDesc.trim() || undefined,
    });
    setDirty(false);
    setIsSaving(false);
    setEditingName(false);
    setEditingVersion(false);
    toast.success("Project info saved");
  };

  const handleBumpVersion = () => {
    setEditVersion(bumpPatch(editVersion));
    markDirty();
  };

  const handleExport = async () => {
    try {
      await exportProjectAsSqliteZip(project);
      toast.success(`Exported "${project.name}"`);
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleUpdate = () => {
    toast.info("Checking for updates…");
    // TODO: wire to updater handler CHECK_FOR_UPDATE
  };

  const handleDelete = async () => {
    await onDelete(project.id);
    toast.success("Project deleted");
    onBack();
  };

  const handleNameBlur = () => {
    if (!editName.trim()) setEditName(project.name);
    setEditingName(false);
  };

  const handleVersionBlur = () => {
    if (!editVersion.trim()) setEditVersion(project.version);
    setEditingVersion(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { setEditingName(false); }
    if (e.key === "Escape") { setEditName(project.name); setEditingName(false); }
  };

  const handleVersionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { setEditingVersion(false); }
    if (e.key === "Escape") { setEditVersion(project.version); setEditingVersion(false); }
  };

  return (
    <div className="border-b border-border pb-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 hover:bg-primary/15 hover:text-primary transition-all duration-200"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              {/* Click-to-edit Name */}
              {editingName ? (
                <Input
                  ref={nameInputRef}
                  value={editName}
                  onChange={(e) => { setEditName(e.target.value); markDirty(); }}
                  onBlur={handleNameBlur}
                  onKeyDown={handleNameKeyDown}
                  placeholder="Project name"
                  className="h-8 text-lg font-bold tracking-tight border-border/50 shadow-none px-2 bg-muted/20 focus-visible:bg-muted/30 focus-visible:ring-1 transition-all max-w-[300px]"
                />
              ) : (
                <h2
                  className="text-lg font-bold tracking-tight cursor-pointer hover:text-primary transition-colors duration-200 truncate"
                  onClick={() => setEditingName(true)}
                  title="Click to edit"
                >
                  {editName || "Untitled Project"}
                </h2>
              )}

              {/* Click-to-edit Version */}
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-muted-foreground font-medium">v</span>
                {editingVersion ? (
                  <Input
                    ref={versionInputRef}
                    value={editVersion}
                    onChange={(e) => { setEditVersion(e.target.value); markDirty(); }}
                    onBlur={handleVersionBlur}
                    onKeyDown={handleVersionKeyDown}
                    placeholder="1.0.0"
                    className="h-6 w-[72px] text-[11px] font-mono text-center border-border/50 bg-muted/20 focus-visible:bg-muted/40 transition-all"
                  />
                ) : (
                  <span
                    className="text-[11px] font-mono text-muted-foreground bg-muted/30 px-2 py-0.5 rounded cursor-pointer hover:bg-primary/10 hover:text-primary transition-all duration-200"
                    onClick={() => setEditingVersion(true)}
                    title="Click to edit"
                  >
                    {editVersion || "0.0.0"}
                  </span>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-200"
                  onClick={handleBumpVersion}
                  title="Bump patch version"
                >
                  <span className="text-[10px] font-bold">+1</span>
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={editDesc}
                onChange={(e) => { setEditDesc(e.target.value); markDirty(); }}
                placeholder="Description (optional)"
                className="h-6 text-xs text-muted-foreground border-none shadow-none px-2 bg-transparent focus-visible:bg-muted/30 focus-visible:ring-1 transition-all flex-1"
              />
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <code className="text-[10px] font-mono text-muted-foreground bg-muted/20 px-2 py-0.5 rounded shrink-0 select-all" title="Project slug (URL-safe identifier)">
                slug: {slugify(editName)}
              </code>
              <code className="text-[10px] font-mono text-muted-foreground bg-muted/20 px-2 py-0.5 rounded shrink-0 select-all" title="PascalCase identifier for SDK namespace">
                codeName: {toCodeName(slugify(editName))}
              </code>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {isDirty && (
            <IconButtonWithTooltip
              tooltip="Save project"
              className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200"
              onClick={() => void handleSaveIdentity()}
              disabled={isSaving}
            >
              <Save className="h-4 w-4" />
            </IconButtonWithTooltip>
          )}
          <IconButtonWithTooltip
            tooltip="Check for updates"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent/20 hover:text-accent transition-all duration-200"
            onClick={handleUpdate}
          >
            <RefreshCw className="h-4 w-4" />
          </IconButtonWithTooltip>
          <IconButtonWithTooltip
            tooltip="Export project as JSON"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-primary/15 hover:text-primary transition-all duration-200"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
          </IconButtonWithTooltip>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <IconButtonWithTooltip
                tooltip="Delete project"
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-destructive hover:bg-destructive/10 transition-all duration-200"
              >
                <Trash2 className="h-4 w-4" />
              </IconButtonWithTooltip>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{editName}"?</AlertDialogTitle>
                <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {isDirty && (
        <p className="text-[10px] text-primary font-medium pl-11">● Unsaved changes</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  General Tab Content                                                */
/* ------------------------------------------------------------------ */

interface GeneralTabContentProps {
  project: StoredProject;
  allProjects: StoredProject[];
  onSave: (project: Partial<StoredProject>) => Promise<void>;
}

// eslint-disable-next-line max-lines-per-function
function GeneralTabContent({ project, allProjects, onSave }: GeneralTabContentProps) {
  const projectSlug = project.slug || slugify(project.name);
  const codeName = toCodeName(projectSlug);
  const deps = useMemo(() => project.dependencies ?? [], [project.dependencies]);
  const settings = project.settings;
  const isGlobal = project.isGlobal ?? false;
  const isRemovable = project.isRemovable;
  const globalProjects = allProjects.filter((p) => p.id !== project.id && p.isGlobal === true);

  /* ---- Editable identity state ---- */
  const [editName, setEditName] = useState(project.name);
  const [editVersion, setEditVersion] = useState(project.version);
  const [editDescription, setEditDescription] = useState(project.description ?? "");

  const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?(\+[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/;
  const isVersionValid = SEMVER_REGEX.test(editVersion.trim());
  const versionError = editVersion.trim().length > 0 && !isVersionValid
    ? "Invalid semver (expected: major.minor.patch, e.g. 1.0.0)"
    : null;

  const identityDirty = editName !== project.name || editVersion !== project.version || editDescription !== (project.description ?? "");
  const canSaveIdentity = identityDirty && editName.trim().length > 0 && isVersionValid;

  const handleSaveIdentity = useCallback(async () => {
    if (!isVersionValid) {
      toast.error("Invalid version format — use semver (e.g. 1.2.3)");
      return;
    }
    await onSave({ id: project.id, name: editName.trim(), version: editVersion.trim(), description: editDescription.trim() || undefined });
    toast.success("Project identity saved");
  }, [onSave, project.id, editName, editVersion, editDescription, isVersionValid]);

  /* ---- Settings toggle helpers ---- */
  const toggleFlag = useCallback(async (key: string, value: boolean) => {
    if (key === "isGlobal") {
      await onSave({ id: project.id, isGlobal: value });
    } else if (key === "isRemovable") {
      await onSave({ id: project.id, isRemovable: value });
    } else {
      const s = { ...(project.settings ?? {}) } as Record<string, unknown>;
      s[key] = value;
      await onSave({ id: project.id, settings: s as StoredProject["settings"] });
    }
    toast.success(`${key} updated`);
  }, [onSave, project.id, project.settings]);

  /* ---- Dependency add/remove ---- */
  const [showDepPicker, setShowDepPicker] = useState(false);

  const availableForDep = allProjects.filter(
    (p) => p.id !== project.id && !deps.some((d) => d.projectId === p.id),
  );

  const addDependency = useCallback(async (depProject: StoredProject) => {
    const newDeps = [...deps, { projectId: depProject.id, version: `^${depProject.version.split(".")[0]}` }];
    await onSave({ id: project.id, dependencies: newDeps });
    setShowDepPicker(false);
    toast.success(`Added ${depProject.name} as dependency`);
  }, [deps, onSave, project.id]);

  const removeDependency = useCallback(async (depProjectId: string) => {
    const newDeps = deps.filter((d) => d.projectId !== depProjectId);
    await onSave({ id: project.id, dependencies: newDeps });
    toast.success("Dependency removed");
  }, [deps, onSave, project.id]);

  const resolveProjectName = (projectId: string) => {
    const found = allProjects.find((p) => p.id === projectId);
    return found?.name ?? projectId;
  };

  return (
    <div className="space-y-4">
      {/* Project Identity — Editable */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          Project Identity
        </h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <Label className="text-muted-foreground font-medium text-xs">Name</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground font-medium text-xs">Version</Label>
            <Input
              value={editVersion}
              onChange={(e) => setEditVersion(e.target.value)}
              className={`h-8 text-xs font-mono ${versionError ? "border-destructive focus-visible:ring-destructive" : ""}`}
              placeholder="1.0.0"
            />
            {versionError && (
              <p className="text-[10px] text-destructive">{versionError}</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Slug</p>
            <code className="text-foreground font-mono bg-muted/30 px-2 py-0.5 rounded select-all block w-fit">{projectSlug}</code>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground font-medium">Code Name</p>
            <code className="text-foreground font-mono bg-muted/30 px-2 py-0.5 rounded select-all block w-fit">{codeName}</code>
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-muted-foreground font-medium text-xs">Description</Label>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Short project description..."
              className="text-xs min-h-[60px] resize-none"
            />
          </div>
        </div>
        {canSaveIdentity && (
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => void handleSaveIdentity()}>
              <Save className="h-3.5 w-3.5" />
              Save Identity
            </Button>
          </div>
        )}
      </div>

      {/* Settings (formerly Flags) */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          Settings
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs font-medium">Global Project</Label>
            </div>
            <Switch checked={isGlobal} onCheckedChange={(v) => void toggleFlag("isGlobal", v)} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs font-medium">Removable</Label>
            </div>
            <Switch checked={isRemovable !== false} onCheckedChange={(v) => void toggleFlag("isRemovable", v)} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs font-medium">Only Run as Dependency</Label>
            </div>
            <Switch checked={Boolean(settings?.onlyRunAsDependency)} onCheckedChange={(v) => void toggleFlag("onlyRunAsDependency", v)} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs font-medium">Isolate Scripts</Label>
            </div>
            <Switch checked={settings?.isolateScripts ?? false} onCheckedChange={(v) => void toggleFlag("isolateScripts", v)} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs font-medium">Retry on Navigate</Label>
            </div>
            <Switch checked={settings?.retryOnNavigate ?? false} onCheckedChange={(v) => void toggleFlag("retryOnNavigate", v)} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <Label className="text-xs font-medium">Allow Dynamic Requests</Label>
                <p className="text-[10px] text-muted-foreground">Scripts can call RiseupAsiaMacroExt.require()</p>
              </div>
            </div>
            <Switch checked={Boolean(settings?.allowDynamicRequests)} onCheckedChange={(v) => void toggleFlag("allowDynamicRequests", v)} />
          </div>
        </div>
      </div>

      {/* Dependencies */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            Dependencies
            {deps.length > 0 && (
              <span className="text-[10px] font-mono bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded">{deps.length}</span>
            )}
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs h-7"
            onClick={() => setShowDepPicker(!showDepPicker)}
            disabled={availableForDep.length === 0}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        {/* Dependency Picker */}
        {showDepPicker && availableForDep.length > 0 && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-[11px] font-medium text-primary">Select a parent project:</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {availableForDep.map((p) => (
                <button
                  key={p.id}
                  className="flex items-center justify-between w-full rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-accent/50 transition-colors"
                  onClick={() => void addDependency(p)}
                >
                  <div className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">{p.name}</span>
                    <code className="text-[10px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">v{p.version}</code>
                  </div>
                  <Plus className="h-3.5 w-3.5 text-primary" />
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => setShowDepPicker(false)}>Cancel</Button>
          </div>
        )}

        {/* Global projects auto-dependency notice */}
        {!isGlobal && globalProjects.length > 0 && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-1.5">
            <p className="text-[11px] font-medium text-primary flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              Global Projects (auto-injected first)
            </p>
            <div className="space-y-1">
              {globalProjects.map((gp) => (
                <div key={gp.id} className="flex items-center gap-2 text-xs">
                  <Globe className="h-3 w-3 text-primary/60" />
                  <span className="font-medium text-foreground">{gp.name}</span>
                  <code className="text-[10px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">{gp.version}</code>
                  <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                    <CheckCircle className="h-3 w-3" />
                    Auto
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Explicit dependencies */}
        {deps.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No explicit dependencies declared.</p>
        ) : (
          <div className="space-y-2">
            {deps.map((dep) => {
              const depName = resolveProjectName(dep.projectId);
              const isResolved = allProjects.some((p) => p.id === dep.projectId);
              return (
                <div key={dep.projectId} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Link className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground">{depName}</span>
                    <code className="text-[10px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">{dep.version}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    {isResolved ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                        <CheckCircle className="h-3 w-3" />
                        Resolved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
                        <AlertTriangle className="h-3 w-3" />
                        Missing
                      </span>
                    )}
                    <button
                      className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => void removeDependency(dep.projectId)}
                      title="Remove dependency"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Injection Order Preview */}
        <InjectionOrderPreview
          project={project}
          allProjects={allProjects}
          globalProjects={globalProjects}
          deps={deps}
          isGlobal={isGlobal}
        />
      </div>

      {/* Log Level & XPath (remaining settings) */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-primary" />
          Advanced
        </h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <Label className="text-muted-foreground font-medium text-xs">Log Level</Label>
            <select
              value={settings?.logLevel ?? "info"}
              onChange={(e) => {
                const val = e.target.value as "debug" | "info" | "warn" | "error";
                void onSave({ id: project.id, settings: { ...(settings ?? {}), logLevel: val } as StoredProject["settings"] });
                toast.success(`Log level set to ${val}`);
              }}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </div>
          <div className="col-span-2 space-y-1">
            <p className="text-muted-foreground font-medium">Chat Box XPath</p>
            <div className="flex gap-2 items-center">
              <Input
                value={settings?.chatBoxXPath ?? ""}
                onChange={(e) =>
                  onSave({
                    id: project.id,
                    settings: { ...(settings ?? {}), chatBoxXPath: e.target.value } as StoredProject["settings"],
                  })
                }
                className="flex-1 h-8 text-xs font-mono"
                placeholder="/html/body/..."
              />
              <span className="css-tooltip-wrapper shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onSave({
                      id: project.id,
                      settings: { ...(settings ?? {}), chatBoxXPath: DEFAULT_CHATBOX_XPATH } as StoredProject["settings"],
                    })
                  }
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Reset
                </Button>
                <span className="css-tooltip" style={{ maxWidth: 320, whiteSpace: "normal", fontSize: "9px" }}>
                  Restore default: {DEFAULT_CHATBOX_XPATH}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Developer Tooling Downloads */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Download className="h-4 w-4 text-primary" />
          Developer Tooling
        </h3>
        <p className="text-xs text-muted-foreground">
          Download SDK reference files for IDE IntelliSense or LLM context.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => {
              const guide = generateLlmGuide(codeName, projectSlug);
              const blob = new Blob([guide], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${projectSlug}-llm-guide.md`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success("LLM guide downloaded");
            }}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Download LLM Guide (.md)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => {
              const dts = generateDts();
              const blob = new Blob([dts], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "riseup-macro-sdk.d.ts";
              a.click();
              URL.revokeObjectURL(url);
              toast.success(".d.ts declarations downloaded");
            }}
          >
            <FileCode className="h-3.5 w-3.5" />
            Download .d.ts Declarations
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={async () => {
              const kb = await exportKnowledgeBase({
                extensionId: chrome?.runtime?.id,
                projectContext: {
                  name: project.name,
                  slug: projectSlug,
                  codeName: codeName,
                  version: project.version || "1.0.0",
                },
              });
              const blob = new Blob([kb], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${projectSlug}-ai-knowledge-base.md`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success("AI Knowledge Base downloaded (11 guide docs)");
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Export AI Knowledge Base
          </Button>
        </div>
      </div>

      {/* Activity Log */}
      <ActivityLogSection projectId={project.id} projectSlug={projectSlug} />

      {/* Developer Guide (inline) */}
      <DevGuideSection namespace={toSdkNamespace(projectSlug)} section="all" targetUrls={project.targetUrls ?? []} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Activity Log Section                                               */
/* ------------------------------------------------------------------ */

interface ActivityLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

// eslint-disable-next-line max-lines-per-function
function ActivityLogSection({ projectId, projectSlug }: { projectId: string; projectSlug: string }) {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Attempt to load activity logs from the extension's message system
    const loadLogs = async () => {
      try {
        const response = await import("@/lib/message-client").then((m) =>
          m.sendMessage({ type: "GET_ACTIVITY_LOG", projectId })
        );
        if (Array.isArray(response)) {
          setLogs(response as ActivityLogEntry[]);
        }
      } catch (caught) {
        logError("ProjectDetailView.ActivityLogTab.loadLogs", `GET_ACTIVITY_LOG failed for projectId="${projectId}" — showing empty state`, caught);
      } finally {
        setLoading(false);
      }
    };
    void loadLogs();
  }, [projectId]);

  const handleDownload = () => {
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `activity-log-${projectSlug}-${ts}.txt`;

    const content = logs.length > 0
      ? logs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join("\n")
      : `Activity Log — ${projectSlug}\nExported: ${now.toISOString()}\n\nNo log entries recorded.`;

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Activity log downloaded as ${filename}`);
  };

  const levelColor = (level: string) => {
    switch (level) {
      case "error": return "text-destructive";
      case "warn": return "text-yellow-500";
      case "debug": return "text-muted-foreground/60";
      default: return "text-foreground";
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-primary" />
          Activity Log
          {logs.length > 0 && (
            <span className="text-[10px] font-mono bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded">{logs.length}</span>
          )}
        </h3>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs h-7"
          onClick={handleDownload}
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground italic">Loading activity log…</p>
      ) : logs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No activity log entries yet. Logs will appear after scripts run.</p>
      ) : (
        <div className="max-h-60 overflow-y-auto rounded-md border border-border bg-background p-2 space-y-0.5">
          {logs.map((entry, i) => (
            <div key={i} className="flex gap-2 text-[11px] font-mono leading-relaxed">
              <span className="text-muted-foreground shrink-0 w-[140px]">{entry.timestamp}</span>
              <span className={`shrink-0 w-[50px] font-semibold ${levelColor(entry.level)}`}>{entry.level.toUpperCase()}</span>
              <span className="text-foreground break-all">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Injection Order Preview                                            */
/* ------------------------------------------------------------------ */

interface InjectionOrderPreviewProps {
  project: StoredProject;
  allProjects: StoredProject[];
  globalProjects: StoredProject[];
  deps: Array<{ projectId: string; version: string }>;
  isGlobal: boolean;
}

interface OrderEntry {
  step: number;
  label: string;
  scriptName: string;
  stage: "global" | "dependency" | "project";
  projectName: string;
  isEnabled: boolean;
  order: number;
}

// eslint-disable-next-line max-lines-per-function
function InjectionOrderPreview({ project, allProjects, globalProjects, deps, isGlobal }: InjectionOrderPreviewProps) {
  const [expanded, setExpanded] = useState(true);

  // eslint-disable-next-line max-lines-per-function
  const entries = useMemo(() => {
    const result: OrderEntry[] = [];
    let step = 1;

    // Stage 1: Global projects (their scripts)
    if (!isGlobal) {
      for (const gp of globalProjects) {
        const scripts = gp.scripts ?? [];
        if (scripts.length === 0) {
          result.push({
            step: step++,
            label: "SDK Init",
            scriptName: gp.name,
            stage: "global",
            projectName: gp.name,
            isEnabled: true,
            order: -1000,
          });
        } else {
          for (const s of scripts) {
            result.push({
              step: step++,
              label: s.path.split("/").pop() ?? s.path,
              scriptName: s.path,
              stage: "global",
              projectName: gp.name,
              isEnabled: true,
              order: s.order,
            });
          }
        }
      }
    }

    // Stage 2: Explicit dependency scripts (topological order)
    const visited = new Set<string>();
    const collectDeps = (depList: Array<{ projectId: string; version: string }>) => {
      for (const dep of depList) {
        if (visited.has(dep.projectId)) continue;
        visited.add(dep.projectId);
        const depProject = allProjects.find((p) => p.id === dep.projectId);
        if (!depProject) continue;
        // Skip if it's already a global (handled above)
        if (depProject.isGlobal) continue;
        // Recurse into sub-dependencies first
        if (depProject.dependencies?.length) {
          collectDeps(depProject.dependencies);
        }
        const scripts = depProject.scripts ?? [];
        if (scripts.length === 0) {
          result.push({
            step: step++,
            label: depProject.name,
            scriptName: depProject.name,
            stage: "dependency",
            projectName: depProject.name,
            isEnabled: true,
            order: -500,
          });
        } else {
          for (const s of scripts) {
            result.push({
              step: step++,
              label: s.path.split("/").pop() ?? s.path,
              scriptName: s.path,
              stage: "dependency",
              projectName: depProject.name,
              isEnabled: true,
              order: s.order,
            });
          }
        }
      }
    };
    collectDeps(deps);

    // Stage 3: This project's own scripts
    for (const s of project.scripts ?? []) {
      result.push({
        step: step++,
        label: s.path.split("/").pop() ?? s.path,
        scriptName: s.path,
        stage: "project",
        projectName: project.name,
        isEnabled: true,
        order: s.order,
      });
    }

    return result;
  }, [project, allProjects, globalProjects, deps, isGlobal]);

  if (entries.length === 0) {
    return (
      <div className="rounded-md bg-muted/30 p-2.5">
        <p className="text-[10px] text-muted-foreground">
          <strong>Injection order:</strong> No scripts configured.
        </p>
      </div>
    );
  }

  const stageColor = (stage: OrderEntry["stage"]) => {
    switch (stage) {
      case "global": return "bg-primary/10 text-primary border-primary/30";
      case "dependency": return "bg-accent/50 text-accent-foreground border-accent/30";
      case "project": return "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30";
    }
  };

  const stageLabel = (stage: OrderEntry["stage"]) => {
    switch (stage) {
      case "global": return "Global";
      case "dependency": return "Dep";
      case "project": return "Main";
    }
  };

  const stageIcon = (stage: OrderEntry["stage"]) => {
    switch (stage) {
      case "global": return Globe;
      case "dependency": return Link;
      case "project": return FileCode;
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/10 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <ListOrdered className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-bold text-foreground">Injection Order Preview</span>
        <span className="text-[10px] font-mono text-muted-foreground ml-auto">{entries.length} script{entries.length !== 1 ? "s" : ""}</span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Stage legend */}
          <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/20 border-b border-border">
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Stages:</span>
            {(["global", "dependency", "project"] as const).map((stage) => {
              const count = entries.filter((e) => e.stage === stage).length;
              if (count === 0) return null;
              const Icon = stageIcon(stage);
              return (
                <span key={stage} className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${stageColor(stage)}`}>
                  <Icon className="h-2.5 w-2.5" />
                  {stageLabel(stage)} ({count})
                </span>
              );
            })}
          </div>

          {/* Script list */}
          <div className="divide-y divide-border/50">
            {entries.map((entry, i) => {
              const Icon = stageIcon(entry.stage);
              const showStageDivider = i > 0 && entries[i - 1].stage !== entry.stage;

              return (
                <div key={`${entry.stage}-${entry.scriptName}-${i}`}>
                  {showStageDivider && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-muted/30">
                      <ArrowDown className="h-2.5 w-2.5 text-muted-foreground" />
                      <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                        {entry.stage === "dependency" ? "Dependencies" : entry.stage === "project" ? "Project Scripts" : "Global"}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20 transition-colors">
                    {/* Step number */}
                    <span className="text-[10px] font-mono text-muted-foreground w-5 text-right shrink-0">
                      {entry.step}.
                    </span>

                    {/* Vertical connector line */}
                    <div className="relative flex items-center justify-center w-4 shrink-0">
                      <div className={`h-2.5 w-2.5 rounded-full border-2 ${
                        entry.stage === "global"
                          ? "border-primary bg-primary/20"
                          : entry.stage === "dependency"
                            ? "border-accent-foreground/50 bg-accent/30"
                            : "border-[hsl(var(--success))] bg-[hsl(var(--success))]/20"
                      }`} />
                      {i < entries.length - 1 && (
                        <div className="absolute top-full left-1/2 -translate-x-1/2 w-px h-3 bg-border" />
                      )}
                    </div>

                    {/* Stage badge */}
                    <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${stageColor(entry.stage)}`}>
                      <Icon className="h-2.5 w-2.5" />
                      {stageLabel(entry.stage)}
                    </span>

                    {/* Script name */}
                    <span className="text-[11px] font-mono text-foreground truncate min-w-0">
                      {entry.label}
                    </span>

                    {/* Project name (for deps/globals) */}
                    {entry.stage !== "project" && (
                      <span className="text-[9px] text-muted-foreground truncate ml-auto shrink-0">
                        from {entry.projectName}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-3 py-1.5 bg-muted/20 border-t border-border">
            <p className="text-[9px] text-muted-foreground">
              {isGlobal
                ? "⚡ This is a global project — auto-injected before any matched project."
                : "Injection order: Global → Dependencies (topological) → Project scripts. Each script runs in sequence."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}



// eslint-disable-next-line max-lines-per-function
function DocsTab({ namespace, slug, targetUrls }: { namespace: string; slug: string; targetUrls?: import("./DevGuideSection").DevGuideTargetUrl[] }) {
  const [generating, setGenerating] = useState(false);
  const [docsOutput, setDocsOutput] = useState<{ markdown?: string; prisma?: string } | null>(null);
  const [docsFormat, setDocsFormat] = useState<"markdown" | "prisma">("markdown");

  const handleGenerateDocs = useCallback(async () => {
    setGenerating(true);
    try {
      const resp = await sendMessage<{ isOk: boolean; markdown?: string; prisma?: string; errorMessage?: string }>({
        type: "GENERATE_SCHEMA_DOCS" as any,
        project: slug,
        format: "both",
      });
      if (resp.isOk) {
        setDocsOutput({ markdown: resp.markdown, prisma: resp.prisma });
        toast.success("Schema docs generated");
      } else {
        toast.error(resp.errorMessage ?? "Failed to generate docs");
      }
    } catch {
      toast.error("Failed to generate docs");
    } finally {
      setGenerating(false);
    }
  }, [slug]);

  const activeDoc = docsFormat === "markdown" ? docsOutput?.markdown : docsOutput?.prisma;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          SDK Developer Reference
        </h3>
        <p className="text-xs text-muted-foreground">
          All project data is accessible from injected scripts via the SDK namespace. Scripts run in the page's MAIN world
          and communicate with the extension background via a message bridge.
        </p>
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground font-medium">Project Slug</p>
          <code className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded select-all block w-fit">
            {slug}
          </code>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground font-medium">SDK Namespace</p>
          <code className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded select-all block w-fit">
            {namespace}
          </code>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground font-medium">Available Sub-Namespaces</p>
          <div className="flex flex-wrap gap-1.5">
            {["vars", "urls", "xpath", "cookies", "kv", "files", "meta", "log", "db", "api", "scripts"].map((ns) => (
              <code key={ns} className="text-[10px] font-mono text-foreground bg-muted/30 px-2 py-0.5 rounded border border-border/50">
                {namespace}.{ns}
              </code>
            ))}
          </div>
        </div>
      </div>

      {/* Generate Schema Docs */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Schema Documentation
          </h3>
          <Button size="sm" variant="outline" onClick={handleGenerateDocs} disabled={generating} className="gap-1.5">
            {generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
            {generating ? "Generating…" : "Generate Docs"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Generate Markdown and Prisma-style documentation from this project's database schema.
        </p>

        {docsOutput && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant={docsFormat === "markdown" ? "default" : "outline"}
                onClick={() => setDocsFormat("markdown")}
                className="text-xs h-7 gap-1"
              >
                <FileCode className="h-3 w-3" /> Markdown
              </Button>
              <Button
                size="sm"
                variant={docsFormat === "prisma" ? "default" : "outline"}
                onClick={() => setDocsFormat("prisma")}
                className="text-xs h-7 gap-1"
              >
                <Braces className="h-3 w-3" /> Prisma
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7 gap-1 ml-auto"
                onClick={() => {
                  if (activeDoc) {
                    navigator.clipboard.writeText(activeDoc);
                    toast.success("Copied to clipboard");
                  }
                }}
              >
                Copy
              </Button>
            </div>
            <pre className="text-[10px] font-mono bg-muted/30 border border-border rounded-lg p-3 max-h-[400px] overflow-auto whitespace-pre-wrap text-foreground">
              {activeDoc || "(empty)"}
            </pre>
          </div>
        )}
      </div>

      <DevGuideSection namespace={namespace} section="all" targetUrls={targetUrls} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Scripts Tab Content                                                */
/* ------------------------------------------------------------------ */

interface ScriptsTabContentProps {
  project: StoredProject;
  availableScripts: StoredScript[];
  availableConfigs: StoredConfig[];
  onSave: (project: Partial<StoredProject>) => Promise<void>;
}

// eslint-disable-next-line max-lines-per-function
function ScriptsTabContent({ project, availableScripts, availableConfigs, onSave }: ScriptsTabContentProps) {
  const [pendingBindings, setPendingBindings] = useState<ScriptBinding[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /** Match a project script entry to a library script by name or basename */
  const findScript = (path: string) => {
    const exact = availableScripts.find((as) => as.name === path);
    if (exact) return exact;
    const basename = path.includes("/") ? path.split("/").pop()! : path;
    return availableScripts.find((as) => as.name === basename || as.name.endsWith("/" + basename));
  };

  /** Match a config entry by ID, name, or basename (fixes #68 ID-vs-path mismatch) */
  const findConfig = (idOrPath: string) => {
    const byId = availableConfigs.find((c) => c.id === idOrPath);
    if (byId) return byId;
    const byName = availableConfigs.find((c) => c.name === idOrPath);
    if (byName) return byName;
    const basename = idOrPath.includes("/") ? idOrPath.split("/").pop()! : idOrPath;
    return availableConfigs.find((c) => c.name === basename || c.name.endsWith("/" + basename));
  };

  const unboundPaths = useMemo(() => {
    const set = new Set<string>();
    for (const s of project.scripts ?? []) {
      if (!findScript(s.path)) {
        set.add(s.path);
      }
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute on library or project changes
  }, [project.scripts, availableScripts]);

  /* Phase-1 diagnostic: one-shot console group + Logger.error on unbound bindings.
   * See plan.md "Dashboard scripts not available" + mem://standards/error-logging-via-namespace-logger. */
  useEffect(() => {
    const projectPaths = (project.scripts ?? []).map((s) => s.path);
    const libraryNames = availableScripts.map((s) => s.name);
    const unbound = Array.from(unboundPaths);
    /* eslint-disable no-console -- intentional diagnostic group, not error logging */
    console.groupCollapsed(
      `[Options.ScriptsTab] project="${project.name}" scripts=${projectPaths.length} unbound=${unbound.length}`,
    );
    console.log("project.scripts paths:", projectPaths);
    console.log("availableScripts names:", libraryNames);
    console.log("unbound paths:", unbound);
    console.groupEnd();
    /* eslint-enable no-console */
    if (unbound.length > 0) {
      logError(
        "ScriptsTab.UnboundBinding",
        `Project bindings reference scripts missing from the library.\n  Project: ${project.id} (${project.name})\n  Missing: ${unbound.join(", ")}\n  Reason: No StoredScript.name matches saved project.scripts[].path (exact, basename, or suffix). Library has ${libraryNames.length} scripts; check for rename or missing seed.`,
      );
    }
  }, [project.id, project.name, project.scripts, availableScripts, unboundPaths]);

  const bindings: ScriptBinding[] = (project.scripts ?? []).map((s) => {
    const matched = findScript(s.path);
    const bindingIds = s.configBinding
      ? s.configBinding.split(",").map((id) => id.trim()).filter(Boolean)
      : [];
    const configBindings = bindingIds
      .map((id, i) => {
        const cfg = findConfig(id);
        return cfg ? { configId: cfg.id, configName: cfg.name, json: formatJson(cfg.json), order: i } : null;
      })
      .filter((x): x is { configId: string; configName: string; json: string; order: number } => x !== null);

    return {
      scriptId: matched?.id ?? s.path,
      scriptName: s.path,
      order: s.order,
      runAt: s.runAt ?? "document_idle",
      code: s.code ?? matched?.code ?? "",
      configBindings,
    };
  });

  const handleChange = (newBindings: ScriptBinding[]) => {
    setPendingBindings(newBindings);
  };

  const handleSave = async () => {
    const source = pendingBindings ?? bindings;
    setIsSaving(true);
    const scripts = source.map((b, i) => ({
      path: b.scriptName,
      order: i,
      runAt: b.runAt,
      configBinding: b.configBindings.map((c) => c.configId).join(",") || undefined,
      code: b.code || undefined,
    }));
    await onSave({ id: project.id, scripts });
    setPendingBindings(null);
    setIsSaving(false);
    toast.success("Scripts saved");
  };

  const isDirty = pendingBindings !== null;

  return (
    <div className="space-y-3">
      <ProjectScriptSelector
        availableScripts={availableScripts}
        availableConfigs={availableConfigs}
        selectedScripts={pendingBindings ?? bindings}
        onChange={handleChange}
        unboundScriptNames={unboundPaths}
      />
      <div className="flex items-center justify-end gap-2">
        {isDirty && (
          <span className="text-[10px] text-primary font-medium">● Unsaved changes</span>
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving}
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? "Saving…" : "Save Scripts"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatJson(input: string | number | boolean | null | undefined): string {
  if (typeof input === "string") {
    try {
      return JSON.stringify(JSON.parse(input), null, 2);
    } catch {
      return input;
    }
  }
  try {
    return JSON.stringify(input ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

export default ProjectDetailView;
