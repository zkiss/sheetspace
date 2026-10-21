import { describe, expect, it } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { calculatedOwnedColumns, isCalculatedOwnedColumn } from '@workbook/core/calculatedOwnership';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const calculatedModel: DataModel = {
  id: 'model',
  name: 'Model',
  columns: [
    { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
    { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=1' },
  ],
};

const manualModel: DataModel = {
  id: 'model',
  name: 'Model',
  columns: [
    { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
    { id: 'output', name: 'Output', kind: 'manual', type: 'float' },
  ],
};

function boundWorkbook(model: DataModel | undefined): Workbook {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', columnCount: 2 });
  const bound = {
    ...sheet,
    modelId: model?.id,
    modelColumnBindings: model ? { input: sheet.content.columns[0]!, output: sheet.content.columns[1]! } : undefined,
  };
  return { ...workbookWithSheets([bound]), dataModels: model ? { [model.id]: model } : undefined };
}

describe('calculated ownership', () => {
  it('owns the bound column of a calculated property and nothing else', () => {
    const workbook = boundWorkbook(calculatedModel);

    expect([...calculatedOwnedColumns(workbook.documents.sheet!, workbook.dataModels)]).toEqual(['sheet:column:2']);
    expect(isCalculatedOwnedColumn(workbook, 'sheet', 'sheet:column:1')).toBe(false);
    expect(isCalculatedOwnedColumn(workbook, 'sheet', 'sheet:column:2')).toBe(true);
  });

  it('owns nothing without a model, without a declaration and without a binding', () => {
    const unbound = boundWorkbook(undefined);
    const undeclared = { ...boundWorkbook(calculatedModel), dataModels: undefined };
    const withoutBinding = boundWorkbook(calculatedModel);
    withoutBinding.documents.sheet!.modelColumnBindings = { input: 'sheet:column:1' };

    expect(isCalculatedOwnedColumn(unbound, 'sheet', 'sheet:column:2')).toBe(false);
    expect(isCalculatedOwnedColumn(undeclared, 'sheet', 'sheet:column:2')).toBe(false);
    expect(isCalculatedOwnedColumn(withoutBinding, 'sheet', 'sheet:column:2')).toBe(false);
    expect(isCalculatedOwnedColumn(boundWorkbook(calculatedModel), 'missing', 'sheet:column:2')).toBe(false);
  });

  it('follows the live declaration instead of the raw text of a cell', () => {
    const calculated = boundWorkbook(calculatedModel);
    const manual = boundWorkbook(manualModel);

    expect([...calculatedOwnedColumns(calculated.documents.sheet!, calculated.dataModels)]).toEqual(['sheet:column:2']);
    expect([...calculatedOwnedColumns(manual.documents.sheet!, manual.dataModels)]).toEqual([]);
  });
});
