import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { formulaRawForDisplay } from '@workbook/formula/reference';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { tabularCellsByA1 } from '@workbook/read/queries';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { commitCellRawContent } from './operations';
import { applyAxisPermutation } from './reorderAxis';

function permutations<T>(items: readonly T[]): T[][] {
  return items.length === 0 ? [[]] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe.each(['row', 'column'] as const)('%s permutations', (axis) => {
  it('applies and reverses every permutation and rejects malformed orders without mutation', () => {
    const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 4, columnCount: 4 });
    const workbook = workbookWithSheets([sheet]);
    const original = structuredClone(workbook);
    const ids = axis === 'row' ? sheet.content.rows : sheet.content.columns;
    for (const order of permutations(ids)) {
      const result = applyAxisPermutation(workbook, 's', axis, order);
      if (order.every((id, index) => id === ids[index])) {
        expect(result).toEqual({ status: 'unchanged', workbook });
      } else {
        expect(result).toMatchObject({ status: 'changed', before: ids, after: order });
        if (result.status !== 'changed') throw new Error('Expected changed permutation');
        expect(applyAxisPermutation(result.workbook, 's', axis, ids)).toMatchObject({ status: 'changed', after: ids });
      }
    }
    for (const order of [[], [...ids, ids[0]!], [ids[0]!, ids[1]!, ids[2]!, ids[2]!], [ids[0]!, ids[1]!, ids[2]!, 'foreign']]) {
      expect(applyAxisPermutation(workbook, 's', axis, order)).toMatchObject({ status: 'rejected', reason: 'invalid-permutation', workbook });
    }
    expect(workbook).toEqual(original);
  });
});

it('projects identity-associated cells, sizes, names and formats after both axes move', () => {
  const key = cellIdentityKey({ rowId: 's:row:1', columnId: 's:column:1' });
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 2, cells: { A1: '42', B2: '9' }, presentation: {
    rowHeights: { 's:row:1': 37 }, columnWidths: { 's:column:1': 91 },
    formatOverrides: { rows: { 's:row:1': { fontWeight: 'bold' } }, columns: { 's:column:1': { textColor: '#ff0000' } }, cells: { [key]: { fillColor: '#00ff00' } } },
  } });
  const workbook = workbookWithSheets([{ ...sheet, columnNames: { 's:column:1': 'Price' } }]);
  const rows = applyAxisPermutation(workbook, 's', 'row', [...sheet.content.rows].reverse());
  if (rows.status !== 'changed') throw new Error('Expected reordered rows');
  const columns = applyAxisPermutation(rows.workbook, 's', 'column', [...sheet.content.columns].reverse());
  if (columns.status !== 'changed') throw new Error('Expected reordered columns');
  const moved = columns.workbook.documents.s!;
  expect(tabularCellsByA1(moved.content)).toEqual({ B2: '42', A1: '9' });
  expect(projectGridAxes(moved.content)).toMatchObject({ rows: [{ id: 's:row:2' }, { id: 's:row:1' }], columns: [{ id: 's:column:2' }, { id: 's:column:1' }] });
  expect(moved.presentation).toEqual(sheet.presentation);
  expect(moved.presentation.formatOverrides?.cells[key]).toEqual({ fillColor: '#00ff00' });
  expect(moved.columnNames?.[moved.content.columns[1]!]).toBe('Price');
});

it('retains model bindings and projects bound row values when rows move', () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '11', A2: '22' } });
  const workbook = { ...workbookWithSheets([{ ...sheet, modelId: 'm', modelColumnBindings: { price: 's:column:1' } }]), dataModels: { m: { id: 'm', name: 'M', columns: [{ id: 'price', name: 'Price', kind: 'manual' as const, type: 'int' as const }] } } };
  const result = applyAxisPermutation(workbook, 's', 'row', [...sheet.content.rows].reverse());
  if (result.status !== 'changed') throw new Error('Expected reordered rows');
  expect(result.workbook.documents.s!.modelColumnBindings).toEqual({ price: 's:column:1' });
  expect(tabularCellsByA1(result.workbook.documents.s!.content)).toEqual({ A2: '11', A1: '22' });
  expect(calculationProjection(result.workbook).sheets[0]).toMatchObject({ modelColumnBindings: { price: 's:column:1' }, columnTypes: { 's:column:1': 'int' }, rows: ['s:row:2', 's:row:1'] });
});

it('recalculates a changed cross-sheet range footprint and tracks subsequent cell edits', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 4, columnCount: 1, cells: { A1: '1', A2: '2', A3: '4', A4: '8' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 1 });
  const workbook = commitCellRawContent(workbookWithSheets([source, output]), 'o', 'A1', '=SUM(@Source!A[1]:A[3])');
  const calc = new FormulaCalculation();
  expect(calc.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o.A1).toMatchObject({ value: 7 });
  const result = applyAxisPermutation(workbook, 's', 'row', [source.content.rows[2]!, source.content.rows[3]!, source.content.rows[0]!, source.content.rows[1]!]);
  if (result.status !== 'changed') throw new Error('Expected reordered rows');
  const moved = result.workbook;
  expect(formulaRawForDisplay(Object.values(moved.documents.o!.content.cells)[0]!, moved, 'o')).toBe('=SUM(@Source!A[3]:A[1])');
  expect(calc.updateStored(calculationProjection(moved), moved, { kind: 'structure' }).o.A1).toMatchObject({ value: 13 });
  const edited = commitCellRawContent(moved, 's', 'A2', '10');
  expect(calc.updateStored(calculationProjection(edited), edited, { kind: 'cells', cells: [{ sheetId: 's', key: 'A2' }] }).o.A1).toMatchObject({ value: 15 });
  const outside = commitCellRawContent(edited, 's', 'A4', '100');
  expect(calc.updateStored(calculationProjection(outside), outside, { kind: 'cells', cells: [{ sheetId: 's', key: 'A4' }] }).o.A1).toMatchObject({ value: 15 });
});

it('keeps a cross-sheet named reference on its column identity after column reorder', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 2, cells: { A1: '12', B1: '30' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 1 });
  const workbook = commitCellRawContent(workbookWithSheets([{ ...source, columnNames: { 's:column:1': 'Price' } }, output]), 'o', 'A1', "=@Source!'Price'[1]");
  const calc = new FormulaCalculation();
  expect(calc.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o.A1).toMatchObject({ value: 12 });
  const result = applyAxisPermutation(workbook, 's', 'column', [...source.content.columns].reverse());
  if (result.status !== 'changed') throw new Error('Expected reordered columns');
  expect(formulaRawForDisplay(Object.values(result.workbook.documents.o!.content.cells)[0]!, result.workbook, 'o')).toBe("=@Source!Price[1]");
  expect(calc.updateStored(calculationProjection(result.workbook), result.workbook, { kind: 'structure' }).o.A1).toMatchObject({ value: 12 });
  const edited = commitCellRawContent(result.workbook, 's', 'B1', '17');
  expect(calc.updateStored(calculationProjection(edited), edited, { kind: 'cells', cells: [{ sheetId: 's', key: 'B1' }] }).o.A1).toMatchObject({ value: 17 });
});
