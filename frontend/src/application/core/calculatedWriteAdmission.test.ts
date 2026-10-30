import { describe, expect, it } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { bindSheetToModel, replaceModelDeclaration, unbindSheetFromModel } from '@application/core/modelLifecycle';
import { applyWorkbookOperation, replayCellPersistenceWrites, type CellPersistenceWrite } from '@application/core/userActions';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';

const model: DataModel = {
  id: 'model',
  name: 'Model',
  columns: [
    { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
    { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=1' },
  ],
};

const input = 'sheet:column:1';
const output = 'sheet:column:2';
const firstRow = 'sheet:row:1';

function boundWorkbook(): Workbook {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2 });
  const workbook: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
  const bound = bindSheetToModel(workbook, sheet.id, model.id, () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  return bound.value;
}

function cellRaw(workbook: Workbook, columnId: string, rowId = firstRow) {
  return workbook.documents.sheet!.content.cells[cellIdentityKey({ rowId, columnId })];
}

function writeCells(workbook: Workbook, writes: { columnId: string; raw: string; rowId?: string }[]) {
  return applyWorkbookOperation(workbook, {
    kind: 'write-cells',
    operationId: 'ordinary-write',
    writes: writes.map(({ columnId, raw, rowId }) => ({ sheetId: 'sheet', rowId: rowId ?? firstRow, columnId, raw })),
  });
}

describe('calculated write admission', () => {
  it('rejects a calculated target as a whole and leaves manual data untouched', () => {
    const workbook = boundWorkbook();

    const result = writeCells(workbook, [{ columnId: input, raw: '5' }, { columnId: output, raw: '9' }]);

    expect(result).toEqual({ ok: false, reason: 'calculated-cell-write' });
    expect(cellRaw(workbook, input)).toBeUndefined();
    expect(projectStoredFormula(cellRaw(workbook, output)!, workbook, 'sheet').text).toBe('=1');
  });

  it('rejects a protected target before a no-op target can carry a manual change through', () => {
    const workbook = boundWorkbook();

    const result = writeCells(workbook, [{ columnId: output, raw: '=1' }, { columnId: input, raw: '5' }]);

    expect(result).toEqual({ ok: false, reason: 'calculated-cell-write' });
  });

  it('rejects a calculated target on another sheet of the same batch', () => {
    const workbook = boundWorkbook();
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 2 });
    const multiSheet = { ...workbook, documents: { ...workbook.documents, other: { ...other, modelId: 'model', modelColumnBindings: { input: other.content.columns[0]!, output: other.content.columns[1]! } } } };

    const result = applyWorkbookOperation(multiSheet, {
      kind: 'write-cells',
      operationId: 'cross-sheet',
      writes: [
        { sheetId: 'other', rowId: 'other:row:1', columnId: 'other:column:1', raw: '5' },
        { sheetId: 'sheet', rowId: firstRow, columnId: output, raw: '9' },
      ],
    });

    expect(result).toEqual({ ok: false, reason: 'calculated-cell-write' });
  });

  it('keeps ownership with the declaration when a property changes kind', () => {
    const manual = replaceModelDeclaration(boundWorkbook(), {
      ...model,
      columns: [model.columns[0]!, { id: 'output', name: 'Output', kind: 'manual', type: 'float' }],
    }, () => 'unused');
    expect(manual.ok).toBe(true);
    if (!manual.ok) return;

    const result = writeCells(manual.value, [{ columnId: output, raw: '9' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(cellRaw(result.value.nextWorkbook, output)).toBe('9');
  });

  it('rejects a stale replay that would alter a calculation the model owns now', () => {
    const workbook = boundWorkbook();
    const undo: CellPersistenceWrite[] = [{ sheetId: 'sheet', rowId: firstRow, columnId: output, beforeRaw: '=1', afterRaw: '=2' }];
    const redo: CellPersistenceWrite[] = [{ sheetId: 'sheet', rowId: firstRow, columnId: output, beforeRaw: '=0', afterRaw: '=1' }];

    expect(replayCellPersistenceWrites(workbook, undo, 'before')).toEqual({ ok: false, reason: 'calculated-cell-write' });
    expect(replayCellPersistenceWrites(workbook, redo, 'after')).toEqual({ ok: false, reason: 'calculated-cell-write' });
  });

  it('rejects a stale replay whose raw content still matches the owned calculation', () => {
    const workbook = boundWorkbook();
    const writes: CellPersistenceWrite[] = [{ sheetId: 'sheet', rowId: firstRow, columnId: output, beforeRaw: '=1', afterRaw: '=1' }];

    expect(replayCellPersistenceWrites(workbook, writes, 'before')).toEqual({ ok: false, reason: 'calculated-cell-write' });
  });

  it('rejects a mixed multi-sheet history as a whole', () => {
    const workbook = boundWorkbook();
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
    const multiSheet = { ...workbook, documents: { ...workbook.documents, other } };
    const writes: CellPersistenceWrite[] = [
      { sheetId: 'other', rowId: 'other:row:1', columnId: 'other:column:1', beforeRaw: null, afterRaw: '5' },
      { sheetId: 'sheet', rowId: firstRow, columnId: output, beforeRaw: '=1', afterRaw: '=2' },
    ];

    expect(replayCellPersistenceWrites(multiSheet, writes, 'before')).toEqual({ ok: false, reason: 'calculated-cell-write' });
  });

  it('keeps manual and unbound replay working', () => {
    const workbook = boundWorkbook();
    const writes: CellPersistenceWrite[] = [{ sheetId: 'sheet', rowId: firstRow, columnId: input, beforeRaw: null, afterRaw: '5' }];

    const result = replayCellPersistenceWrites(workbook, writes, 'before');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(cellRaw(result.value.nextWorkbook, input)).toBe('5');
  });

  it('rejects a stale replay of a column that a later declaration made calculated', () => {
    const recalculated = replaceModelDeclaration(boundWorkbook(), {
      ...model,
      columns: [
        { id: 'input', name: 'Input', kind: 'calculated', type: 'float', formula: '=1' },
        model.columns[1]!,
      ],
    }, () => 'unused');
    expect(recalculated.ok).toBe(true);
    if (!recalculated.ok) return;
    const writes: CellPersistenceWrite[] = [{ sheetId: 'sheet', rowId: firstRow, columnId: input, beforeRaw: '=1', afterRaw: '=1' }];

    expect(replayCellPersistenceWrites(recalculated.value, writes, 'before')).toEqual({ ok: false, reason: 'calculated-cell-write' });
  });

  it('rejects a stale replay that would resurrect a calculation after an unbind and a rebind', () => {
    const bound = boundWorkbook();
    const unbound = unbindSheetFromModel(bound, 'sheet');
    expect(unbound.ok).toBe(true);
    if (!unbound.ok) return;
    const rebound = bindSheetToModel(unbound.value, 'sheet', model.id, () => 'unused');
    expect(rebound.ok).toBe(true);
    if (!rebound.ok) return;
    const writes: CellPersistenceWrite[] = [{ sheetId: 'sheet', rowId: firstRow, columnId: output, beforeRaw: '=1', afterRaw: '=1' }];

    expect(replayCellPersistenceWrites(rebound.value, writes, 'before')).toEqual({ ok: false, reason: 'calculated-cell-write' });
  });
});
