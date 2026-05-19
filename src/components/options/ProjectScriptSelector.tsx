import type { JsonValue } from "@/background/handlers/handler-types";
import { useState, useCallback } from "react";
import type { LibraryLinkMap } from "@/hooks/use-library-link-map";
import { SyncBadge } from "./SyncBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Plus, X, FileCode, FileJson, GripVertical, Upload, ChevronDown, ChevronUp, Link2,
} from "lucide-react";
import type { StoredScript, StoredConfig } from "@/hooks/use-projects-scripts";
import { RunAtSelect, RunAtLabel, FileDropZone } from "./ScriptsList";
import { MonacoCodeEditor } from "./LazyMonacoCodeEditor";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A JSON config bound to a script within a project. */
export interface ScriptConfigEntry {
  configId: string;
  configName: string;
  json: string;
  order: number;
}

/** A script binding within a project — multiple JS files + multiple configs. */
export interface ScriptBinding {
  scriptId: string;
  scriptName: string;
  order: number;
  runAt: string;
  code: string;
  configBindings: ScriptConfigEntry[];
  /** Additional JS entries for multi-file bundles */
  additionalJs?: Array<{ id: string; name: string; code: string; order: number; runAt: string }>;
}

interface Props {
  availableScripts: StoredScript[];
  availableConfigs: StoredConfig[];
  selectedScripts: ScriptBinding[];
  onChange: (scripts: ScriptBinding[]) => void;
  linkMap?: LibraryLinkMap;
  /** Names of bindings that don't match any library script — render an Unbound badge. */
  unboundScriptNames?: Set<string>;
}

/* ------------------------------------------------------------------ */
/*  Script Entry Card                                                  */
/* ------------------------------------------------------------------ */

