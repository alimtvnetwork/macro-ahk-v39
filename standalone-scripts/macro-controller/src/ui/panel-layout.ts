 
/**
 * MacroLoop Controller — Panel Layout & Drag/Resize
 * Step 03: Extracted from createUI() closure
 *
 * All functions receive a PanelLayoutCtx to avoid closure coupling.
 */

import { log, logSub } from '../logging';
import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_HEIGHT } from '../shared-state';

// ============================================
// LocalStorage keys for panel state persistence
// See: spec/22-app-issues/63-button-layout-collapse-reload.md
// ============================================
import { PANEL_EDGE_MARGIN, PANEL_MIN_VISIBLE_HEIGHT, PANEL_MIN_VISIBLE_WIDTH, DEFAULT_BACKDROP_OPACITY } from '../constants';
import { DomId, StorageKey } from '../types';
function savePanelState(state: string): void {
  try { localStorage.setItem(StorageKey.PanelState, state); } catch (_e) { logSub('Failed to save panel state: ' + (_e instanceof Error ? _e.message : String(_e)), 1); }
}

function loadPanelState(): string {
  try { return localStorage.getItem(StorageKey.PanelState) || 'expanded'; } catch (_e) { logSub('Failed to load panel state: ' + (_e instanceof Error ? _e.message : String(_e)), 1); return 'expanded'; }
}

interface PanelGeometry {
  top: string;
  left: string;
  width: string;
  height: string;
}

function savePanelGeometry(ui: HTMLElement): void {
  try {
    const geo: PanelGeometry = {
      top: ui.style.top || '',
      left: ui.style.left || '',
      width: ui.style.width || '',
      height: ui.style.height || '',
    };
    localStorage.setItem(StorageKey.PanelGeometry, JSON.stringify(geo));
  } catch (_e) { logSub('Failed to save panel geometry: ' + (_e instanceof Error ? _e.message : String(_e)), 1); }
}

