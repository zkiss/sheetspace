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
    loadSheet: vi.fn(),
    createSheet: vi.fn(),
    deleteSheet: vi.fn().mockResolvedValue(undefined),
    renameSheet: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0 })),
    updateSheetPosition: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0 })),
    updateSheetFrameSize: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0 })),
    updateSheetZIndex: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0 })),
    updateCellContent: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0 })),
    appendRow: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0, rowCount: 0 })),
    appendColumn: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0, columnCount: 0 })),
    ...overrides,
  } satisfies Partial<WorkbookApi>;
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
    loadSheet: vi.fn().mockImplementation(async (sheetId: string) => {
      const sheet = persistedWorkbook.sheets.find((candidate) => candidate.id === sheetId);
      if (!sheet) {
        throw new Error('sheet-not-found');
      }
      return sheet;
    }),
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
        return result.value;
      }

      throw new Error('invalid-sheet');
    }),
    deleteSheet: vi.fn().mockImplementation(async (sheetId: string) => {
      const existingSheet = persistedWorkbook.sheets.find((sheet) => sheet.id === sheetId);
      if (!existingSheet) {
        throw new Error('sheet-not-found');
      }

      persistedWorkbook = workbookWithSheets(persistedWorkbook.sheets.filter((sheet) => sheet.id !== sheetId));
    }),
    renameSheet: vi.fn().mockImplementation(async (sheetId: string, name: string) => {
      const result = renameSheet(persistedWorkbook, sheetId, name);
      if (result.ok) {
        persistedWorkbook = result.value;
      }

      const sheet = persistedWorkbook.sheets.find((candidate) => candidate.id === sheetId);
      return { sheetId, revision: sheet?.revision ?? 0 };
    }),
    updateSheetPosition: vi.fn().mockImplementation(async (sheetId: string, position: WorkspacePosition) =>
      revisionResponse(updateSheet(sheetId, (sheet) => ({
        ...sheet,
        position,
      })), sheetId),
    ),
    updateSheetFrameSize: vi.fn().mockImplementation(async (sheetId: string, frameSize: Sheet['frameSize']) =>
      revisionResponse(updateSheet(sheetId, (sheet) => ({
        ...sheet,
        frameSize,
      })), sheetId),
    ),
    updateSheetZIndex: vi.fn().mockImplementation(async (sheetId: string, zIndex: number) =>
      revisionResponse(updateSheet(sheetId, (sheet) => ({
        ...sheet,
        zIndex,
      })), sheetId),
    ),
    updateCellContent: vi.fn().mockImplementation(async (sheetId: string, cellKey: string, raw: string) => {
      persistedWorkbook = commitCellRawContent(persistedWorkbook, sheetId, cellKey, raw);
      return revisionResponse(persistedWorkbook, sheetId);
    }),
    appendRow: vi.fn().mockImplementation(async (sheetId: string) => {
      updateSheet(sheetId, appendRow);
      const sheet = persistedWorkbook.sheets.find((candidate) => candidate.id === sheetId);
      return { sheetId, revision: sheet?.revision ?? 0, rowCount: sheet?.rowCount ?? 0 };
    }),
    appendColumn: vi.fn().mockImplementation(async (sheetId: string) => {
      updateSheet(sheetId, appendColumn);
      const sheet = persistedWorkbook.sheets.find((candidate) => candidate.id === sheetId);
      return { sheetId, revision: sheet?.revision ?? 0, columnCount: sheet?.columnCount ?? 0 };
    }),
  } satisfies WorkbookApi;
}

function revisionResponse(workbook: Workbook, sheetId: string) {
  const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
  return { sheetId, revision: sheet?.revision ?? 0 };
}

export function deterministicSheetId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}
