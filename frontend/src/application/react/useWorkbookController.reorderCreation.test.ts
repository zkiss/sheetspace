import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

it('rejects reorder during same-sheet creation until the appended identity is reconciled', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
  const [first, second] = sheet.content.rows;
  const response = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
  const appendRow = vi.fn(() => response.promise);
  const writeAxisOrder = vi.fn().mockImplementation(async (_id, _axis, order, revision) => ({
    ...sheet, revision: revision + 1, content: { ...sheet.content, rows: order },
  }));
  const loadSheet = vi.fn().mockResolvedValue({ ...sheet, revision: 1, content: { ...sheet.content, rows: [first, second, 'appended'] } });
  const api = autosaveClient({ appendRow, writeAxisOrder, loadSheet });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));

  act(() => {
    result.current.commands.appendRow('s');
    expect(result.current.commands.shiftAxis('s', 'row', [first!], 1)).toMatchObject({ status: 'rejected', reason: 'pending-axis-creation' });
  });
  expect(result.current.workbook.documents.s!.content.rows).toEqual([first, second]);
  expect(result.current.canUndo).toBe(false);
  expect(writeAxisOrder).not.toHaveBeenCalled();
  await act(async () => { response.resolve({ sheetId: 's', revision: 1, rowCount: 3, rowId: 'appended' }); });
  await waitFor(() => expect(result.current.workbook.documents.s!.content.rows).toEqual([first, second, 'appended']));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  act(() => expect(result.current.commands.shiftAxis('s', 'row', [first!], 1).status).toBe('changed'));
  await waitFor(() => expect(writeAxisOrder).toHaveBeenCalledWith('s', 'row', [second, first, 'appended'], 1));
  expect(result.current.workbook.documents.s!.content.rows).toEqual([second, first, 'appended']);
});
