import { useState, useRef, useCallback, forwardRef } from "react";

import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, Copy, Trash2, Upload, Download, Database, Loader2, FileText, Settings2, FolderOpen, Merge, ListChecks } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import type { StoredProject } from "@/hooks/use-projects-scripts";
import { exportAllAsSqliteZip, exportProjectAsSqliteZip, exportProjectsAsSqliteZip, importFromSqliteZip, mergeFromSqliteZip, previewSqliteZip, type BundlePreview, type DiffItem } from "@/lib/sqlite-bundle";
import { buildImportSummary, countCategory, SUMMARY_CATEGORY_ORDER } from "@/lib/import-summary";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  projects: StoredProject[];
  onEdit: (projectId: string) => void;
  onNewProject: () => void;
  onDuplicate: (project: StoredProject) => void;
  onDelete: (id: string) => Promise<void>;
  onImport: (file: File) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
// buildImportSummary / countCategory / SUMMARY_CATEGORY_ORDER live in
// src/lib/import-summary.ts so the counting logic is unit-testable
// without React. See src/lib/__tests__/import-summary.test.ts.

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export const ProjectsListView = forwardRef<HTMLDivElement, Props>(function ProjectsListView({
  projects,
  onEdit,
  onNewProject,
  onDuplicate,
  onDelete,
  onImport,
}, ref) {
  const safeProjects = Array.isArray(projects) ? projects : [];
  const fileRef = useRef<HTMLInputElement>(null);
  const sqliteFileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [importMode, setImportMode] = useState<"merge" | "replace">("replace");
  const [selectExportOpen, setSelectExportOpen] = useState(false);

  const handleImportClick = () => fileRef.current?.click();
  const handleSqliteImportClick = () => {
    if (importMode === "replace") {
      const confirmed = window.confirm(
        "⚠️ Replace All will DELETE all existing projects, scripts, and configs before importing.\n\nThis is destructive and cannot be undone. Continue?"
      );
      if (!confirmed) return;
    }
    sqliteFileRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
      e.target.value = "";
    }
  };

  const handleExportBundle = useCallback(async () => {
    setExporting(true);
    try {
      await exportAllAsSqliteZip();
      toast.success("Exported all projects as SQLite bundle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  }, []);

  const handleSqliteFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      // Compute preview up-front so we can attach a per-category breakdown
      // (matched / new / untouched) to the success toast — same shape as
      // the preview-dialog flow uses for both replace and merge modes.
      let breakdown: string | null = null;
      try {
        const pv = await previewSqliteZip(file);
        breakdown = buildImportSummary(pv, importMode);
      } catch (previewErr) {
        // Preview is best-effort; fall back to the headline counts only.
        const msg = previewErr instanceof Error ? previewErr.message : String(previewErr);
        console.warn("[ProjectsListView] preview for toast breakdown failed:", msg);
      }

      const description = breakdown
        ? { description: <span style={{ whiteSpace: "pre-line" }}>{breakdown}</span> }
        : undefined;

      if (importMode === "replace") {
        const result = await importFromSqliteZip(file);
        toast.success(
          `Replaced with ${result.projectCount} projects, ${result.scriptCount} scripts, ${result.configCount} configs, ${result.promptCount} prompts`,
          description,
        );
      } else {
        const result = await mergeFromSqliteZip(file);
        toast.success(
          `Merged ${result.projectCount} projects, ${result.scriptCount} scripts, ${result.configCount} configs, ${result.promptCount} prompts`,
          description,
        );
      }
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg);
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }, [importMode]);

  const handleConfirmImport = useCallback(async () => {
    if (!pendingFile || !preview) return;
    const summary = buildImportSummary(preview, "replace");
    setPreviewOpen(false);
    setImporting(true);
    try {
      const result = await importFromSqliteZip(pendingFile);
      toast.success(
        `Replaced with ${result.projectCount} projects, ${result.scriptCount} scripts, ${result.configCount} configs, ${result.promptCount} prompts`,
        { description: <span style={{ whiteSpace: "pre-line" }}>{summary}</span> },
      );
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg);
    } finally {
      setImporting(false);
      setPendingFile(null);
      setPreview(null);
    }
  }, [pendingFile, preview]);

  const handleMergeImport = useCallback(async () => {
    if (!pendingFile || !preview) return;
    const summary = buildImportSummary(preview, "merge");
    setPreviewOpen(false);
    setImporting(true);
    try {
      const result = await mergeFromSqliteZip(pendingFile);
      toast.success(
        `Merged ${result.projectCount} projects, ${result.scriptCount} scripts, ${result.configCount} configs, ${result.promptCount} prompts`,
        { description: <span style={{ whiteSpace: "pre-line" }}>{summary}</span> },
      );
      window.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Merge failed";
      toast.error(msg);
    } finally {
      setImporting(false);
      setPendingFile(null);
      setPreview(null);
    }
  }, [pendingFile, preview]);

  const handleCancelPreview = useCallback(() => {
    setPreviewOpen(false);
    setPendingFile(null);
    setPreview(null);
  }, []);

  return (
    <div ref={ref} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between anim-fade-in-down">
        <h2 className="text-xl font-bold tracking-tight uppercase">Projects</h2>
        <div className="hover-scale-sm">
          <Button
            onClick={onNewProject}
            className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      <hr className="border-border" />

      {/* Project Cards */}
      <div className="space-y-4">
        {safeProjects.map((project, index) => (
          <ProjectCard
            key={project.id}
            project={project}
            index={index}
            onEdit={() => onEdit(project.id)}
            onDuplicate={() => onDuplicate(project)}
            onDelete={() => onDelete(project.id)}
          />
        ))}

        {safeProjects.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center anim-fade-in-up anim-delay-2">
            No projects yet. Create one to get started.
          </p>
        )}
      </div>

      {/* Import / Export Actions — matches extension layout */}
      <div
        className="flex flex-wrap items-center gap-2 pt-4 border-t border-border anim-fade-in-up anim-delay-2"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileChange}
        />
        <input
          ref={sqliteFileRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleSqliteFileChange}
        />

        <Button
          variant="outline"
          className="gap-2 hover:bg-primary/10 hover:text-primary transition-all duration-200"
          onClick={handleImportClick}
        >
          <Upload className="h-4 w-4" />
          Import JSON
        </Button>

        <Button
          variant="outline"
          className="gap-2 hover:bg-primary/10 hover:text-primary transition-all duration-200"
          onClick={handleSqliteImportClick}
          disabled={importing}
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          Import SQLite Bundle
        </Button>

        <ToggleGroup
          type="single"
          value={importMode}
          onValueChange={(val) => { if (val) setImportMode(val as "merge" | "replace"); }}
          className="bg-muted/50 border border-border rounded-md p-0.5"
        >
          <ToggleGroupItem value="merge" className="text-xs h-7 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground rounded-sm">
            Merge
          </ToggleGroupItem>
          <ToggleGroupItem value="replace" className="text-xs h-7 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground rounded-sm">
            Replace All
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          variant="outline"
          className="gap-2 hover:bg-primary/10 hover:text-primary transition-all duration-200"
          onClick={() => setSelectExportOpen(true)}
          disabled={exporting || safeProjects.length === 0}
          data-testid="projects-export-selected-open"
        >
          <ListChecks className="h-4 w-4" />
          Export Selected…
        </Button>

        <Button
          variant="outline"
          className="gap-2 hover:bg-primary/10 hover:text-primary transition-all duration-200"
          onClick={handleExportBundle}
          disabled={exporting}
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export SQLite Bundle
        </Button>
      </div>

      {/* Bundle Preview Dialog */}
      <BundlePreviewDialog
        open={previewOpen}
        preview={preview}
        importing={importing}
        onConfirm={handleConfirmImport}
        onMerge={handleMergeImport}
        onCancel={handleCancelPreview}
      />

      {/* Export selected projects picker */}
      <SelectProjectsExportDialog
        open={selectExportOpen}
        projects={safeProjects}
        onOpenChange={setSelectExportOpen}
      />
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Bundle Preview Dialog                                              */
/* ------------------------------------------------------------------ */

