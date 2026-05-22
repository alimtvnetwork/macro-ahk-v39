/**
 * Marco Extension — Project Group Panel
 *
 * CRUD for ProjectGroup + member management.
 * Renders as a tab inside LibraryView.
 *
 * @see spec/21-app/02-features/misc-features/cross-project-sync.md §8 Groups
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { sendMessage } from "@/lib/message-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StoredProject } from "@/hooks/use-projects-scripts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Trash2,
  Pencil,
  Users,
  FolderOpen,
  UserPlus,
  UserMinus,
  Loader2,
  ArrowLeft,
  ArrowDownToLine,
} from "lucide-react";
import { toast } from "sonner";
import { logError } from "./options-logger";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProjectGroup {
  Id: number;
  Name: string;
  SharedSettingsJson: string | null;
  CreatedAt: string;
}

interface ProjectGroupMember {
  Id: number;
  GroupId: number;
  /** v9+ contract: UUID string referencing StoredProject.id (chrome.storage.local). */
  ProjectIdUuid: string;
}

interface ProjectGroupPanelProps {
  groups: ProjectGroup[];
  onRefresh: () => void;
}

/* ------------------------------------------------------------------ */
/*  GroupFormDialog                                                     */
/* ------------------------------------------------------------------ */

interface GroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editGroup?: ProjectGroup | null;
}

