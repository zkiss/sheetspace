import type { RefObject } from 'react';
import type { ColumnHeader } from './sheetGridModel';

export function SheetGridHeaders({
  columnHeaderRef,
  columns,
}: {
  columnHeaderRef: RefObject<HTMLTableCellElement>;
  columns: ColumnHeader[];
}) {
  return (
    <thead>
      <tr>
        <th aria-label="Grid corner" className="sheet-grid-corner" scope="col" />
        {columns.map((column) => (
          <th
            className="sheet-grid-column-header"
            key={column.index}
            ref={column.index === 0 ? columnHeaderRef : undefined}
            scope="col"
          >
            {column.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}
