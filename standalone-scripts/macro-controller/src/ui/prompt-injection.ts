/**
 * Prompt Injection — Prompt creation/edit modal, paste-into-editor logic
 *
 * Phase 5D split from ui/prompt-manager.ts.
 * See: spec/04-macro-controller/ts-migration-v2/05-module-splitting.md
 */
import { CssFragment } from '../types';
import { log } from '../logging';
import { logError } from '../error-utils';
import { cPanelBg, cPanelBgAlt, cPanelFg, cPanelFgDim, cPrimary, cPrimaryLight, cPrimaryBorderA } from '../shared-state';
import { getByXPath } from '../xpath-utils';
import { pasteIntoEditor, showPasteToast } from './prompt-utils';
import type { TaskNextDeps } from './task-next-ui';
import type { EditablePrompt, PromptContext } from './prompt-loader';
import { getPromptsConfig, sendToExtension, clearLoadedPrompts, invalidatePromptCache, loadPromptsFromJson, rerenderPromptsDropdown } from './prompt-loader';

/** Adapter: getByXPath returns Node|null, pasteIntoEditor needs Element|null */
function getByXPathAsElement(xpath: string): Element | null {
  const node = getByXPath(xpath);
  return node instanceof Element ? node : null;
}

// CQ16: Extracted from openPromptCreationModal closure
function getSelectedCategory(catSelect: HTMLSelectElement, catCustomInput: HTMLInputElement): string {
  if (catSelect.value === '__custom__') return catCustomInput.value.trim();
  return catSelect.value;
}

// CQ16: Extracted file handler context
interface FileHandlerRefs {
  contentArea: HTMLTextAreaElement;
  charCount: HTMLElement;
  titleInput: HTMLInputElement;
  dropZone: HTMLElement;
}

// CQ16: Extracted from openPromptCreationModal closure
function handleFile(file: File, refs: FileHandlerRefs): void {
  if (!file) return;
  const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
  if (!['md', 'txt', 'prompt'].includes(ext)) { showPasteToast('❌ Unsupported file type: .' + ext, true); return; }
  if (file.size > 50 * 1024) { showPasteToast('❌ File too large (max 50KB)', true); return; }
  const reader = new FileReader();
  reader.onload = function(e: ProgressEvent<FileReader>) {
    const content = e.target?.result as string;
    refs.contentArea.value = content;
    refs.charCount.textContent = content.length + ' chars';
    if (!refs.titleInput.value.trim()) {
      refs.titleInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    }
    refs.dropZone.style.borderColor = '#16a34a';
    refs.dropZone.innerHTML = '✅ Loaded: <b>' + file.name + '</b> (' + content.length + ' chars)';
    setTimeout(function() { refs.dropZone.style.borderColor = CssFragment.BorderPrimary; }, 2000);
    log('File loaded into prompt editor: ' + file.name, 'success');
  };
  reader.readAsText(file);
}

// CQ16: Extracted from openPromptCreationModal closure
function onEscHandler(overlay: HTMLElement): (e: KeyboardEvent) => void {
  const handler = function(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handler);
    }
  };
  return handler;
}

/**
 * Open the prompt creation/edit modal.
 * @param editPrompt — existing prompt object for editing (has .id)
 * @param prefillData — pre-fill data for new prompt (no .id, not edit mode)
 */
export function openPromptCreationModal(_ctx: PromptContext, _taskNextDeps: TaskNextDeps, editPrompt: EditablePrompt | null, prefillData?: { name?: string; text?: string; category?: string }): void {
  const existing = document.getElementById('marco-prompt-modal');
  if (existing) existing.remove();

  const isEdit = !!(editPrompt && editPrompt.id);
  const initialData = isEdit ? editPrompt : (prefillData || {});
  const overlay = document.createElement('div');
  overlay.id = 'marco-prompt-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:1000010;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:' + cPanelBg + CssFragment.BorderSolid + cPrimary + ';border-radius:12px;width:520px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.8);';

  // Header
  const headerEl = document.createElement('div');
  headerEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(124,58,237,0.3);';
  const titleEl = document.createElement('span');
  titleEl.textContent = isEdit ? '✏️ Edit Prompt' : '➕ Add New Prompt';
  titleEl.style.cssText = 'font-size:15px;font-weight:600;color:' + cPanelFg + ';';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;padding:0 4px;';
  closeBtn.onclick = function() { overlay.remove(); };
  headerEl.appendChild(titleEl);
  headerEl.appendChild(closeBtn);
  modal.appendChild(headerEl);

  // Body
  const bodyResult = _buildPromptModalBody(initialData);
  modal.appendChild(bodyResult.body);

  // Footer
  const footer = _buildPromptModalFooter(isEdit, editPrompt, overlay, bodyResult);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = function(e: Event) { if (e.target === overlay) overlay.remove(); };
  document.addEventListener('keydown', onEscHandler(overlay));
  bodyResult.titleInput.focus();
}

