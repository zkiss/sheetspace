import { FormEvent, useState } from 'react';
import './App.css';
import type { WorkbookApi } from '@infrastructure/persistence/workbookApi';
import { SheetDocument, Workbook, WorkspacePosition } from '@workbook/core/model';
import {
  type PendingSheetCreation,
  type PendingSheetRename,
} from './sheetDialogContracts';
import { CreateSheetDialog, RenameSheetDialog } from './SheetDialogs';
import { StartupErrorScreen, StartupLoadingScreen } from './StartupScreen';
import { useCellEditing } from '@grid/useCellEditing';
import { useWorkbookController } from '@application/react/useWorkbookController';
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
  const [pendingCreation, setPendingCreation] = useState<PendingSheetCreation | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingSheetRename | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [error, setError] = useState('');
  const { canRetryFailedSaves, commands, creatingAxes, creatingFrames, formulaResults, retryStartupLoad, saveStatus, startupLoad, workbook } =
    useWorkbookController({
      apiClient,
      initialWorkbook,
    });
  const {
    activeCell,
    cancelActiveEdit,
    clearCellContent,
    commitActiveEdit,
    commitEditAndNavigate,
    editingCell,
    acknowledgeKeyboardFocusRequest,
    keyboardFocusRequest,
    navigateCell,
    referenceSelection,
    selectCell,
    selectReferenceTarget,
    startEditingCell,
    updateEditingCellValue,
  } = useCellEditing({
    commands,
    workbook,
  });

  function openCreationDialog(position: WorkspacePosition, label: string) {
    setPendingCreation({ position, label });
    setSheetName('');
    setError('');
  }

  function openRenameDialog(sheet: SheetDocument) {
    setPendingRename({ sheetId: sheet.id, currentName: sheet.name });
    setSheetName(sheet.name);
    setError('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingCreation) {
      return;
    }

    const result = commands.createSheet(sheetName, pendingCreation.position);

    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
    }

    setPendingCreation(null);
    setSheetName('');
    setError('');
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingRename) {
      return;
    }

    const result = commands.renameSheet(pendingRename.sheetId, sheetName);
    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
    }

    setPendingRename(null);
    setSheetName('');
    setError('');
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
        canRetryFailedSaves={canRetryFailedSaves}
        commands={commands}
        creatingAxes={creatingAxes}
        creatingFrames={creatingFrames}
        editingCell={editingCell}
        formulaResults={formulaResults}
        keyboardFocusRequest={keyboardFocusRequest}
        onKeyboardFocusRequestConsumed={acknowledgeKeyboardFocusRequest}
        onCancelEdit={cancelActiveEdit}
        onClearCell={clearCellContent}
        onCommitEdit={commitActiveEdit}
        onCommitEditAndNavigate={commitEditAndNavigate}
        onCreateSheet={openCreationDialog}
        onEditValueChange={updateEditingCellValue}
        onNavigateCell={navigateCell}
        onOpenRenameDialog={openRenameDialog}
        onRetryFailedSaves={commands.retryFailedSaves}
        onSelectCell={selectCell}
        onSelectReferenceTarget={selectReferenceTarget}
        onStartEdit={startEditingCell}
        referenceSelection={referenceSelection}
        saveStatus={saveStatus}
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
