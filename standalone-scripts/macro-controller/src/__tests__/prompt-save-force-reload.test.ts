import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for the prompt CRUD UX fix (Issue 27 / 2026-05-25):
 *
 * When the user saves or edits a prompt from the inline editor, the dropdown
 * must refresh from IndexedDB (bypassing the in-memory SDK cache) so the new
 * row appears immediately — without requiring a manual ↻ Load click.
 *
 * The fix replaced the post-save `loadPromptsFromJson()` call with
 * `forceLoadFromDb()`. If a future refactor reverts to the JSON loader, this
 * test fails and points at the prompt-injection.ts save-success branch.
 */
describe('prompt-injection.ts — post-save force-reload contract', () => {
  const src = readFileSync(
    resolve(__dirname, '../ui/prompt-injection.ts'),
    'utf8',
  );

  it('imports forceLoadFromDb from prompt-loader', () => {
    expect(src).toMatch(/from '\.\/prompt-loader'/);
    expect(src).toMatch(/\bforceLoadFromDb\b/);
  });

  it('calls forceLoadFromDb().then(rerenderPromptsDropdown) after SAVE_PROMPT success', () => {
    // The save handler must invoke forceLoadFromDb and chain a rerender so the
    // dropdown reflects the freshly-saved row without manual reload.
    expect(src).toMatch(/forceLoadFromDb\(\)\.then\(function\(\)\s*\{\s*rerenderPromptsDropdown\(\)/);
  });

  it('does NOT call loadPromptsFromJson in the save-success branch', () => {
    // Find the SAVE_PROMPT block and assert no stale-cache loader call inside.
    const idx = src.indexOf("sendToExtension('SAVE_PROMPT'");
    expect(idx).toBeGreaterThan(-1);
    // Inspect the next ~600 chars after the SAVE_PROMPT call.
    const block = src.slice(idx, idx + 600);
    expect(block).not.toMatch(/\bloadPromptsFromJson\b/);
  });
});
