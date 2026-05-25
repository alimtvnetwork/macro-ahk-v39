 
/**
 * MacroLoop Controller — Task Next Automation UI
 * Step 03e: Extracted from createUI() closure
 *
 * Automated multi-task prompt injection with configurable delays and retries.
 */

import { log, logSub } from '../logging';
import type { ResolvedPromptsConfig } from '../types';
import { showPasteToast, pasteIntoEditor } from './prompt-utils';

import { cPanelBg, cPanelFg, cPrimary, cPrimaryLight } from '../shared-state';
import { logError } from '../error-utils';
import { Label } from '../types';
/** Settings shape for Task Next */
export interface TaskNextSettings {
  [key: string]: TaskNextSettingValue;
  preClickDelayMs: number;
  postClickDelayMs: number;
  retryCount: number;
  retryDelayMs: number;
  buttonXPath: string;
  promptSlug: string;
}

/** Concrete union of all setting value types — derived from TaskNextSettings */
export type TaskNextSettingValue = TaskNextSettings[keyof TaskNextSettings];

/** Mutable state for Task Next */
export const taskNextState: {
  settings: TaskNextSettings;
  running: boolean;
  cancelled: boolean;
} = {
  settings: {
    preClickDelayMs: 500,
    postClickDelayMs: 2000,
    retryCount: 3,
    retryDelayMs: 1000,
    buttonXPath: '/html/body/div[3]/div/div[2]/main/div/div/div[1]/div/div[2]/div/form/div[2]/div/button[2]',
    promptSlug: Label.NextTasks
  },
  running: false,
  cancelled: false,
};