interface ScriptEntryCardProps {
  binding: ScriptBinding;
  index: number;
  totalCount: number;
  availableConfigs: StoredConfig[];
  onUpdate: (patch: Partial<ScriptBinding>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  linkMap?: LibraryLinkMap;
  isUnbound?: boolean;
}

// eslint-disable-next-line max-lines-per-function
function ScriptEntryCard({
  binding, index, totalCount, availableConfigs,
  onUpdate, onRemove, onMoveUp, onMoveDown, linkMap, isUnbound,
}: ScriptEntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("js");

  const unboundConfigs = availableConfigs.filter(
    (c) => !binding.configBindings.some((b) => b.configId === c.id)
  );

  const handleAddConfig = (configId: string) => {
    if (configId === "__none__") return;
    const cfg = availableConfigs.find((c) => c.id === configId);
    if (!cfg) return;
    if (binding.configBindings.some((b) => b.configId === configId)) {
      toast.info("Config already bound");
      return;
    }
    onUpdate({
      configBindings: [
        ...binding.configBindings,
        { configId: cfg.id, configName: cfg.name, json: formatJson(cfg.json), order: binding.configBindings.length },
      ],
    });
  };

  const handleRemoveConfig = (configId: string) => {
    onUpdate({
      configBindings: binding.configBindings
        .filter((b) => b.configId !== configId)
        .map((b, i) => ({ ...b, order: i })),
    });
    if (activeTab === configId) setActiveTab("js");
  };

  const handleConfigJsonChange = (configId: string, json: string) => {
    onUpdate({
      configBindings: binding.configBindings.map((b) =>
        b.configId === configId ? { ...b, json } : b
      ),
    });
  };

  const handleMoveConfig = (configId: string, direction: -1 | 1) => {
    const entries = [...binding.configBindings].sort((a, b) => a.order - b.order);
    const idx = entries.findIndex((e) => e.configId === configId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= entries.length) return;
    [entries[idx], entries[newIdx]] = [entries[newIdx], entries[idx]];
    onUpdate({ configBindings: entries.map((e, i) => ({ ...e, order: i })) });
  };

  const handleJsonFileDrop = (name: string, content: string) => {
    if (!validateJson(content)) { toast.error("Invalid JSON file"); return; }
    const inlineId = `inline_${crypto.randomUUID().slice(0, 8)}`;
    onUpdate({
      configBindings: [
        ...binding.configBindings,
        { configId: inlineId, configName: name, json: formatJson(content), order: binding.configBindings.length },
      ],
    });
  };

  const handleJsFileDrop = (name: string, content: string) => {
    onUpdate({ scriptName: binding.scriptName || name, code: content });
  };

  const sortedConfigs = [...binding.configBindings].sort((a, b) => a.order - b.order);

  return (
    <Card className="border-border hover:border-primary/30 transition-colors">
      <CardContent className="p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5 shrink-0">
            <button
              type="button"
              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={index === 0}
              onClick={onMoveUp}
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={index === totalCount - 1}
              onClick={onMoveDown}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          <Badge variant="secondary" className="text-[10px] font-mono px-1.5 shrink-0">
            #{index + 1}
          </Badge>
          <FileCode className="h-3.5 w-3.5 text-primary/70 shrink-0" />
          <Input
            value={binding.scriptName}
            onChange={(e) => onUpdate({ scriptName: e.target.value })}
            placeholder="script-name.js"
            className="h-7 text-xs flex-1 font-mono"
          />
          <RunAtSelect
            value={binding.runAt}
            onChange={(v) => onUpdate({ runAt: v })}
          />
          {binding.configBindings.length > 0 && (
            <Badge variant="outline" className="text-[9px] shrink-0">
              {binding.configBindings.length} config{binding.configBindings.length !== 1 ? "s" : ""}
            </Badge>
          )}
          {isUnbound && (
            <Badge
              variant="destructive"
              className="text-[9px] shrink-0"
              title={`Script "${binding.scriptName}" is not in the library. Rename the binding to a library script, drop a .js file to define it, or remove this row.`}
            >
              Unbound
            </Badge>
          )}
          {linkMap?.has(binding.scriptName) && (
            <SyncBadge
              state={linkMap.get(binding.scriptName)!.state}
              pinnedVersion={linkMap.get(binding.scriptName)!.pinnedVersion}
              updateAvailable={linkMap.get(binding.scriptName)!.updateAvailable}
            />
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0 text-destructive hover:bg-destructive/10"
            onClick={onRemove}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* Expandable editor */}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full py-0.5">
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`} />
            {expanded ? "Collapse editor" : "Expand editor & configs"}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {/* Config bindings */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[11px] text-muted-foreground">JSON Configs:</span>
                {unboundConfigs.length > 0 && (
                  <Select value="__none__" onValueChange={handleAddConfig}>
                    <SelectTrigger className="flex-1 h-7 text-[11px]">
                      <SelectValue placeholder="Add config from library…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Add config from library…</SelectItem>
                      {unboundConfigs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex items-center gap-1.5">
                            <FileJson className="h-3 w-3 text-muted-foreground" />
                            {c.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Drop zone for JSON */}
              <FileDropZone
                accept=".json"
                label="Drop JSON config files or click to browse"
                icon={Upload}
                onFile={handleJsonFileDrop}
                multiple
              />

              {/* Config chips with ordering */}
              {sortedConfigs.length > 0 && (
                <div className="space-y-1">
                  {sortedConfigs.map((b, ci) => (
                    <div key={b.configId} className="flex items-center gap-1">
                      <div className="flex flex-col gap-0">
                        <button
                          type="button"
                          className="p-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={ci === 0}
                          onClick={() => handleMoveConfig(b.configId, -1)}
                        >
                          <ChevronUp className="h-2.5 w-2.5" />
                        </button>
                        <button
                          type="button"
                          className="p-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
                          disabled={ci === sortedConfigs.length - 1}
                          onClick={() => handleMoveConfig(b.configId, 1)}
                        >
                          <ChevronDown className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      <Badge
                        variant="secondary"
                        className="text-[10px] gap-1 cursor-pointer hover:bg-primary/20"
                        onClick={() => { setActiveTab(b.configId); setExpanded(true); }}
                      >
                        <span className="text-[8px] font-mono text-muted-foreground">#{ci + 1}</span>
                        <FileJson className="h-2.5 w-2.5" />
                        {b.configName}
                        <button
                          type="button"
                          className="ml-0.5 hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); handleRemoveConfig(b.configId); }}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tabbed JS + config editors */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-7 flex-wrap">
                <TabsTrigger value="js" className="text-[10px] gap-1 h-6 px-2">
                  <FileCode className="h-3 w-3" /> JS
                </TabsTrigger>
                {sortedConfigs.map((b) => (
                  <TabsTrigger key={b.configId} value={b.configId} className="text-[10px] gap-1 h-6 px-2">
                    <FileJson className="h-3 w-3" /> {b.configName}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="js" className="mt-2">
                <MonacoCodeEditor
                  language="javascript"
                  value={binding.code}
                  onChange={(code) => onUpdate({ code })}
                  height="200px"
                />
                {!binding.code && (
                  <FileDropZone
                    accept=".js,.mjs"
                    label="Drop JavaScript file or click to browse"
                    icon={FileCode}
                    onFile={handleJsFileDrop}
                  />
                )}
              </TabsContent>

              {sortedConfigs.map((b) => (
                <TabsContent key={b.configId} value={b.configId} className="mt-2">
                  <MonacoCodeEditor
                    language="json"
                    value={b.json}
                    onChange={(json) => handleConfigJsonChange(b.configId, json)}
                    height="200px"
                  />
                </TabsContent>
              ))}
            </Tabs>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export function ProjectScriptSelector({ availableScripts, availableConfigs, selectedScripts, onChange, linkMap, unboundScriptNames }: Props) {
  const [showPicker, setShowPicker] = useState(false);

  const handleAddFromLibrary = (scriptId: string) => {
    const script = availableScripts.find((s) => s.id === scriptId);
    if (!script) return;

    if (selectedScripts.some((s) => s.scriptId === scriptId)) {
      toast.info("Script already added");
      return;
    }

    const bindingIds = script.configBinding
      ? script.configBinding.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const configBindings: ScriptConfigEntry[] = bindingIds
      .map((id, i) => {
        const cfg = availableConfigs.find((c) => c.id === id);
        return cfg ? { configId: cfg.id, configName: cfg.name, json: formatJson(cfg.json), order: i } : null;
      })
      .filter((x): x is ScriptConfigEntry => x !== null);

    const newBinding: ScriptBinding = {
      scriptId: script.id,
      scriptName: script.name,
      order: selectedScripts.length,
      runAt: script.runAt ?? "document_idle",
      code: script.code,
      configBindings,
    };

    onChange([...selectedScripts, newBinding]);
    setShowPicker(false);
  };

  const handleAddBlank = () => {
    const newBinding: ScriptBinding = {
      scriptId: `new_${crypto.randomUUID().slice(0, 8)}`,
      scriptName: "",
      order: selectedScripts.length,
      runAt: "document_idle",
      code: "",
      configBindings: [],
    };
    onChange([...selectedScripts, newBinding]);
  };

  const handleAddFromFile = (name: string, content: string) => {
    const newBinding: ScriptBinding = {
      scriptId: `file_${crypto.randomUUID().slice(0, 8)}`,
      scriptName: name,
      order: selectedScripts.length,
      runAt: "document_idle",
      code: content,
      configBindings: [],
    };
    onChange([...selectedScripts, newBinding]);
    toast.success(`Added script "${name}" from file`);
  };

  const handleRemove = (scriptId: string) => {
    const updated = selectedScripts
      .filter((s) => s.scriptId !== scriptId)
      .map((s, i) => ({ ...s, order: i }));
    onChange(updated);
  };

  const handleUpdate = (scriptId: string, patch: Partial<ScriptBinding>) => {
    onChange(
      selectedScripts.map((s) =>
        s.scriptId === scriptId ? { ...s, ...patch } : s
      )
    );
  };

  const handleMove = (scriptId: string, direction: -1 | 1) => {
    const entries = [...selectedScripts];
    const idx = entries.findIndex((s) => s.scriptId === scriptId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= entries.length) return;
    [entries[idx], entries[newIdx]] = [entries[newIdx], entries[idx]];
    onChange(entries.map((s, i) => ({ ...s, order: i })));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          Scripts
        </label>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 hover:bg-primary/15 hover:text-primary"
            onClick={handleAddBlank}
          >
            <Plus className="h-3 w-3" />
            New Script
          </Button>
          {availableScripts.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 hover:bg-primary/15 hover:text-primary"
              onClick={() => setShowPicker(!showPicker)}
            >
              <FileCode className="h-3 w-3" />
              From Library
            </Button>
          )}
        </div>
      </div>

      {/* Library picker */}
      {showPicker && availableScripts.length > 0 && (
        <div className="border border-primary/30 rounded-md p-2 bg-muted/30">
          <Select onValueChange={handleAddFromLibrary}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a script bundle from library…" />
            </SelectTrigger>
            <SelectContent>
              {availableScripts.map((script) => (
                <SelectItem key={script.id} value={script.id}>
                  <div className="flex items-center gap-2">
                    <FileCode className="h-3 w-3 text-muted-foreground" />
                    <span>{script.name}</span>
                    <span className="text-muted-foreground text-[10px]">
                      <RunAtLabel value={script.runAt ?? "document_idle"} />
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* File drop zone */}
      <FileDropZone
        accept=".js,.mjs"
        label="Drop .js files to add as new script entries"
        icon={FileCode}
        onFile={handleAddFromFile}
        multiple
      />

      {/* Empty state */}
      {selectedScripts.length === 0 && !showPicker && (
        <p className="text-[11px] text-muted-foreground py-2 text-center border border-dashed rounded-md">
          No scripts attached. Click "New Script", "From Library", or drop a .js file.
        </p>
      )}

      {/* Script entries */}
      {selectedScripts.map((binding, index) => (
        <ScriptEntryCard
          key={binding.scriptId}
          binding={binding}
          index={index}
          totalCount={selectedScripts.length}
          availableConfigs={availableConfigs}
          onUpdate={(patch) => handleUpdate(binding.scriptId, patch)}
          onRemove={() => handleRemove(binding.scriptId)}
          onMoveUp={() => handleMove(binding.scriptId, -1)}
          onMoveDown={() => handleMove(binding.scriptId, 1)}
          linkMap={linkMap}
          isUnbound={unboundScriptNames?.has(binding.scriptName) ?? false}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function validateJson(str: string): boolean {
  try { JSON.parse(str); return true; } catch { return false; }
}

function formatJson(input: JsonValue): string {
  if (typeof input === "string") {
    try { return JSON.stringify(JSON.parse(input), null, 2); } catch { return input; }
  }
  try { return JSON.stringify(input ?? {}, null, 2); } catch { return "{}"; }
}
