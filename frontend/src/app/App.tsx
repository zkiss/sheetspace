import { FormEvent, useEffect, useState } from 'react';
import './App.css';
import type { WorkbookApi } from '@infrastructure/persistence/workbookApi';
import { SheetDocument, Workbook, WorkspacePosition } from '@workbook/core/model';
import {
  type PendingSheetCreation,
  type PendingSheetRename,
} from './sheetDialogContracts';
import { CreateSheetDialog, RenameSheetDialog } from './SheetDialogs';
import { DataModelDialog } from './DataModelDialog';
import { StartupErrorScreen, StartupLoadingScreen } from './StartupScreen';
import { useCellEditing } from '@grid/useCellEditing';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { Workspace } from './Workspace';

type AppProps = {
  apiClient?: Partial<WorkbookApi>;
  initialWorkbook?: Workbook;
};

function validationMessage(reason: 'empty' | 'duplicate' | 'unknown-sheet' | 'pending-model-transition') {
  if (reason === 'empty') {
    return 'Sheet name is required.';
  }

  if (reason === 'unknown-sheet') {
    return 'The target sheet could not be found.';
  }

  if (reason === 'pending-model-transition') {
    return 'Wait for the data model change to finish.';
  }

  return 'A sheet with that name already exists.';
}

export function App({ apiClient, initialWorkbook }: AppProps = {}) {
  const [pendingCreation, setPendingCreation] = useState<PendingSheetCreation | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingSheetRename | null>(null);
  const [dataModelsOpen, setDataModelsOpen] = useState(false);
  const [dataModelEditId, setDataModelEditId] = useState<string | undefined>(undefined);
  const [sheetName, setSheetName] = useState('');
  const [error, setError] = useState('');
  const { canRedo, canRetryFailedSaves, canUndo, commands, contentHistoryFeedback, creatingAxes, creatingFrames, formulaResults, mutationFailure, retryStartupLoad, saveStatus, startupLoad, workbook } =
    useWorkbookController({
      apiClient,
      initialWorkbook,
    });
  const {
    activeCell,
    cancelActiveEdit,
    clearCellContent,
    clearSelection,
    commitActiveEdit,
    commitEditAndNavigate,
    editingCell,
    extendSelection,
    focusSelection,
    settleSelectionGesture,
    focusCurrentSelection,
    acknowledgeKeyboardFocusRequest,
    activateSheet,
    cancelKeyboardFocusRequest,
    keyboardFocusRequest,
    navigateCell,
    navigateKeyboardCell,
    referenceSelection,
    selectionRange,
    selectionOwner,
    selectCell,
    selectAxis,
    selectReferenceTarget,
    startEditingCell,
    updateEditingCellValue,
  } = useCellEditing({
    commands,
    workbook,
  });

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!(event.ctrlKey || event.metaKey) || event.altKey || (key !== 'z' && key !== 'y')) return;
      const target = event.target as HTMLElement | null;
      if (dataModelsOpen || target?.closest('textarea, input, [contenteditable="true"]')) return;
      const redo = key === 'y' || event.shiftKey;
      if (redo ? !canRedo : !canUndo) return;
      event.preventDefault();
      if (redo) commands.redo(); else commands.undo();
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [canRedo, canUndo, commands, dataModelsOpen]);

  function openCreationDialog(position: WorkspacePosition, viewportScale: number, label: string) {
    setPendingCreation({ position, viewportScale, label });
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

    const result = commands.createSheet(sheetName, pendingCreation.position, pendingCreation.viewportScale);

    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
    }

    closeDialog();
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

    closeDialog();
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
        onActivateSheet={activateSheet}
        canRetryFailedSaves={canRetryFailedSaves}
        commands={commands}
        contentHistoryFeedback={contentHistoryFeedback}
        creatingAxes={creatingAxes}
        creatingFrames={creatingFrames}
        editingCell={editingCell}
        formulaResults={formulaResults}
        sheetDialogOpen={Boolean(pendingCreation || pendingRename || dataModelsOpen)}
        keyboardFocusRequest={keyboardFocusRequest}
        onKeyboardFocusRequestConsumed={acknowledgeKeyboardFocusRequest}
        onKeyboardFocusRequestCancelled={cancelKeyboardFocusRequest}
        onCancelEdit={cancelActiveEdit}
        onClearCell={clearCellContent}
        onClearSelection={clearSelection}
        onCommitEdit={commitActiveEdit}
        onCommitEditAndNavigate={commitEditAndNavigate}
        onCreateSheet={openCreationDialog}
        onEditValueChange={updateEditingCellValue}
        onNavigateCell={navigateCell}
        onNavigateKeyboardCell={navigateKeyboardCell}
        onOpenDataModels={(modelId) => { setDataModelEditId(modelId); setDataModelsOpen(true); }}
        onOpenRenameDialog={openRenameDialog}
        onRetryFailedSaves={commands.retryFailedSaves}
        onSelectCell={selectCell}
        onExtendSelection={extendSelection}
        onFocusSelection={focusSelection}
        onSettleSelectionGesture={settleSelectionGesture}
        onRestoreGridFocus={focusCurrentSelection}
        onSelectAxis={selectAxis}
        onSelectReferenceTarget={selectReferenceTarget}
        onStartEdit={startEditingCell}
        referenceSelection={referenceSelection}
        selectionRange={selectionRange}
        selectionOwner={selectionOwner}
        saveStatus={saveStatus}
        workbook={workbook}
      />
      {mutationFailure ? <p className="form-error" role="alert">Wait for the data model change to finish. Your change was not applied.</p> : null}

      {dataModelsOpen ? (
        <DataModelDialog
          models={Object.values(workbook.dataModels ?? {})}
          initialModelId={dataModelEditId}
          onCancel={() => { setDataModelsOpen(false); setDataModelEditId(undefined); document.getElementById('data-models-button')?.focus(); }}
          onRetryFailedSaves={commands.retryFailedSaves}
          onSave={async (model, isNew) => {
            const submission = isNew && !workbook.dataModels?.[model.id]
              ? commands.addDataModel(model)
              : commands.replaceModelDeclaration(model);
            if (!submission.result.ok) return submission.result;
            const result = await submission.completion;
            if (result.ok) { setDataModelsOpen(false); setDataModelEditId(undefined); document.getElementById('data-models-button')?.focus(); }
            return result;
          }}
        />
      ) : null}

      {pendingCreation ? (
        <CreateSheetDialog
          error={error}
          pendingCreation={pendingCreation}
          sheetName={sheetName}
          onCancel={closeDialog}
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
