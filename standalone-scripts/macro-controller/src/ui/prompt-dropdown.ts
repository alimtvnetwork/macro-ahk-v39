/**
 * Prompt Dropdown — Dropdown rendering with categories, Task Next, prompt items
 *
 * Phase 5D split from ui/prompt-manager.ts.
 * See: spec/04-macro-controller/ts-migration-v2/05-module-splitting.md
 */

import { log } from '../logging';
import { logError } from '../error-utils';
import type { PromptEntry as LoaderPromptEntry } from '../types';

import { cPanelFg, cPanelFgDim, cPrimary, cPrimaryLight, cBtnMenuHover, lDropdownRadius } from '../shared-state';
import { getByXPath } from '../xpath-utils';
import { pasteIntoEditor, showPasteToast } from './prompt-utils';
import { runTaskNextLoop, openTaskNextSettingsModal, type TaskNextDeps } from './task-next-ui';
import type { PromptContext } from './prompt-loader';
import {
  getPromptsConfig,
  sendToExtension,
  loadPromptsFromJson,
  setRevalidateContext,
  setRenderDropdownFn,
  getPromptCategoryFilter,
  getPromptCategoryFilterSet,
  clearLoadedPrompts,
  forceLoadFromDb,
  saveHtmlCopy,
} from './prompt-loader';
import { openPromptCreationModal } from './prompt-injection';
import {
  computePromptHash,
  writeUISnapshot,
  readUISnapshot,
  clearUISnapshot,
} from './prompt-cache';
import type { CachedPromptEntry } from './prompt-cache';
import { showToast } from '../toast';
import { renderPlanTaskSubmenu } from './plan-task-ui';
import { renderFilterMenu } from './prompt-filter-menu';

/** Adapter: getByXPath returns Node|null, pasteIntoEditor needs Element|null */
function getByXPathAsElement(xpath: string): Element | null {
  const node = getByXPath(xpath);
  return node instanceof Element ? node : null;
}

// Register ourselves as the render function for background revalidation
setRenderDropdownFn(renderPromptsDropdown);

// CQ16: Keep the inline Task Next panel visible inside the prompts dropdown.
// Handles both bottom overflow (open-down) and top overflow (open-up flip from Step 3).
function keepTaskNextSubInView(promptsDropdown: HTMLElement, taskNextSub: HTMLElement): void {
  window.requestAnimationFrame(function () {
    const dropRect = promptsDropdown.getBoundingClientRect();
    const subRect = taskNextSub.getBoundingClientRect();
    const PAD = 6;
    if (subRect.bottom > dropRect.bottom) {
      promptsDropdown.scrollTop += Math.ceil(subRect.bottom - dropRect.bottom + PAD);
      return;
    }
    if (subRect.top < dropRect.top) {
      promptsDropdown.scrollTop -= Math.ceil(dropRect.top - subRect.top + PAD);
    }
  });
}

// Legacy single-pick chip helper removed in favor of the new Filter menu.
// (Multi-select state lives in prompt-loader.ts via getPromptCategoryFilterSet.)

/**
 * Render the prompts dropdown with categories, Task Next submenu, and prompt items.
 */
export function renderPromptsDropdown(ctx: PromptContext, taskNextDeps: TaskNextDeps): void {
  // Store revalidation context for background cache updates
  setRevalidateContext(ctx, taskNextDeps);

  const promptsDropdown = ctx.promptsDropdown;
  const promptsCfg = getPromptsConfig();
  const entries = promptsCfg.entries;

  // Compute current data hash for snapshot validation
  const currentHash = computePromptHash(entries as CachedPromptEntry[]);
  const currentFilter = _computeFilterKey();

  // Try UI snapshot restore (skip full render if HTML is cached and data hasn't changed)
  const snapshotPromise = readUISnapshot();
  snapshotPromise.then(function(snapshot) {
    if (snapshot && snapshot.dataHash === currentHash && snapshot.categoryFilter === currentFilter && snapshot.promptCount === entries.length) {
      log('[PromptDropdown] Restoring UI from snapshot cache (' + snapshot.promptCount + ' prompts)', 'info');
      promptsDropdown.innerHTML = snapshot.html;
      promptsDropdown.scrollTop = snapshot.scrollTop;
      // Re-bind event listeners on restored HTML
      _rebindDropdownListeners(promptsDropdown, entries, promptsCfg, ctx, taskNextDeps);
      return;
    }
    // No valid snapshot — full render
    _renderFresh(promptsDropdown, entries, promptsCfg, ctx, taskNextDeps, currentHash, currentFilter);
  }).catch(function(e: unknown) {
    logError('renderPrompts', 'Prompt dropdown render failed', e);
    showToast('❌ Prompt dropdown render failed', 'error');
    _renderFresh(promptsDropdown, entries, promptsCfg, ctx, taskNextDeps, currentHash, currentFilter);
  });
}
// ============================================
// Dropdown header with Load button
// ============================================

