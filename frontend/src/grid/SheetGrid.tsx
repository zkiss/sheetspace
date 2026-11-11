import { matchesShortcut } from '@shared/keyboard/keymap';
/* eslint-disable max-lines -- Grid owns its virtualizer, focus, and navigation-settlement lifecycle. */
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type FocusEvent, type RefObject, type SyntheticEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cellKey, parseA1Address, type CellAddress, type CellRange } from '@workbook/core/address';
import { sheetBounds } from '@workbook/read/queries';
import { type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { type SheetTabularProjection } from '@workbook/core/model';
import type { GridAxisProjection } from '@grid/gridAxisProjection';
import { createSheetGridAxisMetrics, type GridAxisMetrics } from './gridAxisMetrics';
import { gridCellReveal, gridRangeReveal } from './gridCellReveal';
import {
  GRID_COLUMN_HEADER_HEIGHT,
  GRID_CELL_HEIGHT,
  GRID_CELL_WIDTH,
  GRID_ROW_HEADER_WIDTH,
} from '@grid/gridGeometry';
import type { SelectionGesture, CellEditSession, CellSelectionMode, CellTarget } from './cellInteractionContracts';
import { cellKeyForTarget, cellTargetAt } from '@grid/cellInteraction';
import type { SheetGridCellInteraction } from './SheetGridCell';
import type { SheetGridCellEditorInteraction } from './SheetGridCellEditor';
import { useAxisGather } from './useAxisGather';
import { AxisGatherOverlay } from './AxisGatherOverlay';
import { useGridAxisMotion } from './useGridAxisMotion';
import { useAxisResize } from './useAxisResize';
import type { AxisSizeWrite, SheetPresentation } from '@workbook/core/model';
import type { CellSelection } from './cellInteractionContracts';
import { SheetGridHeaders } from '@grid/SheetGridHeaders';
import { cssRemFromPixels } from '@shared/styles/styleTokens';
import { axisIndexForDurableIndex, hasDurableIndex, mergeVirtualIndexes, parseCellAddress, pinnedAxisIndices, virtualItemsOrTestFallback } from './sheetGridProjection';
import { useGridPointerSelection } from './useGridPointerSelection';
import { SheetGridRows } from './SheetGridRows';
import { gridSelectionPresentation } from './gridSelectionPresentation';
import { ModelEntryRow, type EntryCommands } from './ModelEntryRow';
import type { DataModel } from '@workbook/core/model';
import type { EntrySessionState } from '@application/core/modelEntrySession';
import { useGridHistoryRestore } from './useGridHistoryRestore';
import { useOwnedScroll } from './useOwnedScroll';
import { isNativeEditorTarget, logicalUnitsPerRenderedPixel } from './gridScrollInput';
import { clipboardHtml, clipboardMarkerFromHtml } from './clipboardHtml';
import '@grid/SheetGrid.css';
function ensureCellVisibleOutsideStickyHeaders(
  cell: HTMLElement,
  scrollContainer: HTMLElement,
  columnHeader: HTMLElement | null,
  rowHeader: HTMLElement | null,
) {
  const cellRect = cell.getBoundingClientRect();
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  const logicalPerRenderedPixel = logicalUnitsPerRenderedPixel(scrollContainer, scrollContainerRect);
  const visibleTop = scrollContainerRect.top
    + (columnHeader?.getBoundingClientRect().height ?? GRID_COLUMN_HEADER_HEIGHT / logicalPerRenderedPixel.y);
  const visibleLeft = scrollContainerRect.left
    + (rowHeader?.getBoundingClientRect().width ?? GRID_ROW_HEADER_WIDTH / logicalPerRenderedPixel.x);
  const visibleBottom = scrollContainerRect.top + scrollContainer.clientHeight / logicalPerRenderedPixel.y;
  const visibleRight = scrollContainerRect.left + scrollContainer.clientWidth / logicalPerRenderedPixel.x;
  if (cellRect.top < visibleTop) {
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop
      - (visibleTop - cellRect.top) * logicalPerRenderedPixel.y);
  } else if (cellRect.bottom > visibleBottom) {
    scrollContainer.scrollTop += (cellRect.bottom - visibleBottom) * logicalPerRenderedPixel.y;
  }
  if (cellRect.left < visibleLeft) {
    scrollContainer.scrollLeft = Math.max(0, scrollContainer.scrollLeft
      - (visibleLeft - cellRect.left) * logicalPerRenderedPixel.x);
  } else if (cellRect.right > visibleRight) {
    scrollContainer.scrollLeft += (cellRect.right - visibleRight) * logicalPerRenderedPixel.x;
  }
}
type GridFocusIntent = {
  id: string;
  requestId?: number;
  targetKey: string;
};
type NavigationFocusIntent = {
  generation: number;
  range: CellRange;
  targetKey: string;
};
export type SheetGridAxisMetrics = {
  readonly columns: GridAxisMetrics;
  readonly rows: GridAxisMetrics;
};
export function SheetGrid({
  entryRow,
  activeCellKey,
  selectionTransition,
  activeSheetId,
  axisMetrics,
  axisProjection,
  cellInteraction,
  editorInteraction,
  editingCell,
  keyboardFocusRequest,
  onKeyboardFocusRequestConsumed,
  navigationHighlightCellKey,
  navigationHighlightRange,
  navigationHighlightIdentity,
  historyFeedbackCells,
  historyRevealCells = historyFeedbackCells,
  canRevealHistory,
  revealEnabled = true,
  requireMeasuredViewport = false,
  ownsGridRestore,
  historyFeedbackIdentity,
  historyRevealReady = true,
  onHistoryRevealConsumed,
  formulaResults,
  scrollContainerRef,
  ownedScroll,
  selectionMode,
  selectionOwner,
  sheet,
  selectedRange,
  onSelectAxis,
  clipboardInteraction,
  presentation,
  logicalSelection,
  onWriteAxisSizes,
  onGatherAxis,
  allowColumnGather = true,
  modelId,
  interactionsEnabled = true,
  onPointerInteractionChange,
  onNativeFocusTarget,
  pendingCutCells,
  columnLabels,
  calculatedColumnIds,
  onScrollContainerAvailable,
  onUserViewportMovement,
  historyRestore,
  navigationRestoreGeneration,
  navigationRequestGeneration,
  navigationRequestCellKey,
  navigationRequestRange,
  onNavigationSettled,
  onReferenceViewport,
}: {
  entryRow?: { model: DataModel; session: EntrySessionState; commands: EntryCommands; onEntryFocus?: () => void };
  presentation?: SheetPresentation;
  logicalSelection?: CellSelection | null;
  onWriteAxisSizes?: (writes: readonly AxisSizeWrite[]) => void;
  onGatherAxis?: (axis: 'row' | 'column', ids: readonly string[], gap: number) => void;
  allowColumnGather?: boolean;
  modelId?: string;
  interactionsEnabled?: boolean;
  /** Keeps this grid mounted while a live pointer session owns it. */
  onPointerInteractionChange?: (sheetId: string, active: boolean) => void;
  /** Publishes native ownership only after focus reaches a concrete cell. */
  onNativeFocusTarget?: (target: CellTarget) => void;
  pendingCutCells?: ReadonlySet<string>;
  columnLabels?: ReadonlyMap<string, string>;
  calculatedColumnIds?: ReadonlySet<string>;
  /** Announces the committed scroll container to workspace integrations. */
  onScrollContainerAvailable?: (element: HTMLElement | null) => void;
  /** Reports positively identified user scroll input to the spatial history owner. */
  onUserViewportMovement?: () => void;
  historyRestore?: { generation: number; left: number; top: number };
  navigationRestoreGeneration?: number;
  navigationRequestGeneration?: number; navigationRequestCellKey?: string | null; navigationRequestRange?: CellRange;
  /** Acknowledges either final saved-scroll restoration or an explicit reveal. */
  onNavigationSettled?: (generation: number) => void;
  /** Publishes real detailed-grid viewport changes for workspace reference geometry. */
  onReferenceViewport?: (sheetId: string, viewport: { scrollLeft: number; scrollTop: number; width: number; height: number } | null) => void;
  activeCellKey: string | null;
  selectionTransition?: { from: CellTarget; to: CellTarget; id: number } | null;
  /**
   * The sheet that currently owns logical selection/focus.  A mounted grid may
   * remain visible after ownership moves to another sheet, so its pointer
   * session must not continue dispatching into the shared selection state.
   */
  activeSheetId?: string | null;
  axisMetrics?: SheetGridAxisMetrics;
  axisProjection: GridAxisProjection;
  cellInteraction: SheetGridCellInteraction;
  editorInteraction: SheetGridCellEditorInteraction;
  editingCell: CellEditSession | null;
  keyboardFocusRequest: { id: number; targetKey: string | null } | null;
  onKeyboardFocusRequestConsumed: (requestId: number) => void;
  navigationHighlightCellKey: string | null;
  navigationHighlightRange?: CellRange;
  /** One reference-navigation action, independent of range/projection allocations. */
  navigationHighlightIdentity?: number;
  historyFeedbackCells?: ReadonlyMap<string, { before: string | null; beforeDisplay: string | null; after: string | null }>;
  historyRevealCells?: ReadonlyMap<string, { before: string | null; beforeDisplay: string | null; after: string | null }>;
  canRevealHistory?: (sheetId: string, identity: string) => boolean;
  revealEnabled?: boolean;
  requireMeasuredViewport?: boolean;
  ownsGridRestore?: (sheetId: string, generation: number) => boolean;
  /** Identity of the undo/redo action, independent of feedback map/projection allocations. */
  historyFeedbackIdentity?: string;
  historyRevealReady?: boolean;
  onHistoryRevealConsumed?: (sheetId: string, identity: string) => void;
  formulaResults: FormulaEvaluationSnapshot;
  scrollContainerRef: RefObject<HTMLElement>;
  ownedScroll?: { left: number; top: number };
  selectionMode?: CellSelectionMode;
  /** Controlled selection owner; omitted only by consumers without shared interaction state. */
  selectionOwner?: symbol | null;
  sheet: SheetTabularProjection;
  selectedRange?: CellRange;
  onSelectAxis?: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture, intent?: 'plain' | 'extend' | 'toggle') => void;
  /** Clipboard operations are owned by the application, while this grid owns DOM routing. */
  clipboardInteraction?: {
    copy: () => { text: string; marker: string } | undefined;
    cut?: () => { text: string; marker: string } | undefined;
    paste: (clipboard: { text: string; marker?: string }) => void;
    cancelCut?: () => void;
  };
}) {
  const focusTargetRef = useRef<{ element: HTMLElement | null; key: string | null }>({ element: null, key: null });
  // Remember acknowledgements because virtualization can rerun a live request effect.
  const consumedKeyboardFocusRequestIds = useRef(new Set<number>());
  const revealedHistoryIdentity = useRef<string>();
  const revealedNavigationIdentity = useRef<number>();
  const gridRef = useRef<HTMLDivElement>(null);
  const completedGatherOwner = useRef<symbol | null>(null);
  const nextGridFocusRequestId = useRef(1);
  const columnHeaderRef = useRef<HTMLDivElement>(null);
  const rowHeaderRef = useRef<HTMLDivElement>(null);
  const { columns, rows } = axisProjection;
  const selectionPresentation = useMemo(() => gridSelectionPresentation(sheet, logicalSelection, selectedRange), [sheet, logicalSelection, selectedRange]);
  const resize = useAxisResize({ sheet, selection: logicalSelection, selectionOwner, activeSheetId, commit: onWriteAxisSizes, interactionsEnabled });
  const projectedMetrics = useMemo(() => createSheetGridAxisMetrics(axisProjection, presentation, resize.preview),
    [axisProjection, presentation, resize.preview]);
  const rowMetrics = axisMetrics?.rows ?? projectedMetrics.rows;
  const columnMetrics = axisMetrics?.columns ?? projectedMetrics.columns;
  const motion = useGridAxisMotion({ gridRef, scrollContainerRef, projection: axisProjection, rowMetrics, columnMetrics,
    sheetId: sheet.id, activeSheetId, owner: selectionOwner, completedGatherOwner, enabled: interactionsEnabled });
  const rowItemKey = useCallback((index: number) => rowMetrics.itemKey(index) ?? index, [rowMetrics]);
  const columnItemKey = useCallback((index: number) => columnMetrics.itemKey(index) ?? index, [columnMetrics]);
  const rowItemSize = useCallback((index: number) => rowMetrics.itemSize(index) ?? 0, [rowMetrics]);
  const columnItemSize = useCallback((index: number) => columnMetrics.itemSize(index) ?? 0, [columnMetrics]);
  const gather = useAxisGather({ sheet, selection: logicalSelection, selectionOwner, activeSheetId,
    enabled: interactionsEnabled, allowColumns: allowColumnGather, modelId, columns, rows, columnLabels, columnMetrics, rowMetrics,
    gridRef, scrollContainerRef, completedGatherOwner, select: onSelectAxis, settle: cellInteraction.settleSelectionGesture, focus: cellInteraction.focusSelection, gather: onGatherAxis });
  useOwnedScroll(scrollContainerRef, ownedScroll);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(scrollContainerRef.current);
  const [gridEntryFocusIntent, setGridEntryFocusIntent] = useState<GridFocusIntent | null>(null);
  const [navigationFocusIntent, setNavigationFocusIntent] = useState<NavigationFocusIntent | null>(null);
  // Derive application focus during render so a newer request atomically replaces an older one.
  const keyboardFocusIntent = useMemo<GridFocusIntent | null>(() => (
    keyboardFocusRequest?.targetKey
      ? { id: `keyboard-${keyboardFocusRequest.id}`, requestId: keyboardFocusRequest.id, targetKey: keyboardFocusRequest.targetKey }
      : null
  ), [keyboardFocusRequest?.id, keyboardFocusRequest?.targetKey]);
  const focusIntent = keyboardFocusIntent ?? gridEntryFocusIntent;
  const pointer = useGridPointerSelection({ activeSheetId, cellInteraction, columnMetrics, columns,
    onSelectAxis, onAxisPress: (event, axis, id) => gather.press(event, axis, id),
    rowMetrics, rows, scrollContainerRef, selection: logicalSelection, selectionOwner, sheet, interactionsEnabled });
  const { dragging, beginDrag, moveDrag, completeDrag, cancelDrag, finishDrag, openDoubleClick } = pointer;
  useEffect(() => {
    const active = dragging || gather.active || resize.preview !== null;
    onPointerInteractionChange?.(sheet.id, active);
    return () => {
      if (active) onPointerInteractionChange?.(sheet.id, false);
    };
  }, [dragging, gather.active, onPointerInteractionChange, resize.preview, sheet.id]);
  // An application request permanently supersedes every older grid-entry request.
  useEffect(() => {
    if (keyboardFocusIntent) {
      setGridEntryFocusIntent(null);
    }
  }, [keyboardFocusIntent]);
  useEffect(() => {
    setScrollElement(scrollContainerRef.current);
  }, [scrollContainerRef]);
  useEffect(() => {
    const element = scrollContainerRef.current;
    onScrollContainerAvailable?.(element);
    return () => onScrollContainerAvailable?.(null);
  }, [onScrollContainerAvailable, scrollContainerRef]);
  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element || !onReferenceViewport) return;
    const report = () => onReferenceViewport(sheet.id, { scrollLeft: element.scrollLeft, scrollTop: element.scrollTop, width: element.clientWidth, height: element.clientHeight });
    report();
    element.addEventListener('scroll', report, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(report);
    observer?.observe(element);
    return () => { element.removeEventListener('scroll', report); observer?.disconnect(); onReferenceViewport(sheet.id, null); };
  }, [onReferenceViewport, scrollContainerRef, sheet.id]);
  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element || !onUserViewportMovement) return;
    const reportWheel = () => onUserViewportMovement(); const reportTouchMove = () => onUserViewportMovement();
    const reportScrollKey = (event: KeyboardEvent) => {
      if (isNativeEditorTarget(event.target)) return;
      if ([' ', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) onUserViewportMovement();
    };
    const reportScrollbarPointer = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const inVerticalScrollbar = event.clientX >= rect.left + element.clientWidth; const inHorizontalScrollbar = event.clientY >= rect.top + element.clientHeight;
      if (inVerticalScrollbar || inHorizontalScrollbar) onUserViewportMovement();
    };
    // A native scroll event carries no reliable provenance: script writes,
    // virtualizer reveals, and user gestures all dispatch the same event. Only
    // input that can originate a user scroll is allowed to arm history.
    element.addEventListener('wheel', reportWheel, { passive: true });
    element.addEventListener('touchmove', reportTouchMove, { passive: true });
    element.addEventListener('keydown', reportScrollKey);
    element.addEventListener('pointerdown', reportScrollbarPointer, { passive: true });
    return () => {
      element.removeEventListener('wheel', reportWheel); element.removeEventListener('touchmove', reportTouchMove);
      element.removeEventListener('keydown', reportScrollKey); element.removeEventListener('pointerdown', reportScrollbarPointer);
    };
  }, [onUserViewportMovement, scrollContainerRef]);
  const rowVirtualizer = useVirtualizer({
    count: rowMetrics.count,
    estimateSize: rowItemSize,
    getItemKey: rowItemKey,
    getScrollElement: () => scrollElement,
    initialRect: { height: 600, width: 800 },
    overscan: 3,
    paddingStart: GRID_COLUMN_HEADER_HEIGHT,
  });
  const columnVirtualizer = useVirtualizer({
    count: columnMetrics.count,
    estimateSize: columnItemSize,
    getItemKey: columnItemKey,
    horizontal: true,
    getScrollElement: () => scrollElement,
    initialRect: { height: 600, width: 800 },
    overscan: 2,
    paddingStart: GRID_ROW_HEADER_WIDTH,
  });
  useEffect(() => { rowVirtualizer.measure(); }, [rowMetrics, rowVirtualizer]);
  useEffect(() => { columnVirtualizer.measure(); }, [columnMetrics, columnVirtualizer]);
  const activeAddress = parseCellAddress(activeCellKey, sheet);
  const keyboardFocusAddress = parseCellAddress(keyboardFocusRequest?.targetKey ?? null, sheet);
  const focusIntentAddress = parseCellAddress(focusIntent?.targetKey ?? null, sheet);
  const editingAddress = cellKeyForTarget(sheet, editingCell?.target ?? null)
    ? parseCellAddress(cellKeyForTarget(sheet, editingCell?.target ?? null), sheet)
    : undefined;
  const navigationAddress = navigationRequestCellKey
    ? parseCellAddress(navigationRequestCellKey, sheet)
    : navigationRequestRange?.start
      ?? (navigationHighlightCellKey ? parseCellAddress(navigationHighlightCellKey, sheet) : navigationHighlightRange?.start);
  const navigationTargetKey = navigationRequestCellKey
    ?? (navigationRequestRange ? cellKey(navigationRequestRange.start) : null);
  const historyAddress = parseCellAddress(historyRevealCells?.keys().next().value ?? null, sheet);
  // Keep the selected cell mounted so native focus survives manual scrolling.
  const pinnedAddresses = [
    activeAddress,
    editingAddress,
    keyboardFocusAddress,
    focusIntentAddress,
    navigationAddress,
    historyAddress,
    navigationRequestRange?.end,
    navigationHighlightRange?.end,
  ]
    .filter(Boolean) as CellAddress[];
  const resizeRowIndex = resize.preview?.axis === 'row' ? sheet.rows.indexOf(resize.preview.originId) : -1;
  const resizeColumnIndex = resize.preview?.axis === 'column' ? sheet.columns.indexOf(resize.preview.originId) : -1;
  const pinnedRows = pinnedAxisIndices(rows, [...pinnedAddresses.map((address) => address.rowIndex), resizeRowIndex]);
  const pinnedColumns = pinnedAxisIndices(columns, [...pinnedAddresses.map((address) => address.columnIndex), resizeColumnIndex]);
  const windowedRows = rowVirtualizer.getVirtualItems();
  const windowedColumns = columnVirtualizer.getVirtualItems();
  const virtualRows = mergeVirtualIndexes(
    virtualItemsOrTestFallback(windowedRows, rowMetrics, GRID_COLUMN_HEADER_HEIGHT),
    [...pinnedRows, ...(motion?.rows.map((item) => item.index) ?? [])],
    rowVirtualizer,
    GRID_COLUMN_HEADER_HEIGHT,
    rowMetrics,
  );
  const virtualColumns = mergeVirtualIndexes(
    virtualItemsOrTestFallback(windowedColumns, columnMetrics, GRID_ROW_HEADER_WIDTH),
    [...pinnedColumns, ...(motion?.columns.map((item) => item.index) ?? [])],
    columnVirtualizer,
    GRID_ROW_HEADER_WIDTH,
    columnMetrics,
  );
  const activeIsMounted = Boolean(activeAddress
    && virtualRows.some((virtualRow) => {
      const row = rows[virtualRow.index];
      return row?.kind === 'saved' && row.durableIndex === activeAddress.rowIndex;
    })
    && virtualColumns.some((virtualColumn) => {
      const column = columns[virtualColumn.index];
      return column?.kind === 'saved' && column.durableIndex === activeAddress.columnIndex;
    }));
  const nativeRows = virtualItemsOrTestFallback(windowedRows, rowMetrics, GRID_COLUMN_HEADER_HEIGHT);
  const nativeColumns = virtualItemsOrTestFallback(windowedColumns, columnMetrics, GRID_ROW_HEADER_WIDTH);
  const focusIntentIsInWindow = Boolean(focusIntentAddress
    && nativeRows.some((virtualRow) => hasDurableIndex(rows[virtualRow.index], focusIntentAddress.rowIndex))
    && nativeColumns.some((virtualColumn) => hasDurableIndex(columns[virtualColumn.index], focusIntentAddress.columnIndex)));
  const registerCell = useCallback((key: string, cellElement: HTMLElement | null) => {
    if (key === focusIntent?.targetKey || key === navigationTargetKey) {
      focusTargetRef.current = { element: cellElement, key };
    }
  }, [focusIntent?.targetKey, navigationTargetKey]);
  useEffect(() => {
    if (!revealEnabled || !focusIntent || editingCell) return;
    if (document.activeElement?.closest('form, [role="dialog"]')) return;
    const address = parseCellAddress(focusIntent.targetKey, sheet);
    if (!address) return;
    const rowIndex = axisIndexForDurableIndex(rows, address.rowIndex);
    const columnIndex = axisIndexForDurableIndex(columns, address.columnIndex);
    if (rowIndex !== undefined) rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    if (columnIndex !== undefined) columnVirtualizer.scrollToIndex(columnIndex, { align: 'auto' });
    if (!focusIntentIsInWindow) gridRef.current?.focus({ preventScroll: true });
  }, [revealEnabled, columns, editingCell, focusIntent, focusIntentIsInWindow, rowVirtualizer, columnVirtualizer, rows, sheet]);
  useEffect(() => {
    if (!revealEnabled || !focusIntent || editingCell || !focusIntentIsInWindow) return;
    if (document.activeElement?.closest('form, [role="dialog"]')) return;
    // A newer application request supersedes this effect before it can move DOM
    // focus or acknowledge the old request. Grid-entry intents are local and do
    // not have an application request ID to compare.
    if (focusIntent.requestId !== undefined && keyboardFocusRequest?.id !== focusIntent.requestId) return;
    const registeredTarget = focusTargetRef.current;
    if (registeredTarget.key !== focusIntent.targetKey || !registeredTarget.element) return;
    const completedIntent = focusIntent;
    registeredTarget.element.focus({ preventScroll: true });
    if (scrollContainerRef.current) {
      ensureCellVisibleOutsideStickyHeaders(
        registeredTarget.element,
        scrollContainerRef.current,
        columnHeaderRef.current,
        rowHeaderRef.current,
      );
    }
    if (completedIntent.requestId === undefined) {
      setGridEntryFocusIntent((current) => current?.id === completedIntent.id ? null : current);
    } else if (
      keyboardFocusRequest?.id === completedIntent.requestId
      && !consumedKeyboardFocusRequestIds.current.has(completedIntent.requestId)
    ) {
      consumedKeyboardFocusRequestIds.current.add(completedIntent.requestId);
      onKeyboardFocusRequestConsumed(completedIntent.requestId);
    }
  }, [revealEnabled, editingCell, focusIntent, focusIntentIsInWindow, keyboardFocusRequest?.id, onKeyboardFocusRequestConsumed, scrollContainerRef, virtualColumns, virtualRows]);
  const revealedActiveCell = useRef<string | null>(null);
  useEffect(() => {
    if (!activeAddress) { revealedActiveCell.current = null; return; }
    if (!revealEnabled) return;
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const identity = `${sheet.id}:${activeCellKey}`;
    if (dragging || gather.active) { revealedActiveCell.current = identity; return; }
    if (revealedActiveCell.current === identity) return;
    const rowIndex = axisIndexForDurableIndex(rows, activeAddress.rowIndex);
    const columnIndex = axisIndexForDurableIndex(columns, activeAddress.columnIndex);
    if (rowIndex === undefined || columnIndex === undefined) return;
    revealedActiveCell.current = identity;
    if (scrollContainer.clientWidth && scrollContainer.clientHeight) {
      const reveal = gridCellReveal({ rows: rowMetrics, columns: columnMetrics }, { row: rowIndex, column: columnIndex }, {
        width: scrollContainer.clientWidth, height: scrollContainer.clientHeight,
        left: scrollContainer.scrollLeft, top: scrollContainer.scrollTop,
      });
      if (reveal.row) scrollContainer.scrollTop = reveal.row.scroll;
      if (reveal.column) scrollContainer.scrollLeft = reveal.column.scroll;
    } else {
      rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
      columnVirtualizer.scrollToIndex(columnIndex, { align: 'auto' });
    }
  }, [revealEnabled, dragging, gather.active, activeAddress, activeCellKey, columnMetrics, rowMetrics, columnVirtualizer, rowVirtualizer, columns, rows, scrollContainerRef, sheet.id]);
  useEffect(() => {
    if (navigationRequestGeneration == null) return;
    if (!revealEnabled || (ownsGridRestore && !ownsGridRestore(sheet.id, navigationRequestGeneration))) return;
    if (revealedNavigationIdentity.current === navigationRequestGeneration) return;
    const parsedCell = navigationRequestCellKey
      ? parseA1Address(navigationRequestCellKey, sheetBounds(sheet))
      : undefined;
    const range = navigationRequestRange
      ?? (parsedCell?.ok
        ? { start: parsedCell.value, end: parsedCell.value }
        : undefined);
    if (!range) {
      return;
    }
    const rowIndex = axisIndexForDurableIndex(rows, range.start.rowIndex);
    const columnIndex = axisIndexForDurableIndex(columns, range.start.columnIndex);
    if (rowIndex === undefined || columnIndex === undefined) return;
    const targetKey = navigationRequestCellKey ?? cellKey(range.start);
    // The virtualizer and focus effects own the target lifecycle.  Do not
    // acknowledge from this request effect: their work can commit a later
    // native reveal that would otherwise overwrite the captured arrival.
    rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    columnVirtualizer.scrollToIndex(columnIndex, { align: 'auto' });
    setNavigationFocusIntent({ generation: navigationRequestGeneration, range, targetKey });
  }, [revealEnabled, ownsGridRestore, columnVirtualizer, columns, navigationRequestCellKey, navigationRequestGeneration, navigationRequestRange, rowVirtualizer, rows, sheet]);
  useEffect(() => {
    if (!navigationFocusIntent || navigationFocusIntent.generation !== navigationRequestGeneration) return;
    if (!revealEnabled || (ownsGridRestore && !ownsGridRestore(sheet.id, navigationFocusIntent.generation))) return;
    const scrollContainer = scrollContainerRef.current;
    if (requireMeasuredViewport && (!scrollContainer?.clientWidth || !scrollContainer.clientHeight)) return;
    const registeredTarget = focusTargetRef.current;
    const targetElement = registeredTarget.key === navigationFocusIntent.targetKey
      ? registeredTarget.element
      : [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-cell-key]') ?? [])]
        .find((element) => element.dataset.cellKey === navigationFocusIntent.targetKey) ?? null;
    if (!scrollContainer || !targetElement) return;
    // This is deliberately after the virtualizer and regular focus effects.
    // It is the grid's final reveal/focus phase and therefore the only point
    // at which the workspace operation may capture its arrival.
    if (interactionsEnabled && !editingCell && !document.activeElement?.closest('form, [role="dialog"], [data-workspace-sheet-editor]')) {
      targetElement.focus({ preventScroll: true });
    }
    if (ownsGridRestore && !ownsGridRestore(sheet.id, navigationFocusIntent.generation)) return;
    ensureCellVisibleOutsideStickyHeaders(
      targetElement,
      scrollContainer,
      columnHeaderRef.current,
      rowHeaderRef.current,
    );
    const { range } = navigationFocusIntent;
    const rowIndex = axisIndexForDurableIndex(rows, range.start.rowIndex);
    const columnIndex = axisIndexForDurableIndex(columns, range.start.columnIndex);
    const endRowIndex = axisIndexForDurableIndex(rows, range.end.rowIndex);
    const endColumnIndex = axisIndexForDurableIndex(columns, range.end.columnIndex);
    if (rowIndex === undefined || columnIndex === undefined || endRowIndex === undefined || endColumnIndex === undefined) return;
    const reveal = gridRangeReveal({ rows: rowMetrics, columns: columnMetrics }, {
      start: { row: rowIndex, column: columnIndex }, end: { row: endRowIndex, column: endColumnIndex },
    }, {
      width: scrollContainer.clientWidth, height: scrollContainer.clientHeight,
      left: scrollContainer.scrollLeft, top: scrollContainer.scrollTop,
    });
    if (!reveal.row || !reveal.column) return;
    revealedNavigationIdentity.current = navigationFocusIntent.generation;
    scrollContainer.scrollLeft = reveal.column.scroll;
    scrollContainer.scrollTop = reveal.row.scroll;
    setNavigationFocusIntent(null);
    onNavigationSettled?.(navigationFocusIntent.generation);
  }, [revealEnabled, ownsGridRestore, requireMeasuredViewport, sheet.id, columnMetrics, columns, editingCell, interactionsEnabled, navigationFocusIntent, navigationRequestGeneration, onNavigationSettled, rowMetrics, rows, scrollContainerRef, virtualColumns, virtualRows]);
  useEffect(() => {
    // Presentation-only highlights still reveal their range for consumers that
    // do not participate in a workspace navigation operation. An operation
    // request owns its reveal above, so a cancelled request can never be
    // revived by its retained highlight.
    if (!revealEnabled || navigationRequestGeneration !== undefined || onNavigationSettled) return;
    if (navigationHighlightIdentity !== undefined
      && revealedNavigationIdentity.current === navigationHighlightIdentity) return;
    if (!navigationHighlightRange && !navigationHighlightCellKey) return;
    const parsedCell = navigationHighlightCellKey
      ? parseA1Address(navigationHighlightCellKey, sheetBounds(sheet))
      : undefined;
    const range = navigationHighlightRange
      ?? (parsedCell?.ok ? { start: parsedCell.value, end: parsedCell.value } : undefined);
    const scrollContainer = scrollContainerRef.current;
    if (!range || !scrollContainer) return;
    const rowIndex = axisIndexForDurableIndex(rows, range.start.rowIndex);
    const columnIndex = axisIndexForDurableIndex(columns, range.start.columnIndex);
    const endRowIndex = axisIndexForDurableIndex(rows, range.end.rowIndex);
    const endColumnIndex = axisIndexForDurableIndex(columns, range.end.columnIndex);
    if (rowIndex === undefined || columnIndex === undefined || endRowIndex === undefined || endColumnIndex === undefined) return;
    const reveal = gridRangeReveal({ rows: rowMetrics, columns: columnMetrics }, {
      start: { row: rowIndex, column: columnIndex }, end: { row: endRowIndex, column: endColumnIndex },
    }, {
      width: scrollContainer.clientWidth, height: scrollContainer.clientHeight,
      left: scrollContainer.scrollLeft, top: scrollContainer.scrollTop,
    });
    if (!reveal.row || !reveal.column) return;
    revealedNavigationIdentity.current = navigationHighlightIdentity;
    scrollContainer.scrollLeft = reveal.column.scroll;
    scrollContainer.scrollTop = reveal.row.scroll;
  }, [revealEnabled, columnMetrics, columns, navigationHighlightCellKey, navigationHighlightIdentity, navigationHighlightRange, navigationRequestGeneration, onNavigationSettled, rowMetrics, rows, scrollContainerRef, sheet]);
  useEffect(() => {
    if (!historyRevealReady || !historyAddress || !historyFeedbackIdentity || revealedHistoryIdentity.current === historyFeedbackIdentity) return;
    if (canRevealHistory && !canRevealHistory(sheet.id, historyFeedbackIdentity)) return;
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    if (requireMeasuredViewport && (!scrollContainer.clientWidth || !scrollContainer.clientHeight)) return;
    const rowIndex = axisIndexForDurableIndex(rows, historyAddress.rowIndex);
    const columnIndex = axisIndexForDurableIndex(columns, historyAddress.columnIndex);
    const reveal = gridCellReveal({ rows: rowMetrics, columns: columnMetrics }, { row: rowIndex, column: columnIndex }, {
      width: scrollContainer.clientWidth, height: scrollContainer.clientHeight,
      left: scrollContainer.scrollLeft, top: scrollContainer.scrollTop,
    });
    if (!reveal.row || !reveal.column) return;
    revealedHistoryIdentity.current = historyFeedbackIdentity;
    scrollContainer.scrollLeft = reveal.column.scroll;
    scrollContainer.scrollTop = reveal.row.scroll;
    onHistoryRevealConsumed?.(sheet.id, historyFeedbackIdentity);
  }, [requireMeasuredViewport, canRevealHistory, columnMetrics, historyAddress, historyFeedbackIdentity, historyRevealReady, onHistoryRevealConsumed, rowMetrics, rows, columns, scrollContainerRef, sheet.id]);
  useGridHistoryRestore({ navigationGeneration: navigationRestoreGeneration, onSettled: onNavigationSettled, restore: historyRestore, scrollContainerRef,
    canRestore: (generation) => revealEnabled && (!ownsGridRestore || ownsGridRestore(sheet.id, generation))
      && (!requireMeasuredViewport || Boolean(scrollContainerRef.current?.clientWidth && scrollContainerRef.current.clientHeight)),
  });
  function enterGrid(event: FocusEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (focusIntent) return;
    if (activeCellKey) {
      setGridEntryFocusIntent({ id: `entry-${nextGridFocusRequestId.current++}`, targetKey: activeCellKey });
      return;
    }
    const firstRow = rows.find((row) => row.kind === 'saved');
    const firstColumn = columns.find((column) => column.kind === 'saved');
    if (!firstRow && entryRow) {
      gridRef.current?.querySelector<HTMLElement>('.model-entry-cell')?.focus();
      return;
    }
    if (!firstRow || !firstColumn) return;
    const key = cellKey({ columnIndex: firstColumn.durableIndex, rowIndex: firstRow.durableIndex });
    const target = cellTargetAt(sheet, key);
    if (!target) return;

    cellInteraction.select(target);
    setGridEntryFocusIntent({ id: `entry-${nextGridFocusRequestId.current++}`, targetKey: key });
  }

  function isNativeEditorEvent(event: ClipboardEvent<HTMLDivElement>) {
    return isNativeEditorTarget(event.target);
  }

  function copySelection(event: ClipboardEvent<HTMLDivElement>) {
    if (isNativeEditorEvent(event)) return;
    const copied = clipboardInteraction?.copy();
    if (!copied) return;
    event.clipboardData.setData('text/plain', copied.text);
    event.clipboardData.setData('application/x-sheetspace-clipboard', copied.marker);
    event.clipboardData.setData('text/html', clipboardHtml(copied));
    event.preventDefault();
  }

  function cutSelection(event: ClipboardEvent<HTMLDivElement>) {
    if (isNativeEditorEvent(event)) return;
    const cut = clipboardInteraction?.cut?.();
    if (!cut) return;
    event.clipboardData.setData('text/plain', cut.text);
    event.clipboardData.setData('application/x-sheetspace-clipboard', cut.marker);
    event.clipboardData.setData('text/html', clipboardHtml(cut));
    event.preventDefault();
  }

  function pasteSelection(event: ClipboardEvent<HTMLDivElement>) {
    if (isNativeEditorEvent(event)) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text && !event.clipboardData.types.includes('text/plain')) return;
    clipboardInteraction?.paste({
      text,
      marker: event.clipboardData.getData('application/x-sheetspace-clipboard') || clipboardMarkerFromHtml(event.clipboardData.getData('text/html')),
    });
    event.preventDefault();
  }

  const blockDisabledInteraction = (event: SyntheticEvent) => {
    if (interactionsEnabled) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      aria-label={`${sheet.name} grid`}
      aria-colcount={columns.filter((column) => column.kind === 'saved').length + 1}
      aria-rowcount={rows.filter((row) => row.kind === 'saved').length + 1 + (entryRow ? 1 : 0)}
      className="sheet-grid"
      data-testid="sheet-grid"
      data-workspace-navigation
      onClickCapture={blockDisabledInteraction}
      onDoubleClickCapture={blockDisabledInteraction}
      onFocusCapture={blockDisabledInteraction}
      onCopyCapture={blockDisabledInteraction}
      onCutCapture={blockDisabledInteraction}
      onPasteCapture={blockDisabledInteraction}
      onFocus={enterGrid}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        // Internal focus movement (including editor focus) retains the gesture.
        // A null target can be caused by virtualizing the focused cell, so window
        // blur remains the reliable cancellation path for that case.
        if (next && !event.currentTarget.contains(next)) finishDrag();
      }}
      onKeyDownCapture={(event) => {
        if (!interactionsEnabled) { blockDisabledInteraction(event); return; }
        if (!entryRow || !matchesShortcut(event, 'grid-down') || matchesShortcut(event, 'edit-cell') || !(event.target instanceof HTMLElement)) return;
        const key = event.target.dataset.cellKey;
        const address = key && parseA1Address(key);
        if (key !== activeCellKey || !address || !address.ok || address.value.rowIndex !== sheet.rows.length - 1) return;
        const cell = gridRef.current?.querySelectorAll<HTMLElement>('.model-entry-cell')[address.value.columnIndex];
        if (!cell) return;
        event.preventDefault();
        event.stopPropagation();
        cell.focus();
      }}
      onKeyDown={(event) => {
        if (matchesShortcut(event, 'cancel')) {
          finishDrag();
          if (!isNativeEditorTarget(event.target)) clipboardInteraction?.cancelCut?.();
        }
      }}
      onCopy={copySelection}
      onCut={cutSelection}
      onPaste={pasteSelection}
      onDoubleClick={openDoubleClick}
      onPointerDownCapture={beginDrag}
      onPointerMove={(event) => { moveDrag(event); gather.move(event); }}
      onPointerUp={(event) => { completeDrag(event); gather.stop(event); }}
      onPointerCancel={(event) => { cancelDrag(event); gather.interrupt(event); }}
      onLostPointerCapture={(event) => {
        finishDrag(event.pointerId);
        gather.interrupt(event);
      }}
      ref={gridRef}
      role="table"
      style={{
        '--grid-cell-height': cssRemFromPixels(GRID_CELL_HEIGHT),
        '--grid-cell-width': cssRemFromPixels(GRID_CELL_WIDTH),
        '--grid-row-header-width': cssRemFromPixels(GRID_ROW_HEADER_WIDTH),
        // CSSOM scroll extents are integer pixels. Reserve the fractional tail
        // rather than letting browser rounding make the last cell unrevealable.
        height: Math.ceil(GRID_COLUMN_HEADER_HEIGHT + rowMetrics.totalSize + (entryRow ? GRID_CELL_HEIGHT : 0)),
        width: Math.ceil(GRID_ROW_HEADER_WIDTH + columnMetrics.totalSize),
      } as CSSProperties}
      tabIndex={!activeCellKey || !activeIsMounted ? 0 : -1}
    >
      <SheetGridHeaders
        columnHeaderRef={columnHeaderRef}
        columns={columns}
        columnLabels={columnLabels}
        virtualColumns={virtualColumns}
        resize={onWriteAxisSizes ? resize : undefined}
        selectedColumnIndices={(selectionPresentation.mode ?? selectionMode) === 'columns' ? selectionPresentation.columns : undefined}
      />
      <SheetGridRows {...{ activeCellKey, selectionTransition, calculatedColumnIds, cellInteraction, columns, editingCell, editorInteraction, focusIntent, formulaResults, gridRef, historyFeedbackCells, navigationHighlightCellKey, navigationHighlightIdentity, navigationHighlightRange, onNativeFocusTarget, onWriteAxisSizes, pendingCutCells, presentation, registerCell, resize, rowHeaderRef, rows, selectionPresentation, selectionMode, sheet, virtualColumns, virtualRows }} />
      {gather.preview && <div aria-hidden="true" data-testid="axis-gather-line" className={`sheet-grid-gather-line sheet-grid-gather-line-${gather.preview.axis}`} style={gather.preview.axis === 'row'
        ? { top: GRID_COLUMN_HEADER_HEIGHT + gather.preview.line - 1, left: 0, right: 0, height: 2 }
        : { left: GRID_ROW_HEADER_WIDTH + gather.preview.line - 1, top: 0, bottom: 0, width: 2 }} />}
      <AxisGatherOverlay deck={gather.deck} flight={gather.flight} />
      {entryRow && <ModelEntryRow {...entryRow} editorInteraction={editorInteraction} sheetId={sheet.id} sheetName={sheet.name} onNavigateUp={(columnIndex) => {
        if (!sheet.rows.length || columnIndex >= sheet.columns.length) return;
        const key = cellKey({ columnIndex, rowIndex: sheet.rows.length - 1 });
        const target = cellTargetAt(sheet, key);
        if (!target) return;
        cellInteraction.select(target);
        setGridEntryFocusIntent({ id: `entry-${nextGridFocusRequestId.current++}`, targetKey: key });
      }} columnWidths={entryRow.model.columns.map((_, index) => columnMetrics.itemSize(index) ?? GRID_CELL_WIDTH)} style={{ position: 'absolute', top: GRID_COLUMN_HEADER_HEIGHT + rowMetrics.totalSize, left: 0, height: GRID_CELL_HEIGHT }} />}
    </div>
  );
}

export { savedAxisIndexAtOffset } from './sheetGridProjection';