// eslint-disable-next-line max-lines-per-function -- cohesive dialog with form fields
function GroupFormDialog({ open, onOpenChange, onSaved, editGroup }: GroupFormDialogProps) {
  const [name, setName] = useState(editGroup?.Name ?? "");
  const [settings, setSettings] = useState(editGroup?.SharedSettingsJson ?? "");
  const [saving, setSaving] = useState(false);

  const isEdit = !!editGroup?.Id;

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error("Group name is required");
      return;
    }
    setSaving(true);
    try {
      const result = await sendMessage<{ groupId: number; cascadedCount: number }>({
        type: "LIBRARY_SAVE_GROUP" as never,
        group: {
          ...(isEdit ? { Id: editGroup!.Id } : {}),
          Name: name.trim(),
          SharedSettingsJson: settings.trim() || null,
        },
      } as never);
      const cascadeMsg = result.cascadedCount > 0
        ? ` — settings pushed to ${result.cascadedCount} project(s)`
        : "";
      toast.success((isEdit ? `Group "${name}" updated` : `Group "${name}" created`) + cascadeMsg);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error("Save failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }, [name, settings, isEdit, editGroup, onOpenChange, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEdit ? "Edit Group" : "Create Group"}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? "Update group name and shared settings." : "Create a new project group for shared configuration."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Group Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Production Sites"
              className="h-8 text-sm"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Shared Settings (JSON, optional)</Label>
            <Textarea
              value={settings}
              onChange={e => setSettings(e.target.value)}
              placeholder='{"logLevel": "warn", "retryOnNavigate": true}'
              className="min-h-[80px] font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  GroupDetailPanel                                                    */
/* ------------------------------------------------------------------ */

interface GroupDetailPanelProps {
  group: ProjectGroup;
  onBack: () => void;
  onRefresh: () => void;
}

// eslint-disable-next-line max-lines-per-function -- group detail with member CRUD, splitting would break cohesion
function GroupDetailPanel({ group, onBack, onRefresh }: GroupDetailPanelProps) {
  const [members, setMembers] = useState<ProjectGroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addProjectId, setAddProjectId] = useState("");
  const [adding, setAdding] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<ProjectGroupMember | null>(null);
  const [cascading, setCascading] = useState(false);
  const [allProjects, setAllProjects] = useState<StoredProject[]>([]);
  const [dropActive, setDropActive] = useState(false);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sendMessage<{ members: ProjectGroupMember[] }>({
        type: "LIBRARY_GET_GROUP_MEMBERS" as never,
        groupId: group.Id,
      } as never);
      setMembers(res.members ?? []);
    } catch (err) {
      toast.error("Failed to load members: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [group.Id]);

  // Load on mount AND whenever the selected group changes.
  // Was previously `useState(() => { loadMembers(); })` which only fired
  // during initial mount — switching groups stranded stale member lists.
  useEffect(() => { loadMembers(); }, [loadMembers]);

  // Cross-tab sync: when another Options/popup tab mutates library state,
  // background broadcasts LIBRARY_CHANGED — re-pull this group's members
  // so a drag-assign in tab A appears in tab B without manual refresh.
  useEffect(() => {
    const runtime = (typeof chrome !== "undefined" ? chrome.runtime : undefined) as
      | { onMessage?: { addListener: (fn: (msg: unknown) => void) => void; removeListener: (fn: (msg: unknown) => void) => void } }
      | undefined;
    if (!runtime?.onMessage) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const listener = (message: unknown) => {
      const msg = message as { type?: string } | null;
      if (msg?.type !== "LIBRARY_CHANGED") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void loadMembers(); }, 150);
    };
    runtime.onMessage.addListener(listener);
    return () => {
      if (timer) clearTimeout(timer);
      runtime.onMessage!.removeListener(listener);
    };
  }, [loadMembers]);

  // Load full project roster from chrome.storage.local for the picker dropdown.
  useEffect(() => {
    (async () => {
      try {
        const res = await sendMessage<{ projects: StoredProject[] }>({ type: "GET_ALL_PROJECTS" as never } as never);
        setAllProjects(res.projects ?? []);
      } catch (err) {
        logError("ProjectGroupPanel.loadProjects", "Failed to fetch project list for picker", err);
      }
    })();
  }, []);

  const memberIdSet = useMemo(() => new Set(members.map(m => m.ProjectIdUuid)), [members]);
  const projectsById = useMemo(() => {
    const map = new Map<string, StoredProject>();
    for (const p of allProjects) map.set(p.id, p);
    return map;
  }, [allProjects]);
  const availableProjects = useMemo(
    () => allProjects.filter(p => !memberIdSet.has(p.id)),
    [allProjects, memberIdSet],
  );

  const addMemberById = useCallback(async (projectUuid: string) => {
    if (!projectUuid || memberIdSet.has(projectUuid)) return;
    setAdding(true);
    try {
      await sendMessage({
        type: "LIBRARY_ADD_GROUP_MEMBER" as never,
        groupId: group.Id,
        projectId: projectUuid,
      } as never);
      const name = projectsById.get(projectUuid)?.name ?? projectUuid;
      toast.success(`"${name}" added to group`);
      loadMembers();
    } catch (err) {
      toast.error("Add failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAdding(false);
    }
  }, [group.Id, loadMembers, memberIdSet, projectsById]);

  const handleAddMember = useCallback(async () => {
    if (!addProjectId) {
      toast.error("Select a project");
      return;
    }
    await addMemberById(addProjectId);
    setAddProjectId("");
  }, [addProjectId, addMemberById]);

  const handleRemoveMember = useCallback(async (member: ProjectGroupMember) => {
    try {
      await sendMessage({
        type: "LIBRARY_REMOVE_GROUP_MEMBER" as never,
        groupId: group.Id,
        projectId: member.ProjectIdUuid,
      } as never);
      const name = projectsById.get(member.ProjectIdUuid)?.name ?? member.ProjectIdUuid;
      toast.success(`"${name}" removed`);
      setRemoveMember(null);
      loadMembers();
    } catch (err) {
      toast.error("Remove failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [group.Id, loadMembers, projectsById]);

  const handleDeleteGroup = useCallback(async () => {
    try {
      await sendMessage({
        type: "LIBRARY_DELETE_GROUP" as never,
        groupId: group.Id,
      } as never);
      toast.success(`Group "${group.Name}" deleted`);
      setDeleteOpen(false);
      onRefresh();
      onBack();
    } catch (err) {
      toast.error("Delete failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [group, onBack, onRefresh]);

  const handleCascade = useCallback(async () => {
    setCascading(true);
    try {
      const result = await sendMessage<{ cascadedCount: number }>({
        type: "LIBRARY_CASCADE_GROUP_SETTINGS" as never,
        groupId: group.Id,
      } as never);
      if (result.cascadedCount > 0) {
        toast.success(`Settings pushed to ${result.cascadedCount} project(s)`);
      } else {
        toast.info("No members to cascade to, or no settings configured");
      }
    } catch (err) {
      toast.error("Cascade failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCascading(false);
    }
  }, [group.Id]);

  let parsedSettings: Record<string, unknown> | null = null;
  if (group.SharedSettingsJson) {
    try { parsedSettings = JSON.parse(group.SharedSettingsJson); } catch (caught) {
      logError("ProjectGroupPanel.parseSettings", `Group "${group.Id}" has invalid SharedSettingsJson — rendering with parsedSettings=null`, caught);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Users className="h-5 w-5" />
              {group.Name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created {new Date(group.CreatedAt).toLocaleDateString()} · {members.length} member(s)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      {/* Shared Settings */}
      {parsedSettings && (
        <Card className="border-border/60 bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Shared Settings</h3>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[11px] gap-1"
                onClick={handleCascade}
                disabled={cascading || members.length === 0}
              >
                {cascading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" />}
                Push to {members.length} project(s)
              </Button>
            </div>
            <pre className="text-xs font-mono bg-muted/30 rounded p-3 overflow-x-auto">
              {JSON.stringify(parsedSettings, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Add Member */}
      <div className="flex items-center gap-2">
        <Select value={addProjectId} onValueChange={setAddProjectId} disabled={availableProjects.length === 0}>
          <SelectTrigger className="h-8 text-sm w-64">
            <SelectValue placeholder={availableProjects.length === 0 ? "All projects already in group" : "Select a project…"} />
          </SelectTrigger>
          <SelectContent>
            {availableProjects.map(p => (
              <SelectItem key={p.id} value={p.id} className="text-sm">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={handleAddMember} disabled={adding || !addProjectId}>
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <UserPlus className="h-3.5 w-3.5 mr-1" />}
          Add Member
        </Button>
      </div>

      {/* Draggable available-project chip rail (drag source for drag-to-assign UX) */}
      {availableProjects.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
            Drag a project onto the members list to assign
          </p>
          <div className="flex flex-wrap gap-1.5">
            {availableProjects.map(p => (
              <Badge
                key={p.id}
                variant="outline"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-marco-project-uuid", p.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className="cursor-grab active:cursor-grabbing select-none text-xs px-2 py-1 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                title={`Drag to assign "${p.name}"`}
              >
                {p.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Members List (drop target) */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading members…</span>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-marco-project-uuid")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (!dropActive) setDropActive(true);
            }
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropActive(false);
            const uuid = e.dataTransfer.getData("application/x-marco-project-uuid");
            if (uuid) void addMemberById(uuid);
          }}
          className={
            "rounded-lg border-2 border-dashed transition-colors " +
            (dropActive ? "border-primary bg-primary/5" : "border-border/40")
          }
        >
          {members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <Users className="h-8 w-8 opacity-30" />
              <p className="text-sm">
                {dropActive ? "Drop to add to group" : "No members yet. Drag a project here, or use the dropdown."}
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-2 p-2">
                {members.map(member => {
                  const project = projectsById.get(member.ProjectIdUuid);
                  const displayName = project?.name ?? "(unknown project)";
                  return (
                    <div
                      key={member.Id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-card/50 hover:bg-card/80 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant="outline" className="text-[11px] font-mono px-2 shrink-0">
                          {member.ProjectIdUuid.slice(0, 8)}
                        </Badge>
                        <span className={"text-sm truncate " + (project ? "" : "text-muted-foreground italic")}>
                          {displayName}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoveMember(member)}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>
      )}

      {/* Edit dialog */}
      {editOpen && (
        <GroupFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => { onRefresh(); }}
          editGroup={group}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group "{group.Name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              All member associations will be removed. Projects themselves are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGroup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove member confirmation */}
      <AlertDialog open={!!removeMember} onOpenChange={(v) => { if (!v) setRemoveMember(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{projectsById.get(removeMember?.ProjectIdUuid ?? "")?.name ?? removeMember?.ProjectIdUuid}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This project will no longer inherit shared settings from this group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeMember && handleRemoveMember(removeMember)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ProjectGroupPanel (main export)                                    */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function -- panel with list + detail view, splitting would break navigation state
export function ProjectGroupPanel({ groups, onRefresh }: ProjectGroupPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ProjectGroup | null>(null);

  if (selectedGroup) {
    return (
      <GroupDetailPanel
        group={selectedGroup}
        onBack={() => setSelectedGroup(null)}
        onRefresh={() => { setSelectedGroup(null); onRefresh(); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5" />
            Project Groups
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Organize projects into groups with shared configuration. {groups.length} group(s).
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Group
        </Button>
      </div>

      {/* Group list */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <FolderOpen className="h-10 w-10 opacity-30" />
          <p className="text-sm">No groups yet. Create one to organize related projects.</p>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Create first group
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.map(group => (
            <Card
              key={group.Id}
              className="group relative border-border/60 bg-card/50 hover:bg-card/80 hover:border-primary/30 transition-all duration-200 cursor-pointer hover:shadow-[0_2px_12px_-4px_hsl(var(--primary)/0.15)]"
              onClick={() => setSelectedGroup(group)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold truncate">{group.Name}</h3>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>Created {new Date(group.CreatedAt).toLocaleDateString()}</span>
                  {group.SharedSettingsJson && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">Has settings</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <GroupFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={onRefresh} />
    </div>
  );
}