export interface TaskNextDeps {
  sendToExtension: (type: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getPromptsConfig: () => ResolvedPromptsConfig;
  getByXPath: (xpath: string) => Element | null;
}

export function loadTaskNextSettings(deps: TaskNextDeps, cb?: () => void) {
  deps.sendToExtension('KV_GET', { key: 'task_next_settings', projectId: '_global' }).then(function(resp) {
    if (resp && resp.value) {
      try {
        const saved = JSON.parse(resp.value as string);
        for (const k of Object.keys(saved)) {
          if (Object.prototype.hasOwnProperty.call(taskNextState.settings, k)) {
            taskNextState.settings[k] = saved[k];
          }
        }
      } catch (e) { log('Task Next: failed to parse saved settings — ' + (e instanceof Error ? e.message : String(e)), 'warn'); }
    }
    if (cb) {
      cb();
    }
  });
}

export function saveTaskNextSettings(deps: TaskNextDeps) {
  deps.sendToExtension('KV_SET', { key: 'task_next_settings', value: JSON.stringify(taskNextState.settings), projectId: '_global' }).then(function() {
    log('Task Next settings saved', 'info');
  });
}

export function findNextTasksPrompt(deps: TaskNextDeps) {
  const promptsCfg = deps.getPromptsConfig();
  const entries = promptsCfg.entries || [];
  const targetSlug = taskNextState.settings.promptSlug || Label.NextTasks;

  // Diagnostic: log slug/id of every entry to confirm fields survived the pipeline
  const slugMap = entries.map(function(e) { return e.name + ' → slug=' + (e.slug || '⚠️ MISSING') + ', id=' + (e.id || '—'); });
  log('Task Next: Resolving target="' + targetSlug + '" across ' + entries.length + ' entries:\n  ' + slugMap.join('\n  '), 'info');

  // Priority 1: Exact slug field match (from info.json)
  for (const entry of entries) {
    const entrySlug = (entry.slug || '').toLowerCase();

    if (entrySlug === targetSlug) {
      log('Task Next: Found prompt by slug field: "' + entry.name + '"', 'info');

      return entry;
    }
  }

  // Priority 2: Match by id field
  for (const entry of entries) {
    const id = (entry.id || '').toLowerCase();

    if (id === targetSlug || id === 'default-' + targetSlug || id.indexOf(targetSlug) !== -1) {
      log('Task Next: Found prompt by id: "' + entry.name + '" (id=' + entry.id + ')', 'info');

      return entry;
    }
  }

  // Priority 3: Derive slug from name and match
  for (const entry of entries) {
    const derivedSlug = (entry.name || '').toLowerCase().replace(/\s+/g, '-');

    if (derivedSlug === targetSlug) {
      log('Task Next: Found prompt by derived name slug: "' + entry.name + '"', 'info');

      return entry;
    }
  }

  // Priority 4: Broader match — any prompt with 'next' and 'task' in name
  for (const entry of entries) {
    const name = (entry.name || '').toLowerCase();

    if (name.indexOf('next') !== -1 && name.indexOf('task') !== -1) {
      log('Task Next: Found prompt by name keywords: "' + entry.name + '"', 'info');

      return entry;
    }
  }

  // Last resort: DO NOT fall back to entries[0] — this caused the regression where
  // "Start Prompt" was incorrectly used as next task content.
  // Instead, return null so the caller can show a proper error message.
  log('Task Next: ❌ No prompt matched target slug "' + targetSlug + '" across ' + entries.length + ' entries. ' +
    'Ensure a prompt with slug="next-tasks" or name="Next Tasks" exists. Returning null — aborting.', 'error');
  return null;
}

/** Try to find the button via user-configured XPath. */
function findButtonByXPath(): HTMLElement | null {
  try {
    const result = document.evaluate(taskNextState.settings.buttonXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const btn = result.singleNodeValue;
    if (btn && (btn as HTMLElement).tagName && !(btn as HTMLButtonElement).disabled) return btn as HTMLElement;
  } catch (e) { log('Task Next: XPath evaluation failed — ' + (e instanceof Error ? e.message : String(e)), 'warn'); }
  return null;
}

/** Try to find the send/submit button via CSS selectors. */
function findButtonBySelectors(): HTMLElement | null {
  const sendSelectors = [
    'form button[type="submit"]',
    'form button:not([disabled]):last-of-type',
    'form button svg[data-testid="send-icon"]',
    'button[aria-label*="send" i]',
    'button[aria-label*="Send" i]',
    'button[data-testid*="send" i]',
    'form div[role="toolbar"] button:last-child',
    'form button:nth-child(2)',
  ];

  for (const selector of sendSelectors) {
    try {
      const el = document.querySelector(selector);
      if (!el) continue;

      const btn = el.tagName === 'BUTTON' ? el : el.closest('button');
      if (!btn || (btn as HTMLButtonElement).disabled) continue;

      log('Task Next: Found submit button via selector: ' + selector, 'info');
      return btn as HTMLElement;
    } catch (e) { logSub('Task Next: querySelector failed for "' + selector + '": ' + (e instanceof Error ? e.message : String(e)), 1); }
  }

  return null;
}

export function findAddToTasksButton(): HTMLElement | null {
  return findButtonByXPath() || findButtonBySelectors();
}


// ============================================
// tryClickAndAdvance — extracted from nested closure (CQ16)
// Attempts to click the "Add To Tasks" button with retries.
// ============================================

interface ClickContext {
  readonly index: number;
  readonly count: number;
  readonly doNextTask: (idx: number) => void;
  completed: number;
  retries: number;
}

function tryClickAndAdvance(ctx: ClickContext): void {
  const btn = findAddToTasksButton();

  if (!btn) {
    logError('Task Next', '"Add To Tasks" button not found — aborting');
    showPasteToast('❌ Task Next: Button not found — stopped at ' + ctx.completed + '/' + ctx.count, true);
    taskNextState.running = false;

    return;
  }

  if ((btn as HTMLButtonElement).disabled) {
    ctx.retries++;

    if (ctx.retries <= taskNextState.settings.retryCount) {
      log('Task Next: Button disabled, retry ' + ctx.retries + '/' + taskNextState.settings.retryCount, 'warn');
      setTimeout(function () { tryClickAndAdvance(ctx); }, taskNextState.settings.retryDelayMs);

      return;
    }

    log('Task Next: Button stayed disabled after ' + taskNextState.settings.retryCount + ' retries, skipping task ' + (ctx.index + 1), 'warn');
    ctx.completed++;
    showPasteToast('⏭ Task Next: ' + ctx.completed + '/' + ctx.count + ' (skipped disabled)', false);
    setTimeout(function () { ctx.doNextTask(ctx.index + 1); }, taskNextState.settings.postClickDelayMs);

    return;
  }

  btn.click();
  ctx.completed++;
  log('Task Next: Task ' + ctx.completed + '/' + ctx.count + ' queued', 'info');
  showPasteToast('⏭ Task Next: ' + ctx.completed + '/' + ctx.count + ' completed', false);

  setTimeout(function () { ctx.doNextTask(ctx.index + 1); }, taskNextState.settings.postClickDelayMs);
}

// CQ16: Extracted context for task next loop
interface TaskNextLoopCtx {
  count: number;
  completed: number;
  prompt: { text: string; name?: string };
  promptsCfg: ResolvedPromptsConfig;
  deps: TaskNextDeps;
}

// CQ16: Extracted from runTaskNextLoop closure → module scope
function doNextTask(ctx: TaskNextLoopCtx, index: number): void {
  if (taskNextState.cancelled || index >= ctx.count) {
    taskNextState.running = false;

    if (taskNextState.cancelled) {
      showPasteToast('⚠️ Task Next: Stopped at ' + ctx.completed + '/' + ctx.count, true);
      log('Task Next: Cancelled at ' + ctx.completed + '/' + ctx.count, 'warn');
    } else {
      showPasteToast('✅ Task Next: All ' + ctx.count + ' tasks queued', false);
      log('Task Next: Completed all ' + ctx.count + ' tasks', 'success');
    }

    return;
  }

  const outcome = pasteIntoEditor(ctx.prompt.text, ctx.promptsCfg, ctx.deps.getByXPath);

  if (outcome === 'failed') {
    logError('Task Next', 'Failed to inject prompt at task ' + (index + 1));
    showPasteToast('❌ Task Next: Injection failed at ' + (index + 1) + '/' + ctx.count, true);
    taskNextState.running = false;

    return;
  }

  setTimeout(function () {
    if (taskNextState.cancelled) {
      taskNextState.running = false;

      return;
    }

    const clickCtx: ClickContext = {
      index,
      count: ctx.count,
      doNextTask: (idx: number) => doNextTask(ctx, idx),
      completed: ctx.completed,
      retries: 0,
    };

    tryClickAndAdvance(clickCtx);
    ctx.completed = clickCtx.completed;
  }, taskNextState.settings.preClickDelayMs);
}

export function runTaskNextLoop(deps: TaskNextDeps, count: number) {
  if (taskNextState.running) {
    log('Task Next: Already running', 'warn');

    return;
  }

  const prompt = findNextTasksPrompt(deps);

  if (!prompt || !prompt.text) {
    logError('Task Next', '"Next Tasks" prompt not found — aborting');
    showPasteToast('❌ "Next Tasks" prompt not found', true);

    return;
  }

  taskNextState.running = true;
  taskNextState.cancelled = false;
  const promptsCfg = deps.getPromptsConfig();

  log('Task Next: Starting ' + count + ' tasks', 'info');
  showPasteToast('⏭ Task Next: Starting ' + count + ' tasks…', false);

  const ctx: TaskNextLoopCtx = {
    count,
    completed: 0,
    prompt,
    promptsCfg,
    deps,
  };

  doNextTask(ctx, 0);
}

// Escape key cancel handler — call once at init
export function setupTaskNextCancelHandler() {
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && taskNextState.running) {
      taskNextState.cancelled = true;
      log('Task Next: Cancel requested via Escape', 'info');
    }
  });
}

