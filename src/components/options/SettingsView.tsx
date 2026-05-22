import { useState, useEffect } from "react";
import { useEditorTheme, EDITOR_THEME_OPTIONS, type EditorThemeName } from "@/hooks/use-editor-theme";
import { PromptVariablesCard } from "./PromptVariablesCard";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Settings,
  Bell,
  Shield,
  Monitor,
  Database,
  Save,
  MousePointerClick,
  ChevronDown,
  Palette,
  Zap,
  Timer,
} from "lucide-react";
import { sendMessage } from "@/lib/message-client";
import { toast } from "sonner";
import { DEFAULT_CHATBOX_XPATH } from "@/shared/defaults";
import { logError } from "./options-logger";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SettingsData {
  autoRunOnPageLoad: boolean;
  showNotifications: boolean;
  showInjectionToast: boolean;
  defaultRunAt: "document_start" | "document_idle" | "document_end";
  debugMode: boolean;
  verboseLogging: boolean;
  maxCycleCount: number;
  idleTimeout: number;
  theme: "system" | "light" | "dark";
  chatBoxXPath: string;
  injectionBudgetMs: number;
  optionsMountBudgetMs: number;
}

const DEFAULT_SETTINGS: SettingsData = {
  autoRunOnPageLoad: true,
  showNotifications: true,
  showInjectionToast: true,
  defaultRunAt: "document_idle",
  debugMode: false,
  verboseLogging: false,
  maxCycleCount: 100,
  idleTimeout: 5000,
  theme: "system",
  chatBoxXPath: DEFAULT_CHATBOX_XPATH,
  injectionBudgetMs: 500,
  optionsMountBudgetMs: 1000,
};

/* ------------------------------------------------------------------ */
/*  Settings Group                                                     */
/* ------------------------------------------------------------------ */