// v2.196.0: Exported so panel-builder can seed expandedHeight when the panel
// reloads in minimized state. Without that seed, clicking [+] to expand
// restores ui.style.height = '' (empty), the browser collapses to content
// height, and the button row renders with no spacing — the long-standing
// "buttons crammed left after reload-while-minimized" bug from spec 63.
export function loadPanelGeometry(): PanelGeometry | null {
  try {
    const raw = localStorage.getItem(StorageKey.PanelGeometry);
    if (!raw) return null;
    return JSON.parse(raw) as PanelGeometry;
  } catch (_e) { logSub('Failed to parse panel geometry: ' + (_e instanceof Error ? _e.message : String(_e)), 1); return null; }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function keepPanelInViewport(ctx: PanelLayoutCtx): void {
  const vw = Math.max(window.innerWidth || 0, 320);
  const vh = Math.max(window.innerHeight || 0, 240);

  // Keep width/height visible in current viewport.
  const rectBefore = ctx.ui.getBoundingClientRect();
  const maxWidth = Math.max(PANEL_MIN_VISIBLE_WIDTH, vw - PANEL_EDGE_MARGIN * 2);
  const maxHeight = Math.max(PANEL_MIN_VISIBLE_HEIGHT, vh - PANEL_EDGE_MARGIN * 2);

  if (rectBefore.width > maxWidth) {
    ctx.ui.style.width = maxWidth + 'px';
  }
  if (rectBefore.height > maxHeight) {
    ctx.ui.style.height = maxHeight + 'px';
    ctx.ui.style.maxHeight = maxHeight + 'px';
    ctx.ui.style.overflowY = 'auto';
  } else if (!ctx.isResizing) {
    ctx.ui.style.maxHeight = '';
    ctx.ui.style.overflowY = '';
  }

  const rect = ctx.ui.getBoundingClientRect();
  const minLeft = PANEL_EDGE_MARGIN;
  const minTop = PANEL_EDGE_MARGIN;
  const maxLeft = Math.max(minLeft, vw - rect.width - PANEL_EDGE_MARGIN);
  const maxTop = Math.max(minTop, vh - rect.height - PANEL_EDGE_MARGIN);

  const nextLeft = clamp(rect.left, minLeft, maxLeft);
  const nextTop = clamp(rect.top, minTop, maxTop);

  ctx.ui.style.left = nextLeft + 'px';
  ctx.ui.style.top = nextTop + 'px';
  ctx.ui.style.right = 'auto';
  ctx.ui.style.bottom = 'auto';
}

/** Mutable state shared between panel layout functions */
export interface PanelLayoutCtx {
  ui: HTMLElement;
  isFloating: boolean;
  isDragging: boolean;
  dragOffsetX: number;
  dragOffsetY: number;
  dragStartPos: { x: number; y: number };
  dragPointerId: number | null;
  isResizing: boolean;
  resizeType: string;
  resizeStartX: number;
  resizeStartY: number;
  resizeStartW: number;
  resizeStartH: number;
  resizePointerId: number | null;
  panelState: string;
  bodyElements: HTMLElement[];
  panelToggleSpan: HTMLElement | null;
  expandedHeight: string;
  expandedMaxHeight: string;
  expandedOverflow: string;
  expandedOverflowY: string;
  // Theme tokens
  floatW: string;
  floatSh: string;
  cPrimary: string;
}

export function createPanelLayoutCtx(ui: HTMLElement, floatW: string, floatSh: string, cPrimary: string): PanelLayoutCtx {
  return {
    ui,
    isFloating: false,
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragStartPos: { x: 0, y: 0 },
    dragPointerId: null,
    isResizing: false,
    resizeType: '',
    resizeStartX: 0,
    resizeStartY: 0,
    resizeStartW: 0,
    resizeStartH: 0,
    resizePointerId: null,
    panelState: loadPanelState(),
    bodyElements: [],
    panelToggleSpan: null,
    expandedHeight: '',
    expandedMaxHeight: '',
    expandedOverflow: '',
    expandedOverflowY: '',
    floatW,
    floatSh,
    cPrimary,
  };
}

const BACKDROP_ID = DomId.PanelBackdrop;

export function getBackdropOpacity(): number {
  return DEFAULT_BACKDROP_OPACITY;
}

export function setBackdropOpacity(opacity: number): void {
  const clamped = Math.min(1, Math.max(0, opacity));
  try { localStorage.setItem(StorageKey.BackdropOpacity, String(clamped)); } catch (_e) { logSub('Failed to save backdrop opacity: ' + (_e instanceof Error ? _e.message : String(_e)), 1); }
  const backdrop = document.getElementById(BACKDROP_ID);
  if (!backdrop) return;
  if (clamped === 0) {
    backdrop.remove();
    return;
  }
  backdrop.style.background = 'rgba(0,0,0,' + clamped + ')';
}

export function enableFloating(ctx: PanelLayoutCtx) {
  if (ctx.isFloating) return;
  log('Switching MacroLoop panel to floating mode', 'info');
  ctx.isFloating = true;

  const opacity = getBackdropOpacity();
  if (opacity === 0) {
    const existingBackdrop = document.getElementById(BACKDROP_ID);
    if (existingBackdrop) existingBackdrop.remove();
  } else if (!document.getElementById(BACKDROP_ID)) {
    const backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,' + opacity + ');z-index:99996;pointer-events:none;';
    document.body.appendChild(backdrop);
  }

  ctx.ui.style.position = 'fixed';
  ctx.ui.style.zIndex = '99997';
  ctx.ui.style.margin = '0';
  ctx.ui.style.boxShadow = ctx.floatSh;

  // Restore saved geometry or use defaults
  const geo = loadPanelGeometry();
  if (geo && geo.top && geo.left) {
    ctx.ui.style.top = geo.top;
    ctx.ui.style.left = geo.left;
    ctx.ui.style.right = 'auto';
    ctx.ui.style.bottom = 'auto';
    if (geo.width) ctx.ui.style.width = geo.width;
    if (geo.height) ctx.ui.style.height = geo.height;
    log('Restored panel geometry from localStorage', 'info');
  } else {
    ctx.ui.style.width = PANEL_DEFAULT_WIDTH + 'px';
    ctx.ui.style.height = PANEL_DEFAULT_HEIGHT + 'px';
    ctx.ui.style.top = '80px';
    ctx.ui.style.left = '20px';
  }

  keepPanelInViewport(ctx);
}

