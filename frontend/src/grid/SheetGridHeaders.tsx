import type { CSSProperties, RefObject } from 'react';
import type { GridAxisEntry } from '@grid/gridAxisProjection';
import type { VirtualItem } from '@tanstack/react-virtual';
import { columnIndexToLabel } from '@workbook/core/address';
import { type ColumnId } from '@workbook/core/model';
import './SheetGrid.css';

export function SheetGridHeaders({
  columnHeaderRef,
  columns,
  virtualColumns,
}: {
  columnHeaderRef: RefObject<HTMLDivElement>;
  columns: readonly GridAxisEntry<ColumnId>[];
  virtualColumns: readonly VirtualItem[];
}) {
  return (
    <div
      aria-rowindex={1}
      className="sheet-grid-header-row"
      data-testid="sheet-grid-header-row"
      role="row"
      style={{ position: 'sticky', top: 0 }}
    >
      <div
        aria-colindex={1}
        aria-label="Grid corner"
        className="sheet-grid-corner"
        role="columnheader"
        style={{ left: 0, position: 'sticky', top: 0 }}
      />
      {virtualColumns.map((virtualColumn) => {
        const column = columns[virtualColumn.index];
        if (!column) return null;
        return (
          <div
            aria-hidden={column.kind === 'creating' ? true : undefined}
            aria-label={column.kind === 'creating' ? 'Creating column' : undefined}
            className={`sheet-grid-column-header${column.kind === 'creating' ? ' sheet-grid-axis-creating' : ''}`}
            key={column.kind === 'creating' ? column.operationId : column.id}
            ref={column.kind === 'saved' && column.durableIndex === 0 ? columnHeaderRef : undefined}
            aria-colindex={column.kind === 'saved' ? column.durableIndex + 2 : undefined}
            role="columnheader"
            style={{
              // The horizontal virtualizer's padding starts after the row header.
              // Its item coordinates therefore already share the data-cell origin.
              left: virtualColumn.start,
              minWidth: virtualColumn.size,
              position: 'absolute',
              top: 0,
              width: virtualColumn.size,
            } as CSSProperties}
          >
            {column.kind === 'creating' ? 'Creating…' : columnIndexToLabel(column.durableIndex)}
          </div>
        );
      })}
    </div>
  );
}