/** Build the dropdown header row: Tasks toggle (left) + Load button (right). */
function buildDropdownHeader(ctx: PromptContext, taskNextDeps: TaskNextDeps): HTMLElement {
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 8px;border-bottom:1px solid #7c3aed;';
  header.appendChild(buildTasksToggleButton());
  header.appendChild(buildLoadButton(ctx, taskNextDeps));
  return header;
}

/** Build the "🎯 Tasks ▾" toggle that shows/hides the Plan Task + Task Next submenus group. */
function buildTasksToggleButton(): HTMLElement {
  const btn = document.createElement('span');
  btn.setAttribute('data-tasks-toggle', '1');
  btn.textContent = '🎯 Tasks ▸';
  btn.title = 'Plan Task + Task Next controls';
  btn.style.cssText = 'cursor:pointer;padding:3px 8px;border-radius:4px;font-size:9px;font-weight:600;color:' + cPrimaryLight + ';background:rgba(124,58,237,0.18);border:1px solid rgba(124,58,237,0.35);user-select:none;';
  btn.onmouseover = function() { btn.style.background = 'rgba(124,58,237,0.32)'; };
  btn.onmouseout = function() { btn.style.background = 'rgba(124,58,237,0.18)'; };
  btn.onclick = function(e: Event) {
    e.stopPropagation();
    const dropdown = btn.closest('[data-prompts-dropdown]') as HTMLElement | null
      ?? (btn.parentElement?.parentElement as HTMLElement | null);
    const group = dropdown?.querySelector('[data-tasks-group]') as HTMLElement | null;
    if (!group) return;
    const open = group.style.display !== 'none';
    group.style.display = open ? 'none' : 'block';
    btn.textContent = open ? '🎯 Tasks ▸' : '🎯 Tasks ▾';
  };
  return btn;
}


/** Build the manual "Load" button for refreshing prompts from DB. */
function buildLoadButton(ctx: PromptContext, taskNextDeps: TaskNextDeps): HTMLElement {
  const btn = document.createElement('span');
  btn.textContent = '↻ Load';
  btn.title = 'Reload prompts from database';
  btn.style.cssText = 'cursor:pointer;padding:3px 8px;border-radius:4px;font-size:9px;font-weight:600;color:#fff;background:' + cPrimary + ';border:1px solid rgba(255,255,255,0.1);';

  btn.onmouseover = function() { btn.style.background = cPrimaryLight; btn.style.transform = 'scale(1.05)'; };
  btn.onmouseout = function() { btn.style.background = cPrimary; btn.style.transform = ''; };

  btn.onclick = function(e: Event) {
    e.stopPropagation();
    handleLoadClick(btn, ctx, taskNextDeps);
  };

  return btn;
}

/** Handle the Load button click — fetch from DB and re-render. */
function handleLoadClick(btn: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): void {
  btn.textContent = '⏳…';
  btn.style.pointerEvents = 'none';

  forceLoadFromDb().then(function() {
    log('[PromptDropdown] Manual load complete — re-rendering', 'success');
    renderPromptsDropdown(ctx, taskNextDeps);
  }).catch(function(err: unknown) {
    logError('PromptDropdown', 'Manual load failed: ' + (err instanceof Error ? err.message : String(err)));
    btn.textContent = '↻ Load';
    btn.style.pointerEvents = '';
  });
}

