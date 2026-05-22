/**
 * MacroLoop Controller — Projects Modal
 *
 * Floating popup (styled after bulk-rename) that lists every project per
 * workspace by calling `marco.api.projects.list(wsId)`, then highlights
 * the projects whose tab is currently open in Chrome (data sourced from
 * the existing `GET_OPEN_LOVABLE_TABS` background handler — the
 * macro-controller runs in the MAIN world and cannot call `chrome.tabs`
 * directly, see mem://architecture/injection-context-awareness).
 *
 * Standards applied:
 *   - mem://constraints/no-retry-policy — single fetch per workspace; user
 *     clicks Refresh to retry. Failures show inline per-row.
 *   - mem://standards/error-logging-via-namespace-logger — uses `logError`.
 *   - mem://architecture/extension-error-management — failures surface as
 *     visible UI rows + activity-log entries.
 */

import { cPanelBg, cPrimary, cPrimaryBgA, cPrimaryLighter, cPanelFgDim, loopCreditState, CREDIT_API_BASE, VERSION } from '../shared-state';
import { sendToExtension } from './prompt-loader';
import { log } from '../logging';
import { logError } from '../error-utils';
import { readProjectListCache, writeProjectListCache, clearProjectListCache, getProjectsCacheTtlMs } from '../projects-cache';
import type { DraggableElement, WorkspaceCredit } from '../types';

const DIALOG_ID = 'marco-projects-modal';

interface OpenTabRow {
    readonly tabId: number | null;
    readonly title: string;
    readonly url: string;
    readonly active: boolean;
    readonly projectId: string | null;
    readonly projectName: string | null;
    readonly detectedWorkspaceName: string | null;
    readonly detectedWorkspaceId: string | null;
}

interface OpenTabsResponse {
    readonly tabs?: ReadonlyArray<OpenTabRow>;
    readonly capturedAt?: string;
    readonly isOk?: boolean;
    readonly errorMessage?: string;
}

interface ProjectEntry {
    readonly id: string;
    readonly name: string;
    /** From projects.list response; blank if upstream omits it. */
    readonly githubRepo: string;
    readonly githubBranch: string;
    readonly lastMessageAt: string;
}

interface WorkspaceBlock {
    readonly ws: WorkspaceCredit;
    projects: ProjectEntry[] | null;
    error: string | null;
    loading: boolean;
}

/** Open tab info indexed by projectId AND by URL fragment for fallback matching. */
interface OpenTabIndex {
    byProjectId: Map<string, OpenTabRow>;
    byUrlProjectId: Map<string, OpenTabRow>;
}

/** Module-scope state — exposed to footer Export button without prop-drilling. */
interface ModalState {
    blocks: WorkspaceBlock[];
    tabIndex: OpenTabIndex | null;
    exporting: boolean;
    /** Free-text filter, lowercased; empty string = no filter. */
    searchQuery: string;
    /** Workspace IDs whose section is collapsed. Persisted across opens. */
    collapsed: Set<string>;
    /** Show only projects whose tab is currently open. */
    filterOpenOnly: boolean;
    /** Show only projects that have a GitHub repo configured. */
    filterHasRepo: boolean;
}
const state: ModalState = {
    blocks: [], tabIndex: null, exporting: false,
    searchQuery: '', collapsed: new Set<string>(),
    filterOpenOnly: false, filterHasRepo: false,
};

const COLLAPSED_STORAGE_KEY = 'marco_projects_modal_collapsed_v1';

async function loadCollapsedState(): Promise<void> {
    try {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        const r = await chrome.storage.local.get(COLLAPSED_STORAGE_KEY);
        const raw = r[COLLAPSED_STORAGE_KEY];
        if (Array.isArray(raw)) {
            state.collapsed = new Set(raw.filter(function (x): x is string { return typeof x === 'string'; }));
        }
    } catch (err: unknown) {
        log('Projects: collapsed-state load failed: ' + String(err), 'warn');
    }
}

function saveCollapsedState(): void {
    try {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        void chrome.storage.local.set({ [COLLAPSED_STORAGE_KEY]: Array.from(state.collapsed) });
    } catch (err: unknown) {
        log('Projects: collapsed-state save failed: ' + String(err), 'warn');
    }
}

