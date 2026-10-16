import type { CSSProperties, RefObject } from 'react';
import type { VirtualItem } from '@tanstack/react-virtual';
import { cellKey } from '@workbook/core/address';
import { cellKeyForTarget } from '@grid/cellInteraction';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { resolveCellAppearance } from '@workbook/core/numberFormat';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import type { AxisSizeWrite, SheetPresentation, SheetTabularProjection } from '@workbook/core/model';
import type { GridAxisProjection } from '@grid/gridAxisProjection';
import type { CellEditSession, CellSelectionMode, CellTarget } from './cellInteractionContracts';
import { SheetGridCell, type SheetGridCellInteraction } from './SheetGridCell';
import type { SheetGridCellEditorInteraction } from './SheetGridCellEditor';
import { AxisResizeHandle } from './AxisResizeHandle';
import { getSheetCellDisplayText } from './sheetGridModel';
import { axisKey, isAddressInRange } from './sheetGridProjection';
import type { useAxisResize } from './useAxisResize';

type HistoryFeedback = { before: string | null; beforeDisplay: string | null; after: string | null };
type SheetGridRowsProps = {
  activeCellKey: string | null;
  cellInteraction: SheetGridCellInteraction;
  columns: GridAxisProjection['columns'];
  editingCell: CellEditSession | null;
  editorInteraction: SheetGridCellEditorInteraction;
  focusIntent: { targetKey: string } | null;
  formulaResults: FormulaEvaluationSnapshot;
  historyFeedbackCells?: ReadonlyMap<string, HistoryFeedback>;
  navigationHighlightCellKey: string | null;
  navigationHighlightIdentity?: number;
  navigationHighlightRange?: { start: { columnIndex: number; rowIndex: number }; end: { columnIndex: number; rowIndex: number } };
  onNativeFocusTarget?: (target: CellTarget) => void;
  onWriteAxisSizes?: (writes: readonly AxisSizeWrite[]) => void;
  pendingCutCells?: ReadonlySet<string>;
  presentation?: SheetPresentation;
  registerCell: (cellKey: string, element: HTMLElement | null) => void;
  resize: ReturnType<typeof useAxisResize>;
  rowHeaderRef: RefObject<HTMLDivElement>;
  rows: GridAxisProjection['rows'];
  selectedRange?: { start: { columnIndex: number; rowIndex: number }; end: { columnIndex: number; rowIndex: number } };
  selectionMode?: CellSelectionMode;
  sheet: SheetTabularProjection;
  virtualColumns: readonly VirtualItem[];
  virtualRows: readonly VirtualItem[];
};

const EMPTY_FORMAT_OVERRIDES = { rows: {}, columns: {}, cells: {} };

export function SheetGridRows(props: SheetGridRowsProps) {
  return <>
    {props.virtualRows.map((virtualRow) => (
      <SheetGridRow key={axisKey(props.rows[virtualRow.index])} props={props} virtualRow={virtualRow} />
    ))}
  </>;
}

function SheetGridRow({ props, virtualRow }: { props: SheetGridRowsProps; virtualRow: VirtualItem }) {
  const row = props.rows[virtualRow.index];
  if (!row) return null;

  return (
    <div
      aria-hidden={row.kind === 'creating' ? true : undefined}
      aria-rowindex={row.kind === 'saved' ? row.durableIndex + 2 : undefined}
      className="sheet-grid-row"
      role="row"
      style={{ height: virtualRow.size, top: virtualRow.start }}
    >
      <RowHeader props={props} row={row} virtualRow={virtualRow} />
      {props.virtualColumns.map((virtualColumn) => (
        <SheetGridRowCell
          key={axisKey(props.columns[virtualColumn.index])}
          props={props}
          row={row}
          virtualColumn={virtualColumn}
          virtualRow={virtualRow}
        />
      ))}
    </div>
  );
}

function RowHeader({ props, row, virtualRow }: {
  props: SheetGridRowsProps;
  row: GridAxisProjection['rows'][number];
  virtualRow: VirtualItem;
}) {
  const selected = row.kind === 'saved'
    && props.selectionMode === 'rows'
    && isAddressInRange({ rowIndex: row.durableIndex, columnIndex: 0 }, props.selectedRange);
  return (
    <div
      aria-label={row.kind === 'creating' ? 'Creating row' : undefined}
      aria-colindex={1}
      className={`sheet-grid-row-header${row.kind === 'creating' ? ' sheet-grid-axis-creating' : ''}${
        selected ? ' sheet-grid-axis-selected' : ''
      }`}
      data-axis-durable-index={row.kind === 'saved' ? row.durableIndex : undefined}
      data-axis-selection-mode={row.kind === 'saved' ? 'rows' : undefined}
      ref={row.kind === 'saved' && row.durableIndex === 0 ? props.rowHeaderRef : undefined}
      role="rowheader"
      style={{ height: virtualRow.size, left: 0, position: 'sticky' }}
    >
      {row.kind === 'creating' ? 'Creating…' : row.durableIndex + 1}
      {row.kind === 'saved' && props.onWriteAxisSizes && (
        <AxisResizeHandle axis="row" id={row.id} label={String(row.durableIndex + 1)} size={virtualRow.size} resize={props.resize} />
      )}
    </div>
  );
}

