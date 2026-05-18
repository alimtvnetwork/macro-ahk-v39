/* eslint-disable max-lines-per-function */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, FolderOpen, Upload, ChevronRight, Braces, Code, Globe, X, Download } from "lucide-react";
import type { StoredProject, StoredScript, StoredConfig } from "@/hooks/use-projects-scripts";
import { ProjectScriptSelector, type ScriptBinding } from "./ProjectScriptSelector";
import { JsonTreeEditor } from "./JsonTreeEditor";
import { hasFolderEntry, parseDroppedFolder } from "@/lib/folder-parser";
import { toast } from "sonner";
import { exportProjectAsSqliteZip } from "@/lib/sqlite-bundle";

interface UrlRule {
  pattern: string;
  matchType: string;
}

// ScriptBinding is imported from ProjectScriptSelector

interface Props {
  projects: StoredProject[];
  loading: boolean;
  onSave: (project: Partial<StoredProject>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  availableScripts: StoredScript[];
  availableConfigs: StoredConfig[];
}

interface FormState {
  isOpen: boolean;
  editingId: string | null;
  name: string;
  version: string;
  description: string;
  scriptBindings: ScriptBinding[];
  variables: string;
  targetUrls: UrlRule[];
}

const emptyForm: FormState = {
  isOpen: false,
  editingId: null,
  name: "",
  version: "1.0.0",
  description: "",
  scriptBindings: [],
  variables: "{}",
  targetUrls: [],
};
export function ProjectsList({ projects, loading, onSave, onDelete, availableScripts, availableConfigs }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isDragOver, setIsDragOver] = useState(false);
  const handleOpen = (project?: StoredProject) => {
    const isEditing = project !== undefined;
    const bindings: ScriptBinding[] = isEditing
      ? (project.scripts ?? []).map((s) => {
          const matched = availableScripts.find((as) => as.name === s.path);
          const bindingIds = s.configBinding
            ? s.configBinding.split(",").map((id) => id.trim()).filter(Boolean)
            : [];
          const cfgBindings = bindingIds
            .map((id, i) => {
              const cfg = availableConfigs.find((c) => c.id === id);
              return cfg ? { configId: cfg.id, configName: cfg.name, json: typeof cfg.json === "string" ? cfg.json : "{}", order: i } : null;
            })
            .filter((x): x is { configId: string; configName: string; json: string; order: number } => x !== null);
          return {
            scriptId: matched?.id ?? "",
            scriptName: s.path,
            order: s.order,
            runAt: s.runAt ?? "document_idle",
            code: matched?.code ?? "",
            configBindings: cfgBindings,
          };
        })
      : [];

    setForm({
      isOpen: true,
      editingId: isEditing ? project.id : null,
      name: isEditing ? project.name : "",
      version: isEditing ? project.version : "1.0.0",
      description: isEditing ? (project.description ?? "") : "",
      scriptBindings: bindings,
      variables: isEditing ? (JSON.stringify(project.settings?.variables ?? {}) !== "{}" ? JSON.stringify(project.settings?.variables, null, 2) : "{}") : "{}",
      targetUrls: isEditing ? (project.targetUrls ?? []) : [],
    });
  };

  const handleSave = async () => {
    const isNameEmpty = form.name.trim() === "";
    if (isNameEmpty) {
      toast.error("Project name is required");
      return;
    }

    const scripts = form.scriptBindings.map((b, i) => ({
      path: b.scriptName,
      order: i,
      runAt: b.runAt,
      configBinding: b.configBindings.map((c) => c.configId).join(",") || undefined,
    }));

    await onSave({
      id: form.editingId ?? undefined,
      name: form.name.trim(),
      version: form.version.trim(),
      description: form.description.trim() || undefined,
      targetUrls: form.targetUrls.filter((u) => u.pattern.trim() !== ""),
      scripts,
      variables: form.variables !== "{}" ? form.variables : undefined,
    } as Partial<StoredProject>);

    const isEditing = form.editingId !== null;
    toast.success(isEditing ? "Project updated" : "Project created");
    setForm(emptyForm);
  };

  const handleDelete = async (id: string) => {
    await onDelete(id);
    toast.success("Project deleted");
  };

