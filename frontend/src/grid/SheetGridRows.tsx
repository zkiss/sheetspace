import { cellKey } from '@workbook/core/address';
import { cellKeyForTarget } from '@grid/cellInteraction';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { resolveCellAppearance } from '@workbook/core/numberFormat';
import { SheetGridCell } from './SheetGridCell';
import { AxisResizeHandle } from './AxisResizeHandle';
import { getSheetCellDisplayText } from './sheetGridModel';
import { axisKey, isAddressInRange } from './sheetGridProjection';

export function SheetGridRows(props: any) {
  const { activeCellKey, cellInteraction, columns, editingCell, editorInteraction, focusIntent, formulaResults, historyFeedbackCells, navigationHighlightCellKey, navigationHighlightIdentity, navigationHighlightRange, onNativeFocusTarget, onWriteAxisSizes, pendingCutCells, presentation, registerCell, resize, rowHeaderRef, rows, selectedRange, selectionMode, sheet, virtualColumns, virtualRows } = props;
  return <>
    {virtualRows.map((virtualRow: any) => {
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
              {row.kind === 'saved' && onWriteAxisSizes && <AxisResizeHandle axis="row" id={row.id}
                label={String(row.durableIndex + 1)} size={virtualRow.size} resize={resize} />}
            </div>
            {virtualColumns.map((virtualColumn: any) => {
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
               const selectionEdges = isRangeSelected && selectedRange ? [
                 address.rowIndex === selectedRange.start.rowIndex ? 'sheet-grid-selection-top' : '',
                 address.rowIndex === selectedRange.end.rowIndex ? 'sheet-grid-selection-bottom' : '',
                 address.columnIndex === selectedRange.start.columnIndex ? 'sheet-grid-selection-left' : '',
                 address.columnIndex === selectedRange.end.columnIndex ? 'sheet-grid-selection-right' : '',
               ].filter(Boolean).join(' ') : undefined;
              const isNavigationTarget = navigationHighlightRange
                ? isAddressInRange(address, navigationHighlightRange)
                : navigationHighlightCellKey === key;
               const historyFeedback = historyFeedbackCells?.get(key);
               const hasHistoryNeighbor = (rowIndex: number, columnIndex: number) => Boolean(
                  rowIndex >= 0 && columnIndex >= 0
                    && historyFeedbackCells?.has(cellKey({ rowIndex, columnIndex })),
               );
               const historyEdges = historyFeedback ? [
                 !hasHistoryNeighbor(address.rowIndex - 1, address.columnIndex) ? 'sheet-grid-history-top' : '',
                 !hasHistoryNeighbor(address.rowIndex + 1, address.columnIndex) ? 'sheet-grid-history-bottom' : '',
                 !hasHistoryNeighbor(address.rowIndex, address.columnIndex - 1) ? 'sheet-grid-history-left' : '',
                 !hasHistoryNeighbor(address.rowIndex, address.columnIndex + 1) ? 'sheet-grid-history-right' : '',
               ].filter(Boolean).join(' ') : undefined;
              const identity = cellIdentityAt(sheet, key);
              const appearance = identity ? resolveCellAppearance(presentation?.formatOverrides ?? { rows: {}, columns: {}, cells: {} }, identity) : undefined;

              return (
                <SheetGridCell
                  cellKey={key}
                  columnIndex={column.durableIndex + 2}
                  displayText={getSheetCellDisplayText({ cellKey: key, formulaResults, presentation, sheet })}
                  editingCell={editingCell}
                  cellInteraction={cellInteraction}
                  editorInteraction={editorInteraction}
                  isActive={isActive}
                  isEditing={isEditing}
                  isFocusTarget={focusIntent?.targetKey === key}
                  isNavigationTarget={isNavigationTarget}
                  navigationHighlightIdentity={navigationHighlightIdentity}
                    historyFeedback={historyFeedback}
                    historyEdges={historyEdges}
                    isRangeSelected={isRangeSelected}
                    selectionEdges={selectionEdges}
                    isPendingCut={pendingCutCells?.has(key)}
                  key={key}
                  onNativeFocusTarget={onNativeFocusTarget}
                  registerCell={registerCell}
                  sheet={sheet}
                  style={{
                    backgroundColor: appearance?.fillColor === 'none' ? '#ffffff' : appearance?.fillColor,
                    color: appearance?.textColor === 'automatic' ? undefined : appearance?.textColor,
                    fontWeight: appearance?.fontWeight,
                    height: virtualRow.size,
                    textAlign: appearance?.horizontalAlignment === 'general' ? undefined : appearance?.horizontalAlignment,
                    lineHeight: `${virtualRow.size}px`,
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
  </>;
}
