import { expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { commitCellRawContent } from '@workbook/mutations/operations';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { setCustomFunction } from './customFunctions';
import { FormulaCalculation } from './formulaCalculation';

it('retains named column identities through disjoint edits after rename, reuse and deletion', () => {
  const source = sheetDocument({ id: 's', name: 'Source', cells: { A1: '2', B1: '40' } });
  const output = sheetDocument({ id: 'o', name: 'Output', cells: { A1: '=value()', B1: '=@A[1]+1' } });
  let workbook = workbookWithSheets([{ ...source, columnNames: { 's:column:1': 'Price' } }, output]);
  workbook = commitCellRawContent(workbook, 'o', 'B1', '=@A[1]+1');
  const save = (body: string, previousName?: string) => {
    const result = setCustomFunction(workbook, { name: 'value', parameters: [], body }, previousName);
    if (!result.ok) throw new Error(result.error);
    workbook = result.workbook;
  };
  save('=1+@Source!Price[1]+1');
  const binding = workbook.functions![0].bodyBindings!.o;
  const renamed = { ...source, columnNames: { 's:column:1': 'Cost', 's:column:2': 'Price' } };
  workbook = { ...workbook, documents: { ...workbook.documents, s: renamed } };
  save('=2+@Source!Price[1]+3', 'value');
  expect(workbook.functions![0].bodyBindings!.o).toBe(binding.replace('=1+', '=2+').replace('+1', '+3'));
  const calculation = new FormulaCalculation();
  expect(calculation.update(calculationProjection(workbook), { kind: 'structure' }).o.B1).toMatchObject({ kind: 'number', value: 8 });
  workbook = commitCellRawContent(workbook, 's', 'A1', '5');
  expect(calculation.update(calculationProjection(workbook), { kind: 'cells', cells: [{ sheetId: 's', key: 'A1' }] }).o.B1).toMatchObject({ kind: 'number', value: 11 });
  workbook = { ...workbook, documents: { ...workbook.documents, s: { ...renamed, content: { ...workbook.documents.s.content, columns: renamed.content.columns.slice(1) } } } };
  save('=4+@Source!Price[1]+5', 'value');
  expect(workbook.functions![0].bodyBindings!.o).toContain(binding.slice(3, binding.length - 2));
  expect(calculation.update(calculationProjection(workbook), { kind: 'structure' }).o.A1).toMatchObject({ error: '#REF!' });
});
