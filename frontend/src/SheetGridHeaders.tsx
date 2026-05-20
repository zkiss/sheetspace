import type { ColumnHeader } from './sheetGridModel';

export function SheetGridHeaders({ columns }: { columns: ColumnHeader[] }) {
  return (
    <thead>
      <tr>
        <th aria-label="Grid corner" className="sheet-grid-corner" scope="col" />
        {columns.map((column) => (
          <th className="sheet-grid-column-header" key={column.index} scope="col">
            {column.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}
