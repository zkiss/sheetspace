import type { AxisSizeWrite, FormatWrite, SheetDocument, MutationResult, SheetFrameSize, SheetZOrderDirection, Workbook, WorkspacePosition, ValidationResult, DataModel } from '@workbook/core/model';
import { cellKey, type CellKey } from '@workbook/core/address';
import { cellAddressOf } from '@workbook/core/cellIdentity';
import { findSheetById } from '@workbook/read/queries';
import { decodeCellTextLiteral } from '@workbook/core/cellLiteral';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import type { CalculationRequest } from '@calculation/workbookCalculation';
import type { AffectedWorkbookEntities, CellPersistenceWrite, CellWriteResult, MovePreparationFailureReason, PastePreparationFailureReason, WorkbookOperationFailureReason, WorkbookOperationResult } from '@application/core/userActions';
import type { ClipboardParseResult } from '@application/core/clipboardPayload';
import type { ModelMutationResult } from '@workbook/mutations/dataModel';
import type { EntrySessionState } from '@application/core/modelEntrySession';
import { renameColumn } from '@application/core/renameColumn';
import type { CreatingSheetFrame } from '@application/core/sheetCreationState';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import { useSavedSheetAutosave } from './useSavedSheetAutosave';
import { useStartupWorkbookLoad } from './useStartupWorkbookLoad';

export type WorkbookCommands = {
  submitEntryDraft: (sheetId: string) => Promise<{ firstInvalid?: string; result?: { rowId: string; sheet: SheetDocument } }>;
  changeEntryField: (sheetId: string, propertyId: string, raw: string) => void;
  leaveEntryField: (sheetId: string, propertyId: string) => void;
  dismissEntryFeedback: (sheetId: string, propertyId: string) => void;
  bindSheetToModel: (sheetId: string, modelId: string) => DataModelCommandSubmission;
  unbindSheetFromModel: (sheetId: string) => DataModelCommandSubmission;
  addDataModel: (model: DataModel) => DataModelCommandSubmission;
  replaceModelDeclaration: (model: DataModel) => DataModelCommandSubmission;
  renameColumn: (sheetId: string, columnId: string, name: string) => RenameColumnSubmission;
  writeNumberFormats: (sheetId: string, writes: readonly FormatWrite[]) => WorkbookOperationResult;
  writeAxisSizes: (sheetId: string, writes: readonly AxisSizeWrite[]) => WorkbookOperationResult;
  appendColumn: (sheetId: string) => void;
  appendRow: (sheetId: string) => void;
  deleteRow: (sheetId: string, rowId: string) => Readonly<{ result: ReturnType<typeof import('@application/core/deleteRow').deleteRow> | TransitionFailure; completion: Promise<ReturnType<typeof import('@application/core/deleteRow').deleteRow> | TransitionFailure> }>;
  changeSheetZOrder: (sheetId: string, direction: SheetZOrderDirection) => WorkbookOperationResult;
  createSheet: (name: string, position: WorkspacePosition, viewportScale?: number, onCreated?: (sheet: SheetDocument) => void) => ValidationResult;
  deleteSheet: (sheetId: string) => WorkbookOperationResult;
  moveSheetFrame: (sheetId: string, position: WorkspacePosition) => WorkbookOperationResult;
  pasteCells: (sheetId: string, destination: CellKey, clipboard: ClipboardParseResult) => PasteCellsResult;
  pasteStoredCells: (sheetId: string, destination: CellKey, clipboard: ClipboardParseResult) => PasteCellsResult;
  moveStoredCells: (sheetId: string, destination: CellKey, source: import('@application/core/clipboardPayload').ClipboardSourceSnapshot) => MoveCellsResult;
  moveCells: (sheetId: string, destination: CellKey, source: import('@application/core/clipboardPayload').ClipboardSourceSnapshot) => MoveCellsResult;
  renameSheet: (sheetId: string, name: string) => MutationResult<Workbook> | { ok: false; reason: 'pending-model-transition' };
  retryFailedSaves: () => void;
  undo: () => void;
  redo: () => void;
  resizeSheetFrame: (sheetId: string, position: WorkspacePosition, frameSize: SheetFrameSize) => WorkbookOperationResult;
  setSheetVisualScale: (sheetId: string, visualScale: number) => WorkbookOperationResult;
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => CellWriteResult;
  writeCells: (writes: readonly { sheetId: string; rowId: string; columnId: string; raw: string }[]) => CellWriteResult; writeStoredCells: WorkbookCommands['writeCells'];
};

