/* eslint-disable max-lines-per-function */
/**
 * UpdaterManagementView — Global updater management page.
 *
 * Shows all UpdaterInfo entries with CRUD, category badges,
 * check-for-update actions, status indicators, and global update settings.
 * Communicates via LIST_UPDATERS / CREATE_UPDATER / DELETE_UPDATER /
 * CHECK_FOR_UPDATE / GET_UPDATE_SETTINGS / SAVE_UPDATE_SETTINGS messages.
 *
 * See: spec/05-chrome-extension/58-updater-system.md
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Clock,
  ExternalLink,
  GitBranch,
  Shield,
  Search,
  Filter,
  Settings,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
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
import { sendMessage } from "@/lib/message-client";
import { toast } from "sonner";
import { logError } from "./options-logger";

/* ------------------------------------------------------------------ */
/*  Interval Options                                                   */
/* ------------------------------------------------------------------ */

const INTERVAL_OPTIONS = [
  { label: "Hourly", value: 60 },
  { label: "Every 5 hours", value: 300 },
  { label: "Every 12 hours", value: 720 },
  { label: "Daily", value: 1440 },
  { label: "Every 2 days", value: 2880 },
  { label: "Every 3 days", value: 4320 },
  { label: "Every 5 days", value: 7200 },
  { label: "Weekly", value: 10080 },
  { label: "Every 15 days", value: 21600 },
  { label: "Monthly", value: 43200 },
  { label: "Every 2 months", value: 86400 },
  { label: "Every 3 months", value: 129600 },
  { label: "Yearly", value: 525600 },
] as const;