function _renderFresh(
  promptsDropdown: HTMLElement,
  entries: LoaderPromptEntry[],
  promptsCfg: ReturnType<typeof getPromptsConfig>,
  ctx: PromptContext,
  taskNextDeps: TaskNextDeps,
  dataHash: string,
  categoryFilter: string | null,
): void {
  promptsDropdown.textContent = '';

  if (!entries.length) {
    renderEmptyState(promptsDropdown, ctx, taskNextDeps);
    return;
  }

  _appendHeaderAndSubmenu(promptsDropdown, entries, ctx, taskNextDeps);
  _appendFilteredItems(promptsDropdown, entries, promptsCfg, ctx, taskNextDeps);
  promptsDropdown.appendChild(buildAddPromptButton(promptsDropdown, ctx, taskNextDeps));
  _persistSnapshot(promptsDropdown, entries, dataHash, categoryFilter);
}

/** Append header, Task Next + Plan Task (collapsed by default) + Filter inline menus. */
function _appendHeaderAndSubmenu(
  container: HTMLElement,
  entries: LoaderPromptEntry[],
  ctx: PromptContext,
  taskNextDeps: TaskNextDeps,
): void {
  // Mark dropdown so the Tasks toggle can find the group from any descendant click.
  if (!container.hasAttribute('data-prompts-dropdown')) container.setAttribute('data-prompts-dropdown', '1');
  container.appendChild(buildDropdownHeader(ctx, taskNextDeps));

  // Collapsible group hosting Task Next + Plan Task. Hidden by default so the prompts list
  // is the primary content; user opens it via the 🎯 Tasks toggle in the header.
  const tasksGroup = document.createElement('div');
  tasksGroup.setAttribute('data-tasks-group', '1');
  tasksGroup.style.cssText = 'display:none;border-bottom:1px solid rgba(124,58,237,0.4);background:rgba(124,58,237,0.06);';
  renderTaskNextSubmenu(tasksGroup, ctx, taskNextDeps);
  renderPlanTaskSubmenu(tasksGroup, ctx);
  container.appendChild(tasksGroup);

  const categories = collectUniqueCategories(entries);
  renderFilterMenu(container, categories, ctx, taskNextDeps, renderPromptsDropdown);
}

/** Append filtered prompt items or empty-category message. */
function _appendFilteredItems(
  container: HTMLElement,
  entries: LoaderPromptEntry[],
  promptsCfg: ReturnType<typeof getPromptsConfig>,
  ctx: PromptContext,
  taskNextDeps: TaskNextDeps,
): void {
  const filtered = filterByCategory(entries);
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:12px 8px;text-align:center;color:' + cPanelFgDim + ';font-size:11px;';
    empty.textContent = 'No prompts in this category';
    container.appendChild(empty);
    return;
  }
  for (const [idx, p] of filtered.entries()) {
    container.appendChild(renderPromptItem(idx, p, container, promptsCfg, ctx, taskNextDeps));
  }
}

/** Save UI snapshot + HtmlCopy for fast restore. */
function _persistSnapshot(container: HTMLElement, entries: LoaderPromptEntry[], dataHash: string, categoryFilter: string | null): void {
  const snapshotHtml = container.innerHTML;

  writeUISnapshot({
    html: snapshotHtml,
    categoryFilter: categoryFilter,
    scrollTop: container.scrollTop,
    promptCount: entries.length,
    dataHash: dataHash,
  }).then(function() {
    log('[PromptDropdown] UI snapshot saved', 'info');
  });

  saveHtmlCopy({
    html: snapshotHtml,
    promptCount: entries.length,
    dataHash: dataHash,
  }).then(function() {
    log('[PromptDropdown] HtmlCopy saved to IndexedDB', 'info');
  });
}

/**
 * Re-bind click/hover/input event listeners on snapshot-restored HTML.
 * Uses data attributes and DOM structure matching to reconnect handlers.
 */
function _rebindDropdownListeners(
  promptsDropdown: HTMLElement,
  entries: LoaderPromptEntry[],
  promptsCfg: ReturnType<typeof getPromptsConfig>,
  ctx: PromptContext,
  taskNextDeps: TaskNextDeps,
): void {
  _cleanupTaskNextSubs();
  _rebindHeader(promptsDropdown, ctx, taskNextDeps);
  _rebindTaskNextSubmenu(promptsDropdown, ctx, taskNextDeps);
  _rebindFilterChips(promptsDropdown, entries, ctx, taskNextDeps);
  _rebindPromptItems(promptsDropdown, entries, promptsCfg, ctx, taskNextDeps);
  _rebindAddButton(promptsDropdown, ctx, taskNextDeps);
}

