import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findSheetById } from './workbook';
import { useWorkbookController } from './useWorkbookController';
import { autosaveClient, deferred } from './test/apiClients';
import { positionedSheet, sheetDocument, workbookWithSheets } from './test/workbookFactories';

describe('useWorkbookController frame layout and z-order', () => {
  it('persists committed frame size and anchored position together', () => {
    const apiClient = autosaveClient();
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 6 };
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.resizeSheetFrame('sheet-inputs', { x: 180, y: 80 }, { width: 180, height: 160 });
    });

    expect(findSheetById(result.current.workbook, 'sheet-inputs')).toMatchObject({
      frame: {
        size: { width: 180, height: 160 },
        position: { x: 180, y: 80 },
      },
    });
    expect(apiClient.updateSheetFrameLayout).toHaveBeenCalledWith(
      'sheet-inputs',
      { x: 180, y: 80 },
      { width: 180, height: 160 },
      { revision: 6 },
    );
  });

  it.each(['move-then-resize', 'resize-then-move'] as const)(
    'orders overlapping frame writes for %s',
    async (commandOrder) => {
      const firstSave = deferred<{ sheetId: string; revision: number }>();
      const secondSave = deferred<{ sheetId: string; revision: number }>();
      const updateSheetPosition = vi.fn().mockReturnValue(
        commandOrder === 'move-then-resize' ? firstSave.promise : secondSave.promise,
      );
      const updateSheetFrameLayout = vi.fn().mockReturnValue(
        commandOrder === 'resize-then-move' ? firstSave.promise : secondSave.promise,
      );
      const apiClient = autosaveClient({
        updateSheetPosition,
        updateSheetFrameLayout,
      });
      const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 6 };
      const { result } = renderHook(() =>
        useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([sheet]) }),
      );

      act(() => {
        if (commandOrder === 'move-then-resize') {
          result.current.commands.moveSheetFrame(sheet.id, { x: 140, y: 90 });
          result.current.commands.resizeSheetFrame(sheet.id, { x: 180, y: 80 }, { width: 180, height: 160 });
        } else {
          result.current.commands.resizeSheetFrame(sheet.id, { x: 180, y: 80 }, { width: 180, height: 160 });
          result.current.commands.moveSheetFrame(sheet.id, { x: 140, y: 90 });
        }
      });

      expect(apiClient.updateSheetPosition).toHaveBeenCalledTimes(commandOrder === 'move-then-resize' ? 1 : 0);
      expect(apiClient.updateSheetFrameLayout).toHaveBeenCalledTimes(commandOrder === 'resize-then-move' ? 1 : 0);

      await act(async () => {
        firstSave.resolve({ sheetId: sheet.id, revision: 7 });
        await firstSave.promise;
      });

      if (commandOrder === 'move-then-resize') {
        await waitFor(() => expect(apiClient.updateSheetFrameLayout).toHaveBeenCalledWith(
          sheet.id,
          { x: 180, y: 80 },
          { width: 180, height: 160 },
          { revision: 7 },
        ));
      } else {
        await waitFor(() => expect(apiClient.updateSheetPosition).toHaveBeenCalledWith(
          sheet.id,
          { x: 140, y: 90 },
          { revision: 7 },
        ));
      }

      await act(async () => {
        secondSave.resolve({ sheetId: sheet.id, revision: 8 });
        await secondSave.promise;
      });
      await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    },
  );

  it('preserves a queued resize between rapid moves', async () => {
    const firstMove = deferred<{ sheetId: string; revision: number }>();
    const resize = deferred<{ sheetId: string; revision: number }>();
    const finalMove = deferred<{ sheetId: string; revision: number }>();
    const updateSheetPosition = vi.fn()
      .mockReturnValueOnce(firstMove.promise)
      .mockReturnValueOnce(finalMove.promise);
    const updateSheetFrameLayout = vi.fn().mockReturnValue(resize.promise);
    const apiClient = autosaveClient({ updateSheetPosition, updateSheetFrameLayout });
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 6 };
    const { result } = renderHook(() =>
      useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([sheet]) }),
    );

    act(() => {
      result.current.commands.moveSheetFrame(sheet.id, { x: 140, y: 90 });
      result.current.commands.resizeSheetFrame(sheet.id, { x: 180, y: 80 }, { width: 180, height: 160 });
      result.current.commands.moveSheetFrame(sheet.id, { x: 200, y: 100 });
    });
    expect(updateSheetPosition).toHaveBeenCalledTimes(1);
    expect(updateSheetFrameLayout).not.toHaveBeenCalled();

    firstMove.resolve({ sheetId: sheet.id, revision: 7 });
    await waitFor(() => expect(updateSheetFrameLayout).toHaveBeenCalledWith(
      sheet.id,
      { x: 180, y: 80 },
      { width: 180, height: 160 },
      { revision: 7 },
    ));

    resize.resolve({ sheetId: sheet.id, revision: 8 });
    await waitFor(() => expect(updateSheetPosition).toHaveBeenNthCalledWith(
      2,
      sheet.id,
      { x: 200, y: 100 },
      { revision: 8 },
    ));

    finalMove.resolve({ sheetId: sheet.id, revision: 9 });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('retains the in-flight resize and persists only the latest queued resize', async () => {
    const firstResize = deferred<{ sheetId: string; revision: number }>();
    const finalResize = deferred<{ sheetId: string; revision: number }>();
    const updateSheetFrameLayout = vi.fn()
      .mockReturnValueOnce(firstResize.promise)
      .mockReturnValueOnce(finalResize.promise);
    const apiClient = autosaveClient({ updateSheetFrameLayout });
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }), revision: 6 };
    const { result } = renderHook(() =>
      useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets([sheet]) }),
    );

    act(() => {
      result.current.commands.resizeSheetFrame(sheet.id, { x: 130, y: 80 }, { width: 160, height: 150 });
      result.current.commands.resizeSheetFrame(sheet.id, { x: 140, y: 80 }, { width: 170, height: 155 });
      result.current.commands.resizeSheetFrame(sheet.id, { x: 150, y: 80 }, { width: 180, height: 160 });
    });

    expect(updateSheetFrameLayout).toHaveBeenCalledTimes(1);
    expect(updateSheetFrameLayout).toHaveBeenNthCalledWith(
      1,
      sheet.id,
      { x: 130, y: 80 },
      { width: 160, height: 150 },
      { revision: 6 },
    );

    firstResize.resolve({ sheetId: sheet.id, revision: 7 });
    await waitFor(() => expect(updateSheetFrameLayout).toHaveBeenNthCalledWith(
      2,
      sheet.id,
      { x: 150, y: 80 },
      { width: 180, height: 160 },
      { revision: 7 },
    ));
    expect(updateSheetFrameLayout).toHaveBeenCalledTimes(2);

    finalResize.resolve({ sheetId: sheet.id, revision: 8 });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('persists z-order changes for every sheet whose z-index changes', async () => {
    const apiClient = autosaveClient();
    const inputs = sheetDocument({
      id: 'sheet-inputs', name: 'Inputs', position: { x: 10, y: 20 }, revision: 7, zIndex: 1,
    });
    const outputs = sheetDocument({
      id: 'sheet-outputs', name: 'Outputs', position: { x: 300, y: 20 }, revision: 8, zIndex: 2,
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([inputs, outputs]),
      }),
    );

    act(() => {
      result.current.commands.changeSheetZOrder('sheet-inputs', 'up');
    });

    expect(findSheetById(result.current.workbook, 'sheet-inputs')?.frame.zIndex).toBe(2);
    expect(findSheetById(result.current.workbook, 'sheet-outputs')?.frame.zIndex).toBe(1);
    await waitFor(() => {
      expect(apiClient.updateSheetZOrder).toHaveBeenCalledWith([
        { sheetId: 'sheet-inputs', expectedRevision: 7, zIndex: 2 },
        { sheetId: 'sheet-outputs', expectedRevision: 8, zIndex: 1 },
      ]);
    });
  });

  it('orders overlapping compound z-order commands through one workbook queue', async () => {
    const firstSave = deferred<{ sheets: Array<{ sheetId: string; revision: number }> }>();
    const secondSave = deferred<{ sheets: Array<{ sheetId: string; revision: number }> }>();
    const apiClient = autosaveClient({
      updateSheetZOrder: vi.fn()
        .mockReturnValueOnce(firstSave.promise)
        .mockReturnValueOnce(secondSave.promise)
        .mockResolvedValueOnce({
          sheets: [
            { sheetId: 'sheet-b', revision: 3 },
            { sheetId: 'sheet-c', revision: 3 },
          ],
        }),
    });
    const sheets = [
      sheetDocument({ id: 'sheet-a', name: 'A', zIndex: 1 }),
      sheetDocument({ id: 'sheet-b', name: 'B', zIndex: 2 }),
      sheetDocument({ id: 'sheet-c', name: 'C', zIndex: 3 }),
    ];
    const { result } = renderHook(() =>
      useWorkbookController({ apiClient, initialWorkbook: workbookWithSheets(sheets) }),
    );

    act(() => {
      result.current.commands.changeSheetZOrder('sheet-b', 'top');
      result.current.commands.changeSheetZOrder('sheet-a', 'top');
      result.current.commands.changeSheetZOrder('sheet-c', 'up');
    });

    expect(apiClient.updateSheetZOrder).toHaveBeenCalledTimes(1);
    expect(apiClient.updateSheetZOrder).toHaveBeenNthCalledWith(1, [
      { sheetId: 'sheet-b', expectedRevision: 0, zIndex: 3 },
      { sheetId: 'sheet-c', expectedRevision: 0, zIndex: 2 },
    ]);

    await act(async () => {
      firstSave.resolve({
        sheets: [
          { sheetId: 'sheet-b', revision: 1 },
          { sheetId: 'sheet-c', revision: 1 },
        ],
      });
      await firstSave.promise;
    });

    await waitFor(() => expect(apiClient.updateSheetZOrder).toHaveBeenNthCalledWith(2, [
      { sheetId: 'sheet-a', expectedRevision: 0, zIndex: 3 },
      { sheetId: 'sheet-b', expectedRevision: 1, zIndex: 2 },
      { sheetId: 'sheet-c', expectedRevision: 1, zIndex: 1 },
    ]));

    secondSave.resolve({
      sheets: [
        { sheetId: 'sheet-a', revision: 1 },
        { sheetId: 'sheet-b', revision: 2 },
        { sheetId: 'sheet-c', revision: 2 },
      ],
    });
    await waitFor(() => expect(apiClient.updateSheetZOrder).toHaveBeenNthCalledWith(3, [
      { sheetId: 'sheet-b', expectedRevision: 2, zIndex: 1 },
      { sheetId: 'sheet-c', expectedRevision: 2, zIndex: 2 },
    ]));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });
});
