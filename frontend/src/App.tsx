import { FormEvent, useState } from 'react';
import './App.css';
import type { WorkbookApi } from './workbookApi';
import type { Sheet, Workbook, WorkspacePosition } from './workbook';
import {
  type PendingSheetCreation,
  type PendingSheetRename,
} from './appTypes';
import { CreateSheetDialog, RenameSheetDialog } from './SheetDialogs';
import { StartupErrorScreen, StartupLoadingScreen } from './StartupScreen';
import { useCellEditing } from './useCellEditing';
import { useWorkbookController } from './useWorkbookController';
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
  const { commands, formulaResults, retryStartupLoad, saveStatus, sheetIdRemaps, startupLoad, workbook } =
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
    keyboardFocusTarget,
    navigateCell,
    selectCell,
    startEditingCell,
    updateEditingCellValue,
  } = useCellEditing({
    commands,
    sheetIdRemaps,
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
        commands={commands}
        editingCell={editingCell}
        formulaResults={formulaResults}
        keyboardFocusTarget={keyboardFocusTarget}
        onCancelEdit={cancelActiveEdit}
        onClearCell={clearCellContent}
        onCommitEdit={commitActiveEdit}
        onCommitEditAndNavigate={commitEditAndNavigate}
        onCreateSheet={openCreationDialog}
        onEditValueChange={updateEditingCellValue}
        onNavigateCell={navigateCell}
        onOpenRenameDialog={openRenameDialog}
        onSelectCell={selectCell}
        onStartEdit={startEditingCell}
        saveStatus={saveStatus}
        sheetIdRemaps={sheetIdRemaps}
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
