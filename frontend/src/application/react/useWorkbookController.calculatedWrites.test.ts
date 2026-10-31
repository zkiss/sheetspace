import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { ClipboardPayloadStore } from '@grid/clipboardPayload';
import { cellTargetAt } from '@grid/cellInteraction';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellRawContent } from '@workbook/read/queries';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { autosaveClient, persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const model: DataModel = { id: 'model', name: 'Model', columns: [
  { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
  { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=SUM(@A[1])' },
  { id: 'extra', name: 'Extra', kind: 'manual', type: 'string' },
] };

/** A sheet whose middle column is owned by a calculated property of its model. */
function boundWorkbook(): Workbook {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 3, cells: { A1: '3', C1: 'text', B2: '1' } });
  const workbook: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
  const bound = bindSheetToModel(workbook, sheet.id, model.id, () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  return bound.value;
}

function clipboardFor(workbook: Workbook, sheetId: string, key: string, kind: 'copy' | 'cut') {
  const sheet = workbook.documents[sheetId]!;
  const store = new ClipboardPayloadStore();
  const selection = { mode: 'cells' as const, anchor: cellTargetAt(sheet, key)!, extent: cellTargetAt(sheet, key)! };
  const payload = kind === 'copy' ? store.copy(workbook, selection) : store.cut(workbook, selection);
  if (!payload.ok) throw new Error('clipboard failed');
  const parsed = store.parse(workbook, payload.value);
  if (!parsed.ok) throw new Error('clipboard parse failed');
  return parsed;
}

describe('useWorkbookController calculated writes', () => {
  it('rejects a trusted mixed batch atomically', () => {
    const workbook = boundWorkbook();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => expect(result.current.commands.writeStoredCells([
      { sheetId: 'sheet', rowId: 'sheet:row:1', columnId: 'sheet:column:1', raw: '9' },
      { sheetId: 'sheet', rowId: 'sheet:row:1', columnId: 'sheet:column:2', raw: '7' },
    ])).toEqual({ ok: false, reason: 'calculated-cell-write' }));
    expect(result.current.workbook).toBe(workbook);
    expect(result.current.canUndo).toBe(false);
  });
  it('rejects a direct edit of a calculated cell without persistence or history', async () => {
    const apiClient = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: boundWorkbook() }));

    act(() => expect(result.current.commands.updateCellContent('sheet', 'B1', '9')).toEqual({ ok: false, reason: 'calculated-cell-write' }));

    expect(cellRawContent(result.current.workbook.documents.sheet!, 'B1')).toBe(cellRawContent(boundWorkbook().documents.sheet!, 'B1'));
    expect(result.current.canUndo).toBe(false);
    await waitFor(() => expect(apiClient.writeCells).not.toHaveBeenCalled());
  });

  it('rejects a clear of a calculated cell and leaves the manual cells of the batch intact', async () => {
    const apiClient = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: boundWorkbook() }));

    act(() => expect(result.current.commands.writeCells([
      { sheetId: 'sheet', rowId: 'sheet:row:1', columnId: 'sheet:column:3', raw: '' },
      { sheetId: 'sheet', rowId: 'sheet:row:1', columnId: 'sheet:column:2', raw: '' },
    ])).toEqual({ ok: false, reason: 'calculated-cell-write' }));

    expect(cellRawContent(result.current.workbook.documents.sheet!, 'C1')).toBe('text');
    expect(cellRawContent(result.current.workbook.documents.sheet!, 'B1')).toBe(cellRawContent(boundWorkbook().documents.sheet!, 'B1'));
    await waitFor(() => expect(apiClient.writeCells).not.toHaveBeenCalled());
  });

  it('rejects a paste into a calculated destination and keeps a copy from a calculated source', async () => {
    const workbook = boundWorkbook();
    const apiClient = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbook }));
    const calculatedSource = clipboardFor(workbook, 'sheet', 'B1', 'copy');
    const manualSource = clipboardFor(workbook, 'sheet', 'A1', 'copy');

    act(() => expect(result.current.commands.pasteCells('sheet', 'B2', manualSource)).toEqual({ ok: false, reason: 'calculated-cell-write' }));
    expect(cellRawContent(result.current.workbook.documents.sheet!, 'B2')).toBe(cellRawContent(boundWorkbook().documents.sheet!, 'B2'));

    act(() => expect(result.current.commands.pasteCells('sheet', 'C2', calculatedSource)).toEqual({ ok: true, changed: true }));
    expect(projectStoredFormula(cellRawContent(result.current.workbook.documents.sheet!, 'C2')!, result.current.workbook, 'sheet').text).toBe('=SUM(@B[2])');
  });

  it('rejects an external paste into a calculated destination and keeps a manual destination', async () => {
    const apiClient = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: boundWorkbook() }));
    const external = { ok: true as const, value: { kind: 'external' as const, grid: { rows: [['pasted']], rowCount: 1, columnCount: 1 } } };

    act(() => expect(result.current.commands.pasteCells('sheet', 'B2', external)).toEqual({ ok: false, reason: 'calculated-cell-write' }));
    expect(cellRawContent(result.current.workbook.documents.sheet!, 'B2')).toBe(cellRawContent(boundWorkbook().documents.sheet!, 'B2'));

    act(() => expect(result.current.commands.pasteCells('sheet', 'C2', external)).toEqual({ ok: true, changed: true }));
    expect(cellRawContent(result.current.workbook.documents.sheet!, 'C2')).toBe('"pasted"');
    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(1));
  });

  it('rejects a move that would clear a protected source or write into a protected destination', async () => {
    const workbook = boundWorkbook();
    const apiClient = autosaveClient();
    const { result } = renderHook(() => useWorkbookController({ apiClient, initialWorkbook: workbook }));
    const calculatedCut = clipboardFor(workbook, 'sheet', 'B1', 'cut');
    const manualCut = clipboardFor(workbook, 'sheet', 'A1', 'cut');

    act(() => expect(result.current.commands.moveCells('sheet', 'A2', calculatedCut.value.kind === 'cut' ? calculatedCut.value.source : neverCut()))
      .toEqual({ ok: false, reason: 'calculated-cell-write' }));
    act(() => expect(result.current.commands.moveCells('sheet', 'B2', manualCut.value.kind === 'cut' ? manualCut.value.source : neverCut()))
      .toEqual({ ok: false, reason: 'calculated-cell-write' }));

    expect(cellRawContent(result.current.workbook.documents.sheet!, 'B1')).toBe(cellRawContent(boundWorkbook().documents.sheet!, 'B1'));
    expect(cellRawContent(result.current.workbook.documents.sheet!, 'A1')).toBe('3');
    await waitFor(() => expect(apiClient.writeCells).not.toHaveBeenCalled());
  });

  it('invalidates the editing history when a model transition claims the edited column', async () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 3, cells: { A1: '3' } });
    const workbook: Workbook = { ...workbookWithSheets([sheet]), dataModels: { model } };
    const apiClient = persistedWorkbookClient(workbook);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient }));

    act(() => { result.current.commands.updateCellContent('sheet', 'A1', '5'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(result.current.canUndo).toBe(true);

    act(() => { result.current.commands.bindSheetToModel('sheet', 'model'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    expect(result.current.canUndo).toBe(false);
    act(() => { result.current.commands.undo(); });
    expect(cellRawContent(result.current.workbook.documents.sheet!, 'A1')).toBe('5');
  });
});

function neverCut(): never {
  throw new Error('expected a cut payload');
}
