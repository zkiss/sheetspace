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

  it('gives a name-only rename a fresh column without retaining manual values', () => {
    const bound = bindSheetToDataModel(workbook(), 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const result = replaceDataModel(bound.value, {
      ...model,
      properties: [model.properties[1]!, { id: 'amount', name: 'Revised amount', kind: 'manual' }],
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

  it('removes cell presentation belonging to columns removed by binding or schema changes', () => {
    const source = workbook();
    const oldColumn = source.documents.sales!.content.columns[0]!;
    const withOverride = {
      ...source,
      documents: {
        ...source.documents,
        sales: {
          ...source.documents.sales!,
          presentation: {
            ...source.documents.sales!.presentation,
            formatOverrides: { rows: {}, columns: {}, cells: {
              [cellIdentityKey({ rowId: 'sales:row:1', columnId: oldColumn })]: { fontWeight: 'bold' as const },
            } },
          },
        },
      },
    };
    const bound = bindSheetToDataModel(withOverride, 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const removed = replaceDataModel(bound.value, { ...model, properties: [model.properties[1]!] }, { sales: [] });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.documents.sales!.presentation.formatOverrides?.cells).toEqual({});
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

  it('rejects ordinary column reconciliation for a bound sheet without changing its model-owned shape', () => {
    const bound = bindSheetToDataModel(workbook(), 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    expect(applyBackendWorkbookReconciliation(bound.value, {
      kind: 'append-column', sheetId: 'sales', columnId: 'unmodelled-column',
    })).toEqual({ ok: false, reason: 'invalid-cell' });
    expect(bound.value.documents.sales.content.columns).toEqual(['sales:column:1', 'sales:column:2']);
  });

  it('rebases relative model references while preserving absolute and cross-sheet targets on row append', () => {
    const formulaModel: DataModel = {
      id: 'forecast', name: 'Forecast', properties: [
        { id: 'amount', name: 'Amount', kind: 'manual' },
        { id: 'total', name: 'Total', kind: 'calculated', formula: '=@A[1]+@$A[$1]+@Inputs!$A[$1]' },
      ],
    };
    const source = {
      ...workbookWithSheets([
        sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 1, columnCount: 1, cells: { A1: '10' } }),
        sheetDocument({ id: 'sales', name: 'Sales', rowCount: 2, columnCount: 1, cells: { A1: '3', A2: '4' } }),
      ]),
      dataModels: { forecast: formulaModel },
    };
    const bound = bindSheetToDataModel(source, 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const calculatedColumn = 'sales:column:2';
    const raw = (rowId: string) => bound.value.documents.sales.content.cells[cellIdentityKey({ rowId, columnId: calculatedColumn })];
    expect(raw('sales:row:1')).toBe('=@sales:column:1[sales:row:1]+@$sales:column:1[$sales:row:1]+@inputs!$inputs:column:1[$inputs:row:1]');
    expect(raw('sales:row:2')).toBe('=@sales:column:1[sales:row:2]+@$sales:column:1[$sales:row:1]+@inputs!$inputs:column:1[$inputs:row:1]');
    expect(materializedDataModelCells(bound.value, 'sales')).toMatchObject({
      [cellIdentityKey({ rowId: 'sales:row:1', columnId: calculatedColumn })]: '16',
      [cellIdentityKey({ rowId: 'sales:row:2', columnId: calculatedColumn })]: '17',
    });

    const appended = applyBackendWorkbookReconciliation(bound.value, { kind: 'append-row', sheetId: 'sales', rowId: 'sales:row:3' });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    const appendedRaw = appended.value.nextWorkbook.documents.sales.content.cells[cellIdentityKey({ rowId: 'sales:row:3', columnId: calculatedColumn })];
    expect(appendedRaw).toBe('=@sales:column:1[sales:row:3]+@$sales:column:1[$sales:row:1]+@inputs!$inputs:column:1[$inputs:row:1]');
    const input = applyWorkbookOperation(appended.value.nextWorkbook, {
      kind: 'write-cells', operationId: 'set-appended-input',
      writes: [{ sheetId: 'sales', rowId: 'sales:row:3', columnId: 'sales:column:1', raw: '5' }],
    });
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    expect(materializedDataModelCells(input.value.nextWorkbook, 'sales')[cellIdentityKey({ rowId: 'sales:row:3', columnId: calculatedColumn })]).toBe('18');
  });

  it('retains same-named properties across reorder even when their declaration IDs change', () => {
    const bound = bindSheetToDataModel(workbook(), 'sales', 'forecast', ['sales:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const sales = bound.value.documents.sales;
    const amountColumn = sales.content.columns[0]!;
    const withPresentation = {
      ...bound.value,
      documents: {
        ...bound.value.documents,
        sales: {
          ...sales,
          presentation: {
            ...sales.presentation,
            columnWidths: { [amountColumn]: 160 },
          },
        },
      },
    };

    const result = replaceDataModel(withPresentation, {
      ...model,
      properties: [
        { id: 'replacement-double', name: 'Double', kind: 'calculated', formula: '=@A[1]*2' },
        { id: 'replacement-amount', name: 'Amount', kind: 'manual' },
      ],
    }, { sales: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents.sales.content.columns).toEqual(['sales:column:2', amountColumn]);
    expect(result.value.documents.sales.content.cells[cellIdentityKey({ rowId: 'sales:row:1', columnId: amountColumn })]).toBe('3');
    expect(result.value.documents.sales.presentation.columnWidths[amountColumn]).toBe(160);
  });

  it('reconciles every bound sheet atomically when replacement column IDs are invalid', () => {
    const source = {
      ...workbookWithSheets([
        sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 1, cells: { A1: '1' } }),
        sheetDocument({ id: 'second', name: 'Second', rowCount: 1, columnCount: 1, cells: { A1: '2' } }),
      ]),
      dataModels: { forecast: model },
    };
    const first = bindSheetToDataModel(source, 'first', 'forecast', ['first:column:2']);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const bound = bindSheetToDataModel(first.value, 'second', 'forecast', ['second:column:2']);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const result = replaceDataModel(bound.value, {
      ...model,
      properties: [...model.properties, { id: 'note', name: 'Note', kind: 'manual' }],
    }, { first: ['first:column:3'], second: [] });

    expect(result).toEqual({ ok: false, reason: 'column-id-required' });
    expect(bound.value.documents.first.content.columns).toEqual(['first:column:1', 'first:column:2']);
    expect(bound.value.documents.second.content.columns).toEqual(['second:column:1', 'second:column:2']);
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
