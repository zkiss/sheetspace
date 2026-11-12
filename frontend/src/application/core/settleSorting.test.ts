import { expect, it, vi } from 'vitest';
import { commitCellRawContent } from '@workbook/mutations/operations';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { settleSorting } from './settleSorting';

function formula(workbook: Workbook, sheetId: string, key: string, text: string): Workbook {
  const sheet = workbook.documents[sheetId]!;
  const id = cellIdentityKey(cellIdentityAt(sheet.content, key)!);
  return { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, content: { ...sheet.content, cells: { ...sheet.content.cells, [id]: prepareUserFormula(text, workbook, sheetId) } } } } };
}

it('sorts calculated keys from one shared snapshot and recalculates positional keys only once', () => {
  const a = sheetDocument({ id: 'a', name: 'First', rowCount: 2, columnCount: 2, cells: { A1: '2', A2: '1' } });
  const b = sheetDocument({ id: 'b', name: 'Second', rowCount: 2, columnCount: 2, cells: { A1: '5', A2: '4' } });
  let workbook = workbookWithSheets([
    { ...a, sorting: [{ columnId: 'a:column:2', direction: 'ascending' }] },
    { ...b, sorting: [{ columnId: 'b:column:2', direction: 'ascending' }] },
  ]);
  workbook = formula(workbook, 'a', 'B1', '=@A[1]+@Second!A[#1]');
  workbook = formula(workbook, 'a', 'B2', '=@A[2]+@Second!A[#1]');
  workbook = formula(workbook, 'b', 'B1', '=@A[1]+@First!A[#1]');
  workbook = formula(workbook, 'b', 'B2', '=@A[2]+@First!A[#1]');
  const original = new FormulaCalculation();
  const result = settleSorting(workbook, original, { kind: 'structure' });
  expect(result.workbook.documents.a!.content.rows).toEqual([...a.content.rows].reverse());
  expect(result.workbook.documents.b!.content.rows).toEqual([...b.content.rows].reverse());
  expect(result.orders).toHaveLength(2);
  expect(result.snapshot.a).toMatchObject({ B1: { value: 5 }, B2: { value: 6 } });
  expect(result.snapshot.b).toMatchObject({ B1: { value: 5 }, B2: { value: 6 } });
  expect(original.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).a.B1).toMatchObject({ value: 7 });
});

it('updates cross-sheet positional and range dependents while preserving stable references', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1, cells: { A1: '4', A2: '2', A3: '1' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 5 });
  let workbook = workbookWithSheets([{ ...source, sorting: [{ columnId: 's:column:1', direction: 'ascending' }] }, output]);
  workbook = formula(workbook, 'o', 'A1', '=@Source!A[1]');
  workbook = formula(workbook, 'o', 'B1', '=@Source!A[#1]');
  workbook = formula(workbook, 'o', 'C1', '=SUM(@Source!A[1]:A[#2])');
  workbook = formula(workbook, 'o', 'D1', '=@B[1]+@C[1]');
  workbook = formula(workbook, 'o', 'E1', '=SUM(@Source!A[#2]:A[1])');
  const result = settleSorting(workbook, new FormulaCalculation(), { kind: 'structure' });
  expect(result.snapshot.o).toMatchObject({ A1: { value: 4 }, B1: { value: 1 }, C1: { value: 6 }, D1: { value: 7 }, E1: { value: 6 } });
  expect(result.calculation.updateStored(calculationProjection(result.workbook), result.workbook, { kind: 'none' })).toBe(result.snapshot);
});

it('leaves unchanged orders and evaluates errors as sort keys', () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1, cells: { A1: '1' } });
  let workbook = workbookWithSheets([{ ...sheet, sorting: [{ columnId: 's:column:1', direction: 'ascending' }] }]);
  workbook = formula(workbook, 's', 'A2', '=1/0');
  const result = settleSorting(workbook, new FormulaCalculation(), { kind: 'structure' });
  expect(result.workbook).toBe(workbook);
  expect(result.orders).toEqual([]);
  expect(result.snapshot.s.A2).toMatchObject({ kind: 'error' });
});

it('does not repeat sorting when position-dependent keys reverse after the first pass', () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 2, cells: { A1: '2', A2: '1' } });
  let workbook = workbookWithSheets([{ ...sheet, sorting: [{ columnId: 's:column:2', direction: 'ascending' }] }]);
  workbook = formula(workbook, 's', 'B1', '=@A[#1]');
  workbook = formula(workbook, 's', 'B2', '=@A[#2]');
  const result = settleSorting(workbook, new FormulaCalculation(), { kind: 'structure' });
  expect(result.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  expect(result.snapshot.s).toMatchObject({ B1: { value: 2 }, B2: { value: 1 } });
  expect(result.orders).toHaveLength(1);
});