// ── Prompt Modal Body ──
interface PromptBodyResult {
  body: HTMLElement;
  titleInput: HTMLInputElement;
  contentArea: HTMLTextAreaElement;
  catSelect: HTMLSelectElement;
  catCustomInput: HTMLInputElement;
}

function _buildPromptModalBody(initialData: Record<string, unknown>): PromptBodyResult {
  const body = document.createElement('div');
  body.style.cssText = 'padding:16px 20px;overflow-y:auto;flex:1;';

  const { titleInput, contentArea, charCount } = _buildTitleAndContent(body, initialData);

  const catResult = _buildCategorySelect(initialData);
  body.appendChild(catResult.catWrap);

  _buildFileDropZone(body, contentArea, charCount, titleInput);
  _buildVariableReference(body);

  return { body, titleInput, contentArea, catSelect: catResult.catSelect, catCustomInput: catResult.catCustomInput };
}

function _buildTitleAndContent(body: HTMLElement, initialData: Record<string, unknown>): { titleInput: HTMLInputElement; contentArea: HTMLTextAreaElement; charCount: HTMLElement } {
  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Prompt Title';
  titleLabel.style.cssText = CssFragment.LabelBlock + cPrimaryLight + CssFragment.LabelSuffix;
  body.appendChild(titleLabel);
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'e.g. Code Review Prompt';
  titleInput.value = (initialData.name as string) || '';
  titleInput.style.cssText = 'width:100%;padding:8px 12px;background:' + cPanelBg + CssFragment.BorderSolid + cPrimaryBorderA + CssFragment.BorderRadiusColor + cPanelFg + ';font-size:13px;margin-bottom:12px;outline:none;box-sizing:border-box;';
  titleInput.onfocus = function() { (this as HTMLElement).style.borderColor = cPrimary; };
  titleInput.onblur = function() { (this as HTMLElement).style.borderColor = CssFragment.BorderPrimaryStrong; };
  body.appendChild(titleInput);

  const contentLabel = document.createElement('label');
  contentLabel.textContent = 'Prompt Content (Markdown supported)';
  contentLabel.style.cssText = CssFragment.LabelBlock + cPrimaryLight + CssFragment.LabelSuffix;
  body.appendChild(contentLabel);
  const contentArea = document.createElement('textarea');
  contentArea.placeholder = 'Enter your prompt text here…\n\nSupports {{date}}, {{time}} variables.';
  contentArea.value = (initialData.text as string) || '';
  contentArea.style.cssText = 'width:100%;height:200px;padding:10px 12px;background:' + cPanelBg + CssFragment.BorderSolid + cPrimaryBorderA + CssFragment.BorderRadiusColor + cPanelFg + ';font-size:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;resize:vertical;outline:none;box-sizing:border-box;line-height:1.5;';
  contentArea.onfocus = function() { (this as HTMLElement).style.borderColor = cPrimary; };
  contentArea.onblur = function() { (this as HTMLElement).style.borderColor = CssFragment.BorderPrimaryStrong; };
  body.appendChild(contentArea);

  const charCount = document.createElement('div');
  charCount.style.cssText = 'text-align:right;font-size:10px;color:' + cPanelFgDim + ';margin-top:2px;margin-bottom:8px;';
  charCount.textContent = '0 chars';
  contentArea.oninput = function() { charCount.textContent = contentArea.value.length + ' chars'; };
  if (initialData.text) charCount.textContent = contentArea.value.length + ' chars';
  body.appendChild(charCount);

  return { titleInput, contentArea, charCount };
}

