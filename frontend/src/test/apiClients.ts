import { vi } from 'vitest';
import {
  appendColumn,
  appendRow,
  commitCellRawContent,
  findSheetById,
  renameSheet,
  sheetsInOrder,
  validateSheetName,
  type SheetDocument,
  type SheetFrameSize,
  type Workbook,
  type WorkspacePosition,
} from '../workbook';
import type { WorkbookApi } from '../workbookApi';
import { sheetDocument, workbookWithSheets } from './workbookFactories';

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
    updateSheetFrameLayout: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0 })),
    updateSheetZOrder: vi.fn().mockImplementation(async (updates: Array<{ sheetId: string }>) => ({
      sheets: updates.map(({ sheetId }) => ({ sheetId, revision: 0 })),
    })),
    updateCellContent: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0 })),
    appendRow: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0, rowCount: 0, rowId: 'row-appended' })),
    appendColumn: vi.fn().mockImplementation(async (sheetId: string) => ({ sheetId, revision: 0, columnCount: 0, columnId: 'column-appended' })),
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
      const existingSheets = sheetsInOrder(persistedWorkbook);
      const validation = validateSheetName(sheet.name, existingSheets);
      if (!validation.ok) throw new Error('invalid-sheet');
      const created = sheetDocument({
        id: deterministicSheetId(nextSheetId++),
        name: validation.name,
        position: sheet.position,
        frameSize: sheet.frameSize,
        zIndex: sheet.zIndex ?? Math.max(0, ...existingSheets.map((existing) => existing.frame.zIndex)) + 1,
      });
      persistedWorkbook = workbookWithSheets([...existingSheets, created]);
      return created;
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
    updateSheetFrameLayout: vi.fn().mockImplementation(async (
      sheetId: string,
      position: WorkspacePosition,
      frameSize: SheetFrameSize,
    ) =>
      revisionResponse(updateSheet(sheetId, (sheet) => ({
        ...sheet,
        frame: { ...sheet.frame, position, size: frameSize },
      })), sheetId)),
    updateSheetZOrder: vi.fn().mockImplementation(async (
      updates: Array<{ sheetId: string; zIndex: number }>,
    ) => {
      for (const { sheetId, zIndex } of updates) {
        updateSheet(sheetId, (sheet) => ({ ...sheet, frame: { ...sheet.frame, zIndex } }));
      }
      return { sheets: updates.map(({ sheetId }) => revisionResponse(persistedWorkbook, sheetId)) };
    }),
    updateCellContent: vi.fn().mockImplementation(async (sheetId: string, cellKey: string, raw: string) => {
      persistedWorkbook = commitCellRawContent(persistedWorkbook, sheetId, cellKey, raw);
      return revisionResponse(persistedWorkbook, sheetId);
    }),
    appendRow: vi.fn().mockImplementation(async (sheetId: string) => {
      const rowId = `${sheetId}:row:${findSheetById(persistedWorkbook, sheetId)!.content.rows.length + 1}`;
      const sheet = findSheetById(updateSheet(sheetId, (current) => appendRow(current, rowId)), sheetId);
      return {
        ...revisionResponse(persistedWorkbook, sheetId),
        rowCount: sheet?.content.rows.length ?? 0,
        rowId,
      };
    }),
    appendColumn: vi.fn().mockImplementation(async (sheetId: string) => {
      const columnId = `${sheetId}:column:${findSheetById(persistedWorkbook, sheetId)!.content.columns.length + 1}`;
      const sheet = findSheetById(updateSheet(sheetId, (current) => appendColumn(current, columnId)), sheetId);
      return {
        ...revisionResponse(persistedWorkbook, sheetId),
        columnCount: sheet?.content.columns.length ?? 0,
        columnId,
      };
    }),
  } satisfies WorkbookApi;
}

function revisionResponse(workbook: Workbook, sheetId: string) {
  return { sheetId, revision: findSheetById(workbook, sheetId)?.revision ?? 0 };
}

export function deterministicSheetId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}
