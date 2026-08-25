import type { RefObject } from 'react';
import type { GridAxisEntry } from './gridAxisProjection';
import { columnIndexToLabel, type ColumnId } from './workbook';

export function SheetGridHeaders({
  columnHeaderRef,
  columns,
}: {
  columnHeaderRef: RefObject<HTMLTableCellElement>;
  columns: readonly GridAxisEntry<ColumnId>[];
}) {
  return (
    <thead>
      <tr>
        <th aria-label="Grid corner" className="sheet-grid-corner" scope="col" />
        {columns.map((column) => (
          <th
            aria-label={column.kind === 'creating' ? 'Creating column' : undefined}
            className={`sheet-grid-column-header${column.kind === 'creating' ? ' sheet-grid-axis-creating' : ''}`}
            key={column.kind === 'creating' ? column.operationId : column.id}
            ref={column.kind === 'saved' && column.durableIndex === 0 ? columnHeaderRef : undefined}
            scope="col"
          >
            {column.kind === 'creating' ? 'Creating…' : columnIndexToLabel(column.durableIndex)}
          </th>
        ))}
      </tr>
    </thead>
  );
}
