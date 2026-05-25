/**
 * Issue 116 — Prompts panel layout regression tests.
 *
 * Source-level invariants that lock in the current visual layout of the
 * prompts dropdown (header row, prompt items, badges, actions, Add button).
 * Reading the file as text — not rendering — keeps these checks fast and
 * decoupled from the dropdown's async IndexedDB snapshot path.
 *
 * Any future refactor that changes a checked layout primitive (display,
 * justify-content, badge size, gap) must update this file deliberately,
 * preventing silent visual drift.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'ui', 'prompt-dropdown.ts');

let source = '';
beforeAll(() => { source = readFileSync(SRC, 'utf-8'); });

function cssBlockFor(matchHint: string): string {
  // Grab the single cssText assignment line that contains the hint.
  const lines = source.split('\n');
  const hit = lines.find((ln) => ln.includes('style.cssText') && ln.includes(matchHint));
  if (!hit) throw new Error('cssText block not found for hint: ' + matchHint);
  return hit;
}

describe('Prompts panel — header layout', () => {
  it('header is a flex row spaced between (Tasks toggle ↔ Load btn)', () => {
    const css = cssBlockFor('border-bottom:1px solid #7c3aed');
    expect(css).toContain('display:flex');
    expect(css).toContain('align-items:center');
    expect(css).toContain('justify-content:space-between');
    expect(css).toContain('padding:4px 8px');
  });

  it('header retains a 6px gap between buttons', () => {
    const css = cssBlockFor('border-bottom:1px solid #7c3aed');
    expect(css).toMatch(/gap:6px/);
  });
});

describe('Prompts panel — prompt item rows', () => {
  it('prompt items are flex rows with consistent padding', () => {
    const css = cssBlockFor("padding:6px 8px;cursor:pointer;font-size:10px");
    expect(css).toContain('display:flex');
    expect(css).toContain('align-items:center');
    expect(css).toContain('justify-content:space-between');
    expect(css).toContain('font-size:10px');
  });

  it('numeric badge stays 16x16 with 8px font', () => {
    const css = cssBlockFor('width:16px;height:16px');
    expect(css).toContain('display:inline-flex');
    expect(css).toContain('border-radius:3px');
    expect(css).toContain('font-size:8px');
    expect(css).toContain('flex-shrink:0');
    expect(css).toContain('margin-right:6px');
  });

  it('name span flex-grows and truncates with ellipsis', () => {
    // Look for the nameSpan inline cssText
    const css = cssBlockFor('flex:1;overflow:hidden;text-overflow:ellipsis');
    expect(css).toContain('white-space:nowrap');
  });

  it('actions container hugs the right edge (margin-left:4px, gap:2px)', () => {
    const css = cssBlockFor('display:flex;align-items:center;gap:2px;margin-left:4px');
    expect(css).toContain('flex-shrink:0');
  });
});

describe('Prompts panel — Add New Prompt footer', () => {
  it('Add button is centered with top border separator', () => {
    const css = cssBlockFor('justify-content:center;padding:8px');
    expect(css).toContain('display:flex');
    expect(css).toContain('cursor:pointer');
    expect(css).toContain('border-top:1px solid');
    expect(css).toContain('font-size:11px');
  });
});

describe('Prompts panel — structural invariants', () => {
  it('renderPromptsDropdown is the single public entry point', () => {
    expect(source).toMatch(/export function renderPromptsDropdown\(/);
  });

  it('uses data-prompt-idx attribute selector contract', () => {
    expect(source).toContain("setAttribute('data-prompt-idx'");
  });

  it('Tasks toggle uses data-tasks-toggle hook', () => {
    expect(source).toContain("setAttribute('data-tasks-toggle', '1')");
  });

  it('tasks group uses data-tasks-group hook with display:none default', () => {
    expect(source).toContain('data-tasks-group');
    expect(source).toMatch(/tasksGroup\.style\.cssText\s*=\s*'display:none/);
  });
});
