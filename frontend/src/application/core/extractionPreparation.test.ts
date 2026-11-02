import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { resolveCellAppearance } from '@workbook/core/numberFormat';
import { WORKBOOK_SCHEMA_VERSION, type Workbook } from '@workbook/core/model';
import { prepareExtraction, type ExtractionRequest } from './extractionPreparation';

const key = (rowId: string, columnId: string) => cellIdentityKey({ rowId, columnId });
function fixture(): Workbook {
  return { manifest: { version: WORKBOOK_SCHEMA_VERSION, revision: 0, sheetIds: ['s'] }, documents: { s: {
    id: 's', revision: 0, name: 'Source', frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, visualScale: 2, zIndex: 1 },
    content: { kind: 'tabular', rows: ['r1', 'r2', 'r3'], columns: ['c1', 'c2'], cells: { [key('r2', 'c2')]: '=A3' } },
    columnNames: { c2: 'Named' }, presentation: { rowHeights: { r2: 44 }, columnWidths: { c2: 90 }, formatOverrides: {
      rows: { r2: { fontWeight: 'bold', textColor: '#123456' } }, columns: { c2: { fillColor: '#abcdef', fontWeight: 'normal' } }, cells: { [key('r2', 'c2')]: { horizontalAlignment: 'right' }, [key('r3', 'c2')]: { fontWeight: 'bold' } },
    } },
  } } };
}
function request(): ExtractionRequest { return { sourceSheetId: 's', selection: { kind: 'cells', start: { rowId: 'r3', columnId: 'c2' }, end: { rowId: 'r2', columnId: 'c1' } }, targetSheetId: 't', targetName: ' Target ', targetRows: ['a', 'b'], targetColumns: ['x', 'y'], frame: { position: { x: 4, y: 5 }, size: { width: 200, height: 150 }, zIndex: 2 } }; }
function mappings(rows: string[], columns: string[], targetRows: string[], targetColumns: string[]) {
  return rows.flatMap((rowId, r) => columns.map((columnId, c) => ({
    source: { sheetId: 's', cell: { rowId, columnId } },
    destination: { sheetId: 't', cell: { rowId: targetRows[r], columnId: targetColumns[c] } },
  })));
}