export function showProjectsModal(): void {
    removeProjectsModal();
    state.blocks = [];
    state.tabIndex = null;
    state.exporting = false;
    state.searchQuery = '';

    const panel = createPanel();
    const titleBar = createTitleBar(panel);
    panel.appendChild(titleBar);

    const body = document.createElement('div');
    body.style.cssText = 'padding:10px;max-height:60vh;overflow-y:auto;';
    body.innerHTML = renderEmpty('Loading workspaces…');

    const search = createSearchBar(function () { renderBody(body); });
    panel.appendChild(search);
    panel.appendChild(body);

    const footer = createFooter(
        function () { void loadAndRender(body, { bypassCache: true }); },
        function (statusEl) { exportCsv(statusEl); },
    );
    panel.appendChild(footer);

    document.body.appendChild(panel);
    void loadCollapsedState().then(function () { void loadAndRender(body); });
}

/** Render the current blocks + filter into the body element. */
function renderBody(body: HTMLElement): void {
    const tabIndex = state.tabIndex ?? { byProjectId: new Map(), byUrlProjectId: new Map() };
    body.innerHTML = renderAll(state.blocks, tabIndex, null, state.searchQuery);
    attachRowClicks(body);
}

export function removeProjectsModal(): void {
    const existing = document.getElementById(DIALOG_ID) as DraggableElement | null;
    if (!existing) return;
    if (existing.__cleanupDrag) existing.__cleanupDrag();
    existing.remove();
}

// eslint-disable-next-line max-lines-per-function
async function loadAndRender(body: HTMLElement, opts?: { bypassCache?: boolean }): Promise<void> {
    body.innerHTML = renderEmpty('Loading workspaces…');

    // 1. Snapshot known workspaces.
    const workspaces = (loopCreditState.perWorkspace || []).slice();
    if (workspaces.length === 0) {
        body.innerHTML = ''
            + '<div style="text-align:center;padding:20px 12px;color:' + cPanelFgDim + ';font-size:11px;">'
            +   '<div style="font-size:24px;margin-bottom:6px;opacity:0.6;">📭</div>'
            +   '<div style="color:#cbd5e1;margin-bottom:4px;">No workspaces loaded yet.</div>'
            +   '<div style="font-size:10px;">Open the workspace list first, then reopen this modal.</div>'
            + '</div>';
        return;
    }

    // 2. Build open-tab index (in parallel with fetches below).
    const openTabsPromise = loadOpenTabIndex();

    // 3. Initialise blocks — seed from SQLite cache when available so the UI
    //    fills instantly while the network fetch refreshes in the background.
    //    Refresh button passes bypassCache=true to clear and force re-fetch.
    const bypassCache = opts?.bypassCache === true;
    if (bypassCache) {
        for (const ws of workspaces) clearProjectListCache(ws.id);
    }
    const cachedRows = bypassCache
        ? workspaces.map(function () { return null; })
        : await Promise.all(workspaces.map(function (ws) {
            return readProjectListCache(ws.id);
        }));
    const blocks: WorkspaceBlock[] = workspaces.map(function (ws, i) {
        const row = cachedRows[i];
        const seeded: ProjectEntry[] | null = row
            ? row.Projects.map(function (p) {
                return {
                    id: p.Id,
                    name: p.Name,
                    githubRepo: p.GithubRepo,
                    githubBranch: p.GithubBranch,
                    lastMessageAt: p.LastMessageAt,
                };
            })
            : null;
        return { ws, projects: seeded, error: null, loading: true };
    });
    const tabIndex = await openTabsPromise;
    state.blocks = blocks;
    state.tabIndex = tabIndex;
    renderBody(body);

    // 4. Fetch each workspace's projects in parallel (single attempt — no
    //    retry per mem://constraints/no-retry-policy). On success persist
    //    to the SQLite-backed projects-cache for the next open.
    await Promise.all(workspaces.map(function (ws, i) {
        return fetchProjects(ws.id).then(function (projects) {
            blocks[i] = { ws, projects, error: null, loading: false };
            writeProjectListCache(ws.id, projects.map(function (p) {
                return {
                    Id: p.id,
                    Name: p.name,
                    GithubRepo: p.githubRepo,
                    GithubBranch: p.githubBranch,
                    LastMessageAt: p.lastMessageAt,
                };
            }), getProjectsCacheTtlMs());
        }).catch(function (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            // Keep any cached projects visible on failure so the UI is not blanked.
            const fallback = blocks[i].projects;
            blocks[i] = { ws, projects: fallback, error: msg, loading: false };
        }).then(function () {
            state.blocks = blocks;
            // Re-render after each completes for incremental feedback.
            renderBody(body);
        });
    }));
}

