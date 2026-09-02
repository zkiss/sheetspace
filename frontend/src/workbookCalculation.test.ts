import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from './workbook/core/cellIdentity';
import { type SheetDocument, type Workbook } from './workbook/core/model';
import {
  calculationProjection,
  calculationRequest,
  mergeCalculationImpacts,
} from './workbookCalculation';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';

function sheetWithCells(cells: Record<string, string> = {}): SheetDocument {
  return sheetDocument({ id: 'sheet-1', name: 'Inputs', cells });
}

function workbook(sheet: SheetDocument): Workbook {
  return workbookWithSheets([sheet]);
}

describe('workbook calculation boundary', () => {
  it('projects sheet identity, ordered stable axes, and identity-keyed raw cells', () => {
    expect(calculationProjection(workbook(sheetWithCells({ A1: '=1' })))).toEqual({
      sheets: [{
        id: 'sheet-1',
        rows: Array.from({ length: 20 }, (_, index) => `sheet-1:row:${index + 1}`),
        columns: Array.from({ length: 10 }, (_, index) => `sheet-1:column:${index + 1}`),
        cells: {
          [cellIdentityKey({ rowId: 'sheet-1:row:1', columnId: 'sheet-1:column:1' })]: '=1',
        },
      }],
    });
  });

  it('carries an action-reported impact with the next projection', () => {
    const next = workbook(sheetWithCells({ A1: '2', B1: '=A1' }));
    const request = calculationRequest(next, {
      kind: 'cells',
      cells: [{ sheetId: 'sheet-1', key: 'A1' }],
    });

    expect(request.impact).toEqual({
      kind: 'cells',
      cells: [{ sheetId: 'sheet-1', key: 'A1' }],
    });
    expect(request.projection.sheets[0].cells[
      cellIdentityKey({ rowId: 'sheet-1:row:1', columnId: 'sheet-1:column:1' })
    ]).toBe('2');
  });

  it('merges batched cell impacts without duplicates', () => {
    expect(mergeCalculationImpacts(
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'A1' }] },
      {
        kind: 'cells',
        cells: [
          { sheetId: 'sheet-1', key: 'A1' },
          { sheetId: 'sheet-1', key: 'B1' },
        ],
      },
    )).toEqual({
      kind: 'cells',
      cells: [
        { sheetId: 'sheet-1', key: 'A1' },
        { sheetId: 'sheet-1', key: 'B1' },
      ],
    });
  });

  it('lets structure invalidation dominate batched cell impacts', () => {
    expect(mergeCalculationImpacts(
      { kind: 'cells', cells: [{ sheetId: 'sheet-1', key: 'A1' }] },
      { kind: 'structure' },
    )).toEqual({ kind: 'structure' });
  });
});