function SheetGridRowCell({ props, row, virtualColumn, virtualRow }: {
  props: SheetGridRowsProps;
  row: GridAxisProjection['rows'][number];
  virtualColumn: VirtualItem;
  virtualRow: VirtualItem;
}) {
  const column = props.columns[virtualColumn.index];
  if (!column) return null;
  if (row.kind === 'creating' || column.kind === 'creating') {
    return <CreatingCell column={column} virtualColumn={virtualColumn} virtualRow={virtualRow} />;
  }
  return <SavedCell
    column={column}
    props={props}
    row={row}
    virtualColumn={virtualColumn}
    virtualRow={virtualRow}
  />;
}

function CreatingCell({ column, virtualColumn, virtualRow }: {
  column: GridAxisProjection['columns'][number];
  virtualColumn: VirtualItem;
  virtualRow: VirtualItem;
}) {
  return <div
    aria-hidden="true"
    aria-label="Creating cell"
    aria-colindex={column.kind === 'saved' ? column.durableIndex + 2 : undefined}
    className="sheet-grid-cell sheet-grid-cell-creating"
    key={column.kind === 'creating' ? column.operationId : column.id}
    role="cell"
    style={cellStyle(virtualColumn, virtualRow)}
  />;
}

function SavedCell({ column, props, row, virtualColumn, virtualRow }: {
  column: Extract<GridAxisProjection['columns'][number], { kind: 'saved' }>;
  props: SheetGridRowsProps;
  row: Extract<GridAxisProjection['rows'][number], { kind: 'saved' }>;
  virtualColumn: VirtualItem;
  virtualRow: VirtualItem;
}) {
  const address = { columnIndex: column.durableIndex, rowIndex: row.durableIndex };
  const key = cellKey(address);
  const rangeSelected = isAddressInRange(address, props.selectedRange);
  const historyFeedback = props.historyFeedbackCells?.get(key);
  const identity = cellIdentityAt(props.sheet, key);
  const appearance = identity
    ? resolveCellAppearance(props.presentation?.formatOverrides ?? EMPTY_FORMAT_OVERRIDES, identity)
    : undefined;

  return <SheetGridCell
    cellInteraction={props.cellInteraction}
    cellKey={key}
    columnIndex={column.durableIndex + 2}
    displayText={getSheetCellDisplayText({ cellKey: key, formulaResults: props.formulaResults, presentation: props.presentation, sheet: props.sheet })}
    editingCell={props.editingCell}
    editorInteraction={props.editorInteraction}
    historyEdges={historyFeedback ? historySelectionEdges(address, props.historyFeedbackCells) : undefined}
    historyFeedback={historyFeedback}
    isActive={props.activeCellKey === key}
    isEditing={cellKeyForTarget(props.sheet, props.editingCell?.target ?? null) === key}
    isFocusTarget={props.focusIntent?.targetKey === key}
    isNavigationTarget={props.navigationHighlightRange
      ? isAddressInRange(address, props.navigationHighlightRange)
      : props.navigationHighlightCellKey === key}
    isPendingCut={props.pendingCutCells?.has(key)}
    isRangeSelected={rangeSelected}
    navigationHighlightIdentity={props.navigationHighlightIdentity}
    onNativeFocusTarget={props.onNativeFocusTarget}
    registerCell={props.registerCell}
    selectionEdges={rangeSelected ? selectionEdges(address, props.selectedRange) : undefined}
    sheet={props.sheet}
    style={cellStyle(virtualColumn, virtualRow, appearance)}
    tabIndex={props.activeCellKey === key ? 0 : -1}
  />;
}

function cellStyle(virtualColumn: VirtualItem, virtualRow: VirtualItem, appearance?: ReturnType<typeof resolveCellAppearance>): CSSProperties {
  return {
    backgroundColor: appearance?.fillColor === 'none' ? '#ffffff' : appearance?.fillColor,
    color: appearance?.textColor === 'automatic' ? undefined : appearance?.textColor,
    fontWeight: appearance?.fontWeight,
    height: virtualRow.size,
    left: virtualColumn.start,
    lineHeight: `${virtualRow.size}px`,
    minWidth: virtualColumn.size,
    position: 'absolute',
    textAlign: appearance?.horizontalAlignment === 'general' ? undefined : appearance?.horizontalAlignment,
    width: virtualColumn.size,
  };
}

function selectionEdges(address: { columnIndex: number; rowIndex: number }, range: SheetGridRowsProps['selectedRange']) {
  if (!range) return undefined;
  return [
    address.rowIndex === range.start.rowIndex ? 'sheet-grid-selection-top' : '',
    address.rowIndex === range.end.rowIndex ? 'sheet-grid-selection-bottom' : '',
    address.columnIndex === range.start.columnIndex ? 'sheet-grid-selection-left' : '',
    address.columnIndex === range.end.columnIndex ? 'sheet-grid-selection-right' : '',
  ].filter(Boolean).join(' ');
}

function historySelectionEdges(address: { columnIndex: number; rowIndex: number }, cells?: ReadonlyMap<string, HistoryFeedback>) {
  const hasNeighbor = (rowIndex: number, columnIndex: number) => rowIndex >= 0
    && columnIndex >= 0
    && cells?.has(cellKey({ rowIndex, columnIndex }));
  return [
    !hasNeighbor(address.rowIndex - 1, address.columnIndex) ? 'sheet-grid-history-top' : '',
    !hasNeighbor(address.rowIndex + 1, address.columnIndex) ? 'sheet-grid-history-bottom' : '',
    !hasNeighbor(address.rowIndex, address.columnIndex - 1) ? 'sheet-grid-history-left' : '',
    !hasNeighbor(address.rowIndex, address.columnIndex + 1) ? 'sheet-grid-history-right' : '',
  ].filter(Boolean).join(' ');
}