/**
 * Disable floating mode — transition panel from fixed-position back to
 * inline flow inside a parent container. Used by the re-dock observer
 * when the XPath target appears after the panel was mounted to body.
 */
export function disableFloating(ctx: PanelLayoutCtx): void {
  if (!ctx.isFloating) return;
  log('Switching MacroLoop panel from floating to docked mode', 'info');
  ctx.isFloating = false;

  // Remove backdrop when docking
  const backdrop = document.getElementById('marco-panel-backdrop');
  if (backdrop) backdrop.remove();
  ctx.ui.style.position = 'relative';
  ctx.ui.style.zIndex = '';
  ctx.ui.style.margin = '8px 0';
  ctx.ui.style.boxShadow = '';
  ctx.ui.style.top = '';
  ctx.ui.style.left = '';
  ctx.ui.style.right = '';
  ctx.ui.style.bottom = '';
  ctx.ui.style.width = '';
  ctx.ui.style.height = '';
}

export function positionLoopController(ctx: PanelLayoutCtx, position: string) {
  enableFloating(ctx);
  const margin = 20;
  if (position === 'bottom-left') {
    ctx.ui.style.left = margin + 'px';
    ctx.ui.style.right = 'auto';
    ctx.ui.style.top = 'auto';
    ctx.ui.style.bottom = margin + 'px';
  } else if (position === 'bottom-right') {
    ctx.ui.style.left = 'auto';
    ctx.ui.style.right = margin + 'px';
    ctx.ui.style.top = 'auto';
    ctx.ui.style.bottom = margin + 'px';
  }
  log('Moved MacroLoop to ' + position, 'info');
}

export function startDragHandler(ctx: PanelLayoutCtx, e: PointerEvent) {
  ctx.isDragging = true;
  ctx.dragPointerId = e.pointerId;
  const rect = ctx.ui.getBoundingClientRect();
  ctx.dragOffsetX = e.clientX - rect.left;
  ctx.dragOffsetY = e.clientY - rect.top;
  ctx.dragStartPos.x = e.clientX;
  ctx.dragStartPos.y = e.clientY;
  enableFloating(ctx);
  if ((e.target as HTMLElement).setPointerCapture && ctx.dragPointerId != null) {
    (e.target as HTMLElement).setPointerCapture(ctx.dragPointerId);
  }
  e.preventDefault();
}

export function setupDragListeners(ctx: PanelLayoutCtx) {
  window.addEventListener('resize', function() {
    if (!ctx.isFloating) return;
    keepPanelInViewport(ctx);
    savePanelGeometry(ctx.ui);
  });

  document.addEventListener('pointermove', function(e) {
    if (!ctx.isDragging) return;
    ctx.ui.style.left = (e.clientX - ctx.dragOffsetX) + 'px';
    ctx.ui.style.top = (e.clientY - ctx.dragOffsetY) + 'px';
    ctx.ui.style.right = 'auto';
    ctx.ui.style.bottom = 'auto';
    keepPanelInViewport(ctx);
    e.preventDefault();
  });

  document.addEventListener('pointerup', function(e) {
    if (!ctx.isDragging) return;
    ctx.isDragging = false;
    if ((e.target as HTMLElement).releasePointerCapture && ctx.dragPointerId != null) {
      try { (e.target as HTMLElement).releasePointerCapture(ctx.dragPointerId); } catch (ex) { logSub('releasePointerCapture (drag) failed: ' + (ex instanceof Error ? ex.message : String(ex)), 1); }
    }
    ctx.dragPointerId = null;
    keepPanelInViewport(ctx);
    // Persist geometry after drag
    savePanelGeometry(ctx.ui);
  });
}

