import { expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { modelColumnPresentation, selectionIncludesCalculatedColumn } from './modelColumnPresentation';

it('presents local names alongside property names using actual bindings', () => {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 1, columnCount: 2 });
  const [local, bound] = sheet.content.columns;
  const presentation = modelColumnPresentation({ ...sheet, modelId: 'm', modelColumnBindings: { p: bound }, columnNames: { [local]: 'Local', [bound]: 'Obsolete', missing: 'Missing' } }, {
    m: { id: 'm', name: 'Model', columns: [{ id: 'p', name: 'Property', kind: 'manual', type: 'float' }] },
  });
  expect([...presentation.columnLabels]).toEqual([[local, 'Local'], [bound, 'Property']]);
});

it('checks calculated ownership against selected column identities rather than gaps', () => {
  const base = sheetDocument({ id: 's', name: 'Sheet', rowCount: 1, columnCount: 3 });
  const [first, calculated, last] = base.content.columns as [string, string, string];
  const sheet = { ...base, modelId: 'm', modelColumnBindings: { p: calculated } };
  const workbook = { ...workbookWithSheets([sheet]), dataModels: {
    m: { id: 'm', name: 'Model', columns: [{ id: 'p', name: 'Computed', kind: 'calculated' as const, type: 'float' as const, formula: '=1' }] },
  } };
  const target = (columnId: string) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId } });
  const selection = { mode: 'columns' as const, anchor: target(first), extent: target(last), members: [first, last] };
  expect(selectionIncludesCalculatedColumn(workbook, selection)).toBe(false);
  expect(selectionIncludesCalculatedColumn(workbook, { ...selection, members: [first, calculated, last] })).toBe(true);
  expect(selectionIncludesCalculatedColumn(workbook, { ...selection, members: [first, 'missing', last] })).toBe(false);
});
