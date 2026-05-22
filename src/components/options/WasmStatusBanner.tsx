/**
 * Marco Extension — WASM / sql.js Initialization Status Banner
 *
 * Reports whether sql.js WebAssembly initialization succeeded inside the
 * background service worker AND performs a *live* runtime CSP probe inside the
 * options page so the user can see — without opening DevTools — whether the
 * effective Content Security Policy actually allows `WebAssembly.instantiate`.
 *
 * The runtime probe instantiates a minimal valid WASM module (8 bytes: the
 * magic number + version) using `WebAssembly.instantiate()`. Two outcomes:
 *
 *  - Success → the page's effective CSP allows wasm compilation.
 *  - Failure → the thrown error message is parsed for the exact directive that
 *              blocked it (Chromium phrases this as: "Refused to compile or
 *              instantiate WebAssembly module because 'wasm-unsafe-eval' is
 *              not an allowed source of script in the following Content
 *              Security Policy directive: \"script-src 'self'\".").
 *
 * The declared manifest CSP (`chrome.runtime.getManifest().content_security_policy`)
 * is shown alongside so a mismatch (declared OK / runtime blocked, e.g. when a
 * stale build is still loaded) is immediately obvious.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStatus } from "@/hooks/use-extension-data";
import type { WasmProbeSnapshot } from "@/hooks/use-extension-data";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, ShieldAlert, FileWarning, Copy, Check, Wrench, ExternalLink, RotateCw, Terminal, FileCode } from "lucide-react";
import { logError } from "./options-logger";

/* ----------------------------------------------------------------------- */
/*  Runtime CSP probe                                                       */
/* ----------------------------------------------------------------------- */

interface CspProbeResult {
    /** True when WebAssembly.instantiate() succeeded against the live CSP. */
    isAllowed: boolean;
    /** Raw error message captured when the probe failed; null on success. */
    rawError: string | null;
    /** Parsed CSP directive that blocked the probe (e.g. "script-src 'self'"). */
    blockingDirective: string | null;
    /** Source token Chromium reported as missing (typically `'wasm-unsafe-eval'`). */
    missingSource: string | null;
    /** ISO timestamp of when the probe ran. */
    at: string;
}

/** Minimal valid WebAssembly module: \0asm + version 1. */
const WASM_PROBE_BYTES = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // "\0asm" magic
    0x01, 0x00, 0x00, 0x00, // version 1
]);

/** Regex matches Chromium's CSP-block error wording for WASM compilation. */
const CSP_DIRECTIVE_REGEX = /Content Security Policy directive:\s*"([^"]+)"/i;
const CSP_SOURCE_REGEX = /because\s+'([^']+)'\s+is not an allowed source/i;

async function runCspProbe(): Promise<CspProbeResult> {
    const at = new Date().toISOString();
    try {
        await WebAssembly.instantiate(WASM_PROBE_BYTES);
        return { isAllowed: true, rawError: null, blockingDirective: null, missingSource: null, at };
    } catch (probeError) {
        const message = probeError instanceof Error ? probeError.message : String(probeError);
        const directiveMatch = CSP_DIRECTIVE_REGEX.exec(message);
        const sourceMatch = CSP_SOURCE_REGEX.exec(message);
        return {
            isAllowed: false,
            rawError: message,
            blockingDirective: directiveMatch?.[1] ?? null,
            missingSource: sourceMatch?.[1] ?? null,
            at,
        };
    }
}

/* ----------------------------------------------------------------------- */
/*  Manifest CSP read                                                       */
/* ----------------------------------------------------------------------- */

function readDeclaredCsp(): string | null {
    try {
        const chr = (globalThis as { chrome?: { runtime?: { getManifest?: () => unknown } } }).chrome;
        const manifest = chr?.runtime?.getManifest?.();
        if (manifest === undefined || manifest === null) return null;
        const csp = (manifest as { content_security_policy?: { extension_pages?: string } }).content_security_policy;
        return csp?.extension_pages ?? null;
    } catch {
        return null;
    }
}

/* ----------------------------------------------------------------------- */
/*  Boot-side WASM init evaluation                                          */
/* ----------------------------------------------------------------------- */

