import { expect, it } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { configureSorting } from './configureSorting';

it('applies criteria and settles row identities once without mutating the source', () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const workbook = workbookWithSheets([sheet]);
  const criteria = [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }];
  const result = configureSorting(workbook, 's', criteria, new FormulaCalculation());
  expect(result.status).toBe('changed');
  if (result.status !== 'changed') throw new Error('Expected changed sorting');
  expect(result.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  expect(result.orders).toEqual([{ sheetId: 's', before: sheet.content.rows, after: [...sheet.content.rows].reverse() }]);
  expect(workbook.documents.s!.sorting).toBeUndefined();
});

it('retains physical order on clear and skips unchanged or invalid commands', () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const workbook = workbookWithSheets([{ ...sheet, sorting: [{ columnId: sheet.content.columns[0]!, direction: 'ascending' }] }]);
  const calculator = new FormulaCalculation();
  const cleared = configureSorting(workbook, 's', [], calculator);
  expect(cleared.status).toBe('changed');
  expect(cleared.workbook.documents.s!.content.rows).toEqual(sheet.content.rows);
  expect(configureSorting(cleared.workbook, 's', [], calculator)).toEqual({ status: 'unchanged', workbook: cleared.workbook });
  expect(configureSorting(workbook, 's', [{ columnId: 'missing', direction: 'ascending' }], calculator)).toEqual({ status: 'rejected', workbook });
});
