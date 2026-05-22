/**
 * Marco Extension — Library View (Cross-Project Sync)
 *
 * Shared asset library with AssetCard grid, SyncBadge status indicators,
 * and PromoteDialog for pushing local assets to the library.
 *
 * @see spec/21-app/02-features/misc-features/cross-project-sync.md
 */

import { useState, useEffect, useCallback } from "react";
import { sendMessage } from "@/lib/message-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plus,
  Search,
  Trash2,
  Upload,
  Download,
  RefreshCw,
  MoreVertical,
  Copy,
  GitFork,
  Link2,
  Unlink,
  Pin,
  Loader2,
  Library,
  FileCode,
  MessageSquare,
  Zap,
  Settings2,
  Users,
  ArrowUpCircle,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Lightbulb,
  ArrowRight,
} from "lucide-react";
import { ProjectGroupPanel } from "./ProjectGroupPanel";
import { VersionHistory } from "./VersionHistory";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AssetType = "prompt" | "script" | "chain" | "preset";
type LinkState = "synced" | "pinned" | "detached";

interface SharedAsset {
  Id: number;
  Type: AssetType;
  Name: string;
  Slug: string;
  ContentJson: string;
  ContentHash: string;
  Version: string;
  CreatedAt: string;
  UpdatedAt: string;
}

interface AssetLink {
  Id: number;
  SharedAssetId: number;
  ProjectId: number;
  LinkState: LinkState;
  PinnedVersion: string | null;
  LocalOverrideJson: string | null;
  SyncedAt: string;
}

interface ProjectGroup {
  Id: number;
  Name: string;
  SharedSettingsJson: string | null;
  CreatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  SyncBadge — re-exported from ./SyncBadge so non-lazy consumers     */
/*  (ProjectScriptSelector, PromptManagerPanel) don't pull this entire */
/*  module and break the dynamic-import chunk split.                   */
/* ------------------------------------------------------------------ */

import { SyncBadge } from "./SyncBadge";
export { SyncBadge };

/* ------------------------------------------------------------------ */
/*  AssetTypeIcon                                                      */
/* ------------------------------------------------------------------ */

function AssetTypeIcon({ type }: { type: AssetType }) {
  const icons: Record<AssetType, typeof FileCode> = {
    prompt: MessageSquare,
    script: FileCode,
    chain: Zap,
    preset: Settings2,
  };
  const Icon = icons[type];
  return <Icon className="h-4 w-4 text-muted-foreground" />;
}

/* ------------------------------------------------------------------ */
/*  AssetCard                                                          */
/* ------------------------------------------------------------------ */

interface AssetCardProps {
  asset: SharedAsset;
  links: AssetLink[];
  onSync: (assetId: number) => void;
  onDelete: (assetId: number) => void;
  onViewDetail: (asset: SharedAsset) => void;
}

// eslint-disable-next-line max-lines-per-function -- single card with delete dialog, splitting would reduce cohesion
export function AssetCard({ asset, links, onSync, onDelete, onViewDetail }: AssetCardProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const syncedCount = links.filter(l => l.LinkState === "synced").length;
  const pinnedCount = links.filter(l => l.LinkState === "pinned").length;
  const totalLinked = links.length;

  return (
    <>
      <Card
        className="group relative border-border/60 bg-card/50 hover:bg-card/80 hover:border-primary/30 transition-all duration-200 cursor-pointer hover:shadow-[0_2px_12px_-4px_hsl(var(--primary)/0.15)]"
        onClick={() => onViewDetail(asset)}
      >
        <CardContent className="p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AssetTypeIcon type={asset.Type} />
              <h3 className="text-sm font-semibold truncate">{asset.Name}</h3>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={e => { e.stopPropagation(); onSync(asset.Id); }}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  Sync to projects
                </DropdownMenuItem>
                <DropdownMenuItem onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(asset.Slug); toast.success("Slug copied"); }}>
                  <Copy className="h-3.5 w-3.5 mr-2" />
                  Copy slug
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={e => { e.stopPropagation(); setDeleteOpen(true); }}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Slug + version */}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <code className="bg-muted/50 px-1.5 py-0.5 rounded font-mono truncate">{asset.Slug}</code>
            <Badge variant="outline" className="text-[10px] px-1 py-0">v{asset.Version}</Badge>
          </div>

          {/* Links summary */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Link2 className="h-3 w-3" />
              {totalLinked} linked
            </span>
            {syncedCount > 0 && (
              <span className="text-emerald-400">{syncedCount} synced</span>
            )}
            {pinnedCount > 0 && (
              <span className="text-amber-400">{pinnedCount} pinned</span>
            )}
          </div>

          {/* Type badge */}
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 capitalize">{asset.Type}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{asset.Name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              All synced and pinned links will be detached. Project copies will be preserved as independent assets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDelete(asset.Id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PromoteDialog                                                      */
/* ------------------------------------------------------------------ */

interface PromoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPromoted: () => void;
}