export type ModelCommandResult = ModelMutationResult | { ok: false; reason: 'pending-axis-creation' | 'pending-sheet-creation' | 'pending-model-transition' | 'blocked-persistence-prerequisite' | 'persistence-failed' };
export type DataModelCommandSubmission = Readonly<{ result: ModelCommandResult; completion: Promise<ModelCommandResult> }>;
export type TransitionFailure = Exclude<ModelCommandResult, ModelMutationResult>;
export type RenameColumnResult = ReturnType<typeof renameColumn> | TransitionFailure;
export type RenameColumnSubmission = Readonly<{ result: RenameColumnResult; completion: Promise<RenameColumnResult> }>;

export type PasteCellsResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: PastePreparationFailureReason | WorkbookOperationFailureReason };
export type MoveCellsResult = { ok: true; changed: boolean } | { ok: false; reason: MovePreparationFailureReason | WorkbookOperationFailureReason };

export type ContentHistoryCellSnapshot = Readonly<{ sheetId: string; rowId: string; columnId: string; raw: string | null; display: string | null }>;

export type ContentHistoryFeedback = Readonly<{
  identity: string;
  affected: AffectedWorkbookEntities;
  before: readonly ContentHistoryCellSnapshot[];
  after: readonly ContentHistoryCellSnapshot[];
}>;

export type WorkbookController = {
  entrySessions: Readonly<Record<string, EntrySessionState>>;
  commands: WorkbookCommands;
  canRetryFailedSaves: boolean;
  canUndo: boolean;
  canRedo: boolean;
  contentHistoryFeedback: ContentHistoryFeedback | undefined;
  mutationFailure: 'pending-model-transition' | undefined;
  formulaResults: FormulaEvaluationSnapshot;
  retryStartupLoad: () => void;
  creatingFrames: CreatingSheetFrame[];
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>;
  saveStatus: ReturnType<typeof useSavedSheetAutosave>['saveStatus'];
  startupLoad: ReturnType<typeof useStartupWorkbookLoad>['startupLoad'];
  workbook: Workbook;
};

export type WorkbookControllerState = {
  workbook: Workbook;
  calculationRequest: CalculationRequest;
};

export function contentHistorySnapshot(
  writes: readonly CellPersistenceWrite[],
  raw: 'beforeRaw' | 'afterRaw',
  workbook?: Workbook,
  formulaResults?: FormulaEvaluationSnapshot,
): readonly ContentHistoryCellSnapshot[] {
  return Object.freeze(writes.map((write) => {
    const sheet = workbook && findSheetById(workbook, write.sheetId);
    const address = sheet && cellAddressOf(sheet.content, write);
    const value = write[raw];
    const ordinaryValue = value === null ? null : decodeCellTextLiteral(value) ?? value;
    return Object.freeze({
      sheetId: write.sheetId,
      rowId: write.rowId,
      columnId: write.columnId,
      raw: value,
      display: address ? formulaResults?.[write.sheetId]?.[cellKey(address)]?.display ?? ordinaryValue : ordinaryValue,
    });
  }));
}

export function contentHistoryAffectedSnapshot(affected: AffectedWorkbookEntities): AffectedWorkbookEntities {
  return Object.freeze({
    sheetIds: Object.freeze([...affected.sheetIds]),
    cells: Object.freeze(affected.cells.map(({ sheetId, cell }) => Object.freeze({
      sheetId,
      cell: Object.freeze({ ...cell }),
    }))),
  });
}
