import { expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { errorTrace } from './workbookErrors';

it('projects ordered branches using current identities and leaves missing origins unresolved', () => {
  const sheet = sheetDocument({ id: 's', name: 'Named sheet', rowCount: 2, columnCount: 2 });
  sheet.columnNames = { [sheet.content.columns[1]]: 'A' };
  const workbook = workbookWithSheets([sheet]);
  const cell = { sheetId: 's', rowId: sheet.content.rows[1], columnId: sheet.content.columns[0] };
  const trace = errorTrace(workbook, { message: 'outer', cell, causes: [
    { message: 'first', cell: { ...cell, rowId: 'deleted' }, causes: [] },
    { message: 'second', causes: [{ message: 'cycle', cell, causes: [] }] },
  ] });
  expect(trace.map(({ key, depth, message, target }) => [key, depth, message, target?.reference])).toEqual([
    ['0', 0, 'outer', "@'Named sheet'!%A[2]"], ['0.0', 1, 'first', undefined],
    ['0.1', 1, 'second', undefined], ['0.1.0', 2, 'cycle', "@'Named sheet'!%A[2]"],
  ]);
  sheet.name = 'Renamed';
  sheet.content.rows.reverse();
  expect(errorTrace(workbook, { message: 'moved', cell, causes: [] })[0].target?.reference).toBe('@Renamed!%A[1]');
});
