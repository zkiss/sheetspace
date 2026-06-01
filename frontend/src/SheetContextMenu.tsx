import type { Sheet, SheetZOrderDirection } from './workbook';
import type { PendingSheetMenu } from './appTypes';

export function SheetContextMenu({
  menu,
  onAppendColumn,
  onAppendRow,
  onChangeZOrder,
  onDelete,
  onRename,
  sheet,
}: {
  menu: PendingSheetMenu;
  onAppendColumn: (sheetId: string) => void;
  onAppendRow: (sheetId: string) => void;
  onChangeZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  onDelete: (sheetId: string) => void;
  onRename: (sheet: Sheet) => void;
  sheet: Sheet;
}) {
  return (
    <div
      aria-label={`${sheet.name} sheet menu`}
      className="sheet-context-menu"
      role="menu"
      style={{
        left: menu.x,
        top: menu.y,
      }}
    >
      <button type="button" role="menuitem" onClick={() => onAppendRow(sheet.id)}>
        Append row
      </button>
      <button type="button" role="menuitem" onClick={() => onAppendColumn(sheet.id)}>
        Append column
      </button>
      <button type="button" role="menuitem" onClick={() => onChangeZOrder(sheet.id, 'top')}>
        Bring to front
      </button>
      <button type="button" role="menuitem" onClick={() => onChangeZOrder(sheet.id, 'up')}>
        Bring forward
      </button>
      <button type="button" role="menuitem" onClick={() => onChangeZOrder(sheet.id, 'down')}>
        Send backward
      </button>
      <button type="button" role="menuitem" onClick={() => onChangeZOrder(sheet.id, 'bottom')}>
        Send to back
      </button>
      <button type="button" role="menuitem" onClick={() => onRename(sheet)}>
        Rename
      </button>
      <button type="button" data-sheet-menu-action="delete" role="menuitem" onClick={() => onDelete(sheet.id)}>
        Delete
      </button>
    </div>
  );
}
