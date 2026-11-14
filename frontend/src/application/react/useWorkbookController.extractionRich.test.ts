import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import type { Workbook } from '@workbook/core/model';
import { useWorkbookController } from './useWorkbookController';

const receipt = (operationId: string, workbook: Workbook) => ({ operationId, transitionId: 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4', alreadyCommitted: false, workbook });

describe('rich persisted extraction', () => {
  it('round-trips names, formatting and canonical inbound references in lifecycle snapshots', async () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 1 });
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
    source.frame.zIndex = 1; other.frame.zIndex = 2;
    const workbook = workbookWithSheets([source, other]);
    const cell = cellIdentityAt(source.content, 'A1')!;
    source.content.cells[cellIdentityKey(cell)] = '42';
    source.columnNames = { [cell.columnId]: 'Named' };
    source.presentation.formatOverrides = { rows: {}, columns: {}, cells: { [cellIdentityKey(cell)]: { textColor: '#123456' } } };
    other.content.cells[cellIdentityKey(cellIdentityAt(other.content, 'A1')!)] = prepareUserFormula('=@Source!A[1]', workbook, other.id);
    const target = '00000000-0000-0000-0000-000000000001';
    const targetRow = '00000000-0000-0000-0000-000000000002';
    const targetColumn = '00000000-0000-0000-0000-000000000003';
    const request = {
      sourceSheetId: source.id, selection: { kind: 'rows' as const, start: cell.rowId, end: cell.rowId },
      targetSheetId: target, targetName: 'Target', targetRows: [targetRow], targetColumns: [targetColumn],
      frame: { position: { x: 3, y: 4 }, size: { width: 100, height: 100 }, zIndex: 2 },
    };
    const snapshots: Workbook[] = [];
    let before = workbook;
    let after = workbook;
    const api = autosaveClient({
      admitModelLifecycle: vi.fn().mockImplementation(async (operationId: string, source: Workbook, target: Workbook) => {
        before = structuredClone(source);
        after = structuredClone(target);
        snapshots.push(after);
        return receipt(operationId, after);
      }),
      replayModelLifecycle: vi.fn().mockImplementation(async (operationId: string, _transitionId: string, direction: 'undo' | 'redo') => {
        const current = structuredClone(direction === 'undo' ? before : after);
        snapshots.push(current);
        return receipt(operationId, current);
      }),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
    const assertExtracted = (current: Workbook) => {
      const document = current.documents[target]!;
      expect(document.frame).toMatchObject({ ...request.frame, zIndex: 1 });
      expect(current.documents.other!.frame.zIndex).toBe(2);
      expect(document.columnNames).toEqual({ [targetColumn]: 'Named' });
      expect(document.content.cells[cellIdentityKey({ rowId: targetRow, columnId: targetColumn })]).toBe('42');
      expect(document.presentation.formatOverrides!.cells[cellIdentityKey({ rowId: targetRow, columnId: targetColumn })]).toEqual({ textColor: '#123456' });
      const inbound = Object.values(current.documents.other!.content.cells)[0]!;
      expect(projectStoredFormula(inbound, current, other.id).text).toBe('=@Target!A[1]');
    };
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    await act(async () => { expect((await submission.completion).ok).toBe(true); });
    assertExtracted(snapshots[0]!);
    assertExtracted(result.current.workbook);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(snapshots[1]!.documents[target]).toBeUndefined();
    expect(snapshots[1]!.documents.other!.frame.zIndex).toBe(2);
    expect(snapshots[1]!.documents.source!.columnNames).toEqual(source.columnNames);
    expect(snapshots[1]!.documents.source!.presentation.formatOverrides).toEqual(source.presentation.formatOverrides);
    const restored = Object.values(snapshots[1]!.documents.other!.content.cells)[0]!;
    expect(projectStoredFormula(restored, snapshots[1]!, other.id).text).toBe('=@Source!A[1]');
    act(() => result.current.commands.redo());
    await waitFor(() => expect(snapshots).toHaveLength(3));
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    assertExtracted(snapshots[2]!);
    assertExtracted(result.current.workbook);
  });
});
