import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { cellKey } from '@workbook/core/address';
import type { SheetTabularProjection } from '@workbook/core/model';
import type { GridAxisProjection } from '@grid/gridAxisProjection';
import type { GridAxisMetrics } from './gridAxisMetrics';
import type { CellSelectionMode, CellTarget, SelectionGesture } from './cellInteractionContracts';
import type { SheetGridCellInteraction } from './SheetGridCell';
import { cellTargetAt } from '@grid/cellInteraction';
import { dragTargetForSource, savedAxisIndexAtOffset } from './sheetGridProjection';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from '@grid/gridGeometry';

type GridPointerSelectionOptions = {
  activeSheetId?: string | null;
  cellInteraction: SheetGridCellInteraction;
  columnMetrics: GridAxisMetrics;
  columns: GridAxisProjection['columns'];
  onSelectAxis?: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture) => void;
  rowMetrics: GridAxisMetrics;
  rows: GridAxisProjection['rows'];
  scrollContainerRef: RefObject<HTMLElement>;
  selectionOwner?: symbol | null;
  sheet: SheetTabularProjection;
};

type DragSession = {
  captureElement: HTMLDivElement;
  clientX: number;
  clientY: number;
  mode: CellSelectionMode;
  owner: symbol;
  pointerId: number;
  target: CellTarget | null;
};

type PointerScale = { x: number; y: number };

function pointerScale(container: HTMLElement, rect: DOMRect): PointerScale {
  return {
    x: rect.width ? container.clientWidth / rect.width : 1,
    y: rect.height ? container.clientHeight / rect.height : 1,
  };
}

function isNativeEditor(target: EventTarget | null) {
  const editor = target instanceof HTMLElement
    ? target.closest<HTMLElement>('textarea, input, [contenteditable]')
    : null;
  return Boolean(editor && (
    editor.matches('textarea, input')
    || editor.getAttribute('contenteditable')?.toLowerCase() !== 'false'
  ));
}

function isDragSource(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return !target.closest('button, a, .sheet-grid-resize-handle');
}

