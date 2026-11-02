import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient } from '@test-support/apiClients';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';
import type { ExtractionRequest } from '@application/core/extractionPreparation';

const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`);

describe('extraction controller history', () => {
  it.each(['cells', 'rows', 'columns'] as const)('extracts and replays %s offline', async (kind) => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 2 });
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const selection: ExtractionRequest['selection'] = kind === 'cells' ? { kind, start: cell, end: cell } : kind === 'rows' ? { kind, start: cell.rowId, end: cell.rowId } : { kind, start: cell.columnId, end: cell.columnId };
    const request: ExtractionRequest = { sourceSheetId: 's', selection, targetSheetId: ids[0]!, targetName: 'Target', targetRows: kind === 'columns' ? [ids[1]!, ids[2]!] : [ids[1]!], targetColumns: kind === 'rows' ? [ids[3]!, ids[4]!] : [ids[3]!], frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 } };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]) }));
    act(() => { result.current.commands.updateCellContent('s', 'A1', '42'); });
    await act(async () => { expect((await result.current.commands.extractSelection(request).completion).ok).toBe(true); });
    expect(result.current.workbook.documents[ids[0]!]).toBeDefined();
    act(() => result.current.commands.undo());
    expect(result.current.workbook.documents[ids[0]!]).toBeUndefined();
    act(() => result.current.commands.redo());
    expect(result.current.workbook.documents[ids[0]!]).toBeDefined();
    act(() => result.current.commands.undo());
    act(() => result.current.commands.undo());
    expect(result.current.canRedo).toBe(true);
  });
  it('rolls back a failed persisted extraction without consuming earlier history', async () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1 });
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const request: ExtractionRequest = { sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell }, targetSheetId: ids[0]!, targetName: 'Target', targetRows: [ids[1]!], targetColumns: [ids[2]!], frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 } };
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: autosaveClient({ saveModelLifecycle: save }) }));
    act(() => { result.current.commands.updateCellContent('s', 'A1', '42'); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    await act(async () => {
      const submission = result.current.commands.extractSelection(request);
      expect(submission.result.ok).toBe(true);
      expect(await submission.completion).toEqual({ ok: false, reason: 'persistence-failed' });
    });
    expect(result.current.workbook.documents[ids[0]!]).toBeUndefined();
    expect(result.current.canUndo).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

});
