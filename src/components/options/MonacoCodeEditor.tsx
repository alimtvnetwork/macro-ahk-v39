import { useRef, useCallback, useMemo, useState, useEffect, type ChangeEvent, type DragEvent } from "react";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import { registerJsIntelliSense } from "./monaco-js-intellisense";
import { registerCustomThemes } from "@/lib/monaco-themes";
import { useEditorTheme } from "@/hooks/use-editor-theme";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
import { logError } from "./options-logger";
  AlignLeft,
  Upload,
  AlertTriangle,
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Code,
  Quote,
  Strikethrough,
  RemoveFormatting,
  Eye,
  PencilLine,
} from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: "javascript" | "json" | "markdown";
  height?: string;
  readOnly?: boolean;
}

interface ChromeWindow {
  chrome?: { runtime?: { id?: string } };
}

function isExtensionRuntime(): boolean {
  const win = globalThis as ChromeWindow;
  return typeof win.chrome?.runtime?.id === "string";
}

function readFileContent(file: File, onContent: (content: string) => void): void {
  const reader = new FileReader();
  reader.onload = (event) => {
    const result = event.target?.result;
    if (typeof result === "string") onContent(result);
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------ */
/*  JSON Syntax Highlighter                                            */
/* ------------------------------------------------------------------ */

function highlightJson(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span class="json-key">$1</span>:')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="json-string">$1</span>')
    .replace(/(?<=[[,]\s*)("(?:[^"\\]|\\.)*")/g, '<span class="json-string">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, ': <span class="json-number">$1</span>')
    .replace(/:\s*(true|false|null)\b/g, ': <span class="json-bool">$1</span>');
}

/* ------------------------------------------------------------------ */
/*  JavaScript Syntax Highlighter (Token-based)                        */
/* ------------------------------------------------------------------ */

const JS_KEYWORDS = new Set([
  "const","let","var","function","return","if","else","for","while","do",
  "switch","case","break","continue","new","this","class","extends","import",
  "export","from","default","async","await","try","catch","finally","throw",
  "typeof","instanceof","in","of","void","delete","yield","static","get","set","super",
]);

const JS_BUILTINS = new Set([
  "true","false","null","undefined","NaN","Infinity","console","window",
  "document","globalThis","Math","JSON","Promise","Array","Object","String",
  "Number","Error","Map","Set","RegExp","Date","Symbol",
]);

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
function highlightJavascript(raw: string): string {
  // Tokenize first, then wrap each token — avoids regex-inside-span corruption
  const tokens: Array<{ text: string; cls?: string }> = [];
  let i = 0;

  while (i < raw.length) {
    // Single-line comment
    if (raw[i] === "/" && raw[i + 1] === "/") {
      const end = raw.indexOf("\n", i);
      const slice = end === -1 ? raw.slice(i) : raw.slice(i, end);
      tokens.push({ text: slice, cls: "js-comment" });
      i += slice.length;
      continue;
    }

    // Multi-line comment
    if (raw[i] === "/" && raw[i + 1] === "*") {
      const end = raw.indexOf("*/", i + 2);
      const slice = end === -1 ? raw.slice(i) : raw.slice(i, end + 2);
      tokens.push({ text: slice, cls: "js-comment" });
      i += slice.length;
      continue;
    }

    // Strings (single, double, template)
    if (raw[i] === '"' || raw[i] === "'" || raw[i] === "`") {
      const q = raw[i];
      let j = i + 1;
      while (j < raw.length) {
        if (raw[j] === "\\" && q !== "`") { j += 2; continue; }
        if (raw[j] === q) { j++; break; }
        if (q !== "`" && raw[j] === "\n") break;
        j++;
      }
      tokens.push({ text: raw.slice(i, j), cls: "js-string" });
      i = j;
      continue;
    }

    // Numbers
    if (/\d/.test(raw[i]) && (i === 0 || !/[a-zA-Z_$]/.test(raw[i - 1]))) {
      let j = i;
      while (j < raw.length && /[\d.eE+\-xXa-fA-F_]/.test(raw[j])) j++;
      tokens.push({ text: raw.slice(i, j), cls: "js-number" });
      i = j;
      continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_$]/.test(raw[i])) {
      let j = i;
      while (j < raw.length && /[a-zA-Z0-9_$]/.test(raw[j])) j++;
      const word = raw.slice(i, j);
      // Peek ahead for function call
      let k = j;
      while (k < raw.length && raw[k] === " ") k++;
      const isCall = raw[k] === "(";

      let cls: string | undefined;
      if (JS_KEYWORDS.has(word)) cls = "js-keyword";
      else if (JS_BUILTINS.has(word)) cls = "js-builtin";
      else if (isCall) cls = "js-function";

      tokens.push({ text: word, cls });
      i = j;
      continue;
    }

    // Plain character (whitespace, operators, punctuation)
    tokens.push({ text: raw[i] });
    i++;
  }

  // Build HTML from tokens
  return tokens.map((t) => {
    const safe = escHtml(t.text);
    return t.cls ? `<span class="${t.cls}">${safe}</span>` : safe;
  }).join("");
}

/* ------------------------------------------------------------------ */
/*  Markdown Syntax Highlighter                                        */
/* ------------------------------------------------------------------ */

function highlightMarkdown(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .replace(/^(#{1,6}\s.*)$/gm, '<span class="md-heading">$1</span>')
    .replace(/(\*\*|__)(.*?)\1/g, '<span class="md-bold">$1$2$1</span>')
    .replace(/(\*|_)(?!\*)(.*?)\1/g, '<span class="md-italic">$1$2$1</span>')
    .replace(/(~~)(.*?)\1/g, '<span class="md-strike">$1$2$1</span>')
    .replace(/(`)(.*?)\1/g, '<span class="md-code">$1$2$1</span>')
    .replace(/^(&gt;\s.*)$/gm, '<span class="md-quote">$1</span>')
    .replace(/^(\s*[-*+]\s)/gm, '<span class="md-list">$1</span>')
    .replace(/^(\s*\d+\.\s)/gm, '<span class="md-list">$1</span>')
    .replace(/(\[.*?\]\(.*?\))/g, '<span class="md-link">$1</span>')
    .replace(/^(---+|\*\*\*+|___+)$/gm, '<span class="md-hr">$1</span>');
}

/* ------------------------------------------------------------------ */
/*  Markdown → HTML Preview Renderer                                   */
/* ------------------------------------------------------------------ */

function renderMarkdownToHtml(raw: string): string {
  let html = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre class="md-preview-codeblock"><code>${code.trim()}</code></pre>`
  );

  // Headings
  html = html.replace(/^######\s(.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s(.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s(.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s(.*)$/gm, '<h1>$1</h1>');

  // Horizontal rules
  html = html.replace(/^(---+|\*\*\*+|___+)$/gm, '<hr/>');

  // Bold, italic, strikethrough, inline code
  html = html.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
  html = html.replace(/(\*|_)(?!\*)(.*?)\1/g, '<em>$2</em>');
  html = html.replace(/(~~)(.*?)\1/g, '<del>$2</del>');
  html = html.replace(/`(.*?)`/g, '<code class="md-preview-inline-code">$1</code>');

  // Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="md-preview-link">$1</a>');

  // Blockquotes
  html = html.replace(/^&gt;\s(.*)$/gm, '<blockquote class="md-preview-blockquote">$1</blockquote>');

  // Bullet lists (simple)
  html = html.replace(/^[-*+]\s(.*)$/gm, '<li class="md-preview-li">$1</li>');
  html = html.replace(/(<li class="md-preview-li">.*<\/li>\n?)+/g, (match) =>
    `<ul class="md-preview-ul">${match}</ul>`
  );

  // Numbered lists
  html = html.replace(/^\d+\.\s(.*)$/gm, '<li class="md-preview-oli">$1</li>');
  html = html.replace(/(<li class="md-preview-oli">.*<\/li>\n?)+/g, (match) =>
    `<ol class="md-preview-ol">${match}</ol>`
  );

  // Paragraphs: wrap remaining text lines
  html = html.replace(/^(?!<[a-z/])(.*\S.*)$/gm, '<p>$1</p>');

  return html;
}

/* ------------------------------------------------------------------ */
/*  Markdown Formatting Helpers                                        */
/* ------------------------------------------------------------------ */

function wrapSelection(
  value: string,
  prefix: string,
  suffix: string,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  onChange: (v: string) => void,
): void {
  const textarea = textareaRef.current;
  if (!textarea) { onChange(prefix + value + suffix); return; }
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = value.slice(start, end);
  const newText = value.slice(0, start) + prefix + selectedText + suffix + value.slice(end);
  onChange(newText);
  requestAnimationFrame(() => {
    textarea.selectionStart = start + prefix.length;
    textarea.selectionEnd = end + prefix.length;
    textarea.focus();
  });
}

function insertLinePrefix(
  value: string,
  prefix: string,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  onChange: (v: string) => void,
): void {
  const textarea = textareaRef.current;
  if (!textarea) { onChange(prefix + value); return; }
  const start = textarea.selectionStart;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const newText = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  onChange(newText);
  requestAnimationFrame(() => {
    textarea.selectionStart = start + prefix.length;
    textarea.selectionEnd = start + prefix.length;
    textarea.focus();
  });
}

function stripBold(value: string): string {
  return value.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1");
}

function stripAllFormatting(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`(.*?)`/g, "$1");
}

function formatMarkdown(value: string): string {
  let result = value;
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
  if (!result.endsWith("\n")) result += "\n";
  return result;
}

/* ------------------------------------------------------------------ */
/*  Markdown Toolbar                                                   */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
function MarkdownToolbar({
  value, onChange, textareaRef, readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  readOnly: boolean;
}) {
  if (readOnly) return null;
  const btn = "h-6 w-6 hover:bg-primary/15 hover:text-primary";

  return (
    <>
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => wrapSelection(value, "**", "**", textareaRef, onChange)} title="Bold">
        <Bold className="h-3 w-3" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => wrapSelection(value, "*", "*", textareaRef, onChange)} title="Italic">
        <Italic className="h-3 w-3" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => wrapSelection(value, "~~", "~~", textareaRef, onChange)} title="Strikethrough">
        <Strikethrough className="h-3 w-3" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => wrapSelection(value, "`", "`", textareaRef, onChange)} title="Inline code">
        <Code className="h-3 w-3" />
      </Button>
      <Separator orientation="vertical" className="h-4 mx-0.5" />
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => insertLinePrefix(value, "# ", textareaRef, onChange)} title="Heading 1">
        <Heading1 className="h-3 w-3" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => insertLinePrefix(value, "## ", textareaRef, onChange)} title="Heading 2">
        <Heading2 className="h-3 w-3" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => insertLinePrefix(value, "- ", textareaRef, onChange)} title="Bullet list">
        <List className="h-3 w-3" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => insertLinePrefix(value, "1. ", textareaRef, onChange)} title="Numbered list">
        <ListOrdered className="h-3 w-3" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => insertLinePrefix(value, "> ", textareaRef, onChange)} title="Blockquote">
        <Quote className="h-3 w-3" />
      </Button>
      <Separator orientation="vertical" className="h-4 mx-0.5" />
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => onChange(stripBold(value))} title="Strip bold">
        <Bold className="h-3 w-3 line-through opacity-60" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className={btn}
        onClick={() => onChange(stripAllFormatting(value))} title="Strip all formatting">
        <RemoveFormatting className="h-3 w-3" />
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Markdown Preview Pane                                              */
/* ------------------------------------------------------------------ */

