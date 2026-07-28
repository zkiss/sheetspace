import { describe, expect, it } from 'vitest';
import { createSheet, type Sheet, type Workbook } from './workbook';
import {
  calculationProjection,
  calculationRequest,
  mergeCalculationImpacts,
} from './workbookCalculation';

function sheetWithCells(cells: Sheet['cells'] = {}): Sheet {
  const created = createSheet({ id: 'sheet-1', name: 'Inputs' });
  if (!created.ok) {
    throw new Error('Failed to create test sheet');
  }
  return { ...created.value, cells };
}

function workbook(sheet: Sheet): Workbook {
  return { version: 1, sheets: [sheet] };
}

describe('workbook calculation boundary', () => {
  it('projects only sheet identity, ordered grid structure, and raw cells', () => {
    expect(calculationProjection(workbook(sheetWithCells({ A1: '=1' })))).toEqual({
      sheets: [{
        id: 'sheet-1',
        rowCount: 20,
        columnCount: 10,
        cells: { A1: '=1' },
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
    expect(request.projection.sheets[0].cells.A1).toBe('2');
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