export function useGridPointerSelection({
  activeSheetId,
  cellInteraction,
  columnMetrics,
  columns,
  onSelectAxis,
  rowMetrics,
  rows,
  scrollContainerRef,
  selectionOwner,
  sheet,
}: GridPointerSelectionOptions) {
  const dragRef = useRef<DragSession | null>(null);
  const animationFrame = useRef(0);
  const [dragging, setDragging] = useState(false);
  const interactionRef = useRef(cellInteraction);
  const activeSheetRef = useRef(activeSheetId);
  const selectionOwnerRef = useRef(selectionOwner);

  interactionRef.current = cellInteraction;
  activeSheetRef.current = activeSheetId;
  selectionOwnerRef.current = selectionOwner;

  const ownsDrag = useCallback(() => {
    const drag = dragRef.current;
    return Boolean(drag && (
      selectionOwnerRef.current === undefined
      || selectionOwnerRef.current === drag.owner
    ));
  }, []);

  const finishDrag = useCallback((pointerId?: number, focusExtent = false) => {
    const drag = dragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;

    dragRef.current = null;
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = 0;
    if (drag.captureElement.hasPointerCapture?.(drag.pointerId)) {
      drag.captureElement.releasePointerCapture(drag.pointerId);
    }
    setDragging(false);
    if (focusExtent && drag.target) interactionRef.current.focusSelection?.(drag.target);
    interactionRef.current.settleSelectionGesture?.(drag.owner);
  }, []);

  const extendAxisSelection = useCallback((
    mode: Exclude<CellSelectionMode, 'cells'>,
    selectedAxis: GridAxisProjection['rows'][number] | GridAxisProjection['columns'][number] | undefined,
    fixedAxis: GridAxisProjection['rows'][number] | GridAxisProjection['columns'][number] | undefined,
    drag: DragSession,
  ) => {
    if (selectedAxis?.kind !== 'saved' || fixedAxis?.kind !== 'saved') return;
    const target = cellTargetAt(sheet, cellKey({
      columnIndex: mode === 'columns' ? selectedAxis.durableIndex : fixedAxis.durableIndex,
      rowIndex: mode === 'rows' ? selectedAxis.durableIndex : fixedAxis.durableIndex,
    }));
    if (!target) return;
    drag.target = target;
    onSelectAxis?.(mode, target, true, { owner: drag.owner });
  }, [onSelectAxis, sheet]);

  const extendCellSelection = useCallback((
    row: GridAxisProjection['rows'][number] | undefined,
    column: GridAxisProjection['columns'][number] | undefined,
    drag: DragSession,
  ) => {
    if (!interactionRef.current.extend || row?.kind !== 'saved' || column?.kind !== 'saved') return;
    const target = cellTargetAt(sheet, cellKey({
      columnIndex: column.durableIndex,
      rowIndex: row.durableIndex,
    }));
    if (!target) return;
    drag.target = target;
    interactionRef.current.extend(target, { owner: drag.owner });
  }, [sheet]);

  const extendDrag = useCallback((clientX: number, clientY: number) => {
    const container = scrollContainerRef.current;
    const drag = dragRef.current;
    if (!container || !drag) return;
    if ((activeSheetRef.current != null && activeSheetRef.current !== sheet.id) || !ownsDrag()) {
      finishDrag();
      return;
    }

    const rect = container.getBoundingClientRect();
    const scale = pointerScale(container, rect);
    const columnIndex = savedAxisIndexAtOffset(
      columns,
      columnMetrics,
      container.scrollLeft + (clientX - rect.left) * scale.x - GRID_ROW_HEADER_WIDTH,
    );
    const rowIndex = savedAxisIndexAtOffset(
      rows,
      rowMetrics,
      container.scrollTop + (clientY - rect.top) * scale.y - GRID_COLUMN_HEADER_HEIGHT,
    );
    const row = rowIndex === undefined ? undefined : rows[rowIndex];
    const column = columnIndex === undefined ? undefined : columns[columnIndex];

    if (drag.mode === 'columns') {
      extendAxisSelection('columns', column, rows.find((axis) => axis.kind === 'saved'), drag);
      return;
    }
    if (drag.mode === 'rows') {
      extendAxisSelection('rows', row, columns.find((axis) => axis.kind === 'saved'), drag);
      return;
    }
    extendCellSelection(row, column, drag);
  }, [columnMetrics, columns, extendAxisSelection, extendCellSelection, finishDrag, ownsDrag, rowMetrics, rows, scrollContainerRef, sheet]);

  useEffect(() => {
    const autoScroll = () => {
      const drag = dragRef.current;
      const container = scrollContainerRef.current;
      if (!drag || !container) return;
      if ((activeSheetRef.current != null && activeSheetRef.current !== sheet.id) || !ownsDrag()) {
        finishDrag();
        return;
      }

      const rect = container.getBoundingClientRect();
      const edge = 28;
      const horizontal = drag.mode === 'rows' ? 0 : edgeScrollDelta(drag.clientX, rect.left, rect.right, edge);
      const vertical = drag.mode === 'columns' ? 0 : edgeScrollDelta(drag.clientY, rect.top, rect.bottom, edge);
      if (horizontal || vertical) {
        container.scrollLeft += horizontal;
        container.scrollTop += vertical;
        extendDrag(drag.clientX, drag.clientY);
      }
      animationFrame.current = requestAnimationFrame(autoScroll);
    };

    if (dragging) animationFrame.current = requestAnimationFrame(autoScroll);
    return () => {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
      animationFrame.current = 0;
    };
  }, [dragging, extendDrag, finishDrag, ownsDrag, scrollContainerRef, sheet.id]);

  useEffect(() => {
    const cancelDrag = () => finishDrag();
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') finishDrag();
    };
    window.addEventListener('blur', cancelDrag);
    document.addEventListener('visibilitychange', cancelWhenHidden);
    return () => {
      window.removeEventListener('blur', cancelDrag);
      document.removeEventListener('visibilitychange', cancelWhenHidden);
    };
  }, [finishDrag]);

  useEffect(() => () => finishDrag(), [finishDrag, sheet.id]);
  useEffect(() => {
    if (activeSheetId != null && activeSheetId !== sheet.id) finishDrag();
  }, [activeSheetId, finishDrag, sheet.id]);
  useEffect(() => {
    if (dragRef.current && !ownsDrag()) finishDrag();
  }, [finishDrag, ownsDrag, selectionOwner]);

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isNativeEditor(event.target) || !isDragSource(event.target) || dragRef.current) return;
    const source = (event.target as HTMLElement).closest<HTMLElement>('[data-cell-key], [data-axis-selection-mode]');
    if (!source) return;

    const axisMode = source.dataset.axisSelectionMode as Exclude<CellSelectionMode, 'cells'> | undefined;
    const mode = axisMode ?? 'cells';
    const target = dragTargetForSource(source, mode, sheet, rows, columns);
    if (!target) return;

    const owner = Symbol('selection-gesture');
    const gesture: SelectionGesture = { owner, start: true };
    if (mode === 'cells') {
      if (event.shiftKey && cellInteraction.extend) cellInteraction.extend(target, gesture);
      else cellInteraction.select(target, gesture);
    } else {
      onSelectAxis?.(mode, target, event.shiftKey, gesture);
    }

    dragRef.current = {
      captureElement: event.currentTarget,
      clientX: event.clientX,
      clientY: event.clientY,
      mode,
      owner,
      pointerId: event.pointerId,
      target,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!ownsDrag() || (activeSheetRef.current != null && activeSheetRef.current !== sheet.id)) {
      finishDrag();
      return;
    }
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    extendDrag(event.clientX, event.clientY);
  };

  return {
    beginDrag,
    cancelDrag: (event: PointerEvent<HTMLDivElement>) => finishDrag(event.pointerId),
    completeDrag: (event: PointerEvent<HTMLDivElement>) => finishDrag(event.pointerId, ownsDrag()),
    dragging,
    finishDrag,
    moveDrag,
  };
}

function edgeScrollDelta(position: number, start: number, end: number, edge: number) {
  if (position < start + edge) return -18;
  if (position > end - edge) return 18;
  return 0;
}
