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
});
