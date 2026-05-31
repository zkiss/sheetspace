import { vi } from 'vitest';
import {
  appendColumn,
  appendRow,
  commitCellRawContent,
  createSheet,
  renameSheet,
  type Sheet,
  type Workbook,
  type WorkspacePosition,
} from '../workbook';
import type { WorkbookApi } from '../workbookApi';
import { workbookWithSheets } from './workbookFactories';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

export function autosaveClient(overrides: Partial<WorkbookApi> = {}) {
  return {
    loadWorkbook: vi.fn().mockResolvedValue(workbookWithSheets([])),
    createSheet: vi.fn().mockResolvedValue(workbookWithSheets([])),
    deleteSheet: vi.fn().mockResolvedValue(workbookWithSheets([])),
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

export function persistedWorkbookClient(initialWorkbook: Workbook = workbookWithSheets([])) {
  let persistedWorkbook = initialWorkbook;
  let nextSheetId = initialWorkbook.sheets.length + 1;

  const updateSheet = (sheetId: string, update: (sheet: Sheet) => Sheet) => {
    persistedWorkbook = {
      ...persistedWorkbook,
      sheets: persistedWorkbook.sheets.map((sheet) => (sheet.id === sheetId ? update(sheet) : sheet)),
    };

    return persistedWorkbook;
  };

  return {
    loadWorkbook: vi.fn().mockImplementation(async () => persistedWorkbook),
    createSheet: vi.fn().mockImplementation(async (sheet: Parameters<WorkbookApi['createSheet']>[0]) => {
      const result = createSheet({
        id: deterministicSheetId(nextSheetId++),
        name: sheet.name,
        existingSheets: persistedWorkbook.sheets,
        position: sheet.position,
        zIndex: sheet.zIndex,
      });
      if (result.ok) {
        persistedWorkbook = workbookWithSheets([...persistedWorkbook.sheets, result.value]);
      }

      return persistedWorkbook;
    }),
    deleteSheet: vi.fn().mockImplementation(async (sheetId: string) => {
      persistedWorkbook = workbookWithSheets(persistedWorkbook.sheets.filter((sheet) => sheet.id !== sheetId));
      return persistedWorkbook;
    }),
    renameSheet: vi.fn().mockImplementation(async (sheetId: string, name: string) => {
      const result = renameSheet(persistedWorkbook, sheetId, name);
      if (result.ok) {
        persistedWorkbook = result.value;
      }

      return persistedWorkbook;
    }),
    updateSheetPosition: vi.fn().mockImplementation(async (sheetId: string, position: WorkspacePosition) =>
      updateSheet(sheetId, (sheet) => ({
        ...sheet,
        position,
      })),
    ),
    updateSheetFrameSize: vi.fn().mockImplementation(async (sheetId: string, frameSize: Sheet['frameSize']) =>
      updateSheet(sheetId, (sheet) => ({
        ...sheet,
        frameSize,
      })),
    ),
    updateSheetZIndex: vi.fn().mockImplementation(async (sheetId: string, zIndex: number) =>
      updateSheet(sheetId, (sheet) => ({
        ...sheet,
        zIndex,
      })),
    ),
    updateCellContent: vi.fn().mockImplementation(async (sheetId: string, cellKey: string, raw: string) => {
      persistedWorkbook = commitCellRawContent(persistedWorkbook, sheetId, cellKey, raw);
      return persistedWorkbook;
    }),
    appendRow: vi.fn().mockImplementation(async (sheetId: string) => updateSheet(sheetId, appendRow)),
    appendColumn: vi.fn().mockImplementation(async (sheetId: string) => updateSheet(sheetId, appendColumn)),
  } satisfies WorkbookApi;
}

export function deterministicSheetId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}