it('freezes both sheets before a first-sheet permutation can reverse second-sheet keys', () => {
  const a = sheetDocument({ id: 'a', name: 'First', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const b = sheetDocument({ id: 'b', name: 'Second', rowCount: 2, columnCount: 1 });
  let workbook = workbookWithSheets([
    { ...a, sorting: [{ columnId: 'a:column:1', direction: 'ascending' }] },
    { ...b, sorting: [{ columnId: 'b:column:1', direction: 'ascending' }] },
  ]);
  workbook = formula(workbook, 'b', 'A1', '=@First!A[#1]');
  workbook = formula(workbook, 'b', 'A2', '=@First!A[#2]');
  const result = settleSorting(workbook, new FormulaCalculation(), { kind: 'structure' });
  expect(result.workbook.documents.a!.content.rows).toEqual([...a.content.rows].reverse());
  expect(result.workbook.documents.b!.content.rows).toEqual([...b.content.rows].reverse());
  expect(result.snapshot.b).toMatchObject({ A1: { value: 2 }, A2: { value: 1 } });
});

it('resorts on an incremental edit through cross-sheet transitive calculated keys', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '1' } });
  const middle = sheetDocument({ id: 'm', name: 'Middle', rowCount: 1, columnCount: 1 });
  const target = sheetDocument({ id: 't', name: 'Target', rowCount: 2, columnCount: 1, cells: { A2: '5' } });
  let workbook = workbookWithSheets([source, middle, { ...target, sorting: [{ columnId: 't:column:1', direction: 'ascending' }] }]);
  workbook = formula(workbook, 'm', 'A1', '=@Source!A[1]*2');
  workbook = formula(workbook, 't', 'A1', '=@Middle!A[1]');
  const calculation = new FormulaCalculation();
  calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' });
  const edited = commitCellRawContent(workbook, 's', 'A1', '4');
  const result = settleSorting(edited, calculation, { kind: 'cells', cells: [{ sheetId: 's', key: 'A1' }] });
  expect(result.workbook.documents.t!.content.rows).toEqual([...target.content.rows].reverse());
  expect(result.snapshot.t.A2).toMatchObject({ value: 8 });
  expect(result.snapshot.m.A1).toMatchObject({ value: 8 });
});

it('updates range membership and coordinates without reevaluating stable individual references', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 4, columnCount: 1, cells: { A1: '4', A2: '1', A3: '3', A4: '2' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 6 });
  let workbook = workbookWithSheets([{ ...source, sorting: [{ columnId: 's:column:1', direction: 'ascending' }] }, output]);
  workbook = formula(workbook, 'o', 'A1', '=@Source!A[1]');
  workbook = formula(workbook, 'o', 'B1', '=SUM(@Source!A[2]:A[1])');
  workbook = formula(workbook, 'o', 'C1', '=SUM(@Source!A[#2]:A[#1])');
  workbook = formula(workbook, 'o', 'D1', '=SUM(@Source!A[1]:A[#2])');
  workbook = formula(workbook, 'o', 'E1', '=@C[1]+@D[1]');
  workbook = formula(workbook, 'o', 'F1', '=@Source!A[#9]');
  const calculation = new FormulaCalculation();
  expect(calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o).toMatchObject({ B1: { value: 5 }, C1: { value: 5 }, D1: { value: 5 }, F1: { display: '#REF!' } });
  const evaluated: string[] = [];
  const originalUpdate = FormulaCalculation.prototype.updateStored;
  const spy = vi.spyOn(FormulaCalculation.prototype, 'updateStored').mockImplementation(function (this: FormulaCalculation, projection, book, impact, callback) {
    return originalUpdate.call(this, projection, book, impact, (sheet, key) => { evaluated.push(`${sheet}:${key}`); callback?.(sheet, key); });
  });
  try {
    const result = settleSorting(workbook, calculation, { kind: 'none' });
    expect(result.snapshot.o).toMatchObject({ A1: { value: 4 }, B1: { value: 10 }, C1: { value: 3 }, D1: { value: 9 }, E1: { value: 12 }, F1: { display: '#REF!' } });
    expect(evaluated).not.toContain('o:A1');
    const id = cellIdentityKey(cellIdentityAt(output.content, 'A1')!);
    expect(projectStoredFormula(workbook.documents.o!.content.cells[id]!, result.workbook, 'o').text).toBe('=@Source!A[4]');
  } finally {
    spy.mockRestore();
  }
});