describe('extraction preparation', () => {
  it('normalizes a reversed rectangle and preserves scoped appearance without copying content', () => {
    const workbook = fixture(), before = structuredClone(workbook);
    const result = prepareExtraction(workbook, request());
    expect(result.ok).toBe(true); if (!result.ok) return;
    const { value } = result, target = value.workbook.documents.t!;
    expect(value.origin).toEqual({ row: 1, column: 0 });
    expect(value.extents).toEqual({ rowCount: 2, columnCount: 2 });
    expect(value.mappings).toEqual(mappings(['r2', 'r3'], ['c1', 'c2'], ['a', 'b'], ['x', 'y']));
    expect(value.snapshot.cells[0]![1]!.raw).toBe('=A3');
    expect(value.snapshot.cells[1]![0]!.raw).toBe('');
    expect(target.content.cells).toEqual({});
    expect(target.columnNames).toEqual({ y: 'Named' });
    expect(target.presentation.rowHeights).toEqual({ a: 44 });
    expect(target.presentation.columnWidths).toEqual({ y: 90 });
    expect(target.frame.visualScale).toBe(2);
    for (const mapping of value.mappings) expect(resolveCellAppearance(target.presentation.formatOverrides!, mapping.destination.cell)).toEqual(resolveCellAppearance(workbook.documents.s!.presentation.formatOverrides!, mapping.source.cell));
    target.presentation.formatOverrides!.rows.a!.textColor = '#ffffff';
    expect(workbook).toEqual(before);
  });
  it('expands whole rows and columns, including all axes and empty opposite dimensions', () => {
    const workbook = fixture();
    const rows = prepareExtraction(workbook, { ...request(), selection: { kind: 'rows', start: 'r3', end: 'r1' }, targetRows: ['a', 'b', 'c'] });
    expect(rows.ok && rows.value.mappings).toEqual(mappings(['r1', 'r2', 'r3'], ['c1', 'c2'], ['a', 'b', 'c'], ['x', 'y']));
    expect(rows.ok && rows.value.workbook.documents.t!.columnNames).toEqual({ y: 'Named' });
    const columns = prepareExtraction(workbook, { ...request(), selection: { kind: 'columns', start: 'c2', end: 'c2' }, targetRows: ['a', 'b', 'c'], targetColumns: ['x'] });
    expect(columns.ok && columns.value.mappings).toEqual(mappings(['r1', 'r2', 'r3'], ['c2'], ['a', 'b', 'c'], ['x']));
    const singleRow = prepareExtraction(workbook, { ...request(), selection: { kind: 'rows', start: 'r2', end: 'r2' }, targetRows: ['a'] });
    expect(singleRow.ok && singleRow.value.mappings).toEqual(mappings(['r2'], ['c1', 'c2'], ['a'], ['x', 'y']));
    const multipleRows = prepareExtraction(workbook, { ...request(), selection: { kind: 'rows', start: 'r2', end: 'r3' } });
    expect(multipleRows.ok && multipleRows.value.mappings).toEqual(mappings(['r2', 'r3'], ['c1', 'c2'], ['a', 'b'], ['x', 'y']));
    const allColumns = prepareExtraction(workbook, { ...request(), selection: { kind: 'columns', start: 'c2', end: 'c1' }, targetRows: ['a', 'b', 'c'] });
    expect(allColumns.ok && allColumns.value.mappings).toEqual(mappings(['r1', 'r2', 'r3'], ['c1', 'c2'], ['a', 'b', 'c'], ['x', 'y']));
    workbook.documents.s!.content.rows = [];
    const empty = prepareExtraction(workbook, { ...request(), selection: { kind: 'columns', start: 'c2', end: 'c1' }, targetRows: [] });
    expect(empty.ok && empty.value.mappings).toEqual([]);
    expect(empty.ok && empty.value.extents).toEqual({ rowCount: 0, columnCount: 2 });
    const noColumns = fixture();
    noColumns.documents.s!.content.columns = [];
    const emptyRows = prepareExtraction(noColumns, { ...request(), selection: { kind: 'rows', start: 'r3', end: 'r1' }, targetRows: ['a', 'b', 'c'], targetColumns: [] });
    expect(emptyRows.ok && emptyRows.value.mappings).toEqual([]);
    expect(emptyRows.ok && emptyRows.value.extents).toEqual({ rowCount: 3, columnCount: 0 });
  });
  it('rejects invalid requests without modifying the input', () => {
    const workbook = fixture(), before = structuredClone(workbook), base = request();
    const cases: [ExtractionRequest, string][] = [
      [{ ...base, sourceSheetId: 'missing' }, 'unknown-source'],
      [{ ...base, sourceSheetId: 'toString' }, 'unknown-source'], [{ ...base, sourceSheetId: '__proto__' }, 'unknown-source'],
      [{ ...base, selection: { kind: 'rows', start: 'r1', end: 'stale' } }, 'invalid-selection'],
      [{ ...base, targetSheetId: 's' }, 'invalid-target-id'], [{ ...base, targetSheetId: '' }, 'invalid-target-id'],
      [{ ...base, targetName: ' ' }, 'empty-target-name'], [{ ...base, targetName: 'Source' }, 'duplicate-target-name'],
      [{ ...base, targetRows: ['a', 'a'] }, 'invalid-target-axes'], [{ ...base, targetColumns: ['x', 'c1'] }, 'invalid-target-axes'],
      [{ ...base, frame: { ...base.frame, size: { width: 0, height: 2 } } }, 'invalid-frame'],
    ];
    for (const [input, reason] of cases) expect(prepareExtraction(workbook, input)).toEqual({ ok: false, reason });
    expect(workbook).toEqual(before);
    workbook.documents.s!.modelId = 'model';
    expect(prepareExtraction(workbook, base)).toEqual({ ok: false, reason: 'protected-source' });
  });
});
