import { FormEvent, useMemo, useState } from 'react';
import './App.css';
import { workbookApi, type WorkbookApi } from './workbookApi';
import {
  appendColumn,
  appendRow,
  createEmptyWorkbook,
  createSheet,
  evaluateFormulaCells,
  moveSheetZOrder,
  renameSheet,
  type SheetZOrderDirection,
  type Sheet,
  type Workbook,
  type WorkspacePosition,
} from './workbook';
import {
  type PendingSheetCreation,
  type PendingSheetRename,
} from './appTypes';
import { CreateSheetDialog, RenameSheetDialog } from './SheetDialogs';
import { StartupErrorScreen, StartupLoadingScreen } from './StartupScreen';
import { useCellEditing } from './useCellEditing';
import { useStartupWorkbookLoad } from './useStartupWorkbookLoad';
import { useEditQueue } from './useEditQueue';
import { Workspace } from './Workspace';

type AppProps = {
  apiClient?: Partial<WorkbookApi>;
  initialWorkbook?: Workbook;
};

function validationMessage(reason: 'empty' | 'duplicate' | 'unknown-sheet') {
  if (reason === 'empty') {
    return 'Sheet name is required.';
  }

  if (reason === 'unknown-sheet') {
    return 'The target sheet could not be found.';
  }

  return 'A sheet with that name already exists.';
}

export function App({ apiClient, initialWorkbook }: AppProps = {}) {
  const resolvedApiClient = apiClient ?? workbookApi;
  const autosaveEnabled = !initialWorkbook || Boolean(apiClient);
  const [workbook, setWorkbook] = useState<Workbook>(() => initialWorkbook ?? createEmptyWorkbook());
  const [pendingCreation, setPendingCreation] = useState<PendingSheetCreation | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingSheetRename | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [error, setError] = useState('');
  const formulaResults = useMemo(() => evaluateFormulaCells(workbook), [workbook]);
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
  const {
    activeCell,
    cancelActiveEdit,
    commitActiveEdit,
    commitEditAndNavigate,
    editingCell,
    keyboardFocusTarget,
    navigateCell,
    selectCell,
    startEditingCell,
    updateEditingCellValue,
  } = useCellEditing({
    enqueueEdit,
    getApiMethod,
    runRevisionedEdit,
    setWorkbook,
    workbook,
  });

  function openCreationDialog(position: WorkspacePosition, label: string) {
    setPendingCreation({ position, label });
    setSheetName('');
    setError('');
  }

  function openRenameDialog(sheet: Sheet) {
    setPendingRename({ sheetId: sheet.id, currentName: sheet.name });
    setSheetName(sheet.name);
    setError('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingCreation) {
      return;
    }

    const result = createSheet({
      id: `sheet-${workbook.sheets.length + 1}`,
      name: sheetName,
      existingSheets: workbook.sheets,
      position: pendingCreation.position,
    });

    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
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
    setPendingCreation(null);
    setSheetName('');
    setError('');
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingRename) {
      return;
    }

    const result = renameSheet(workbook, pendingRename.sheetId, sheetName);
    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
    }

    const renamedSheet = result.value.sheets.find((sheet) => sheet.id === pendingRename.sheetId);
    setWorkbook(result.value);
    if (renamedSheet) {
      enqueueEdit(`sheet:${pendingRename.sheetId}:name`, () =>
        runRevisionedEdit(pendingRename.sheetId, (revision) =>
          getApiMethod('renameSheet')(pendingRename.sheetId, renamedSheet.name, { revision }),
        ),
      );
    }
    setPendingRename(null);
    setSheetName('');
    setError('');
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

  function closeDialog() {
    setPendingCreation(null);
    setPendingRename(null);
    setSheetName('');
    setError('');
  }

  if (startupLoad.status === 'loading') {
    return <StartupLoadingScreen />;
  }

  if (startupLoad.status === 'error') {
    return <StartupErrorScreen message={startupLoad.message} onRetry={retryStartupLoad} />;
  }

  return (
    <main className="workspace-shell">
      <Workspace
        activeCell={activeCell}
        editingCell={editingCell}
        enqueueEdit={enqueueEdit}
        formulaResults={formulaResults}
        getApiMethod={getApiMethod}
        keyboardFocusTarget={keyboardFocusTarget}
        onAppendColumn={appendSheetColumn}
        onAppendRow={appendSheetRow}
        onCancelEdit={cancelActiveEdit}
        onChangeSheetZOrder={changeSheetZOrder}
        onCommitEdit={commitActiveEdit}
        onCommitEditAndNavigate={commitEditAndNavigate}
        onCreateSheet={openCreationDialog}
        onEditValueChange={updateEditingCellValue}
        onNavigateCell={navigateCell}
        onOpenRenameDialog={openRenameDialog}
        onSelectCell={selectCell}
        onStartEdit={startEditingCell}
        runRevisionedEdit={runRevisionedEdit}
        saveStatus={saveStatus}
        setWorkbook={setWorkbook}
        workbook={workbook}
      />

      {pendingCreation ? (
        <CreateSheetDialog
          error={error}
          pendingCreation={pendingCreation}
          sheetName={sheetName}
          onCancel={() => setPendingCreation(null)}
          onNameChange={(name) => {
            setSheetName(name);
            setError('');
          }}
          onSubmit={handleSubmit}
        />
      ) : null}

      {pendingRename ? (
        <RenameSheetDialog
          error={error}
          pendingRename={pendingRename}
          sheetName={sheetName}
          onCancel={closeDialog}
          onNameChange={(name) => {
            setSheetName(name);
            setError('');
          }}
          onSubmit={handleRenameSubmit}
        />
      ) : null}
    </main>
  );
}
