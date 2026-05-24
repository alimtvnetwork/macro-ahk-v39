import React, { useState, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Info,
  Globe,
  Trash2,
  Link,
  Shield,
  RefreshCw,
  Zap,
  Package,
  Plus,
  CheckCircle,
  AlertTriangle,
  X,
  Stethoscope,
  RotateCcw,
  Download,
  BookOpen,
  FileCode,
  Save,
  Settings,
} from "lucide-react";
import type { StoredProject } from "@/hooks/use-projects-scripts";
import { DEFAULT_CHATBOX_XPATH } from "@/shared/defaults";
import { ActivityLogSection } from "./ActivityLogSection";
import { InjectionOrderPreview } from "./InjectionOrderPreview";
import { DevGuideSection } from "../DevGuideSection";
import { slugify, toCodeName, toSdkNamespace } from "@/lib/slug-utils";
import { generateLlmGuide } from "@/lib/generate-llm-guide";
import { generateDts } from "@/lib/generate-dts";
import { exportKnowledgeBase } from "@/lib/developer-guide-bundle";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GeneralTabContentProps {
  project: StoredProject;
  allProjects: StoredProject[];
  onSave: (project: Partial<StoredProject>) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export function GeneralTabContent({ project, allProjects, onSave }: GeneralTabContentProps) {
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
                  version: project.version || "1.0.1",
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