interface SettingsGroupProps {
  icon: typeof Settings;
  title: string;
  description: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function SettingsGroup({ icon: Icon, title, description, badge, defaultOpen = false, children }: SettingsGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-all duration-200 group cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{title}</span>
                {badge && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{badge}</Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">{description}</p>
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pt-3 pb-1 space-y-4 border-x border-b border-border rounded-b-lg -mt-1 bg-card/50">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export function SettingsView() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await sendMessage<{ settings?: SettingsData }>({ type: "GET_SETTINGS" });
        if (result.settings) {
          setSettings({ ...DEFAULT_SETTINGS, ...result.settings });
        }
      } catch (caught) {
        logError("SettingsView.load", "GET_SETTINGS failed — using DEFAULT_SETTINGS", caught);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await sendMessage({ type: "SAVE_SETTINGS", settings });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading settings…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight uppercase">Settings</h2>
          <p className="text-xs text-muted-foreground">
            Configure extension behavior and preferences.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <hr className="border-border" />

      {/* Execution & Injection */}
      <SettingsGroup
        icon={Zap}
        title="Execution & Injection"
        description="Script auto-run, injection timing, and cycle limits"
        defaultOpen
      >
        <SettingRow
          label="Auto-run on page load"
          description="Automatically execute matched scripts when a page loads"
        >
          <Switch
            checked={settings.autoRunOnPageLoad}
            onCheckedChange={(v) => update("autoRunOnPageLoad", v)}
          />
        </SettingRow>

        <Separator />

        <SettingRow
          label="Default injection timing"
          description="When to inject scripts by default"
        >
          <Select
            value={settings.defaultRunAt}
            onValueChange={(v) => update("defaultRunAt", v as SettingsData["defaultRunAt"])}
          >
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="document_start">document_start</SelectItem>
              <SelectItem value="document_idle">document_idle</SelectItem>
              <SelectItem value="document_end">document_end</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <Separator />

        <SettingRow
          label="Max cycle count"
          description="Maximum number of macro cycles before auto-stop"
        >
          <Input
            type="number"
            value={settings.maxCycleCount}
            onChange={(e) => update("maxCycleCount", parseInt(e.target.value, 10) || 100)}
            className="w-24 h-8 text-xs"
            min={1}
            max={10000}
          />
        </SettingRow>

        <Separator />

        <SettingRow
          label="Idle timeout (ms)"
          description="Milliseconds to wait for idle detection between cycles"
        >
          <Input
            type="number"
            value={settings.idleTimeout}
            onChange={(e) => update("idleTimeout", parseInt(e.target.value, 10) || 5000)}
            className="w-24 h-8 text-xs"
            min={500}
            max={60000}
            step={500}
          />
        </SettingRow>

        <Separator />

        <SettingRow
          label="Injection budget (ms)"
          description="Performance budget for script injection pipeline. A console warning is logged when exceeded."
        >
          <Input
            type="number"
            value={settings.injectionBudgetMs}
            onChange={(e) => update("injectionBudgetMs", parseInt(e.target.value, 10) || 500)}
            className="w-24 h-8 text-xs"
            min={100}
            max={10000}
            step={100}
          />
        </SettingRow>

        <Separator />

        <SettingRow
          label="Options mount budget (ms)"
          description="Performance budget for Options page mount-to-interactive time. A console warning is logged when exceeded."
        >
          <Input
            type="number"
            value={settings.optionsMountBudgetMs}
            onChange={(e) => update("optionsMountBudgetMs", parseInt(e.target.value, 10) || 1000)}
            className="w-24 h-8 text-xs"
            min={200}
            max={10000}
            step={100}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Appearance & Notifications */}
      <SettingsGroup
        icon={Palette}
        title="Appearance & Notifications"
        description="Theme, toast messages, and visual preferences"
      >
        <SettingRow
          label="Appearance"
          description="Choose color theme"
        >
          <Select
            value={settings.theme}
            onValueChange={(v) => update("theme", v as SettingsData["theme"])}
          >
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <Separator />

        <SettingRow
          label="Show notifications"
          description="Display toast notifications for script events"
        >
          <Switch
            checked={settings.showNotifications}
            onCheckedChange={(v) => update("showNotifications", v)}
          />
        </SettingRow>

        <Separator />

        <SettingRow
          label="Injection toast"
          description="Show a toast in the target tab after script injection (success or failure)"
        >
          <Switch
            checked={settings.showInjectionToast}
            onCheckedChange={(v) => update("showInjectionToast", v)}
          />
        </SettingRow>

        <Separator />

        <EditorThemeRow />
      </SettingsGroup>

      {/* Prompt Injection */}
      <SettingsGroup
        icon={MousePointerClick}
        title="Prompt Injection"
        description="Global fallback XPath for chatbox targeting"
        badge="Fallback"
      >
        <SettingRow
          label="Default Chatbox XPath"
          description="Fallback XPath used when a project doesn't define its own chatBoxXPath"
        >
          <Input
            value={settings.chatBoxXPath}
            onChange={(e) => update("chatBoxXPath", e.target.value)}
            className="w-full max-w-md h-8 text-xs font-mono"
            placeholder="/html/body/..."
          />
        </SettingRow>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Projects can override this in their XPath tab. This value is used only as a fallback.
        </p>
      </SettingsGroup>

      {/* Prompt Variables */}
      <SettingsGroup
        icon={Timer}
        title="Prompt Template Variables"
        description="Define reusable variables for prompt templates"
      >
        <PromptVariablesCard />
      </SettingsGroup>

      {/* Debugging */}
      <SettingsGroup
        icon={Shield}
        title="Debugging & Advanced"
        description="Debug mode, verbose logging, and developer tools"
      >
        <SettingRow
          label="Debug mode"
          description="Enable verbose logging in the console"
        >
          <Switch
            checked={settings.debugMode}
            onCheckedChange={(v) => update("debugMode", v)}
          />
        </SettingRow>

        <Separator />

        <SettingRow
          label="Verbose failure logging"
          description="Capture full outerHTML/textContent of target elements and form values in failure reports. Increases log size — use for debugging."
        >
          <Switch
            checked={settings.verboseLogging}
            onCheckedChange={(v) => update("verboseLogging", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Storage */}
      <SettingsGroup
        icon={Database}
        title="Storage"
        description="Data sync and persistence configuration"
      >
        <SettingRow
          label="Extension data"
          description="All settings, scripts, configs and prompts are synced via chrome.storage.sync"
        >
          <Badge variant="outline" className="text-[10px]">
            <Monitor className="h-3 w-3 mr-1" />
            Synced
          </Badge>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editor Theme Row                                                   */
/* ------------------------------------------------------------------ */

function EditorThemeRow() {
  const { editorTheme, setEditorTheme } = useEditorTheme();

  return (
    <SettingRow
      label="Editor theme"
      description="Syntax coloring theme for all code editors"
    >
      <Select
        value={editorTheme}
        onValueChange={(v) => setEditorTheme(v as EditorThemeName)}
      >
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EDITOR_THEME_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <span className="flex items-center gap-2">
                <span
                  className="inline-flex h-4 w-8 rounded-sm border border-border overflow-hidden shrink-0"
                  style={{ backgroundColor: opt.bg }}
                >
                  {opt.accents.map((c, i) => (
                    <span key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
                  ))}
                </span>
                {opt.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

/* ------------------------------------------------------------------ */
/*  Setting Row                                                        */
/* ------------------------------------------------------------------ */

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export default SettingsView;
