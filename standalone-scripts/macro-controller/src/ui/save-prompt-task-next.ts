/**
 * MacroLoop Controller — Task Next Submenu
 *
 * Flyout submenu inside the prompts dropdown for launching
 * Task Next loops with preset or custom counts, plus settings.
 *
 * @see spec/04-macro-controller/ts-migration-v2/05-module-splitting.md
 */

import { showPasteToast } from './prompt-utils';
import { runTaskNextLoop, openTaskNextSettingsModal } from './task-next-ui';
import type { SavePromptDeps } from './save-prompt';
import { CssFragment } from '../types';
/** Build the Task Next hover submenu and attach it to the dropdown. */
export function buildTaskNextSubmenu(
  dropdown: HTMLElement,
  taskNextDeps: NonNullable<SavePromptDeps['taskNextDeps']>,
): void {
  const taskNextItem = document.createElement('div');
  taskNextItem.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:space-between;padding:6px 12px;cursor:pointer;font-size:11px;color:#a78bfa;border-bottom:1px solid rgba(124,58,237,0.3);font-weight:600;';
  taskNextItem.textContent = '⏭ Task Next';

  const arrow = document.createElement('span');
  arrow.textContent = '▸';
  arrow.style.cssText = 'font-size:10px;margin-left:4px;';
  taskNextItem.appendChild(arrow);

  const submenu = document.createElement('div');
  submenu.style.cssText = 'display:none;position:fixed;min-width:180px;max-height:80vh;overflow-y:auto;background:#1e1e2e;border:1px solid #7c3aed;border-radius:8px;z-index:100010;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
  document.body.appendChild(submenu);

  submenu.onmouseover = function () { submenu.style.display = 'block'; };
  submenu.onmouseout = function () { submenu.style.display = 'none'; };

  const positionSubmenu = function(): void {
    const rect = taskNextItem.getBoundingClientRect();
    const SUB_W = 180;
    const PAD = 8;
    const isOverflowingRight = rect.right + SUB_W > window.innerWidth;
    submenu.style.left = isOverflowingRight ? Math.max(PAD, rect.left - SUB_W) + 'px' : rect.right + 'px';
    // Clamp vertically: measure after display, fall back to rect.top
    submenu.style.top = rect.top + 'px';
    submenu.style.maxHeight = (window.innerHeight - rect.top - PAD) + 'px';
    window.requestAnimationFrame(function () {
      const subRect = submenu.getBoundingClientRect();
      const overflowsBottom = subRect.bottom > window.innerHeight - PAD;
      if (overflowsBottom) {
        const newTop = Math.max(PAD, window.innerHeight - subRect.height - PAD);
        submenu.style.top = newTop + 'px';
        submenu.style.maxHeight = (window.innerHeight - newTop - PAD) + 'px';
      }
    });
  };

  taskNextItem.onmouseover = function () {
    (this as HTMLElement).style.background = CssFragment.Rgba124_58_237_015;
    positionSubmenu();
    submenu.style.display = 'block';
  };

  taskNextItem.onmouseout = function () {
    const self = taskNextItem;
    setTimeout(function () {
      const isSubmenuHovered = submenu.matches(':hover');
      const isItemHovered = self.matches(':hover');
      const shouldHide = !isSubmenuHovered && !isItemHovered;
      if (shouldHide) {
        self.style.background = 'transparent';
        submenu.style.display = 'none';
      }
    }, 100);
  };

  buildPresetCountItems(submenu, dropdown, taskNextDeps);
  buildCustomCountRow(submenu, dropdown, taskNextDeps);
  buildSettingsItem(submenu, dropdown, taskNextDeps);

  dropdown.appendChild(taskNextItem);
}

// ── Preset Count Items ──

function buildPresetCountItems(
  submenu: HTMLElement,
  dropdown: HTMLElement,
  taskNextDeps: NonNullable<SavePromptDeps['taskNextDeps']>,
): void {
  const presetCounts = [1, 2, 3, 5, 7, 10, 12, 15, 20, 30, 40];

  for (const count of presetCounts) {
    const item = document.createElement('div');
    item.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:10px;color:#e0e0e0;';
    item.textContent = 'Next ' + count + ' task' + (count > 1 ? 's' : '');
    item.onmouseover = function () { (this as HTMLElement).style.background = CssFragment.Rgba124_58_237_015; };
    item.onmouseout = function () { (this as HTMLElement).style.background = 'transparent'; };
    item.onclick = function (event) {
      event.stopPropagation();
      dropdown.style.display = 'none';
      submenu.style.display = 'none';
      runTaskNextLoop(taskNextDeps, count);
    };
    submenu.appendChild(item);
  }
}

// ── Custom Count Row ──

function buildCustomCountRow(
  submenu: HTMLElement,
  dropdown: HTMLElement,
  taskNextDeps: NonNullable<SavePromptDeps['taskNextDeps']>,
): void {
  const customRow = document.createElement('div');
  customRow.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 12px;border-top:1px solid rgba(124,58,237,0.2);';

  const label = document.createElement('span');
  label.textContent = 'Custom:';
  label.style.cssText = 'font-size:10px;color:#a78bfa;';
  customRow.appendChild(label);

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = '999';
  input.placeholder = '#';
  input.style.cssText = 'width:50px;padding:3px 5px;background:rgba(0,0,0,0.3);border:1px solid rgba(124,58,237,0.3);border-radius:4px;color:#e0e0e0;font-size:10px;';
  input.onclick = function (event) { event.stopPropagation(); };
  customRow.appendChild(input);

  const goButton = document.createElement('span');
  goButton.textContent = '▶';
  goButton.title = 'Go';
  goButton.style.cssText = 'cursor:pointer;font-size:11px;color:#7c3aed;';
  goButton.onclick = function (event) {
    event.stopPropagation();
    const count = parseInt(input.value);
    const isInvalidCount = !count || count < 1 || count > 999;
    if (isInvalidCount) { showPasteToast('⚠️ Enter 1–999', true); return; }
    dropdown.style.display = 'none';
    submenu.style.display = 'none';
    runTaskNextLoop(taskNextDeps, count);
  };

  input.onkeydown = function (event: KeyboardEvent) {
    const isEnter = event.key === 'Enter';
    if (isEnter) { event.stopPropagation(); goButton.click(); }
  };

  customRow.appendChild(goButton);
  submenu.appendChild(customRow);
}

// ── Settings Item ──

function buildSettingsItem(
  submenu: HTMLElement,
  dropdown: HTMLElement,
  taskNextDeps: NonNullable<SavePromptDeps['taskNextDeps']>,
): void {
  const settingsItem = document.createElement('div');
  settingsItem.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:10px;color:#a78bfa;border-top:1px solid rgba(124,58,237,0.2);';
  settingsItem.textContent = '⚙ Settings';
  settingsItem.onmouseover = function () { (this as HTMLElement).style.background = CssFragment.Rgba124_58_237_015; };
  settingsItem.onmouseout = function () { (this as HTMLElement).style.background = 'transparent'; };
  settingsItem.onclick = function (event) {
    event.stopPropagation();
    dropdown.style.display = 'none';
    submenu.style.display = 'none';
    openTaskNextSettingsModal(taskNextDeps);
  };
  submenu.appendChild(settingsItem);
}
