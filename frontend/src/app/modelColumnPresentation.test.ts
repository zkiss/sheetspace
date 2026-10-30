import { expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { modelColumnPresentation } from './modelColumnPresentation';

it('presents local names alongside property names using actual bindings', () => {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 1, columnCount: 2 });
  const [local, bound] = sheet.content.columns;
  const presentation = modelColumnPresentation({ ...sheet, modelId: 'm', modelColumnBindings: { p: bound }, columnNames: { [local]: 'Local', [bound]: 'Obsolete', missing: 'Missing' } }, {
    m: { id: 'm', name: 'Model', columns: [{ id: 'p', name: 'Property', kind: 'manual', type: 'float' }] },
  });
  expect([...presentation.columnLabels]).toEqual([[local, 'Local'], [bound, 'Property']]);
});
