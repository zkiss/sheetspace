import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { cellRawContent } from '@workbook/read/queries';
import type { Workbook } from '@workbook/core/model';
import { useWorkbookController } from './useWorkbookController';

describe('persisted extraction chronology', () => {
  it('replays edits, a multi-row reorder and extraction in chronological order', async () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 4, columnCount: 1 });
    sheet.revision = 4;
    const [a, b, c, d] = sheet.content.rows;
    const originalRows = [a, b, c, d];
    const movedRows = [a, c, b, d];
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const target = '00000000-0000-0000-0000-000000000001';
    const request = {
      sourceSheetId: 's', selection: { kind: 'cells' as const, start: cell, end: cell },
      targetSheetId: target, targetName: 'Target', targetRows: ['00000000-0000-0000-0000-000000000002'],
      targetColumns: ['00000000-0000-0000-0000-000000000003'],
      frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 },
    };
    let lifecycleCount = 0;
    const persistedSheet = structuredClone(sheet);
    const api = autosaveClient({
      loadSheet: vi.fn().mockImplementation(async () => structuredClone(persistedSheet)),
      writeAxisOrder: vi.fn().mockImplementation(async (_id, _axis, order: string[]) => {
        persistedSheet.content.rows = [...order];
        return structuredClone(persistedSheet);
      }),
      writeCells: vi.fn().mockImplementation(async (revisions: { sheetId: string; revision: number }[]) => ({ sheets: revisions })),
      saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => {
        lifecycleCount += 1;
        const copy = structuredClone(after);
        if (copy.documents[target]) copy.documents[target]!.revision = lifecycleCount === 1 ? 9 : 1;
        return copy;
      }),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    const content = (id: string) => {
      const document = result.current.workbook.documents[id];
      return document && cellRawContent(document, 'A1');
    };
    const saved = async () => waitFor(() => expect(result.current.saveStatus).toBe('saved'));

    act(() => result.current.commands.updateCellContent('s', 'A1', '1'));
    await saved();
    act(() => expect(result.current.commands.gatherAxis('s', 'row', [b!, d!], 4).status).toBe('changed'));
    expect(result.current.workbook.documents.s!.content.rows).toEqual(movedRows);
    await saved();
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    await act(async () => { expect((await submission.completion).ok).toBe(true); });
    expect(content(target)).toBe('1');
    expect(result.current.workbook.documents.s!.content.rows).toEqual(movedRows);
    expect(result.current.workbook.documents[target]!.revision).toBe(9);
    act(() => result.current.commands.updateCellContent(target, 'A1', '2'));
    await saved();
    act(() => result.current.commands.undo());
    await saved();
    expect(content(target)).toBe('1');
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.workbook.documents[target]).toBeUndefined());
    expect(content(target)).toBeUndefined();
    expect(content('s')).toBe('1');
    expect(result.current.contentHistoryFeedback).toBeUndefined();
    act(() => result.current.commands.undo());
    await saved();
    expect(result.current.workbook.documents.s!.content.rows).toEqual(originalRows);
    expect(content('s')).toBe('1');
    expect(content(target)).toBeUndefined();
    act(() => result.current.commands.undo());
    await saved();
    expect(content('s')).toBeUndefined();
    act(() => result.current.commands.redo());
    await saved();
    expect(content('s')).toBe('1');
    act(() => result.current.commands.redo());
    await saved();
    expect(result.current.workbook.documents.s!.content.rows).toEqual(movedRows);
    expect(content('s')).toBe('1');
    expect(content(target)).toBeUndefined();
    act(() => result.current.commands.redo());
    await waitFor(() => expect(result.current.workbook.documents[target]?.revision).toBe(1));
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(content(target)).toBe('1');
    expect(result.current.workbook.documents.s!.content.rows).toEqual(movedRows);
    act(() => result.current.commands.redo());
    await saved();
    expect(content(target)).toBe('2');
    const writes = vi.mocked(api.writeCells).mock.calls;
    expect(writes[writes.length - 1]![0]).toEqual([{ sheetId: target, revision: 1 }]);
  });
});