// eslint-disable-next-line max-lines-per-function -- dialog with form + conflict resolution, splitting would break state cohesion
export function PromoteDialog({ open, onOpenChange, onPromoted }: PromoteDialogProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<AssetType>("prompt");
  const [content, setContent] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [conflict, setConflict] = useState<{ assetId: number; existingVersion: string } | null>(null);

  const resetForm = useCallback(() => {
    setName("");
    setSlug("");
    setType("prompt");
    setContent("");
    setConflict(null);
    setPromoting(false);
  }, []);

  const handlePromote = useCallback(async () => {
    if (!name.trim() || !slug.trim() || !content.trim()) {
      toast.error("Name, slug, and content are required");
      return;
    }

    setPromoting(true);
    try {
      const result = await sendMessage<{
        action: "created" | "identical" | "conflict";
        assetId?: number;
        existingVersion?: string;
      }>({
        type: "LIBRARY_PROMOTE_ASSET" as never,
        slug: slug.trim(),
        name: name.trim(),
        assetType: type,
        contentJson: content.trim(),
      } as never);

      if (result.action === "created") {
        toast.success(`"${name}" added to library`);
        resetForm();
        onOpenChange(false);
        onPromoted();
      } else if (result.action === "identical") {
        toast.info("Asset already exists with identical content");
        setPromoting(false);
      } else if (result.action === "conflict") {
        setConflict({ assetId: result.assetId!, existingVersion: result.existingVersion! });
        setPromoting(false);
      }
    } catch (err) {
      toast.error("Failed to promote asset: " + (err instanceof Error ? err.message : String(err)));
      setPromoting(false);
    }
  }, [name, slug, type, content, resetForm, onOpenChange, onPromoted]);

  const handleReplace = useCallback(async () => {
    if (!conflict) return;
    setPromoting(true);
    try {
      await sendMessage({
        type: "LIBRARY_REPLACE_ASSET" as never,
        assetId: conflict.assetId,
        contentJson: content.trim(),
        name: name.trim(),
      } as never);
      toast.success(`"${name}" replaced (new version created)`);
      resetForm();
      onOpenChange(false);
      onPromoted();
    } catch (err) {
      toast.error("Replace failed: " + (err instanceof Error ? err.message : String(err)));
      setPromoting(false);
    }
  }, [conflict, content, name, resetForm, onOpenChange, onPromoted]);

  const handleFork = useCallback(async () => {
    if (!conflict) return;
    setPromoting(true);
    try {
      const result = await sendMessage<{ slug: string }>({
        type: "LIBRARY_FORK_ASSET" as never,
        originalSlug: slug.trim(),
        name: name.trim(),
        assetType: type,
        contentJson: content.trim(),
      } as never);
      toast.success(`Forked as "${result.slug}"`);
      resetForm();
      onOpenChange(false);
      onPromoted();
    } catch (err) {
      toast.error("Fork failed: " + (err instanceof Error ? err.message : String(err)));
      setPromoting(false);
    }
  }, [conflict, slug, name, type, content, resetForm, onOpenChange, onPromoted]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Promote to Library
          </DialogTitle>
          <DialogDescription>
            Push a local asset to the shared library for cross-project reuse.
          </DialogDescription>
        </DialogHeader>

        {conflict ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
              <p className="text-sm font-medium text-amber-400">Content Conflict</p>
              <p className="text-xs text-muted-foreground">
                An asset with slug <code className="bg-muted px-1 rounded">{slug}</code> already
                exists at version <strong>{conflict.existingVersion}</strong> with different content.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConflict(null)} disabled={promoting}>Cancel</Button>
              <Button variant="secondary" onClick={handleFork} disabled={promoting}>
                {promoting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <GitFork className="h-3.5 w-3.5 mr-1" />}
                Fork
              </Button>
              <Button onClick={handleReplace} disabled={promoting}>
                {promoting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                Replace
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="My Prompt" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Slug</Label>
                <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder="my-prompt" className="h-8 text-sm font-mono" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={v => setType(v as AssetType)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prompt">Prompt</SelectItem>
                  <SelectItem value="script">Script</SelectItem>
                  <SelectItem value="chain">Chain</SelectItem>
                  <SelectItem value="preset">Preset</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Content (JSON)</Label>
              <Textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder='{"text": "Your prompt content..."}'
                className="min-h-[120px] font-mono text-xs"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handlePromote} disabled={promoting || !name.trim() || !slug.trim() || !content.trim()}>
                {promoting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                Promote
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  AssetDetailPanel                                                   */
/* ------------------------------------------------------------------ */

interface AssetDetailPanelProps {
  asset: SharedAsset;
  links: AssetLink[];
  onBack: () => void;
  onSync: (assetId: number) => void;
  onDelete: (assetId: number) => void;
  onLinkStateChange: (link: AssetLink, newState: LinkState) => void;
  onRefresh: () => void;
}

/** Confirmation text per state transition */
const LINK_STATE_CONFIRM: Record<string, { title: string; desc: string; action: string }> = {
  "synced→pinned": {
    title: "Pin this link?",
    desc: "The project copy will be locked at the current version. Future library updates won't auto-apply — you'll see an \"update available\" badge instead.",
    action: "Pin",
  },
  "synced→detached": {
    title: "Detach this link?",
    desc: "The project copy will become fully independent. It will no longer receive updates from the library. This cannot be undone without re-linking.",
    action: "Detach",
  },
  "pinned→synced": {
    title: "Resume syncing?",
    desc: "The project copy will be overwritten with the latest library version and will auto-update on future changes.",
    action: "Resume Sync",
  },
  "pinned→detached": {
    title: "Detach this link?",
    desc: "The project copy will become fully independent. It will no longer receive updates from the library. This cannot be undone without re-linking.",
    action: "Detach",
  },
  "detached→synced": {
    title: "Re-sync this link?",
    desc: "The project copy will be overwritten with the latest library version immediately and will auto-update on future changes.",
    action: "Sync",
  },
  "detached→pinned": {
    title: "Pin this link?",
    desc: "The project copy will be pinned to the current library version. It won't auto-update but you can manually pull changes.",
    action: "Pin",
  },
};

/** Available transitions per current state */
const LINK_STATE_OPTIONS: Record<LinkState, LinkState[]> = {
  synced: ["pinned", "detached"],
  pinned: ["synced", "detached"],
  detached: ["synced", "pinned"],
};

const LINK_STATE_ICONS: Record<LinkState, typeof RefreshCw> = {
  synced: RefreshCw,
  pinned: Pin,
  detached: Unlink,
};

// eslint-disable-next-line max-lines-per-function -- detail panel with meta cards + link state toggles + actions
function AssetDetailPanel({ asset, links, onBack, onSync, onDelete, onLinkStateChange, onRefresh }: AssetDetailPanelProps) {
  const [confirmState, setConfirmState] = useState<{ link: AssetLink; newState: LinkState } | null>(null);

  const confirmKey = confirmState
    ? `${confirmState.link.LinkState}→${confirmState.newState}` as const
    : null;
  const confirmCfg = confirmKey ? LINK_STATE_CONFIRM[confirmKey] : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">← Back</Button>
        <div className="flex items-center gap-2">
          <AssetTypeIcon type={asset.Type} />
          <h2 className="text-lg font-bold tracking-tight">{asset.Name}</h2>
        </div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">v{asset.Version}</Badge>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-border/60 bg-card/50">
          <CardContent className="p-4 space-y-2">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Info</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Slug</span><code className="font-mono">{asset.Slug}</code></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{asset.Type}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Hash</span><code className="font-mono truncate max-w-[140px]">{asset.ContentHash.slice(0, 12)}…</code></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{new Date(asset.CreatedAt).toLocaleDateString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Updated</span><span>{new Date(asset.UpdatedAt).toLocaleDateString()}</span></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/50">
          <CardContent className="p-4 space-y-2">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Linked Projects</p>
            {links.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No projects linked</p>
            ) : (
              <div className="space-y-2">
                {links.map(link => {
                  const options = LINK_STATE_OPTIONS[link.LinkState];
                  return (
                    <div key={link.Id} className="flex items-center justify-between text-xs gap-2">
                      <span className="text-muted-foreground shrink-0">Project #{link.ProjectId}</span>
                      <div className="flex items-center gap-1.5">
                        <SyncBadge
                          state={link.LinkState}
                          pinnedVersion={link.PinnedVersion}
                          updateAvailable={link.LinkState === "pinned" && link.PinnedVersion !== null && link.PinnedVersion !== asset.Version}
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-5 w-5">
                              <MoreVertical className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            {options.map(targetState => {
                              const Icon = LINK_STATE_ICONS[targetState];
                              return (
                                <DropdownMenuItem
                                  key={targetState}
                                  onClick={() => setConfirmState({ link, newState: targetState })}
                                >
                                  <Icon className="h-3.5 w-3.5 mr-2" />
                                  {targetState === "synced" ? "Sync" : targetState === "pinned" ? "Pin" : "Detach"}
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Content preview */}
      <Card className="border-border/60 bg-card/50">
        <CardContent className="p-4 space-y-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Content</p>
          <ScrollArea className="h-[200px]">
            <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground p-2 bg-muted/30 rounded-md">
              {(() => {
                try { return JSON.stringify(JSON.parse(asset.ContentJson), null, 2); } catch { return asset.ContentJson; }
              })()}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onSync(asset.Id)}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Sync to projects
        </Button>
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(asset.ContentJson); toast.success("Content copied"); }}>
          <Copy className="h-3.5 w-3.5 mr-1" />
          Copy content
        </Button>
        <Button size="sm" variant="destructive" onClick={() => onDelete(asset.Id)}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </div>

      {/* Version History */}
      <VersionHistory
        assetId={asset.Id}
        currentHash={asset.ContentHash}
        currentVersion={asset.Version}
        onRollback={onRefresh}
      />

      {/* Link State Change Confirmation Dialog */}
      <AlertDialog open={!!confirmState} onOpenChange={open => { if (!open) setConfirmState(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCfg?.title ?? "Change link state?"}</AlertDialogTitle>
            <AlertDialogDescription>{confirmCfg?.desc ?? ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmState) {
                  onLinkStateChange(confirmState.link, confirmState.newState);
                  setConfirmState(null);
                }
              }}
            >
              {confirmCfg?.action ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LibraryView (main)                                                 */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export function LibraryView() {
  const [assets, setAssets] = useState<SharedAsset[]>([]);
  const [links, setLinks] = useState<AssetLink[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<AssetType | "all">("all");
  const [page, setPage] = useState(0);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<SharedAsset | null>(null);
  const [importExportLoading, setImportExportLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"assets" | "groups">("assets");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [assetsRes, linksRes, groupsRes] = await Promise.all([
        sendMessage<{ assets: SharedAsset[] }>({ type: "LIBRARY_GET_ASSETS" as never }),
        sendMessage<{ links: AssetLink[] }>({ type: "LIBRARY_GET_LINKS" as never }),
        sendMessage<{ groups: ProjectGroup[] }>({ type: "LIBRARY_GET_GROUPS" as never }),
      ]);
      setAssets(assetsRes.assets ?? []);
      setLinks(linksRes.links ?? []);
      setGroups(groupsRes.groups ?? []);
    } catch (err) {
      toast.error("Failed to load library: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Cross-tab sync: any Options/popup tab that mutates a library row triggers
  // a LIBRARY_CHANGED broadcast from the background. Re-pull data so this tab
  // shows the latest groups/assets/links without a manual refresh.
  // Debounce because import/cascade can fire many markDirty() calls in a burst.
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
      timer = setTimeout(() => { void loadData(); }, 150);
    };
    runtime.onMessage.addListener(listener);
    return () => {
      if (timer) clearTimeout(timer);
      runtime.onMessage!.removeListener(listener);
    };
  }, [loadData]);

  const handleSync = useCallback(async (assetId: number) => {
    try {
      const result = await sendMessage<{ syncedCount: number; pinnedNotified: number }>({
        type: "LIBRARY_SYNC_ASSET" as never,
        assetId,
      } as never);
      toast.success(`Synced to ${result.syncedCount} project(s). ${result.pinnedNotified} pinned notified.`);
      loadData();
    } catch (err) {
      toast.error("Sync failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [loadData]);

  const handleDelete = useCallback(async (assetId: number) => {
    try {
      const result = await sendMessage<{ detachedCount: number }>({
        type: "LIBRARY_DELETE_ASSET" as never,
        assetId,
      } as never);
      toast.success(`Deleted. ${result.detachedCount} link(s) detached.`);
      setSelectedAsset(null);
      loadData();
    } catch (err) {
      toast.error("Delete failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [loadData]);

  const handleExport = useCallback(async () => {
    setImportExportLoading(true);
    try {
      const result = await sendMessage<{ bundle: unknown }>({ type: "LIBRARY_EXPORT" as never });
      const blob = new Blob([JSON.stringify(result.bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `marco-library-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Library exported");
    } catch (err) {
      toast.error("Export failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setImportExportLoading(false);
    }
  }, []);

  const handleImport = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImportExportLoading(true);
      try {
        const text = await file.text();
        const bundle = JSON.parse(text);
        const result = await sendMessage<{ imported: number; skipped: number; conflicts: Array<{ slug: string }> }>({
          type: "LIBRARY_IMPORT" as never,
          bundle,
        } as never);
        toast.success(`Imported ${result.imported}, skipped ${result.skipped}, ${result.conflicts.length} conflict(s)`);
        loadData();
      } catch (err) {
        toast.error("Import failed: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setImportExportLoading(false);
      }
    };
    input.click();
  }, [loadData]);

  // Filter + paginate assets
  const PAGE_SIZE = 50;
  const filtered = assets.filter(a => {
    if (filterType !== "all" && a.Type !== filterType) return false;
    if (search && !a.Name.toLowerCase().includes(search.toLowerCase()) && !a.Slug.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.key === "/" && !isInput && activeTab === "assets") {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('[placeholder="Search assets…"]');
        searchInput?.focus();
        return;
      }

      if (e.key === "Escape" && isInput) {
        (target as HTMLInputElement).blur();
        return;
      }

      if (isInput) return;

      if (e.key === "ArrowLeft" && safePage > 0) {
        setPage(p => p - 1);
      } else if (e.key === "ArrowRight" && safePage < totalPages - 1) {
        setPage(p => p + 1);
      }

      if (e.key === "n" && !e.metaKey && !e.ctrlKey && activeTab === "assets") {
        setPromoteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, safePage, totalPages]);

  const linksForAsset = (assetId: number) => links.filter(l => l.SharedAssetId === assetId);

  const handleLinkStateChange = useCallback(async (link: AssetLink, newState: LinkState) => {
    try {
      await sendMessage({
        type: "LIBRARY_SAVE_LINK" as never,
        link: {
          Id: link.Id,
          SharedAssetId: link.SharedAssetId,
          ProjectId: link.ProjectId,
          LinkState: newState,
          PinnedVersion: newState === "pinned" ? (selectedAsset?.Version ?? link.PinnedVersion) : null,
          LocalOverrideJson: link.LocalOverrideJson,
        },
      } as never);
      const labels: Record<LinkState, string> = { synced: "Synced", pinned: "Pinned", detached: "Detached" };
      toast.success(`Project #${link.ProjectId} → ${labels[newState]}`);
      loadData();
    } catch (err) {
      toast.error("State change failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [loadData, selectedAsset]);

  if (selectedAsset) {
    return (
      <AssetDetailPanel
        asset={selectedAsset}
        links={linksForAsset(selectedAsset.Id)}
        onBack={() => setSelectedAsset(null)}
        onSync={handleSync}
        onDelete={handleDelete}
        onLinkStateChange={handleLinkStateChange}
        onRefresh={loadData}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Library className="h-5 w-5" />
            Shared Library
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Manage shared assets across projects. {assets.length} asset(s), {groups.length} group(s).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "assets" && (
            <>
              <Button size="sm" variant="outline" onClick={handleExport} disabled={importExportLoading}>
                <Download className="h-3.5 w-3.5 mr-1" />
                Export
              </Button>
              <Button size="sm" variant="outline" onClick={handleImport} disabled={importExportLoading}>
                <Upload className="h-3.5 w-3.5 mr-1" />
                Import
              </Button>
              <Button size="sm" onClick={() => setPromoteOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Promote
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Top-level Assets / Groups tabs */}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "assets" | "groups")}>
        <TabsList className="h-9">
          <TabsTrigger value="assets" className="text-xs px-3 gap-1.5">
            <Library className="h-3.5 w-3.5" />
            Assets
          </TabsTrigger>
          <TabsTrigger value="groups" className="text-xs px-3 gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Groups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="mt-4 space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                placeholder="Search assets…"
                className="h-8 text-sm pl-8"
              />
            </div>
            <Tabs value={filterType} onValueChange={v => { setFilterType(v as AssetType | "all"); setPage(0); }}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs px-2 h-6">All</TabsTrigger>
                <TabsTrigger value="prompt" className="text-xs px-2 h-6">Prompts</TabsTrigger>
                <TabsTrigger value="script" className="text-xs px-2 h-6">Scripts</TabsTrigger>
                <TabsTrigger value="chain" className="text-xs px-2 h-6">Chains</TabsTrigger>
                <TabsTrigger value="preset" className="text-xs px-2 h-6">Presets</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading library…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-4">
              <Library className="h-12 w-12 opacity-20" />
              {assets.length === 0 ? (
                <>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-foreground">Your shared library is empty</p>
                    <p className="text-xs max-w-xs">
                      Promote prompts, scripts, chains, or presets to share them across projects.
                    </p>
                  </div>

                  {/* Onboarding steps */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg w-full mt-2">
                    {[
                      { step: "1", title: "Promote", desc: "Push a local asset to the library" },
                      { step: "2", title: "Link", desc: "Connect it to other projects" },
                      { step: "3", title: "Sync", desc: "Changes cascade automatically" },
                    ].map(s => (
                      <div key={s.step} className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-card/50 p-3 text-center">
                        <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold">{s.step}</span>
                        <span className="text-xs font-medium text-foreground">{s.title}</span>
                        <span className="text-[10px] text-muted-foreground">{s.desc}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 mt-1">
                    <Button size="sm" onClick={() => setPromoteOpen(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Promote first asset
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleImport} disabled={importExportLoading}>
                      <Upload className="h-3.5 w-3.5 mr-1" />
                      Import library
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm">No assets match your filter.</p>
                  <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setFilterType("all"); setPage(0); }}>
                    Clear filters
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {paged.map(asset => (
                  <AssetCard
                    key={asset.Id}
                    asset={asset}
                    links={linksForAsset(asset.Id)}
                    onSync={handleSync}
                    onDelete={handleDelete}
                    onViewDetail={setSelectedAsset}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">
                    Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      disabled={safePage === 0}
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">
                      Page {safePage + 1} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      disabled={safePage >= totalPages - 1}
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Keyboard hints */}
          <div className="flex items-center gap-4 pt-3 border-t border-border/40 text-[10px] text-muted-foreground/60">
            <span className="flex items-center gap-1"><Keyboard className="h-3 w-3" /> Shortcuts:</span>
            <span><kbd className="px-1 py-0.5 rounded bg-muted/50 font-mono text-[9px]">/</kbd> Search</span>
            <span><kbd className="px-1 py-0.5 rounded bg-muted/50 font-mono text-[9px]">N</kbd> New</span>
            <span><kbd className="px-1 py-0.5 rounded bg-muted/50 font-mono text-[9px]">←</kbd><kbd className="px-1 py-0.5 rounded bg-muted/50 font-mono text-[9px] ml-0.5">→</kbd> Page</span>
            <span><kbd className="px-1 py-0.5 rounded bg-muted/50 font-mono text-[9px]">Esc</kbd> Blur</span>
          </div>
        </TabsContent>

        <TabsContent value="groups" className="mt-4">
          <ProjectGroupPanel groups={groups} onRefresh={loadData} />
        </TabsContent>
      </Tabs>

      {/* Promote dialog */}
      <PromoteDialog open={promoteOpen} onOpenChange={setPromoteOpen} onPromoted={loadData} />
    </div>
  );
}

export default LibraryView;
