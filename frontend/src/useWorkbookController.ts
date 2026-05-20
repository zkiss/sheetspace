import { useMemo, useState } from 'react';
import { workbookApi, type WorkbookApi } from './workbookApi';
import {
  appendColumn,
  appendRow,
  commitCellRawContent,
  createEmptyWorkbook,
  createSheet,
  evaluateFormulaCells,
  moveSheetZOrder,
  renameSheet,
  type CellKey,
  type FormulaEvaluationSnapshot,
  type MutationResult,
  type Sheet,
  type SheetFrameSize,
  type SheetZOrderDirection,
  type Workbook,
  type WorkspacePosition,
} from './workbook';
import { useEditQueue } from './useEditQueue';
import { useStartupWorkbookLoad } from './useStartupWorkbookLoad';

export type WorkbookCommands = {
  appendColumn: (sheetId: string) => void;
  appendRow: (sheetId: string) => void;
  changeSheetZOrder: (sheetId: string, direction: SheetZOrderDirection) => void;
  createSheet: (name: string, position: WorkspacePosition) => MutationResult<Sheet>;
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
  const { enqueueEdit, getApiMethod, markSaved, runRevisionedEdit, saveStatus } = useEditQueue({
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

  function createSheetCommand(name: string, position: WorkspacePosition): MutationResult<Sheet> {
    const result = createSheet({
      id: `sheet-${workbook.sheets.length + 1}`,
      name,
      existingSheets: workbook.sheets,
      position,
    });

    if (!result.ok) {
      return result;
    }

    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: [...currentWorkbook.sheets, result.value],
    }));
    enqueueEdit(`sheet:${result.value.id}:create`, () =>
      getApiMethod('createSheet')({
        id: result.value.id,
        name: result.value.name,
        position: result.value.position,
        frameSize: result.value.frameSize,
        zIndex: result.value.zIndex,
      }),
    );

    return result;
  }

  function renameSheetCommand(sheetId: string, name: string): MutationResult<Workbook> {
    const result = renameSheet(workbook, sheetId, name);
    if (!result.ok) {
      return result;
    }

    const renamedSheet = result.value.sheets.find((sheet) => sheet.id === sheetId);
    setWorkbook(result.value);
    if (renamedSheet) {
      enqueueEdit(`sheet:${sheetId}:name`, () =>
        runRevisionedEdit(sheetId, (revision) => getApiMethod('renameSheet')(sheetId, renamedSheet.name, { revision })),
      );
    }

    return result;
  }

  function appendSheetRow(sheetId: string) {
    let changed = false;
    const nextWorkbook = {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => {
        if (sheet.id !== sheetId) {
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
      runRevisionedEdit(sheetId, (revision) => getApiMethod('appendRow')(sheetId, { revision })),
    );
  }

  function appendSheetColumn(sheetId: string) {
    let changed = false;
    const nextWorkbook = {
      ...workbook,
      sheets: workbook.sheets.map((sheet) => {
        if (sheet.id !== sheetId) {
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
      runRevisionedEdit(sheetId, (revision) => getApiMethod('appendColumn')(sheetId, { revision })),
    );
  }

  function updateCellContent(sheetId: string, cellKey: CellKey, raw: string) {
    const currentSheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
    const currentRaw = currentSheet?.cells[cellKey]?.raw ?? '';
    const nextWorkbook = commitCellRawContent(workbook, sheetId, cellKey, raw);

    if (nextWorkbook !== workbook) {
      setWorkbook(nextWorkbook);
    }
    if (nextWorkbook !== workbook && currentRaw !== raw) {
      enqueueEdit(`cell:${sheetId}:${cellKey}`, () =>
        runRevisionedEdit(sheetId, (revision) =>
          getApiMethod('updateCellContent')(sheetId, cellKey, raw, {
            revision,
          }),
        ),
      );
    }
  }

  function previewSheetFrameLayout(sheetId: string, position: WorkspacePosition, frameSize?: SheetFrameSize) {
    setWorkbook((currentWorkbook) => ({
      ...currentWorkbook,
      sheets: currentWorkbook.sheets.map((sheet) =>
        sheet.id === sheetId
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
      runRevisionedEdit(sheetId, (revision) => getApiMethod('updateSheetPosition')(sheetId, position, { revision })),
    );
  }

  function resizeSheetFrame(sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) {
    const currentSheet = workbook.sheets.find((sheet) => sheet.id === sheetId);
    previewSheetFrameLayout(sheetId, position, frameSize);
    enqueueEdit(`sheet:${sheetId}:frame-size`, () =>
      runRevisionedEdit(sheetId, (revision) => getApiMethod('updateSheetFrameSize')(sheetId, frameSize, { revision })),
    );
    if (
      currentSheet &&
      (position.x !== currentSheet.position.x || position.y !== currentSheet.position.y)
    ) {
      enqueueEdit(`sheet:${sheetId}:position`, () =>
        runRevisionedEdit(sheetId, (revision) => getApiMethod('updateSheetPosition')(sheetId, position, { revision })),
      );
    }
  }

  function changeSheetZOrder(sheetId: string, direction: SheetZOrderDirection) {
    const result = moveSheetZOrder(workbook, sheetId, direction);
    if (!result.ok) {
      return;
    }

    setWorkbook(result.value);
    for (const nextSheet of result.value.sheets) {
      const currentSheet = workbook.sheets.find((sheet) => sheet.id === nextSheet.id);
      if (currentSheet && currentSheet.zIndex !== nextSheet.zIndex) {
        enqueueEdit(`sheet:${nextSheet.id}:z-index`, () =>
          runRevisionedEdit(nextSheet.id, (revision) =>
            getApiMethod('updateSheetZIndex')(nextSheet.id, nextSheet.zIndex, { revision }),
          ),
        );
      }
    }
  }

  return {
    commands: {
      appendColumn: appendSheetColumn,
      appendRow: appendSheetRow,
      changeSheetZOrder,
      createSheet: createSheetCommand,
      moveSheetFrame,
      previewSheetFrameLayout,
      renameSheet: renameSheetCommand,
      resizeSheetFrame,
      updateCellContent,
    },
    formulaResults,
    retryStartupLoad,
    saveStatus,
    startupLoad,
    workbook,
  };
}