async function loadOpenTabIndex(): Promise<OpenTabIndex> {
    const idx: OpenTabIndex = { byProjectId: new Map(), byUrlProjectId: new Map() };
    try {
        const resp = await sendToExtension('GET_OPEN_LOVABLE_TABS', {}) as unknown as OpenTabsResponse;
        if (!resp || resp.isOk === false) return idx;
        const tabs = Array.isArray(resp.tabs) ? resp.tabs : [];
        for (const t of tabs) {
            if (t.projectId) idx.byProjectId.set(t.projectId, t);
            const urlPid = extractProjectIdFromUrl(t.url);
            if (urlPid) idx.byUrlProjectId.set(urlPid, t);
        }
    } catch (e) {
        log('Projects: open-tabs probe failed: ' + String(e), 'warn');
    }
    return idx;
}

async function fetchProjects(wsId: string): Promise<ProjectEntry[]> {
    const sdk = window.marco;
    if (!sdk || !sdk.api || !sdk.api.projects || typeof sdk.api.projects.list !== 'function') {
        throw new Error('marco.api.projects.list unavailable — SDK out of date');
    }
    const resp = await sdk.api.projects.list(wsId, { baseUrl: CREDIT_API_BASE });
    if (!resp.ok) {
        const preview = JSON.stringify(resp.data).substring(0, 160);
        logError('Projects', 'projects.list HTTP ' + resp.status + ' for ws=' + wsId + ': ' + preview);
        throw new Error('HTTP ' + resp.status);
    }
    const data = resp.data as { projects?: Array<Record<string, unknown>> };
    const list = Array.isArray(data.projects) ? data.projects : [];
    const out: ProjectEntry[] = [];
    for (const p of list) {
        const id = typeof p.id === 'string' ? p.id : '';
        if (!id) continue;
        const rawName = typeof p.name === 'string' ? p.name : '';
        out.push({
            id,
            name: rawName || id,
            githubRepo: pickString(p, ['github_repo', 'githubRepo', 'github_full_name', 'repo_full_name']),
            githubBranch: pickString(p, ['github_branch', 'githubBranch', 'default_branch', 'branch']),
            lastMessageAt: pickString(p, ['last_message_at', 'lastMessageAt', 'updated_at', 'updatedAt']),
        });
    }
    return out;
}

function attachRowClicks(body: HTMLElement): void {
    // eslint-disable-next-line sonarjs/cognitive-complexity
    body.addEventListener('click', function (e: Event): void {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        // Clear-all-filters action from the zero-results panel.
        const clearAll = target.closest('[data-clear-filters]') as HTMLElement | null;
        if (clearAll) {
            const panel = body.closest('#' + DIALOG_ID) as HTMLElement | null;
            state.searchQuery = '';
            const input = panel?.querySelector('[data-search-input]') as HTMLInputElement | null;
            if (input) input.value = '';
            if (state.filterOpenOnly) {
                const c = panel?.querySelector('[data-chip="open"]') as HTMLButtonElement | null;
                c?.click();
            }
            if (state.filterHasRepo) {
                const c = panel?.querySelector('[data-chip="repo"]') as HTMLButtonElement | null;
                c?.click();
            }
            renderBody(body);
            return;
        }

        // Workspace header toggle takes precedence over row click.
        const toggle = target.closest('[data-ws-toggle]') as HTMLElement | null;
        if (toggle) {
            const wsId = toggle.getAttribute('data-ws-toggle') ?? '';
            if (!wsId) return;
            if (state.collapsed.has(wsId)) state.collapsed.delete(wsId);
            else state.collapsed.add(wsId);
            saveCollapsedState();
            renderBody(body);
            return;
        }

        const row = target.closest('[data-open-url]') as HTMLElement | null;
        if (!row) return;
        const url = row.getAttribute('data-open-url') ?? '';
        if (!url) return;
        try { window.open(url, '_blank', 'noopener'); }
        catch (err) { log('Projects: open tab failed: ' + String(err), 'warn'); }
    });
}

// ── Rendering ──