type InitOutcome = "success" | "failed" | "in_progress" | "unknown";

interface InitEvaluation {
    outcome: InitOutcome;
    summary: string;
    /** Detail string suitable for a monospace block — null when no detail. */
    detail: string | null;
}

function evaluateBootInit(
    bootStep: string | undefined,
    bootError: string | null | undefined,
    wasmProbe: WasmProbeSnapshot | null | undefined,
): InitEvaluation {
    const step = bootStep ?? "unknown";
    const isFailure = step.startsWith("failed:");
    const mentionsWasm = (bootError ?? "").toLowerCase().includes("wasm")
        || (bootError ?? "").toLowerCase().includes("sql.js");

    if (isFailure && mentionsWasm) {
        const headDetail = wasmProbe !== null && wasmProbe !== undefined
            ? `HEAD probe → ${wasmProbe.url}\n  status=${wasmProbe.status ?? "n/a"} length=${wasmProbe.contentLength ?? "n/a"} ok=${wasmProbe.ok}`
            : null;
        const errorDetail = bootError ?? "(no error message captured)";
        const detail = headDetail !== null ? `${errorDetail}\n\n${headDetail}` : errorDetail;
        return { outcome: "failed", summary: `sql.js WASM initialization failed at step "${step}".`, detail };
    }

    if (isFailure) {
        return {
            outcome: "failed",
            summary: `Boot failed at step "${step}" before WASM init could be confirmed.`,
            detail: bootError ?? null,
        };
    }

    if (step === "ready") {
        return {
            outcome: "success",
            summary: "sql.js WASM module compiled and instantiated successfully.",
            detail: null,
        };
    }

    if (step === "unknown") {
        return {
            outcome: "unknown",
            summary: "Boot step not yet reported by the background service worker.",
            detail: null,
        };
    }

    return {
        outcome: "in_progress",
        summary: `Boot in progress — currently at step "${step}".`,
        detail: null,
    };
}

/* ----------------------------------------------------------------------- */
/*  Component                                                               */
/* ----------------------------------------------------------------------- */

/** Builds the multi-line clipboard report bundling all WASM/CSP diagnostics. */
// eslint-disable-next-line max-lines-per-function -- diagnostic report builder: one section per probe; splitting would scatter the report layout
function buildReport(args: {
    evalResult: InitEvaluation;
    bootStep: string | undefined;
    bootError: string | null | undefined;
    wasmProbe: WasmProbeSnapshot | null | undefined;
    cspProbe: CspProbeResult | null;
    declaredCsp: string | null;
    extensionVersion: string | undefined;
}): string {
    const { evalResult, bootStep, bootError, wasmProbe, cspProbe, declaredCsp, extensionVersion } = args;
    const lines: string[] = [];
    lines.push("═══════════════════════════════════════════");
    lines.push("  Marco · sql.js WASM / CSP Status Report");
    lines.push("═══════════════════════════════════════════");
    lines.push(`Generated:      ${new Date().toISOString()}`);
    lines.push(`Extension ver.: ${extensionVersion ?? "(unknown)"}`);
    lines.push("");
    lines.push("── Background init ────────────────────────");
    lines.push(`Outcome:        ${evalResult.outcome.toUpperCase()}`);
    lines.push(`Boot step:      ${bootStep ?? "(none)"}`);
    lines.push(`Summary:        ${evalResult.summary}`);
    lines.push(`Boot error:     ${bootError ?? "(none)"}`);
    lines.push("");
    lines.push("── WASM HEAD probe (boot snapshot) ────────");
    if (wasmProbe !== null && wasmProbe !== undefined) {
        lines.push(`URL:            ${wasmProbe.url}`);
        lines.push(`HTTP status:    ${wasmProbe.status ?? "n/a"}`);
        lines.push(`Content-Length: ${wasmProbe.contentLength ?? "n/a"}`);
        lines.push(`OK:             ${wasmProbe.ok}`);
        lines.push(`HEAD error:     ${wasmProbe.headError ?? "(none)"}`);
        lines.push(`Captured at:    ${wasmProbe.at}`);
    } else {
        lines.push("(no WASM HEAD probe captured — boot died earlier or probe disabled)");
    }
    lines.push("");
    lines.push("── Runtime CSP probe (live in options page) ──");
    if (cspProbe === null) {
        lines.push("(probe pending — has not run yet)");
    } else {
        lines.push(`Status:              ${cspProbe.isAllowed ? "ALLOWED" : "BLOCKED"}`);
        lines.push(`Probe ran at:        ${cspProbe.at}`);
        lines.push(`Blocking directive:  ${cspProbe.blockingDirective ?? "(n/a)"}`);
        lines.push(`Missing source:      ${cspProbe.missingSource ?? "(n/a)"}`);
        lines.push(`Raw error:           ${cspProbe.rawError ?? "(none)"}`);
    }
    lines.push("");
    lines.push("── Declared manifest CSP ──────────────────");
    lines.push(declaredCsp ?? "(unable to read manifest CSP)");
    lines.push("");
    lines.push("═══════════════════════════════════════════");
    return lines.join("\n");
}

