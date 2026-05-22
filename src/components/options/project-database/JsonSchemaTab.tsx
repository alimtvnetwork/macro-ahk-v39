/**
 * JsonSchemaTab — Issue 85
 *
 * Allows users to paste/edit a JSON schema definition (JsonSchemaDef)
 * and trigger auto-migration via APPLY_JSON_SCHEMA, plus generate docs.
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/options/LazyMonacoCodeEditor";
import { DiffEditor } from "@monaco-editor/react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Play, FileText, FileCode, ClipboardCopy, RotateCcw,
  CheckCircle2, AlertCircle, Loader2, Download, DatabaseBackup, BookTemplate,
  GitCompareArrows, X,
} from "lucide-react";
import { toast } from "sonner";
import { sendMessage } from "@/lib/message-client";
import { ErrorModal } from "./ErrorModal";
import { createErrorModel, type ErrorModel } from "@/types/error-model";
import { logError } from "../options-logger";

/* ------------------------------------------------------------------ */
/*  Example template                                                    */
/* ------------------------------------------------------------------ */

const EXAMPLE_SCHEMA = JSON.stringify(
  {
    version: "1.0.0",
    tables: [
      {
        TableName: "Customers",
        Description: "Customer records",
        Columns: [
          { Name: "Email", Type: "TEXT", Unique: true, Description: "Primary email", Validation: { type: "regex", pattern: "^.+@.+$" } },
          { Name: "FullName", Type: "TEXT", Description: "Display name" },
          { Name: "IsActive", Type: "BOOLEAN", Default: "1", Description: "Active flag" },
        ],
      },
      {
        TableName: "Orders",
        Description: "Customer orders",
        Columns: [
          { Name: "CustomerId", Type: "INTEGER", Description: "FK to Customers" },
          { Name: "Total", Type: "REAL", Description: "Order total" },
          { Name: "Status", Type: "TEXT", Default: "'pending'", Validation: { type: "enum", values: ["pending", "shipped", "delivered", "cancelled"] } },
        ],
        Relations: [
          { SourceColumn: "CustomerId", TargetTable: "Customers", OnDelete: "CASCADE" },
        ],
      },
    ],
  },
  null,
  2,
);

/* ------------------------------------------------------------------ */
/*  Built-in schema templates                                          */
/* ------------------------------------------------------------------ */

