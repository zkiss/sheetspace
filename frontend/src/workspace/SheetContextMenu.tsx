import { useState } from 'react';
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
  const [scale, setScale] = useState(String(Math.round(sheet.frame.visualScale * 100)));
  const commitScale = () => {
    const value = Number(scale);
    if (Number.isFinite(value) && value > 0) onSetScale(sheet.id, value / 100);
  };
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
        <span className="sheet-context-menu-scale-label">Display scale</span>
        <label>
          <input aria-label="Display scale percentage" min="10" onChange={(event) => setScale(event.currentTarget.value)} onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commitScale();
          }} step="1" type="number" value={scale} />
          <span className="sheet-context-menu-scale-unit">%</span>
        </label>
        <button onClick={commitScale} type="button">Set scale</button>
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
