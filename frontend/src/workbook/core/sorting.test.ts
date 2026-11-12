import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { deleteColumn } from '@application/core/deleteColumn';
import { reshapeSheet } from '@application/core/modelLifecycle';
import { applyAxisPermutation } from '../mutations/reorderAxis';
import { renameOrdinaryColumn } from '../mutations/renameOrdinaryColumn';
import type { FormulaScalarValue } from '@calculation/formulaValue';
import { setSheetSorting, validSorting } from './sorting';
import { compareSortValues, sortedRowPermutation } from '@calculation/sorting';

const number = (value: number): FormulaScalarValue => ({ kind: 'number', value });
const text = (value: string): FormulaScalarValue => ({ kind: 'text', value });
const blank: FormulaScalarValue = { kind: 'blank' };
const criterion = (columnId: string, direction: 'ascending' | 'descending' = 'ascending') => ({ columnId, direction });

describe('sorting values', () => {
  it('orders types and values deterministically, distinguishing empty text from blank', () => {
    const values: FormulaScalarValue[] = [number(-2), number(10), text(''), text('A'), text('a'), { kind: 'boolean', value: false }, { kind: 'boolean', value: true }, blank, { kind: 'error', error: '#DIV/0!' }, { kind: 'error', error: '#VALUE!' }];
    for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) {
      expect(Math.sign(compareSortValues(values[i]!, values[j]!))).toBe(i === j ? 0 : i < j ? -1 : 1);
    }
  });
});

describe('sheet sorting', () => {
  it('validates criteria and keeps configuration independent and immutable', () => {
    const a = sheetDocument({ id: 'a', name: 'A', columnCount: 2 });
    const b = sheetDocument({ id: 'b', name: 'B' });
    const workbook = workbookWithSheets([a, b]);
    const c = a.content.columns[0]!;
    expect(validSorting(a.content.columns, [criterion(c), criterion(c)])).toBe(false);
    expect(validSorting(a.content.columns, [criterion('missing')])).toBe(false);
    expect(validSorting(a.content.columns, [{ columnId: c, direction: 'bad' } as never])).toBe(false);
    expect(setSheetSorting(workbook, 'missing', [])).toMatchObject({ status: 'rejected' });
    expect(setSheetSorting(workbook, 'a', [criterion('missing')])).toMatchObject({ status: 'rejected' });
    expect(setSheetSorting(workbook, 'a', [])).toEqual({ status: 'unchanged', workbook });
    const criteria = [criterion(c)];
    const result = setSheetSorting(workbook, 'a', criteria);
    expect(result.status).toBe('changed');
    expect(result.workbook.documents.b).toBe(workbook.documents.b);
    criteria[0]!.direction = 'descending';
    expect(result.workbook.documents.a!.sorting).toEqual([criterion(c)]);
    expect(setSheetSorting(result.workbook, 'a', [criterion(c)])).toMatchObject({ status: 'unchanged' });
  });

  it('sorts committed row identities by priority and independent direction, stably retaining cells', () => {
    const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 4, columnCount: 2, cells: { A1: 'raw' } });
    const [a, b] = sheet.content.columns as [string, string];
    sheet.sorting = [criterion(a), criterion(b, 'descending')];
    const keys = [[number(1), text('a')], [number(0), text('z')], [number(1), text('b')], [number(1), text('b')]];
    const order = sortedRowPermutation(sheet, (row, col) => keys[sheet.content.rows.indexOf(row)]![sheet.content.columns.indexOf(col)]!);
    expect(order).toEqual([sheet.content.rows[1], sheet.content.rows[2], sheet.content.rows[3], sheet.content.rows[0]]);
    const workbook = workbookWithSheets([sheet]);
    const result = applyAxisPermutation(workbook, 's', 'row', order);
    expect(result.status).toBe('changed');
    expect(result.workbook.documents.s!.content.cells).toBe(workbook.documents.s!.content.cells);
    expect(sortedRowPermutation({ ...sheet, sorting: [] }, () => { throw Error('unexpected key'); })).toEqual(sheet.content.rows);
    expect(applyAxisPermutation(workbook, 's', 'row', sheet.content.rows).status).toBe('unchanged');
  });

  it('preserves criteria through column reorder and prunes removed columns in both structure paths', () => {
    const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 2 });
    const [a, b] = sheet.content.columns as [string, string];
    sheet.sorting = [criterion(a), criterion(b)];
    const workbook = workbookWithSheets([sheet]);
    const renamed = renameOrdinaryColumn(workbook, 's', a, 'Price');
    expect(renamed.ok && renamed.value.documents.s!.sorting).toEqual(sheet.sorting);
    const reordered = applyAxisPermutation(workbook, 's', 'column', [b, a]);
    expect(reordered.workbook.documents.s!.sorting).toEqual(sheet.sorting);
    const deleted = deleteColumn(workbook, 's', a);
    expect(deleted.ok && deleted.value.documents.s!.sorting).toEqual([criterion(b)]);
    const model = { id: 'm', name: 'Model', columns: [{ id: 'p', name: 'P', kind: 'manual' as const, type: 'string' as const }] };
    expect(reshapeSheet(sheet, model, [b]).sorting).toEqual([criterion(b)]);
  });
});