/** Re-attach the Load button handler in the dropdown header. */
function _rebindHeader(container: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): void {
  // Header is the first child — find Load button inside it
  const header = container.firstElementChild as HTMLElement;
  if (!header) return;
  // Replace the old Load button with a fresh one
  const oldLoadBtn = header.querySelector('span[title="Reload prompts from database"]') as HTMLElement;
  if (oldLoadBtn) {
    const newLoadBtn = buildLoadButton(ctx, taskNextDeps);
    oldLoadBtn.replaceWith(newLoadBtn);
  }
}

/** Rebuild the Task Next submenu after snapshot restore. */
function _rebindTaskNextSubmenu(container: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): void {
  // Find the Task Next item in the dropdown (second child after header)
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    if (el.textContent?.includes('Task Next')) {
      // Remove old static item and re-render the submenu in its place
      const parent = el.parentElement;
      if (parent) {
        const idx = Array.from(parent.children).indexOf(el);
        el.remove();
        // Build fresh Task Next submenu
        const tempContainer = document.createElement('div');
        renderTaskNextSubmenu(tempContainer, ctx, taskNextDeps);
        const newItem = tempContainer.firstElementChild;
        if (newItem && parent.children[idx]) {
          parent.insertBefore(newItem, parent.children[idx]);
        } else if (newItem) {
          parent.appendChild(newItem);
        }
      }
      break;
    }
  }
}

/** Remove stale Task Next sub-menus from DOM. */
function _cleanupTaskNextSubs(): void {
  const subs = document.querySelectorAll('[data-task-next-sub]');
  subs.forEach(function(el) { el.remove(); });
}

/** Legacy chip rebind retained as a no-op — old flex-wrap chip bar was removed. */
function _rebindFilterChips(
  _container: HTMLElement,
  _entries: LoaderPromptEntry[],
  _ctx: PromptContext,
  _taskNextDeps: TaskNextDeps,
): void {
  // Filter UI is now the inline Filter menu rendered via renderFilterMenu().
  // Snapshot restore replaces innerHTML; the menu is rebuilt as part of the fresh render path.
}

/** Re-attach prompt item click/hover handlers from snapshot. */
function _rebindPromptItems(
  container: HTMLElement,
  entries: LoaderPromptEntry[],
  promptsCfg: ReturnType<typeof getPromptsConfig>,
  ctx: PromptContext,
  taskNextDeps: TaskNextDeps,
): void {
  const filtered = filterByCategory(entries);
  const items = _findPromptItemElements(container);

  for (let i = 0; i < Math.min(items.length, filtered.length); i++) {
    _bindSinglePromptItem(items[i], filtered[i], container, promptsCfg, ctx, taskNextDeps);
  }
}

/** Find DOM elements tagged as prompt items via data attribute. */
function _findPromptItemElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-prompt-idx]')) as HTMLElement[];
}

/** Bind hover/click on a single restored prompt item. */
function _bindSinglePromptItem(
  item: HTMLElement, p: PromptEntry, container: HTMLElement,
  promptsCfg: ReturnType<typeof getPromptsConfig>, ctx: PromptContext, taskNextDeps: TaskNextDeps,
): void {
  item.onmouseover = function() { (this as HTMLElement).style.background = cBtnMenuHover; };
  item.onmouseout = function() { (this as HTMLElement).style.background = 'transparent'; };
  if (!p.text) return;

  const actionsSpan = item.querySelector('span:last-child') as HTMLElement;
  item.onclick = function(e: Event) {
    if (actionsSpan && actionsSpan.contains(e.target as Node)) return;
    pasteIntoEditor(p.text, promptsCfg, getByXPathAsElement);
    container.style.display = 'none';
  };
  if (actionsSpan) {
    _rebindActionIcons(actionsSpan, p, container, ctx, taskNextDeps);
  }
}

