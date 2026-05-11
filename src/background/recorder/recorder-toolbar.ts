/**
 * Marco Extension — Shadow-Root Recorder Toolbar
 *
 * Self-contained floating toolbar mounted into a closed Shadow DOM so that
 * host-page CSS cannot leak in. Wraps the pure {@link recorderReducer} and
 * exposes three controls — Start, Pause/Resume, Stop — that drive the
 * RecordingPhase state machine.
 *
 * No chrome.* APIs, no React — pure DOM so it can be injected by the content
 * script during macro recording. State changes are emitted via the
 * {@link RecorderToolbarOptions.onPhaseChange} callback so the caller can
 * persist sessions, broadcast messages, or wire shortcuts on top.
 *
 * @see ./recorder-store.ts          — Pure reducer this toolbar drives.
 * @see ./recorder-session-types.ts  — RecordingPhase / RecordingSession types.
 * @see spec/26-chrome-extension-generic/06-ui-and-design-system/10-toolbar-recording-ux.md
 */

import {
    IDLE_SESSION,
    type RecorderAction,
    recorderReducer,
} from "./recorder-store";
import type { RecordingPhase, RecordingSession } from "./recorder-session-types";

/* ------------------------------------------------------------------ */
/*  Public contract                                                    */
/* ------------------------------------------------------------------ */

export const RECORDER_TOOLBAR_HOST_ID = "marco-recorder-toolbar-host";

export interface RecorderToolbarOptions {
    readonly ProjectSlug: string;
    /** Factory for SessionId — injected so tests are deterministic. */
    readonly NewSessionId: () => string;
    /** Wall-clock provider — injected so tests are deterministic. */
    readonly Now: () => string;
    /** Notified after each successful phase transition. */
    readonly OnPhaseChange?: (phase: RecordingPhase, session: RecordingSession) => void;
}

export interface RecorderToolbarHandle {
    /** The DOM host element appended to <body>. */
    readonly Host: HTMLElement;
    /** The closed Shadow Root containing the toolbar UI. */
    readonly Root: ShadowRoot;
    /** Current immutable session snapshot. */
    GetSession(): RecordingSession;
    /** Programmatic equivalents of the three buttons. */
    Start(): void;
    Pause(): void;
    Resume(): void;
    Stop(): void;
    /** Removes the toolbar from the DOM. Idempotent. */
    Destroy(): void;
}

/* ------------------------------------------------------------------ */
/*  Styling — scoped inside the shadow root                            */
/* ------------------------------------------------------------------ */

const TOOLBAR_CSS = `
:host { all: initial; }
.toolbar {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    display: inline-flex; gap: 6px; padding: 8px 10px;
    background: #111; color: #fff; border-radius: 8px;
    font: 500 12px/1 system-ui, -apple-system, sans-serif;
    box-shadow: 0 6px 20px rgba(0,0,0,.35);
}
.btn {
    appearance: none; border: 0; cursor: pointer;
    padding: 6px 10px; border-radius: 6px;
    background: #2a2a2a; color: #fff; font: inherit;
}
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn[data-action="start"]  { background: #16a34a; }
.btn[data-action="pause"]  { background: #f59e0b; color: #111; }
.btn[data-action="resume"] { background: #16a34a; }
.btn[data-action="stop"]   { background: #dc2626; }
.phase {
    align-self: center; padding: 0 8px;
    text-transform: uppercase; letter-spacing: .08em; font-size: 10px;
}
.project {
    align-self: center; display: none; align-items: center; gap: 6px;
    padding: 4px 8px; border-radius: 999px;
    background: #1f2937; color: #e5e7eb;
    font-size: 11px; max-width: 220px;
}
.project[data-active="true"] { display: inline-flex; }
.project .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #ef4444; box-shadow: 0 0 0 0 rgba(239,68,68,.7);
    animation: marco-pulse 1.4s infinite;
}
.project[data-phase="Paused"] .dot {
    background: #f59e0b; animation: none;
}
.project .label {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 180px; font-weight: 600;
}
@keyframes marco-pulse {
    0%   { box-shadow: 0 0 0 0 rgba(239,68,68,.6); }
    70%  { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
    100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
}
.health {
    align-self: center; display: inline-flex; align-items: center; gap: 8px;
    padding: 4px 8px; border-radius: 6px;
    background: #0b1220; color: #cbd5e1;
    font-size: 11px; font-variant-numeric: tabular-nums;
    border: 1px solid #1f2937;
}
.health .hdot {
    width: 6px; height: 6px; border-radius: 50%; background: #64748b;
}
.health[data-status="ok"]    .hdot { background: #22c55e; }
.health[data-status="warn"]  .hdot { background: #f59e0b; }
.health[data-status="error"] .hdot { background: #ef4444; }
.health .sep { opacity: .4; }
.health .muted { color: #94a3b8; }
`;