function MarkdownPreview({ value, height }: { value: string; height: string }) {
  const html = useMemo(() => renderMarkdownToHtml(value), [value]);

  return (
    <div
      className="md-preview-container overflow-auto p-4 bg-background text-foreground prose-sm"
      style={{ height, minHeight: "120px" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Scroll-synced Highlighted Textarea Fallback                        */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
function HighlightedFallback({
  value, onChange, language, height, readOnly, textareaRef,
}: {
  value: string;
  onChange: (v: string) => void;
  language: string;
  height: string;
  readOnly: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const preRef = useRef<HTMLPreElement>(null);

  const highlightedHtml = useMemo(() => {
    if (language === "json") return highlightJson(value);
    if (language === "javascript") return highlightJavascript(value);
    if (language === "markdown") return highlightMarkdown(value);
    return null;
  }, [value, language]);

  const showHighlight = highlightedHtml !== null;

  // Sync scroll between textarea and highlight overlay
  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const pre = preRef.current;
    if (textarea && pre) {
      pre.scrollTop = textarea.scrollTop;
      pre.scrollLeft = textarea.scrollLeft;
    }
  }, [textareaRef]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !showHighlight) return;
    textarea.addEventListener("scroll", handleScroll);
    return () => textarea.removeEventListener("scroll", handleScroll);
  }, [textareaRef, showHighlight, handleScroll]);

  return (
    <div className="relative" style={{ height, minHeight: "120px" }}>
      {showHighlight && (
        <pre
          ref={preRef}
          className="absolute inset-0 p-3 font-mono text-xs overflow-auto pointer-events-none whitespace-pre-wrap break-words m-0"
          style={{
            tabSize: 2,
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
            fontSize: '12px',
            lineHeight: '1.5',
            letterSpacing: 'normal',
            wordSpacing: 'normal',
          }}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      )}
      <textarea
        ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
        className={`w-full h-full p-3 font-mono text-xs border-0 outline-none resize-none overflow-auto ${
          showHighlight
            ? "bg-transparent text-transparent caret-foreground selection:bg-primary/20"
            : "bg-background text-foreground"
        }`}
        style={{
          tabSize: 2,
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: '12px',
          lineHeight: '1.5',
          letterSpacing: 'normal',
          wordSpacing: 'normal',
        }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        spellCheck={false}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line max-lines-per-function
export function MonacoCodeEditor({ value, onChange, language, height = "240px", readOnly = false }: Props) {
  // Gracefully coerce non-string values instead of throwing (prevents blank-page crash)
  const safeValue = typeof value === "string" ? value : String(value ?? "");
  const { editorTheme } = useEditorTheme();

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [mdMode, setMdMode] = useState<"edit" | "preview">("edit");

  const useFallback = useMemo(() => isExtensionRuntime() || editorError !== null, [editorError]);
  const isMarkdown = language === "markdown";

  const handleBeforeMount: BeforeMount = (monaco) => {
    try {
      registerCustomThemes(monaco);
      registerJsIntelliSense(monaco as Parameters<typeof registerJsIntelliSense>[0]);
    } catch (caught) {
      logError("MonacoCodeEditor.handleBeforeMount", "registerCustomThemes/registerJsIntelliSense threw — IntelliSense and custom themes will not be available in this editor instance", caught);
    }
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    setEditorError(null);
  };

  const handleFormat = useCallback(() => {
    if (language === "json") {
      try { onChange(JSON.stringify(JSON.parse(safeValue), null, 2)); return; } catch (caught) {
        logError("MonacoCodeEditor.handleFormat", "JSON.parse failed during format — user content is not valid JSON, leaving as-is", caught);
      }
    }
    if (language === "markdown") { onChange(formatMarkdown(safeValue)); return; }
    if (useFallback) return;
    editorRef.current?.getAction("editor.action.formatDocument")?.run().catch((error: unknown) => {
      setEditorError(error instanceof Error ? error.message : "Formatting failed");
    });
  }, [language, onChange, useFallback, safeValue]);

  const handleFileDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files[0];
    if (file) readFileContent(file, onChange);
  }, [onChange]);

  const handleFileSelect = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    readFileContent(file, onChange);
    event.target.value = "";
  }, [onChange]);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const fileAccept = language === "json" ? ".json"
    : language === "markdown" ? ".md,.markdown,.txt"
    : ".js,.mjs";

  const jsonValid = language === "json" ? (() => {
    try { JSON.parse(safeValue); return true; } catch { return false; }
  })() : true;

  return (
    <div
      className="border border-border rounded-md overflow-hidden"
      onDrop={handleFileDrop}
      onDragOver={handleDragOver}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mr-1">
            {language}
          </span>
          {editorError && (
            <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
              <AlertTriangle className="h-3 w-3" /> Fallback
            </span>
          )}
          {language === "json" && !jsonValid && (
            <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
              <AlertTriangle className="h-3 w-3" /> Invalid JSON
            </span>
          )}

          {/* Markdown: Edit/Preview toggle */}
          {isMarkdown && (
            <>
              <Separator orientation="vertical" className="h-4 mx-1" />
              <div className="flex items-center bg-muted rounded-md p-0.5 gap-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={mdMode === "edit" ? "secondary" : "ghost"}
                  className="h-5 px-2 text-[10px] gap-1"
                  onClick={() => setMdMode("edit")}
                >
                  <PencilLine className="h-2.5 w-2.5" /> Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mdMode === "preview" ? "secondary" : "ghost"}
                  className="h-5 px-2 text-[10px] gap-1"
                  onClick={() => setMdMode("preview")}
                >
                  <Eye className="h-2.5 w-2.5" /> Preview
                </Button>
              </div>
            </>
          )}

          {/* Markdown toolbar (only in edit mode) */}
          {isMarkdown && mdMode === "edit" && (
            <>
              <Separator orientation="vertical" className="h-4 mx-1" />
              <MarkdownToolbar
                value={safeValue}
                onChange={onChange}
                textareaRef={textareaRef}
                readOnly={readOnly}
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {(!isMarkdown || mdMode === "edit") && (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 hover:bg-primary/15 hover:text-primary"
                onClick={() => fileInputRef.current?.click()}
                title="Upload file"
              >
                <Upload className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 hover:bg-primary/15 hover:text-primary"
                onClick={handleFormat}
                title={language === "json" ? "Format JSON" : language === "markdown" ? "Format Markdown" : "Format"}
                disabled={language === "json" && !jsonValid}
              >
                <AlignLeft className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={fileAccept}
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Preview mode for markdown */}
      {isMarkdown && mdMode === "preview" ? (
        <MarkdownPreview value={safeValue} height={height} />
      ) : useFallback ? (
        <HighlightedFallback
          value={safeValue}
          onChange={onChange}
          language={language}
          height={height}
          readOnly={readOnly}
          textareaRef={textareaRef}
        />
      ) : (
        <Editor
          height={height}
          language={language}
          value={safeValue}
          onChange={(nextValue) => onChange(nextValue ?? "")}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          theme={editorTheme}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            readOnly,
            automaticLayout: true,
            folding: true,
            renderLineHighlight: "line",
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
            formatOnPaste: true,
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: false, strings: false },
            acceptSuggestionOnCommitCharacter: true,
            wordBasedSuggestions: "currentDocument",
            parameterHints: { enabled: true },
          }}
          onValidate={() => {}}
        />
      )}
    </div>
  );
}
