import { useEffect, useRef, useState, type ReactNode } from 'react';
import { systemClipboard, type SystemClipboardContent } from './systemClipboard';
import type { WorkbookCommands } from '@application/react/useWorkbookController';
import type { CellSelection, CellTarget } from '@grid/cellInteractionContracts';
import type { SheetDocument, Workbook } from '@workbook/core/model';
import { MAX_SHEET_VISUAL_SCALE, MIN_SHEET_VISUAL_SCALE } from '@workbook/core/model';
import { AXIS_SIZE_LIMITS, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from '@workbook/core/axisSizePolicy';
import { NUMBER_FORMAT_PRECISION_LIMITS } from '@workbook/core/numberFormat';
import { materializeFormattingWrites } from '@workbook/read/formattingWrites';
import { NumberFormatControls } from '@workspace/NumberFormatControls';
import { ColourPicker } from '@workspace/ColourPicker';
import { appearanceControlState } from '@workspace/formattingControlState';
import { colourControlReadout } from '@workspace/colourControlReadout';
import { SheetModelControls } from '@workspace/SheetModelControls';
import { formattingActionWrites, numberFormatWithPrecision, type FormattingAction } from '@workspace/formattingActions';
import { formatControlState } from '@workspace/formattingControlState';
import type { FormattingSelectionProjection } from '@workspace/useFormattingSelection';
import type { useWorkspaceController } from '@workspace/useWorkspaceController';
import { MIN_SHEET_FRAME_HEIGHT, MIN_SHEET_FRAME_WIDTH } from '@workspace/workspaceGeometry';
import { CommandNumberForm, type CommandNumberField } from './CommandNumberForm';
import { RenameColumnForm } from './RenameColumnForm';
import { columnRenameTarget, type RenameColumnTarget } from '@application/core/renameColumn';
import type { NavigationCommand } from './NavigationPalette';
import { selectionAddressRange } from './workspaceSelection';

type Panel = { kind: 'format'; title: string } | { kind: 'colour'; title: string; property: 'textColor' | 'fillColor' } | { kind: 'model'; title: string; initialAction?: 'unbind' }
  | { kind: 'rename-column'; title: string; target: RenameColumnTarget; initialName: string }
  | { kind: 'numbers'; title: string; fields: readonly CommandNumberField[]; apply: (values: number[]) => unknown };

export function useWorkspaceActionCommands({ commands, controller, sheet, workbook, activeCell, selection, formatting, referencesVisible,
  canUndo, canRedo, canRetryFailedSaves, navigation, closePalette, openPanel, onOpenDataModels, onRename, onDelete, onEdit, onClear,
  onSelectAxis, onSelectAll, onToggleReferences, onFeedback, onCopy, onCut, onPaste, onCancelCut, hasPendingCut, clipboardAccess = systemClipboard }: {
  commands: WorkbookCommands;
  controller: ReturnType<typeof useWorkspaceController>;
  sheet: SheetDocument | undefined; workbook: Workbook; activeCell: CellTarget | null; selection: CellSelection | null;
  formatting: FormattingSelectionProjection; referencesVisible: boolean;
  canUndo: boolean; canRedo: boolean; canRetryFailedSaves: boolean;
  navigation: { canGoBack: boolean; canGoForward: boolean; traverse: (direction: 'back' | 'forward') => boolean };
  closePalette: (restoreFocus?: boolean) => void; openPanel: () => void;
  onOpenDataModels?: (modelId?: string) => void; onRename: (sheet: SheetDocument) => void;
  onDelete: (sheet: SheetDocument) => void; onEdit: (target: CellTarget) => void; onClear: (target: CellTarget) => void;
  onSelectAxis: (axis: 'rows' | 'columns', target: CellTarget) => void; onSelectAll: (sheet: SheetDocument) => void;
  onToggleReferences: () => void; onFeedback: (message: string) => void;
  onCopy: () => SystemClipboardContent | undefined; onCut: () => SystemClipboardContent | undefined;
  onPaste: (content: SystemClipboardContent) => void; onCancelCut: () => void; hasPendingCut: boolean;
  clipboardAccess?: typeof systemClipboard;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const clipboardOperation = useRef(0);
  useEffect(() => () => { clipboardOperation.current += 1; }, []);
  function show(next: Panel) { setPanel(next); openPanel(); }
  function failure(result: unknown) {
    return result && typeof result === 'object' && 'ok' in result && !result.ok
      ? `The command was not applied${'reason' in result ? `: ${String(result.reason)}` : ''}.` : undefined;
  }
  function run(action: () => unknown, restoreFocus = true) {
    return () => { setPanel(null); closePalette(restoreFocus); const message = failure(action()); if (message) onFeedback(message); };
  }
  function numbers(title: string, fields: readonly CommandNumberField[], apply: (values: number[]) => unknown) {
    return () => show({ kind: 'numbers', title, fields, apply });
  }
  const noSheet = sheet ? undefined : 'Select a sheet first';
  const noCell = activeCell ? undefined : 'Select a cell first';
  const noFormat = formatting.descriptor.valid ? undefined : 'Select cells, rows, or columns first';
  const actions: NavigationCommand[] = [];
  const add = (id: string, label: string, group: string, action: () => void, unavailable?: string, shortcut?: string) => {
    actions.push({ id, label, group, run: action, unavailable, shortcut });
  };

  add('new-sheet', 'New sheet…', 'Workspace', run(controller.createSheetAtViewportCenter, false), undefined, 'Shift+N');
  add('data-models', 'Data models…', 'Workspace', run(() => onOpenDataModels?.(), false), onOpenDataModels ? undefined : 'Data models unavailable');
  add('toggle-references', referencesVisible ? 'Hide references' : 'Show references', 'Workspace', run(onToggleReferences));
  add('back', 'Back', 'Navigation', run(() => navigation.traverse('back'), false), navigation.canGoBack ? undefined : 'No previous location', 'Alt+Left');
  add('forward', 'Forward', 'Navigation', run(() => navigation.traverse('forward'), false), navigation.canGoForward ? undefined : 'No forward location', 'Alt+Right');
  add('undo', 'Undo', 'Editing', run(commands.undo), canUndo ? undefined : 'Nothing to undo', 'Ctrl/⌘+Z');
  add('redo', 'Redo', 'Editing', run(commands.redo), canRedo ? undefined : 'Nothing to redo', 'Ctrl/⌘+Shift+Z');
  add('retry-save', 'Retry failed saves', 'Workspace', run(commands.retryFailedSaves), canRetryFailedSaves ? undefined : 'No failed saves');
  add('zoom-in', 'Zoom in', 'View', run(() => controller.zoomWorkspaceBy(1.2)));
  add('zoom-out', 'Zoom out', 'View', run(() => controller.zoomWorkspaceBy(1 / 1.2)));
  add('reset-view', 'Reset workspace view', 'View', run(controller.resetViewport));

  if (!sheet?.modelId) {
    add('append-row', 'Append row', 'Sheet', run(() => sheet && commands.appendRow(sheet.id)), noSheet);
    add('append-column', 'Append column', 'Sheet', run(() => sheet && commands.appendColumn(sheet.id)), noSheet);
  }
  add('rename-sheet', 'Rename sheet…', 'Sheet', run(() => sheet && onRename(sheet), false), noSheet);
  const columnId = sheet && selection && selection.anchor.sheetId === sheet.id && selection.extent.sheetId === sheet.id && selection.mode !== 'rows'
    && selection.anchor.cell.columnId === selection.extent.cell.columnId ? selection.anchor.cell.columnId : undefined;
  const renameTarget = sheet && columnId ? columnRenameTarget(workbook, sheet.id, columnId) : undefined;
  add('rename-column', 'Rename column…', 'Sheet', () => {
    if (!renameTarget || !sheet) return;
    show({ kind: 'rename-column', title: 'Rename column', target: renameTarget,
      initialName: renameTarget.kind === 'property' ? renameTarget.propertyName : sheet.columnNames?.[renameTarget.columnId] ?? '' });
  }, renameTarget ? undefined : 'Select one existing column first');
  add('delete-sheet', 'Delete sheet', 'Sheet', run(() => sheet && onDelete(sheet)), noSheet);
  for (const [direction, label] of [['top', 'Bring to front'], ['up', 'Bring forward'], ['down', 'Send backward'], ['bottom', 'Send to back']] as const) {
    add(`sheet-order-${direction}`, label, 'Sheet', run(() => sheet && commands.changeSheetZOrder(sheet.id, direction)), noSheet);
  }
  add('sheet-scale', 'Sheet display scale…', 'Sheet', numbers('Sheet display scale', [
    { label: 'Display scale (%)', value: (sheet?.frame.visualScale ?? 1) * 100, min: MIN_SHEET_VISUAL_SCALE * 100, max: MAX_SHEET_VISUAL_SCALE * 100 },
  ], ([scale]) => sheet && commands.setSheetVisualScale(sheet.id, scale! / 100)), noSheet);
  add('sheet-size', 'Resize sheet…', 'Sheet', numbers('Resize sheet', [
    { label: 'Width', value: sheet?.frame.size.width ?? 240, min: MIN_SHEET_FRAME_WIDTH },
    { label: 'Height', value: sheet?.frame.size.height ?? 160, min: MIN_SHEET_FRAME_HEIGHT },
  ], ([width, height]) => sheet && commands.resizeSheetFrame(sheet.id, sheet.frame.position, { width: width!, height: height! })), noSheet);
  add('sheet-position', 'Move sheet…', 'Sheet', numbers('Move sheet', [
    { label: 'X position', value: sheet?.frame.position.x ?? 0 }, { label: 'Y position', value: sheet?.frame.position.y ?? 0 },
  ], ([x, y]) => sheet && commands.moveSheetFrame(sheet.id, { x: x!, y: y! })), noSheet);
  add('bind-model', sheet?.modelId ? 'Rebind model…' : 'Bind model…', 'Data models', () => show({ kind: 'model', title: 'Sheet model binding' }), noSheet);
  add('unbind-model', 'Unbind model…', 'Data models', () => show({ kind: 'model', title: 'Unbind model', initialAction: 'unbind' }), sheet?.modelId ? undefined : 'The selected sheet has no bound model');
  add('edit-model', 'Edit bound model…', 'Data models', run(() => onOpenDataModels?.(sheet?.modelId), false), sheet?.modelId && onOpenDataModels ? undefined : 'The selected sheet has no bound model');

  add('edit-cell', 'Edit or inspect cell formula', 'Selection', run(() => activeCell && onEdit(activeCell), false), noCell, 'F2');
  add('clear-cells', 'Clear cell contents', 'Selection', run(() => activeCell && onClear(activeCell)), noCell, 'Delete');
  async function clipboardAction(kind: 'copy' | 'cut' | 'paste') {
    const operation = ++clipboardOperation.current;
    setClipboardBusy(true);
    try {
      if (kind === 'paste') {
        const content = await clipboardAccess.read();
        if (clipboardOperation.current !== operation) return;
        onPaste(content);
      } else {
        const content = kind === 'copy' ? onCopy() : onCut();
        if (!content) return;
        await clipboardAccess.write(content);
        if (clipboardOperation.current !== operation) return;
      }
      setPanel(null); closePalette();
    } catch {
      if (clipboardOperation.current !== operation) return;
      if (kind === 'cut') onCancelCut();
      closePalette();
      onFeedback('Clipboard access failed. Use the keyboard clipboard shortcut or allow clipboard access in your browser.');
    } finally {
      if (clipboardOperation.current === operation) setClipboardBusy(false);
    }
  }
  add('copy', 'Copy selection', 'Editing', () => { void clipboardAction('copy'); }, noCell ?? (clipboardAccess.canWrite() ? undefined : 'Use Ctrl/⌘+C in this browser'), 'Ctrl/⌘+C');
  add('cut', 'Cut selection', 'Editing', () => { void clipboardAction('cut'); }, noCell ?? (clipboardAccess.canWrite() ? undefined : 'Use Ctrl/⌘+X in this browser'), 'Ctrl/⌘+X');
  add('paste', 'Paste', 'Editing', () => { void clipboardAction('paste'); }, noCell ?? (clipboardAccess.canRead() ? undefined : 'Use Ctrl/⌘+V in this browser'), 'Ctrl/⌘+V');
  add('cancel-cut', 'Cancel cut', 'Editing', run(onCancelCut), hasPendingCut ? undefined : 'No pending cut');
  add('select-row', 'Select row', 'Selection', run(() => activeCell && onSelectAxis('rows', activeCell)), noCell);
  add('select-column', 'Select column', 'Selection', run(() => activeCell && onSelectAxis('columns', activeCell)), noCell);
  add('select-all', 'Select all cells', 'Selection', run(() => sheet && onSelectAll(sheet)), sheet?.content.rows.length && sheet.content.columns.length ? undefined : 'Select a nonempty sheet first');

  const format = (action: FormattingAction) => run(() => formatting.descriptor.valid
    && commands.writeNumberFormats(formatting.descriptor.sheetId, formattingActionWrites(formatting, action)));
  for (const [kind, label] of [['general', 'General number format'], ['number', 'Number format'], ['percent', 'Percent format']] as const) {
    add(`format-${kind}`, label, 'Formatting', format({ type: 'numberFormat', kind }), noFormat);
  }
  add('bold', 'Toggle bold', 'Formatting', format({ type: 'bold' }), noFormat, 'Ctrl/⌘+B');
  for (const [value, label] of [['left', 'Align left'], ['center', 'Align center'], ['right', 'Align right'], ['general', 'Automatic alignment']] as const) {
    add(`align-${value}`, label, 'Formatting', format({ type: 'alignment', value }), noFormat);
  }
  for (const [property, label] of [['numberFormat', 'Inherit number format'], ['fontWeight', 'Inherit bold setting'], ['horizontalAlignment', 'Inherit horizontal alignment'], ['textColor', 'Inherit text colour'], ['fillColor', 'Inherit fill colour']] as const) {
    add(`inherit-${property}`, label, 'Formatting', run(() => formatting.descriptor.valid && commands.writeNumberFormats(formatting.descriptor.sheetId,
      materializeFormattingWrites(formatting.descriptor, property, null))), noFormat);
  }
  add('text-colour', 'Text colour…', 'Formatting', () => show({ kind: 'colour', title: 'Text colour', property: 'textColor' }), noFormat);
  add('fill-colour', 'Fill colour…', 'Formatting', () => show({ kind: 'colour', title: 'Fill colour', property: 'fillColor' }), noFormat);
  add('format-selection', 'Format selection…', 'Formatting', () => show({ kind: 'format', title: 'Format selection' }), noFormat);
  const currentFormat = formatting.summary ? formatControlState(formatting.summary).format : null;
  add('precision', 'Number format precision…', 'Formatting', numbers('Number format precision', [
    { label: 'Decimal places', value: currentFormat && currentFormat.kind !== 'general' ? currentFormat.precision : 2, ...NUMBER_FORMAT_PRECISION_LIMITS, integer: true },
  ], ([precision]) => {
    const value = numberFormatWithPrecision(currentFormat, precision!);
    return value && formatting.descriptor.valid && commands.writeNumberFormats(formatting.descriptor.sheetId, materializeFormattingWrites(formatting.descriptor, 'numberFormat', value));
  }), noFormat ?? (currentFormat && currentFormat.kind !== 'general' ? undefined : 'Choose number or percent formatting first'));

  const range = sheet && selection ? selectionAddressRange(sheet, selection) : undefined;
  for (const axis of ['row', 'column'] as const) {
    const ids = sheet && range ? (axis === 'row' ? sheet.content.rows.slice(range.start.rowIndex, range.end.rowIndex + 1) : sheet.content.columns.slice(range.start.columnIndex, range.end.columnIndex + 1)) : [];
    const value = axis === 'row' ? sheet?.presentation.rowHeights[ids[0]!] ?? DEFAULT_ROW_HEIGHT : sheet?.presentation.columnWidths[ids[0]!] ?? DEFAULT_COLUMN_WIDTH;
    const label = axis === 'row' ? 'Row height' : 'Column width';
    add(`size-${axis}`, `${label}…`, 'Selection', numbers(label, [{ label: `${label} (pixels)`, value, ...AXIS_SIZE_LIMITS[axis] }], ([size]) => sheet && commands.writeAxisSizes(sheet.id, ids.map((axisId) => ({ axis, axisId, size: size! })))), ids.length ? undefined : 'Select cells, rows, or columns first');
    add(`reset-size-${axis}`, `Reset ${label.toLowerCase()}`, 'Selection', run(() => sheet && commands.writeAxisSizes(sheet.id, ids.map((axisId) => ({ axis, axisId, size: null })))), ids.length ? undefined : 'Select cells, rows, or columns first');
  }

  let content: ReactNode;
  if (panel?.kind === 'colour' && formatting.summary && formatting.descriptor.valid) {
    const state = appearanceControlState(formatting.summary)[panel.property];
    const readout = colourControlReadout(state, selection?.mode ?? 'cells', panel.property === 'textColor' ? '#1f2933' : '#ffffff');
    const writeColour = (value: `#${string}` | 'automatic' | 'none' | null) => {
      const descriptor = formatting.descriptor;
      if (!descriptor.valid) return;
      const writes = panel.property === 'textColor'
        ? materializeFormattingWrites(descriptor, 'textColor', value === 'none' ? 'automatic' : value)
        : materializeFormattingWrites(descriptor, 'fillColor', value === 'automatic' ? 'none' : value);
      run(() => commands.writeNumberFormats(descriptor.sheetId, writes))();
    };
    content = <div className="number-format-controls"><ColourPicker key={panel.property} defaultOpen ariaLabel={panel.title} purpose={panel.property === 'textColor' ? 'text' : 'fill'} colour={readout.colour} customColours={formatting.customColours} disabled={false} status={readout.status} localOverrideState={state.localOverrideState} descriptionId="command-colour-state" defaultOptionLabel="No colour" onApply={writeColour} onApplyInherited={() => writeColour(null)} onApplyDefault={() => writeColour(panel.property === 'textColor' ? 'automatic' : 'none')} /><span id="command-colour-state">{panel.title} for the current selection</span></div>;
  }
  if (panel?.kind === 'format') content = <NumberFormatControls idPrefix="command-" projection={formatting} selection={selection} onWrite={(writes) => {
    if (!formatting.descriptor.valid || !writes.length) return;
    const message = failure(commands.writeNumberFormats(formatting.descriptor.sheetId, writes));
    if (message) onFeedback(message);
  }} />;
  if (panel?.kind === 'model' && sheet) content = <SheetModelControls key={`${sheet.id}:${panel.initialAction}`} models={Object.values(workbook.dataModels ?? {})} sheet={sheet} initialAction={panel.initialAction} onBind={commands.bindSheetToModel} onUnbind={commands.unbindSheetFromModel} onOpenDataModels={(id) => run(() => onOpenDataModels?.(id), false)()} />;
  if (panel?.kind === 'rename-column') content = <RenameColumnForm target={panel.target} initialName={panel.initialName} onCancel={() => { setPanel(null); closePalette(); }} onApply={async (name) => {
    const current = columnRenameTarget(workbook, panel.target.sheetId, panel.target.columnId);
    if (sheet?.id !== panel.target.sheetId || JSON.stringify(current) !== JSON.stringify(panel.target) ||
      (current?.kind === 'ordinary' && (workbook.documents[current.sheetId]?.columnNames?.[current.columnId] ?? '') !== panel.initialName)) return 'The selected column has changed. Close and try again.';
    const submission = commands.renameColumn(panel.target.sheetId, panel.target.columnId, name);
    setRenameBusy(true);
    let result;
    try { result = submission.result.ok ? await submission.completion : submission.result; }
    finally { setRenameBusy(false); }
    if (!result.ok) {
      if (result.reason === 'empty') return 'Enter a nonblank column name.';
      if (result.reason === 'duplicate') return 'That column name is already in use.';
      return `Could not rename the column: ${result.reason}.`;
    }
    setPanel(null); closePalette();
    return undefined;
  }} />;
  if (panel?.kind === 'numbers') content = <CommandNumberForm key={panel.title} fields={panel.fields} onApply={(values) => {
    const message = failure(panel.apply(values));
    if (!message) { setPanel(null); closePalette(); }
    return message;
  }} />;
  return { commands: actions.sort((left, right) => (left.group ?? '').localeCompare(right.group ?? '')), busy: clipboardBusy, preventClose: renameBusy, panel: panel ? { title: panel.title, content } : undefined, resetPanel: () => { clipboardOperation.current += 1; if (clipboardBusy) onCancelCut(); setClipboardBusy(false); setPanel(null); } };
}
