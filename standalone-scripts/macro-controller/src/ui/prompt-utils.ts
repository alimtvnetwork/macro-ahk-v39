 
import { toErrorMessage, logError } from '../error-utils';
/**
 * MacroLoop Controller — Prompt Utility Functions
 * Step 03d: Extracted from createUI() closure
 *
 * Pure/near-pure functions for prompt loading, parsing, pasting.
 */

import { log, logSub } from '../logging';
import type { PromptEntry, PromptsCfg } from '../types';
import { showToast } from '../toast';

// ── Prompt entry normalization ──
// eslint-disable-next-line sonarjs/cognitive-complexity -- field-by-field validation with optional property copying
export function normalizePromptEntries(entries: Partial<PromptEntry & { order?: number }>[]): PromptEntry[] {
  if (!Array.isArray(entries)) return [];
  const out: PromptEntry[] = [];
  let droppedCount = 0;
  for (const p of entries) {
    const raw = p || {};
    const name = typeof raw.name === 'string' ? raw.name : '';
    const text = typeof raw.text === 'string' ? raw.text : '';

    if (name && text) {
      const entry: PromptEntry = { name, text };

      if (raw.id) { entry.id = raw.id; }
      if (raw.slug) { entry.slug = raw.slug; }
      if (raw.category) { entry.category = raw.category; }
      if (raw.isFavorite) { entry.isFavorite = true; }
      if (raw.isDefault !== undefined) { entry.isDefault = raw.isDefault; }

      out.push(entry);
    } else {
      droppedCount++;
      console.warn('[normalizePromptEntries] ⚠️ Dropped entry — name="' + (name || '(empty)') + '", text.length=' + text.length + ', id=' + (raw.id || '—') + ', slug=' + (raw.slug || '—') + '. Reason: ' + (!name ? 'missing name' : 'missing text'));
    }
  }
  if (droppedCount > 0) {
    console.warn('[normalizePromptEntries] ⚠️ Dropped ' + droppedCount + '/' + entries.length + ' entries due to missing name or text');
  }
  return out;
}

/** Normalize excessive blank lines: collapse 3+ consecutive newlines to 2 (one blank line).
 *  Also normalizes \r\n to \n and collapses lines containing only whitespace. */
export function normalizeNewlines(text: string): string {
  return text
    .replace(/\r\n/g, '\n')                    // Normalize Windows line endings
    .replace(/\n[ \t]*\n[ \t]*\n/g, '\n\n')     // Collapse blank-ish lines (whitespace-only between newlines)
    .replace(/\n{3,}/g, '\n\n')                  // Collapse 3+ consecutive newlines to 2
    .trim();
}

// ── JSON parse with truncation recovery ──
export function parseWithRecovery(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (e) {
    logError('parseWithRecovery', 'JSON parse failed, attempting recovery', e);
    const trimmed = String(content || '').trim();
    const lastBrace = trimmed.lastIndexOf('}');
    if (lastBrace > 0) {
      let repaired = trimmed.substring(0, lastBrace + 1);
      if (trimmed.charAt(0) === '[') {
        repaired += ']';
      }
      try {
        return JSON.parse(repaired);
      } catch (_repairErr) { logSub('JSON repair also failed: ' + (_repairErr instanceof Error ? _repairErr.message : String(_repairErr)), 1); }
    }
    throw e;
  }
}

// ── Toast notification system (solid dark minimal, left accent bar, stacking max 3) ──

import { TOAST_MAX_STACK } from '../constants';
import { DomId } from '../types';
function _getOrCreateToastContainer(): HTMLElement {
  let container = document.getElementById(DomId.ToastStack);
  if (!container) {
    container = document.createElement('div');
    container.id = DomId.ToastStack;
    container.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'display:flex;flex-direction:column-reverse;gap:6px;z-index:1000000;pointer-events:none;';
    document.body.appendChild(container);
  }
  return container;
}

export function showPasteToast(message: string, isError: boolean): void {
  const container = _getOrCreateToastContainer();

  // Enforce max stack — remove oldest if at limit
  while (container.children.length >= TOAST_MAX_STACK) {
    const oldest = container.lastElementChild;
    if (oldest) oldest.remove();
  }

  const toast = document.createElement('div');
  toast.style.cssText = 'display:flex;align-items:stretch;border-radius:6px;overflow:hidden;' +
    'background:#1a1a2e;border:1px solid rgba(255,255,255,0.06);' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.4);' +
    'font-family:system-ui,-apple-system,sans-serif;pointer-events:auto;' +
    'transform:translateY(8px);opacity:0;transition:all .25s ease-out;max-width:380px;';

  // Left accent bar
  const accent = document.createElement('div');
  accent.style.cssText = 'width:3px;flex-shrink:0;' +
    (isError ? 'background:#ef4444;' : 'background:#22c55e;');
  toast.appendChild(accent);

  // Content area
  const content = document.createElement('div');
  content.style.cssText = 'padding:8px 14px;font-size:12px;line-height:1.4;color:#e2e8f0;' +
    'display:flex;align-items:center;gap:6px;';

  // Icon
  const icon = document.createElement('span');
  icon.style.cssText = 'font-size:13px;flex-shrink:0;';
  icon.textContent = isError ? '✕' : '✓';
  content.appendChild(icon);

  // Text
  const text = document.createElement('span');
  text.textContent = message;
  text.style.cssText = 'flex:1;';
  content.appendChild(text);

  toast.appendChild(content);
  container.insertBefore(toast, container.firstChild);

  // Animate in
  requestAnimationFrame(function() {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Auto-dismiss
  const duration = isError ? 4500 : 2800;
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(function() { toast.remove(); }, 250);
  }, duration);
}

