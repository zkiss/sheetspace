import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { columnRenameTarget, renameColumn } from './renameColumn';

describe('column rename command', () => {
  it('uses actual property bindings and preserves every sheet when renaming', () => {
    const first = sheetDocument({ id: 'a', name: 'First', rowCount: 1, columnCount: 2 });
    const second = sheetDocument({ id: 'b', name: 'Second', rowCount: 1, columnCount: 2 });
    const book = { ...workbookWithSheets([first, second]), dataModels: { m: { id: 'm', name: 'Model', columns: [{ id: 'p', name: 'Cost', kind: 'manual' as const, type: 'float' as const }] } }, documents: {
      a: { ...first, modelId: 'm', modelColumnBindings: { p: first.content.columns[1] } },
      b: { ...second, modelId: 'm', modelColumnBindings: { p: second.content.columns[0] }, columnNames: { [second.content.columns[1]]: 'Other' } },
    } };
    expect(columnRenameTarget(book, 'a', first.content.columns[0])?.kind).toBe('ordinary');
    expect(columnRenameTarget(book, 'a', first.content.columns[1])?.kind).toBe('property');
    expect(renameColumn(book, 'a', first.content.columns[1], 'Other')).toEqual({ ok: false, reason: 'duplicate', sheetId: 'b' });
    expect(renameColumn(book, 'a', first.content.columns[1], ' ')).toEqual({ ok: false, reason: 'empty' });
    const renamed = renameColumn(book, 'a', first.content.columns[1], ' Price ');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.dataModels?.m.columns[0].name).toBe('Price');
    expect(renamed.value.documents).toBe(book.documents);
    expect(renameColumn(renamed.value, 'a', first.content.columns[1], 'Price')).toEqual({ ok: true, value: renamed.value });
  });
});
