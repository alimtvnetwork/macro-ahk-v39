import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared-state', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    state: { running: false, direction: 'up', cycleCount: 0 },
    loopCreditState: { perWorkspace: [], totalAvailable: 0 },
  };
});

vi.mock('../logging', () => ({ log: vi.fn() }));
vi.mock('../dom-cache', () => ({ domCache: { stats: () => ({}) } }));
vi.mock('../ws-selection-ui', () => ({ wsRenderStats: {} }));
vi.mock('../ui/ui-updaters', () => ({ statusRenderStats: {} }));
vi.mock('../error-utils', () => ({ logError: vi.fn() }));
vi.mock('../api-namespace', () => ({ nsReadTyped: vi.fn(() => null) }));

import { MacroController } from '../core/MacroController';

describe('MacroController.destroy — reopen-after-close contract', () => {
  beforeEach(() => {
    const mc = MacroController.getInstance() as unknown as { destroy: () => void };
    mc.destroy();
  });

  it('nulls the singleton so getInstance() returns a fresh one', () => {
    const first = MacroController.getInstance();
    first.markInitialized();
    expect(first.initialized).toBe(true);

    (first as unknown as { destroy: () => void }).destroy();
    expect(MacroController.hasInstance()).toBe(false);

    const second = MacroController.getInstance();
    expect(second).not.toBe(first);
    expect(second.initialized).toBe(false);
    expect(MacroController.hasInstance()).toBe(true);
  });

  it('stops the loop and tears down UI before nulling', () => {
    const mc = MacroController.getInstance();
    const stop = vi.fn();
    const destroyUi = vi.fn();
    mc.registerLoop({
      start: vi.fn(), stop, check: vi.fn(), setInterval: vi.fn(() => true),
      isRunning: vi.fn(() => true),
    });
    mc.registerUI({
      create: vi.fn(), destroy: destroyUi, update: vi.fn(),
      updateLight: vi.fn(), populateDropdown: vi.fn(),
    });

    (mc as unknown as { destroy: () => void }).destroy();
    expect(stop).toHaveBeenCalledOnce();
    expect(destroyUi).toHaveBeenCalledOnce();
    expect(MacroController.hasInstance()).toBe(false);
  });

  it('skips loop.stop when loop is not running', () => {
    const mc = MacroController.getInstance();
    const stop = vi.fn();
    mc.registerLoop({
      start: vi.fn(), stop, check: vi.fn(), setInterval: vi.fn(() => true),
      isRunning: vi.fn(() => false),
    });
    (mc as unknown as { destroy: () => void }).destroy();
    expect(stop).not.toHaveBeenCalled();
  });
});
