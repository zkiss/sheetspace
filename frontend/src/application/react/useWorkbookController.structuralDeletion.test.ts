import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

describe('structural deletion controller', () => {
  it.each(['row', 'column'] as const)('applies %s deletion and clears cell history', async (axis) => {
    const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 2, columnCount: 2 });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]) }));
    act(() => { result.current.commands.updateCellContent('s', 'A1', '42'); });
    expect(result.current.canUndo).toBe(true);
    let submission!: { completion: Promise<{ ok: boolean }> };
    act(() => {
      submission = axis === 'row'
        ? result.current.commands.deleteRow('s', sheet.content.rows[0]!)
        : result.current.commands.deleteColumn('s', sheet.content.columns[0]!);
    });
    expect((await submission.completion).ok).toBe(true);
    expect(result.current.workbook.documents.s.content[axis === 'row' ? 'rows' : 'columns']).toHaveLength(1);
    expect(result.current.canUndo).toBe(false);
  });
  it.each(['row', 'column'] as const)('rolls back a failed persisted %s deletion', async (axis) => {
    const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 2, columnCount: 2 });
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: autosaveClient({ saveModelLifecycle: save }) }));
    let completion!: Promise<{ ok: boolean; reason?: string }>;
    await act(async () => {
      const submission = axis === 'row'
        ? result.current.commands.deleteRow('s', sheet.content.rows[0]!)
        : result.current.commands.deleteColumn('s', sheet.content.columns[0]!);
      completion = submission.completion;
      expect(submission.result.ok).toBe(true);
      expect(await completion).toEqual({ ok: false, reason: 'persistence-failed' });
    });
    expect(save).toHaveBeenCalledOnce();
    expect(result.current.workbook.documents.s.content).toEqual(sheet.content);
  });
});
