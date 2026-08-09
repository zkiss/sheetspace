import {
  cellIdentityAt,
  cellIdentityKey,
  tabularCellsByA1,
  type CellKey,
  type SheetDocument,
  type Workbook,
  type WorkspacePosition,
} from '../workbook';

export function positionedSheet(id: string, name: string, position: WorkspacePosition): SheetDocument {
  return sheetDocument({ id, name, position });
}

export function sheetDocument({
  cells = {},
  columnCount = 10,
  frameSize = { width: 240, height: 160 },
  id,
  name,
  position = { x: 0, y: 0 },
  revision = 0,
  rowCount = 20,
  zIndex = 1,
}: {
  id: string;
  name: string;
  cells?: Record<CellKey, string>;
  columnCount?: number;
  frameSize?: { width: number; height: number };
  position?: WorkspacePosition;
  revision?: number;
  rowCount?: number;
  zIndex?: number;
}): SheetDocument {
  const content: SheetDocument['content'] = {
    kind: 'tabular',
    rows: Array.from({ length: rowCount }, (_, index) => `${id}:row:${index + 1}`),
    columns: Array.from({ length: columnCount }, (_, index) => `${id}:column:${index + 1}`),
    cells: {},
  };
  for (const [key, raw] of Object.entries(cells)) {
    const identity = cellIdentityAt(content, key);
    if (!identity) throw new Error(`Test cell ${key} is outside ${name}`);
    content.cells[cellIdentityKey(identity)] = raw;
  }
  return {
    id,
    name,
    revision,
    frame: { position, size: frameSize, zIndex },
    content,
  };
}

export function workbookWithSheets(sheets: readonly SheetDocument[], revision = 0): Workbook {
  const normalizedSheets = sheets.map(normalizeLegacyTestOverrides);
  return {
    manifest: { version: 1, revision, sheetIds: normalizedSheets.map((sheet) => sheet.id) },
    documents: Object.fromEntries(normalizedSheets.map((sheet) => [sheet.id, sheet])),
  };
}

/** Keeps older test literals readable while production consumes only SheetDocument. */
function normalizeLegacyTestOverrides(sheet: SheetDocument): SheetDocument {
  const overrides = sheet as SheetDocument & Partial<{
    cells: Record<CellKey, string>;
    columnCount: number;
    frameSize: { width: number; height: number };
    position: WorkspacePosition;
    rowCount: number;
    zIndex: number;
  }>;
  const hasLegacyOverride = ['cells', 'columnCount', 'frameSize', 'position', 'rowCount', 'zIndex']
    .some((key) => Object.prototype.hasOwnProperty.call(overrides, key));
  if (!hasLegacyOverride) return sheet;
  return sheetDocument({
    id: sheet.id,
    name: sheet.name,
    revision: sheet.revision,
    rowCount: overrides.rowCount ?? sheet.content.rows.length,
    columnCount: overrides.columnCount ?? sheet.content.columns.length,
    cells: overrides.cells ?? { ...tabularCellsByA1(sheet.content) },
    position: overrides.position ?? sheet.frame.position,
    frameSize: overrides.frameSize ?? sheet.frame.size,
    zIndex: overrides.zIndex ?? sheet.frame.zIndex,
  });
}
