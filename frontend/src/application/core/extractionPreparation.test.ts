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
function request(): ExtractionRequest { return { sourceSheetId: 's', selection: { kind: 'cells', start: { rowId: 'r3', columnId: 'c2' }, end: { rowId: 'r2', columnId: 'c1' } }, targetSheetId: '00000000-0000-4000-8000-000000000001', targetName: ' Target ', targetRows: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'], targetColumns: ['00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006'], frame: { position: { x: 4, y: 5 }, size: { width: 200, height: 150 }, zIndex: 2 } }; }
function mappings(rows: string[], columns: string[], targetRows: string[], targetColumns: string[]) {
  return rows.flatMap((rowId, r) => columns.map((columnId, c) => ({
    source: { sheetId: 's', cell: { rowId, columnId } },
    destination: { sheetId: '00000000-0000-4000-8000-000000000001', cell: { rowId: targetRows[r], columnId: targetColumns[c] } },
  })));
}

describe('extraction preparation', () => {
  it('normalizes a reversed rectangle and preserves scoped appearance without copying content', () => {
    const workbook = fixture(), before = structuredClone(workbook);
    const result = prepareExtraction(workbook, request());
    expect(result.ok).toBe(true); if (!result.ok) return;
    const { value } = result, target = value.workbook.documents['00000000-0000-4000-8000-000000000001']!;
    expect(value.origin).toEqual({ row: 1, column: 0 });
    expect(value.extents).toEqual({ rowCount: 2, columnCount: 2 });
    expect(value.mappings).toEqual(mappings(['r2', 'r3'], ['c1', 'c2'], ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'], ['00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006']));
    expect(value.snapshot.cells[0]![1]!.raw).toBe('=A3');
    expect(value.snapshot.cells[1]![0]!.raw).toBe('');
    expect(target.content.cells).toEqual({});
    expect(target.columnNames).toEqual({ ['00000000-0000-4000-8000-000000000006']: 'Named' });
    expect(target.presentation.rowHeights).toEqual({ ['00000000-0000-4000-8000-000000000002']: 44 });
    expect(target.presentation.columnWidths).toEqual({ ['00000000-0000-4000-8000-000000000006']: 90 });
    expect(target.frame.visualScale).toBe(2);
    for (const mapping of value.mappings) expect(resolveCellAppearance(target.presentation.formatOverrides!, mapping.destination.cell)).toEqual(resolveCellAppearance(workbook.documents.s!.presentation.formatOverrides!, mapping.source.cell));
    target.presentation.formatOverrides!.rows['00000000-0000-4000-8000-000000000002']!.textColor = '#ffffff';
    expect(workbook).toEqual(before);
  });
  it('expands whole rows and columns, including all axes and empty opposite dimensions', () => {
    const workbook = fixture();
    const rows = prepareExtraction(workbook, { ...request(), selection: { kind: 'rows', start: 'r3', end: 'r1' }, targetRows: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'] });
    expect(rows.ok && rows.value.mappings).toEqual(mappings(['r1', 'r2', 'r3'], ['c1', 'c2'], ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'], ['00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006']));
    expect(rows.ok && rows.value.workbook.documents['00000000-0000-4000-8000-000000000001']!.columnNames).toEqual({ ['00000000-0000-4000-8000-000000000006']: 'Named' });
    const columns = prepareExtraction(workbook, { ...request(), selection: { kind: 'columns', start: 'c2', end: 'c2' }, targetRows: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'], targetColumns: ['00000000-0000-4000-8000-000000000005'] });
    expect(columns.ok && columns.value.mappings).toEqual(mappings(['r1', 'r2', 'r3'], ['c2'], ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'], ['00000000-0000-4000-8000-000000000005']));
    const singleRow = prepareExtraction(workbook, { ...request(), selection: { kind: 'rows', start: 'r2', end: 'r2' }, targetRows: ['00000000-0000-4000-8000-000000000002'] });
    expect(singleRow.ok && singleRow.value.mappings).toEqual(mappings(['r2'], ['c1', 'c2'], ['00000000-0000-4000-8000-000000000002'], ['00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006']));
    const multipleRows = prepareExtraction(workbook, { ...request(), selection: { kind: 'rows', start: 'r2', end: 'r3' } });
    expect(multipleRows.ok && multipleRows.value.mappings).toEqual(mappings(['r2', 'r3'], ['c1', 'c2'], ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'], ['00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006']));
    const allColumns = prepareExtraction(workbook, { ...request(), selection: { kind: 'columns', start: 'c2', end: 'c1' }, targetRows: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'] });
    expect(allColumns.ok && allColumns.value.mappings).toEqual(mappings(['r1', 'r2', 'r3'], ['c1', 'c2'], ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'], ['00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006']));
    workbook.documents.s!.content.rows = [];
    const empty = prepareExtraction(workbook, { ...request(), selection: { kind: 'columns', start: 'c2', end: 'c1' }, targetRows: [] });
    expect(empty.ok && empty.value.mappings).toEqual([]);
    expect(empty.ok && empty.value.extents).toEqual({ rowCount: 0, columnCount: 2 });
    const noColumns = fixture();
    noColumns.documents.s!.content.columns = [];
    const emptyRows = prepareExtraction(noColumns, { ...request(), selection: { kind: 'rows', start: 'r3', end: 'r1' }, targetRows: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'], targetColumns: [] });
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
      [{ ...base, targetRows: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'] }, 'invalid-target-axes'], [{ ...base, targetColumns: ['00000000-0000-4000-8000-000000000005', 'c1'] }, 'invalid-target-axes'],
      [{ ...base, frame: { ...base.frame, size: { width: 0, height: 2 } } }, 'invalid-frame'],
    ];
    for (const [input, reason] of cases) expect(prepareExtraction(workbook, input)).toEqual({ ok: false, reason });
    expect(workbook).toEqual(before);
    workbook.documents.s!.modelId = 'model';
    expect(prepareExtraction(workbook, base)).toEqual({ ok: false, reason: 'protected-source' });
  });
  it('requires canonical persisted UUIDs and rejects canonical identity collisions', () => {
    const workbook = fixture(), base = request(), before = structuredClone(workbook);
    const id = 'abcdefab-cdef-1234-5678-abcdefabcdef';
    expect(prepareExtraction(workbook, { ...base, targetSheetId: id }).ok).toBe(true);
    expect(prepareExtraction(workbook, { ...base, targetSheetId: 't' })).toEqual({ ok: false, reason: 'invalid-target-id' });
    expect(prepareExtraction(workbook, { ...base, targetSheetId: id.toUpperCase() })).toEqual({ ok: false, reason: 'invalid-target-id' });
    expect(prepareExtraction(workbook, { ...base, targetRows: ['a', base.targetRows[1]!] })).toEqual({ ok: false, reason: 'invalid-target-axes' });
    expect(prepareExtraction(workbook, { ...base, targetRows: [id.toUpperCase(), base.targetRows[1]!] })).toEqual({ ok: false, reason: 'invalid-target-axes' });
    expect(workbook).toEqual(before);
    workbook.manifest.sheetIds.push(id.toUpperCase());
    expect(prepareExtraction(workbook, { ...base, targetSheetId: id })).toEqual({ ok: false, reason: 'invalid-target-id' });
    workbook.documents.s!.content.rows.push(id.toUpperCase());
    expect(prepareExtraction(workbook, { ...base, targetRows: [id, base.targetRows[1]!] })).toEqual({ ok: false, reason: 'invalid-target-axes' });
    expect(prepareExtraction(fixture(), { ...base, targetRows: [id, id] })).toEqual({ ok: false, reason: 'invalid-target-axes' });
    for (const collision of ['document', 'row', 'column'] as const) {
      const current = fixture();
      if (collision === 'document') current.documents[id.toUpperCase()] = current.documents.s!;
      else current.documents.s!.content[collision === 'row' ? 'rows' : 'columns'].push(id.toUpperCase());
      const input = collision === 'document' ? { ...base, targetSheetId: id } : { ...base, targetColumns: [id, base.targetColumns[1]!] };
      const snapshot = structuredClone({ current, input });
      expect(prepareExtraction(current, input)).toEqual({ ok: false, reason: collision === 'document' ? 'invalid-target-id' : 'invalid-target-axes' });
      expect({ current, input }).toEqual(snapshot);
    }
  });
  it('validates the complete persisted frame contract without mutating inputs', () => {
    const base = request();
    const invalidFrames: ExtractionRequest['frame'][] = [];
    for (const value of [NaN, Infinity, -Infinity]) {
      invalidFrames.push({ ...base.frame, position: { ...base.frame.position, x: value } }, { ...base.frame, position: { ...base.frame.position, y: value } });
    }
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      invalidFrames.push({ ...base.frame, size: { ...base.frame.size, width: value } }, { ...base.frame, size: { ...base.frame.size, height: value } });
    }
    for (const zIndex of [0, -1, 1.5, NaN, Infinity, -Infinity, 2147483648, Number.MAX_SAFE_INTEGER + 1]) invalidFrames.push({ ...base.frame, zIndex });
    invalidFrames.push(undefined as unknown as ExtractionRequest['frame'], { ...base.frame, position: undefined! }, { ...base.frame, size: undefined! });
    for (const frame of invalidFrames) {
      const workbook = fixture(), input = { ...base, frame }, before = structuredClone({ workbook, input });
      expect(prepareExtraction(workbook, input)).toEqual({ ok: false, reason: 'invalid-frame' });
      expect({ workbook, input }).toEqual(before);
    }
    for (const scale of [NaN, Infinity, -Infinity, 0.099, 8.001]) {
      const workbook = fixture(), input = request();
      workbook.documents.s!.frame.visualScale = scale;
      const before = structuredClone({ workbook, input });
      expect(prepareExtraction(workbook, input)).toEqual({ ok: false, reason: 'invalid-frame' });
      expect({ workbook, input }).toEqual(before);
    }
    for (const [scale, zIndex] of [[0.1, 1], [8, 2147483647]] as const) {
      const workbook = fixture(), input = request();
      workbook.documents.s!.frame.visualScale = scale;
      input.frame = { position: { x: -1.5, y: -0.25 }, size: { width: 0.5, height: 1.25 }, zIndex };
      const before = structuredClone({ workbook, input }), result = prepareExtraction(workbook, input);
      expect(result.ok && result.value.workbook.documents[input.targetSheetId]!.frame).toEqual({ ...input.frame, visualScale: scale });
      expect({ workbook, input }).toEqual(before);
    }
  });
  it('rejects invalid request boundaries with exact reasons and unchanged inputs', () => {
    const base = request(), id = 'abcdefab-cdef-1234-5678-abcdefabcdef';
    const cases: [ExtractionRequest, string][] = [
      [{ ...base, selection: { kind: 'other' } as unknown as ExtractionRequest['selection'] }, 'invalid-selection'],
      [{ ...base, selection: { kind: 'cells', start: undefined!, end: { rowId: 'r1', columnId: 'c1' } } }, 'invalid-selection'],
      [{ ...base, selection: { kind: 'columns', start: 'stale', end: 'c1' } }, 'invalid-selection'],
      [{ ...base, targetSheetId: id.toUpperCase() }, 'invalid-target-id'],
      [{ ...base, targetSheetId: ' ' }, 'invalid-target-id'],
      [{ ...base, targetName: '  ' }, 'empty-target-name'],
      [{ ...base, targetName: ' Source ' }, 'duplicate-target-name'],
      [{ ...base, targetRows: [] }, 'invalid-target-axes'],
      [{ ...base, targetColumns: [] }, 'invalid-target-axes'],
      [{ ...base, targetRows: null! }, 'invalid-target-axes'],
      [{ ...base, targetColumns: null! }, 'invalid-target-axes'],
      [{ ...base, targetRows: [id, id] }, 'invalid-target-axes'],
      [{ ...base, targetColumns: [base.targetRows[0]!, base.targetColumns[1]!] }, 'invalid-target-axes'],
      [{ ...base, targetColumns: ['bad', base.targetColumns[1]!] }, 'invalid-target-axes'],
    ];
    for (const [input, reason] of cases) {
      const workbook = fixture(), before = structuredClone({ workbook, input });
      expect(prepareExtraction(workbook, input)).toEqual({ ok: false, reason });
      expect({ workbook, input }).toEqual(before);
    }
    for (const field of ['modelId', 'modelColumnBindings', 'modelFormulaBindings'] as const) {
      const workbook = fixture(), input = request();
      Object.assign(workbook.documents.s!, { [field]: field === 'modelId' ? 'model' : {} });
      const before = structuredClone({ workbook, input });
      expect(prepareExtraction(workbook, input)).toEqual({ ok: false, reason: 'protected-source' });
      expect({ workbook, input }).toEqual(before);
    }
    const workbook = fixture(), input = { ...base, targetName: ' source ', targetSheetId: id };
    const result = prepareExtraction(workbook, input);
    expect(result.ok && result.value.workbook.documents[id]!.name).toBe('source');
  });
});
