import { describe, expect, it } from 'vitest';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { analyzeStoredFormula } from '@workbook/formula/storedFormulaAnalysis';
import { bindModelFormulas } from '@workbook/formula/modelTemplate';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { calculatedProperty, declaration, modelWorkbook } from '@test-support/modelLifecycleFixtures';
import type { Workbook } from '@workbook/core/model';
import { prepareExtraction, type ExtractionRequest } from './extractionPreparation';
import { prepareExtractionReferences } from './extractionReferences';

const ids = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005'];
function setup() {
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 3, columnCount: 3 });
  const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 2, columnCount: 2 });
  return workbookWithSheets([source, other]);
}
function setFormula(workbook: Workbook, sheetId: string, address: string, raw: string) {
  const sheet = workbook.documents[sheetId]!;
  sheet.content.cells[cellIdentityKey(cellIdentityAt(sheet.content, address)!)] = prepareUserFormula(raw, workbook, sheetId);
}
function plan(workbook: Workbook, selection?: ExtractionRequest['selection'], targetRows = [ids[1]!], targetColumns = [ids[2]!, ids[3]!]) {
  const source = workbook.documents.source!;
  const result = prepareExtraction(workbook, { sourceSheetId: 'source', selection: selection ?? { kind: 'cells', start: cellIdentityAt(source.content, 'A1')!, end: cellIdentityAt(source.content, 'B1')! }, targetSheetId: ids[0]!, targetName: 'Target', targetRows, targetColumns, frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 } });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
function display(raw: string, workbook: Workbook, sheetId: string) { return projectStoredFormula(raw, workbook, sheetId).text; }