/** Re-attach the Add New Prompt button handler. */
function _rebindAddButton(container: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): void {
  const lastChild = container.lastElementChild as HTMLElement;
  if (!lastChild || !lastChild.textContent?.includes('Add New Prompt')) return;
  lastChild.onmouseover = function() { (this as HTMLElement).style.background = 'rgba(139,92,246,0.2)'; };
  lastChild.onmouseout = function() { (this as HTMLElement).style.background = 'transparent'; };
  lastChild.onclick = function(e: Event) {
    e.stopPropagation();
    container.style.display = 'none';
    openPromptCreationModal(ctx, taskNextDeps, null);
  };
}

function _rebindActionIcons(
  actionsSpan: HTMLElement,
  p: PromptEntry,
  promptsDropdown: HTMLElement,
  ctx: PromptContext,
  taskNextDeps: TaskNextDeps,
): void {
  const icons = actionsSpan.querySelectorAll('span');
  for (const icon of icons) {
    const el = icon as HTMLElement;
    el.onmouseover = function() { (this as HTMLElement).style.opacity = '1'; };
    el.onmouseout = function() { (this as HTMLElement).style.opacity = el.style.opacity; };
    if (el.title === 'Edit prompt') {
      el.onclick = function(e: Event) {
        e.stopPropagation();
        promptsDropdown.style.display = 'none';
        openPromptCreationModal(ctx, taskNextDeps, { id: p.id, name: p.name, text: p.text, category: p.category, isDefault: p.isDefault });
      };
    } else if (el.title === 'Delete prompt') {
      el.onclick = function(e: Event) {
        e.stopPropagation();
        if (!confirm('Delete prompt "' + p.name + '"?')) return;
        sendToExtension('DELETE_PROMPT', { promptId: p.id }).then(function(resp: Record<string, unknown>) {
          if (resp && resp.isOk) {
            clearLoadedPrompts();
            clearUISnapshot();
            loadPromptsFromJson().then(function() { renderPromptsDropdown(ctx, taskNextDeps); });
          }
        });
      };
    } else if (el.title === 'Copy to clipboard') {
      el.onclick = function(e: Event) {
        e.stopPropagation();
        navigator.clipboard.writeText(p.text).then(function() {
          el.textContent = '✅';
          setTimeout(function() { el.textContent = '📋'; }, 1500);
        });
      };
    }
  }
}

function renderEmptyState(container: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): void {
  const emptyState = document.createElement('div');
  emptyState.style.cssText = 'padding:20px 12px;text-align:center;color:' + cPanelFgDim + ';font-size:11px;';
  emptyState.innerHTML = '<div style="font-size:24px;margin-bottom:8px;">📋</div>' +
    '<div style="font-weight:600;margin-bottom:4px;">No prompts available</div>' +
    '<div style="font-size:10px;opacity:0.7;">Click ➕ below to create your first prompt</div>';
  container.appendChild(emptyState);
  container.appendChild(buildAddPromptButton(container, ctx, taskNextDeps));
}

function collectUniqueCategories(entries: Array<{ category?: string }>): string[] {
  const categories: string[] = [];
  const catSeen: Record<string, boolean> = {};
  for (const entry of entries) {
    const cat = (entry.category || '').trim();
    if (cat && !catSeen[cat.toLowerCase()]) {
      categories.push(cat);
      catSeen[cat.toLowerCase()] = true;
    }
  }
  return categories;
}

/** Combined filter key for snapshot validation — covers legacy single + new multi set. */
function _computeFilterKey(): string {
  const legacy = getPromptCategoryFilter() || '';
  const multi = Array.from(getPromptCategoryFilterSet()).sort().join(',');
  return legacy + '|' + multi;
}

function filterByCategory<T extends { category?: string }>(entries: T[]): T[] {
  const set = getPromptCategoryFilterSet();
  if (set.size > 0) {
    return entries.filter(entry => set.has(String(entry.category || '').trim().toLowerCase()));
  }
  const legacy = getPromptCategoryFilter();
  if (!legacy) return entries;
  return entries.filter(entry => (String(entry.category || '')).trim().toLowerCase() === legacy);
}

