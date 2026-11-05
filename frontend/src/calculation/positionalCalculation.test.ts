import { expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { commitCellRawContent } from '@workbook/mutations/operations';
import { applyAxisPermutation } from '@workbook/mutations/reorderAxis';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { FormulaCalculation } from './formulaCalculation';

function writeFormula(workbook: Workbook, key: string, formula: string): Workbook {
  const sheet = workbook.documents.o!;
  const id = cellIdentityKey(cellIdentityAt(sheet.content, key)!);
  return { ...workbook, documents: { ...workbook.documents, o: { ...sheet, content: { ...sheet.content, cells: { ...sheet.content.cells, [id]: prepareUserFormula(formula, workbook, 'o') } } } } };
}

it('refreshes positional cross-sheet edges without evaluating unchanged stable references', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1, cells: { A1: '1', A2: '2', A3: '4' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 3 });
  let workbook = workbookWithSheets([{ ...source, columnNames: { 's:column:1': 'Price' } }, output]);
  workbook = writeFormula(workbook, 'A1', '=@Source!Price[1]');
  workbook = writeFormula(workbook, 'B1', '=@Source!Price[#1]');
  workbook = writeFormula(workbook, 'C1', '=@B[1]+1');
  const calculation = new FormulaCalculation();
  calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' });
  const moved = applyAxisPermutation(workbook, 's', 'row', [...source.content.rows].reverse());
  if (moved.status !== 'changed') throw new Error('Expected permutation');
  const evaluated: string[] = [];
  const snapshot = calculation.updateStored(calculationProjection(moved.workbook), moved.workbook, { kind: 'structure' }, (sheet, key) => evaluated.push(`${sheet}:${key}`));
  expect(snapshot.o).toMatchObject({ A1: { value: 1 }, B1: { value: 4 }, C1: { value: 5 } });
  expect(evaluated.sort()).toEqual(['o:B1', 'o:C1']);
  const oldTarget = commitCellRawContent(moved.workbook, 's', 'A3', '10');
  evaluated.length = 0;
  calculation.updateStored(calculationProjection(oldTarget), oldTarget, { kind: 'cells', cells: [{ sheetId: 's', key: 'A3' }] }, (sheet, key) => evaluated.push(`${sheet}:${key}`));
  expect(evaluated).toEqual(['o:A1']);
  const newTarget = commitCellRawContent(oldTarget, 's', 'A1', '20');
  expect(calculation.updateStored(calculationProjection(newTarget), newTarget, { kind: 'cells', cells: [{ sheetId: 's', key: 'A1' }] }).o.C1).toMatchObject({ value: 21 });
});

it('recalculates exchanged positional operands and their dependents despite unchanged dependency sets', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1, cells: { A1: '1', A2: '2', A3: '4' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 3 });
  let workbook = workbookWithSheets([source, output]);
  workbook = writeFormula(workbook, 'A1', '=@Source!A[#1]-@Source!A[#2]');
  workbook = writeFormula(workbook, 'B1', '=@A[1]*2');
  workbook = writeFormula(workbook, 'C1', '=@Source!A[#3]');
  const calculation = new FormulaCalculation();
  expect(calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o).toMatchObject({ A1: { value: -1 }, B1: { value: -2 } });
  const moved = applyAxisPermutation(workbook, 's', 'row', [source.content.rows[1]!, source.content.rows[0]!, source.content.rows[2]!]);
  if (moved.status !== 'changed') throw new Error('Expected permutation');
  const evaluated: string[] = [];
  const snapshot = calculation.updateStored(calculationProjection(moved.workbook), moved.workbook, { kind: 'structure' }, (sheet, key) => evaluated.push(`${sheet}:${key}`));
  expect(snapshot.o).toMatchObject({ A1: { value: 1 }, B1: { value: 2 }, C1: { value: 4 } });
  expect(evaluated.sort()).toEqual(['o:A1', 'o:B1']);
});

it.each([
  ['=SUM(@Source!A[1]:A[2])', 3, 3],
  ['=SUM(@Source!A[#1]:A[#2])', 3, 6],
  ['=SUM(@Source!A[1]:A[#2])', 3, 3],
  ['=SUM(@Source!A[#1]:A[2])', 3, 6],
  ['=SUM(@Source!A[#2]:A[1])', 3, 3],
  ['=SUM(@Source!A[#2]:A)', 6, 3],
])('evaluates range %s against current endpoints', (formula, before, after) => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1, cells: { A1: '1', A2: '2', A3: '4' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 1 });
  const workbook = writeFormula(workbookWithSheets([source, output]), 'A1', formula);
  const calculation = new FormulaCalculation();
  expect(calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o.A1).toMatchObject({ value: before });
  const moved = applyAxisPermutation(workbook, 's', 'row', [...source.content.rows].reverse());
  if (moved.status !== 'changed') throw new Error('Expected permutation');
  expect(calculation.updateStored(calculationProjection(moved.workbook), moved.workbook, { kind: 'structure' }).o.A1).toMatchObject({ value: after });
});

it('recovers a missing positional row when the source grows', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '1' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 1 });
  const workbook = writeFormula(workbookWithSheets([source, output]), 'A1', '=@Source!A[#2]');
  const calculation = new FormulaCalculation();
  expect(calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o.A1).toMatchObject({ display: '#REF!' });
  const grown = { ...workbook, documents: { ...workbook.documents, s: { ...source, content: { ...source.content, rows: [...source.content.rows, 's:row:2'] } } } };
  const edited = commitCellRawContent(grown, 's', 'A2', '9');
  expect(calculation.updateStored(calculationProjection(edited), edited, { kind: 'structure' }).o.A1).toMatchObject({ value: 9 });
});

it('introduces and removes a cycle when the positional target changes', () => {
  const sheet = sheetDocument({ id: 'o', name: 'Output', rowCount: 2, columnCount: 1, cells: { A2: '3' } });
  const workbook = writeFormula(workbookWithSheets([sheet]), 'A1', '=@A[#2]');
  const calculation = new FormulaCalculation();
  expect(calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o.A1).toMatchObject({ value: 3 });
  const moved = applyAxisPermutation(workbook, 'o', 'row', [...sheet.content.rows].reverse());
  if (moved.status !== 'changed') throw new Error('Expected permutation');
  expect(calculation.updateStored(calculationProjection(moved.workbook), moved.workbook, { kind: 'structure' }).o.A2).toMatchObject({ display: '#CYCLE!' });
  expect(calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o.A1).toMatchObject({ value: 3 });
});

it('reports a removed stable endpoint in a mixed range instead of rebinding it', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1, cells: { A1: '1', A2: '2', A3: '4' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 1 });
  const workbook = writeFormula(workbookWithSheets([source, output]), 'A1', '=SUM(@Source!A[1]:A[#2])');
  const calculation = new FormulaCalculation();
  expect(calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o.A1).toMatchObject({ value: 3 });
  const removed = { ...workbook, documents: { ...workbook.documents, s: { ...source, content: { ...source.content, rows: source.content.rows.slice(1) } } } };
  expect(calculation.updateStored(calculationProjection(removed), removed, { kind: 'structure' }).o.A1).toMatchObject({ display: '#REF!' });
});
