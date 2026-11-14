import { expect, it } from 'vitest';
import { bindCustomFunctionsForSheet, removeCustomFunctionSheetBindings, setCustomFunction } from '@calculation/customFunctions';
import { renameSheet } from '@workbook/mutations/operations';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { decodeWorkbookBundle, encodeWorkbookBundle } from './workbookApi';

it('retains caller identities and exact declarations through structural changes and reload', () => {
  const first = sheetDocument({ id: 'first', name: 'First', rowCount: 2, columnCount: 1 });
  const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 2, columnCount: 1 });
  const zero = setCustomFunction(workbookWithSheets([first]), { name: 'Zero', parameters: [], body: '=@A[1]' });
  if (!zero.ok) throw new Error(zero.error);
  const many = setCustomFunction(zero.workbook, { name: 'Many', parameters: Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, type: 'int' })), body: '=broken(' });
  if (!many.ok) throw new Error(many.error);
  many.workbook.functions!.forEach((fn, index) => { fn.identity = `lineage-${index}`; });
  const originalBinding = many.workbook.functions![0]!.bodyBindings!.first;
  const admitted = bindCustomFunctionsForSheet({ ...many.workbook, manifest: { ...many.workbook.manifest, sheetIds: ['first', 'second'] }, documents: { first, second } }, 'second');
  const secondBinding = admitted.functions![0]!.bodyBindings!.second;
  expect(secondBinding).toContain(second.content.rows[0]);
  expect(admitted.functions![0]!.bodyBindings!.first).toBe(originalBinding);
  const reordered = { ...admitted, documents: { ...admitted.documents, second: { ...second, content: { ...second.content, rows: [...second.content.rows].reverse() } } } };
  const loaded = decodeWorkbookBundle(JSON.parse(JSON.stringify(encodeWorkbookBundle(reordered))));
  expect(loaded.functions).toEqual(admitted.functions);
  expect(bindCustomFunctionsForSheet(loaded, 'second').functions).toEqual(admitted.functions);
  expect(loaded.functions![1]).toMatchObject({ body: '=broken(', parameters: many.workbook.functions![1]!.parameters });
});

it('does not transfer a deleted caller binding to a new sheet using its name', () => {
  const first = sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 1 });
  const deleted = sheetDocument({ id: 'deleted', name: 'Shared', rowCount: 1, columnCount: 1 });
  const replacement = sheetDocument({ id: 'replacement', name: 'Shared', rowCount: 1, columnCount: 1 });
  const defined = setCustomFunction(workbookWithSheets([first, deleted]), { name: 'F', parameters: [], body: '=@A[1]' });
  if (!defined.ok) throw new Error(defined.error);
  defined.workbook.functions![0].identity = 'lineage';
  const old = defined.workbook.functions![0]!.bodyBindings!;
  const withoutCaller = removeCustomFunctionSheetBindings({ ...defined.workbook, manifest: { ...defined.workbook.manifest, sheetIds: ['first'] }, documents: { first } }, ['deleted']);
  const recreated = bindCustomFunctionsForSheet({ ...withoutCaller, manifest: { ...withoutCaller.manifest, sheetIds: ['first', 'replacement'] }, documents: { first, replacement } }, 'replacement');
  expect(recreated.functions![0]!.bodyBindings).toEqual({ first: old.first, replacement: expect.stringContaining(replacement.content.rows[0]!) });
  expect(recreated.functions![0]!.bodyBindings!.replacement).not.toBe(old.deleted);
  const renamed = renameSheet(recreated, 'first', 'Renamed');
  if (!renamed.ok) throw new Error(renamed.reason);
  expect(decodeWorkbookBundle(encodeWorkbookBundle(renamed.value)).functions).toEqual(recreated.functions);
});

it('retains explicit sheet identities when the original name is reused', () => {
  const caller = sheetDocument({ id: 'caller', name: 'Caller', rowCount: 1, columnCount: 1 });
  const target = sheetDocument({ id: 'target', name: 'Shared', rowCount: 1, columnCount: 1 });
  const defined = setCustomFunction(workbookWithSheets([caller, target]), { name: 'F', parameters: [], body: '=@Shared!A[1]' });
  if (!defined.ok) throw new Error(defined.error);
  defined.workbook.functions![0].identity = 'lineage';
  const original = defined.workbook.functions![0]!.bodyBindings!.caller;
  expect(original).toContain(target.content.rows[0]);
  const renamed = renameSheet(defined.workbook, 'target', 'Renamed');
  if (!renamed.ok) throw new Error(renamed.reason);
  const replacement = sheetDocument({ id: 'replacement', name: 'Shared', rowCount: 1, columnCount: 1 });
  const added = bindCustomFunctionsForSheet({ ...renamed.value, manifest: { ...renamed.value.manifest, sheetIds: ['caller', 'target', 'replacement'] }, documents: { ...renamed.value.documents, replacement } }, 'replacement');
  const loaded = decodeWorkbookBundle(encodeWorkbookBundle(added));
  expect(loaded.functions![0]!.bodyBindings!.caller).toBe(original);
  expect(loaded.functions![0]!.bodyBindings!.caller).not.toContain(replacement.content.rows[0]);
});
