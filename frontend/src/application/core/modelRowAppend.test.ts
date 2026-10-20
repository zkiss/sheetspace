import { describe, expect, it } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellRawContent } from '@workbook/read/queries';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { appendRow } from '@workbook/mutations/operations';
import { replaceDataModel } from '@workbook/mutations/dataModel';
import { bindSheetToModel } from './modelLifecycle';
import { refreshAppendedModelRows } from './modelRowAppend';

const model: DataModel = { id: 'model', name: 'Model', columns: [
  { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
  { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=SUM(@A[1])' },
] };

describe('appended model row refresh', () => {
  it('prunes obsolete metadata templates without rewriting cells and fills missing bindings on append', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
    const bound = bindSheetToModel(workbook, sheet.id, model.id, () => 'new');
    if (!bound.ok) throw new Error(bound.reason);
    const renamed = replaceDataModel(bound.value, { ...model, name: 'Renamed' });
    if (!renamed.ok) throw new Error(renamed.reason);
    expect(renamed.value.documents.sheet!.modelFormulaBindings).toEqual(bound.value.documents.sheet!.modelFormulaBindings);
    const edited = replaceDataModel(renamed.value, { ...model, columns: [model.columns[0]!, { ...model.columns[1]!, kind: 'calculated', formula: '=3' }] });
    if (!edited.ok) throw new Error(edited.reason);
    expect(edited.value.documents.sheet!.modelFormulaBindings).toEqual({});
    expect(edited.value.documents.sheet!.content).toBe(bound.value.documents.sheet!.content);
    const appended = { ...edited.value, documents: { sheet: appendRow(edited.value.documents.sheet!, 'server-row') } };
    expect(cellRawContent(refreshAppendedModelRows(appended).nextWorkbook.documents.sheet!, 'B2')).toBe('=3');
  });
  it('does not manufacture writes for unbound sheets or already-instantiated calculations', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
    expect(refreshAppendedModelRows(workbook)).toEqual({ nextWorkbook: workbook, writes: [], modelFormulaBindings: [] });
    const bound = bindSheetToModel(workbook, sheet.id, model.id, () => 'new');
    if (!bound.ok) throw new Error(bound.reason);
    expect(refreshAppendedModelRows(bound.value).writes).toEqual([]);
  });

  it('uses declarations when a metadata-only bound sheet receives its first authoritative row', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 0, columnCount: 2 });
    const bound = { ...sheet, modelId: model.id, modelColumnBindings: { input: sheet.content.columns[0]!, output: sheet.content.columns[1]! } };
    const workbook: Workbook = { ...workbookWithSheets([appendRow(bound, 'server-row')]), dataModels: { model } };
    const refreshed = refreshAppendedModelRows(workbook);

    expect(refreshed.writes).toEqual([{ sheetId: sheet.id, rowId: 'server-row', columnId: sheet.content.columns[1], beforeRaw: null, afterRaw: cellRawContent(refreshed.nextWorkbook.documents.sheet!, 'B1') }]);
    expect(refreshed.nextWorkbook.documents.sheet!.modelFormulaBindings?.output.raw).toBe('=SUM(@A[1])');
    expect(cellRawContent(refreshed.nextWorkbook.documents.sheet!, 'A1')).toBeUndefined();
  });
});
