import { FormEvent, useEffect, useRef, useState } from 'react';
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
  const [dataModelPropertyId, setDataModelPropertyId] = useState<string | undefined>(undefined);
  const dataModelCloseFocus = useRef<(() => void) | undefined>(undefined);
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
    suspendActiveEdit,
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
    restoreSelection,
    startEditingCell,
    updateEditingCellValue,
    updateEditingCellView,
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

  function openCreationDialog(position: WorkspacePosition, viewportScale: number, label: string, confirm: () => void) {
    setPendingCreation({ position, viewportScale, label, confirm });
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

    const result = commands.createSheet(sheetName, pendingCreation.position, pendingCreation.viewportScale, (sheet) => {
      const rowId = sheet.content.rows[0];
      const columnId = sheet.content.columns[0];
      if (rowId && columnId) selectCell({ sheetId: sheet.id, cell: { rowId, columnId } });
    });

    if (!result.ok) {
      setError(validationMessage(result.reason));
      return;
    }

    pendingCreation.confirm();
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
        canUndo={canUndo}
        canRedo={canRedo}
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
        onSuspendEdit={suspendActiveEdit}
        onCreateSheet={openCreationDialog}
        onEditValueChange={updateEditingCellValue}
        onUpdateEditView={updateEditingCellView}
        onNavigateCell={navigateCell}
        onNavigateKeyboardCell={navigateKeyboardCell}
        onOpenDataModels={(modelId, propertyId, onClose) => { dataModelCloseFocus.current = onClose; setDataModelEditId(modelId); setDataModelPropertyId(propertyId); setDataModelsOpen(true); }}
        onOpenRenameDialog={openRenameDialog}
        onRetryFailedSaves={commands.retryFailedSaves}
        onSelectCell={selectCell}
        onExtendSelection={extendSelection}
        onFocusSelection={focusSelection}
        onSettleSelectionGesture={settleSelectionGesture}
        onRestoreGridFocus={focusCurrentSelection}
        onSelectAxis={selectAxis}
        onSelectReferenceTarget={selectReferenceTarget}
        onRestoreSelection={restoreSelection}
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
          formulaResults={formulaResults}
          models={Object.values(workbook.dataModels ?? {})}
          initialModelId={dataModelEditId}
          initialPropertyId={dataModelPropertyId}
          onCancel={() => { setDataModelsOpen(false); setDataModelEditId(undefined); setDataModelPropertyId(undefined); const restore = dataModelCloseFocus.current; dataModelCloseFocus.current = undefined; (restore ?? (() => document.getElementById('data-models-button')?.focus()))(); }}
          onRetryFailedSaves={commands.retryFailedSaves}
          onSave={async (model, isNew) => {
            const submission = isNew && !workbook.dataModels?.[model.id]
              ? commands.addDataModel(model)
              : commands.replaceModelDeclaration(model);
            if (!submission.result.ok) return submission.result;
            const result = await submission.completion;
            if (result.ok) { setDataModelsOpen(false); setDataModelEditId(undefined); setDataModelPropertyId(undefined); const restore = dataModelCloseFocus.current; dataModelCloseFocus.current = undefined; (restore ?? (() => document.getElementById('data-models-button')?.focus()))(); }
            return result;
          }}
          workbook={workbook}
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
