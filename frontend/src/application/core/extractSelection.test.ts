import { describe, expect, it } from 'vitest';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { calculatedProperty, declaration, modelWorkbook } from '@test-support/modelLifecycleFixtures';
import type { ExtractionRequest } from './extractionPreparation';
import { extractSelection } from './extractSelection';

const ids = Array.from({ length: 7 }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`);
function fixture() {
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 3, columnCount: 3 });
  const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
  const workbook = workbookWithSheets([source, other]);
  const a1 = cellIdentityAt(source.content, 'A1')!, b1 = cellIdentityAt(source.content, 'B1')!;
  source.content.cells[cellIdentityKey(a1)] = '42';
  source.content.cells[cellIdentityKey(b1)] = prepareUserFormula('=@A[1]+@C[3]', workbook, source.id);
  other.content.cells[cellIdentityKey(cellIdentityAt(other.content, 'A1')!)] = prepareUserFormula('=@Source!A[1]', workbook, other.id);
  source.columnNames = { [source.content.columns[0]!]: 'Named' };
  source.presentation.formatOverrides = { rows: { [a1.rowId]: { fontWeight: 'bold' } }, columns: { [a1.columnId]: { fillColor: '#abcdef' } }, cells: { [cellIdentityKey(a1)]: { textColor: '#123456' }, [cellIdentityKey(cellIdentityAt(source.content, 'C3')!)]: { fontWeight: 'bold' } } };
  const request: ExtractionRequest = { sourceSheetId: source.id, selection: { kind: 'cells', start: b1, end: a1 }, targetSheetId: ids[0]!, targetName: 'Target', targetRows: [ids[1]!], targetColumns: [ids[2]!, ids[3]!], frame: { position: { x: 3, y: 4 }, size: { width: 100, height: 100 }, zIndex: 2 } };
  return { workbook, source, other, request, a1, b1 };
}

describe('complete selection extraction', () => {
  it('moves values, formulas and appearance while clearing only selected local metadata', () => {
    const { workbook, source, other, request, a1 } = fixture(), before = structuredClone(workbook);
    const result = extractSelection(workbook, request);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const target = result.workbook.documents[request.targetSheetId]!, remaining = result.workbook.documents.source!;
    expect(result.origin).toEqual({ row: 0, column: 0 });
    expect(target.content.cells[cellIdentityKey({ rowId: ids[1]!, columnId: ids[2]! })]).toBe('42');
    const movedFormula = target.content.cells[cellIdentityKey({ rowId: ids[1]!, columnId: ids[3]! })]!;
    expect(projectStoredFormula(movedFormula, result.workbook, target.id).text).toBe('=@A[1]+@Source!C[3]');
    const inbound = Object.values(result.workbook.documents.other!.content.cells)[0]!;
    expect(projectStoredFormula(inbound, result.workbook, other.id).text).toBe('=@Target!A[1]');
    expect(remaining.content.rows).toEqual(source.content.rows);
    expect(remaining.content.cells[cellIdentityKey(a1)]).toBeUndefined();
    expect(remaining.presentation.formatOverrides!.cells[cellIdentityKey(a1)]).toBeUndefined();
    expect(remaining.presentation.formatOverrides!.rows).toEqual(source.presentation.formatOverrides!.rows);
    expect(remaining.presentation.formatOverrides!.columns).toEqual(source.presentation.formatOverrides!.columns);
    expect(Object.keys(remaining.presentation.formatOverrides!.cells)).toHaveLength(1);
    expect(target.presentation.formatOverrides!.cells[cellIdentityKey({ rowId: ids[1]!, columnId: ids[2]! })]).toEqual({ textColor: '#123456' });
    expect(workbook).toEqual(before);
  });
  it.each(['rows', 'columns'] as const)('compacts selected %s while retaining survivor identities and transferred names', (kind) => {
    const { workbook, source, request } = fixture(), before = structuredClone(workbook);
    const selection = kind === 'rows' ? { kind, start: source.content.rows[0]!, end: source.content.rows[0]! } : { kind, start: source.content.columns[0]!, end: source.content.columns[0]! };
    const result = extractSelection(workbook, { ...request, selection, targetRows: kind === 'rows' ? [ids[1]!] : [ids[1]!, ids[4]!, ids[5]!], targetColumns: kind === 'rows' ? [ids[2]!, ids[3]!, ids[6]!] : [ids[2]!] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    const remaining = result.workbook.documents.source!, target = result.workbook.documents[request.targetSheetId]!;
    expect(kind === 'rows' ? remaining.content.rows : remaining.content.columns).toEqual((kind === 'rows' ? source.content.rows : source.content.columns).slice(1));
    expect(target.columnNames).toEqual({ [ids[2]!]: 'Named' });
    expect(workbook).toEqual(before);
  });
  it.each(['rows', 'columns'] as const)('supports extracting all %s', (kind) => {
    const { workbook, source, request } = fixture();
    const axis = kind === 'rows' ? source.content.rows : source.content.columns;
    const result = extractSelection(workbook, { ...request, selection: { kind, start: axis[2]!, end: axis[0]! }, targetRows: [ids[1]!, ids[4]!, ids[5]!], targetColumns: [ids[2]!, ids[3]!, ids[6]!] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(kind === 'rows' ? result.workbook.documents.source!.content.rows : result.workbook.documents.source!.content.columns).toEqual([]);
  });
  it('rejects split ranges without changing any part of the workbook', () => {
    const { workbook, source, other, request } = fixture();
    other.content.cells[cellIdentityKey(cellIdentityAt(other.content, 'A1')!)] = prepareUserFormula('=SUM(@Source!A[1]:C[3])', workbook, other.id);
    const before = structuredClone(workbook);
    expect(extractSelection(workbook, { ...request, selection: { kind: 'rows', start: source.content.rows[1]!, end: source.content.rows[1]! }, targetColumns: [ids[2]!, ids[3]!, ids[6]!] })).toEqual({ ok: false, reason: 'unrepresentable-range' });
    expect(workbook).toEqual(before);
  });
  it('rejects protected template rewrites without publishing a target', () => {
    const { source, request } = fixture();
    const model = sheetDocument({ id: 'modelSheet', name: 'ModelSheet', rowCount: 0, columnCount: 1 });
    model.modelId = 'model'; model.modelColumnBindings = { calc: model.content.columns[0]! };
    const workbook = modelWorkbook(declaration([calculatedProperty('calc', '=@Source!A[1]')]), [source, model]);
    const before = structuredClone(workbook);
    expect(extractSelection(workbook, request)).toEqual({ ok: false, reason: 'protected-model-formula' });
    expect(workbook).toEqual(before);
  });
  it('removes selected axes even when the opposite axis is empty', () => {
    const { workbook, source, request } = fixture();
    source.content.rows = []; source.content.cells = {};
    const result = extractSelection(workbook, { ...request, selection: { kind: 'columns', start: source.content.columns[0]!, end: source.content.columns[0]! }, targetRows: [], targetColumns: [ids[2]!] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.workbook.documents.source!.content.columns).toEqual(source.content.columns.slice(1));
    expect(result.workbook.documents[request.targetSheetId]!.content.rows).toEqual([]);
  });
});
