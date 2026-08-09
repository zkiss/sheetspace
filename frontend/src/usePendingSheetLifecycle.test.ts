import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from './test/apiClients';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';
import { applyUserAction, type UserAction } from './userActions';
import { sheetsInOrder, type Workbook } from './workbook';
import type { WorkbookApi } from './workbookApi';
import { usePendingSheetLifecycle } from './usePendingSheetLifecycle';

function renderLifecycle({
  apiClient = {},
  initialWorkbook = workbookWithSheets([]),
  persistDeletedSheet = vi.fn().mockResolvedValue(undefined),
}: {
  apiClient?: Partial<WorkbookApi>;
  initialWorkbook?: Workbook;
  persistDeletedSheet?: (sheetId: string, revision: number | undefined) => Promise<void>;
} = {}) {
  return renderHook(() => {
    const [workbook, setWorkbook] = useState(initialWorkbook);
    const workbookRef = useRef(workbook);
    workbookRef.current = workbook;
    const updateWorkbook = useCallback((update: Parameters<typeof setWorkbook>[0]) => {
      setWorkbook((current) => {
        const next = typeof update === 'function' ? update(current) : update;
        workbookRef.current = next;
        return next;
      });
    }, []);
    const applyAction = useCallback((action: UserAction) => {
      const result = applyUserAction(workbookRef.current, action);
      if (!result.ok) return undefined;
      workbookRef.current = result.value.nextWorkbook;
      setWorkbook(result.value.nextWorkbook);
      return result.value;
    }, []);
    return {
      ...usePendingSheetLifecycle({
        applyAction,
        autosaveEnabled: true,
        currentWorkbook: () => workbookRef.current,
        persistDeletedSheet,
        resolvedApiClient: apiClient,
        setWorkbook: updateWorkbook,
        workbook,
      }),
      applyAction,
      workbook,
    };
  });
}