function renderTaskNextSubmenu(container: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): void {
  const promptsDropdown = ctx.promptsDropdown;
  const { taskNextItem, taskNextSub } = _buildTaskNextMenuShell(promptsDropdown);

  _appendPresetCounts(taskNextSub, promptsDropdown, taskNextDeps);
  _appendCustomCountRow(taskNextSub, promptsDropdown, taskNextDeps);
  _appendTaskNextSettings(taskNextSub, promptsDropdown, taskNextDeps);
  container.appendChild(taskNextItem);
}

function _buildTaskNextMenuShell(promptsDropdown: HTMLElement): { taskNextItem: HTMLElement; taskNextSub: HTMLElement } {
  const taskNextItem = document.createElement('div');
  taskNextItem.style.cssText = 'border-bottom:1px solid rgba(124,58,237,0.3);';
  const taskNextRow = document.createElement('div');
  taskNextRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;cursor:pointer;font-size:11px;color:' + cPrimaryLight + ';font-weight:600;';
  taskNextRow.textContent = '⏭ Task Next';
  const taskNextArrow = document.createElement('span');
  taskNextArrow.textContent = '▸';
  taskNextArrow.style.cssText = 'font-size:10px;margin-left:4px;';
  taskNextRow.appendChild(taskNextArrow);

  const taskNextSub = document.createElement('div');
  taskNextSub.setAttribute('data-task-next-sub', '1');
  taskNextSub.style.cssText = 'display:none;position:static;margin:0 6px 6px 6px;min-width:0;background:rgba(0,0,0,0.18);border:1px solid ' + cPrimary + ';border-radius:' + lDropdownRadius + ';box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);';
  taskNextItem.appendChild(taskNextRow);
  taskNextItem.appendChild(taskNextSub);

  const showSub = function(): void {
    taskNextRow.style.background = cBtnMenuHover;
    taskNextArrow.textContent = '▾';
    taskNextSub.style.display = 'block';
    keepTaskNextSubInView(promptsDropdown, taskNextSub);
  };
  const hideSub = function(): void {
    taskNextRow.style.background = 'transparent';
    taskNextArrow.textContent = '▸';
    taskNextSub.style.display = 'none';
  };
  taskNextRow.onmouseover = showSub;
  taskNextRow.onclick = function(e: Event) {
    e.stopPropagation();
    if (taskNextSub.style.display === 'none') showSub(); else hideSub();
  };
  taskNextItem.onmouseout = function() {
    setTimeout(function() {
      if (!taskNextItem.matches(':hover')) hideSub();
    }, 100);
  };

  return { taskNextItem, taskNextSub };
}

function _appendPresetCounts(taskNextSub: HTMLElement, promptsDropdown: HTMLElement, taskNextDeps: TaskNextDeps): void {
  const presetCounts = [1, 2, 3, 5, 7, 10, 12, 15, 20, 30, 40];
  for (const count of presetCounts) {
    const subItem = document.createElement('div');
    subItem.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:10px;color:' + cPanelFg + ';';
    subItem.textContent = 'Next ' + count + ' task' + (count > 1 ? 's' : '');
    subItem.onmouseover = function() { (this as HTMLElement).style.background = cBtnMenuHover; };
    subItem.onmouseout = function() { (this as HTMLElement).style.background = 'transparent'; };
    subItem.onclick = function(e: Event) {
      e.stopPropagation();
      promptsDropdown.style.display = 'none';
      taskNextSub.style.display = 'none';
      runTaskNextLoop(taskNextDeps, count);
    };
    taskNextSub.appendChild(subItem);
  }
}