function _buildFileDropZone(body: HTMLElement, contentArea: HTMLTextAreaElement, charCount: HTMLElement, titleInput: HTMLInputElement): void {
  const dropZone = document.createElement('div');
  dropZone.style.cssText = 'border:2px dashed ' + cPrimaryBorderA + ';border-radius:8px;padding:16px;text-align:center;color:' + cPanelFgDim + ';font-size:11px;margin-bottom:12px;transition:all .2s;cursor:pointer;';
  dropZone.innerHTML = '📁 Drop <b>.md</b>, <b>.txt</b>, or <b>.prompt</b> file here<br><span style="font-size:10px;color:#4b5563;">or click to browse</span>';
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = '.md,.txt,.prompt'; fileInput.style.display = 'none';
  dropZone.onclick = function() { fileInput.click(); };
  const fileRefs: FileHandlerRefs = { contentArea, charCount, titleInput, dropZone };
  fileInput.onchange = function() { handleFile(fileInput.files![0], fileRefs); };
  dropZone.addEventListener('dragover', function(e: Event) { e.preventDefault(); e.stopPropagation(); (this as HTMLElement).style.borderColor = cPrimary; (this as HTMLElement).style.background = 'rgba(124,58,237,0.1)'; });
  dropZone.addEventListener('dragleave', function(e: Event) { e.preventDefault(); (this as HTMLElement).style.borderColor = CssFragment.BorderPrimary; (this as HTMLElement).style.background = 'transparent'; });
  dropZone.addEventListener('drop', function(e: DragEvent) {
    e.preventDefault(); e.stopPropagation();
    (this as HTMLElement).style.borderColor = CssFragment.BorderPrimary; (this as HTMLElement).style.background = 'transparent';
    if (e.dataTransfer && e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0], fileRefs);
  });
  body.appendChild(dropZone);
  body.appendChild(fileInput);
}

function _buildVariableReference(body: HTMLElement): void {
  const varToggle = document.createElement('div');
  varToggle.style.cssText = 'cursor:pointer;font-size:11px;color:' + cPrimaryLight + ';margin-bottom:4px;user-select:none;';
  varToggle.textContent = '▸ Template Variables';
  const varList = document.createElement('div');
  varList.style.cssText = 'display:none;padding:6px 10px;background:rgba(124,58,237,0.08);border-radius:6px;font-size:10px;color:#9ca3af;margin-bottom:12px;line-height:1.8;';
  varList.innerHTML = '<code style="color:#c4b5fd;">{{date}}</code> — current date<br><code style="color:#c4b5fd;">{{time}}</code> — current time<br><code style="color:#c4b5fd;">{{date:FORMAT}}</code> — e.g. dd-MMM-YYYY<br><code style="color:#c4b5fd;">{{time:FORMAT}}</code> — e.g. 12 hr clock';
  varToggle.onclick = function() {
    const isOpen = varList.style.display !== 'none';
    varList.style.display = isOpen ? 'none' : 'block';
    varToggle.textContent = (isOpen ? '▸' : '▾') + ' Template Variables';
  };
  body.appendChild(varToggle);
  body.appendChild(varList);
}

// ── Category Select ──
 