  const handleFolderDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const dt = e.dataTransfer;
    const isFolder = hasFolderEntry(dt);
    const isMissingFolder = !isFolder;

    if (isMissingFolder) {
      toast.error("Please drop a folder containing marco-project.json");
      return;
    }

    try {
      const parsed = await parseDroppedFolder(dt);
      const configByPath = new Map(
        parsed.configs.map((c) => [c.path, c])
      );

      const bindings: ScriptBinding[] = parsed.scripts.map((s) => ({
        scriptId: `folder_${crypto.randomUUID().slice(0, 8)}`,
        scriptName: s.name,
        order: s.order,
        runAt: s.runAt,
        code: "",
        configBindings: [],
      }));

      const manifestRecord = parsed.manifest as unknown as Record<string, unknown>;
      const manifestVars = manifestRecord.variables;
      const varsJson = manifestVars ? JSON.stringify(manifestVars, null, 2) : "{}";

      setForm((f) => ({
        ...f,
        isOpen: true,
        name: f.name || parsed.manifest.name,
        version: f.version === "1.0.0" ? parsed.manifest.version : f.version,
        description: f.description || parsed.manifest.description,
        scriptBindings: bindings,
        variables: f.variables === "{}" ? varsJson : f.variables,
        targetUrls: f.targetUrls.length === 0 && parsed.manifest.targetUrls.length > 0
          ? parsed.manifest.targetUrls
          : f.targetUrls,
      }));

      toast.success(
        `Imported "${parsed.manifest.name}" — ${parsed.scripts.length} script(s), ${parsed.configs.length} config(s)`
      );
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : "Folder parse failed";
      toast.error(msg);
    }
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading projects…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Projects</h3>
        <Button size="sm" variant="outline" onClick={() => handleOpen()}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New
        </Button>
      </div>

      {form.isOpen && (
        <Card className="border-primary/30">
          <CardContent className="pt-4 space-y-3">
            <Input
              placeholder="Project name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <div className="flex gap-2">
              <Input
                placeholder="Version"
                value={form.version}
                className="w-28"
                onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
              />
              <Input
                placeholder="Description (optional)"
                value={form.description}
                className="flex-1"
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* URL Rules Editor */}
            <Collapsible defaultOpen={form.targetUrls.length > 0}>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-1">
                <ChevronRight className="h-3 w-3 transition-transform data-[state=open]:rotate-90" />
                <Globe className="h-3.5 w-3.5" />
                URL Rules
                {form.targetUrls.length > 0 && (
                  <Badge variant="secondary" className="text-[9px] ml-1 px-1 py-0">
                    {form.targetUrls.length}
                  </Badge>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-2">
                {form.targetUrls.map((rule, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <select
                      value={rule.matchType}
                      onChange={(e) => {
                        setForm((f) => {
                          const urls = [...f.targetUrls];
                          urls[idx] = { ...urls[idx], matchType: e.target.value };
                          return { ...f, targetUrls: urls };
                        });
                      }}
                      className="h-7 text-[10px] rounded border border-border bg-card px-1.5 shrink-0 w-[90px]"
                    >
                      <option value="contains">contains</option>
                      <option value="exact">exact</option>
                      <option value="prefix">prefix</option>
                      <option value="regex">regex</option>
                      <option value="glob">glob</option>
                    </select>
                    <Input
                      value={rule.pattern}
                      onChange={(e) => {
                        setForm((f) => {
                          const urls = [...f.targetUrls];
                          urls[idx] = { ...urls[idx], pattern: e.target.value };
                          return { ...f, targetUrls: urls };
                        });
                      }}
                      placeholder="https://lovable.dev/*"
                      className="h-7 text-xs flex-1 font-mono"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        setForm((f) => ({
                          ...f,
                          targetUrls: f.targetUrls.filter((_, i) => i !== idx),
                        }));
                      }}
                    >
                      <X className="h-3 w-3 text-destructive/70" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px]"
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      targetUrls: [...f.targetUrls, { pattern: "", matchType: "contains" }],
                    }));
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add URL Rule
                </Button>
              </CollapsibleContent>
            </Collapsible>

