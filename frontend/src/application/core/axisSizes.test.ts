import { describe, expect, it } from 'vitest';
import { applyWorkbookOperation, type WorkbookOperation } from './userActions';
import { emptySheetPresentation, AXIS_SIZE_LIMITS, isValidAxisSize } from '@workbook/core/axisSizePolicy';
import type { AxisSizeWrite } from '@workbook/core/model';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const sheet = sheetDocument({ id: 's', name: 'Sizes', cells: { A1: '=B1', B1: '3' } });
const workbook = workbookWithSheets([sheet]);
const row = sheet.content.rows[0], column = sheet.content.columns[0];
const apply = (writes: readonly AxisSizeWrite[], source = workbook, sheetId = sheet.id) =>
  applyWorkbookOperation(source, { kind: 'write-axis-sizes', operationId: 'op', sheetId, writes });

describe('axis size operations', () => {
  it('has sparse defaults and inclusive finite size limits', () => {
    expect(emptySheetPresentation()).toEqual({ rowHeights: {}, columnWidths: {} });
    for (const axis of ['row', 'column'] as const) {
      expect(isValidAxisSize(axis, AXIS_SIZE_LIMITS[axis].min)).toBe(true);
      expect(isValidAxisSize(axis, AXIS_SIZE_LIMITS[axis].max)).toBe(true);
      expect(isValidAxisSize(axis, AXIS_SIZE_LIMITS[axis].min - 1)).toBe(false);
      expect(isValidAxisSize(axis, AXIS_SIZE_LIMITS[axis].max + 1)).toBe(false);
      expect(isValidAxisSize(axis, NaN)).toBe(false);
      expect(isValidAxisSize(axis, Infinity)).toBe(false);
    }
  });

  it('changes presentation only with durable persistence and inverse data', () => {
    const writes: AxisSizeWrite[] = [{ axis: 'row', axisId: row, size: 40 }, { axis: 'column', axisId: column, size: 120 }];
    const result = apply(writes);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('failed');
    const { nextWorkbook, persistence, inverse, calculationImpact } = result.value;
    const sized = nextWorkbook.documents[sheet.id];
    expect(sized.presentation).toEqual({ rowHeights: { [row]: 40 }, columnWidths: { [column]: 120 } });
    expect(sized.content).toBe(sheet.content);
    expect(sized.frame).toBe(sheet.frame);
    expect(sized.revision).toBe(sheet.revision);
    expect(calculationImpact).toEqual({ kind: 'none' });
    expect(persistence).toEqual({ kind: 'write-axis-sizes', sheetId: sheet.id, writes });
    expect(inverse).toEqual({ kind: 'write-axis-sizes', sheetId: sheet.id, writes: writes.map((write) => ({ ...write, size: null })) });
    writes[0].size = 100;
    expect(persistence?.kind === 'write-axis-sizes' && persistence.writes[0].size).toBe(40);
    const undone = applyWorkbookOperation(nextWorkbook, { ...inverse, operationId: 'undo' } as WorkbookOperation);
    expect(undone.ok && undone.value.nextWorkbook.documents[sheet.id].presentation).toEqual(sheet.presentation);
  });

  it('preserves unrelated targets and restores prior sizes on inverse', () => {
    const first = apply([{ axis: 'row', axisId: row, size: 40 }, { axis: 'column', axisId: column, size: 120 }]);
    if (!first.ok) throw new Error('failed');
    const reset = apply([{ axis: 'row', axisId: row, size: null }], first.value.nextWorkbook);
    if (!reset.ok) throw new Error('failed');
    expect(reset.value.nextWorkbook.documents[sheet.id].presentation).toEqual({ rowHeights: {}, columnWidths: { [column]: 120 } });
    expect(reset.value.inverse).toEqual({ kind: 'write-axis-sizes', sheetId: sheet.id, writes: [{ axis: 'row', axisId: row, size: 40 }] });
    expect(apply([{ axis: 'row', axisId: row, size: null }]).ok).toBe(true);
    const unchanged = apply([{ axis: 'row', axisId: row, size: 40 }], first.value.nextWorkbook);
    expect(unchanged.ok && unchanged.value.changed).toBe(false);
    expect(unchanged.ok && unchanged.value.nextWorkbook).toBe(first.value.nextWorkbook);
  });

  it.each([
    [{ axis: 'row', axisId: row, size: 15 }],
    [{ axis: 'row', axisId: row, size: 1001 }],
    [{ axis: 'column', axisId: column, size: 23 }],
    [{ axis: 'column', axisId: column, size: 2001 }],
    [{ axis: 'row', axisId: row, size: NaN }],
    [{ axis: 'row', axisId: row, size: Infinity }],
    [{ axis: 'row', axisId: row, size: undefined }],
    [{ axis: 'row', axisId: column, size: 30 }],
    [{ axis: 'column', axisId: row, size: null }],
    [{ axis: 'row', axisId: 'foreign', size: null }],
    [{ axis: 'cell', axisId: row, size: 30 }],
    [null],
    [{ axis: 'row', axisId: row, size: 30 }, { axis: 'row', axisId: row, size: null }],
  ].map((writes) => [writes]))('rejects invalid atomic targets %j', (writes) => {
    expect(apply([{ axis: 'column', axisId: column, size: 150 }, ...writes as AxisSizeWrite[]])).toEqual({ ok: false, reason: 'invalid-axis-size' });
    expect(sheet.presentation).toEqual(emptySheetPresentation());
  });

  it('rejects an empty batch and unknown sheet', () => {
    expect(apply([])).toEqual({ ok: false, reason: 'invalid-axis-size' });
    expect(apply([{ axis: 'row', axisId: row, size: 40 }], workbook, 'missing')).toEqual({ ok: false, reason: 'unknown-sheet' });
  });
});
