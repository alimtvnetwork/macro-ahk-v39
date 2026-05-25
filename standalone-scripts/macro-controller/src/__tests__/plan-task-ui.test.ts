/**
 * Step 3 (Plan Task RCA) — Tests for plan-task-ui.ts.
 *
 * Covers:
 *  - buildPlanTaskPrompt(n) shape for several N values (unit).
 *  - PasteOutcome surface: caller-side toast only on 'failed' (component).
 *  - 120ms mouseleave auto-collapse is gone (component).
 *  - parseInt radix: custom "08" → 8 (component).
 *  - Dropdown closes AFTER injectPlanPrompt (component).
 *
 * JSDOM env via root vitest config.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { buildPlanTaskPrompt, renderPlanTaskSubmenu } from '../ui/plan-task-ui';
import type { PasteOutcome } from '../ui/prompt-utils';

// ── Mocks ──
const showPasteToastSpy = vi.fn();
let mockOutcome: PasteOutcome = 'injected';

vi.mock('../ui/prompt-utils', async () => {
  return {
    showPasteToast: (...args: unknown[]) => showPasteToastSpy(...args),
    pasteIntoEditor: () => mockOutcome,
  };
});
vi.mock('../ui/prompt-loader', () => ({
  getPromptsConfig: () => ({ editorXPath: '//div' }),
}));
vi.mock('../xpath-utils', () => ({
  getByXPath: () => document.createElement('div'),
}));

interface PromptContextLike {
  promptsDropdown: HTMLElement;
}

function makeCtx(): PromptContextLike {
  const dd = document.createElement('div');
  dd.style.display = 'block';
  document.body.appendChild(dd);
  return { promptsDropdown: dd };
}

beforeEach(() => {
  document.body.innerHTML = '';
  showPasteToastSpy.mockReset();
  mockOutcome = 'injected';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('buildPlanTaskPrompt', () => {
  it('contains the N value in heading + body for n=5/10/15/99', () => {
    for (const n of [5, 10, 15, 99]) {
      const out = buildPlanTaskPrompt(n);
      expect(out).toContain('## **' + n + '** steps Plan');
      expect(out).toContain('plan this task for **' + n + '** steps');
      expect(out).toContain('Write the ' + n + ' steps into `.lovable/plan.md`');
    }
  });

  it('includes guideline check block', () => {
    const out = buildPlanTaskPrompt(7);
    expect(out).toContain('.lovable/coding-guidelines.md');
    expect(out).toContain('.lovable/seo-guidelines.md');
  });
});

describe('renderPlanTaskSubmenu — toast surface', () => {
  it('does NOT show a caller-side toast when outcome=injected', () => {
    const ctx = makeCtx();
    const container = document.createElement('div');
    document.body.appendChild(container);
    // @ts-expect-error — ctx narrowed for test
    renderPlanTaskSubmenu(container, ctx);

    const header = container.querySelector('div') as HTMLElement;
    header.click(); // open sub
    const presets = container.querySelectorAll('[data-plan-task-sub] > div');
    (presets[0] as HTMLElement).click(); // "Plan in 5 steps"

    expect(showPasteToastSpy).not.toHaveBeenCalled();
  });

  it('does NOT show a caller-side toast when outcome=clipboard', () => {
    mockOutcome = 'clipboard';
    const ctx = makeCtx();
    const container = document.createElement('div');
    // @ts-expect-error
    renderPlanTaskSubmenu(container, ctx);
    (container.querySelector('div') as HTMLElement).click();
    const preset = container.querySelector('[data-plan-task-sub] > div') as HTMLElement;
    preset.click();
    expect(showPasteToastSpy).not.toHaveBeenCalled();
  });

  it('SHOWS a red toast only when outcome=failed', () => {
    mockOutcome = 'failed';
    const ctx = makeCtx();
    const container = document.createElement('div');
    // @ts-expect-error
    renderPlanTaskSubmenu(container, ctx);
    (container.querySelector('div') as HTMLElement).click();
    (container.querySelector('[data-plan-task-sub] > div') as HTMLElement).click();
    expect(showPasteToastSpy).toHaveBeenCalledTimes(1);
    expect(showPasteToastSpy.mock.calls[0][0]).toMatch(/injection failed/);
    expect(showPasteToastSpy.mock.calls[0][1]).toBe(true);
  });
});

describe('renderPlanTaskSubmenu — RC-3 no auto-collapse', () => {
  it('sub stays open after mouseleave + 200ms (no setTimeout collapse)', async () => {
    vi.useFakeTimers();
    const ctx = makeCtx();
    const container = document.createElement('div');
    // @ts-expect-error
    renderPlanTaskSubmenu(container, ctx);
    const item = container.firstChild as HTMLElement;
    const header = item.firstChild as HTMLElement;
    const sub = item.querySelector('[data-plan-task-sub]') as HTMLElement;

    header.click(); // open
    expect(sub.style.display).toBe('block');

    item.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(500); // far longer than the legacy 120ms timer

    expect(sub.style.display).toBe('block'); // STILL open — auto-collapse removed
  });
});

describe('renderPlanTaskSubmenu — RC-4 custom parse radix', () => {
  it('treats "08" as 8 (decimal), not 0 (octal)', () => {
    const ctx = makeCtx();
    const container = document.createElement('div');
    // @ts-expect-error
    renderPlanTaskSubmenu(container, ctx);
    (container.querySelector('div') as HTMLElement).click(); // open sub

    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    const goBtn = input.nextSibling as HTMLElement;
    input.value = '08';
    goBtn.click();

    // outcome=injected → no toast. If parsed as 0, would have triggered '⚠️ Enter 1–999'.
    expect(showPasteToastSpy).not.toHaveBeenCalled();
  });

  it('rejects 0 with warning toast', () => {
    const ctx = makeCtx();
    const container = document.createElement('div');
    // @ts-expect-error
    renderPlanTaskSubmenu(container, ctx);
    (container.querySelector('div') as HTMLElement).click();
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    const goBtn = input.nextSibling as HTMLElement;
    input.value = '0';
    goBtn.click();
    expect(showPasteToastSpy).toHaveBeenCalledWith('⚠️ Enter 1–999', true);
  });
});

describe('renderPlanTaskSubmenu — RC-5 dropdown closes after paste', () => {
  it('dropdown remains open until injectPlanPrompt returns', () => {
    const ctx = makeCtx();
    const container = document.createElement('div');
    // @ts-expect-error
    renderPlanTaskSubmenu(container, ctx);
    (container.querySelector('div') as HTMLElement).click();
    expect(ctx.promptsDropdown.style.display).toBe('block');
    (container.querySelector('[data-plan-task-sub] > div') as HTMLElement).click();
    // After click, paste already ran (sync mock), then dropdown closes.
    expect(ctx.promptsDropdown.style.display).toBe('none');
  });
});
