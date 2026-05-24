import React, { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
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
import { ArrowLeft, Save, RefreshCw, Download, Trash2 } from "lucide-react";
import type { StoredProject } from "@/hooks/use-projects-scripts";
import { exportProjectAsSqliteZip } from "@/lib/sqlite-bundle";
import { toast } from "sonner";
import { slugify, toCodeName } from "@/lib/slug-utils";

/* ------------------------------------------------------------------ */
/*  Helper: bump patch version                                        */
/* ------------------------------------------------------------------ */

function bumpPatch(v: string): string {
  const parts = v.split(".");
  if (parts.length === 3) {
    parts[2] = String(Number(parts[2] || 0) + 1);
    return parts.join(".");
  }
  return v;
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
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ProjectHeaderProps {
  project: StoredProject;
  onSave: (project: Partial<StoredProject>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBack: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export function ProjectHeader({ project, onSave, onDelete, onBack }: ProjectHeaderProps) {
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
