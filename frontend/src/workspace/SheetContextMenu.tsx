import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  clampSheetVisualScale,
  MAX_SHEET_VISUAL_SCALE,
  MIN_SHEET_VISUAL_SCALE,
  SheetDocument,
  SheetZOrderDirection,
} from '@workbook/core/model';
import { SheetSortingControls, type SortingSubmission } from './SheetSortingControls';
import type { SortCriterion } from '@workbook/core/model';
import type { PendingSheetMenu } from './workspaceContracts';
import { FLOATING_OVERLAY_Z_INDEX } from '@shared/styles/styleTokens';
import '@workspace/SheetContextMenu.css';

export function SheetContextMenu({
  menu,
  modelControls,
  sorting,
  extraction,
  onAppendColumn,
  onAppendRow,
  onChangeZOrder,
  onDelete,
  onRename,
  onSetScale,
  sheet,
}: {
  menu: PendingSheetMenu;
  modelControls?: ReactNode;
  sorting?: { labels?: ReadonlyMap<string, string>; apply: (sheetId: string, criteria: readonly SortCriterion[]) => SortingSubmission };
  extraction?: { run: () => void; unavailable?: string };
  onAppendColumn: (sheetId: string) => void;
  onAppendRow: (sheetId: string) => void;
  onChangeZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  onDelete: (sheetId: string) => void;
  onRename: (sheet: SheetDocument) => void;
  onSetScale: (sheetId: string, visualScale: number) => void;
  sheet: SheetDocument;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = overlay.current;
    if (!element) return;
    const position = () => {
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(0, Math.min(menu.x, window.innerWidth - bounds.width))}px`;
      element.style.top = `${Math.max(0, Math.min(menu.y, window.innerHeight - bounds.height))}px`;
    };
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(element);
    window.addEventListener('resize', position);
    return () => { observer?.disconnect(); window.removeEventListener('resize', position); };
  }, [menu.x, menu.y]);
  const [scale, setScale] = useState(String(sheet.frame.visualScale * 100));
  useEffect(() => setScale(String(sheet.frame.visualScale * 100)), [sheet.id, sheet.frame.visualScale]);
  const commitScale = () => {
    const value = Number(scale);
    if (Number.isFinite(value) && value > 0) onSetScale(sheet.id, clampSheetVisualScale(value / 100));
  };
  return (
    <div
      ref={overlay}
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
      {!sheet.modelId && <><button type="button" role="menuitem" onClick={() => onAppendRow(sheet.id)}>
        Append row
      </button>
      <button type="button" role="menuitem" onClick={() => onAppendColumn(sheet.id)}>
        Append column
      </button></>}
      {extraction && <button type="button" role="menuitem" disabled={Boolean(extraction.unavailable)} title={extraction.unavailable} onClick={extraction.run}>Extract to new sheet</button>}
      <div aria-label="Display scale" className="sheet-context-menu-scale">
        <span className="sheet-context-menu-scale-label">Display scale</span>
        <label>
          <input aria-label="Display scale percentage" max={MAX_SHEET_VISUAL_SCALE * 100} min={MIN_SHEET_VISUAL_SCALE * 100} onChange={(event) => setScale(event.currentTarget.value)} onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commitScale();
          }} step="1" type="number" value={scale} />
          <span className="sheet-context-menu-scale-unit">%</span>
        </label>
        <button onClick={commitScale} type="button">Set scale</button>
      </div>
      {sorting && <SheetSortingControls sheet={sheet} labels={sorting.labels} onApply={sorting.apply} />}
      {modelControls}
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