interface BundlePreviewDialogProps {
  open: boolean;
  preview: BundlePreview | null;
  importing: boolean;
  onConfirm: () => void;
  onMerge: () => void;
  onCancel: () => void;
}

// eslint-disable-next-line max-lines-per-function
function BundlePreviewDialog({ open, preview, importing, onConfirm, onMerge, onCancel }: BundlePreviewDialogProps) {
  const [backingUp, setBackingUp] = useState(false);

  if (!preview) return null;

  const handleBackupFirst = async () => {
    setBackingUp(true);
    try {
      await exportAllAsSqliteZip();
      toast.success("Backup saved — you can now safely import");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Backup failed";
      toast.error(msg);
    } finally {
      setBackingUp(false);
    }
  };

  const exportDate = preview.exportedAt
    ? new Date(preview.exportedAt).toLocaleString()
    : "Unknown";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Bundle Preview
          </DialogTitle>
          <DialogDescription>
            Review the contents before importing. This will <strong className="text-destructive">replace all existing data</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Exported: {exportDate}
          </p>

          {/* Summary badges */}
          <div className="flex gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <FolderOpen className="h-3 w-3" />
              {preview.projectCount} projects
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <FileText className="h-3 w-3" />
              {preview.scriptCount} scripts
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Settings2 className="h-3 w-3" />
              {preview.configCount} configs
            </Badge>
          </div>

          {/* Per-category breakdown — shows what Merge vs Replace will do
              before the user clicks. Mirrors the post-import toast format
              so previews and confirmations stay in sync. */}
          <CategoryBreakdownTable preview={preview} />

          {/* Detail lists with diff */}
          <ScrollArea className="max-h-48 rounded-md border border-border p-3">
            <div className="space-y-3">
              <DiffSection label="Projects" icon={<FolderOpen className="h-3 w-3 text-primary/60 shrink-0" />} items={preview.projectItems} />
              <DiffSection label="Scripts" icon={<FileText className="h-3 w-3 text-primary/60 shrink-0" />} items={preview.scriptItems} />
              <DiffSection label="Configs" icon={<Settings2 className="h-3 w-3 text-primary/60 shrink-0" />} items={preview.configItems} />
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleBackupFirst}
            disabled={backingUp || importing}
            className="gap-1.5"
          >
            {backingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Back up first
          </Button>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button
              variant="secondary"
              onClick={onMerge}
              disabled={importing || backingUp}
              className="gap-1.5"
            >
              {importing && <Loader2 className="h-4 w-4 animate-spin" />}
              <Merge className="h-4 w-4" />
              Merge
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={importing || backingUp}
              className="gap-1.5"
            >
              {importing && <Loader2 className="h-4 w-4 animate-spin" />}
              Replace All
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Category Breakdown Table                                           */
/* ------------------------------------------------------------------ */

/**
 * Renders the matched / new / untouched counts per category for both
 * Merge and Replace modes side-by-side, so the user sees exactly what
 * each button will do before clicking.
 */
function CategoryBreakdownTable({ preview }: { preview: BundlePreview }) {
  const rows = SUMMARY_CATEGORY_ORDER.map((entry) => {
    const { items, existing } = entry.pick(preview);
    return {
      label: entry.label,
      merge: countCategory(items, existing, "merge"),
      replace: countCategory(items, existing, "replace"),
    };
  });

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="grid grid-cols-7 gap-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/40">
        <div className="col-span-1">Category</div>
        <div className="col-span-3 text-center border-l border-border/60">Merge</div>
        <div className="col-span-3 text-center border-l border-border/60">Replace</div>
      </div>
      <div className="grid grid-cols-7 gap-1 px-2 py-1 text-[10px] text-muted-foreground bg-muted/20">
        <div className="col-span-1" />
        <div className="text-center border-l border-border/60">match</div>
        <div className="text-center">new</div>
        <div className="text-center">keep</div>
        <div className="text-center border-l border-border/60">match</div>
        <div className="text-center">new</div>
        <div className="text-center">delete</div>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-7 gap-1 px-2 py-1.5 text-xs border-t border-border/60">
          <div className="col-span-1 font-medium">{row.label}</div>
          <div className="text-center border-l border-border/60 text-amber-500">{row.merge.matched}</div>
          <div className="text-center text-emerald-500">{row.merge.unmatched}</div>
          <div className="text-center text-muted-foreground">{row.merge.untouched}</div>
          <div className="text-center border-l border-border/60 text-amber-500">{row.replace.matched}</div>
          <div className="text-center text-emerald-500">{row.replace.unmatched}</div>
          <div className="text-center text-destructive">
            {Math.max(0, row.merge.untouched)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Diff Section                                                       */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
function DiffSection({ label, icon, items }: { label: string; icon: React.ReactNode; items: DiffItem[] }) {
  if (items.length === 0) return null;

  const newCount = items.filter((i) => i.status === "new").length;
  const overwriteCount = items.filter((i) => i.status === "overwrite").length;

  return (
    <TooltipProvider delayDuration={200}>
    <div>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        {newCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 cursor-help">
                +{newCount} new
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[200px]">
              Items not found locally — they will be added as new entries.
            </TooltipContent>
          </Tooltip>
        )}
        {overwriteCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400 cursor-help">
                {overwriteCount} overwrite
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[200px]">
              Items with matching IDs already exist — they will be replaced with the imported version.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
            {icon}
            <span className="flex-1 truncate">{item.name}</span>
            <span className={`text-[9px] font-medium uppercase tracking-wider ${
              item.status === "new"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }`}>
              {item.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
    </TooltipProvider>
  );
}


/* ------------------------------------------------------------------ */

interface ProjectCardProps {
  project: StoredProject;
  index: number;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

// eslint-disable-next-line max-lines-per-function
function ProjectCard({ project, index, onEdit, onDuplicate, onDelete }: ProjectCardProps) {
  const [exporting, setExporting] = useState(false);
  const urlCount = project.targetUrls?.length ?? 0;
  const scriptCount = project.scripts?.length ?? 0;
  const configCount = project.configs?.length ?? 0;

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportProjectAsSqliteZip(project);
      toast.success(`Exported "${project.name}" as SQLite bundle`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ animationDelay: `${0.05 * index}s`, animationFillMode: 'both' }}>
      <Card className="border border-border hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 hover:-translate-y-0.5 transition-all duration-300">
        <CardContent className="p-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3
                className="text-base font-semibold text-primary cursor-pointer hover:underline hover:translate-x-0.5 transition-transform"
                onClick={onEdit}
              >
                {project.name}
              </h3>
              <Badge variant="secondary" className="text-[10px]">
                v{project.version}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {urlCount} URL rules · {scriptCount} scripts · {configCount} configs
            </p>
            {project.description && (
              <p className="text-xs text-muted-foreground/80">{project.description}</p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <ActionButton label="Edit" icon={<Pencil className="h-3 w-3" />} onClick={onEdit} />
            <ActionButton label="Duplicate" icon={<Copy className="h-3 w-3" />} onClick={onDuplicate} />
            <ActionButton
              label="Export"
              icon={exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
              onClick={handleExport}
            />
            <DeleteButton projectName={project.name} onDelete={onDelete} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

interface ActionButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

/** Animated action button with hover scale. */
function ActionButton({ label, icon, onClick }: ActionButtonProps) {
  return (
    <div className="hover-scale-sm">
      <Button
        size="sm"
        variant="outline"
        className="gap-1 text-xs hover:bg-primary/10 hover:text-primary transition-all duration-200"
        onClick={onClick}
      >
        {icon}
        {label}
      </Button>
    </div>
  );
}

interface DeleteButtonProps {
  projectName: string;
  onDelete: () => void;
}

/** Animated delete button with confirmation dialog. */
function DeleteButton({ projectName, onDelete }: DeleteButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <div className="hover-scale-sm">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all duration-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{projectName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Select-projects export dialog                                      */
/* ------------------------------------------------------------------ */

interface SelectProjectsExportDialogProps {
  open: boolean;
  projects: StoredProject[];
  onOpenChange: (open: boolean) => void;
}

// eslint-disable-next-line max-lines-per-function
function SelectProjectsExportDialog({
  open,
  projects,
  onOpenChange,
}: SelectProjectsExportDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Reset selection whenever the dialog opens so re-opens start clean.
  const handleOpenChange = (next: boolean) => {
    if (!next) setSelectedIds(new Set());
    onOpenChange(next);
  };

  const toggle = (id: string, on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const allChecked = projects.length > 0 && selectedIds.size === projects.length;
  const someChecked = selectedIds.size > 0 && selectedIds.size < projects.length;
  const toggleAll = (on: boolean) => {
    setSelectedIds(on ? new Set(projects.map((p) => p.id)) : new Set());
  };

  const handleExport = async () => {
    const chosen = projects.filter((p) => selectedIds.has(p.id));
    if (chosen.length === 0) {
      toast.error("Pick at least one project to export");
      return;
    }
    setBusy(true);
    try {
      // Multi-select uses the same real-SQLite-in-ZIP format as the full
      // bundle / single-project exporters — only the row set differs.
      await exportProjectsAsSqliteZip(chosen);
      toast.success(
        chosen.length === 1
          ? `Exported "${chosen[0].name}" as SQLite bundle`
          : `Exported ${chosen.length} projects as SQLite bundle`,
      );
      handleOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="projects-export-selected-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            Export selected projects
          </DialogTitle>
          <DialogDescription>
            Pick which projects to bundle. The export uses the same
            SQLite-in-ZIP format as <em>Export SQLite Bundle</em> and includes
            each project's referenced scripts and configs.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 border-b border-border pb-2 text-sm font-medium">
          <Checkbox
            checked={allChecked ? true : someChecked ? "indeterminate" : false}
            onCheckedChange={(v) => toggleAll(v === true)}
            aria-label="Select all projects"
          />
          <span className="flex-1">Select all</span>
          <span className="text-xs text-muted-foreground">
            {selectedIds.size}/{projects.length}
          </span>
        </label>

        <ScrollArea className="max-h-[40vh] pr-3">
          <ul className="space-y-1.5">
            {projects.map((p) => {
              const checked = selectedIds.has(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-border hover:bg-muted/40">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggle(p.id, v === true)}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {p.scripts?.length ?? 0} scripts · {p.configs?.length ?? 0} configs
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => { void handleExport(); }}
            disabled={busy || selectedIds.size === 0}
            data-testid="projects-export-selected-apply"
          >
            {busy ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Building…</>) : "Download .zip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
