import { useMemo, useRef, useState } from 'react';
import { WorkbookApiError, workbookApi, type WorkbookApi } from './workbookApi';
import {
  appendColumn,
  appendRow,
  commitCellRawContent,
  createSheet,
  createEmptyWorkbook,
  evaluateFormulaCells,
  moveSheetZOrder,
  renameSheet,
  validateSheetName,
  type CellKey,
  type FormulaEvaluationSnapshot,
  type MutationResult,
  type SheetFrameSize,
  type SheetZOrderDirection,
  type Workbook,
  type WorkspacePosition,
  type ValidationResult,
} from './workbook';
import { useEditQueue } from './useEditQueue';
import { useStartupWorkbookLoad } from './useStartupWorkbookLoad';

export type WorkbookCommands = {
  appendColumn: (sheetId: string) => void;
  appendRow: (sheetId: string) => void;
  changeSheetZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  createSheet: (name: string, position: WorkspacePosition) => ValidationResult;
  deletePendingSheet: (sheetId: string) => void;
  deleteSheet: (sheetId: string) => void;
  moveSheetFrame: (sheetId: string, position: WorkspacePosition) => void;
  previewSheetFrameLayout: (sheetId: string, position: WorkspacePosition, frameSize?: SheetFrameSize) => void;
  renameSheet: (sheetId: string, name: string) => MutationResult<Workbook>;
  resizeSheetFrame: (sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) => void;
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => void;
};

export type WorkbookController = {
  commands: WorkbookCommands;
  formulaResults: FormulaEvaluationSnapshot;
  retryStartupLoad: () => void;
  saveStatus: ReturnType<typeof useEditQueue>['saveStatus'];
  sheetIdRemaps: ReturnType<typeof useEditQueue>['sheetIdRemaps'];
  startupLoad: ReturnType<typeof useStartupWorkbookLoad>['startupLoad'];
  workbook: Workbook;
};