// eslint-disable-next-line max-lines-per-function
export function openTaskNextSettingsModal(deps: TaskNextDeps) {
  const existing = document.getElementById('marco-tasknext-settings');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'marco-tasknext-settings';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:1000010;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:' + cPanelBg + ';border:1px solid ' + cPrimary + ';border-radius:12px;width:400px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,0.8);';

  const title = document.createElement('div');
  title.textContent = '⚙ Task Next Settings';
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + cPanelFg + ';margin-bottom:16px;';
  modal.appendChild(title);

  const fields = [
    { key: 'preClickDelayMs', label: 'Pre-click delay (ms)', type: 'number' },
    { key: 'postClickDelayMs', label: 'Post-click delay (ms)', type: 'number' },
    { key: 'retryCount', label: 'Retry count', type: 'number' },
    { key: 'retryDelayMs', label: 'Retry delay (ms)', type: 'number' },
    { key: 'buttonXPath', label: 'Button XPath', type: 'text' },
    { key: 'promptSlug', label: 'Prompt slug', type: 'text' }
  ];

  const inputs: Record<string, HTMLInputElement> = {};
  for (const field of fields) {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:10px;';
    const lbl = document.createElement('label');
    lbl.textContent = field.label;
    lbl.style.cssText = 'display:block;font-size:10px;color:' + cPrimaryLight + ';margin-bottom:3px;';
    row.appendChild(lbl);
    const inp = document.createElement('input');
    inp.type = field.type;
    inp.value = String(taskNextState.settings[field.key]);
    inp.style.cssText = 'width:100%;padding:6px 8px;background:rgba(0,0,0,0.3);border:1px solid rgba(124,58,237,0.3);border-radius:6px;color:' + cPanelFg + ';font-size:11px;box-sizing:border-box;';
    row.appendChild(inp);
    modal.appendChild(row);
    inputs[field.key] = inp;
  }

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'padding:6px 16px;border:1px solid rgba(124,58,237,0.3);border-radius:6px;background:transparent;color:' + cPanelFg + ';cursor:pointer;font-size:11px;';
  cancelBtn.onclick = function() { overlay.remove(); };
  btnRow.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'padding:6px 16px;border:none;border-radius:6px;background:' + cPrimary + ';color:#fff;cursor:pointer;font-size:11px;font-weight:600;';
  saveBtn.onclick = function() {
    taskNextState.settings.preClickDelayMs = parseInt(inputs.preClickDelayMs.value) || 500;
    taskNextState.settings.postClickDelayMs = parseInt(inputs.postClickDelayMs.value) || 2000;
    taskNextState.settings.retryCount = parseInt(inputs.retryCount.value) || 3;
    taskNextState.settings.retryDelayMs = parseInt(inputs.retryDelayMs.value) || 1000;
    taskNextState.settings.buttonXPath = inputs.buttonXPath.value || taskNextState.settings.buttonXPath;
    taskNextState.settings.promptSlug = inputs.promptSlug.value || Label.NextTasks;
    saveTaskNextSettings(deps);
    overlay.remove();
    showPasteToast('✅ Task Next settings saved', false);
  };
  btnRow.appendChild(saveBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  overlay.onclick = function(e) {
    if (e.target === overlay) {
      overlay.remove();
    }
  };
  document.body.appendChild(overlay);
}
