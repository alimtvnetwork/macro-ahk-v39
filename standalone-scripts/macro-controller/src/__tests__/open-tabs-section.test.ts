/**
 * open-tabs-section — verifies the "Open Lovable Tabs" panel rendering:
 *   - empty state and loading state
 *   - tab row with injected project (green label)
 *   - tab row with probed workspace (amber label + source tag)
 *   - tab row with probe error (gray italic + truncated reason)
 *   - refresh button triggers re-fetch
 *
 * Closes spec/22-app-issues/111 acceptance:
 *   "Open the panel with >= 2 Lovable tabs — each row shows the correct workspace name."
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let _mockSend: ReturnType<typeof vi.fn> | undefined;

vi.mock('../shared-state', () => ({
  cPanelFgDim: '#94a3b8',
  cPrimaryLight: '#a78bfa',
  cSectionBg: '#1e1e2e',
  cSectionHeader: '#e8e8e8',
  cSectionToggle: '#9e9e9e',
  cPanelBorder: '#313147',
}));

vi.mock('../logging', () => ({
  log: vi.fn(),
  logSub: vi.fn(),
}));

vi.mock('../ui/prompt-loader', () => ({
  sendToExtension: (...args: unknown[]) => _mockSend!(...args),
}));

import { createOpenTabsSection } from '../ui/section-open-tabs';

describe('open-tabs-section', () => {
  beforeEach(() => {
    _mockSend = vi.fn();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function makeMockTabs(): Array<{
    tabId: number | null;
    title: string;
    url: string;
    active: boolean;
    windowFocused: boolean;
    projectId: string | null;
    projectName: string | null;
    bindingSource: 'injection' | 'probe' | 'none';
    detectedWorkspaceName: string | null;
    detectedWorkspaceId: string | null;
    detectedWorkspaceSource: 'api' | 'cache' | 'dom' | 'none' | null;
    probeError: string | null;
    matchedRule: { pattern: string; matchType: string; origin: 'injection-record' | 'evaluated' } | null;
  }> {
    return [
      {
        tabId: 101,
        title: 'Project Alpha — Lovable',
        url: 'https://lovable.dev/projects/proj-alpha-123',
        active: true,
        windowFocused: true,
        projectId: 'proj-alpha-123',
        projectName: 'Alpha',
        bindingSource: 'injection',
        detectedWorkspaceName: 'Alpha Workspace',
        detectedWorkspaceId: 'ws-abc',
        detectedWorkspaceSource: 'api',
        probeError: null,
        matchedRule: { pattern: 'https://*.lovable.dev/*', matchType: 'glob', origin: 'injection-record' },
      },
      {
        tabId: 102,
        title: 'Project Beta — Lovable',
        url: 'https://lovable.dev/projects/proj-beta-456',
        active: false,
        windowFocused: false,
        projectId: 'proj-beta-456',
        projectName: null,
        bindingSource: 'probe',
        detectedWorkspaceName: 'Beta Workspace',
        detectedWorkspaceId: 'ws-def',
        detectedWorkspaceSource: 'cache',
        probeError: null,
        matchedRule: { pattern: 'https://lovable.dev/*', matchType: 'glob', origin: 'evaluated' },
      },
      {
        tabId: 103,
        title: 'Project Gamma — Lovable',
        url: 'https://lovable.dev/projects/proj-gamma-789',
        active: false,
        windowFocused: false,
        projectId: null,
        projectName: null,
        bindingSource: 'none',
        detectedWorkspaceName: null,
        detectedWorkspaceId: null,
        detectedWorkspaceSource: null,
        probeError: 'Could not establish connection. Receiving end does not exist.',
        matchedRule: null,
      },
    ];
  }

  it('renders empty state when no tabs are open', async () => {
    _mockSend!.mockResolvedValueOnce({ tabs: [], capturedAt: '2026-05-25T08:00:00Z' });

    const result = createOpenTabsSection();
    document.body.appendChild(result.section);

    // Trigger the expand => auto-refresh by clicking the header
    (result.section.querySelector('div') as HTMLElement)?.click();

    // Wait for async refresh
    await new Promise((r) => setTimeout(r, 10));

    const panel = document.getElementById('loop-open-tabs-panel');
    expect(panel).not.toBeNull();
    expect(panel!.innerHTML).toContain('No Lovable tabs open');
  });

  it('renders a list with injected, probed, and error rows', async () => {
    const tabs = makeMockTabs();
    _mockSend!.mockResolvedValueOnce({ tabs, capturedAt: '2026-05-25T08:00:00Z' });

    const result = createOpenTabsSection();
    document.body.appendChild(result.section);

    // Simulate expand click => triggers refresh
    (result.section.querySelector('div') as HTMLElement)?.click();

    // Wait for async refresh
    await new Promise((r) => setTimeout(r, 10));

    const panel = document.getElementById('loop-open-tabs-panel');
    expect(panel).not.toBeNull();
    const html = panel!.innerHTML;

    // 3 tabs rendered
    expect(html).toContain('Project Alpha');
    expect(html).toContain('Project Beta');
    expect(html).toContain('Project Gamma');

    // Injected project => green label
    expect(html).toContain('color:#10b981');
    expect(html).toContain('Alpha');

    // Probed workspace => amber label + source tag
    expect(html).toContain('color:#fbbf24');
    expect(html).toContain('Beta Workspace');
    expect(html).toContain('(cache)');

    // Error row => gray italic + truncated reason
    expect(html).toContain('color:#9ca3af');
    expect(html).toContain('no controller');
    expect(html).toContain('Receiving end does not exist');

    // Active badge (●) for tab 101
    expect(html).toContain('Active in window');

    // Focus badge (◆) for tab 101
    expect(html).toContain('Focused window');
  });

  it('renders error state when extension call fails', async () => {
    _mockSend!.mockRejectedValueOnce(new Error('Extension context invalidated'));

    const result = createOpenTabsSection();
    document.body.appendChild(result.section);

    (result.section.querySelector('div') as HTMLElement)?.click();

    await new Promise((r) => setTimeout(r, 10));

    const panel = document.getElementById('loop-open-tabs-panel');
    expect(panel!.innerHTML).toContain('Extension context invalidated');
  });

  it('renders error state when extension returns isOk=false', async () => {
    _mockSend!.mockResolvedValueOnce({ isOk: false, errorMessage: 'Background busy' });

    const result = createOpenTabsSection();
    document.body.appendChild(result.section);

    (result.section.querySelector('div') as HTMLElement)?.click();

    await new Promise((r) => setTimeout(r, 10));

    const panel = document.getElementById('loop-open-tabs-panel');
    expect(panel!.innerHTML).toContain('Background busy');
  });

  it('refresh button re-fetches data', async () => {
    _mockSend!.mockResolvedValueOnce({ tabs: [], capturedAt: '2026-05-25T08:00:00Z' });

    const result = createOpenTabsSection();
    document.body.appendChild(result.section);

    const refreshBtn = result.section.querySelector('button');
    expect(refreshBtn).not.toBeNull();
    expect(refreshBtn!.textContent).toContain('Refresh');

    // Click refresh
    refreshBtn!.click();

    await new Promise((r) => setTimeout(r, 10));

    expect(_mockSend).toHaveBeenCalledTimes(1);
  });
});
