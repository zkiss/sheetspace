import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';
import {
  addressRangeOf,
  appendColumn,
  appendRow,
  cellAddressOf,
  cellIdentityAt,
  cellIdentityFromKey,
  cellIdentityKey,
  cellRawContent,
  commitCellRawContent,
  createEmptyWorkbook,
  findSheetByName,
  frameProjection,
  moveSheetZOrder,
  parseNamedA1Address,
  parseNamedA1Range,
  renameSheet,
  sheetsInOrder,
  stableRangeAt,
  tabularCellsByA1,
  tabularProjection,
  validateSheetName,
  type SheetDocument,
} from './workbook';

function sheet(id: string, name: string): SheetDocument {
  return sheetDocument({ id, name });
}

describe('workbook aggregates and projections', () => {
  it('creates an empty manifest with no loaded documents', () => {
    expect(createEmptyWorkbook()).toEqual({
      manifest: { version: 1, revision: 0, sheetIds: [] },
      documents: {},
    });
  });

  it('keeps manifest order independent from document object insertion order', () => {
    const first = sheet('sheet-1', 'Inputs');
    const second = sheet('sheet-2', 'Outputs');
    const workbook = {
      manifest: { version: 1 as const, revision: 7, sheetIds: [second.id, first.id] },
      documents: { [first.id]: first, [second.id]: second },
    };

    expect(sheetsInOrder(workbook)).toEqual([second, first]);
  });

  it('projects frame and tabular responsibilities without leaking the other state', () => {
    const document = sheetDocument({ id: 'sheet-1', name: 'Inputs', cells: { A1: '=1' } });

    const tabular = tabularProjection(document);
    expect(frameProjection(document)).toEqual({ id: 'sheet-1', name: 'Inputs', ...document.frame });
    expect(tabular).toEqual({
      id: 'sheet-1',
      name: 'Inputs',
      revision: 0,
      ...document.content,
    });
    expect(tabular.rows).toBe(document.content.rows);
    expect(tabular.columns).toBe(document.content.columns);
    expect(tabular.cells).toBe(document.content.cells);
    expect(frameProjection({ ...document, frame: { ...document.frame, position: { x: 9, y: 8 } } }))
      .not.toEqual(frameProjection(document));
  });

  it('rejects empty and duplicate names', () => {
    const existing = [sheet('sheet-1', 'Inputs')];
    expect(validateSheetName('   ', existing)).toEqual({ ok: false, reason: 'empty' });
    expect(validateSheetName('Inputs', existing)).toEqual({ ok: false, reason: 'duplicate' });
    expect(validateSheetName(' Inputs ', existing, 'sheet-1')).toEqual({ ok: true, name: 'Inputs' });
  });

  it('changes z-order without changing manifest membership order', () => {
    const workbook = workbookWithSheets([
      sheetDocument({ id: 'sheet-1', name: 'Inputs', zIndex: 1 }),
      sheetDocument({ id: 'sheet-2', name: 'Assumptions', zIndex: 2 }),
      sheetDocument({ id: 'sheet-3', name: 'Outputs', zIndex: 3 }),
    ]);
    const moved = moveSheetZOrder(workbook, 'sheet-1', 'up');

    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.manifest.sheetIds).toEqual(['sheet-1', 'sheet-2', 'sheet-3']);
    expect(sheetsInOrder(moved.value).map((candidate) => [candidate.id, candidate.frame.zIndex])).toEqual([
      ['sheet-1', 2], ['sheet-2', 1], ['sheet-3', 3],
    ]);
  });

  it('renames metadata without rewriting or cloning tabular content', () => {
    const original = sheetDocument({ id: 'sheet-1', name: 'Inputs', cells: { A1: " =SUM( 'Old Name'!A1 )\n" } });
    const result = renameSheet(workbookWithSheets([original]), original.id, 'Renamed');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const renamed = result.value.documents[original.id];
    expect(renamed.name).toBe('Renamed');
    expect(renamed.content).toBe(original.content);
    expect(cellRawContent(renamed, 'A1')).toBe(" =SUM( 'Old Name'!A1 )\n");
  });
});