export function useWorkbookController({
  apiClient,
  initialWorkbook,
}: {
  apiClient?: Partial<WorkbookApi>;
  initialWorkbook?: Workbook;
}): WorkbookController {
  const resolvedApiClient = apiClient ?? workbookApi;
  const autosaveEnabled = !initialWorkbook || Boolean(apiClient);
  const [workbook, setWorkbook] = useState<Workbook>(() => initialWorkbook ?? createEmptyWorkbook());
  const pendingSheets = useRef(new Map<string, string>());
  const suppressedSheetIds = useRef(new Set<string>());
  const unresolvedCreateNames = useRef(new Map<string, string>());
  const {
    cancelPendingSheet,
    enqueueEdit,
    dropSheetQueuedTasks,
    enqueuePendingSheetCreate,
    getApiMethod,
    markSaved,
    registerPendingSheet,
    resolveSheetId,
    runForSavedSheet,
    resolveFormulaSheetReferences,
    runRevisionedEdit,
    saveStatus,
    sheetIdRemaps,
    waitForSheetIdle,
  } = useEditQueue({
    autosaveEnabled,
    resolvedApiClient,
    setWorkbook,
    workbook,
  });
  const { retryStartupLoad, startupLoad } = useStartupWorkbookLoad({
    initialWorkbook,
    markSaved,
    resolvedApiClient,
    setWorkbook,
  });
  const formulaResults = useMemo(() => evaluateFormulaCells(workbook), [workbook]);

  function persistDeletedSheet(savedSheetId: string, revision: number | undefined) {
    return getApiMethod('deleteSheet')(savedSheetId, { revision }).catch((cause: unknown) => {
      if (cause instanceof WorkbookApiError && cause.status === 404 && cause.code === 'sheet-not-found') {
        return undefined;
      }

      throw cause;
    });
  }

  function createSheetCommand(name: string, position: WorkspacePosition): ValidationResult {
    const result = validateSheetName(name, workbook.sheets);

    if (!result.ok) {
      return result;
    }
    if ([...pendingSheets.current.values()].includes(result.name)) {
      return { ok: false, reason: 'duplicate' };
    }

    const pendingSheetId = `pending:${crypto.randomUUID()}`;
    pendingSheets.current.set(pendingSheetId, result.name);
    unresolvedCreateNames.current.set(pendingSheetId, result.name);
    registerPendingSheet(pendingSheetId);
    setWorkbook((currentWorkbook) => {
      const optimisticSheet = createSheet({
        id: pendingSheetId,
        name: result.name,
        existingSheets: currentWorkbook.sheets,
        position,
      });

      return optimisticSheet.ok
        ? { ...currentWorkbook, sheets: [...currentWorkbook.sheets, optimisticSheet.value] }
        : currentWorkbook;
    });
    enqueuePendingSheetCreate(
      pendingSheetId,
      `sheet-create:${result.name}`,
      () =>
        getApiMethod('createSheet')({
          name: result.name,
          position,
        }).finally(() => {
          pendingSheets.current.delete(pendingSheetId);
        }),
      (savedResult) =>
        'sheets' in savedResult
          ? savedResult.sheets.find((sheet) => sheet.name === result.name)?.id
          : savedResult.name === result.name
            ? savedResult.id
            : undefined,
      async (savedSheet, savedSheetId, deleted) => {
        if (deleted) {
          suppressedSheetIds.current.add(savedSheetId);
          unresolvedCreateNames.current.delete(pendingSheetId);
          await persistDeletedSheet(savedSheetId, savedSheet.revision);
          return;
        }

        unresolvedCreateNames.current.delete(pendingSheetId);
        setWorkbook((currentWorkbook) => {
          return {
            ...currentWorkbook,
            sheets: currentWorkbook.sheets.map((sheet) =>
              sheet.id === pendingSheetId
                ? { ...savedSheet, ...sheet, id: savedSheetId, revision: savedSheet.revision }
                : sheet,
            ),
          };
        });
      },
      () => {
        unresolvedCreateNames.current.delete(pendingSheetId);
        setWorkbook((currentWorkbook) => ({
          ...currentWorkbook,
          sheets: currentWorkbook.sheets.filter((sheet) => sheet.id !== pendingSheetId),
        }));
      },
    );

    return result;
  }

  function deletePendingSheet(sheetId: string) {
    if (!pendingSheets.current.has(sheetId)) {
      return;
    }

    pendingSheets.current.delete(sheetId);
    const createWasSent = cancelPendingSheet(sheetId);
    if (!createWasSent) {
      unresolvedCreateNames.current.delete(sheetId);
    }
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: currentWorkbook.sheets.filter((sheet) => sheet.id !== sheetId),
    }));
  }

  function deleteSheetCommand(sheetId: string) {
    if (pendingSheets.current.has(sheetId)) {
      deletePendingSheet(sheetId);
      return;
    }

    const localSheetId = resolveSheetId(sheetId);
    if (workbook.sheets.every((sheet) => sheet.id !== localSheetId)) {
      return;
    }

    dropSheetQueuedTasks(localSheetId);
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: currentWorkbook.sheets.filter((sheet) => sheet.id !== localSheetId),
    }));
    enqueueEdit(`sheet-delete:${localSheetId}`, async () => {
      await waitForSheetIdle(localSheetId);
      dropSheetQueuedTasks(localSheetId);
      return runRevisionedEdit(localSheetId, (revision) => persistDeletedSheet(localSheetId, revision));
    });
  }

  function renameSheetCommand(sheetId: string, name: string): MutationResult<Workbook> {
    const localSheetId = resolveSheetId(sheetId);
    const result = renameSheet(workbook, localSheetId, name);
    if (!result.ok) {
      return result;
    }

    const renamedSheet = result.value.sheets.find((sheet) => sheet.id === localSheetId);
    setWorkbook(result.value);
    if (renamedSheet) {
      enqueueEdit(`sheet:${sheetId}:name`, () =>
        runForSavedSheet(sheetId, (savedSheetId) =>
          runRevisionedEdit(savedSheetId, (revision) =>
            getApiMethod('renameSheet')(savedSheetId, renamedSheet.name, { revision }),
          ),
        ),
      undefined, sheetId);
    }

    return result;
  }

  function appendSheetRow(sheetId: string) {
    const localSheetId = resolveSheetId(sheetId);
    let changed = false;
    const nextWorkbook = {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => {
        if (sheet.id !== localSheetId) {
          return sheet;
        }

        changed = true;
        return appendRow(sheet);
      }),
    };

    if (!changed) {
      return;
    }

    setWorkbook(nextWorkbook);
    enqueueEdit(`sheet:${sheetId}:rows`, () =>
      runForSavedSheet(sheetId, (savedSheetId) =>
        runRevisionedEdit(savedSheetId, (revision) => getApiMethod('appendRow')(savedSheetId, { revision })),
      ),
    undefined, sheetId);
  }

  function appendSheetColumn(sheetId: string) {
    const localSheetId = resolveSheetId(sheetId);
    let changed = false;
    const nextWorkbook = {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => {
        if (sheet.id !== localSheetId) {
          return sheet;
        }

        changed = true;
        return appendColumn(sheet);
      }),
    };

    if (!changed) {
      return;
    }

    setWorkbook(nextWorkbook);
    enqueueEdit(`sheet:${sheetId}:columns`, () =>
      runForSavedSheet(sheetId, (savedSheetId) =>
        runRevisionedEdit(savedSheetId, (revision) => getApiMethod('appendColumn')(savedSheetId, { revision })),
      ),
    undefined, sheetId);
  }

  function updateCellContent(sheetId: string, cellKey: CellKey, raw: string) {
    const localSheetId = resolveSheetId(sheetId);
    const currentSheet = workbook.sheets.find((sheet) => sheet.id === localSheetId);
    const currentRaw = currentSheet?.cells[cellKey]?.raw ?? '';
    const nextWorkbook = commitCellRawContent(workbook, localSheetId, cellKey, raw);
    const nextSheet = nextWorkbook.sheets.find((sheet) => sheet.id === localSheetId);
    const sheetReferences = nextSheet?.cells[cellKey]?.sheetReferences ?? [];

    if (nextWorkbook !== workbook) {
      setWorkbook(nextWorkbook);
    }
    if (nextWorkbook !== workbook && currentRaw !== raw) {
      enqueueEdit(
        `cell:${sheetId}:${cellKey}`,
        () => {
          const saveCellContent = (savedSheetId: string, resolvedSheetReferences = sheetReferences) =>
            runRevisionedEdit(savedSheetId, (revision) =>
              getApiMethod('updateCellContent')(savedSheetId, cellKey, raw, {
                revision,
                ...(resolvedSheetReferences.length === 0 ? {} : { sheetReferences: resolvedSheetReferences }),
              }),
            );

          return runForSavedSheet(sheetId, (savedSheetId) =>
            sheetReferences.length === 0
              ? saveCellContent(savedSheetId)
              : resolveFormulaSheetReferences(sheetReferences).then((resolvedSheetReferences) =>
                  saveCellContent(savedSheetId, resolvedSheetReferences),
                ),
          );
        },
        undefined,
        sheetId,
      );
    }
  }

  function previewSheetFrameLayout(sheetId: string, position: WorkspacePosition, frameSize?: SheetFrameSize) {
    const localSheetId = resolveSheetId(sheetId);
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: currentWorkbook.sheets.map((sheet) =>
        sheet.id === localSheetId
          ? {
              ...sheet,
              position,
              frameSize: frameSize ?? sheet.frameSize,
            }
          : sheet,
      ),
    }));
  }

  function moveSheetFrame(sheetId: string, position: WorkspacePosition) {
    previewSheetFrameLayout(sheetId, position);
    enqueueEdit(`sheet:${sheetId}:position`, () =>
      runForSavedSheet(sheetId, (savedSheetId) =>
        runRevisionedEdit(savedSheetId, (revision) =>
          getApiMethod('updateSheetPosition')(savedSheetId, position, { revision }),
        ),
      ),
    undefined, sheetId);
  }

  function resizeSheetFrame(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) {
    const localSheetId = resolveSheetId(sheetId);
    const currentSheet = workbook.sheets.find((sheet) => sheet.id === localSheetId);
    previewSheetFrameLayout(sheetId, position, frameSize);
    enqueueEdit(`sheet:${sheetId}:frame-size`, () =>
      runForSavedSheet(sheetId, (savedSheetId) =>
        runRevisionedEdit(savedSheetId, (revision) =>
          getApiMethod('updateSheetFrameSize')(savedSheetId, frameSize, { revision }),
        ),
      ),
    undefined, sheetId);
    if (
      currentSheet &&
      (position.x !== currentSheet.position.x || position.y !== currentSheet.position.y)
    ) {
      enqueueEdit(`sheet:${sheetId}:position`, () =>
        runForSavedSheet(sheetId, (savedSheetId) =>
          runRevisionedEdit(savedSheetId, (revision) =>
            getApiMethod('updateSheetPosition')(savedSheetId, position, { revision }),
          ),
        ),
      undefined, sheetId);
    }
  }

  function changeSheetZOrder(sheetId: string, direction: SheetZOrderDirection) {
    const result = moveSheetZOrder(workbook, resolveSheetId(sheetId), direction);
    if (!result.ok) {
      return;
    }

    setWorkbook(result.value);
    for (const nextSheet of result.value.sheets) {
      const currentSheet = workbook.sheets.find((sheet) => sheet.id === nextSheet.id);
      if (currentSheet && currentSheet.zIndex !== nextSheet.zIndex) {
        enqueueEdit(`sheet:${nextSheet.id}:z-index`, () =>
          runForSavedSheet(nextSheet.id, (savedSheetId) =>
            runRevisionedEdit(savedSheetId, (revision) =>
              getApiMethod('updateSheetZIndex')(savedSheetId, nextSheet.zIndex, { revision }),
            ),
          ),
        undefined, nextSheet.id);
      }
    }
  }

  return {
    commands: {
      appendColumn: appendSheetColumn,
      appendRow: appendSheetRow,
      changeSheetZOrder,
      createSheet: createSheetCommand,
      deletePendingSheet,
      deleteSheet: deleteSheetCommand,
      moveSheetFrame,
      previewSheetFrameLayout,
      renameSheet: renameSheetCommand,
      resizeSheetFrame,
      updateCellContent,
    },
    formulaResults,
    retryStartupLoad,
    saveStatus,
    sheetIdRemaps,
    startupLoad,
    workbook,
  };
}