            <ProjectScriptSelector
              availableScripts={availableScripts}
              availableConfigs={availableConfigs}
              selectedScripts={form.scriptBindings}
              onChange={(scripts) => setForm((f) => ({ ...f, scriptBindings: scripts }))}
            />

            {/* Injection Variables — collapsible JSON editor */}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-1">
                <ChevronRight className="h-3 w-3 transition-transform data-[state=open]:rotate-90" />
                <Braces className="h-3.5 w-3.5" />
                Injection Variables
                {form.variables !== "{}" && (
                  <Badge variant="secondary" className="text-[9px] ml-1 px-1 py-0">
                    {(() => { try { return Object.keys(JSON.parse(form.variables)).length; } catch { return 0; } })()}
                  </Badge>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <Tabs defaultValue="tree" className="w-full">
                  <TabsList className="h-7 w-fit">
                    <TabsTrigger value="tree" className="text-[10px] h-5 px-2">
                      <Braces className="h-3 w-3 mr-1" /> Tree
                    </TabsTrigger>
                    <TabsTrigger value="raw" className="text-[10px] h-5 px-2">
                      <Code className="h-3 w-3 mr-1" /> Raw JSON
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="tree" className="mt-2">
                    <JsonTreeEditor
                      value={form.variables}
                      onChange={(json) => setForm((f) => ({ ...f, variables: json }))}
                    />
                  </TabsContent>
                  <TabsContent value="raw" className="mt-2">
                    <Textarea
                      value={form.variables}
                      onChange={(e) => setForm((f) => ({ ...f, variables: e.target.value }))}
                      className="font-mono text-xs min-h-[100px]"
                      placeholder='{ "key": "value" }'
                    />
                    {(() => {
                      try { JSON.parse(form.variables); return null; } catch {
                        return (
                          <p className="text-[10px] text-destructive mt-1">Invalid JSON</p>
                        );
                      }
                    })()}
                  </TabsContent>
                </Tabs>
              </CollapsibleContent>
            </Collapsible>

            {/* Folder drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleFolderDrop}
              className={`
                border-2 border-dashed rounded-md p-4 text-center transition-colors cursor-pointer
                ${isDragOver
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-muted-foreground/20 text-muted-foreground hover:border-primary/40"
                }
              `}
            >
              <Upload className="h-4 w-4 mx-auto mb-1" />
              <p className="text-[11px]">
                Drop a project folder here to import from <code className="text-[10px] bg-muted px-1 rounded">marco-project.json</code>
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setForm(emptyForm)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave}>
                {form.editingId ? "Update" : "Create"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {projects.length === 0 && !form.isOpen && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No projects yet. Click "New" to create one.
        </p>
      )}
      {projects.map((project) => (
        <Card key={project.id} className="group">
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm">{project.name || "(Unnamed Project)"}</CardTitle>
                {project.version && project.version.trim() !== "" && (
                  <Badge variant="secondary" className="text-[10px]">
                    v{project.version}
                  </Badge>
                )}
                {project.scripts.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {project.scripts.length} script{project.scripts.length !== 1 ? "s" : ""}
                  </Badge>
                )}
                <VariablesBadge variables={project.settings?.variables ? JSON.stringify(project.settings.variables) : undefined} />
                {project.targetUrls && project.targetUrls.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    <Globe className="h-2.5 w-2.5 mr-0.5" />
                    {project.targetUrls.length} URL{project.targetUrls.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={async () => {
                    try {
                      await exportProjectAsSqliteZip(project);
                      toast.success(`Exported "${project.name}"`);
                    } catch (error) {
                      toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleOpen(project)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(project.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            {project.description && (
              <p className="text-xs text-muted-foreground mt-1">{project.description}</p>
            )}
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

/** Displays a badge with variable count for a project. */
function VariablesBadge({ variables }: { variables?: string }) {
  const isAbsent = !variables || variables === "{}";
  if (isAbsent) return null;

  try {
    const count = Object.keys(JSON.parse(variables)).length;
    const isEmpty = count === 0;
    if (isEmpty) return null;

    return (
      <Badge variant="outline" className="text-[10px]">
        <Braces className="h-2.5 w-2.5 mr-0.5" />
        {count} var{count !== 1 ? "s" : ""}
      </Badge>
    );
  } catch {
    return null;
  }
}