const SCHEMA_TEMPLATES: Record<string, { label: string; icon: string; schema: object }> = {
  automationChains: {
    label: "AutomationChains",
    icon: "⚡",
    schema: {
      version: "1.0.0",
      tables: [
        {
          TableName: "AutomationChains",
          Description: "Multi-step automation sequences with conditional branching and triggers",
          Columns: [
            { Name: "ProjectId", Type: "TEXT", Default: "'default'", Description: "Owning project identifier" },
            { Name: "Name", Type: "TEXT", Description: "Human-readable chain name" },
            { Name: "Slug", Type: "TEXT", Unique: true, Description: "URL-safe identifier (unique per project)" },
            { Name: "StepsJson", Type: "TEXT", Default: "'[]'", Description: "JSON array of ChainStep objects" },
            { Name: "TriggerType", Type: "TEXT", Default: "'manual'", Description: "Trigger mode: manual | schedule | url_match | hotkey" },
            { Name: "TriggerConfigJson", Type: "TEXT", Default: "'{}'", Description: "JSON trigger configuration" },
            { Name: "Enabled", Type: "INTEGER", Default: "1", Description: "1 = active, 0 = disabled" },
          ],
        },
      ],
    },
  },
  contentManagement: {
    label: "CMS (Categories + Articles + Tags)",
    icon: "📰",
    schema: {
      version: "1.0.0",
      tables: [
        {
          TableName: "Categories",
          Description: "Content categories for organizing articles",
          Columns: [
            { Name: "Name", Type: "TEXT", Description: "Category display name", Validation: { type: "string", minLength: 1, maxLength: 100 } },
            { Name: "Slug", Type: "TEXT", Unique: true, Description: "URL-safe identifier" },
            { Name: "Description", Type: "TEXT", Nullable: true, Description: "Optional category description" },
            { Name: "ParentId", Type: "INTEGER", Nullable: true, Description: "Self-referencing parent for nested categories" },
            { Name: "SortOrder", Type: "INTEGER", Default: "0", Description: "Display ordering" },
          ],
          Relations: [
            { SourceColumn: "ParentId", TargetTable: "Categories", TargetColumn: "Id", OnDelete: "SET NULL" },
          ],
        },
        {
          TableName: "Articles",
          Description: "Published content entries with status tracking",
          Columns: [
            { Name: "Title", Type: "TEXT", Description: "Article headline", Validation: { type: "string", minLength: 1, maxLength: 255 } },
            { Name: "Slug", Type: "TEXT", Unique: true, Description: "URL-safe identifier" },
            { Name: "Body", Type: "TEXT", Description: "Full article content (HTML or Markdown)" },
            { Name: "Excerpt", Type: "TEXT", Nullable: true, Description: "Short summary for listings" },
            { Name: "Status", Type: "TEXT", Default: "'draft'", Description: "Publication status", Validation: { type: "enum", values: ["draft", "published", "archived"] } },
            { Name: "CategoryId", Type: "INTEGER", Nullable: true, Description: "Primary category" },
            { Name: "Author", Type: "TEXT", Nullable: true, Description: "Author name or identifier" },
            { Name: "PublishedAt", Type: "TEXT", Nullable: true, Description: "ISO 8601 publication timestamp" },
          ],
          Relations: [
            { SourceColumn: "CategoryId", TargetTable: "Categories", TargetColumn: "Id", OnDelete: "SET NULL" },
          ],
        },
        {
          TableName: "Tags",
          Description: "Flat taxonomy labels for cross-cutting classification",
          Columns: [
            { Name: "Name", Type: "TEXT", Unique: true, Description: "Tag display name", Validation: { type: "string", minLength: 1, maxLength: 50 } },
            { Name: "Slug", Type: "TEXT", Unique: true, Description: "URL-safe identifier" },
          ],
        },
        {
          TableName: "ArticleTags",
          Description: "Many-to-many junction between Articles and Tags",
          Columns: [
            { Name: "ArticleId", Type: "INTEGER", Description: "FK to Articles" },
            { Name: "TagId", Type: "INTEGER", Description: "FK to Tags" },
          ],
          Relations: [
            { SourceColumn: "ArticleId", TargetTable: "Articles", TargetColumn: "Id", OnDelete: "CASCADE" },
            { SourceColumn: "TagId", TargetTable: "Tags", TargetColumn: "Id", OnDelete: "CASCADE" },
          ],
        },
      ],
    },
  },
  example: {
    label: "Example (Customers + Orders)",
    icon: "📋",
    schema: JSON.parse(EXAMPLE_SCHEMA),
  },
};

const SCHEMA_GUIDE = "## JsonSchemaDef Quick Reference\n\n### Top-Level Structure\n```json\n{ \"version\": \"1.0.0\", \"tables\": [{ \"TableName\": \"...\", \"Columns\": [...], \"Relations\": [...] }] }\n```\n\n### TableDef\n| Field | Type | Required | Notes |\n|-------|------|----------|-------|\n| `TableName` | string | Yes | PascalCase, no underscores |\n| `Description` | string | No | Human-readable purpose |\n| `Columns` | ColumnDef[] | Yes | At least one column |\n| `Relations` | RelationDef[] | No | Foreign key relationships |\n\n> Auto-generated columns (do NOT include): `Id`, `CreatedAt`, `UpdatedAt`\n\n### ColumnDef\n| Field | Type | Required | Notes |\n|-------|------|----------|-------|\n| `Name` | string | Yes | PascalCase |\n| `Type` | string | Yes | TEXT, INTEGER, REAL, BLOB, BOOLEAN |\n| `Nullable` | boolean | No | Allow NULL (default false) |\n| `Default` | string | No | SQL expression (wrap strings in inner quotes) |\n| `Unique` | boolean | No | UNIQUE constraint |\n| `Description` | string | No | Column purpose |\n| `Validation` | object | No | Client-side validation rule |\n\n### Validation Types\n- **string**: `{ \"type\": \"string\", \"minLength\": 1, \"maxLength\": 255 }`\n- **regex**: `{ \"type\": \"regex\", \"pattern\": \"^[a-z]+$\" }`\n- **enum**: `{ \"type\": \"enum\", \"values\": [\"Active\", \"Inactive\"] }`\n- **date**: `{ \"type\": \"date\", \"format\": \"YYYY-MM-DD\" }`\n- **number**: `{ \"type\": \"number\", \"min\": 0, \"max\": 100 }`\n\n### RelationDef\n| Field | Type | Required | Default |\n|-------|------|----------|---------|\n| `SourceColumn` | string | Yes | - |\n| `TargetTable` | string | Yes | - |\n| `TargetColumn` | string | No | Id |\n| `OnDelete` | string | No | NO ACTION (CASCADE, SET NULL, RESTRICT) |\n\n### Default Value Examples\n`\"'pending'\"` string, `\"0\"` number, `\"'[]'\"` JSON array, `\"1\"` boolean, `\"(datetime('now'))\"` timestamp\n\n### Common Mistakes\n- `table_name` should be `TableName` (PascalCase only)\n- Don't include `Id` column (auto-generated)\n- `\"Default\": \"hello\"` should be `\"Default\": \"'hello'\"` (inner quotes)\n- `\"Type\": \"VARCHAR\"` should be `\"Type\": \"TEXT\"` (only 5 types allowed)\n\n### Migration Behavior\n- Additive only: columns/tables added, never dropped\n- Idempotent: re-applying same schema = no changes\n- Transactional: failures roll back cleanly";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MigrationResult {
  tablesCreated: number;
  columnsAdded: number;
  relationsCreated: number;
}

