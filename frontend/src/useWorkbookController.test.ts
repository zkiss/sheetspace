import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createSheet,
  type Sheet,
  type Workbook,
  type WorkspacePosition,
} from './workbook';
import type { WorkbookApi } from './workbookApi';
import { useWorkbookController } from './useWorkbookController';

function workbookWithSheets(sheets: Workbook['sheets']): Workbook {
  return {
    version: 1,
    sheets,
  };
}

function positionedSheet(id: string, name: string, position: WorkspacePosition) {
  const result = createSheet({ id, name, position });
  if (!result.ok) {
    throw new Error(`Failed to create test sheet ${name}`);
  }

  return result.value;
}

function autosaveClient(overrides: Partial<WorkbookApi> = {}) {
  return {
    loadWorkbook: vi.fn().mockResolvedValue(workbookWithSheets([])),
    createSheet: vi.fn().mockResolvedValue(workbookWithSheets([])),
    renameSheet: vi.fn().mockResolvedValue(workbookWithSheets([])),
    updateSheetPosition: vi.fn().mockResolvedValue(workbookWithSheets([])),
    updateSheetFrameSize: vi.fn().mockResolvedValue(workbookWithSheets([])),
    updateSheetZIndex: vi.fn().mockResolvedValue(workbookWithSheets([])),
    updateCellContent: vi.fn().mockResolvedValue(workbookWithSheets([])),
    appendRow: vi.fn().mockResolvedValue(workbookWithSheets([])),
    appendColumn: vi.fn().mockResolvedValue(workbookWithSheets([])),
    ...overrides,
  } satisfies WorkbookApi;
}

describe('useWorkbookController', () => {
  it('creates sheets through a command and hides persistence details behind autosave', async () => {
    const apiClient = autosaveClient();
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([]),
      }),
    );

    act(() => {
      const created = result.current.commands.createSheet('Inputs', { x: 24, y: 48 });
      expect(created.ok).toBe(true);
    });

    expect(result.current.workbook.sheets).toHaveLength(1);
    expect(result.current.workbook.sheets[0]).toMatchObject({
      id: 'sheet-1',
      name: 'Inputs',
      position: { x: 24, y: 48 },
    });
    expect(apiClient.createSheet).toHaveBeenCalledWith({
      id: 'sheet-1',
      name: 'Inputs',
      position: { x: 24, y: 48 },
      frameSize: { width: 240, height: 160 },
      zIndex: 1,
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('keeps frame previews local and persists only committed frame commands', () => {
    const apiClient = autosaveClient();
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 });
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.previewSheetFrameLayout('sheet-inputs', { x: 30, y: 40 });
    });

    expect(result.current.workbook.sheets[0].position).toEqual({ x: 30, y: 40 });
    expect(apiClient.updateSheetPosition).not.toHaveBeenCalled();

    act(() => {
      result.current.commands.moveSheetFrame('sheet-inputs', { x: 50, y: 60 });
    });

    expect(result.current.workbook.sheets[0].position).toEqual({ x: 50, y: 60 });
    expect(apiClient.updateSheetPosition).toHaveBeenCalledWith('sheet-inputs', { x: 50, y: 60 }, { revision: 0 });
  });

  it('updates cells through a command and derives formula display results from workbook state', () => {
    const apiClient = autosaveClient();
    const sheet: Sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 }),
      cells: {
        B1: { raw: '=SUM(A1)' },
      },
    };
    const { result } = renderHook(() =>
      useWorkbookController({
        apiClient,
        initialWorkbook: workbookWithSheets([sheet]),
      }),
    );

    act(() => {
      result.current.commands.updateCellContent('sheet-inputs', 'A1', '7');
    });

    expect(result.current.workbook.sheets[0].cells.A1).toEqual({ raw: '7' });
    expect(result.current.formulaResults['sheet-inputs'].B1.display).toBe('7');
    expect(apiClient.updateCellContent).toHaveBeenCalledWith('sheet-inputs', 'A1', '7', { revision: 0 });
  });
});
