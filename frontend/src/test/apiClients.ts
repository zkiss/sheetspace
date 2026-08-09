import { vi } from 'vitest';
import {
  appendColumn,
  appendRow,
  commitCellRawContent,
  createSheet,
  findSheetById,
  renameSheet,
  sheetsInOrder,
  type SheetDocument,
  type SheetFrameSize,
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
  let nextSheetId = sheetsInOrder(initialWorkbook).length + 1;

  const updateSheet = (sheetId: string, update: (sheet: SheetDocument) => SheetDocument) => {
    const sheet = findSheetById(persistedWorkbook, sheetId);
    if (!sheet) throw new Error('sheet-not-found');
    persistedWorkbook = {
      ...persistedWorkbook,
      documents: { ...persistedWorkbook.documents, [sheetId]: update(sheet) },
    };
    return persistedWorkbook;
  };

  return {
    loadWorkbook: vi.fn().mockImplementation(async () => persistedWorkbook),
    loadSheet: vi.fn().mockImplementation(async (sheetId: string) => {
      const sheet = findSheetById(persistedWorkbook, sheetId);
      if (!sheet) throw new Error('sheet-not-found');
      return sheet;
    }),
    createSheet: vi.fn().mockImplementation(async (sheet: Parameters<WorkbookApi['createSheet']>[0]) => {
      const result = createSheet({
        id: deterministicSheetId(nextSheetId++),
        name: sheet.name,
        existingSheets: sheetsInOrder(persistedWorkbook),
        position: sheet.position,
        frameSize: sheet.frameSize,
        zIndex: sheet.zIndex,
      });
      if (!result.ok) throw new Error('invalid-sheet');
      persistedWorkbook = workbookWithSheets([...sheetsInOrder(persistedWorkbook), result.value]);
      return result.value;
    }),
    deleteSheet: vi.fn().mockImplementation(async (sheetId: string) => {
      if (!findSheetById(persistedWorkbook, sheetId)) throw new Error('sheet-not-found');
      const { [sheetId]: _deleted, ...documents } = persistedWorkbook.documents;
      persistedWorkbook = {
        manifest: {
          ...persistedWorkbook.manifest,
          sheetIds: persistedWorkbook.manifest.sheetIds.filter((id) => id !== sheetId),
        },
        documents,
      };
    }),
    renameSheet: vi.fn().mockImplementation(async (sheetId: string, name: string) => {
      const result = renameSheet(persistedWorkbook, sheetId, name);
      if (result.ok) persistedWorkbook = result.value;
      return revisionResponse(persistedWorkbook, sheetId);
    }),
    updateSheetPosition: vi.fn().mockImplementation(async (sheetId: string, position: WorkspacePosition) =>
      revisionResponse(updateSheet(sheetId, (sheet) => ({
        ...sheet,
        frame: { ...sheet.frame, position },
      })), sheetId)),
    updateSheetFrameSize: vi.fn().mockImplementation(async (sheetId: string, frameSize: SheetFrameSize) =>
      revisionResponse(updateSheet(sheetId, (sheet) => ({
        ...sheet,
        frame: { ...sheet.frame, size: frameSize },
      })), sheetId)),
    updateSheetZIndex: vi.fn().mockImplementation(async (sheetId: string, zIndex: number) =>
      revisionResponse(updateSheet(sheetId, (sheet) => ({
        ...sheet,
        frame: { ...sheet.frame, zIndex },
      })), sheetId)),
    updateCellContent: vi.fn().mockImplementation(async (sheetId: string, cellKey: string, raw: string) => {
      persistedWorkbook = commitCellRawContent(persistedWorkbook, sheetId, cellKey, raw);
      return revisionResponse(persistedWorkbook, sheetId);
    }),
    appendRow: vi.fn().mockImplementation(async (sheetId: string) => {
      const sheet = findSheetById(updateSheet(sheetId, appendRow), sheetId);
      return { ...revisionResponse(persistedWorkbook, sheetId), rowCount: sheet?.content.rows.length ?? 0 };
    }),
    appendColumn: vi.fn().mockImplementation(async (sheetId: string) => {
      const sheet = findSheetById(updateSheet(sheetId, appendColumn), sheetId);
      return { ...revisionResponse(persistedWorkbook, sheetId), columnCount: sheet?.content.columns.length ?? 0 };
    }),
  } satisfies WorkbookApi;
}

function revisionResponse(workbook: Workbook, sheetId: string) {
  return { sheetId, revision: findSheetById(workbook, sheetId)?.revision ?? 0 };
}

export function deterministicSheetId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}
