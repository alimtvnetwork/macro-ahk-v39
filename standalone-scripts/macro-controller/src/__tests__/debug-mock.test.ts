import { describe, it, expect, vi } from 'vitest';

const mockSend = vi.fn();
vi.mock('../ui/prompt-loader', () => ({
  sendToExtension: mockSend,
}));

import { sendToExtension } from '../ui/prompt-loader';

describe('debug', () => {
  it('shows type', () => {
    console.log('sendToExtension type:', typeof sendToExtension);
    console.log('sendToExtension keys:', Object.keys(sendToExtension || {}));
    console.log('is mock?:', (sendToExtension as any)?._isMockFunction);
    expect(true).toBe(true);
  });
});