/* ------------------------------------------------------------------ */
/*  Mount                                                              */
/* ------------------------------------------------------------------ */

export function mountRecorderToolbar(
    options: RecorderToolbarOptions,
    container: ParentNode = (typeof document !== "undefined" ? document.body : (null as unknown as ParentNode)),
): RecorderToolbarHandle {
    if (container === null || container === undefined) {
        throw new Error("mountRecorderToolbar: no container available (document.body missing)");
    }

    let session: RecordingSession = IDLE_SESSION;

    const host = document.createElement("div");
    host.id = RECORDER_TOOLBAR_HOST_ID;
    const root = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = TOOLBAR_CSS;
    root.appendChild(style);

    const bar = document.createElement("div");
    bar.className = "toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Marco Recorder");

    const phaseLabel = document.createElement("span");
    phaseLabel.className = "phase";

    const projectChip = document.createElement("span");
    projectChip.className = "project";
    projectChip.setAttribute("aria-label", "Active recording project");
    projectChip.title = `Steps will be saved to project: ${options.ProjectSlug}`;
    const projectDot = document.createElement("span");
    projectDot.className = "dot";
    const projectText = document.createElement("span");
    projectText.className = "label";
    projectText.textContent = options.ProjectSlug;
    projectChip.append(projectDot, projectText);

    const healthChip = document.createElement("span");
    healthChip.className = "health";
    healthChip.setAttribute("aria-label", "Recorder health");
    const healthDot = document.createElement("span");
    healthDot.className = "hdot";
    const healthText = document.createElement("span");
    healthText.className = "htext";
    const healthSep = document.createElement("span");
    healthSep.className = "sep";
    healthSep.textContent = "·";
    const healthCapture = document.createElement("span");
    healthCapture.className = "muted";
    healthChip.append(healthDot, healthText, healthSep, healthCapture);

    const startBtn = makeButton("start", "Start");
    const pauseBtn = makeButton("pause", "Pause");
    const stopBtn  = makeButton("stop", "Stop");

    bar.append(phaseLabel, projectChip, healthChip, startBtn, pauseBtn, stopBtn);
    root.appendChild(bar);
    container.appendChild(host);

    function dispatch(action: RecorderAction): void {
        const next = recorderReducer(session, action);
        session = next;
        render();
        options.OnPhaseChange?.(next.Phase, next);
    }

    function start(): void {
        dispatch({
            Kind: "Start",
            ProjectSlug: options.ProjectSlug,
            SessionId: options.NewSessionId(),
            StartedAt: options.Now(),
        });
    }
    function pause(): void  { dispatch({ Kind: "Pause"  }); }
    function resume(): void { dispatch({ Kind: "Resume" }); }
    function stop(): void   { dispatch({ Kind: "Stop"   }); }

    startBtn.addEventListener("click", () => { start(); });
    stopBtn.addEventListener("click",  () => { stop();  });
    pauseBtn.addEventListener("click", () => {
        if (session.Phase === "Recording") { pause(); return; }
        if (session.Phase === "Paused")    { resume(); return; }
    });

    function render(): void {
        const phase = session.Phase;
        phaseLabel.textContent = phase;

        const isActive = phase === "Recording" || phase === "Paused";
        projectChip.dataset.active = isActive ? "true" : "false";
        projectChip.dataset.phase = phase;

        startBtn.disabled = phase !== "Idle";
        stopBtn.disabled  = phase === "Idle";

        if (phase === "Paused") {
            pauseBtn.textContent = "Resume";
            pauseBtn.dataset.action = "resume";
            pauseBtn.disabled = false;
        } else {
            pauseBtn.textContent = "Pause";
            pauseBtn.dataset.action = "pause";
            pauseBtn.disabled = phase !== "Recording";
        }
    }

    render();

    let destroyed = false;
    return {
        Host: host,
        Root: root,
        GetSession: () => session,
        Start: start,
        Pause: pause,
        Resume: resume,
        Stop: stop,
        Destroy: () => {
            if (destroyed) { return; }
            destroyed = true;
            host.remove();
        },
    };
}

function makeButton(action: "start" | "pause" | "stop", label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.dataset.action = action;
    btn.textContent = label;
    return btn;
}
