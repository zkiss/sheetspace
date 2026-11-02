import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { extractSelection } from '@application/core/extractSelection';
import { useWorkbookController } from './useWorkbookController';

function fixture(size: number) {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 2, cells: { A1: 'x'.repeat(size) } });
  const cell = cellIdentityAt(sheet.content, 'A1')!;
  const workbook = workbookWithSheets([sheet]);
  const request = {
    sourceSheetId: 's', selection: { kind: 'cells' as const, start: cell, end: cell },
    targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target',
    targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
    frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 },
  };
  const extracted = extractSelection(workbook, request);
  if (!extracted.ok) throw new Error(extracted.reason);
  const bytes = new TextEncoder().encode(JSON.stringify({ before: workbook, after: extracted.workbook })).length;
  return { workbook, request, bytes };
}

describe('extraction history capacity', () => {
  it('records and replays snapshots larger than the cell history limit', () => {
    const { workbook, request, bytes } = fixture(70000);
    expect(bytes).toBeGreaterThan(64 * 1024);
    expect(bytes).toBeLessThan(16 * 1024 * 1024);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => { expect(result.current.commands.extractSelection(request).result.ok).toBe(true); });
    act(() => result.current.commands.undo());
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    act(() => result.current.commands.redo());
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
  });

  it('rejects oversized snapshots before persistence without consuming redo', async () => {
    const { workbook, request, bytes } = fixture(9 * 1024 * 1024);
    expect(bytes).toBeGreaterThan(16 * 1024 * 1024);
    const save = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: autosaveClient({ saveModelLifecycle: save }) }));
    act(() => result.current.commands.updateCellContent('s', 'B1', 'small'));
    await act(async () => {});
    act(() => result.current.commands.undo());
    await act(async () => {});
    expect(result.current.canRedo).toBe(true);
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    expect(submission.result).toEqual({ ok: false, reason: 'extraction-history-too-large' });
    expect(await submission.completion).toEqual(submission.result);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(result.current.canRedo).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
