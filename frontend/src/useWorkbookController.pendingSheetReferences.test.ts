import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellRawContent, sheetsInOrder, type SheetDocument } from './workbook';
import { useWorkbookController } from './useWorkbookController';
import { autosaveClient } from './test/apiClients';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

describe('useWorkbookController pending sheet references', () => {
  it('defers malformed formula saves with a later pending-sheet reference until the target has a backend id', async () => {
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 0, y: 0 });
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', '📈 Plan', { x: 24, y: 48 });
    let resolveCreate!: (sheet: SheetDocument) => void;
    const createSheetSave = new Promise<SheetDocument>((resolve) => {
      resolveCreate = resolve;
    });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSheetSave),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([outputs]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('📈 Plan', { x: 24, y: 48 });
    });
    const pendingInputsId = sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === '📈 Plan')!.id;
    act(() => {
      result.current.commands.updateCellContent('sheet-outputs', 'A1', "=SUM(A1,) + '📈 Plan'!A1");
    });

    expect(cellRawContent(sheetsInOrder(result.current.workbook)[0], 'A1')).toBe(`=SUM(A1,) + ${pendingInputsId}!A1`);
    expect(apiClient.updateCellContent).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate(savedInputs);
      await createSheetSave;
    });

    await waitFor(() =>
      expect(apiClient.updateCellContent).toHaveBeenCalledWith(
        'sheet-outputs',
        'A1',
        `=SUM(A1,) + ${savedInputs.id}!A1`,
        { revision: 0 },
      ),
    );
  });

  it('saves formulas that reference a deleted pending sheet as broken references', async () => {
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 0, y: 0 });
    const savedInputs = positionedSheet('00000000-0000-4000-8000-000000000001', 'Inputs', { x: 24, y: 48 });
    let resolveCreate!: (sheet: SheetDocument) => void;
    const createSheetSave = new Promise<SheetDocument>((resolve) => {
      resolveCreate = resolve;
    });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSheetSave),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([outputs]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));
    const pendingInputsId = sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === 'Inputs')!.id;
    act(() => {
      result.current.commands.updateCellContent('sheet-outputs', 'A1', '=SUM(Inputs!A1)');
      result.current.commands.deletePendingSheet(pendingInputsId);
    });

    await waitFor(() =>
      expect(apiClient.updateCellContent).toHaveBeenCalledWith('sheet-outputs', 'A1', '=SUM(#REF!A1)', {
        revision: 0,
      }),
    );
    expect(result.current.formulaResults['sheet-outputs'].A1).toMatchObject({ kind: 'error', error: '#REF!' });

    await act(async () => {
      resolveCreate(savedInputs);
      await createSheetSave;
    });
    await waitFor(() => expect(apiClient.deleteSheet).toHaveBeenCalledWith(savedInputs.id, { revision: 0 }));
  });

  it('saves formulas that reference a failed pending sheet as broken references', async () => {
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 0, y: 0 });
    let rejectCreate!: (cause: unknown) => void;
    const createSheetSave = new Promise<SheetDocument>((_, reject) => {
      rejectCreate = reject;
    });
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSheetSave),
    });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([outputs]),
      }),
    );

    act(() => {
      result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
    });
    await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));
    const pendingInputsId = sheetsInOrder(result.current.workbook).find((sheet) => sheet.name === 'Inputs')!.id;
    act(() => {
      result.current.commands.updateCellContent('sheet-outputs', 'A1', '=SUM(Inputs!A1)');
    });

    expect(cellRawContent(sheetsInOrder(result.current.workbook)[0], 'A1')).toBe(`=SUM(${pendingInputsId}!A1)`);
    expect(apiClient.updateCellContent).not.toHaveBeenCalled();

    await act(async () => {
      rejectCreate(new Error('backend unavailable'));
      await createSheetSave.catch(() => undefined);
    });

    await waitFor(() =>
      expect(apiClient.updateCellContent).toHaveBeenCalledWith('sheet-outputs', 'A1', '=SUM(#REF!A1)', {
        revision: 0,
      }),
    );
    expect(sheetsInOrder(result.current.workbook)).toHaveLength(1);
    expect(cellRawContent(sheetsInOrder(result.current.workbook)[0], 'A1')).toBe('=SUM(#REF!A1)');
    expect(result.current.formulaResults['sheet-outputs'].A1).toMatchObject({ kind: 'error', error: '#REF!' });
  });

});