describe('stable grid identity and A1 projection', () => {
  it('converts between ordered position and stable identity in both directions', () => {
    const document = sheetDocument({ id: 'sheet-1', name: 'Inputs', rowCount: 2, columnCount: 2 });
    const identity = cellIdentityAt(document.content, 'B2');

    expect(identity).toEqual({ rowId: 'sheet-1:row:2', columnId: 'sheet-1:column:2' });
    expect(cellAddressOf(document.content, identity!)).toEqual({ rowIndex: 1, columnIndex: 1 });
    expect(cellIdentityFromKey(cellIdentityKey(identity!))).toEqual(identity);
  });

  it('derives A1 from current row and column order instead of persisting position', () => {
    const document = sheetDocument({ id: 'sheet-1', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { A1: 'value' } });
    const reordered = {
      ...document.content,
      rows: [...document.content.rows].reverse(),
      columns: [...document.content.columns].reverse(),
    };

    expect(tabularCellsByA1(document.content)).toEqual({ A1: 'value' });
    expect(tabularCellsByA1(reordered)).toEqual({ B2: 'value' });
  });

  it('converts exact range corners to stable identities and back', () => {
    const content = sheetDocument({ id: 'sheet-1', name: 'Inputs', rowCount: 3, columnCount: 3 }).content;
    const positional = {
      start: { rowIndex: 1, columnIndex: 0 },
      end: { rowIndex: 2, columnIndex: 2 },
    };
    const stable = stableRangeAt(content, positional);

    expect(stable).toEqual({
      start: { rowId: 'sheet-1:row:2', columnId: 'sheet-1:column:1' },
      end: { rowId: 'sheet-1:row:3', columnId: 'sheet-1:column:3' },
    });
    expect(addressRangeOf(content, stable!)).toEqual(positional);
  });

  it('appends stable identities without changing content or earlier order', () => {
    const original = sheetDocument({ id: 'sheet-1', name: 'Inputs', cells: { A1: '42' } });
    const rowAdded = appendRow(original, 'row-new');
    const columnAdded = appendColumn(original, 'column-new');

    expect(rowAdded.content.rows).toEqual([...original.content.rows, 'row-new']);
    expect(columnAdded.content.columns).toEqual([...original.content.columns, 'column-new']);
    expect(rowAdded.content.cells).toBe(original.content.cells);
    expect(columnAdded.content.cells).toBe(original.content.cells);
  });

  it('commits and clears content by stable identity while preserving grid order', () => {
    const original = sheet('sheet-1', 'Inputs');
    const workbook = workbookWithSheets([original]);
    const withText = commitCellRawContent(workbook, original.id, 'A1', 'Region');
    const changed = withText.documents[original.id];

    expect(cellRawContent(changed, 'A1')).toBe('Region');
    expect(changed.content.rows).toBe(original.content.rows);
    expect(changed.content.columns).toBe(original.content.columns);
    const cleared = commitCellRawContent(withText, original.id, 'A1', '');
    expect(cellRawContent(cleared.documents[original.id], 'A1')).toBeUndefined();
  });

  it('leaves workbook unchanged for no-op or invalid cell commits', () => {
    const original = sheetDocument({ id: 'sheet-1', name: 'Inputs', cells: { A1: 'Original' } });
    const workbook = workbookWithSheets([original]);
    expect(commitCellRawContent(workbook, original.id, 'B1', '')).toBe(workbook);
    expect(commitCellRawContent(workbook, original.id, 'A1', 'Original')).toBe(workbook);
    expect(commitCellRawContent(workbook, 'missing', 'A1', 'Value')).toBe(workbook);
    expect(commitCellRawContent(workbook, original.id, 'Z999', 'Value')).toBe(workbook);
  });
});

describe('cross-sheet helpers', () => {
  it('finds sheets by current visible name', () => {
    const workbook = workbookWithSheets([sheet('sheet-1', 'Inputs')]);
    expect(findSheetByName(workbook, 'Inputs')).toEqual({ ok: true, value: workbook.documents['sheet-1'] });
    expect(findSheetByName(workbook, 'Missing')).toEqual({ ok: false, reason: 'unknown-sheet' });
  });

  it('parses same-sheet, unquoted, and quoted references over ordered bounds', () => {
    const inputs = sheet('sheet-1', 'Inputs');
    const sales = sheet('sheet-2', 'Sales Q1');
    const workbook = workbookWithSheets([inputs, sales]);

    expect(parseNamedA1Address('B2', workbook, inputs)).toEqual({
      ok: true, value: { columnIndex: 1, rowIndex: 1, sheetName: undefined },
    });
    expect(parseNamedA1Address('Inputs!A1', workbook)).toEqual({
      ok: true, value: { columnIndex: 0, rowIndex: 0, sheetName: 'Inputs' },
    });
    expect(parseNamedA1Range("'Sales Q1'!A1:B2", workbook)).toEqual({
      ok: true,
      value: {
        sheetName: 'Sales Q1',
        start: { columnIndex: 0, rowIndex: 0 },
        end: { columnIndex: 1, rowIndex: 1 },
      },
    });
  });

  it('rejects unknown sheets and malformed syntax', () => {
    const workbook = workbookWithSheets([sheet('sheet-1', 'Inputs')]);
    expect(parseNamedA1Address('Missing!A1', workbook)).toEqual({ ok: false, reason: 'unknown-sheet' });
    expect(parseNamedA1Address("'Missing!A1", workbook)).toEqual({ ok: false, reason: 'invalid-format' });
  });
});