function _buildCategorySelect(initialData: Record<string, unknown>): { catWrap: HTMLElement; catSelect: HTMLSelectElement; catCustomInput: HTMLInputElement } {
  const catLabel = document.createElement('label');
  catLabel.textContent = 'Category (optional)';
  catLabel.style.cssText = CssFragment.LabelBlock + cPrimaryLight + CssFragment.LabelSuffix;

  const promptsCfg = getPromptsConfig();
  const existingEntries = promptsCfg.entries || [];
  const existingCats: string[] = [];
  const catSeen: Record<string, boolean> = {};
  for (const entry of existingEntries) {
    const ec = (entry.category || '').trim();
    if (ec && !catSeen[ec.toLowerCase()]) { existingCats.push(ec); catSeen[ec.toLowerCase()] = true; }
  }

  const catWrap = document.createElement('div');
  catWrap.style.cssText = 'position:relative;margin-bottom:12px;';
  catWrap.appendChild(catLabel);

  const catSelect = document.createElement('select');
  catSelect.style.cssText = 'width:100%;padding:8px 12px;background:' + cPanelBg + CssFragment.BorderSolid + cPrimaryBorderA + CssFragment.BorderRadiusColor + cPanelFg + ';font-size:13px;outline:none;box-sizing:border-box;appearance:auto;cursor:pointer;';
  catSelect.onfocus = function() { (this as HTMLElement).style.borderColor = cPrimary; };
  catSelect.onblur = function() { (this as HTMLElement).style.borderColor = CssFragment.BorderPrimaryStrong; };

  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = '— No category —';
  catSelect.appendChild(noneOpt);
  for (const cat of existingCats) {
    const opt = document.createElement('option');
    opt.value = cat; opt.textContent = cat;
    catSelect.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__'; customOpt.textContent = '✏️ Custom category…';
  catSelect.appendChild(customOpt);

  const catCustomInput = document.createElement('input');
  catCustomInput.type = 'text';
  catCustomInput.placeholder = 'Type custom category name…';
  catCustomInput.style.cssText = 'display:none;width:100%;padding:8px 12px;background:' + cPanelBg + CssFragment.BorderSolid + cPrimaryBorderA + CssFragment.BorderRadiusColor + cPanelFg + ';font-size:13px;outline:none;box-sizing:border-box;margin-top:6px;';
  catCustomInput.onfocus = function() { (this as HTMLElement).style.borderColor = cPrimary; };
  catCustomInput.onblur = function() { (this as HTMLElement).style.borderColor = CssFragment.BorderPrimaryStrong; };

  catSelect.onchange = function() {
    catCustomInput.style.display = catSelect.value === '__custom__' ? 'block' : 'none';
    if (catSelect.value !== '__custom__') catCustomInput.value = '';
    if (catSelect.value === '__custom__') catCustomInput.focus();
  };

  const initialCat = ((initialData.category as string) || '').trim();
  if (initialCat) {
    const matchIdx = existingCats.findIndex(function(c) { return c.toLowerCase() === initialCat.toLowerCase(); });
    if (matchIdx !== -1) { catSelect.value = existingCats[matchIdx]; }
    else { catSelect.value = '__custom__'; catCustomInput.style.display = 'block'; catCustomInput.value = initialCat; }
  }

  catWrap.appendChild(catSelect);
  catWrap.appendChild(catCustomInput);
  return { catWrap, catSelect, catCustomInput };
}

// ── Prompt Modal Footer ──
 
function _buildPromptModalFooter(
  isEdit: boolean,
  editPrompt: EditablePrompt | null,
  overlay: HTMLElement,
  bodyResult: PromptBodyResult,
): HTMLElement {
  const { titleInput, contentArea, catSelect, catCustomInput } = bodyResult;
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid rgba(124,58,237,0.3);';

  // Paste Test button
  const testBtn = document.createElement('button');
  testBtn.textContent = '📋 Paste Test';
  testBtn.style.cssText = 'padding:8px 14px;background:' + cPanelBgAlt + CssFragment.BorderSolid + cPrimaryBorderA + ';border-radius:6px;color:#c4b5fd;font-size:12px;cursor:pointer;';
  testBtn.onmouseover = function() { (this as HTMLElement).style.background = '#2d3348'; };
  testBtn.onmouseout = function() { (this as HTMLElement).style.background = '#252a36'; };
  testBtn.onclick = function() {
    let text = contentArea.value.trim();
    if (!text) { showPasteToast('❌ No content to paste', true); return; }
    const now = new Date();
    text = text.replace(/\{\{date\}\}/gi, now.toLocaleDateString());
    text = text.replace(/\{\{time\}\}/gi, now.toLocaleTimeString());
    const pCfg = getPromptsConfig();
    pasteIntoEditor(text, pCfg, getByXPathAsElement);
  };
  footer.appendChild(testBtn);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.textContent = isEdit ? '💾 Update' : '💾 Save';
  saveBtn.style.cssText = 'padding:8px 18px;background:' + cPrimary + ';border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;';
  saveBtn.onmouseover = function() { (this as HTMLElement).style.background = '#6d28d9'; };
  saveBtn.onmouseout = function() { (this as HTMLElement).style.background = '#7c3aed'; };
  saveBtn.onclick = function() {
    const name = titleInput.value.trim();
    const text = contentArea.value.trim();
    if (!name) { showPasteToast('❌ Title is required', true); titleInput.focus(); return; }
    if (!text) { showPasteToast('❌ Content is required', true); contentArea.focus(); return; }
    if (text.length > 50 * 1024) { showPasteToast('❌ Content exceeds 50KB limit', true); return; }

    (saveBtn as HTMLButtonElement).disabled = true;
    saveBtn.textContent = '⏳ Saving…';

    const category = getSelectedCategory(catSelect, catCustomInput);
    const promptPayload: Record<string, string> = { name: name, text: text, source: 'user' };
    if (category) promptPayload.category = category;
    if (isEdit && editPrompt!.id) promptPayload.id = editPrompt!.id;

    sendToExtension('SAVE_PROMPT', { prompt: promptPayload }).then(function(resp: Record<string, unknown>) {
      (saveBtn as HTMLButtonElement).disabled = false;
      saveBtn.textContent = isEdit ? '💾 Update' : '💾 Save';
      if (resp && resp.isOk) {
        showPasteToast('✓ Prompt saved: ' + name, false);
        log('Prompt saved: ' + name, 'success');
        clearLoadedPrompts();
        invalidatePromptCache();
        overlay.remove();
        // CRUD fix: reload from DB and re-render the dropdown so the new/edited
        // prompt shows up immediately without requiring a manual ↻ Load click.
        loadPromptsFromJson().then(function() { rerenderPromptsDropdown(); });
      } else {
        const errMsg = (resp && resp.errorMessage as string) || 'Save failed — extension may not be connected';
        showPasteToast('❌ ' + errMsg, true);
        logError('Prompt save failed', '' + errMsg);
      }
    });
  };
  footer.appendChild(saveBtn);

  return footer;
}