export function applyResizeResponsiveLayout(ctx: PanelLayoutCtx, panelHeight: number) {
  const extra = Math.max(0, panelHeight - ctx.resizeStartH);
  const wsListEl = document.getElementById('loop-ws-list');
  if (wsListEl) wsListEl.style.maxHeight = (160 + Math.floor(extra * 0.75)) + 'px';

  const activityPanelEl = document.getElementById('loop-activity-log-panel');
  if (activityPanelEl) activityPanelEl.style.maxHeight = (120 + Math.floor(extra * 0.35)) + 'px';

  const wsHistoryPanelEl = document.getElementById('loop-ws-history-panel');
  if (wsHistoryPanelEl) wsHistoryPanelEl.style.maxHeight = (120 + Math.floor(extra * 0.35)) + 'px';

  const jsHistoryEl = document.getElementById('loop-js-history');
  if (jsHistoryEl) jsHistoryEl.style.maxHeight = (80 + Math.floor(extra * 0.25)) + 'px';
}

export function createResizeHandle(ctx: PanelLayoutCtx, type: string): HTMLElement {
  const handle = document.createElement('div');
  if (type === 'corner') {
    handle.style.cssText = 'position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:99999;display:flex;align-items:center;justify-content:center;';
    const grip = document.createElement('div');
    grip.style.cssText = 'width:10px;height:10px;opacity:0.4;transition:opacity .2s;';
    grip.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10"><circle cx="7" cy="3" r="1" fill="#ae7ce8"/><circle cx="3" cy="7" r="1" fill="#ae7ce8"/><circle cx="7" cy="7" r="1" fill="#ae7ce8"/></svg>';
    handle.appendChild(grip);
    handle.onmouseenter = function() { grip.style.opacity = '0.9'; };
    handle.onmouseleave = function() { grip.style.opacity = '0.4'; };
  } else {
    handle.style.cssText = 'position:absolute;left:12px;right:12px;bottom:0;height:6px;cursor:ns-resize;z-index:99998;';
    const bar = document.createElement('div');
    bar.style.cssText = 'width:40px;height:3px;background:' + ctx.cPrimary + ';border-radius:2px;margin:2px auto 0;opacity:0.3;transition:opacity .2s;';
    handle.appendChild(bar);
    handle.onmouseenter = function() { bar.style.opacity = '0.8'; };
    handle.onmouseleave = function() { bar.style.opacity = '0.3'; };
  }

  handle.addEventListener('pointerdown', function(e) {
    e.stopPropagation();
    e.preventDefault();
    ctx.isResizing = true;
    ctx.resizeType = type;
    ctx.resizePointerId = e.pointerId;

    const rect = ctx.ui.getBoundingClientRect();
    ctx.resizeStartX = e.clientX;
    ctx.resizeStartY = e.clientY;
    ctx.resizeStartW = rect.width;
    ctx.resizeStartH = rect.height;

    enableFloating(ctx);

    ctx.ui.style.left = rect.left + 'px';
    ctx.ui.style.top = rect.top + 'px';
    ctx.ui.style.right = 'auto';
    ctx.ui.style.bottom = 'auto';
    ctx.ui.style.width = rect.width + 'px';
    ctx.ui.style.height = rect.height + 'px';

    if ('setPointerCapture' in handle && ctx.resizePointerId != null) {
      (handle as HTMLElement).setPointerCapture(ctx.resizePointerId);
    }
  });

  return handle;
}

export function setupResizeListeners(ctx: PanelLayoutCtx) {
  document.addEventListener('pointermove', function(e) {
    if (!ctx.isResizing) return;
    e.preventDefault();

    const dx = e.clientX - ctx.resizeStartX;
    const dy = e.clientY - ctx.resizeStartY;

    if (ctx.resizeType === 'corner') {
      const newW = Math.max(420, ctx.resizeStartW + dx);
      const newH = Math.max(200, ctx.resizeStartH + dy);
      ctx.ui.style.width = newW + 'px';
      ctx.ui.style.height = newH + 'px';
      ctx.ui.style.overflow = 'hidden';
      applyResizeResponsiveLayout(ctx, newH);
      keepPanelInViewport(ctx);
    } else {
      const newH2 = Math.max(200, ctx.resizeStartH + dy);
      ctx.ui.style.height = newH2 + 'px';
      ctx.ui.style.overflow = 'hidden';
      applyResizeResponsiveLayout(ctx, newH2);
      keepPanelInViewport(ctx);
    }
  });

  document.addEventListener('pointerup', function(e) {
    if (!ctx.isResizing) return;
    ctx.isResizing = false;
    if ((e.target as HTMLElement).releasePointerCapture && ctx.resizePointerId != null) {
      try { (e.target as HTMLElement).releasePointerCapture(ctx.resizePointerId); } catch (ex) { logSub('releasePointerCapture (resize) failed: ' + (ex instanceof Error ? ex.message : String(ex)), 1); }
    }
    ctx.resizePointerId = null;
    keepPanelInViewport(ctx);
    // Persist geometry after resize
    savePanelGeometry(ctx.ui);
  });
}

