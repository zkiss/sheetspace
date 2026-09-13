import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent, type RefObject } from 'react';
import { useVirtualizer, type VirtualItem, type Virtualizer } from '@tanstack/react-virtual';
import { cellKey, parseA1Address, type CellAddress, type CellRange } from '@workbook/core/address';
import { sheetBounds } from '@workbook/read/queries';
import { type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { type SheetTabularProjection } from '@workbook/core/model';
import type { GridAxisProjection } from '@grid/gridAxisProjection';
import { createGridAxisMetrics, type GridAxisMetrics } from './gridAxisMetrics';
import {
  GRID_COLUMN_HEADER_HEIGHT,
  GRID_CELL_HEIGHT,
  GRID_CELL_WIDTH,
  GRID_ROW_HEADER_WIDTH,
} from '@grid/gridGeometry';
import type { SelectionGesture, CellEditSession, CellSelectionMode, CellTarget } from './cellInteractionContracts';
import { cellKeyForTarget, cellTargetAt } from '@grid/cellInteraction';
import {
  SheetGridCell,
  type SheetGridCellEditorInteraction,
  type SheetGridCellInteraction,
} from '@grid/SheetGridCell';
import { SheetGridHeaders } from '@grid/SheetGridHeaders';
import { getSheetCellDisplayText } from './sheetGridModel';
import { cssRemFromPixels } from '@shared/styles/styleTokens';
import '@grid/SheetGrid.css';

function ensureCellVisibleOutsideStickyHeaders(
  cell: HTMLElement,
  scrollContainer: HTMLElement,
  columnHeader: HTMLElement | null,
  rowHeader: HTMLElement | null,
) {
  cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const cellRect = cell.getBoundingClientRect();
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  const visibleTop = scrollContainerRect.top
    + (columnHeader?.getBoundingClientRect().height ?? GRID_COLUMN_HEADER_HEIGHT);
  const visibleLeft = scrollContainerRect.left
    + (rowHeader?.getBoundingClientRect().width ?? GRID_ROW_HEADER_WIDTH);

  if (cellRect.top < visibleTop) {
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - (visibleTop - cellRect.top));
  }

  if (cellRect.left < visibleLeft) {
    scrollContainer.scrollLeft = Math.max(0, scrollContainer.scrollLeft - (visibleLeft - cellRect.left));
  }
}

type GridFocusIntent = {
  id: string;
  requestId?: number;
  targetKey: string;
};

export type SheetGridAxisMetrics = {
  readonly columns: GridAxisMetrics;
  readonly rows: GridAxisMetrics;
};