function intervalLabel(minutes: number): string {
  return INTERVAL_OPTIONS.find((o) => o.value === minutes)?.label ?? `${minutes}m`;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UpdaterEntry {
  UpdaterId: number;
  Name: string;
  Description: string | null;
  ScriptUrl: string;
  VersionInfoUrl: string | null;
  InstructionUrl: string | null;
  ChangelogUrl: string | null;
  IsGit: number;
  IsRedirectable: number;
  MaxRedirectDepth: number;
  IsInstructionRedirect: number;
  InstructionRedirectDepth: number;
  HasInstructions: number;
  HasChangelogFromVersionInfo: number;
  HasUserConfirmBeforeUpdate: number;
  IsEnabled: number;
  AutoCheckIntervalMinutes: number;
  CacheExpiryMinutes: number;
  CachedRedirectUrl: string | null;
  CachedRedirectAt: string | null;
  CurrentVersion: string | null;
  LatestVersion: string | null;
  LastCheckedAt: string | null;
  LastUpdatedAt: string | null;
  CreatedAt: string;
  UpdatedAt: string;
  Categories: string;
}

interface GlobalSettings {
  AutoCheckIntervalMinutes: number;
  HasUserConfirmBeforeUpdate: number;
  HasChangelogFromVersionInfo: number;
  CacheExpiryMinutes: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function UpdaterManagementView() {
  const [updaters, setUpdaters] = useState<UpdaterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Global settings state
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    AutoCheckIntervalMinutes: 1440,
    HasUserConfirmBeforeUpdate: 0,
    HasChangelogFromVersionInfo: 1,
    CacheExpiryMinutes: 10080,
  });

  // Add form state
  const [newName, setNewName] = useState("");
  const [newScriptUrl, setNewScriptUrl] = useState("");
  const [newVersionUrl, setNewVersionUrl] = useState("");
  const [newInstructionUrl, setNewInstructionUrl] = useState("");
  const [newChangelogUrl, setNewChangelogUrl] = useState("");
  const [newIsGit, setNewIsGit] = useState(false);
  const [newIsRedirectable, setNewIsRedirectable] = useState(true);
  const [newMaxRedirect, setNewMaxRedirect] = useState(2);
  const [newHasChangelogFromVersionInfo, setNewHasChangelogFromVersionInfo] = useState(true);
  const [newHasUserConfirm, setNewHasUserConfirm] = useState(false);
  const [newAutoCheckInterval, setNewAutoCheckInterval] = useState(1440);
  const [newCacheExpiry, setNewCacheExpiry] = useState(10080);

  const loadUpdaters = useCallback(async () => {
    try {
      const res = await sendMessage<{ updaters: UpdaterEntry[] }>({ type: "LIST_UPDATERS" });
      setUpdaters(res.updaters ?? []);
    } catch {
      setUpdaters([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await sendMessage<{ settings: GlobalSettings }>({ type: "GET_UPDATE_SETTINGS" });
      if (res.settings) setGlobalSettings(res.settings);
    } catch (caught) {
      logError("UpdaterManagementView.loadSettings", "GET_UPDATE_SETTINGS failed — keeping default globalSettings", caught);
    }
  }, []);

  useEffect(() => {
    void loadUpdaters();
    void loadSettings();
  }, [loadUpdaters, loadSettings]);

  const allCategories = Array.from(
    new Set(
      updaters
        .flatMap((u) => (u.Categories ?? "").split(",").map((c) => c.trim()))
        .filter(Boolean),
    ),
  );

  const filtered = updaters.filter((u) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!u.Name.toLowerCase().includes(q) && !u.ScriptUrl.toLowerCase().includes(q)) return false;
    }
    if (filterCategory) {
      const cats = (u.Categories ?? "").split(",").map((c) => c.trim());
      if (!cats.includes(filterCategory)) return false;
    }
    return true;
  });

  const handleAdd = async () => {
    if (!newName.trim() || !newScriptUrl.trim()) {
      toast.error("Name and Script URL are required");
      return;
    }
    try {
      await sendMessage({
        type: "CREATE_UPDATER",
        data: {
          name: newName.trim(),
          scriptUrl: newScriptUrl.trim(),
          versionInfoUrl: newVersionUrl.trim() || undefined,
          instructionUrl: newInstructionUrl.trim() || undefined,
          changelogUrl: newChangelogUrl.trim() || undefined,
          isGit: newIsGit,
          isRedirectable: newIsRedirectable,
          maxRedirectDepth: newMaxRedirect,
          hasChangelogFromVersionInfo: newHasChangelogFromVersionInfo,
          hasUserConfirmBeforeUpdate: newHasUserConfirm,
          autoCheckIntervalMinutes: newAutoCheckInterval,
          cacheExpiryMinutes: newCacheExpiry,
        },
      });
      toast.success(`Created updater "${newName.trim()}"`);
      resetAddForm();
      await loadUpdaters();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create updater");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    try {
      await sendMessage({ type: "DELETE_UPDATER", updaterId: id });
      toast.success(`Deleted "${name}"`);
      await loadUpdaters();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleCheck = async (id: number) => {
    setCheckingId(id);
    try {
      const res = await sendMessage<{ hasUpdate: boolean; latestVersion?: string }>({
        type: "CHECK_FOR_UPDATE",
        updaterId: id,
      });
      if (res.hasUpdate) {
        toast.info(`Update available: v${res.latestVersion}`);
      } else {
        toast.success("Already up to date");
      }
      await loadUpdaters();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check failed");
    } finally {
      setCheckingId(null);
    }
  };

  const handleCheckAll = async () => {
    for (const u of updaters) {
      await handleCheck(u.UpdaterId);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await sendMessage({
        type: "SAVE_UPDATE_SETTINGS",
        data: {
          autoCheckIntervalMinutes: globalSettings.AutoCheckIntervalMinutes,
          hasUserConfirmBeforeUpdate: globalSettings.HasUserConfirmBeforeUpdate === 1,
          hasChangelogFromVersionInfo: globalSettings.HasChangelogFromVersionInfo === 1,
          cacheExpiryMinutes: globalSettings.CacheExpiryMinutes,
        },
      });
      toast.success("Update settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    }
  };

  const resetAddForm = () => {
    setNewName("");
    setNewScriptUrl("");
    setNewVersionUrl("");
    setNewInstructionUrl("");
    setNewChangelogUrl("");
    setNewIsGit(false);
    setNewIsRedirectable(true);
    setNewMaxRedirect(2);
    setNewHasChangelogFromVersionInfo(true);
    setNewHasUserConfirm(false);
    setNewAutoCheckInterval(1440);
    setNewCacheExpiry(10080);
    setIsAdding(false);
  };

  const STATUS_UP_TO_DATE = "up-to-date";
  const STATUS_UPDATE_AVAILABLE = "update-available";

  const getStatus = (u: UpdaterEntry) => {
    if (!u.LastCheckedAt) return "unchecked";
    if (u.CurrentVersion && u.LatestVersion && u.CurrentVersion !== u.LatestVersion) return STATUS_UPDATE_AVAILABLE;
    if (u.LastCheckedAt) return STATUS_UP_TO_DATE;
    return "unchecked";
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case STATUS_UP_TO_DATE: return <CheckCircle className="h-4 w-4 text-[hsl(var(--success))]" />;
      case STATUS_UPDATE_AVAILABLE: return <AlertCircle className="h-4 w-4 text-[hsl(var(--warning))]" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case STATUS_UP_TO_DATE: return "Up to date";
      case STATUS_UPDATE_AVAILABLE: return "Update available";
      default: return "Not checked";
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold tracking-tight">Updater Management</h2>
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Updater Management</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure update sources for scripts, extensions, and binaries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings className="h-3.5 w-3.5" />
            {showSettings ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          {updaters.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => void handleCheckAll()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Check All
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New Updater
          </Button>
        </div>
      </div>

      {/* Global Update Settings */}
      {showSettings && (
        <div className="rounded-lg border border-border p-4 space-y-4 bg-card anim-fade-in-up">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Global Update Settings</h3>
            <span className="text-[10px] text-muted-foreground">(defaults for all sources)</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Auto-Check Interval</Label>
              <Select
                value={String(globalSettings.AutoCheckIntervalMinutes)}
                onValueChange={(v) => setGlobalSettings((s) => ({ ...s, AutoCheckIntervalMinutes: Number(v) }))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Redirect Cache Expiry</Label>
              <Select
                value={String(globalSettings.CacheExpiryMinutes)}
                onValueChange={(v) => setGlobalSettings((s) => ({ ...s, CacheExpiryMinutes: Number(v) }))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={globalSettings.HasUserConfirmBeforeUpdate === 1}
                onCheckedChange={(v) => setGlobalSettings((s) => ({ ...s, HasUserConfirmBeforeUpdate: v ? 1 : 0 }))}
                id="global-confirm"
              />
              <Label htmlFor="global-confirm" className="text-xs cursor-pointer">
                Confirm before updating
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={globalSettings.HasChangelogFromVersionInfo === 1}
                onCheckedChange={(v) => setGlobalSettings((s) => ({ ...s, HasChangelogFromVersionInfo: v ? 1 : 0 }))}
                id="global-changelog"
              />
              <Label htmlFor="global-changelog" className="text-xs cursor-pointer">
                Get changelog from version info
              </Label>
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => void handleSaveSettings()} className="text-xs gap-1.5">
              Save Settings
            </Button>
          </div>
        </div>
      )}

      {/* Search + Category Filter */}
      {updaters.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search updaters…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          {allCategories.length > 0 && (
            <div className="flex items-center gap-1">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                onClick={() => setFilterCategory(null)}
                className={`px-2 py-0.5 rounded text-[10px] transition-all duration-200 ${
                  !filterCategory
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                All
              </button>
              {allCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                  className={`px-2 py-0.5 rounded text-[10px] transition-all duration-200 ${
                    filterCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add form */}
      {isAdding && (
        <div className="rounded-lg border border-border p-4 space-y-3 bg-card anim-fade-in-up">
          <h3 className="text-sm font-semibold">New Update Source</h3>

          {/* Row 1: Name + Version Info URL */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name *</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Main Script" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Version Info URL</Label>
              <Input value={newVersionUrl} onChange={(e) => setNewVersionUrl(e.target.value)} placeholder="https://…" className="h-8 text-xs" />
            </div>
          </div>

          {/* Row 2: Script URL (full width) */}
          <div className="space-y-1">
            <Label className="text-xs">Script / Download URL *</Label>
            <Input value={newScriptUrl} onChange={(e) => setNewScriptUrl(e.target.value)} placeholder="https://…" className="h-8 text-xs" />
          </div>

          {/* Row 3: Instruction URL + Changelog URL */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Instruction URL</Label>
              <Input value={newInstructionUrl} onChange={(e) => setNewInstructionUrl(e.target.value)} placeholder="https://…" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Changelog URL</Label>
              <Input value={newChangelogUrl} onChange={(e) => setNewChangelogUrl(e.target.value)} placeholder="https://…" className="h-8 text-xs" />
            </div>
          </div>

          {/* Row 4: Boolean toggles */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <Switch checked={newIsGit} onCheckedChange={setNewIsGit} id="new-is-git" />
              <Label htmlFor="new-is-git" className="text-xs cursor-pointer">Git repository</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={newIsRedirectable} onCheckedChange={setNewIsRedirectable} id="new-is-redirect" />
              <Label htmlFor="new-is-redirect" className="text-xs cursor-pointer">Allow redirects</Label>
            </div>
            {newIsRedirectable && (
              <div className="flex items-center gap-2">
                <Label className="text-xs">Max depth</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={newMaxRedirect}
                  onChange={(e) => setNewMaxRedirect(Number(e.target.value))}
                  className="h-7 w-16 text-xs text-center"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={newHasChangelogFromVersionInfo} onCheckedChange={setNewHasChangelogFromVersionInfo} id="new-changelog-vi" />
              <Label htmlFor="new-changelog-vi" className="text-xs cursor-pointer">Changelog from version info</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={newHasUserConfirm} onCheckedChange={setNewHasUserConfirm} id="new-confirm" />
              <Label htmlFor="new-confirm" className="text-xs cursor-pointer">Confirm before update</Label>
            </div>
          </div>

          {/* Row 5: Interval selects */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Auto-Check Interval</Label>
              <Select value={String(newAutoCheckInterval)} onValueChange={(v) => setNewAutoCheckInterval(Number(v))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Redirect Cache Expiry</Label>
              <Select value={String(newCacheExpiry)} onValueChange={(v) => setNewCacheExpiry(Number(v))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={resetAddForm} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={() => void handleAdd()} className="text-xs gap-1.5">
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Updater table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-xs text-muted-foreground">
          <RefreshCw className="h-10 w-10 mx-auto mb-3 opacity-15" />
          <p className="font-medium">
            {updaters.length === 0 ? "No update sources configured" : "No results match your filter"}
          </p>
          <p className="mt-1">
            {updaters.length === 0
              ? "Add an update source to enable automatic script updates."
              : "Try adjusting your search or category filter."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_120px_100px_100px_100px_80px] gap-2 px-3 py-2 bg-muted/30 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span>Source</span>
            <span>Version</span>
            <span>Check Freq</span>
            <span>Categories</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Rows */}
          {filtered.map((u, idx) => {
            const status = getStatus(u);
            const categories = (u.Categories ?? "")
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean);

            return (
              <div
                key={u.UpdaterId}
                className={`grid grid-cols-[1fr_120px_100px_100px_100px_80px] gap-2 px-3 py-2.5 items-center hover:bg-muted/20 transition-colors duration-150 ${
                  idx < filtered.length - 1 ? "border-b border-border/50" : ""
                }`}
              >
                {/* Source info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{u.Name}</span>
                    {u.IsGit === 1 && (
                      <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    {u.HasInstructions === 1 && (
                      <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    {u.IsRedirectable === 1 && (
                      <span className="css-tooltip-wrapper">
                        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="css-tooltip">Redirectable (max {u.MaxRedirectDepth} levels)</span>
                      </span>
                    )}
                    {u.HasUserConfirmBeforeUpdate === 1 && (
                      <span className="css-tooltip-wrapper">
                        <Shield className="h-3 w-3 text-primary shrink-0" />
                        <span className="css-tooltip">Requires confirmation</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <ExternalLink className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                    <span className="text-[10px] text-muted-foreground truncate">{u.ScriptUrl}</span>
                  </div>
                </div>

                {/* Version */}
                <div className="text-xs">
                  {u.CurrentVersion ? (
                    <span className="font-mono">{u.CurrentVersion}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {u.LatestVersion && u.CurrentVersion !== u.LatestVersion && (
                    <span className="ml-1 text-[10px] text-[hsl(var(--warning))]">→ {u.LatestVersion}</span>
                  )}
                </div>

                {/* Check Frequency */}
                <div className="text-[10px] text-muted-foreground">
                  {intervalLabel(u.AutoCheckIntervalMinutes)}
                </div>

                {/* Categories */}
                <div className="flex flex-wrap gap-0.5">
                  {categories.length > 0 ? (
                    categories.map((cat) => (
                      <Badge
                        key={cat}
                        variant="secondary"
                        className="text-[9px] px-1.5 py-0 h-4 cursor-pointer hover:bg-primary/20 hover:text-primary transition-all duration-200"
                        onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                      >
                        {cat}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </div>

                {/* Status */}
                <div className="flex items-center gap-1.5">
                  {statusIcon(status)}
                  <span className="text-[10px]">{statusLabel(status)}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-0.5">
                  <span className="css-tooltip-wrapper">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 hover:bg-primary/10 hover:text-primary transition-all duration-200"
                      onClick={() => void handleCheck(u.UpdaterId)}
                      disabled={checkingId === u.UpdaterId}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${checkingId === u.UpdaterId ? "animate-spin" : ""}`} />
                    </Button>
                    <span className="css-tooltip">Check for update</span>
                  </span>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <span className="css-tooltip-wrapper">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10 transition-all duration-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <span className="css-tooltip">Delete updater</span>
                      </span>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete "{u.Name}"?</AlertDialogTitle>
                        <AlertDialogDescription>This will remove the update source permanently.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleDelete(u.UpdaterId, u.Name)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {updaters.length > 0 && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
          <span>{updaters.length} updater{updaters.length !== 1 ? "s" : ""} configured</span>
          <span>
            {updaters.filter((u) => getStatus(u) === STATUS_UPDATE_AVAILABLE).length} update
            {updaters.filter((u) => getStatus(u) === STATUS_UPDATE_AVAILABLE).length !== 1 ? "s" : ""} available
          </span>
        </div>
      )}
    </div>
  );
}

export default UpdaterManagementView;