describe('usePendingSheetLifecycle', () => {
  it('performs one typed pending-to-saved transition', async () => {
    const createSave = deferred<ReturnType<typeof positionedSheet>>();
    const savedSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 24, y: 48 });
    const createSheet = vi.fn().mockReturnValue(createSave.promise);
    const { result } = renderLifecycle({ apiClient: { createSheet } });

    act(() => {
      expect(result.current.createPendingSheet('Inputs', { x: 24, y: 48 })).toEqual({
        ok: true,
        name: 'Inputs',
      });
    });
    const pendingId = sheetsInOrder(result.current.workbook)[0].id;
    expect(pendingId).toMatch(/^pending:/);
    await waitFor(() => expect(createSheet).toHaveBeenCalledTimes(1));

    createSave.resolve(savedSheet);
    await waitFor(() => expect(sheetsInOrder(result.current.workbook)[0].id).toBe(savedSheet.id));
    expect(result.current.sheetIdRemaps).toEqual({ [pendingId]: savedSheet.id });
  });

  it('cancels creation before the request starts without persisting a pending id', async () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    const uuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    const createSheet = vi.fn();
    const { result } = renderLifecycle({ apiClient: { createSheet } });

    act(() => {
      result.current.createPendingSheet('Inputs', { x: 0, y: 0 });
      result.current.deletePendingSheet(`pending:${uuid}`);
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(createSheet).not.toHaveBeenCalled();
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(0);
    uuidSpy.mockRestore();
  });

  it('reserves the original create name until the request settles', async () => {
    const createSave = deferred<ReturnType<typeof positionedSheet>>();
    const savedSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const createSheet = vi.fn().mockReturnValue(createSave.promise);
    const { result } = renderLifecycle({ apiClient: { createSheet } });

    act(() => {
      result.current.createPendingSheet('Inputs', { x: 0, y: 0 });
    });
    const pendingId = sheetsInOrder(result.current.workbook)[0].id;
    act(() => {
      result.current.applyAction({ kind: 'rename-sheet', sheetId: pendingId, name: 'Data' });
    });
    act(() => {
      expect(result.current.createPendingSheet('Inputs', { x: 300, y: 0 })).toEqual({
        ok: false,
        reason: 'duplicate',
      });
    });
    await waitFor(() => expect(createSheet).toHaveBeenCalledTimes(1));

    createSave.resolve(savedSheet);
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('rewrites parser-derived pending qualifiers before a dependent save', async () => {
    const createSave = deferred<ReturnType<typeof positionedSheet>>();
    const savedSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const { result } = renderLifecycle({
      apiClient: { createSheet: vi.fn().mockReturnValue(createSave.promise) },
    });

    act(() => {
      result.current.createPendingSheet('Inputs', { x: 0, y: 0 });
    });
    const pendingId = sheetsInOrder(result.current.workbook)[0].id;
    const resolvedRaw = result.current.resolveFormulaRawForSave(`=SUM(A1,) + ${pendingId}!B2`);

    createSave.resolve(savedSheet);
    await expect(resolvedRaw).resolves.toBe(`=SUM(A1,) + ${savedSheet.id}!B2`);
  });

  it('compensates when a sheet is deleted while create is in flight', async () => {
    const createSave = deferred<ReturnType<typeof positionedSheet>>();
    const savedSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const persistDeletedSheet = vi.fn().mockResolvedValue(undefined);
    const { result } = renderLifecycle({
      apiClient: { createSheet: vi.fn().mockReturnValue(createSave.promise) },
      persistDeletedSheet,
    });

    act(() => {
      result.current.createPendingSheet('Inputs', { x: 0, y: 0 });
    });
    const pendingId = sheetsInOrder(result.current.workbook)[0].id;
    await waitFor(() => expect(result.current.saveStatus).toBe('saving'));
    act(() => {
      expect(result.current.deletePendingSheet(pendingId)).toBe(true);
    });
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(0);

    createSave.resolve(savedSheet);
    await waitFor(() => expect(persistDeletedSheet).toHaveBeenCalledWith(savedSheet.id, savedSheet.revision));
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(0);
  });

  it('orders deferred pending and saved z-order commands without sending pending ids', async () => {
    const createSave = deferred<ReturnType<typeof positionedSheet>>();
    const firstZOrderSave = deferred<{ sheets: Array<{ sheetId: string; revision: number }> }>();
    const pendingSaved = positionedSheet('sheet-pending', 'Pending', { x: 600, y: 0 });
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 300, y: 0 });
    const updateSheetZOrder = vi.fn()
      .mockReturnValueOnce(firstZOrderSave.promise)
      .mockResolvedValueOnce({
        sheets: [
          { sheetId: outputs.id, revision: 1 },
          { sheetId: inputs.id, revision: 2 },
        ],
      });
    const { result } = renderLifecycle({
      apiClient: {
        createSheet: vi.fn().mockReturnValue(createSave.promise),
        updateSheetZOrder,
      },
      initialWorkbook: workbookWithSheets([inputs, outputs]),
    });

    act(() => {
      result.current.createPendingSheet('Pending', { x: 600, y: 0 });
    });
    const pendingId = sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === 'Pending')!.id;
    act(() => {
      result.current.enqueueRevisionedZOrder([
        { sheetId: pendingId, zIndex: 2 },
        { sheetId: inputs.id, zIndex: 1 },
      ]);
      result.current.enqueueRevisionedZOrder([
        { sheetId: outputs.id, zIndex: 1 },
        { sheetId: inputs.id, zIndex: 2 },
      ]);
    });
    expect(updateSheetZOrder).not.toHaveBeenCalled();

    createSave.resolve(pendingSaved);
    await waitFor(() => expect(updateSheetZOrder).toHaveBeenNthCalledWith(1, [
      { sheetId: pendingSaved.id, expectedRevision: 0, zIndex: 2 },
      { sheetId: inputs.id, expectedRevision: 0, zIndex: 1 },
    ]));
    expect(JSON.stringify(updateSheetZOrder.mock.calls[0])).not.toContain('pending:');

    firstZOrderSave.resolve({
      sheets: [
        { sheetId: pendingSaved.id, revision: 1 },
        { sheetId: inputs.id, revision: 1 },
      ],
    });
    await waitFor(() => expect(updateSheetZOrder).toHaveBeenNthCalledWith(2, [
      { sheetId: outputs.id, expectedRevision: 0, zIndex: 1 },
      { sheetId: inputs.id, expectedRevision: 1, zIndex: 2 },
    ]));
  });
});