interface Props {
  projectSlug: string;
  onMigrationComplete?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export function JsonSchemaTab({ projectSlug, onMigrationComplete }: Props) {
  const [schemaJson, setSchemaJson] = useState(EXAMPLE_SCHEMA);
  const [migrating, setMigrating] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [lastResult, setLastResult] = useState<MigrationResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [generatingDocs, setGeneratingDocs] = useState(false);
  const [docsOutput, setDocsOutput] = useState<{ markdown?: string; prisma?: string } | null>(null);
  const [autoGenDocs, setAutoGenDocs] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [dbSchemaJson, setDbSchemaJson] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [modalError, setModalError] = useState<ErrorModel | null>(null);
  const [errorModalOpen, setErrorModalOpen] = useState(false);

  /* ---- Load from MetaTables ---- */
  // eslint-disable-next-line max-lines-per-function
  const handleLoadFromMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const result = await sendMessage<{
        isOk: boolean;
        tables?: Array<{ TableName: string; Description?: string }>;
        columns?: Array<{ TableName: string; Name: string; Type: string; NotNull?: boolean; Unique?: boolean; Default?: string; Description?: string; ValidationJson?: string }>;
        relations?: Array<{ SourceTable: string; SourceColumn: string; TargetTable: string; TargetColumn?: string; OnDelete?: string }>;
        errorMessage?: string;
      }>({
        type: "GENERATE_SCHEMA_DOCS",
        project: projectSlug,
        format: "meta",
      });

      if (!result.isOk || !result.tables?.length) {
        toast.info("No tables found in MetaTables. Apply a schema first.");
        return;
      }

      // Reconstruct JsonSchemaDef from meta data
      const tableDefs = result.tables.map((t) => {
        const cols = (result.columns ?? [])
          .filter((c) => c.TableName === t.TableName)
          .map((c) => {
            const col: Record<string, unknown> = { Name: c.Name, Type: c.Type };
            if (c.Description) col.Description = c.Description;
            if (c.NotNull) col.NotNull = true;
            if (c.Unique) col.Unique = true;
            if (c.Default) col.Default = c.Default;
            if (c.ValidationJson) {
              try { col.Validation = JSON.parse(c.ValidationJson); } catch (caught) {
                logError("JsonSchemaTab.exportDdl", `Column "${c.Name}" has invalid ValidationJson — skipping Validation field`, caught);
              }
            }
            return col;
          });

        const rels = (result.relations ?? [])
          .filter((r) => r.SourceTable === t.TableName)
          .map((r) => {
            const rel: Record<string, string> = { SourceColumn: r.SourceColumn, TargetTable: r.TargetTable };
            if (r.TargetColumn && r.TargetColumn !== "Id") rel.TargetColumn = r.TargetColumn;
            if (r.OnDelete) rel.OnDelete = r.OnDelete;
            return rel;
          });

        const def: Record<string, unknown> = { TableName: t.TableName };
        if (t.Description) def.Description = t.Description;
        def.Columns = cols;
        if (rels.length > 0) def.Relations = rels;
        return def;
      });

      const schema = { version: "1.0.0", tables: tableDefs };
      setSchemaJson(JSON.stringify(schema, null, 2));
      setLastResult(null);
      setLastError(null);
      setDocsOutput(null);
      toast.success(`Loaded ${tableDefs.length} table(s) from MetaTables`);
    } catch (err) {
      const errModel = createErrorModel(err, {
        source: "Database",
        operation: "LoadFromDB",
        projectName: projectSlug,
        contextJson: JSON.stringify({ type: "GENERATE_SCHEMA_DOCS", project: projectSlug, format: "meta" }),
        suggestedAction: "Ensure the project slug is set. Try selecting a project from the project list first.",
      });
      setModalError(errModel);
      setErrorModalOpen(true);
      toast.error(`Failed to load: ${String(err)}`);
    } finally {
      setLoadingMeta(false);
    }
  }, [projectSlug]);

  /* ---- Load DB schema for diff ---- */
  // eslint-disable-next-line max-lines-per-function
  const handleLoadDiff = useCallback(async () => {
    setLoadingDiff(true);
    try {
      const result = await sendMessage<{
        isOk: boolean;
        tables?: Array<{ TableName: string; Description?: string }>;
        columns?: Array<{ TableName: string; Name: string; Type: string; NotNull?: boolean; Unique?: boolean; Default?: string; Description?: string; ValidationJson?: string }>;
        relations?: Array<{ SourceTable: string; SourceColumn: string; TargetTable: string; TargetColumn?: string; OnDelete?: string }>;
        errorMessage?: string;
      }>({
        type: "GENERATE_SCHEMA_DOCS",
        project: projectSlug,
        format: "meta",
      });

      if (!result.isOk || !result.tables?.length) {
        setDbSchemaJson(JSON.stringify({ version: "1.0.0", tables: [] }, null, 2));
        setDiffMode(true);
        toast.info("No existing tables in DB — showing empty baseline");
        return;
      }

      const tableDefs = result.tables.map((t) => {
        const cols = (result.columns ?? [])
          .filter((c) => c.TableName === t.TableName)
          .map((c) => {
            const col: Record<string, unknown> = { Name: c.Name, Type: c.Type };
            if (c.Description) col.Description = c.Description;
            if (c.NotNull) col.NotNull = true;
            if (c.Unique) col.Unique = true;
            if (c.Default) col.Default = c.Default;
            if (c.ValidationJson) {
              try { col.Validation = JSON.parse(c.ValidationJson); } catch (caught) {
                logError("JsonSchemaTab.exportCopy", `Column "${c.Name}" has invalid ValidationJson — skipping Validation field`, caught);
              }
            }
            return col;
          });

        const rels = (result.relations ?? [])
          .filter((r) => r.SourceTable === t.TableName)
          .map((r) => {
            const rel: Record<string, string> = { SourceColumn: r.SourceColumn, TargetTable: r.TargetTable };
            if (r.TargetColumn && r.TargetColumn !== "Id") rel.TargetColumn = r.TargetColumn;
            if (r.OnDelete) rel.OnDelete = r.OnDelete;
            return rel;
          });

        const def: Record<string, unknown> = { TableName: t.TableName };
        if (t.Description) def.Description = t.Description;
        def.Columns = cols;
        if (rels.length > 0) def.Relations = rels;
        return def;
      });

      setDbSchemaJson(JSON.stringify({ version: "1.0.0", tables: tableDefs }, null, 2));
      setDiffMode(true);
      toast.success("Diff view loaded");
    } catch (err) {
      const errModel = createErrorModel(err, {
        source: "Database",
        operation: "LoadDiff",
        projectName: projectSlug,
        contextJson: JSON.stringify({ type: "GENERATE_SCHEMA_DOCS", project: projectSlug, format: "meta" }),
        suggestedAction: "Ensure the project database is initialized before loading diff.",
      });
      setModalError(errModel);
      setErrorModalOpen(true);
      toast.error(`Failed to load DB schema: ${String(err)}`);
    } finally {
      setLoadingDiff(false);
    }
  }, [projectSlug]);

  /* ---- Validation ---- */
  const parseSchema = useCallback(() => {
    try {
      const parsed = JSON.parse(schemaJson);
      if (!parsed || !Array.isArray(parsed.tables)) {
        return { valid: false, error: "Root must have a 'tables' array" };
      }
      for (const t of parsed.tables) {
        if (!t.TableName || typeof t.TableName !== "string") {
          return { valid: false, error: `Each table needs a 'TableName' string` };
        }
        if (!Array.isArray(t.Columns) || t.Columns.length === 0) {
          return { valid: false, error: `Table "${t.TableName}" needs at least one column` };
        }
      }
      return { valid: true, schema: parsed, error: null };
    } catch (e) {
      return { valid: false, error: `Invalid JSON: ${(e as Error).message}` };
    }
  }, [schemaJson]);

  const validation = parseSchema();

  /* ---- Apply Migration ---- */
  const handleMigrate = async () => {
    if (!validation.valid) {
      toast.error(validation.error || "Invalid schema");
      return;
    }

    setMigrating(true);
    setLastResult(null);
    setLastError(null);

    try {
      const result = await sendMessage<{ isOk: boolean; result?: MigrationResult; errorMessage?: string }>({
        type: "APPLY_JSON_SCHEMA",
        project: projectSlug,
        schema: validation.schema,
      });

      if (result.isOk && result.result) {
        setLastResult(result.result);
        toast.success(
          `Migration complete: ${result.result.tablesCreated} table(s), ${result.result.columnsAdded} column(s), ${result.result.relationsCreated} relation(s)`,
        );
        onMigrationComplete?.();
        if (autoGenDocs) {
          void handleGenerateDocs("both");
        }
      } else {
        const errMsg = result.errorMessage || "Migration failed";
        setLastError(errMsg);
        toast.error(errMsg);
      }
    } catch (err) {
      const errMsg = String(err);
      setLastError(errMsg);
      toast.error(errMsg);
    } finally {
      setMigrating(false);
    }
  };

  /* ---- Generate Docs ---- */
  const handleGenerateDocs = async (format: "markdown" | "prisma" | "both") => {
    setGeneratingDocs(true);
    try {
      const result = await sendMessage<{ isOk: boolean; markdown?: string; prisma?: string; errorMessage?: string }>({
        type: "GENERATE_SCHEMA_DOCS",
        project: projectSlug,
        format,
      });

      if (result.isOk) {
        setDocsOutput({ markdown: result.markdown, prisma: result.prisma });
        toast.success("Docs generated");
      } else {
        toast.error(result.errorMessage || "Failed to generate docs");
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setGeneratingDocs(false);
    }
  };

  /* ---- Copy to clipboard ---- */
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied to clipboard`),
      () => toast.error("Failed to copy"),
    );
  };

  /* ---- Download as file ---- */
  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            Define tables, columns, validations, and relations in JSON. Migrations are <strong>additive</strong> — existing data is preserved.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={loadingMeta}
            onClick={() => void handleLoadFromMeta()}
          >
            {loadingMeta ? <Loader2 className="h-3 w-3 animate-spin" /> : <DatabaseBackup className="h-3 w-3" />}
            Load from DB
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => {
              navigator.clipboard.writeText(SCHEMA_GUIDE);
              toast.success("Schema authoring guide copied to clipboard");
            }}
          >
            <ClipboardCopy className="h-3 w-3" /> Copy Guide
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                <BookTemplate className="h-3 w-3" /> Templates
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {Object.entries(SCHEMA_TEMPLATES).map(([key, tmpl]) => (
                <DropdownMenuItem
                  key={key}
                  className="text-xs gap-2"
                  onClick={() => {
                    setSchemaJson(JSON.stringify(tmpl.schema, null, 2));
                    setLastResult(null);
                    setLastError(null);
                    setDocsOutput(null);
                    toast.success(`Loaded "${tmpl.label}" template`);
                  }}
                >
                  <span>{tmpl.icon}</span> {tmpl.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                className="text-xs gap-2 border-t border-border mt-1 pt-1"
                onClick={() => setShowGuide((v) => !v)}
              >
                <span>📖</span> {showGuide ? "Hide" : "Show"} Schema Guide
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => { setSchemaJson(EXAMPLE_SCHEMA); setLastResult(null); setLastError(null); setDocsOutput(null); setDiffMode(false); }}
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
          <Button
            variant={diffMode ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={loadingDiff}
            onClick={() => {
              if (diffMode) {
                setDiffMode(false);
              } else {
                void handleLoadDiff();
              }
            }}
          >
            {loadingDiff ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCompareArrows className="h-3 w-3" />}
            {diffMode ? "Exit Diff" : "Diff vs DB"}
          </Button>
        </div>
      </div>

      {/* Schema Guide Reference */}
      {showGuide && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium flex items-center gap-1.5">
                📖 Schema Definition Guide
              </p>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => { navigator.clipboard.writeText(SCHEMA_GUIDE); toast.success("Guide copied"); }}>
                  <ClipboardCopy className="h-3 w-3" /> Copy
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => setShowGuide(false)}>
                  <X className="h-3 w-3" /> Close
                </Button>
              </div>
            </div>
            <MonacoCodeEditor language="markdown" value={SCHEMA_GUIDE} onChange={() => {}} height="280px" readOnly />
          </CardContent>
        </Card>
      )}

      {/* Editor / Diff View */}
      {diffMode && dbSchemaJson !== null ? (
        <div className="rounded-md border overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b">
            <span className="text-[10px] font-medium text-muted-foreground">← Current DB Schema</span>
            <span className="text-[10px] font-medium text-muted-foreground">Editor (Pending Changes) →</span>
          </div>
          <DiffEditor
            original={dbSchemaJson}
            modified={schemaJson}
            language="json"
            height="320px"
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
          />
        </div>
      ) : (
        <MonacoCodeEditor
          language="json"
          value={schemaJson}
          onChange={setSchemaJson}
          height="320px"
        />
      )}

      {/* Validation status + actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {validation.valid ? (
            <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30">
              <CheckCircle2 className="h-3 w-3" /> Valid · {validation.schema?.tables?.length ?? 0} table(s)
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 text-destructive border-destructive/30">
              <AlertCircle className="h-3 w-3" /> {validation.error}
            </Badge>
          )}
        </div>

        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-1.5 mr-1">
            <Switch
              checked={autoGenDocs}
              onCheckedChange={setAutoGenDocs}
              className="h-4 w-7"
            />
            <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Auto-gen docs</Label>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={generatingDocs}
            onClick={() => void handleGenerateDocs("both")}
          >
            {generatingDocs ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            Generate Docs
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={!validation.valid || migrating}
            onClick={() => void handleMigrate()}
          >
            {migrating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {migrating ? "Migrating…" : "Apply Migration"}
          </Button>
        </div>
      </div>

      {/* Migration result */}
      {lastResult && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3">
            <p className="text-xs font-medium text-primary flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Migration Successful
            </p>
            <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
              <span><strong>{lastResult.tablesCreated}</strong> table(s) created</span>
              <span><strong>{lastResult.columnsAdded}</strong> column(s) added</span>
              <span><strong>{lastResult.relationsCreated}</strong> relation(s) created</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Migration error */}
      {lastError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-3">
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" /> {lastError}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Generated docs output */}
      {docsOutput && (
        <div className="space-y-3">
          {docsOutput.markdown && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <FileText className="h-3 w-3 text-primary" /> Markdown Reference
                  </p>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => copyToClipboard(docsOutput.markdown!, "Markdown")}>
                      <ClipboardCopy className="h-3 w-3" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => downloadFile(docsOutput.markdown!, `${projectSlug}-schema.md`)}>
                      <Download className="h-3 w-3" /> Download
                    </Button>
                  </div>
                </div>
                <MonacoCodeEditor language="markdown" value={docsOutput.markdown} onChange={() => {}} height="200px" readOnly />
              </CardContent>
            </Card>
          )}

          {docsOutput.prisma && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <FileCode className="h-3 w-3 text-primary" /> Prisma-Style Schema
                  </p>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => copyToClipboard(docsOutput.prisma!, "Prisma schema")}>
                      <ClipboardCopy className="h-3 w-3" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => downloadFile(docsOutput.prisma!, `${projectSlug}-schema.prisma`)}>
                      <Download className="h-3 w-3" /> Download
                    </Button>
                  </div>
                </div>
                <MonacoCodeEditor language="javascript" value={docsOutput.prisma} onChange={() => {}} height="200px" readOnly />
              </CardContent>
            </Card>
          )}
        </div>
      )}
      <ErrorModal error={modalError} open={errorModalOpen} onOpenChange={setErrorModalOpen} />
    </div>
  );
}