const outcomeBadge: Record<InitOutcome, { label: string; classes: string }> = {
    success: { label: "OK", classes: "bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]" },
    failed: { label: "FAILED", classes: "bg-destructive text-destructive-foreground" },
    in_progress: { label: "BOOTING", classes: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]" },
    unknown: { label: "UNKNOWN", classes: "bg-muted text-muted-foreground" },
};

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity -- React component lifecycle: probes + status + handlers all need shared state closure
export function WasmStatusBanner() {
    const { status } = useStatus();
    const { toast } = useToast();
    const [cspProbe, setCspProbe] = useState<CspProbeResult | null>(null);
    const [probing, setProbing] = useState(false);
    const [copied, setCopied] = useState(false);

    const declaredCsp = useMemo(readDeclaredCsp, []);

    const refreshProbe = async (): Promise<void> => {
        setProbing(true);
        const result = await runCspProbe();
        setCspProbe(result);
        setProbing(false);
    };

    useEffect(() => { void refreshProbe(); }, []);

    const evalResult = evaluateBootInit(status?.bootStep, status?.bootError, status?.wasmProbe);
    const badge = outcomeBadge[evalResult.outcome];

    const hasMismatch = cspProbe !== null
        && !cspProbe.isAllowed
        && declaredCsp !== null
        && declaredCsp.includes("'wasm-unsafe-eval'");

    const handleCopyReport = async (): Promise<void> => {
        const report = buildReport({
            evalResult,
            bootStep: status?.bootStep,
            bootError: status?.bootError,
            wasmProbe: status?.wasmProbe,
            cspProbe,
            declaredCsp,
            extensionVersion: status?.version,
        });
        try {
            await navigator.clipboard.writeText(report);
            setCopied(true);
            toast({ title: "Report copied", description: "WASM/CSP diagnostics report copied to clipboard." });
            setTimeout(() => setCopied(false), 2000);
        } catch (clipboardError) {
            const message = clipboardError instanceof Error ? clipboardError.message : String(clipboardError);
            toast({ title: "Copy failed", description: message, variant: "destructive" });
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" />
                    sql.js WASM Initialization
                </CardTitle>
                <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => void handleCopyReport()} className="h-8">
                        {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                        {copied ? "Copied" : "Copy report"}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void refreshProbe()} disabled={probing}>
                    <RefreshCw className={`h-4 w-4 ${probing ? "animate-spin" : ""}`} />
                </Button>
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* ── Boot-side outcome ───────────────────────────────────── */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                            {evalResult.outcome === "success" ? (
                                <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                            ) : evalResult.outcome === "failed" ? (
                                <XCircle className="h-4 w-4 text-destructive" />
                            ) : (
                                <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />
                            )}
                            <span>Background init</span>
                        </div>
                        <Badge className={badge.classes}>{badge.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{evalResult.summary}</p>
                    {evalResult.detail !== null && (
                        <pre className="text-[11px] font-mono whitespace-pre-wrap break-words rounded-md bg-destructive/10 p-2 text-destructive">
                            {evalResult.detail}
                        </pre>
                    )}
                </div>

                {/* ── Runtime CSP probe ───────────────────────────────────── */}
                <div className="space-y-2 border-t border-border pt-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                            {cspProbe === null ? (
                                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                            ) : cspProbe.isAllowed ? (
                                <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                            ) : (
                                <XCircle className="h-4 w-4 text-destructive" />
                            )}
                            <span>Runtime CSP probe</span>
                        </div>
                        <Badge
                            className={
                                cspProbe === null
                                    ? "bg-muted text-muted-foreground"
                                    : cspProbe.isAllowed
                                    ? "bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]"
                                    : "bg-destructive text-destructive-foreground"
                            }
                        >
                            {cspProbe === null ? "PENDING" : cspProbe.isAllowed ? "ALLOWED" : "BLOCKED"}
                        </Badge>
                    </div>

                    {cspProbe !== null && cspProbe.isAllowed && (
                        <p className="text-xs text-muted-foreground">
                            <code className="font-mono">WebAssembly.instantiate()</code> succeeded against the
                            effective Content Security Policy.
                        </p>
                    )}

                    {cspProbe !== null && !cspProbe.isAllowed && (
                        <div className="space-y-2 rounded-md bg-destructive/10 p-2">
                            <p className="text-xs text-destructive">
                                Live CSP rejected <code className="font-mono">WebAssembly.instantiate()</code>.
                            </p>
                            <dl className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1 text-[11px] font-mono">
                                <dt className="text-muted-foreground">Blocking directive</dt>
                                <dd className="text-destructive break-all">
                                    {cspProbe.blockingDirective ?? "(unparsed)"}
                                </dd>
                                <dt className="text-muted-foreground">Missing source</dt>
                                <dd className="text-destructive break-all">
                                    {cspProbe.missingSource ?? "(unparsed — likely 'wasm-unsafe-eval')"}
                                </dd>
                            </dl>
                            {cspProbe.rawError !== null && (
                                <details className="text-[11px]">
                                    <summary className="cursor-pointer text-muted-foreground">Raw error</summary>
                                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-destructive">
                                        {cspProbe.rawError}
                                    </pre>
                                </details>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Declared vs effective ───────────────────────────────── */}
                <div className="space-y-2 border-t border-border pt-3">
                    <div className="flex items-center gap-2 text-sm">
                        <FileWarning className="h-4 w-4 text-muted-foreground" />
                        <span>Declared manifest CSP</span>
                    </div>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2">
                        {declaredCsp ?? "(unable to read manifest CSP)"}
                    </pre>
                </div>

                {/* ── Fix-it checklist ────────────────────────────────────── */}
                <FixItChecklist
                    cspProbe={cspProbe}
                    declaredCsp={declaredCsp}
                    hasMismatch={hasMismatch}
                    bootError={status?.bootError ?? null}
                    onRestartOptions={() => window.location.reload()}
                />
            </CardContent>
        </Card>
    );
}

/* ----------------------------------------------------------------------- */
/*  Fix-it checklist                                                        */
/* ----------------------------------------------------------------------- */

type FixScenario =
    | "all_clear"
    | "manifest_missing_directive"
    | "stale_build_reload_needed"
    | "csp_blocked_unknown_cause"
    | "boot_failed_non_csp"
    | "build_tooling_pnpm_dlx_less";

interface FixStep {
    title: string;
    body: string;
    /** Optional one-click action button(s). Multiple actions render side-by-side. */
    actions?: Array<{ label: string; icon: typeof RotateCw; onClick: () => void }>;
    /**
     * Optional list of repo files/scripts the user should edit to resolve the
     * step. Rendered as a copy-able monospace bullet list.
     */
    files?: string[];
}

interface FixItChecklistProps {
    cspProbe: CspProbeResult | null;
    declaredCsp: string | null;
    hasMismatch: boolean;
    bootError: string | null;
    onRestartOptions: () => void;
}

/** Pattern matches the `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER` family
 *  of failures that surface when scripts shell out to the forbidden invocation
 *  family in CI. We classify on the boot/error string so a developer staring
 *  at the options page after a failed deploy gets the exact remediation
 *  playbook for THIS specific failure mode. */
const PNPM_DLX_LESS_REGEX = /(ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER|pnpm\s+dlx[^\n]*--package[^\n]*less|npx[^\n]*--package[^\n]*less)/i; // preflight-allow-line

function classifyFixScenario(
    cspProbe: CspProbeResult | null,
    declaredCsp: string | null,
    hasMismatch: boolean,
    bootError: string | null,
): FixScenario {
    const isCspProbeBlocked = cspProbe !== null && !cspProbe.isAllowed;
    const declaresWasmEval = declaredCsp !== null && declaredCsp.includes("'wasm-unsafe-eval'");
    const bootMentionsCsp = (bootError ?? "").toLowerCase().includes("wasm-unsafe-eval")
        || (bootError ?? "").toLowerCase().includes("content security policy");
    const bootMentionsPnpmDlxLess = bootError !== null && PNPM_DLX_LESS_REGEX.test(bootError);

    if (bootMentionsPnpmDlxLess) return "build_tooling_pnpm_dlx_less";
    if (isCspProbeBlocked && !declaresWasmEval) return "manifest_missing_directive";
    if (hasMismatch) return "stale_build_reload_needed";
    if (isCspProbeBlocked) return "csp_blocked_unknown_cause";
    if (bootMentionsCsp) return "stale_build_reload_needed";
    if (bootError !== null && bootError !== "") return "boot_failed_non_csp";
    return "all_clear";
}

const COPY_BLOCK_TO_CLIPBOARD = (text: string): void => {
    void navigator.clipboard.writeText(text);
};

const MANIFEST_FIX_SNIPPET = `"content_security_policy": {\n  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"\n}`;

/** The exact files known to historically shell out to the broken
 *  `pnpm dlx --package=less` / `npx --package less` invocations. Surfaced  // preflight-allow-line
 *  verbatim so a developer can jump straight to the offenders without
 *  grepping. Keep alphabetized for stable diffs. */
const PNPM_DLX_LESS_OFFENDER_FILES = [
    "scripts/build-standalone.mjs",
    "scripts/check-no-pnpm-dlx-less.mjs",
    "scripts/compile-less.mjs",
    "scripts/ps-modules/standalone-build.ps1",
];

const PREFLIGHT_COMMAND = "node scripts/check-no-pnpm-dlx-less.mjs";
const COMPILE_LESS_REPLACEMENT = "node scripts/compile-less.mjs <input.less> <output.css>";
const PREFLIGHT_DOCS_URL = "https://github.com/search?q=repo%3A%2F+path%3Ascripts%2Fcheck-no-pnpm-dlx-less.mjs&type=code";

// eslint-disable-next-line max-lines-per-function -- fix-step catalog: one branch per scenario, each with its own action list; splitting would scatter the recovery contract
function buildFixSteps(scenario: FixScenario, onRestartOptions: () => void): FixStep[] {
    const openExtensionsAction: NonNullable<FixStep["actions"]>[number] = {
        label: "Open chrome://extensions",
        icon: ExternalLink,
        onClick: () => {
            try {
                const chr = (globalThis as { chrome?: { tabs?: { create?: (props: { url: string }) => void } } }).chrome;
                chr?.tabs?.create?.({ url: "chrome://extensions" });
            } catch (caught) {
                logError("WasmStatusBanner.openExtensionsAction", "chrome.tabs.create({url:'chrome://extensions'}) threw — expected when running in web preview (chrome:// URLs cannot be opened)", caught);
            }
        },
    };
    const restartOptionsAction: NonNullable<FixStep["actions"]>[number] = {
        label: "Reload options page",
        icon: RotateCw,
        onClick: onRestartOptions,
    };
    const copyManifestAction: NonNullable<FixStep["actions"]>[number] = {
        label: "Copy CSP snippet",
        icon: Copy,
        onClick: () => COPY_BLOCK_TO_CLIPBOARD(MANIFEST_FIX_SNIPPET),
    };

    if (scenario === "manifest_missing_directive") {
        return [
            {
                title: "Add 'wasm-unsafe-eval' to manifest.json",
                body: "Your manifest's extension_pages CSP omits 'wasm-unsafe-eval'. MV3 forbids WebAssembly.instantiate() under the default script-src 'self' — sql.js cannot boot until the directive is granted.",
                actions: [copyManifestAction],
            },
            {
                title: "Rebuild the extension",
                body: "Run pnpm run build (or your equivalent) so chrome-extension/manifest.json picks up the change. Verify with pnpm run check:built-csp.",
            },
            {
                title: "Reload the unpacked extension",
                body: "Open chrome://extensions, find Marco, and click the circular reload icon. Manifest changes are NOT hot-reloaded.",
                actions: [openExtensionsAction],
            },
            {
                title: "Restart this options page",
                body: "Close and reopen the options tab (or click below) so the page evaluates against the new CSP, then re-run the runtime probe.",
                actions: [restartOptionsAction],
            },
        ];
    }

    if (scenario === "stale_build_reload_needed") {
        return [
            {
                title: "Reload the extension",
                body: "Manifest declares 'wasm-unsafe-eval' but the runtime probe is still blocked — Chrome is serving a cached pre-fix build. Open chrome://extensions and click Reload on Marco.",
                actions: [openExtensionsAction],
            },
            {
                title: "Verify the built manifest",
                body: "Confirm chrome-extension/manifest.json on disk contains 'wasm-unsafe-eval' (the source manifest may be ahead of the built artifact). Run pnpm run check:built-csp.",
            },
            {
                title: "Restart this options page",
                body: "After reloading the extension, fully close and reopen this options tab so a fresh document is loaded under the new CSP.",
                actions: [restartOptionsAction],
            },
        ];
    }

    if (scenario === "csp_blocked_unknown_cause") {
        return [
            {
                title: "Inspect the raw CSP error",
                body: "Expand the 'Raw error' detail in the runtime probe section above — Chromium reports the exact directive and the blocked source token.",
            },
            {
                title: "Check for an enterprise CSP override",
                body: "Managed Chrome policies can append directives that override the manifest. Visit chrome://policy and search for ExtensionSettings or runtime_blocked_hosts.",
                actions: [openExtensionsAction],
            },
            {
                title: "Reload extension and options page",
                body: "Reload the extension on chrome://extensions, then reload this page so the probe re-runs from a clean document.",
                actions: [restartOptionsAction],
            },
        ];
    }

    if (scenario === "boot_failed_non_csp") {
        return [
            {
                title: "Boot failed but CSP is OK",
                body: "The runtime CSP probe succeeded, so 'wasm-unsafe-eval' is not your problem. Inspect the boot error message above — likely causes: WASM checksum mismatch, OOM, or sql.js shim version skew.",
            },
            {
                title: "Reload the extension",
                body: "A clean SW restart often clears transient WASM instantiation failures.",
                actions: [openExtensionsAction],
            },
            {
                title: "Restart this options page",
                body: "Reload to fetch a fresh boot snapshot from the background service worker.",
                actions: [restartOptionsAction],
            },
        ];
    }

    if (scenario === "build_tooling_pnpm_dlx_less") {
        // pnpm rejects npx-style `--package=less` specs; the local helper  // preflight-allow-line
        // `scripts/compile-less.mjs` imports `less` directly and is the
        // canonical replacement enforced by `scripts/check-no-pnpm-dlx-less.mjs`.
        return [
            {
                title: "Run the preflight checker locally",
                body: "Reproduces the exact CI failure offline and prints every offending file:line so you can edit them before the next push. Exits 0 on a clean repo.",
                actions: [
                    {
                        label: "Copy preflight command",
                        icon: Terminal,
                        onClick: () => COPY_BLOCK_TO_CLIPBOARD(PREFLIGHT_COMMAND),
                    },
                    {
                        label: "Open checker source",
                        icon: ExternalLink,
                        onClick: () => {
                            try {
                                const chr = (globalThis as { chrome?: { tabs?: { create?: (props: { url: string }) => void } } }).chrome;
                                chr?.tabs?.create?.({ url: PREFLIGHT_DOCS_URL });
                            } catch (caught) {
                                logError("WasmStatusBanner.openCheckerSource", `chrome.tabs.create({url:"${PREFLIGHT_DOCS_URL}"}) threw — expected when running outside extension context`, caught);
                            }
                        },
                    },
                ],
            },
            {
                title: "Edit these files to remove the broken invocation",
                body: "Each of these scripts has historically shelled out to `pnpm dlx --package=less` or `npx --package less lessc`. Replace any such call with the local Node helper below — no CLI dlx round-trip, no resolver crash.", // preflight-allow-line
                files: PNPM_DLX_LESS_OFFENDER_FILES,
                actions: [
                    {
                        label: "Copy replacement command",
                        icon: Copy,
                        onClick: () => COPY_BLOCK_TO_CLIPBOARD(COMPILE_LESS_REPLACEMENT),
                    },
                ],
            },
            {
                title: "Re-run the preflight, then rebuild",
                body: "After your edits, run the preflight again until it reports OK, then rebuild. CI will reproduce ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER until every offender is gone.",
                actions: [
                    {
                        label: "Copy preflight command",
                        icon: Terminal,
                        onClick: () => COPY_BLOCK_TO_CLIPBOARD(PREFLIGHT_COMMAND),
                    },
                ],
            },
        ];
    }

    return [];
}

// eslint-disable-next-line max-lines-per-function
function FixItChecklist({ cspProbe, declaredCsp, hasMismatch, bootError, onRestartOptions }: FixItChecklistProps) {
    const scenario = classifyFixScenario(cspProbe, declaredCsp, hasMismatch, bootError);

    if (scenario === "all_clear") {
        return null;
    }

    const steps = buildFixSteps(scenario, onRestartOptions);

    const headerText: Record<Exclude<FixScenario, "all_clear">, string> = {
        manifest_missing_directive: "Manifest is missing 'wasm-unsafe-eval' — fix in 4 steps",
        stale_build_reload_needed: "Stale build detected — reload to apply fix",
        csp_blocked_unknown_cause: "CSP is blocking WebAssembly — diagnose & recover",
        boot_failed_non_csp: "Boot failed (CSP is fine) — recovery steps",
        build_tooling_pnpm_dlx_less: "Build tooling: `pnpm dlx --package=less` is forbidden — fix it", // preflight-allow-line
    };

    return (
        <div className="space-y-3 rounded-md border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--warning))]">
                <Wrench className="h-4 w-4" />
                <span>Fix it · {headerText[scenario]}</span>
            </div>
            <ol className="space-y-2.5">
                {steps.map((step, index) => (
                    <li key={index} className="flex gap-2.5 text-xs">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--warning))] text-[10px] font-bold text-[hsl(var(--warning-foreground))]">
                            {index + 1}
                        </span>
                        <div className="flex-1 space-y-1">
                            <p className="font-medium text-foreground">{step.title}</p>
                            <p className="text-muted-foreground leading-relaxed">{step.body}</p>
                            {step.files !== undefined && step.files.length > 0 && (
                                <ul className="mt-1 space-y-0.5 rounded-md bg-muted/40 p-2">
                                    {step.files.map((file) => (
                                        <li key={file} className="flex items-center justify-between gap-2 font-mono text-[11px]">
                                            <span className="flex items-center gap-1.5 text-foreground">
                                                <FileCode className="h-3 w-3 text-muted-foreground shrink-0" />
                                                <span className="break-all">{file}</span>
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 px-1.5 text-[10px]"
                                                onClick={() => COPY_BLOCK_TO_CLIPBOARD(file)}
                                                aria-label={`Copy path ${file}`}
                                            >
                                                <Copy className="h-2.5 w-2.5" />
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {step.actions !== undefined && step.actions.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                    {step.actions.map((action, actionIndex) => (
                                        <Button
                                            key={actionIndex}
                                            variant="outline"
                                            size="sm"
                                            className="h-7"
                                            onClick={action.onClick}
                                        >
                                            <action.icon className="h-3 w-3 mr-1.5" />
                                            {action.label}
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </li>
                ))}
            </ol>
        </div>
    );
}
