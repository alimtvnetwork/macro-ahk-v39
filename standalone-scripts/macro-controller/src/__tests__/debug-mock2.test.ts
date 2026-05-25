import { describe, it, expect, vi, beforeEach } from 'vitest';

let _mockSend: ReturnType<typeof vi.fn> | undefined;

vi.mock('../ui/prompt-loader', () => ({
  sendToExtension: (...args: unknown[]) => _mockSend!(...args),
}));

import { sendToExtension } from '../ui/prompt-loader';

describe('debug', () => {
  beforeEach(() => {
    _mockSend = vi.fn();
    vi.clearAllMocks();
  });

  it('shows type', () => {
    console.log('sendToExtension type:', typeof sendToExtension);
    console.log('is mock?:', (sendToExtension as any)?._isMockFunction);
    expect(true).toBe(true);
  });

  it('can set mockResolvedValue', async () => {
    _mockSend!.mockResolvedValueOnce({ tabs: [] });
    const result = await (sendToExtension as any)('GET_OPEN_LOVABLE_TABS', {});
    console.log('result:', result);
    expect(result).toEqual({ tabs: [] });
    expect(_mockSend).toHaveBeenCalledTimes(1);
  });
});
