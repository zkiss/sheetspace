import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { addDataModel, bindSheetToDataModel, replaceDataModel, unbindSheetFromDataModel, type ModelWorkbook } from './dataModel';
import type { DataModel } from '../core/model';
import { materializedDataModelCells } from '../../calculation/modelMaterialization';
import { applyBackendWorkbookReconciliation, applyWorkbookOperation, replayCellPersistenceWrites } from '../../application/core/userActions';

const model: DataModel = {
  id: 'forecast', name: 'Forecast', properties: [
    { id: 'amount', name: 'Amount', kind: 'manual' },
    { id: 'double', name: 'Double', kind: 'calculated', formula: '=@A[1]*2' },
  ],
};

function workbook(): ModelWorkbook {
  return { ...workbookWithSheets([sheetDocument({ id: 'sales', name: 'Sales', rowCount: 2, columnCount: 1, cells: { A1: '3', A2: '4' } })]), dataModels: { forecast: model } };
}

describe('data model mutations', () => {
  it('adds independently reusable validated model definitions', () => {
    const source = workbookWithSheets([sheetDocument({ id: 'sales', name: 'Sales' })]);
    const added = addDataModel(source, model);

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.documents).toBe(source.documents);
    expect(addDataModel(added.value, model)).toEqual({ ok: false, reason: 'duplicate-model' });
  });

  it('binds by declaration order, keeps manual values, and applies a rebased formula to every row', () => {
    const result = bindSheetToDataModel(workbook(), 'sales', 'forecast', ['sales:column:2']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sheet = result.value.documents.sales;
    expect(sheet.dataModelId).toBe('forecast');
    expect(sheet.content.columns).toEqual(['sales:column:1', 'sales:column:2']);
    expect(sheet.content.cells[cellIdentityKey({ rowId: 'sales:row:1', columnId: 'sales:column:1' })]).toBe('3');
    expect(sheet.content.cells[cellIdentityKey({ rowId: 'sales:row:2', columnId: 'sales:column:1' })]).toBe('4');
    expect(sheet.content.cells[cellIdentityKey({ rowId: 'sales:row:1', columnId: 'sales:column:2' })]).toContain('sales:row:1');
    expect(sheet.content.cells[cellIdentityKey({ rowId: 'sales:row:2', columnId: 'sales:column:2' })]).toContain('sales:row:2');
  });

  it('rejects invalid binding without changing the workbook', () => {
    const source = workbook();
    expect(bindSheetToDataModel(source, 'sales', 'forecast', [])).toEqual({ ok: false, reason: 'column-id-required' });
    expect(bindSheetToDataModel({ ...source, dataModels: { forecast: { ...model, properties: [model.properties[0]!, { id: 'other', name: 'Amount', kind: 'manual' }] } } }, 'sales', 'forecast', ['new'])).toEqual({ ok: false, reason: 'duplicate-property-name' });
  });

  it('preserves unchanged property column identities across reordering and gives renamed properties new columns', () => {
    const bound = bindSheetToDataModel(workbook(), 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const result = replaceDataModel(bound.value, {
      ...model,
      properties: [model.properties[1]!, { id: 'renamed', name: 'Revised amount', kind: 'manual' }],
    }, { sales: ['sales:column:3'] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents.sales.content.columns).toEqual(['sales:column:2', 'sales:column:3']);
    expect(result.value.documents.sales.content.cells[cellIdentityKey({ rowId: 'sales:row:1', columnId: 'sales:column:3' })]).toBeUndefined();
  });

  it('gives a reintroduced property name a fresh column without its removed contents', () => {
    const bound = bindSheetToDataModel(workbook(), 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const removed = replaceDataModel(bound.value, {
      ...model,
      properties: [model.properties[1]!],
    }, { sales: [] });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;

    const reintroduced = replaceDataModel(removed.value, {
      ...model,
      properties: [model.properties[1]!, { id: 'new-amount', name: 'Amount', kind: 'manual' }],
    }, { sales: ['sales:column:3'] });
    expect(reintroduced.ok).toBe(true);
    if (!reintroduced.ok) return;

    const sheet = reintroduced.value.documents.sales;
    expect(sheet.content.columns).toEqual(['sales:column:2', 'sales:column:3']);
    expect(sheet.content.cells[cellIdentityKey({ rowId: 'sales:row:1', columnId: 'sales:column:3' })]).toBeUndefined();
  });

  it('clears model-owned formulas when a calculated property becomes manual', () => {
    const bound = bindSheetToDataModel(workbook(), 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const result = replaceDataModel(bound.value, {
      ...model,
      properties: [model.properties[0]!, { id: 'double', name: 'Double', kind: 'manual' }],
    }, { sales: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents.sales.content.cells[cellIdentityKey({ rowId: 'sales:row:1', columnId: 'sales:column:2' })]).toBeUndefined();
  });

  it('unbinds without clearing rows, columns, or materialized calculated content', () => {
    const bound = bindSheetToDataModel(workbook(), 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const result = unbindSheetFromDataModel(bound.value, 'sales', materializedDataModelCells(bound.value, 'sales'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents.sales.dataModelId).toBeUndefined();
    expect(result.value.documents.sales.content.rows).toHaveLength(2);
    expect(result.value.documents.sales.content.columns).toHaveLength(2);
    expect(result.value.documents.sales.content.cells[cellIdentityKey({ rowId: 'sales:row:1', columnId: 'sales:column:2' })]).toBe('6');
    expect(result.value.documents.sales.content.cells[cellIdentityKey({ rowId: 'sales:row:2', columnId: 'sales:column:2' })]).toBe('8');
  });

  it('materializes calculated formulas on application row append and rejects calculated writes atomically', () => {
    const bound = bindSheetToDataModel(workbook(), 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const appended = applyBackendWorkbookReconciliation(bound.value, { kind: 'append-row', sheetId: 'sales', rowId: 'sales:row:3' });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    const sheet = appended.value.nextWorkbook.documents.sales;
    expect(sheet.content.cells[cellIdentityKey({ rowId: 'sales:row:3', columnId: 'sales:column:2' })]).toContain('sales:row:3');

    const writes = [
      { sheetId: 'sales', rowId: 'sales:row:1', columnId: 'sales:column:1', raw: '9' },
      { sheetId: 'sales', rowId: 'sales:row:1', columnId: 'sales:column:2', raw: '99' },
    ];
    expect(applyWorkbookOperation(appended.value.nextWorkbook, { kind: 'write-cells', operationId: 'mixed', writes }))
      .toEqual({ ok: false, reason: 'invalid-cell' });
    expect(replayCellPersistenceWrites(appended.value.nextWorkbook, [{
      ...writes[1]!, beforeRaw: sheet.content.cells[cellIdentityKey({ rowId: 'sales:row:1', columnId: 'sales:column:2' })]!, afterRaw: '99',
    }], 'before')).toEqual({ ok: false, reason: 'invalid-cell' });
  });

  it('materializes calculated formulas when an empty bound sheet receives its first row', () => {
    const empty = {
      ...workbookWithSheets([sheetDocument({ id: 'empty', name: 'Empty', rowCount: 0, columnCount: 1 })]),
      dataModels: { forecast: model },
    };
    const bound = bindSheetToDataModel(empty, 'empty', 'forecast', ['empty:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const appended = applyBackendWorkbookReconciliation(bound.value, { kind: 'append-row', sheetId: 'empty', rowId: 'empty:row:1' });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    const calculatedCell = cellIdentityKey({ rowId: 'empty:row:1', columnId: 'empty:column:2' });
    expect(appended.value.nextWorkbook.documents.empty.content.cells[calculatedCell]).toContain('empty:row:1');
  });
});