function _appendCustomCountRow(taskNextSub: HTMLElement, promptsDropdown: HTMLElement, taskNextDeps: TaskNextDeps): void {
  const customRow = document.createElement('div');
  customRow.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 12px;border-top:1px solid rgba(124,58,237,0.2);';
  const customLabel = document.createElement('span');
  customLabel.textContent = 'Custom:';
  customLabel.style.cssText = 'font-size:10px;color:' + cPrimaryLight + ';';
  customRow.appendChild(customLabel);
  const customInput = document.createElement('input');
  customInput.type = 'number'; customInput.min = '1'; customInput.max = '999'; customInput.placeholder = '#';
  customInput.style.cssText = 'width:50px;padding:3px 5px;background:rgba(0,0,0,0.3);border:1px solid rgba(124,58,237,0.3);border-radius:4px;color:' + cPanelFg + ';font-size:10px;';
  customInput.onclick = function(e: Event) { e.stopPropagation(); };
  customRow.appendChild(customInput);
  const goBtn = document.createElement('span');
  goBtn.textContent = '▶'; goBtn.title = 'Go';
  goBtn.style.cssText = 'cursor:pointer;font-size:11px;color:' + cPrimary + ';';
  goBtn.onclick = function(e: Event) {
    e.stopPropagation();
    const n = parseInt(customInput.value);
    if (!n || n < 1 || n > 999) { showPasteToast('⚠️ Enter 1–999', true); return; }
    promptsDropdown.style.display = 'none';
    taskNextSub.style.display = 'none';
    runTaskNextLoop(taskNextDeps, n);
  };
  customInput.onkeydown = function(e: KeyboardEvent) { if (e.key === 'Enter') { e.stopPropagation(); goBtn.click(); } };
  customRow.appendChild(goBtn);
  taskNextSub.appendChild(customRow);
}

function _appendTaskNextSettings(taskNextSub: HTMLElement, promptsDropdown: HTMLElement, taskNextDeps: TaskNextDeps): void {
  const settingsItem = document.createElement('div');
  settingsItem.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:10px;color:' + cPrimaryLight + ';border-top:1px solid rgba(124,58,237,0.2);';
  settingsItem.textContent = '⚙ Settings';
  settingsItem.onmouseover = function() { (this as HTMLElement).style.background = cBtnMenuHover; };
  settingsItem.onmouseout = function() { (this as HTMLElement).style.background = 'transparent'; };
  settingsItem.onclick = function(e: Event) {
    e.stopPropagation();
    promptsDropdown.style.display = 'none';
    taskNextSub.style.display = 'none';
    openTaskNextSettingsModal(taskNextDeps);
  };
  taskNextSub.appendChild(settingsItem);
}

interface PromptEntry { id?: string; slug?: string; name: string; text: string; category?: string; isDefault?: boolean }

function renderPromptItem(
  idx: number, p: PromptEntry, promptsDropdown: HTMLElement,
  promptsCfg: ReturnType<typeof getPromptsConfig>, ctx: PromptContext, taskNextDeps: TaskNextDeps
): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-prompt-idx', String(idx));
  const hasText = Boolean(p.text);
  item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;cursor:pointer;font-size:10px;color:' + (hasText ? '#c9a8ef' : '#6b5a8a') + ';border-bottom:1px solid rgba(124,58,237,0.15);' + (hasText ? '' : 'opacity:0.6;');
  item.onmouseover = function() { (this as HTMLElement).style.background = cBtnMenuHover; };
  item.onmouseout = function() { (this as HTMLElement).style.background = 'transparent'; };

  const badge = document.createElement('span');
  badge.textContent = String(idx + 1);
  badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:3px;background:' + (hasText ? cPrimary : 'rgba(124,58,237,0.3)') + ';color:' + cPanelFg + ';font-size:8px;font-weight:700;margin-right:6px;flex-shrink:0;';
  item.appendChild(badge);

  const nameSpan = document.createElement('span');
  nameSpan.textContent = p.name + (hasText ? '' : ' (text not loaded)');
  nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  nameSpan.title = p.text || 'Prompt text not available — click Load to refresh';
  item.appendChild(nameSpan);

  const actions = document.createElement('span');
  actions.style.cssText = 'display:flex;align-items:center;gap:2px;margin-left:4px;flex-shrink:0;';

  if (hasText) {
    appendPromptActions(actions, p, promptsDropdown, promptsCfg, ctx, taskNextDeps);
    item.onclick = function(e: Event) {
      if (actions.contains(e.target as Node)) return;
      log('Prompt clicked: "' + p.name + '" (' + p.text.length + ' chars)', 'info');
      pasteIntoEditor(p.text, promptsCfg, getByXPathAsElement);
      promptsDropdown.style.display = 'none';
    };
  } else {
    // Prompt text not loaded — show a helpful message on click
    item.onclick = function() {
      showPasteToast('⚠️ Prompt text not loaded — click ↻ Load to refresh', true);
    };
  }
  item.appendChild(actions);
  return item;
}

