import { expect, it } from 'vitest';
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
