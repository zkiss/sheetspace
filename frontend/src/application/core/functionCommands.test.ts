import { expect, it } from 'vitest';
import { deleteFunction, setFunction } from './functionCommands';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const declaration = { name: 'fibonacci', parameters: [{ name: 'a', type: 'int' as const }, { name: 'b', type: 'int' as const }], body: '=SUM(a,b)' };

it('creates, edits, renames and deletes declarations without changing unrelated data', () => {
  const workbook = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 })]);
  const created = setFunction(workbook, declaration);
  if (!created.ok) throw new Error(created.reason);
  const edited = setFunction(created.value, { ...declaration, name: 'next', body: '=broken(' }, 'FIBONACCI');
  if (!edited.ok) throw new Error(edited.reason);
  expect(edited.value.functions?.[0]).toMatchObject({ name: 'next', body: '=broken(' });
  expect(edited.value.documents).toEqual(workbook.documents);
  const deleted = deleteFunction(edited.value, 'NEXT');
  expect(deleted.ok && deleted.value.functions).toEqual([]);
  expect(created.value.functions?.[0].body).toBe('=SUM(a,b)');
});

it('rejects invalid declarations and unknown edits or deletions', () => {
  const workbook = workbookWithSheets([]);
  expect(setFunction(workbook, { ...declaration, name: 'SUM' })).toEqual({ ok: false, reason: 'built-in-name' });
  expect(setFunction(workbook, { ...declaration, parameters: [declaration.parameters[0], declaration.parameters[0]] })).toEqual({ ok: false, reason: 'duplicate-parameter-name' });
  expect(setFunction(workbook, declaration, 'missing')).toEqual({ ok: false, reason: 'unknown-function' });
  expect(deleteFunction(workbook, 'missing')).toEqual({ ok: false, reason: 'unknown-function' });
  const created = setFunction(workbook, declaration);
  if (!created.ok) throw new Error(created.reason);
  expect(setFunction(created.value, { ...declaration, name: 'FIBONACCI' })).toEqual({ ok: false, reason: 'duplicate-name' });
});
