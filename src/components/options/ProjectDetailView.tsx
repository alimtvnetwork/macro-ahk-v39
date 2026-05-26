/* eslint-disable @typescript-eslint/no-explicit-any -- untyped extension message types */
import React, { useState, useMemo, lazy, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  MoreHorizontal,
  RefreshCw,
  BookOpen,
  Info,
  FolderOpen,
  Activity,
} from "lucide-react";
import type { StoredProject, StoredScript, StoredConfig } from "@/hooks/use-projects-scripts";
import { ProjectScriptSelector, type ScriptBinding } from "./ProjectScriptSelector";
import { DevGuideSection } from "./DevGuideSection";
import { AutoAttachDiagnosticsPanel } from "./AutoAttachDiagnosticsPanel";
import { slugify, toSdkNamespace } from "@/lib/slug-utils";
import { DocsTab } from "./project-detail/DocsTab";
import { ScriptsTabContent } from "./project-detail/ScriptsTabContent";
import { ProjectHeader } from "./project-detail/ProjectHeader";
import { GeneralTabContent } from "./project-detail/GeneralTabContent";

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
        onSwitchTab={(tab) => setActiveTab(tab as ProjectTab)}
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
              <AutoAttachDiagnosticsPanel
                projectId={project.id}
                autoStart={project.settings?.autoStart === true}
                refreshKey={project.updatedAt ? new Date(project.updatedAt).getTime() : 0}
              />
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
/*  Sub-components extracted to project-detail/ (PERF-R1)              */
/* ------------------------------------------------------------------ */
// ProjectHeader, GeneralTabContent, ActivityLogSection, InjectionOrderPreview,
// DocsTab, and ScriptsTabContent previously lived inline (~950 lines).
// They now live in dedicated files and are imported at the top of this module.

export default ProjectDetailView;
