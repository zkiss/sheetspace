import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { useWorkbookController } from './useWorkbookController';

function fixture() {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1 });
  const cell = cellIdentityAt(sheet.content, 'A1')!;
  const request = {
    sourceSheetId: 's', selection: { kind: 'cells' as const, start: cell, end: cell },
    targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target',
    targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
    frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 },
  };
  return { sheet, request };
}

describe('extraction admission', () => {
  it('rejects pending axis and sheet creations without consuming history', async () => {
    const { sheet, request } = fixture();
    const axis = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
    const creation = deferred<ReturnType<typeof sheetDocument>>();
    const api = autosaveClient({ appendRow: () => axis.promise, createSheet: () => creation.promise });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    act(() => result.current.commands.updateCellContent('s', 'A1', '1'));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.appendRow('s'));
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    expect(submission.result).toEqual({ ok: false, reason: 'pending-axis-creation' });
    expect(await submission.completion).toEqual(submission.result);
    expect(result.current.canUndo).toBe(true);
    await act(async () => axis.resolve({ sheetId: 's', revision: 1, rowCount: 2, rowId: 'new-row' }));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => {
      result.current.commands.createSheet('New', { x: 0, y: 0 });
      submission = result.current.commands.extractSelection(request);
    });
    expect(submission.result).toEqual({ ok: false, reason: 'pending-sheet-creation' });
    expect(await submission.completion).toEqual(submission.result);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    await act(async () => creation.resolve(sheetDocument({ id: 'new', name: 'New' })));
  });

  it('rejects a second extraction while a lifecycle submission is pending', async () => {
    const { sheet, request } = fixture();
    const save = deferred<Workbook>();
    const api = autosaveClient({ saveModelLifecycle: vi.fn().mockReturnValue(save.promise) });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    let first!: ReturnType<typeof result.current.commands.extractSelection>;
    let second!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => {
      first = result.current.commands.extractSelection(request);
      second = result.current.commands.extractSelection({ ...request, targetSheetId: '00000000-0000-0000-0000-000000000004', targetName: 'Second', targetRows: ['00000000-0000-0000-0000-000000000005'], targetColumns: ['00000000-0000-0000-0000-000000000006'] });
    });
    expect(second.result).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(await second.completion).toEqual(second.result);
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000004']).toBeUndefined();
    await waitFor(() => expect(api.saveModelLifecycle).toHaveBeenCalledOnce());
    await act(async () => { save.resolve(result.current.workbook); await first.completion; });
    expect(result.current.canUndo).toBe(true);
  });
});