// Issue 117 (v3.15.0): Stash & restore the original inline `display` per body
// element on minimize/expand. Previously `toggleMinimize` did
// `el.style.display = 'none'` then `el.style.display = ''`, which REMOVES the
// inline display property — reverting the element to its UA default (`block`
// for <div>). The button row's `display:flex` (written via cssText in
// panel-controls.ts) was wiped on every expand, killing gap/flex-wrap/
// justify-content/align-items and making buttons render flush ("squished").
// See: spec/22-app-issues/117-toolbar-button-squish/02-step2-rca-evidence.md
const PREV_DISPLAY_ATTR = 'data-macro-prev-display';

function _hideBodyElement(el: HTMLElement): void {
  if (!el.hasAttribute(PREV_DISPLAY_ATTR)) {
    el.setAttribute(PREV_DISPLAY_ATTR, el.style.display || '');
  }
  el.style.display = 'none';
}

function _showBodyElement(el: HTMLElement): void {
  const prev = el.getAttribute(PREV_DISPLAY_ATTR);
  el.style.display = prev !== null ? prev : '';
  el.removeAttribute(PREV_DISPLAY_ATTR);
}

export function toggleMinimize(ctx: PanelLayoutCtx) {
  const isExpanded = ctx.panelState === 'expanded';
  if (isExpanded) {
    log('Minimizing MacroLoop panel', 'info');

    ctx.expandedHeight = ctx.ui.style.height;
    ctx.expandedMaxHeight = ctx.ui.style.maxHeight;
    ctx.expandedOverflow = ctx.ui.style.overflow;
    ctx.expandedOverflowY = ctx.ui.style.overflowY;

    for (const el of ctx.bodyElements) {
      _hideBodyElement(el);
    }

    ctx.ui.style.height = 'auto';
    ctx.ui.style.maxHeight = '';
    ctx.ui.style.overflow = 'visible';
    ctx.ui.style.overflowY = 'visible';

    if (ctx.panelToggleSpan) { ctx.panelToggleSpan.textContent = '[ + ]'; }
    ctx.panelState = 'minimized';
  } else {
    log('Expanding MacroLoop panel', 'info');

    for (const el of ctx.bodyElements) {
      _showBodyElement(el);
    }

    ctx.ui.style.height = ctx.expandedHeight;
    ctx.ui.style.maxHeight = ctx.expandedMaxHeight;
    ctx.ui.style.overflow = ctx.expandedOverflow;
    ctx.ui.style.overflowY = ctx.expandedOverflowY;

    if (ctx.panelToggleSpan) { ctx.panelToggleSpan.textContent = '[ - ]'; }
    ctx.panelState = 'expanded';
  }
  // Persist minimize state
  savePanelState(ctx.panelState);
}

export function restorePanel(ctx: PanelLayoutCtx) {
  log('Restoring hidden MacroLoop panel', 'info');
  ctx.ui.style.display = '';

  for (const el of ctx.bodyElements) {
    _showBodyElement(el);
  }

  ctx.ui.style.height = ctx.expandedHeight;
  ctx.ui.style.maxHeight = ctx.expandedMaxHeight;
  ctx.ui.style.overflow = ctx.expandedOverflow;
  ctx.ui.style.overflowY = ctx.expandedOverflowY;

  if (ctx.panelToggleSpan) { ctx.panelToggleSpan.textContent = '[ - ]'; }
  ctx.panelState = 'expanded';
}

// Issue 117 (v3.15.0): exported so panel-builder._restoreMinimizedPanel uses
// the same stash-aware hide path. Keeps the dataset bookkeeping consistent
// across initial-load minimize and runtime toggle.
export function hideBodyElementForMinimize(el: HTMLElement): void {
  _hideBodyElement(el);
}

