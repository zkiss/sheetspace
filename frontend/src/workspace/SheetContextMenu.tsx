import { SheetDocument, SheetZOrderDirection } from '@workbook/core/model';
import type { PendingSheetMenu } from './workspaceContracts';
import { FLOATING_OVERLAY_Z_INDEX } from '@shared/styles/styleTokens';
import '@workspace/SheetContextMenu.css';

export function SheetContextMenu({
  menu,
  onAppendColumn,
  onAppendRow,
  onChangeZOrder,
  onDelete,
  onRename,
  onSetScale,
  sheet,
}: {
  menu: PendingSheetMenu;
  onAppendColumn: (sheetId: string) => void;
  onAppendRow: (sheetId: string) => void;
  onChangeZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  onDelete: (sheetId: string) => void;
  onRename: (sheet: SheetDocument) => void;
  onSetScale: (sheetId: string, visualScale: number) => void;
  sheet: SheetDocument;
}) {
  return (
    <div
      aria-label={`${sheet.name} sheet menu`}
      className="sheet-context-menu"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      role="menu"
      style={{
        left: menu.x,
        top: menu.y,
        zIndex: FLOATING_OVERLAY_Z_INDEX,
      }}
    >
      <button type="button" role="menuitem" onClick={() => onAppendRow(sheet.id)}>
        Append row
      </button>
      <button type="button" role="menuitem" onClick={() => onAppendColumn(sheet.id)}>
        Append column
      </button>
      <div aria-label="Display scale" className="sheet-context-menu-scale">
        <span>Display scale</span>
        {[0.5, 0.75, 1, 1.5].map((scale) => (
          <button
            aria-pressed={sheet.frame.visualScale === scale}
            key={scale}
            onClick={() => onSetScale(sheet.id, scale)}
            type="button"
          >
            {Math.round(scale * 100)}%
          </button>
        ))}
      </div>
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
      <button
        type="button"
        role="menuitem"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => onDelete(sheet.id)}
      >
        Delete
      </button>
    </div>
  );
}