// ── Find editor paste target via XPath/CSS selectors ──
export function findPasteTarget(promptsCfg: PromptsCfg, getByXPath: (xpath: string) => Element | null): Element | null {
  let el: Element | null = null;
  if (promptsCfg.pasteTargetXPath) {
    el = getByXPath(promptsCfg.pasteTargetXPath);
    if (el) return el;
  }
  if (promptsCfg.pasteTargetSelector) {
    el = document.querySelector(promptsCfg.pasteTargetSelector);
    if (el) return el;
  }
  const selectors = [
    'form textarea[placeholder]',
    'div[contenteditable="true"]',
    'textarea.ProseMirror',
    '[data-testid="prompt-input"]'
  ];
  for (const sel of selectors) {
    el = document.querySelector(sel);

    if (el) { return el; }
  }
  return null;
}

// ── Paste/append text into editor element ──
/** Paste into a textarea or input element using native setter. */
function pasteIntoTextarea(target: HTMLElement, text: string): void {
  const currentVal = (target as HTMLInputElement).value || '';
  const newVal = currentVal + (currentVal.length > 0 ? '\n' : '') + text;
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ||
                     Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  if (nativeSetter?.set) {
    nativeSetter.set.call(target, newVal);
  } else {
    (target as HTMLInputElement).value = newVal;
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Paste into a contenteditable element using execCommand or DataTransfer fallback. */
function pasteIntoContentEditable(target: HTMLElement, text: string): boolean {
  // Move cursor to end
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  const existingText = (target.textContent || '').trim();
  const prefix = existingText.length > 0 ? '\n' : '';
  const fullText = prefix + text;

  const execResult = document.execCommand('insertText', false, fullText);
  if (execResult) {
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: fullText }));
    return true;
  }

  // Fallback: DataTransfer paste
  log('Prompt inject: execCommand failed, trying DataTransfer paste', 'warn');
  const dt = new DataTransfer();
  dt.setData('text/plain', fullText);
  const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  const pasteHandled = target.dispatchEvent(pasteEvent);

  if (pasteHandled) {
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: fullText }));
    return true;
  }

  // Last resort: clipboard
  log('Prompt inject: DataTransfer paste also failed, using clipboard API', 'warn');
  navigator.clipboard.writeText(text).then(function() {
    showPasteToast('📋 Copied to clipboard — paste with Ctrl+V', false);
  });
  return false;
}

export type PasteOutcome = 'injected' | 'clipboard' | 'failed';

export function pasteIntoEditor(rawText: string, promptsCfg: PromptsCfg, getByXPath: (xpath: string) => Element | null): PasteOutcome {
  const text = normalizeNewlines(rawText);
  const target = findPasteTarget(promptsCfg, getByXPath) as HTMLElement | null;
  if (!target) {
    log('Prompt paste: No editor target found — copying to clipboard instead', 'warn');
    navigator.clipboard.writeText(text).then(function() {
      log('Prompt copied to clipboard (no paste target)', 'success');
      showPasteToast('📋 Copied to clipboard — paste manually with Ctrl+V', false);
    }).catch(function() {
      showPasteToast('❌ Could not paste or copy — editor target not found', true);
    });
    return 'clipboard';
  }

  log('Prompt inject: target found (' + target.tagName + ', contentEditable=' + target.contentEditable + '), text length=' + text.length, 'info');

  try {
    target.focus();
    const isTextInput = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT';

    if (isTextInput) {
      pasteIntoTextarea(target, text);
    } else {
      const ok = pasteIntoContentEditable(target, text);
      if (!ok) return 'failed';
    }

    log('Prompt injected: "' + text.substring(0, 80) + '..." (' + text.length + ' total chars)', 'success');
    showPasteToast('✓ Prompt injected (' + text.length + ' chars)', false);
    return 'injected';
  } catch (e: unknown) {
    const errMsg = toErrorMessage(e);
    logError('Prompt inject failed', '' + errMsg);
    navigator.clipboard.writeText(text).then(function() {
      showPasteToast('⚠️ Inject failed — copied to clipboard, try Ctrl+V', true);
    }).catch(function(e: unknown) {
      logError('copyPrompt', 'Prompt copy to clipboard failed', e);
      showToast('❌ Prompt copy to clipboard failed', 'error');
      showPasteToast('❌ Inject and clipboard both failed', true);
    });
    return 'failed';
  }
}