describe('extraction reference planning', () => {
  it.each(['=SUM(@Source!A[#1]:C[#1])', '=SUM(@Source!A[#1]:C)', '=SUM(@Source!A[#1]:C[1])'])('allows extraction of positional range contents: %s', (formula) => {
    const workbook = setup(), source = workbook.documents.source!;
    setFormula(workbook, 'other', 'A1', formula);
    const selection = { kind: 'cells' as const, start: cellIdentityAt(source.content, 'B1')!, end: cellIdentityAt(source.content, 'B1')! };
    const result = prepareExtractionReferences(plan(workbook, selection, [ids[1]!], [ids[2]!]));
    expect(result.ok).toBe(true);
  });
  it('rejects extraction of the stable endpoint of a mixed range', () => {
    const workbook = setup(), source = workbook.documents.source!;
    setFormula(workbook, 'other', 'A1', '=SUM(@Source!A[#1]:C[1])');
    const selection = { kind: 'cells' as const, start: cellIdentityAt(source.content, 'C1')!, end: cellIdentityAt(source.content, 'C1')! };
    expect(prepareExtractionReferences(plan(workbook, selection, [ids[1]!], [ids[2]!]))).toEqual({ ok: false, reason: 'unrepresentable-range' });
  });
  it('retains positional targets when extracting cells and relocating their formula', () => {
    const workbook = setup();
    setFormula(workbook, 'source', 'A1', '=@B[#1]');
    const prepared = plan(workbook), result = prepareExtractionReferences(prepared);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const moved = result.writes.find((write) => write.sheetId === ids[0] && write.columnId === ids[2])!;
    expect(display(moved.raw, prepared.workbook, ids[0]!)).toBe('=@Source!B[#1]');
  });
  it('moves formulas and blank identities, retargets inbound references and leaves unrelated formulas alone', () => {
    const workbook = setup();
    setFormula(workbook, 'source', 'A1', '=@$B[$1]+@C[2]');
    setFormula(workbook, 'source', 'C1', '=@B[1]');
    setFormula(workbook, 'other', 'A1', '=@Source!A[1]+@Source!B[1]');
    setFormula(workbook, 'other', 'B1', '=@Source!C[3]');
    const before = structuredClone(workbook), prepared = plan(workbook), result = prepareExtractionReferences(prepared);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const moved = result.writes.find((write) => write.sheetId === ids[0] && write.columnId === ids[2])!;
    expect(display(moved.raw, prepared.workbook, ids[0]!)).toBe('=@$B[$1]+@Source!C[2]');
    expect(moved.raw).toBe(prepareUserFormula('=@$B[$1]+@Source!C[2]', prepared.workbook, ids[0]!));
    const inbound = result.writes.find((write) => write.sheetId === 'other')!;
    expect(display(inbound.raw, prepared.workbook, 'other')).toBe('=@Target!A[1]+@Target!B[1]');
    expect(inbound.raw).toBe(prepareUserFormula('=@Target!A[1]+@Target!B[1]', prepared.workbook, 'other'));
    expect(result.writes.some((write) => write.sheetId === 'source' && write.rowId === workbook.documents.source!.content.rows[0] && write.columnId === workbook.documents.source!.content.columns[2])).toBe(true);
    expect(result.writes.filter((write) => write.sheetId === ids[0]).map((write) => write.raw)).toContain('');
    expect(result.writes.some((write) => write.sheetId === 'other' && write.columnId === workbook.documents.other!.content.columns[1])).toBe(false);
    expect(workbook).toEqual(before);
  });
  it.each(['rows', 'columns'] as const)('rejects a whole %s extraction through the interior of a range', (kind) => {
    const workbook = setup(), source = workbook.documents.source!;
    setFormula(workbook, 'other', 'A1', '=SUM(@Source!A[1]:C[3])');
    const before = structuredClone(workbook);
    const selection = kind === 'rows' ? { kind, start: source.content.rows[1]!, end: source.content.rows[1]! } : { kind, start: source.content.columns[1]!, end: source.content.columns[1]! };
    const prepared = plan(workbook, selection, kind === 'rows' ? [ids[1]!] : [ids[1]!, ids[2]!, ids[3]!], kind === 'rows' ? [ids[2]!, ids[3]!, ids[4]!] : [ids[4]!]);
    const intermediate = structuredClone(prepared.workbook);
    expect(prepareExtractionReferences(prepared)).toEqual({ ok: false, reason: 'unrepresentable-range' });
    expect(workbook).toEqual(before);
    expect(prepared.workbook).toEqual(intermediate);
  });
  it('retargets named columns to canonical destination identities without mutating names', () => {
    const workbook = setup(), source = workbook.documents.source!;
    source.columnNames = { [source.content.columns[0]!]: 'Revenue' };
    setFormula(workbook, 'other', 'A1', '=@Source!Revenue[1]');
    const before = structuredClone(workbook), prepared = plan(workbook), intermediate = structuredClone(prepared.workbook);
    const result = prepareExtractionReferences(prepared);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const inbound = result.writes.find((write) => write.sheetId === 'other')!;
    expect(inbound.raw).toBe(prepareUserFormula('=@Target!Revenue[1]', prepared.workbook, 'other'));
    expect(display(inbound.raw, prepared.workbook, 'other')).toBe('=@Target!Revenue[1]');
    expect(analyzeStoredFormula(inbound.raw, prepared.workbook, 'other').references.map((reference) => reference.live)).toEqual([true]);
    expect(workbook).toEqual(before);
    expect(prepared.workbook).toEqual(intermediate);
  });
  it('rewrites every destination in a multi-cell formula selection', () => {
    const workbook = setup(), source = workbook.documents.source!;
    for (const address of ['A1', 'B1', 'A2', 'B2', 'A3', 'B3']) setFormula(workbook, 'source', address, '=@C[3]');
    const prepared = plan(workbook, { kind: 'columns', start: source.content.columns[0]!, end: source.content.columns[1]! }, [ids[1]!, ids[4]!, '00000000-0000-0000-0000-000000000006']);
    const before = structuredClone(prepared.workbook), result = prepareExtractionReferences(prepared);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const destinations = result.writes.filter((write) => write.sheetId === ids[0]);
    expect(destinations).toHaveLength(6);
    for (const write of destinations) expect(write.raw).toBe(prepareUserFormula('=@Source!C[3]', prepared.workbook, ids[0]!));
    expect(prepared.workbook).toEqual(before);
  });
  it('rejects split ranges before compaction and rewrites entirely moved ranges', () => {
    const workbook = setup(); setFormula(workbook, 'other', 'A1', '=SUM(@Source!A[1]:C[1])');
    const before = structuredClone(workbook);
    expect(prepareExtractionReferences(plan(workbook))).toEqual({ ok: false, reason: 'unrepresentable-range' });
    expect(workbook).toEqual(before);
    setFormula(workbook, 'other', 'A1', '=SUM(@Source!A[1]:B[1])');
    const prepared = plan(workbook), result = prepareExtractionReferences(prepared);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(display(result.writes.find((write) => write.sheetId === 'other')!.raw, prepared.workbook, 'other')).toBe('=SUM(@Target!A[1]:B[1])');
  });
  it.each([true, false])('protects zero-row calculated templates with bindings present=%s', (bound) => {
    const source = setup().documents.source!, modelSheet = sheetDocument({ id: 'modelSheet', name: 'ModelSheet', rowCount: 0, columnCount: 1 });
    modelSheet.modelId = 'model'; modelSheet.modelColumnBindings = { calc: modelSheet.content.columns[0]! };
    const workbook = modelWorkbook(declaration([calculatedProperty('calc', '=@Source!A[1]')]), [source, modelSheet]);
    if (bound) modelSheet.modelFormulaBindings = bindModelFormulas(workbook, modelSheet.id);
    const before = structuredClone(workbook);
    expect(prepareExtractionReferences(plan(workbook))).toEqual({ ok: false, reason: 'protected-model-formula' });
    expect(workbook).toEqual(before);
  });
  it('rejects a required rewrite of a materialized calculated formula', () => {
    const source = setup().documents.source!, modelSheet = sheetDocument({ id: 'modelSheet', name: 'ModelSheet', rowCount: 1, columnCount: 1 });
    modelSheet.modelId = 'model'; modelSheet.modelColumnBindings = { calc: modelSheet.content.columns[0]! };
    const workbook = modelWorkbook(declaration([calculatedProperty('calc', '=1')]), [source, modelSheet]);
    setFormula(workbook, modelSheet.id, 'A1', '=@Source!B[1]');
    const before = structuredClone(workbook);
    expect(prepareExtractionReferences(plan(workbook))).toEqual({ ok: false, reason: 'protected-model-formula' });
    expect(workbook).toEqual(before);
  });
  it('rejects open ranges that intersect moved cells and leaves unrelated ranges unchanged', () => {
    const workbook = setup();
    setFormula(workbook, 'other', 'A1', '=SUM(@Source!A[1]:A)');
    const before = structuredClone(workbook);
    expect(prepareExtractionReferences(plan(workbook))).toEqual({ ok: false, reason: 'unrepresentable-range' });
    expect(workbook).toEqual(before);
    setFormula(workbook, 'other', 'A1', '=SUM(@Source!C[1]:C[3])');
    const result = prepareExtractionReferences(plan(workbook));
    expect(result.ok && result.writes.some((write) => write.sheetId === 'other')).toBe(false);
  });
  it('allows unrelated model templates without mutating their bindings', () => {
    const source = setup().documents.source!, modelSheet = sheetDocument({ id: 'modelSheet', name: 'ModelSheet', rowCount: 0, columnCount: 1 });
    modelSheet.modelId = 'model'; modelSheet.modelColumnBindings = { calc: modelSheet.content.columns[0]! };
    const workbook = modelWorkbook(declaration([calculatedProperty('calc', '=@Source!C[3]')]), [source, modelSheet]);
    modelSheet.modelFormulaBindings = bindModelFormulas(workbook, modelSheet.id);
    const before = structuredClone(workbook);
    expect(prepareExtractionReferences(plan(workbook)).ok).toBe(true);
    expect(workbook).toEqual(before);
  });
});
