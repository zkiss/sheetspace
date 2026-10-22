import { describe, expect, it } from 'vitest';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import type { SheetDocument, Workbook } from '@workbook/core/model';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { usageQueries, type UsageCellTarget } from './usageQueries';

describe('usage queries', () => {
  it('returns deterministic direct usages and indirect dependents across sheets and ranges', () => {
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, cells: { A1: '1', A2: '2' } });
    const calculations = sheetDocument({ id: 'calculations', name: 'Calculations', rowCount: 2, cells: {
      A1: '=SUM(@inputs!A[1]:A[2])', B1: '=@A[1]', A2: '=@inputs!A[1]',
    } });
    const queries = usageQueries(workbookWithSheets([inputs, calculations]));

    expect(queries.forCell(target(inputs, 'A1'))).toEqual({
      available: true,
      directUsages: [target(calculations, 'A1'), target(calculations, 'A2')],
      transitiveDependents: [target(calculations, 'B1')],
    });
  });

  it('keeps a direct usage direct when diamond paths also reach it and terminates cycles', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: {
      A1: '1', B1: '=@A[1]', C1: '=@A[1]', D1: '=@B[1]+@C[1]', E1: '=@D[1]',
    } });
    const cyclic = sheetDocument({ id: 'cyclic', name: 'Cyclic', cells: {
      A1: '1', B1: '=@A[1]+@C[1]', C1: '=@B[1]',
    } });

    expect(usageQueries(workbookWithSheets([sheet])).forCell(target(sheet, 'A1'))).toEqual({
      available: true,
      directUsages: [target(sheet, 'B1'), target(sheet, 'C1')],
      transitiveDependents: [target(sheet, 'D1'), target(sheet, 'E1')],
    });
    expect(usageQueries(workbookWithSheets([cyclic])).forCell(target(cyclic, 'A1'))).toEqual({
      available: true,
      directUsages: [target(cyclic, 'B1')],
      transitiveDependents: [target(cyclic, 'C1')],
    });
  });

  it('unions all currently bound sheets for a model property, including empty inputs', () => {
    const first = boundSheet('first', 'First', { B1: '=@A[1]' });
    const second = boundSheet('second', 'Second', { B1: '=@A[1]' });
    const workbook = withModel(workbookWithSheets([first, second]));

    expect(usageQueries(workbook).forProperty({ modelId: 'budget', propertyId: 'input' })).toEqual({
      available: true,
      directUsages: [target(first, 'B1'), target(second, 'B1')],
      transitiveDependents: [],
    });
  });

  it('discovers usages introduced by expanded calculated model formulas', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', cells: { A1: '10' }, columnCount: 1 });
    const output = sheetDocument({ id: 'output', name: 'Output', columnCount: 1 });
    const workbook: Workbook = {
      ...workbookWithSheets([source, output]),
      dataModels: {
        source: { id: 'source', name: 'Source', columns: [{ id: 'amount', name: 'Amount', kind: 'manual', type: 'float' }] },
        output: { id: 'output', name: 'Output', columns: [{ id: 'total', name: 'Total', kind: 'calculated', type: 'float', formula: "=@Source!'Amount'[1]" }] },
      },
    };
    const sourceBound = bindSheetToModel(workbook, source.id, 'source', () => 'unused');
    const outputBound = sourceBound.ok && bindSheetToModel(sourceBound.value, output.id, 'output', () => 'unused');
    if (!outputBound || !outputBound.ok) throw new Error('Unable to bind test models');

    expect(usageQueries(outputBound.value).forProperty({ modelId: 'source', propertyId: 'amount' }).directUsages)
      .toEqual(outputBound.value.documents.output!.content.rows.map((_, index) =>
        target(outputBound.value.documents.output!, `A${index + 1}`),
      ));
  });

  it('does not confuse same-name properties in another model or stale bindings', () => {
    const budget = boundSheet('budget-sheet', 'Budget sheet', { B1: '=@A[1]' });
    const other = { ...boundSheet('other-sheet', 'Other sheet', { B1: '=@A[1]' }), modelId: 'other' };
    const workbook: Workbook = {
      ...withModel(workbookWithSheets([budget, other])),
      dataModels: {
        budget: { id: 'budget', name: 'Budget', columns: [{ id: 'input', name: 'Amount', kind: 'manual', type: 'float' }] },
        other: { id: 'other', name: 'Other', columns: [{ id: 'input', name: 'Amount', kind: 'manual', type: 'float' }] },
      },
    };

    expect(usageQueries(workbook).forProperty({ modelId: 'budget', propertyId: 'input' }).directUsages).toEqual([target(budget, 'B1')]);
    expect(usageQueries(workbook).forProperty({ modelId: 'budget', propertyId: 'removed' })).toEqual({ available: false, directUsages: [], transitiveDependents: [] });
  });

  it('uses the current workbook snapshot after formula and binding changes', () => {
    const sheet = boundSheet('sheet', 'Sheet', { B1: '=@A[1]' });
    const initial = withModel(workbookWithSheets([sheet]));
    const changedSheet = { ...sheet, content: { ...sheet.content, cells: { ...sheet.content.cells, [key(sheet, 'B1')]: '=@C[1]' } } };
    const changed = { ...initial, documents: { [changedSheet.id]: changedSheet } };

    expect(usageQueries(initial).forCell(target(sheet, 'A1')).directUsages).toEqual([target(sheet, 'B1')]);
    expect(usageQueries(changed).forCell(target(changedSheet, 'A1')).directUsages).toEqual([]);
    expect(usageQueries(changed).forCell({ sheetId: 'missing', cell: { rowId: 'row', columnId: 'column' } })).toEqual({ available: false, directUsages: [], transitiveDependents: [] });
  });
});

function boundSheet(id: string, name: string, cells: Record<string, string>): SheetDocument {
  const sheet = sheetDocument({ id, name, cells, columnCount: 2 });
  return { ...sheet, modelId: 'budget', modelColumnBindings: { input: sheet.content.columns[0]! } };
}

function withModel(workbook: Workbook): Workbook {
  return { ...workbook, dataModels: { budget: { id: 'budget', name: 'Budget', columns: [{ id: 'input', name: 'Amount', kind: 'manual', type: 'float' }] } } };
}

function target(sheet: SheetDocument, address: string): UsageCellTarget {
  return { sheetId: sheet.id, cell: cellIdentityAt(sheet.content, address)! };
}

function key(sheet: SheetDocument, address: string): string {
  const identity = cellIdentityAt(sheet.content, address)!;
  return `${identity.rowId}\u0000${identity.columnId}`;
}