export function SheetGrid({
  activeCellKey,
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
  formulaResults,
  scrollContainerRef,
  selectionMode,
  selectionOwner,
  sheet,
  selectedRange,
  onSelectAxis,
}: {
  activeCellKey: string | null;
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
  formulaResults: FormulaEvaluationSnapshot;
  scrollContainerRef: RefObject<HTMLElement>;
  selectionMode?: CellSelectionMode;
  /** Controlled selection owner; omitted only by consumers without shared interaction state. */
  selectionOwner?: symbol | null;
  sheet: SheetTabularProjection;
  selectedRange?: CellRange;
  onSelectAxis?: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture) => void;
}) {
  const focusTargetRef = useRef<{ element: HTMLElement | null; key: string | null }>({ element: null, key: null });
  // The application owns request lifetime, so it may keep a request prop present
  // while virtualization causes this effect to rerun. Remember acknowledgements
  // locally to make each request's completion edge-triggered.
  const consumedKeyboardFocusRequestIds = useRef(new Set<number>());
  const gridRef = useRef<HTMLDivElement>(null);
  const nextGridFocusRequestId = useRef(1);
  const columnHeaderRef = useRef<HTMLDivElement>(null);
  const rowHeaderRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    mode: CellSelectionMode;
    target: CellTarget | null;
    owner: symbol;
    captureElement: HTMLDivElement;
  } | null>(null);
  const animationFrameRef = useRef(0);
  const cellInteractionRef = useRef(cellInteraction);
  cellInteractionRef.current = cellInteraction;
  const activeSheetIdRef = useRef(activeSheetId);
  activeSheetIdRef.current = activeSheetId;
  const selectionOwnerRef = useRef(selectionOwner);
  selectionOwnerRef.current = selectionOwner;
  const { columns, rows } = axisProjection;
  const defaultRowMetrics = useMemo(() => createGridAxisMetrics(rows, GRID_CELL_HEIGHT), [rows]);
  const defaultColumnMetrics = useMemo(() => createGridAxisMetrics(columns, GRID_CELL_WIDTH), [columns]);
  const rowMetrics = axisMetrics?.rows ?? defaultRowMetrics;
  const columnMetrics = axisMetrics?.columns ?? defaultColumnMetrics;
  const rowItemKey = useCallback((index: number) => rowMetrics.itemKey(index) ?? index, [rowMetrics]);
  const columnItemKey = useCallback((index: number) => columnMetrics.itemKey(index) ?? index, [columnMetrics]);
  const rowItemSize = useCallback((index: number) => rowMetrics.itemSize(index) ?? 0, [rowMetrics]);
  const columnItemSize = useCallback((index: number) => columnMetrics.itemSize(index) ?? 0, [columnMetrics]);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(scrollContainerRef.current);
  const [dragging, setDragging] = useState(false);
  const [gridEntryFocusIntent, setGridEntryFocusIntent] = useState<GridFocusIntent | null>(null);
  // Application requests are already the authoritative focus state. Deriving their
  // intent during render makes replacement atomic: an R2 render cannot run R1's
  // completion effect while waiting for a state-sync effect to catch up.
  const keyboardFocusIntent = useMemo<GridFocusIntent | null>(() => (
    keyboardFocusRequest?.targetKey
      ? { id: `keyboard-${keyboardFocusRequest.id}`, requestId: keyboardFocusRequest.id, targetKey: keyboardFocusRequest.targetKey }
      : null
  ), [keyboardFocusRequest?.id, keyboardFocusRequest?.targetKey]);
  const focusIntent = keyboardFocusIntent ?? gridEntryFocusIntent;

  // An application request supersedes every older grid-entry request.  It is not
  // merely higher priority while present: once acknowledged, the prior entry
  // must not become eligible to scroll or focus again.
  useEffect(() => {
    if (keyboardFocusIntent) {
      setGridEntryFocusIntent(null);
    }
  }, [keyboardFocusIntent]);

  useEffect(() => {
    setScrollElement(scrollContainerRef.current);
  });

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
  const activeAddress = parseCellAddress(activeCellKey, sheet);
  const keyboardFocusAddress = parseCellAddress(keyboardFocusRequest?.targetKey ?? null, sheet);
  const focusIntentAddress = parseCellAddress(focusIntent?.targetKey ?? null, sheet);
  const editingAddress = cellKeyForTarget(sheet, editingCell?.target ?? null)
    ? parseCellAddress(cellKeyForTarget(sheet, editingCell?.target ?? null), sheet)
    : undefined;
  const navigationAddress = navigationHighlightCellKey
    ? parseCellAddress(navigationHighlightCellKey, sheet)
    : navigationHighlightRange?.start;
  // Selection is logical state and may leave the rendered window. Only an editor or
  // an in-flight navigation target must stay mounted as a DOM requirement.
  const pinnedAddresses = [
    editingAddress,
    keyboardFocusAddress,
    focusIntentAddress,
    navigationAddress,
    navigationHighlightRange?.end,
  ]
    .filter(Boolean) as CellAddress[];
  const pinnedRows = pinnedAxisIndices(rows, pinnedAddresses.map((address) => address.rowIndex));
  const pinnedColumns = pinnedAxisIndices(columns, pinnedAddresses.map((address) => address.columnIndex));
  const windowedRows = rowVirtualizer.getVirtualItems();
  const windowedColumns = columnVirtualizer.getVirtualItems();
  const virtualRows = mergeVirtualIndexes(
    virtualItemsOrTestFallback(windowedRows, rowMetrics, GRID_COLUMN_HEADER_HEIGHT),
    pinnedRows,
    rowVirtualizer,
    GRID_COLUMN_HEADER_HEIGHT,
    rowMetrics,
  );
  const virtualColumns = mergeVirtualIndexes(
    virtualItemsOrTestFallback(windowedColumns, columnMetrics, GRID_ROW_HEADER_WIDTH),
    pinnedColumns,
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

  function registerCell(key: string, cellElement: HTMLElement | null) {
    if (
      key === activeCellKey
      || key === keyboardFocusRequest?.targetKey
      || key === focusIntent?.targetKey
      || key === cellKeyForTarget(sheet, editingCell?.target ?? null)
      || key === navigationHighlightCellKey
    ) {
      if (key === focusIntent?.targetKey) {
        focusTargetRef.current = { element: cellElement, key };
      }
    }
  }

  useEffect(() => {
    if (!focusIntent || editingCell) return;
    const address = parseCellAddress(focusIntent.targetKey, sheet);
    if (!address) return;
    const rowIndex = axisIndexForDurableIndex(rows, address.rowIndex);
    const columnIndex = axisIndexForDurableIndex(columns, address.columnIndex);
    if (rowIndex !== undefined) rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    if (columnIndex !== undefined) columnVirtualizer.scrollToIndex(columnIndex, { align: 'auto' });
    if (!focusIntentIsInWindow) gridRef.current?.focus();
  }, [columns, editingCell, focusIntent, focusIntentIsInWindow, rowVirtualizer, columnVirtualizer, rows, sheet]);

  useEffect(() => {
    if (!focusIntent || editingCell || !focusIntentIsInWindow) return;
    // A newer application request supersedes this effect before it can move DOM
    // focus or acknowledge the old request. Grid-entry intents are local and do
    // not have an application request ID to compare.
    if (focusIntent.requestId !== undefined && keyboardFocusRequest?.id !== focusIntent.requestId) return;
    const registeredTarget = focusTargetRef.current;
    if (registeredTarget.key !== focusIntent.targetKey || !registeredTarget.element) return;
    registeredTarget.element.focus();
    if (scrollContainerRef.current) {
      ensureCellVisibleOutsideStickyHeaders(
        registeredTarget.element,
        scrollContainerRef.current,
        columnHeaderRef.current,
        rowHeaderRef.current,
      );
    }
    const completedIntent = focusIntent;
    if (completedIntent.requestId === undefined) {
      setGridEntryFocusIntent((current) => current?.id === completedIntent.id ? null : current);
    } else if (
      keyboardFocusRequest?.id === completedIntent.requestId
      && !consumedKeyboardFocusRequestIds.current.has(completedIntent.requestId)
    ) {
      consumedKeyboardFocusRequestIds.current.add(completedIntent.requestId);
      onKeyboardFocusRequestConsumed(completedIntent.requestId);
    }
  }, [editingCell, focusIntent, focusIntentIsInWindow, keyboardFocusRequest?.id, onKeyboardFocusRequestConsumed, scrollContainerRef, virtualColumns, virtualRows]);

  useEffect(() => {
    if (!activeAddress || !scrollContainerRef.current) return;
    const rowIndex = axisIndexForDurableIndex(rows, activeAddress.rowIndex);
    const columnIndex = axisIndexForDurableIndex(columns, activeAddress.columnIndex);
    if (rowIndex !== undefined) rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    if (columnIndex !== undefined) columnVirtualizer.scrollToIndex(columnIndex, { align: 'auto' });
  }, [activeAddress?.columnIndex, activeAddress?.rowIndex, columnVirtualizer, rowVirtualizer, columns, rows, scrollContainerRef]);

  useEffect(() => {
    if (!navigationHighlightRange && !navigationHighlightCellKey) {
      return;
    }

    const parsedCell = navigationHighlightCellKey
      ? parseA1Address(navigationHighlightCellKey, sheetBounds(sheet))
      : undefined;
    const range = navigationHighlightRange
      ?? (parsedCell?.ok
        ? { start: parsedCell.value, end: parsedCell.value }
        : undefined);
    if (!range) {
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const rowIndex = axisIndexForDurableIndex(rows, range.start.rowIndex);
    const columnIndex = axisIndexForDurableIndex(columns, range.start.columnIndex);
    const rowOffset = rowMetrics.scrollOffsetForIndex(
      rowIndex,
      Math.max(0, scrollContainer.clientHeight - GRID_COLUMN_HEADER_HEIGHT),
    );
    const columnOffset = columnMetrics.scrollOffsetForIndex(
      columnIndex,
      Math.max(0, scrollContainer.clientWidth - GRID_ROW_HEADER_WIDTH),
    );
    if (columnOffset !== undefined) scrollContainer.scrollLeft = Math.round(columnOffset);
    if (rowOffset !== undefined) scrollContainer.scrollTop = Math.round(rowOffset);
  }, [columnMetrics, columns, navigationHighlightCellKey, navigationHighlightRange, rowMetrics, rows, scrollContainerRef, sheet]);

  function enterGrid(event: FocusEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (focusIntent) return;
    if (activeCellKey) {
      setGridEntryFocusIntent({ id: `entry-${nextGridFocusRequestId.current++}`, targetKey: activeCellKey });
      return;
    }
    const firstRow = rows.find((row) => row.kind === 'saved');
    const firstColumn = columns.find((column) => column.kind === 'saved');
    if (!firstRow || !firstColumn) return;

    const key = cellKey({ columnIndex: firstColumn.durableIndex, rowIndex: firstRow.durableIndex });
    const target = cellTargetAt(sheet, key);
    if (!target) return;

    cellInteraction.select(target);
    setGridEntryFocusIntent({ id: `entry-${nextGridFocusRequestId.current++}`, targetKey: key });
  }

  function extendSelectionAt(clientX: number, clientY: number) {
    const scrollContainer = scrollContainerRef.current;
    const drag = dragRef.current;
    if (!scrollContainer || !drag) return;
    // This check runs from both pointer movement and the RAF loop. It closes the
    // gap between a context-replacement render and its cleanup effect, so an
    // already queued stale callback cannot replace the new sheet selection.
    if (activeSheetIdRef.current != null && activeSheetIdRef.current !== sheet.id) {
      finishDrag();
      return;
    }
    if (!dragOwnsCurrentSelection()) {
      finishDrag();
      return;
    }
    const rect = scrollContainer.getBoundingClientRect();
    // Pointer coordinates are screen-space while the grid may be scaled by the
    // workspace. Convert through the scroll viewport before consulting metrics.
    const scaleX = rect.width ? scrollContainer.clientWidth / rect.width : 1;
    const scaleY = rect.height ? scrollContainer.clientHeight / rect.height : 1;
    const columnIndex = savedAxisIndexAtOffset(columns, columnMetrics,
      scrollContainer.scrollLeft + (clientX - rect.left) * scaleX - GRID_ROW_HEADER_WIDTH,
    );
    const rowIndex = savedAxisIndexAtOffset(rows, rowMetrics,
      scrollContainer.scrollTop + (clientY - rect.top) * scaleY - GRID_COLUMN_HEADER_HEIGHT,
    );
    const row = rowIndex === undefined ? undefined : rows[rowIndex];
    const column = columnIndex === undefined ? undefined : columns[columnIndex];
    if (drag.mode === 'columns') {
      const firstRow = rows.find((axis) => axis.kind === 'saved');
      if (column?.kind !== 'saved' || !firstRow) return;
      const target = cellTargetAt(sheet, cellKey({ columnIndex: column.durableIndex, rowIndex: firstRow.durableIndex }));
      if (target) {
        drag.target = target;
        onSelectAxis?.('columns', target, true, { owner: drag.owner });
      }
      return;
    }
    if (drag.mode === 'rows') {
      const firstColumn = columns.find((axis) => axis.kind === 'saved');
      if (row?.kind !== 'saved' || !firstColumn) return;
      const target = cellTargetAt(sheet, cellKey({ columnIndex: firstColumn.durableIndex, rowIndex: row.durableIndex }));
      if (target) {
        drag.target = target;
        onSelectAxis?.('rows', target, true, { owner: drag.owner });
      }
      return;
    }
    if (!cellInteraction.extend || row?.kind !== 'saved' || column?.kind !== 'saved') return;
    const target = cellTargetAt(sheet, cellKey({ columnIndex: column.durableIndex, rowIndex: row.durableIndex }));
    if (target) {
      drag.target = target;
      cellInteraction.extend(target, { owner: drag.owner });
    }
  }

  const finishDrag = useCallback((pointerId?: number, focusExtent = false) => {
    const drag = dragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
    // Clear ownership before releasing capture: lostpointercapture can reenter this
    // path synchronously in some browsers.
    dragRef.current = null;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    if (drag.captureElement.hasPointerCapture?.(drag.pointerId)) drag.captureElement.releasePointerCapture(drag.pointerId);
    setDragging(false);
    if (focusExtent && drag.target) cellInteractionRef.current.focusSelection?.(drag.target, { owner: drag.owner });
  }, []);

  useEffect(() => {
    const tick = () => {
      const drag = dragRef.current;
      const scrollContainer = scrollContainerRef.current;
      if (!drag || !scrollContainer) return;
      if (activeSheetIdRef.current != null && activeSheetIdRef.current !== sheet.id) {
        finishDrag();
        return;
      }
      if (!dragOwnsCurrentSelection()) {
        finishDrag();
        return;
      }
      const rect = scrollContainer.getBoundingClientRect();
      const edge = 28;
      const scrollX = drag.mode === 'rows' ? 0 : drag.clientX < rect.left + edge ? -18 : drag.clientX > rect.right - edge ? 18 : 0;
      const scrollY = drag.mode === 'columns' ? 0 : drag.clientY < rect.top + edge ? -18 : drag.clientY > rect.bottom - edge ? 18 : 0;
      if (scrollX || scrollY) {
        scrollContainer.scrollLeft += scrollX;
        scrollContainer.scrollTop += scrollY;
        extendSelectionAt(drag.clientX, drag.clientY);
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    if (dragging) animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    };
  }, [dragging, columnMetrics, rowMetrics, columns, rows, sheet, cellInteraction, onSelectAxis, scrollContainerRef]);

  useEffect(() => {
    const cancelForWindowDeparture = () => finishDrag();
    const cancelForVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finishDrag();
    };
    window.addEventListener('blur', cancelForWindowDeparture);
    document.addEventListener('visibilitychange', cancelForVisibilityChange);
    return () => {
      window.removeEventListener('blur', cancelForWindowDeparture);
      document.removeEventListener('visibilitychange', cancelForVisibilityChange);
    };
  }, [finishDrag]);

  useEffect(() => () => finishDrag(), [finishDrag, sheet.id]);

  // A frame can remain mounted when reference navigation or a workspace action
  // moves logical selection to another sheet. End the old session as part of
  // that replacement, while allowing ordinary same-sheet rerenders to continue.
  useEffect(() => {
    if (activeSheetId != null && activeSheetId !== sheet.id) finishDrag();
  }, [activeSheetId, finishDrag, sheet.id]);

  useEffect(() => {
    if (dragRef.current && !dragOwnsCurrentSelection()) finishDrag();
  }, [selectionOwner, finishDrag]);

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('textarea, input, button, a, [contenteditable="true"]')) return;
    if (dragRef.current) return;
    const source = (event.target as HTMLElement).closest<HTMLElement>('[data-cell-key], [data-axis-selection-mode]');
    if (!source) return;
    const mode = source.dataset.axisSelectionMode as Exclude<CellSelectionMode, 'cells'> | undefined;
    const target = dragTargetForSource(source, mode ?? 'cells', sheet, rows, columns);
    if (!target) return;
    const dragMode = mode ?? 'cells';
    const owner = Symbol('selection-gesture');
    const gesture = { owner, start: true };
    if (dragMode === 'cells') {
      if (event.shiftKey && cellInteraction.extend) cellInteraction.extend(target, gesture);
      else cellInteraction.select(target, gesture);
    } else {
      onSelectAxis?.(dragMode, target, event.shiftKey, gesture);
    }
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      mode: dragMode,
      target,
      owner,
      captureElement: event.currentTarget,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (!dragOwnsCurrentSelection()) {
      finishDrag();
      return;
    }
    if (activeSheetIdRef.current != null && activeSheetIdRef.current !== sheet.id) {
      finishDrag();
      return;
    }
    dragRef.current = { ...dragRef.current, clientX: event.clientX, clientY: event.clientY };
    extendSelectionAt(event.clientX, event.clientY);
  }

  function dragOwnsCurrentSelection() {
    const drag = dragRef.current;
    if (!drag) return false;
    return selectionOwnerRef.current === undefined || selectionOwnerRef.current === drag.owner;
  }

  function completeDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragOwnsCurrentSelection()) {
      finishDrag(event.pointerId);
      return;
    }
    finishDrag(event.pointerId, true);
  }

  function cancelDrag(event: PointerEvent<HTMLDivElement>) {
    finishDrag(event.pointerId);
  }

  return (
    <div
      aria-label={`${sheet.name} grid`}
      aria-colcount={columns.filter((column) => column.kind === 'saved').length + 1}
      aria-rowcount={rows.filter((row) => row.kind === 'saved').length + 1}
      className="sheet-grid"
      data-testid="sheet-grid"
      onFocus={enterGrid}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        // Internal focus movement (including editor focus) retains the gesture.
        // A null target can be caused by virtualizing the focused cell, so window
        // blur remains the reliable cancellation path for that case.
        if (next && !event.currentTarget.contains(next)) finishDrag();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') finishDrag();
      }}
      onPointerDownCapture={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={completeDrag}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={(event) => {
        finishDrag(event.pointerId);
      }}
      ref={gridRef}
      role="table"
      style={{
        '--grid-cell-height': cssRemFromPixels(GRID_CELL_HEIGHT),
        '--grid-cell-width': cssRemFromPixels(GRID_CELL_WIDTH),
        '--grid-row-header-width': cssRemFromPixels(GRID_ROW_HEADER_WIDTH),
        height: rowVirtualizer.getTotalSize(),
        width: columnVirtualizer.getTotalSize(),
      } as CSSProperties}
      tabIndex={!activeCellKey || !activeIsMounted ? 0 : -1}
    >
      <SheetGridHeaders
        columnHeaderRef={columnHeaderRef}
        columns={columns}
        virtualColumns={virtualColumns}
        selectedColumnIndices={selectionMode === 'columns' && selectedRange
          ? new Set(Array.from({ length: selectedRange.end.columnIndex - selectedRange.start.columnIndex + 1 }, (_, index) => selectedRange.start.columnIndex + index))
          : undefined}
      />
      {virtualRows.map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) return null;
        return (
          <div
            aria-hidden={row.kind === 'creating' ? true : undefined}
            aria-rowindex={row.kind === 'saved' ? row.durableIndex + 2 : undefined}
            className="sheet-grid-row"
            key={axisKey(row)}
            role="row"
            style={{ height: virtualRow.size, top: virtualRow.start }}
          >
            <div
              aria-label={row.kind === 'creating' ? 'Creating row' : undefined}
              aria-colindex={1}
              className={`sheet-grid-row-header${row.kind === 'creating' ? ' sheet-grid-axis-creating' : ''}${
                row.kind === 'saved' && selectionMode === 'rows' && isAddressInRange(
                  { rowIndex: row.durableIndex, columnIndex: 0 }, selectedRange,
                ) ? ' sheet-grid-axis-selected' : ''
              }`}
              data-axis-selection-mode={row.kind === 'saved' ? 'rows' : undefined}
              data-axis-durable-index={row.kind === 'saved' ? row.durableIndex : undefined}
              ref={row.kind === 'saved' && row.durableIndex === 0 ? rowHeaderRef : undefined}
              role="rowheader"
              style={{ height: virtualRow.size, left: 0, position: 'sticky' }}
            >
              {row.kind === 'creating' ? 'Creating…' : row.durableIndex + 1}
            </div>
            {virtualColumns.map((virtualColumn) => {
              const column = columns[virtualColumn.index];
              if (!column) return null;
              if (row.kind === 'creating' || column.kind === 'creating') {
                return (
                  <div
                    aria-hidden="true"
                    aria-label="Creating cell"
                    aria-colindex={column.kind === 'saved' ? column.durableIndex + 2 : undefined}
                    className="sheet-grid-cell sheet-grid-cell-creating"
                    key={column.kind === 'creating' ? column.operationId : column.id}
                    role="cell"
                    style={{
                      height: virtualRow.size,
                      left: virtualColumn.start,
                      minWidth: virtualColumn.size,
                      position: 'absolute',
                      width: virtualColumn.size,
                    }}
                  />
                );
              }
              const address = { columnIndex: column.durableIndex, rowIndex: row.durableIndex };
              const key = cellKey(address);
              const isActive = activeCellKey === key;
              const isEditing = cellKeyForTarget(sheet, editingCell?.target ?? null) === key;
              const isRangeSelected = isAddressInRange(address, selectedRange);
              const isNavigationTarget = navigationHighlightRange
                ? isAddressInRange(address, navigationHighlightRange)
                : navigationHighlightCellKey === key;

              return (
                <SheetGridCell
                  cellKey={key}
                  columnIndex={column.durableIndex + 2}
                  displayText={getSheetCellDisplayText({ cellKey: key, formulaResults, sheet })}
                  editingCell={editingCell}
                  cellInteraction={cellInteraction}
                  editorInteraction={editorInteraction}
                  isActive={isActive}
                  isEditing={isEditing}
                  isNavigationTarget={isNavigationTarget}
                  isRangeSelected={isRangeSelected}
                  key={key}
                  registerCell={registerCell}
                  sheet={sheet}
                  style={{
                    height: virtualRow.size,
                    left: virtualColumn.start,
                    minWidth: virtualColumn.size,
                    position: 'absolute',
                    width: virtualColumn.size,
                  }}
                  tabIndex={activeCellKey === key ? 0 : -1}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function axisKey(entry: GridAxisProjection['rows'][number] | GridAxisProjection['columns'][number] | undefined) {
  return entry ? (entry.kind === 'saved' ? entry.id : entry.operationId) : '';
}

/**
 * Resolve pointer geometry to a durable axis item. Projection also contains
 * temporary creation slots, so generic metric indexes cannot be used directly
 * for selection. The closest saved item makes endpoint and pending-slot
 * targeting deterministic without changing the metrics API's out-of-range
 * contract.
 */
export function savedAxisIndexAtOffset(
  entries: readonly GridAxisProjection['rows'][number][] | readonly GridAxisProjection['columns'][number][],
  metrics: GridAxisMetrics,
  offset: number,
) {
  if (!Number.isFinite(offset)) return undefined;
  const saved = entries
    .map((entry, index) => entry?.kind === 'saved' ? index : undefined)
    .filter((index): index is number => index !== undefined);
  if (!saved.length) return undefined;

  const directIndex = metrics.indexAtOffset(offset);
  if (directIndex !== undefined && entries[directIndex]?.kind === 'saved') return directIndex;

  let nearestIndex = saved[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const index of saved) {
    const start = metrics.itemOffset(index) ?? 0;
    const end = start + (metrics.itemSize(index) ?? 0);
    const distance = offset < start ? start - offset : offset >= end ? offset - end : 0;
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

function dragTargetForSource(
  source: HTMLElement,
  mode: CellSelectionMode,
  sheet: SheetTabularProjection,
  rows: GridAxisProjection['rows'],
  columns: GridAxisProjection['columns'],
) {
  if (mode === 'cells') {
    const key = source.dataset.cellKey;
    return key ? cellTargetAt(sheet, key) ?? null : null;
  }
  const durableIndex = Number(source.dataset.axisDurableIndex);
  if (!Number.isInteger(durableIndex)) return null;
  const firstRow = rows.find((axis) => axis.kind === 'saved');
  const firstColumn = columns.find((axis) => axis.kind === 'saved');
  if (!firstRow || !firstColumn) return null;
  return cellTargetAt(sheet, cellKey({
    columnIndex: mode === 'columns' ? durableIndex : firstColumn.durableIndex,
    rowIndex: mode === 'rows' ? durableIndex : firstRow.durableIndex,
  })) ?? null;
}

function hasDurableIndex(
  entry: GridAxisProjection['rows'][number] | GridAxisProjection['columns'][number] | undefined,
  durableIndex: number,
) {
  return entry?.kind === 'saved' && entry.durableIndex === durableIndex;
}

function parseCellAddress(key: string | null, sheet: SheetTabularProjection) {
  if (!key) return undefined;
  const parsed = parseA1Address(key, sheetBounds(sheet));
  return parsed.ok ? parsed.value : undefined;
}

function axisIndexForDurableIndex(entries: readonly GridAxisProjection['rows'][number][], durableIndex: number) {
  return entries.findIndex((entry) => entry.kind === 'saved' && entry.durableIndex === durableIndex);
}

function pinnedAxisIndices(entries: readonly GridAxisProjection['rows'][number][], durableIndices: readonly number[]) {
  return durableIndices.map((durableIndex) => axisIndexForDurableIndex(entries, durableIndex)).filter((index): index is number => index >= 0);
}

function mergeVirtualIndexes<TScrollElement extends Element, TItemElement extends Element>(
  virtualItems: readonly VirtualItem[],
  pinnedIndexes: readonly number[],
  virtualizer: Virtualizer<TScrollElement, TItemElement>,
  paddingStart: number,
  metrics: GridAxisMetrics,
) {
  const items = new Map(virtualItems.map((item) => [item.index, item]));
  for (const index of pinnedIndexes) {
    const size = metrics.itemSize(index) ?? 0;
    const start = paddingStart + (metrics.itemOffset(index) ?? 0);
    const item = virtualizer.getVirtualItems().find((candidate) => candidate.index === index)
      ?? { end: start + size, index, key: metrics.itemKey(index) ?? index, lane: 0, size, start };
    if (!items.has(index)) items.set(index, item);
  }
  return [...items.values()].sort((left, right) => left.index - right.index);
}

function virtualItemsOrTestFallback(items: readonly VirtualItem[], metrics: GridAxisMetrics, paddingStart: number) {
  if (items.length > 0) return items;
  // JSDOM reports a zero-sized scroll viewport; keep its deterministic projection bounded too.
  return Array.from({ length: Math.min(metrics.count, 30) }, (_, index) => {
    const size = metrics.itemSize(index) ?? 0;
    const start = paddingStart + (metrics.itemOffset(index) ?? 0);
    return {
      end: start + size,
      index,
      key: metrics.itemKey(index) ?? index,
      lane: 0,
      size,
      start,
    };
  });
}

function isAddressInRange(address: CellAddress, range?: CellRange) {
  return Boolean(
    range
      && address.columnIndex >= range.start.columnIndex
      && address.columnIndex <= range.end.columnIndex
      && address.rowIndex >= range.start.rowIndex
      && address.rowIndex <= range.end.rowIndex,
  );
}