function renderEmpty(text: string): string {
    return '<div style="color:' + cPanelFgDim + ';font-size:11px;padding:6px;">' + escapeHtml(text) + '</div>';
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function renderAll(blocks: ReadonlyArray<WorkspaceBlock>, tabIndex: OpenTabIndex, capturedAt: string | null, query: string): string {
    const q = (query || '').trim().toLowerCase();
    const onlyOpen = state.filterOpenOnly;
    const onlyRepo = state.filterHasRepo;
    const filterActive = q !== '' || onlyOpen || onlyRepo;

    const filtered: WorkspaceBlock[] = filterActive
        ? blocks.map(function (b) {
            if (!b.projects) return b;
            const projects = b.projects.filter(function (p) {
                if (q && !(
                    p.name.toLowerCase().includes(q)
                    || p.id.toLowerCase().includes(q)
                    || p.githubRepo.toLowerCase().includes(q)
                    || p.githubBranch.toLowerCase().includes(q)
                )) return false;
                if (onlyOpen && !isOpen(p.id, tabIndex)) return false;
                if (onlyRepo && !p.githubRepo) return false;
                return true;
            });
            return { ws: b.ws, projects, error: b.error, loading: b.loading };
        })
        : blocks.slice();

    const totalOpen = tabIndex.byProjectId.size + tabIndex.byUrlProjectId.size;
    const matchCount = filterActive
        ? filtered.reduce(function (acc, b) { return acc + (b.projects?.length ?? 0); }, 0)
        : 0;
    let html = '<div style="font-size:10px;color:#94a3b8;padding:0 0 6px 0;">'
        + blocks.length + ' workspace' + (blocks.length === 1 ? '' : 's')
        + ' · ' + totalOpen + ' open project tab' + (totalOpen === 1 ? '' : 's')
        + (filterActive ? ' · <span style="color:#fbbf24;">' + matchCount + ' match' + (matchCount === 1 ? '' : 'es') + '</span>' : '')
        + (capturedAt ? ' · ' + escapeHtml(capturedAt) : '')
        + '</div>';
    let visibleBlocks = 0;
    for (const b of filtered) {
        // Hide workspace block entirely when filter is active and yields no projects.
        if (filterActive && (b.projects?.length ?? 0) === 0 && !b.loading && !b.error) continue;
        html += renderBlock(b, tabIndex);
        visibleBlocks++;
    }
    if (filterActive && matchCount === 0 && visibleBlocks === 0) {
        const activeChips: string[] = [];
        if (q) activeChips.push('search "' + escapeHtml(q) + '"');
        if (onlyOpen) activeChips.push('open-in-tab');
        if (onlyRepo) activeChips.push('has-repo');
        html += '<div style="text-align:center;padding:24px 12px;color:' + cPanelFgDim + ';font-size:11px;'
            + 'border:1px dashed rgba(124,58,237,0.35);border-radius:6px;margin-top:4px;">'
            + '<div style="font-size:22px;margin-bottom:6px;opacity:0.6;">🔍</div>'
            + '<div style="color:#cbd5e1;margin-bottom:6px;">No projects match your filters.</div>'
            + '<div style="font-size:10px;margin-bottom:10px;">Active: ' + activeChips.join(' · ') + '</div>'
            + '<button data-clear-filters="1" type="button" '
            +   'style="background:rgba(124,58,237,0.25);border:1px solid ' + cPrimary + ';color:#e9d5ff;'
            +   'padding:4px 12px;border-radius:4px;cursor:pointer;font-size:10px;font-family:monospace;">'
            +   'Clear all filters</button>'
            + '</div>';
    }
    return html;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function renderBlock(b: WorkspaceBlock, tabIndex: OpenTabIndex): string {
    const wsName = b.ws.fullName || b.ws.name || b.ws.id;
    const openCount = b.projects
        ? b.projects.filter(function (p) { return isOpen(p.id, tabIndex); }).length
        : 0;
    const headerSuffix = b.loading
        ? '<span style="color:#64748b;font-weight:400;"> (loading…)</span>'
        : b.error
            ? '<span style="color:#fca5a5;font-weight:400;" title="' + escapeHtml(b.error) + '"> (error)</span>'
            : '<span style="color:#64748b;font-weight:400;"> (' + (b.projects?.length ?? 0) + ')</span>'
              + (openCount > 0 ? ' <span style="color:#fbbf24;font-weight:400;">· ' + openCount + ' open</span>' : '');

    let body = '';
    if (b.loading) {
        body = '<div style="color:#64748b;font-size:10px;padding:3px 4px;font-style:italic;">Fetching projects…</div>';
    } else if (b.error) {
        body = '<div style="color:#fca5a5;font-size:10px;padding:4px 6px;background:rgba(239,68,68,0.08);'
            + 'border-left:2px solid #ef4444;border-radius:2px;">'
            + '<div style="margin-bottom:2px;">⚠ Failed to load projects.</div>'
            + '<div style="color:#cbd5e1;opacity:0.8;font-family:monospace;word-break:break-word;">'
            + escapeHtml(b.error) + '</div>'
            + '<div style="color:#94a3b8;margin-top:3px;font-style:italic;">Click ↻ Refresh to retry.</div>'
            + '</div>';
    } else if ((b.projects?.length ?? 0) === 0) {
        body = '<div style="color:#64748b;font-size:10px;padding:3px 4px;font-style:italic;">'
            + 'No projects in this workspace yet.</div>';
    } else {
        // Show open ones first.
        const open = (b.projects ?? []).filter(function (p) { return isOpen(p.id, tabIndex); });
        const closed = (b.projects ?? []).filter(function (p) { return !isOpen(p.id, tabIndex); });
        for (const p of open) body += renderProjectRow(p, tabIndex, true);
        for (const p of closed) body += renderProjectRow(p, tabIndex, false);
    }

    const collapsed = state.collapsed.has(b.ws.id);
    const caret = collapsed ? '▸' : '▾';
    return '<div style="margin-bottom:8px;">'
        + '<div data-ws-toggle="' + escapeHtml(b.ws.id) + '" '
        +   'style="font-size:10px;color:' + cPrimaryLighter + ';font-weight:700;text-transform:uppercase;'
        +   'letter-spacing:0.5px;padding:2px 4px;border-bottom:1px solid rgba(124,58,237,0.3);'
        +   'margin-bottom:2px;cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;" '
        +   'title="Click to ' + (collapsed ? 'expand' : 'collapse') + '">'
        +   '<span style="display:inline-block;width:10px;color:#94a3b8;">' + caret + '</span>'
        +   '<span style="flex:1;">' + escapeHtml(wsName) + headerSuffix + '</span>'
        + '</div>'
        + (collapsed ? '' : body)
        + '</div>';
}

function renderProjectRow(p: ProjectEntry, tabIndex: OpenTabIndex, isOpenFlag: boolean): string {
    const tab = isOpenFlag
        ? (tabIndex.byProjectId.get(p.id) ?? tabIndex.byUrlProjectId.get(p.id) ?? null)
        : null;
    const url = tab?.url ?? ('https://lovable.dev/projects/' + p.id);
    const dot = isOpenFlag
        ? '<span style="color:#10b981;margin-right:4px;" title="Open in Chrome">●</span>'
        : '<span style="margin-right:4px;color:#334155;">○</span>';
    const nameColor = isOpenFlag ? '#67e8f9' : '#cbd5e1';
    const fontWeight = isOpenFlag ? '700' : '400';
    const bg = isOpenFlag ? 'background:rgba(16,185,129,0.08);' : '';
    const idLabel = '<span style="color:#64748b;font-size:9px;">' + escapeHtml(p.id) + '</span>';
    const repoBadge = p.githubRepo
        ? ('<span title="' + escapeHtml(p.githubRepo + (p.githubBranch ? '@' + p.githubBranch : ''))
            + '" style="display:inline-flex;align-items:center;gap:2px;padding:1px 5px;border-radius:8px;'
            + 'background:rgba(124,58,237,0.18);color:#c4b5fd;font-size:9px;max-width:140px;overflow:hidden;'
            + 'text-overflow:ellipsis;white-space:nowrap;">⎇ ' + escapeHtml(shortRepo(p.githubRepo))
            + (p.githubBranch ? ':' + escapeHtml(p.githubBranch) : '') + '</span>')
        : '';
    const openIcon = '<span data-open-url="' + escapeHtml(url) + '" '
        + 'title="Open in new tab" '
        + 'style="color:' + (isOpenFlag ? '#10b981' : '#64748b') + ';font-size:12px;padding:0 4px;cursor:pointer;'
        + 'border-radius:3px;" '
        + 'onmouseover="this.style.background=\'rgba(124,58,237,0.25)\';this.style.color=\'#a78bfa\'" '
        + 'onmouseout="this.style.background=\'transparent\';this.style.color=\''
        + (isOpenFlag ? '#10b981' : '#64748b') + '\'">↗</span>';
    return ''
        + '<div data-open-url="' + escapeHtml(url) + '" '
        +   'title="' + escapeHtml(p.name) + (isOpenFlag ? '\n(open in Chrome)' : '') + '\nClick to open" '
        +   'style="display:flex;align-items:center;gap:6px;padding:3px 4px;cursor:pointer;border-radius:3px;font-size:11px;font-family:monospace;' + bg + '" '
        +   'onmouseover="this.style.background=\'rgba(124,58,237,0.15)\'" '
        +   'onmouseout="this.style.background=\'' + (isOpenFlag ? 'rgba(16,185,129,0.08)' : 'transparent') + '\'">'
        +   dot
        +   '<span style="color:' + nameColor + ';font-weight:' + fontWeight + ';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(p.name) + '</span>'
        +   repoBadge
        +   idLabel
        +   openIcon
        + '</div>';
}

function shortRepo(full: string): string {
    const slash = full.lastIndexOf('/');
    return slash >= 0 ? full.slice(slash + 1) : full;
}

function isOpen(projectId: string, tabIndex: OpenTabIndex): boolean {
    return tabIndex.byProjectId.has(projectId) || tabIndex.byUrlProjectId.has(projectId);
}

function extractProjectIdFromUrl(url: string): string | null {
    try {
        const m = /\/projects\/([^/?#]+)/.exec(new URL(url).pathname);
        return m ? m[1] : null;
    } catch { return null; }
}

// ── Shell / chrome ──

function createPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.id = DIALOG_ID;
    panel.style.cssText =
        'position:fixed;top:80px;right:40px;z-index:100002;background:' + cPanelBg
        + ';border:1px solid ' + cPrimary
        + ';border-radius:8px;padding:0;min-width:480px;max-width:640px;'
        + 'box-shadow:0 8px 32px rgba(0,0,0,.6);font-family:monospace;resize:both;overflow:hidden;';
    return panel;
}

function createTitleBar(panel: HTMLElement): HTMLElement {
    const bar = document.createElement('div');
    bar.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:' + cPrimaryBgA
        + ';cursor:grab;user-select:none;border-bottom:1px solid rgba(124,58,237,0.3);';
    const title = document.createElement('span');
    title.style.cssText = 'font-size:11px;color:' + cPrimaryLighter + ';font-weight:700;';
    title.textContent = '📂 Projects — by Workspace';
    const closeBtn = document.createElement('span');
    closeBtn.style.cssText = 'cursor:pointer;color:#94a3b8;font-size:14px;padding:0 4px;';
    closeBtn.textContent = '✕';
    closeBtn.onclick = function (): void { removeProjectsModal(); };
    bar.appendChild(title);
    bar.appendChild(closeBtn);
    attachDrag(panel, bar, closeBtn);
    return bar;
}

/**
 * Search bar — filters projects by name / id / repo / branch as the user
 * types. Calls `onChange` on every input event so the body re-renders
 * against the current `state.searchQuery`.
 */
// eslint-disable-next-line max-lines-per-function
function createSearchBar(onChange: () => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:6px 10px;border-bottom:1px solid rgba(124,58,237,0.20);background:rgba(0,0,0,0.20);display:flex;flex-direction:column;gap:6px;';

    // Row 1: search input.
    const row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const icon = document.createElement('span');
    icon.textContent = '🔍';
    icon.style.cssText = 'font-size:11px;opacity:0.8;';

    const input = document.createElement('input');
    input.setAttribute('data-search-input', '1');
    input.type = 'search';
    input.placeholder = 'Search projects by name, repo, branch, or id…';
    input.value = state.searchQuery;
    input.style.cssText =
        'flex:1;background:rgba(0,0,0,0.35);color:#f1f5f9;border:1px solid rgba(124,58,237,0.30);'
        + 'border-radius:4px;padding:4px 8px;font-size:11px;font-family:inherit;outline:none;';
    input.addEventListener('input', function () {
        state.searchQuery = input.value;
        onChange();
    });
    input.addEventListener('keydown', function (e) { e.stopPropagation(); });

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = '✕';
    clear.title = 'Clear search';
    clear.style.cssText = 'background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:12px;padding:2px 6px;';
    clear.onclick = function (): void {
        input.value = '';
        state.searchQuery = '';
        onChange();
        input.focus();
    };

    row1.appendChild(icon);
    row1.appendChild(input);
    row1.appendChild(clear);

    // Row 2: filter chips.
    const row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10px;';

    function makeChip(label: string, title: string, getActive: () => boolean, toggle: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = title;
        function paint(): void {
            const active = getActive();
            btn.textContent = (active ? '● ' : '○ ') + label;
            btn.style.cssText =
                'border-radius:10px;padding:2px 10px;font-size:10px;cursor:pointer;font-family:inherit;'
                + (active
                    ? 'background:rgba(251,191,36,0.20);color:#fbbf24;border:1px solid rgba(251,191,36,0.50);'
                    : 'background:rgba(15,23,42,0.40);color:#94a3b8;border:1px solid rgba(124,58,237,0.30);');
        }
        btn.onclick = function (): void { toggle(); paint(); onChange(); };
        paint();
        return btn;
    }

    const chipOpen = makeChip(
        'Open in tab', 'Show only projects whose tab is currently open in Chrome',
        function () { return state.filterOpenOnly; },
        function () { state.filterOpenOnly = !state.filterOpenOnly; },
    );
    chipOpen.setAttribute('data-chip', 'open');
    const chipRepo = makeChip(
        'Has repo', 'Show only projects with a GitHub repo configured',
        function () { return state.filterHasRepo; },
        function () { state.filterHasRepo = !state.filterHasRepo; },
    );
    chipRepo.setAttribute('data-chip', 'repo');

    const chipsLabel = document.createElement('span');
    chipsLabel.textContent = 'Filter:';
    chipsLabel.style.cssText = 'color:#64748b;';

    row2.appendChild(chipsLabel);
    row2.appendChild(chipOpen);
    row2.appendChild(chipRepo);

    wrap.appendChild(row1);
    wrap.appendChild(row2);
    return wrap;
}


function createFooter(
    onRefresh: () => void,
    onExport: (statusEl: HTMLElement) => void,
): HTMLElement {
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:6px 10px;border-top:1px solid rgba(124,58,237,0.3);display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;';

    const legend = document.createElement('span');
    legend.style.cssText = 'font-size:9px;color:#64748b;flex:1;min-width:120px;';
    legend.innerHTML = '<span style="color:#10b981;">●</span> open in Chrome &nbsp; <span style="color:#334155;">○</span> closed';

    const status = document.createElement('span');
    status.id = 'marco-projects-export-status';
    status.style.cssText = 'font-size:9px;color:#94a3b8;flex-basis:100%;order:3;min-height:11px;';
    status.textContent = '';

    const actions = document.createElement('span');
    actions.style.cssText = 'display:flex;gap:6px;';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.id = 'marco-projects-export-btn';
    exportBtn.textContent = '⬇ Export CSV';
    exportBtn.title = 'Export all loaded projects to CSV with workspace, credits, GitHub repo + branch, version, and last activity';
    exportBtn.style.cssText = 'padding:3px 10px;background:#1e3a5f;color:#cbd5e1;border:1px solid #3b6fa0;border-radius:3px;font-size:10px;cursor:pointer;';
    exportBtn.onclick = function (): void { onExport(status); };

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = '⟳ Refresh';
    refresh.style.cssText = 'padding:3px 10px;background:#1e3a5f;color:#cbd5e1;border:1px solid #3b6fa0;border-radius:3px;font-size:10px;cursor:pointer;';
    refresh.onclick = function (): void { onRefresh(); };

    actions.appendChild(exportBtn);
    actions.appendChild(refresh);

    footer.appendChild(legend);
    footer.appendChild(actions);
    footer.appendChild(status);
    return footer;
}

function attachDrag(panel: HTMLElement, bar: HTMLElement, closeBtn: HTMLElement): void {
    let dragging = false, offX = 0, offY = 0;
    const onDown = function (e: MouseEvent): void {
        if (e.target === closeBtn) return;
        dragging = true;
        const r = panel.getBoundingClientRect();
        offX = e.clientX - r.left; offY = e.clientY - r.top;
        bar.style.cursor = 'grabbing';
        e.preventDefault();
    };
    const onMove = function (e: MouseEvent): void {
        if (!dragging) return;
        panel.style.left = (e.clientX - offX) + 'px';
        panel.style.top = (e.clientY - offY) + 'px';
        panel.style.right = 'auto';
    };
    const onUp = function (): void { dragging = false; bar.style.cursor = 'grab'; };
    bar.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    (panel as DraggableElement).__cleanupDrag = function (): void {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── CSV Export ──

interface ExportRow {
    workspaceId: string;
    workspaceName: string;
    creditsUsed: number;
    creditsTotal: number;
    projectId: string;
    projectName: string;
    isOpenInChrome: string;
    gitRepo: string;
    gitBranch: string;
    lastCommunication: string;
    extensionVersion: string;
    exportedAt: string;
}

const EXPORT_HEADERS: ReadonlyArray<keyof ExportRow> = [
    'workspaceId', 'workspaceName', 'creditsUsed', 'creditsTotal',
    'projectId', 'projectName', 'isOpenInChrome',
    'gitRepo', 'gitBranch', 'lastCommunication',
    'extensionVersion', 'exportedAt',
];

/**
 * Build CSV synchronously from the already-loaded ProjectEntry list.
 *
 * Per Q52 (`.lovable/question-and-ambiguity/52-projects-get-405.md`), we no
 * longer call `projects.get` per project — the server returns 405 on the
 * bare `GET /projects/{id}` route. All git metadata is read directly from
 * the `projects.list` response (which the dashboard itself renders from).
 * Missing fields become blank cells; no per-project errors.
 */
function exportCsv(statusEl: HTMLElement): void {
    if (state.exporting) return;

    const blocks = state.blocks;
    const tabIndex = state.tabIndex;
    if (blocks.length === 0 || !tabIndex) {
        statusEl.style.color = '#fca5a5';
        statusEl.textContent = '⚠ No workspaces loaded yet — wait for the list to populate.';
        return;
    }

    const tasks: Array<{ ws: WorkspaceCredit; project: ProjectEntry }> = [];
    for (const b of blocks) {
        if (!b.projects) continue;
        for (const p of b.projects) tasks.push({ ws: b.ws, project: p });
    }

    if (tasks.length === 0) {
        statusEl.style.color = '#fca5a5';
        statusEl.textContent = '⚠ No projects to export.';
        return;
    }

    state.exporting = true;
    setExportButtonDisabled(true);
    statusEl.style.color = '#94a3b8';
    statusEl.textContent = 'Building CSV…';

    const exportedAt = new Date().toISOString();
    const rows: ExportRow[] = tasks.map(function (task) {
        return {
            workspaceId: task.ws.id,
            workspaceName: task.ws.fullName || task.ws.name || task.ws.id,
            creditsUsed: task.ws.totalCreditsUsed ?? task.ws.used ?? 0,
            creditsTotal: task.ws.totalCredits ?? task.ws.limit ?? 0,
            projectId: task.project.id,
            projectName: task.project.name,
            isOpenInChrome: isOpen(task.project.id, tabIndex) ? 'yes' : 'no',
            gitRepo: task.project.githubRepo,
            gitBranch: task.project.githubBranch,
            lastCommunication: task.project.lastMessageAt,
            extensionVersion: VERSION,
            exportedAt,
        };
    });

    const csv = buildCsv(rows);
    const filename = 'marco-projects-' + exportedAt.replace(/[:.]/g, '-') + '.csv';
    downloadCsv(filename, csv);

    state.exporting = false;
    setExportButtonDisabled(false);
    statusEl.style.color = '#10b981';
    statusEl.textContent = '✓ Exported ' + rows.length + ' project'
        + (rows.length === 1 ? '' : 's') + ' → ' + filename;
    log('Projects: CSV export complete (' + rows.length + ' rows)', 'info');
}

function pickString(obj: Record<string, unknown>, keys: ReadonlyArray<string>): string {
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string' && v.length > 0) return v;
    }
    return '';
}


function buildCsv(rows: ReadonlyArray<ExportRow>): string {
    const lines: string[] = [];
    lines.push(EXPORT_HEADERS.map(escapeCsv).join(','));
    for (const row of rows) {
        lines.push(EXPORT_HEADERS.map(function (h) { return escapeCsv(String(row[h] ?? '')); }).join(','));
    }
    return lines.join('\r\n') + '\r\n';
}

function escapeCsv(value: string): string {
    if (value === '' || !/[",\r\n]/.test(value)) return value;
    return '"' + value.replace(/"/g, '""') + '"';
}

function downloadCsv(filename: string, csv: string): void {
    try {
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (err) {
        logError('Projects', 'CSV download failed: ' + String(err));
    }
}

function setExportButtonDisabled(disabled: boolean): void {
    const btn = document.getElementById('marco-projects-export-btn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = disabled;
    btn.style.opacity = disabled ? '0.5' : '1';
    btn.style.cursor = disabled ? 'wait' : 'pointer';
    btn.textContent = disabled ? '⏳ Exporting…' : '⬇ Export CSV';
}