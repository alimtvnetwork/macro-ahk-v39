import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Variable, Plus, Trash2, Save, Copy } from "lucide-react";
import { sendMessage } from "@/lib/message-client";
import { toast } from "sonner";
import { logError } from "./options-logger";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PromptVarsData {
  variables: Record<string, string>;
  builtIn: string[];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export function PromptVariablesCard() {
  const [data, setData] = useState<PromptVarsData | null>(null);
  const [customVars, setCustomVars] = useState<Array<{ key: string; value: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const result = await sendMessage<PromptVarsData>({ type: "GET_PROMPT_VARIABLES" });
        setData(result);
        // Extract custom vars (those not in builtIn list)
        const builtInSet = new Set(result.builtIn);
        const customs = Object.entries(result.variables)
          .filter(([k]) => !builtInSet.has(k))
          .map(([key, value]) => ({ key, value }));
        setCustomVars(customs);
      } catch (caught) {
        logError("PromptVariablesCard.load", "GET_PROMPT_VARIABLES failed — card will render with empty custom vars list", caught);
      }
    };
    void load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const variables: Record<string, string> = {};
      for (const { key, value } of customVars) {
        if (key.trim()) variables[key.trim()] = value;
      }
      await sendMessage({ type: "SAVE_PROMPT_VARIABLES", variables });
      toast.success("Template variables saved");
    } catch {
      toast.error("Failed to save variables");
    } finally {
      setSaving(false);
    }
  };

  const addVariable = () => {
    const key = newKey.trim();
    if (!key) return;
    if (customVars.some((v) => v.key === key) || data?.builtIn.includes(key)) {
      toast.error(`Variable "{{${key}}}" already exists`);
      return;
    }
    setCustomVars((prev) => [...prev, { key, value: newValue }]);
    setNewKey("");
    setNewValue("");
  };

  const removeVariable = (index: number) => {
    setCustomVars((prev) => prev.filter((_, i) => i !== index));
  };

  const updateVariable = (index: number, field: "key" | "value", val: string) => {
    setCustomVars((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: val } : v))
    );
  };

  const copyTag = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`);
    toast.success(`Copied {{${key}}} to clipboard`);
  };

  if (!data) {
    return <div className="text-sm text-muted-foreground">Loading variables…</div>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Variable className="h-4 w-4 text-primary" />
            Prompt Template Variables
          </CardTitle>
          <Button onClick={handleSave} disabled={saving} size="sm" variant="outline" className="gap-1.5 h-7 text-xs">
            <Save className="h-3 w-3" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Use <code className="font-mono text-primary">{"{{key}}"}</code> in prompt text. Variables are replaced before injection.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Built-in variables */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Built-in (auto-computed)</div>
          <div className="flex flex-wrap gap-1.5">
            {data.builtIn.map((key) => (
              <button
                key={key}
                onClick={() => copyTag(key)}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors cursor-pointer"
                title={`Click to copy {{${key}}} — current value: ${data.variables[key]}`}
              >
                <Copy className="h-2.5 w-2.5" />
                {`{{${key}}}`}
                <span className="text-primary/70 ml-1">{data.variables[key]}</span>
              </button>
            ))}
          </div>
        </div>

        <Separator />

        {/* Custom variables */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Custom variables</div>
          {customVars.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={v.key}
                onChange={(e) => updateVariable(i, "key", e.target.value)}
                className="w-32 h-7 text-xs font-mono"
                placeholder="key"
              />
              <span className="text-xs text-muted-foreground">=</span>
              <Input
                value={v.value}
                onChange={(e) => updateVariable(i, "value", e.target.value)}
                className="flex-1 h-7 text-xs"
                placeholder="value"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeVariable(i)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
              <button
                onClick={() => copyTag(v.key)}
                className="text-muted-foreground hover:text-primary"
                title={`Copy {{${v.key}}}`}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          ))}

          {/* Add new variable row */}
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.replace(/\s/g, "_"))}
              className="w-32 h-7 text-xs font-mono"
              placeholder="new_key"
              onKeyDown={(e) => e.key === "Enter" && addVariable()}
            />
            <span className="text-xs text-muted-foreground">=</span>
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="flex-1 h-7 text-xs"
              placeholder="value"
              onKeyDown={(e) => e.key === "Enter" && addVariable()}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={addVariable}
              disabled={!newKey.trim()}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {customVars.length === 0 && (
          <p className="text-[10px] text-muted-foreground italic">
            No custom variables yet. Add one above, then use <code className="font-mono">{"{{key}}"}</code> in your prompts.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