function appendPromptActions(
  actions: HTMLElement, p: PromptEntry, promptsDropdown: HTMLElement,
  _promptsCfg: ReturnType<typeof getPromptsConfig>, ctx: PromptContext, taskNextDeps: TaskNextDeps,
): void {
  actions.appendChild(_buildEditIcon(p, promptsDropdown, ctx, taskNextDeps));
  if (!p.isDefault) {
    actions.appendChild(_buildDeleteIcon(p, promptsDropdown, ctx, taskNextDeps));
  }
  actions.appendChild(_buildCopyIcon(p));
}

/** Build the edit ✏️ action icon for a prompt item. */
function _buildEditIcon(p: PromptEntry, dropdown: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): HTMLElement {
  const icon = _makeActionIcon('✏️', 'Edit prompt', '0.6');
  icon.onclick = function(e: Event) {
    e.stopPropagation();
    dropdown.style.display = 'none';
    openPromptCreationModal(ctx, taskNextDeps, { id: p.id, name: p.name, text: p.text, category: p.category, isDefault: p.isDefault });
  };
  return icon;
}

/** Build the delete 🗑️ action icon for a prompt item. */
function _buildDeleteIcon(p: PromptEntry, dropdown: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): HTMLElement {
  const icon = _makeActionIcon('🗑️', 'Delete prompt', '0.6');
  icon.onclick = function(e: Event) {
    e.stopPropagation();
    if (!confirm('Delete prompt "' + p.name + '"?')) return;
    _executeDeletePrompt(p, dropdown, ctx, taskNextDeps);
  };
  return icon;
}

/** Execute prompt deletion via extension message. */
function _executeDeletePrompt(p: PromptEntry, _dropdown: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): void {
  sendToExtension('DELETE_PROMPT', { promptId: p.id }).then(function(resp: Record<string, unknown>) {
    if (resp && resp.isOk) {
      log('Deleted prompt: ' + p.name, 'success');
      clearLoadedPrompts();
      clearUISnapshot();
      loadPromptsFromJson().then(function() { renderPromptsDropdown(ctx, taskNextDeps); });
    } else {
      logError('Failed to delete prompt', '' + p.name);
    }
  });
}

/** Build the copy 📋 action icon for a prompt item. */
function _buildCopyIcon(p: PromptEntry): HTMLElement {
  const icon = _makeActionIcon('📋', 'Copy to clipboard', '0.7');
  icon.style.fontSize = '11px';
  icon.onclick = function(e: Event) {
    e.stopPropagation();
    navigator.clipboard.writeText(p.text).then(function() {
      log('Prompt copied: ' + p.name, 'success');
      icon.textContent = '✅';
      setTimeout(function() { icon.textContent = '📋'; }, 1500);
    });
  };
  return icon;
}

/** Create a styled action icon span with hover opacity. */
function _makeActionIcon(emoji: string, title: string, baseOpacity: string): HTMLElement {
  const icon = document.createElement('span');
  icon.textContent = emoji;
  icon.title = title;
  icon.style.cssText = 'cursor:pointer;font-size:10px;opacity:' + baseOpacity + ';';
  icon.onmouseover = function() { (this as HTMLElement).style.opacity = '1'; };
  icon.onmouseout = function() { (this as HTMLElement).style.opacity = baseOpacity + ';'; };
  return icon;
}

function buildAddPromptButton(promptsDropdown: HTMLElement, ctx: PromptContext, taskNextDeps: TaskNextDeps): HTMLElement {
  const addBtn = document.createElement('div');
  addBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:8px;cursor:pointer;font-size:11px;color:' + cPrimaryLight + ';border-top:1px solid rgba(124,58,237,0.3);';
  addBtn.textContent = '➕ Add New Prompt';
  addBtn.onmouseover = function() { (this as HTMLElement).style.background = 'rgba(139,92,246,0.2)'; };
  addBtn.onmouseout = function() { (this as HTMLElement).style.background = 'transparent'; };
  addBtn.onclick = function(e: Event) {
    e.stopPropagation();
    promptsDropdown.style.display = 'none';
    openPromptCreationModal(ctx, taskNextDeps, null);
  };
  return addBtn;
}
