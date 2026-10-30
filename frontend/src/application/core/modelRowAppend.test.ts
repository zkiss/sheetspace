import { describe, expect, it } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellRawContent } from '@workbook/read/queries';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { appendRow } from '@workbook/mutations/operations';
import { decodeStoredFormula } from '@workbook/formula/storedFormula';
import { bindSheetToModel } from './modelLifecycle';
import { materializeAppendedModelRow } from './modelRowAppend';

const model: DataModel = { id: 'model', name: 'Model', columns: [
  { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
  { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=SUM(@A[1])' },
] };

function boundWorkbook(): Workbook {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '3' } });
  const workbook: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
  const bound = bindSheetToModel(workbook, sheet.id, model.id, () => 'new');
  if (!bound.ok) throw new Error(bound.reason);
  return bound.value;
}

describe('appended model row materialization', () => {
  it('mirrors the derived contents of an appended row and keeps manual values', () => {
    const bound = boundWorkbook();
    const appended = { ...bound, documents: { sheet: appendRow(bound.documents.sheet!, 'server-row') } };

    const materialized = materializeAppendedModelRow(appended, 'sheet', 'server-row');

    const instance = decodeStoredFormula(cellRawContent(materialized.documents.sheet!, 'B2')!);
    expect(instance.text).toBe('=SUM(@A[1])');
    expect(instance.occurrences[0].slots.find((slot) => slot.kind === 'row')!.targetIds).toEqual(['server-row']);
    expect(instance.occurrences[0].slots.find((slot) => slot.kind === 'column')!.targetIds).toEqual(['sheet:column:1']);
    expect(cellRawContent(materialized.documents.sheet!, 'A1')).toBe('3');
    expect(cellRawContent(materialized.documents.sheet!, 'A2')).toBeUndefined();
  });

  it('leaves an unbound sheet and a row without persisted templates untouched', () => {
    const unbound = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 })]);
    const appended = { ...unbound, documents: { sheet: appendRow(unbound.documents.sheet!, 'server-row') } };
    const metadataOnly = { ...appended, documents: { sheet: { ...appended.documents.sheet!, modelId: 'model', modelColumnBindings: { input: 'sheet:column:1', output: 'sheet:column:2' } } } };

    expect(materializeAppendedModelRow(appended, 'sheet', 'server-row')).toBe(appended);
    expect(materializeAppendedModelRow(metadataOnly, 'sheet', 'server-row')).toBe(metadataOnly);
  });

  it('reports no change when the appended row already holds the derived contents', () => {
    const bound = boundWorkbook();
    const appended = { ...bound, documents: { sheet: appendRow(bound.documents.sheet!, 'server-row') } };
    const materialized = materializeAppendedModelRow(appended, 'sheet', 'server-row');

    expect(materializeAppendedModelRow(materialized, 'sheet', 'server-row')).toBe(materialized);
  });
});
