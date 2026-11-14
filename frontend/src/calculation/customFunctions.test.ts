import { describe, expect, it } from 'vitest';
import { bindCustomFunctionsForSheet, deleteCustomFunction, removeCustomFunctionSheetBindings, setCustomFunction, validateCustomFunction } from './customFunctions';
import type { CustomFunction, Workbook } from '@workbook/core/model';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const definition: CustomFunction = { name: 'fibonacci', parameters: [{ name: 'a', type: 'int' }, { name: 'b', type: 'float' }], body: '=SUM(a,b)' };
const workbook: Workbook = { manifest: { version: 1, revision: 0, sheetIds: [] }, documents: {} };

describe('custom function declarations', () => {
  it('accepts arbitrary parameter counts and preserves malformed bodies', () => {
    const result = setCustomFunction(workbook, { ...definition, parameters: Array.from({ length: 100 }, (_, index) => ({ name: `p${index}`, type: 'boolean' })), body: '=broken(' });
    expect(result.ok && result.workbook.functions?.[0].body).toBe('=broken(');
    expect(validateCustomFunction({ ...definition, parameters: [] }, [])).toBeUndefined();
  });

  it('preserves non-formula drafts without preparing invalid stored formulas', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 1 });
    const result = setCustomFunction(workbookWithSheets([sheet]), { ...definition, body: 'broken' });
    if (!result.ok) throw new Error(result.error);
    expect(result.workbook.functions![0]).toMatchObject({ body: 'broken', bodyBindings: {} });
    expect(bindCustomFunctionsForSheet(result.workbook, sheet.id).functions![0].bodyBindings).toEqual({});
  });

  it('rejects invalid or colliding names and parameter declarations', () => {
    expect(validateCustomFunction({ ...definition, name: '1abc' }, [])).toBe('invalid-name');
    expect(validateCustomFunction({ ...definition, name: 'sum' }, [])).toBe('built-in-name');
    expect(validateCustomFunction({ ...definition, name: 'FIBONACCI' }, [definition])).toBe('duplicate-name');
    expect(validateCustomFunction({ ...definition, parameters: [{ name: 'true', type: 'int' }] }, [])).toBe('invalid-parameter-name');
    expect(validateCustomFunction({ ...definition, parameters: [{ name: 'a', type: 'int' }, { name: 'A', type: 'string' }] }, [])).toBe('duplicate-parameter-name');
    expect(validateCustomFunction({ ...definition, parameters: [{ name: 'x', type: 'unknown' as 'int' }] }, [])).toBe('invalid-parameter-type');
  });

  it('renames and deletes definitions case-insensitively without mutating the original', () => {
    const original = { ...workbook, functions: [definition] };
    const result = setCustomFunction(original, { ...definition, name: 'next' }, 'FIBONACCI');
    expect(result.ok && result.workbook.functions?.map((item) => item.name)).toEqual(['next']);
    expect(original.functions).toEqual([definition]);
    expect(result.ok && deleteCustomFunction(result.workbook, 'NEXT').functions).toEqual([]);
  });

  it('binds a newly admitted caller without changing earlier caller bindings', () => {
    const first = sheetDocument({ id: 'first', name: 'First', rowCount: 2, columnCount: 1 });
    const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 2, columnCount: 1 });
    const result = setCustomFunction(workbookWithSheets([first]), { name: 'f', parameters: [], body: '=@A[1]' });
    if (!result.ok) throw new Error(result.error);
    const oldBinding = result.workbook.functions![0].bodyBindings![first.id];
    const withSecond = { ...result.workbook, documents: { ...result.workbook.documents, [second.id]: second } };
    const bound = bindCustomFunctionsForSheet(withSecond, second.id);
    expect(bound.functions![0].bodyBindings![first.id]).toBe(oldBinding);
    expect(bound.functions![0].bodyBindings![second.id]).toContain(second.content.rows[0]);
    const reordered = { ...bound, documents: { ...bound.documents, [second.id]: { ...second, content: { ...second.content, rows: [...second.content.rows].reverse() } } } };
    expect(bindCustomFunctionsForSheet(reordered, second.id).functions![0].bodyBindings).toEqual(bound.functions![0].bodyBindings);
    const removed = removeCustomFunctionSheetBindings(bound, [second.id]);
    expect(removed.functions![0].bodyBindings).toEqual({ [first.id]: oldBinding });
    expect(bindCustomFunctionsForSheet({ ...removed, documents: reordered.documents }, second.id).functions![0].bodyBindings![second.id]).toContain(second.content.rows[1]);
    expect(withSecond.functions![0].bodyBindings![second.id]).toBeUndefined();
    expect(bindCustomFunctionsForSheet(bound, 'missing')).toBe(bound);
    expect(bindCustomFunctionsForSheet(workbook, 'missing')).toBe(workbook);
  });
});
