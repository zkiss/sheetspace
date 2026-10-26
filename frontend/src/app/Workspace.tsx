/* eslint-disable max-lines -- Workspace remains the existing composition root; focused history ownership is extracted. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { SheetDocument, Workbook, WorkspacePosition } from '@workbook/core/model';
import { cellKey, columnIndexToLabel } from '@workbook/core/address';
import { addressRangeOf, cellAddressOf, cellIdentityAt } from '@workbook/core/cellIdentity';
import { selectionAddressRange } from './workspaceSelection';
import { cellRawContent, findSheetById, frameProjection, sheetsInOrder, tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from '@grid/gridAxisProjection';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import type { SelectionGesture, CellTarget, CellNavigationDirection, CellEditSession, CellSelection, CellSelectionMode, ReferenceNavigationTarget } from '@grid/cellInteractionContracts';
import type { SaveStatus } from '@application/core/state';
import { cellKeyForTarget, type CellFocusRequest } from '@grid/cellInteraction';
import { ContextualReferenceLinks } from '@reference-navigation/ContextualReferenceLinks';
import { contextualReferences, projectReferenceGeometry, type GridReferenceViewport } from '@reference-navigation/contextualReferenceProjection';
import { inspectFormula, navigableReferencesAtCaret } from '@reference-navigation/formulaInspection';
import { formulaPanelReferenceValues } from './formulaPanelValues';
import { formulaRawForStorage, workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import { SheetContextMenu } from '@workspace/SheetContextMenu';
import { SheetFrame } from '@workspace/SheetFrame';
import { SheetOverview } from '@workspace/SheetOverview';
import { CreatingSheetFrame } from '@workspace/CreatingSheetFrame';
import type { CreatingSheetFrame as CreatingSheetFrameState } from '@application/core/sheetCreationState';
import { SheetGrid } from '@grid/SheetGrid';
import { useReferenceNavigation } from '@reference-navigation/useReferenceNavigation';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';
import { useSheetFrameInteractions } from '@workspace/useSheetFrameInteractions';
import type { WorkbookCommands } from '@application/react/useWorkbookController';
import { useWorkspaceController } from '@workspace/useWorkspaceController';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';
import { WorkspaceToolbar } from '@workspace/WorkspaceToolbar';
import { NumberFormatControls } from '@workspace/NumberFormatControls';
import { formattingActionWrites, formattingShortcut } from '@workspace/formattingActions';
import { useFormattingSelection } from '@workspace/useFormattingSelection';
import { mountedWorkspaceFrameIds } from '@workspace/workspaceFrameVirtualization';
import { useWorkspaceHistoryReveal } from './useWorkspaceHistoryReveal';
import { ClipboardPayloadStore } from '@grid/clipboardPayload';
import { useGridFocusLease } from './useGridFocusLease';
import { SheetModelControls } from '@workspace/SheetModelControls';
import { historyCellsForSheet } from './historyCellsForSheet';
import { useSelectionTransition } from './useSelectionTransition';
import { modelColumnPresentation, selectionIncludesCalculatedColumn } from './modelColumnPresentation';
import type { CellWriteResult } from '@application/core/userActions';
import { usageQueries, type UsageQueryResult } from '@calculation/usageQueries';
import { NavigationPalette, type NavigationCommand } from './NavigationPalette';
import { clampWorkspaceZoom, workspaceRectForFrame } from '@workspace/workspaceGeometry';
const CALCULATED_CELL_PROTECTION = 'This cell is calculated in the data model. Edit the calculation in Data models.'; export function Workspace({
  activeCell,
  canRetryFailedSaves,
  commands,
  contentHistoryFeedback,
  editingCell,
  formulaResults,
  keyboardFocusRequest,
  onKeyboardFocusRequestConsumed,
  onKeyboardFocusRequestCancelled,
  onCancelEdit,
  onClearCell,
  onClearSelection,
  onActivateSheet,
  onCommitEdit,
  onCommitEditAndNavigate,
  onSuspendEdit,
  onCreateSheet,
  onEditValueChange,
  onUpdateEditView,
  onNavigateCell,
  onNavigateKeyboardCell,
  onOpenDataModels,
  onOpenRenameDialog,
  onRetryFailedSaves,
  onSelectCell,
  onExtendSelection,
  onFocusSelection,
  onSettleSelectionGesture,
  onRestoreGridFocus,
  onSelectAxis,
  onSelectReferenceTarget,
  onRestoreSelection,
  onStartEdit,
  referenceSelection,
  selectionRange,
  selectionOwner,
  saveStatus,
  sheetDialogOpen = false,
  creatingAxes,
  creatingFrames,
  workbook,
}: {
  activeCell: CellTarget | null;
  canRetryFailedSaves: boolean;
  commands: WorkbookCommands;
  contentHistoryFeedback: import('@application/react/useWorkbookController').ContentHistoryFeedback | undefined;
  editingCell: CellEditSession | null;
  formulaResults: FormulaEvaluationSnapshot;
  keyboardFocusRequest: CellFocusRequest | null;
  onKeyboardFocusRequestConsumed: (requestId: number) => void;
  onKeyboardFocusRequestCancelled: (requestId: number) => void;
  onCancelEdit: () => void;
  onClearCell: (target: CellTarget) => CellWriteResult | undefined;
  onClearSelection: () => void;
  onActivateSheet: (sheetId: string, requestFocus?: boolean) => CellTarget | undefined;
  onCommitEdit: (session?: CellEditSession) => CellWriteResult | undefined;
  onCommitEditAndNavigate: (session: CellEditSession, request: Pick<import('@grid/cellInteractionContracts').CellNavigationRequest, 'key' | 'shift'>) => CellWriteResult | undefined;
  onSuspendEdit?: (session: CellEditSession) => void;
  onCreateSheet: (position: WorkspacePosition, viewportScale: number, label: string) => void;
  onEditValueChange: (value: string) => void;
  onUpdateEditView?: (selection: { start: number; end: number }, scrollTop: number) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onNavigateKeyboardCell: (target: CellTarget, request: import('@grid/cellInteractionContracts').CellNavigationRequest) => boolean;
  onOpenDataModels?: (modelId?: string, propertyId?: string, onClose?: () => void) => void;
  onOpenRenameDialog: (sheet: SheetDocument) => void;
  onRetryFailedSaves: () => void;
  onSelectCell: (target: CellTarget, gesture?: SelectionGesture) => void;
  onExtendSelection: (target: CellTarget, gesture?: SelectionGesture) => void;
  onFocusSelection: (target: CellTarget, gesture?: SelectionGesture) => void;
  onSettleSelectionGesture: (owner: symbol) => void;
  onRestoreGridFocus: () => number | null;
  onSelectAxis: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture) => void;
  onSelectReferenceTarget: (target: ReferenceNavigationTarget) => void;
  onRestoreSelection: (selection: CellSelection | null) => boolean;
  onStartEdit: (target: CellTarget, initialValue?: string) => void;
  referenceSelection: ReferenceNavigationTarget | null;
  selectionRange: CellSelection | null;
  selectionOwner?: symbol | null;
  saveStatus: SaveStatus;
  sheetDialogOpen?: boolean;
  creatingFrames: CreatingSheetFrameState[];
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>;
  workbook: Workbook;
}) {
  const clipboard = useRef(new ClipboardPayloadStore());
  const [, setClipboardRevision] = useState(0);
  const [calculatedCellFeedback, setCalculatedCellFeedback] = useState('');
  const [navigationFeedback, setNavigationFeedback] = useState('');
  const [referenceLinksVisible, setReferenceLinksVisible] = useState(false);
  const selectionTransition = useSelectionTransition(activeCell);
  const [hoveredReferenceSpan, setHoveredReferenceSpan] = useState<{ start: number; end: number } | null>(null);
  const [modifierReferenceSpan, setModifierReferenceSpan] = useState<{ start: number; end: number } | null>(null);
  const [referenceGridViewports, setReferenceGridViewports] = useState<Readonly<Record<string, GridReferenceViewport | undefined>>>({});
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteChoices, setPaletteChoices] = useState<NavigationCommand[] | null>(null);
  const [rowPickerOpen, setRowPickerOpen] = useState(false);
  const [paletteView, setPaletteView] = useState(0);
  const paletteInvoker = useRef<HTMLElement | null>(null);
  const propertyDefinitionInvoker = useRef<HTMLElement | null>(null);
  const openUsagesRef = useRef<() => void>(() => {});
  const openReferenceChoicesRef = useRef<() => void>(() => {});
  const openPropertyDefinitionRef = useRef<() => void>(() => {});
  const runPaletteCommandRef = useRef<(id: string) => void>(() => {});
  const [gridInteractionSheetIds, setGridInteractionSheetIds] = useState<ReadonlySet<string>>(() => new Set());
  const gridHistoryReveals = useRef<{ identity?: string; sheetIds: Set<string> }>({ sheetIds: new Set() });
  const handleHistoryRevealConsumed = useCallback((sheetId: string, identity: string) => {
    if (gridHistoryReveals.current.identity !== identity) gridHistoryReveals.current = { identity, sheetIds: new Set() };
    gridHistoryReveals.current.sheetIds.add(sheetId);
  }, []);
  const sheets = sheetsInOrder(workbook);
  const selectedSheet = activeCell ? findSheetById(workbook, activeCell.sheetId) : undefined;
  const dataModels = Object.values(workbook.dataModels ?? {});
  const selectedCellKey = selectedSheet ? cellKeyForTarget(selectedSheet, activeCell) : null;
  const selectedRaw = selectedSheet && selectedCellKey
    ? cellRawContent(selectedSheet, selectedCellKey)
    : undefined;
  const inspectedRaw = editingCell && editingCell.target.sheetId === selectedSheet?.id
    ? formulaRawForStorage(editingCell.draft, workbook, selectedSheet.id)
    : selectedRaw;
  const formulaInspection = selectedSheet && inspectedRaw
    ? inspectFormula(inspectedRaw, workbook, selectedSheet)
    : undefined;
  // A sheet dialog takes ownership from all background transient sessions.
  const interactionsEnabled = !sheetDialogOpen && !commandPaletteOpen;
  const formattingProjection = useFormattingSelection(selectedSheet, selectionRange);
  const cancelNavigationBeforeUserMovement = useRef<() => void>(() => {});
  const panViewportNeedsRender = useRef<(viewport: import('@workspace/workspaceContracts').WorkspaceViewport) => boolean>(() => true);
  const workspaceController = useWorkspaceController({
    onBeforeUserMovement: () => cancelNavigationBeforeUserMovement.current(),
    shouldRenderPanViewport: (viewport) => panViewportNeedsRender.current(viewport),
    onClearSelection,
    onCreateSheet,
    interactionsEnabled,
  });
  const navigationKeyboardEnabled = interactionsEnabled && !workspaceController.pendingSheetMenu;
  const { acknowledgeGridRestore, cancelNavigationRestore, history: navigationHistory, historyRestoreForSheet, navigationRestoreForSheet, navigationRequestForSheet, pendingNavigationSheetId, registerScrollContainer, recordUserGridMovement, startExplicitNavigation, startExplicitSheetNavigation } = useWorkspaceNavigationHistory({
    onRestoreSelection, onUnavailableTarget: () => setNavigationFeedback('The saved navigation target is no longer available.'), restoreViewport: workspaceController.restoreViewport,
    selection: selectionRange, viewport: workspaceController.viewport,
  });
  cancelNavigationBeforeUserMovement.current = cancelNavigationRestore;
  const lastViewport = useRef(workspaceController.viewport);
  useEffect(() => {
    if (lastViewport.current !== workspaceController.viewport) {
      lastViewport.current = workspaceController.viewport;
      // Viewport effects do not establish movement provenance. A restored or
      // animated viewport may commit after its restore transaction completes;
      // only the controller can identify a gesture that should enter history.
      if (workspaceController.consumeViewportMovementIsUser()) navigationHistory.recordUserMovement();
    }
  }, [navigationHistory, workspaceController]);
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!interactionsEnabled) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('textarea, input, select, [contenteditable="true"]') || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const primaryModifier = event.ctrlKey || event.metaKey;
      if (!primaryModifier && event.shiftKey && !event.altKey && key === 'n') {
        event.preventDefault();
        workspaceController.createSheetAtViewportCenter();
        return;
      }
      if (event.altKey && !event.shiftKey && !primaryModifier && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        if (!navigationKeyboardEnabled) return;
        if (navigationHistory.traverse(event.key === 'ArrowLeft' ? 'back' : 'forward')) event.preventDefault();
        return;
      }
      if (primaryModifier && event.shiftKey && !event.altKey && key === 'p' && navigationKeyboardEnabled) {
        event.preventDefault();
        paletteInvoker.current = target;
        setCommandPaletteOpen(true);
        return;
      }
      if (event.altKey && event.shiftKey && !primaryModifier && navigationKeyboardEnabled) {
        const commandId = ({ s: 'sheet', c: 'column', r: 'row' } as Record<string, string>)[key];
        if (commandId) {
          event.preventDefault();
          paletteInvoker.current = target;
          runPaletteCommandRef.current(commandId);
          return;
        }
      }
      if (event.altKey && event.shiftKey && !primaryModifier && key === 'u' && navigationKeyboardEnabled) {
        event.preventDefault();
        paletteInvoker.current = target;
        openUsagesRef.current();
        return;
      }
      if (event.altKey && event.shiftKey && !primaryModifier && key === 'd' && navigationKeyboardEnabled) {
        event.preventDefault();
        propertyDefinitionInvoker.current = target;
        paletteInvoker.current = target;
        openPropertyDefinitionRef.current();
        return;
      }
      if (event.altKey && !event.shiftKey && !primaryModifier && event.key === 'Enter' && navigationKeyboardEnabled) {
        event.preventDefault();
        paletteInvoker.current = target;
        openReferenceChoicesRef.current();
        return;
      }
      const action = formattingShortcut(event);
      if (!action) return;
      event.preventDefault();
      const writes = formattingActionWrites(formattingProjection, action, { editing: editingCell !== null, modal: !interactionsEnabled });
      if (writes.length === 0 || !formattingProjection.descriptor.valid) return;
      commands.writeNumberFormats(formattingProjection.descriptor.sheetId, writes);
      onRestoreGridFocus();
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [commands, editingCell, formattingProjection, interactionsEnabled, navigationHistory, navigationKeyboardEnabled, onRestoreGridFocus, workspaceController]);
  useWorkspaceHistoryReveal(contentHistoryFeedback, editingCell !== null, sheets, creatingAxes, workspaceController);
  const {
    navigateReference,
    navigateTarget,
    navigationHighlight,
    navigationHighlightIdentity,
    navigationMotion,
  } = useReferenceNavigation({
    navigateToTarget: workspaceController.navigateToTarget,
    onSelectReferenceTarget,
    onExplicitNavigation: navigationHistory.explicitNavigation,
    startNavigation: startExplicitNavigation,
    workbook,
  });
  const closeCommandPalette = useCallback((restoreInvoker = true) => {
    setCommandPaletteOpen(false);
    setPaletteChoices(null);
    setRowPickerOpen(false);
    if (restoreInvoker) queueMicrotask(() => {
      if (paletteInvoker.current?.isConnected) paletteInvoker.current.focus();
      else onRestoreGridFocus();
    });
  }, [onRestoreGridFocus]);
  const navigateCellTarget = useCallback((target: CellTarget) => {
    const sheet = findSheetById(workbook, target.sheetId);
    if (!sheet || !navigateTarget({ kind: 'cell', target }, sheet)) setNavigationFeedback('The navigation target is no longer available.');
  }, [navigateTarget, workbook]);
  const navigateEmptySheet = useCallback((sheet: SheetDocument) => {
    startExplicitSheetNavigation(onClearSelection, (settled) => workspaceController.navigateToTarget(workspaceRectForFrame(sheet.frame), {
      naturalScale: clampWorkspaceZoom(1 / sheet.frame.visualScale),
      onSettled: settled,
    }));
  }, [onClearSelection, startExplicitSheetNavigation, workspaceController]);
  const openChoices = useCallback((choices: NavigationCommand[]) => {
    setRowPickerOpen(false);
    setPaletteChoices(choices);
    setPaletteView((view) => view + 1);
    setCommandPaletteOpen(true);
  }, []);
  const propertyForActiveCell = useCallback(() => {
    if (!activeCell || !selectedSheet?.modelId) return undefined;
    const model = workbook.dataModels?.[selectedSheet.modelId];
    return model?.columns.find((property) => selectedSheet.modelColumnBindings?.[property.id] === activeCell.cell.columnId);
  }, [activeCell, selectedSheet, workbook.dataModels]);
  const propertyForReference = useCallback((reference: NonNullable<typeof formulaInspection>['references'][number]) => {
    const identity = reference.target.kind === 'cell' ? reference.target.identity : reference.target.range?.start;
    const sheet = findSheetById(workbook, reference.target.sheetId);
    if (!identity || !sheet?.modelId) return undefined;
    const property = workbook.dataModels?.[sheet.modelId]?.columns
      .find((column) => sheet.modelColumnBindings?.[column.id] === identity.columnId);
    return property ? { modelId: sheet.modelId, propertyId: property.id, name: property.name } : undefined;
  }, [workbook]);
  const propertyReferenceChoices = useCallback(() => {
    const raw = editingCell?.draft ?? selectedRaw;
    const inspection = selectedSheet && raw ? inspectFormula(raw, workbook, selectedSheet) : undefined;
    const caret = editingCell?.selection?.start;
    const references = inspection?.references.filter((reference) => reference.navigable) ?? [];
    const atCaret = caret === undefined ? references : references.filter((reference) => caret >= reference.displaySpan.start && caret <= reference.displaySpan.end);
    const candidates = (atCaret.length ? atCaret : references).flatMap((reference) => {
      const property = propertyForReference(reference);
      return property ? [{ reference, property }] : [];
    });
    return [...new Map(candidates.map((candidate) => [`${candidate.property.modelId}:${candidate.property.propertyId}`, candidate])).values()];
  }, [editingCell, propertyForReference, selectedRaw, selectedSheet, workbook]);
  const openPropertyDefinitionFor = useCallback((modelId: string, propertyId: string) => {
    const invoker = commandPaletteOpen ? paletteInvoker.current : propertyDefinitionInvoker.current;
    closeCommandPalette(false);
    onOpenDataModels?.(modelId, propertyId, () => {
      if (invoker?.isConnected) invoker.focus();
      else onRestoreGridFocus();
    });
  }, [closeCommandPalette, commandPaletteOpen, onOpenDataModels, onRestoreGridFocus]);
  const openPropertyDefinition = useCallback(() => {
    const property = propertyForActiveCell();
    if (property && selectedSheet?.modelId) { openPropertyDefinitionFor(selectedSheet.modelId, property.id); return; }
    const candidates = propertyReferenceChoices();
    if (candidates.length === 1) { openPropertyDefinitionFor(candidates[0]!.property.modelId, candidates[0]!.property.propertyId); return; }
    if (candidates.length > 1) {
      openChoices(candidates.map(({ property: candidate }) => ({
        id: `definition:${candidate.modelId}:${candidate.propertyId}`,
        label: `Go to property definition: ${candidate.name}`,
        group: 'Property references',
        run: () => openPropertyDefinitionFor(candidate.modelId, candidate.propertyId),
      })));
      return;
    }
    setNavigationFeedback('Select a named property or property reference first.');
  }, [openChoices, openPropertyDefinitionFor, propertyForActiveCell, propertyReferenceChoices, selectedSheet]);
  const usageChoices = useCallback((label: string, usages: UsageQueryResult) => {
    if (!usages.available) return [{ id: `${label}:unavailable`, label: 'Unavailable', group: label, unavailable: 'The selected target is unavailable.', run: () => {} }];
    const entries = (title: string, targets: readonly CellTarget[]) => targets.map((target) => {
      const sheet = findSheetById(workbook, target.sheetId);
      const column = sheet ? modelColumnPresentation(sheet, workbook.dataModels).columnLabels.get(target.cell.columnId) : undefined;
      const row = sheet ? sheet.content.rows.indexOf(target.cell.rowId) + 1 : 0;
      return {
      id: `${label}:${title}:${target.sheetId}:${target.cell.rowId}:${target.cell.columnId}`, group: `${label} — ${title}`, label: `${sheet?.name ?? 'Deleted sheet'}: ${column ?? 'Column'}${row > 0 ? `, row ${row}` : ''}`,
       run: () => { navigateCellTarget(target); closeCommandPalette(false); },
    }; });
    const choices = entries('Direct usages', usages.directUsages);
    return choices.length ? choices : [{ id: `${label}:empty`, label: 'No results', group: label, unavailable: 'No direct usages.', run: () => {} }];
  }, [closeCommandPalette, navigateCellTarget, workbook]);
  const openUsages = useCallback(() => {
    if (!activeCell) { setNavigationFeedback('Select a cell or named property first.'); return; }
    const property = propertyForActiveCell();
    const query = usageQueries(workbook);
    const cell = usageChoices('Cell usages', query.forCell(activeCell));
    const propertyChoices = property && selectedSheet?.modelId
      ? usageChoices(`Model property usages: ${property.name}`, query.forProperty({ modelId: selectedSheet.modelId, propertyId: property.id })) : [];
    openChoices([...cell, ...propertyChoices]);
  }, [activeCell, openChoices, propertyForActiveCell, selectedSheet, usageChoices, workbook]);
  const navigableReferencesForFollow = useCallback(() => {
    const raw = editingCell?.draft ?? selectedRaw;
    const inspection = selectedSheet && raw ? inspectFormula(raw, workbook, selectedSheet) : undefined;
    const caret = editingCell?.selection?.start;
    return navigableReferencesAtCaret(inspection, caret);
  }, [editingCell, selectedRaw, selectedSheet, workbook]);
  const openReferenceChoices = useCallback(() => {
    const choices = navigableReferencesForFollow();
    if (choices.length === 0) { setNavigationFeedback('No resolvable reference is available.'); return; }
    if (choices.length === 1) {
      if (navigateReference(choices[0]!) && commandPaletteOpen) closeCommandPalette(false);
      return;
    }
    openChoices(choices.map((reference, index) => ({ id: `reference:${index}`, label: `Follow reference: ${reference.text}`, run: () => { if (navigateReference(reference)) closeCommandPalette(false); } })));
  }, [closeCommandPalette, commandPaletteOpen, navigateReference, navigableReferencesForFollow, openChoices]);
  openUsagesRef.current = openUsages;
  openReferenceChoicesRef.current = openReferenceChoices;
  openPropertyDefinitionRef.current = openPropertyDefinition;
  const openSheetChoices = useCallback(() => {
    openChoices(sheets.map((sheet) => {
      const first = cellIdentityAt(sheet.content, { columnIndex: 0, rowIndex: 0 });
      return {
        id: `sheet:${sheet.id}`,
        group: 'Sheets',
        label: sheet.name,
        run: () => {
          const remembered = onActivateSheet(sheet.id, false);
          if (remembered) navigateCellTarget(remembered);
          else if (first) navigateCellTarget({ sheetId: sheet.id, cell: first });
          else navigateEmptySheet(sheet);
          closeCommandPalette(false);
        },
      };
    }));
  }, [closeCommandPalette, navigateCellTarget, navigateEmptySheet, onActivateSheet, openChoices, sheets]);
  const openColumnChoices = useCallback(() => {
    if (!selectedSheet || selectedSheet.content.columns.length === 0) return;
    const labels = modelColumnPresentation(selectedSheet, workbook.dataModels).columnLabels;
    openChoices(selectedSheet.content.columns.map((columnId, index) => ({
      id: `column:${columnId}`,
      label: labels.get(columnId) ?? columnIndexToLabel(index),
      group: 'Columns',
      run: () => {
        const rowId = activeCell && selectedSheet.content.rows.includes(activeCell.cell.rowId) ? activeCell.cell.rowId : selectedSheet.content.rows[0];
        if (columnId && rowId) { navigateCellTarget({ sheetId: selectedSheet.id, cell: { rowId, columnId } }); closeCommandPalette(false); }
      },
    })));
  }, [activeCell, closeCommandPalette, navigateCellTarget, openChoices, selectedSheet, workbook.dataModels]);
  const paletteCommands = useMemo<NavigationCommand[]>(() => {
    const result: NavigationCommand[] = [];
    result.unshift({ id: 'row', label: 'Go to row…', shortcut: 'Alt+Shift+R', unavailable: selectedSheet?.content.rows.length ? undefined : 'No current sheet rows', run: () => {
      setPaletteChoices(null);
      setRowPickerOpen(true);
      setPaletteView((view) => view + 1);
      setCommandPaletteOpen(true);
    } });
    result.unshift({ id: 'column', label: 'Go to column…', shortcut: 'Alt+Shift+C', unavailable: selectedSheet?.content.columns.length && selectedSheet.content.rows.length ? undefined : 'No current sheet columns', run: openColumnChoices });
    result.unshift({ id: 'definition', label: 'Go to property definition', shortcut: 'Alt+Shift+D', unavailable: propertyForActiveCell() || propertyReferenceChoices().length ? undefined : 'Select a named property or property reference first', run: openPropertyDefinition });
    result.unshift({ id: 'sheet', label: 'Go to sheet…', shortcut: 'Alt+Shift+S', unavailable: sheets.length ? undefined : 'No sheets available', run: openSheetChoices });
    result.unshift({ id: 'reference', label: 'Follow reference', shortcut: 'Alt+Enter', unavailable: navigableReferencesForFollow().length ? undefined : 'No resolvable reference', run: openReferenceChoices });
    result.unshift({ id: 'usages', label: 'Find usages', shortcut: 'Alt+Shift+U', unavailable: activeCell ? undefined : 'Select a cell first', run: openUsages });
    return result;
  }, [activeCell, navigableReferencesForFollow, openColumnChoices, openPropertyDefinition, openReferenceChoices, openSheetChoices, openUsages, propertyForActiveCell, propertyReferenceChoices, selectedSheet, sheets]);
  runPaletteCommandRef.current = (id) => {
    const command = paletteCommands.find((candidate) => candidate.id === id);
    if (command && !command.unavailable) command.run();
  };
  const {
    cancelSheetFrameDrag,
    cancelSheetFrameResize,
    frameLayoutPreview,
    frameScalePreview,
    handleSheetFrameDragMove,
    handleSheetFrameDragStart,
    handleSheetFrameResizeMove,
    handleSheetFrameResizeStart,
    interactionPinnedSheetId,
    stopSheetFrameDrag,
    stopSheetFrameResize,
  } = useSheetFrameInteractions({
    commands,
    interactionsEnabled,
    viewportScale: workspaceController.viewport.scale,
    workbook,
  });
  const gridFocus = useGridFocusLease({
    activeCell, keyboardFocusRequest, onKeyboardFocusRequestCancelled,
    onKeyboardFocusRequestConsumed, onRestoreGridFocus,
    interactionPinnedSheetId: interactionPinnedSheetId ?? undefined, sheetIds: sheets.map((sheet) => sheet.id),
  });
  const { beginPendingGridFocus, gridFocusLease, handleDetailedBodyAvailable,
    handleDetailedFocusDisplaced, handleDetailedNativeFocus,
    handleDetailedNativeFocusReleased, handleKeyboardFocusRequestConsumed, pinsFocusedFrame } = gridFocus;
  const projectedFrames = sheets.map((sheet) => {
    const frame = frameProjection(sheet);
    const layout = frameLayoutPreview?.sheetId === sheet.id
      ? { ...frame, position: frameLayoutPreview.position, size: frameLayoutPreview.size }
      : frame;
    return frameScalePreview?.sheetId === sheet.id
      ? { ...layout, position: frameScalePreview.position, visualScale: frameScalePreview.visualScale }
      : layout;
  });
  const projectedFramesById = new Map(projectedFrames.map((frame) => [frame.id, frame]));
  const referenceSurfaceSize = useMemo(() => workspaceController.workspaceSurfaceSize ?? { width: 0, height: 0 }, [workspaceController.workspaceSurfaceSize]);
  const frameVisibilityOptions = {
    frames: projectedFrames,
    pins: {
      editingSheetId: editingCell?.target.sheetId,
      gridInteractionSheetIds,
      interactionSheetId: interactionPinnedSheetId,
      pendingFocusSheetId: pinsFocusedFrame(gridFocusLease) ? gridFocusLease?.sheetId : undefined,
      referenceSheetId: referenceSelection?.kind === 'cell' ? referenceSelection.target.sheetId : referenceSelection?.sheetId,
      historySheetIds: [pendingNavigationSheetId, selectionTransition?.from.sheetId, ...(contentHistoryFeedback?.after.map((cell) => cell.sheetId) ?? [])].filter((id): id is string => Boolean(id)),
    },
    surfaceSize: workspaceController.workspaceSurfaceSize,
  };
  const mountedSheetIds = mountedWorkspaceFrameIds({ ...frameVisibilityOptions, viewport: workspaceController.displayedViewport });
  panViewportNeedsRender.current = (viewport) => {
    const next = mountedWorkspaceFrameIds({ ...frameVisibilityOptions, viewport });
    return next.size !== mountedSheetIds.size || [...next].some((id) => !mountedSheetIds.has(id));
  };
  const reportReferenceViewport = useCallback((sheetId: string, viewport: { scrollLeft: number; scrollTop: number; width: number; height: number } | null) => {
    setReferenceGridViewports((current) => {
      if (!viewport) {
        if (!current[sheetId]) return current;
        const next = { ...current }; delete next[sheetId]; return next;
      }
      const nextViewport: GridReferenceViewport = { ...viewport, size: { width: viewport.width, height: viewport.height }, mounted: true, renderingMode: 'detailed' };
      const previous = current[sheetId];
      return previous?.scrollLeft === nextViewport.scrollLeft && previous?.scrollTop === nextViewport.scrollTop && previous.size.width === nextViewport.size.width && previous.size.height === nextViewport.size.height && previous.renderingMode === 'detailed'
        ? current : { ...current, [sheetId]: nextViewport };
    });
  }, []);
  const reportReferenceRenderingMode = useCallback((sheetId: string, renderingMode: 'detailed' | 'overview') => {
    if (renderingMode === 'detailed') return;
    setReferenceGridViewports((current) => current[sheetId]?.renderingMode === renderingMode ? current : { ...current, [sheetId]: { scrollLeft: 0, scrollTop: 0, size: { width: 0, height: 0 }, mounted: true, renderingMode } });
  }, []);
  const contextualReferenceItems = useMemo(() => formulaInspection ? contextualReferences(formulaInspection.references).map((contextual) => ({
    contextual,
    geometry: projectReferenceGeometry({ reference: contextual.reference, workbook, frames: projectedFrames, gridViewports: referenceGridViewports, workspaceViewport: workspaceController.viewport, surfaceSize: referenceSurfaceSize }),
  })) : [], [formulaInspection, projectedFrames, referenceGridViewports, workbook, workspaceController.viewport, referenceSurfaceSize]);
  const formulaReferenceColors = useMemo(() => new Map(contextualReferenceItems.flatMap(({ contextual }) => (
    contextual.color ? [[contextual.reference.sourceSpan.start, contextual.color] as const] : []
  ))), [contextualReferenceItems]);
  const contextualSourceGeometry = useMemo(() => {
    if (!activeCell || !selectedSheet || !formulaInspection) return { kind: 'unavailable' as const, reason: 'broken' as const };
    const identity = cellIdentityAt(selectedSheet.content, cellKeyForTarget(selectedSheet, activeCell) ?? '');
    if (!identity) return { kind: 'unavailable' as const, reason: 'broken' as const };
    return projectReferenceGeometry({ reference: { kind: 'reference', text: '', sourceSpan: { start: 0, end: 0 }, displaySpan: { start: 0, end: 0 }, target: { kind: 'cell', sheetId: selectedSheet.id, identity }, broken: false, navigable: true }, workbook, frames: projectedFrames, gridViewports: referenceGridViewports, workspaceViewport: workspaceController.viewport, surfaceSize: referenceSurfaceSize });
  }, [activeCell, formulaInspection, projectedFrames, referenceGridViewports, referenceSurfaceSize, selectedSheet, workbook, workspaceController.viewport]);
  const handleGridPointerInteractionChange = useCallback((sheetId: string, active: boolean) => {
    setGridInteractionSheetIds((current) => {
      if (current.has(sheetId) === active) return current;
      const next = new Set(current);
      if (active) next.add(sheetId);
      else next.delete(sheetId);
      return next;
    });
  }, []);
  function handleOpenRenameDialog(sheet: SheetDocument) {
    workspaceController.closeSheetMenu();
    onOpenRenameDialog(sheet);
  }
  const menuSheet = workspaceController.pendingSheetMenu
    ? sheets.find((sheet) => sheet.id === workspaceController.pendingSheetMenu!.sheetId)
    : undefined;
  function copyGridSelection() {
    const selection = selectionRange ?? (activeCell
      ? { mode: 'cells' as const, anchor: activeCell, extent: activeCell }
      : undefined);
    if (!selection) return undefined;
    const hadPendingCut = clipboard.current.pendingCutSource !== undefined;
    const copied = clipboard.current.copy(workbook, selection);
    if (hadPendingCut && !clipboard.current.pendingCutSource) setClipboardRevision((revision) => revision + 1);
    return copied.ok ? copied.value : undefined;
  }
  function cutGridSelection() {
    const selection = selectionRange ?? (activeCell
      ? { mode: 'cells' as const, anchor: activeCell, extent: activeCell }
      : undefined);
    if (!selection) return undefined;
    if (selectionIncludesCalculatedColumn(workbook, selection)) {
      cancelPendingCut();
      setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
      return undefined;
    }
    const cut = clipboard.current.cut(workbook, selection);
    if (cut.ok) setClipboardRevision((revision) => revision + 1);
    return cut.ok ? cut.value : undefined;
  }
  function cancelPendingCut() {
    clipboard.current.cancelCut();
    setClipboardRevision((revision) => revision + 1);
  }
  function pasteGridSelection(clipboardData: { text: string; marker?: string }) {
    if (!activeCell) return;
    const destination = findSheetById(workbook, activeCell.sheetId);
    const destinationKey = destination && cellKeyForTarget(destination, activeCell);
    if (!destination || !destinationKey) return;
    const hadPendingCut = clipboard.current.pendingCutSource !== undefined;
    const parsed = clipboard.current.parse(workbook, clipboardData);
    if (hadPendingCut && !clipboard.current.pendingCutSource) setClipboardRevision((revision) => revision + 1);
    if (parsed.ok && parsed.value.kind === 'cut') {
      const moved = commands.moveCells(destination.id, destinationKey, parsed.value.source);
      if (moved.ok || moved.reason === 'stale-move-source' || moved.reason === 'invalid-move-source' || moved.reason === 'calculated-cell-write') cancelPendingCut();
      if (!moved.ok && moved.reason === 'calculated-cell-write') setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
    } else {
      const pasted = commands.pasteCells(destination.id, destinationKey, parsed);
      if (!pasted.ok && pasted.reason === 'calculated-cell-write') setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
    }
  }
  /** Reports a rejected content write instead of leaving the user without a reason. */
  function reportWriteOutcome(outcome: CellWriteResult | undefined) {
    if (outcome && !outcome.ok && outcome.reason === 'calculated-cell-write') {
      setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
    }
  }
  return (
    <>
      <WorkspaceToolbar
        referencesVisible={referenceLinksVisible}
        formatControls={<NumberFormatControls
            disabled={!interactionsEnabled}
            onWrite={(writes) => {
              if (!selectedSheet || writes.length === 0) return;
              commands.writeNumberFormats(selectedSheet.id, writes);
              onRestoreGridFocus();
            }}
            projection={formattingProjection}
            selection={selectionRange}
          />}
        onCreateSheet={workspaceController.createSheetAtViewportCenter}
        canGoBack={navigationHistory.canGoBack}
        canGoForward={navigationHistory.canGoForward}
        onGoBack={() => navigationHistory.traverse('back')}
        onGoForward={() => navigationHistory.traverse('forward')}
        onOpenDataModels={onOpenDataModels}
        onOpenCommandPalette={() => { paletteInvoker.current = document.activeElement as HTMLElement; setCommandPaletteOpen(true); }}
        onToggleReferences={() => setReferenceLinksVisible((visible) => !visible)}
        onRetryFailedSaves={onRetryFailedSaves}
        saveStatus={saveStatus}
        canRetryFailedSaves={canRetryFailedSaves}
      />
      {calculatedCellFeedback ? <p className="form-error" role="alert">{calculatedCellFeedback}</p> : null}
      {navigationFeedback ? <p className="form-error" role="alert">{navigationFeedback}</p> : null}
       {commandPaletteOpen ? <NavigationPalette key={paletteView} commands={paletteChoices ?? paletteCommands} onClose={closeCommandPalette} rowPicker={rowPickerOpen && selectedSheet ? {
         sheetName: selectedSheet.name,
         rowCount: selectedSheet.content.rows.length,
         onNavigate: (row) => {
           const columnId = activeCell && selectedSheet.content.columns.includes(activeCell.cell.columnId) ? activeCell.cell.columnId : selectedSheet.content.columns[0];
           const rowId = selectedSheet.content.rows[row - 1];
           if (columnId && rowId) { navigateCellTarget({ sheetId: selectedSheet.id, cell: { rowId, columnId } }); closeCommandPalette(false); }
         },
       } : undefined} /> : null}
      <WorkspaceSurface
        contextMenu={workspaceController.pendingSheetMenu && menuSheet ? (
          <SheetContextMenu
            key={menuSheet.id}
            menu={workspaceController.pendingSheetMenu}
            modelControls={<SheetModelControls key={menuSheet.id} models={dataModels} onBind={commands.bindSheetToModel} onOpenDataModels={(modelId) => { workspaceController.closeSheetMenu(); onOpenDataModels?.(modelId); }} onUnbind={commands.unbindSheetFromModel} sheet={menuSheet} />}
            onAppendColumn={(sheetId) => {
              workspaceController.closeSheetMenu();
              commands.appendColumn(sheetId);
            }}
            onAppendRow={(sheetId) => {
              workspaceController.closeSheetMenu();
              commands.appendRow(sheetId);
            }}
            onChangeZOrder={(sheetId, direction) => {
              workspaceController.closeSheetMenu();
              commands.changeSheetZOrder(sheetId, direction);
            }}
            onDelete={(sheetId) => {
              workspaceController.closeSheetMenu();
              if (editingCell?.target.sheetId === sheetId) onCancelEdit();
              commands.deleteSheet(sheetId);
            }}
            onRename={handleOpenRenameDialog}
            onSetScale={(sheetId, visualScale) => {
              workspaceController.closeSheetMenu();
              commands.setSheetVisualScale(sheetId, visualScale);
            }}
            sheet={menuSheet}
          />
        ) : undefined}
        hasSheets={sheets.length + creatingFrames.length > 0}
        isPanningWorkspace={workspaceController.isPanningWorkspace}
        navigationMotion={(navigationMotion || workspaceController.navigationMotion) && !workspaceController.navigationInterrupted && !workspaceController.isPanningWorkspace}
        onCreateSheet={workspaceController.createSheetAtViewportCenter}
        onContextMenu={workspaceController.handleWorkspaceContextMenu}
        overlay={(
          <>
            {formulaInspection ? <ContextualReferenceLinks editorActive={Boolean(editingCell)} hoveredSourceSpan={hoveredReferenceSpan} pulseSourceSpan={modifierReferenceSpan} onNavigate={navigateReference} references={contextualReferenceItems} source={contextualSourceGeometry} surfaceSize={referenceSurfaceSize} visible={referenceLinksVisible} /> : null}
          </>
        )}
        viewport={workspaceController.viewport}
        workspaceSurfaceRef={workspaceController.workspaceSurfaceRef}
        workspacePlaneRef={workspaceController.workspacePlaneRef}
      >
        {sheets.map((sheet) => {
          if (!mountedSheetIds.has(sheet.id)) return null;
          const frame = projectedFramesById.get(sheet.id)!;
          const tabular = tabularProjection(sheet);
          const { calculatedColumnIds, columnLabels } = modelColumnPresentation(sheet, workbook.dataModels);
          const creatingSheetAxes = creatingAxes[sheet.id];
          const sheetEditingCell = editingCell?.target.sheetId === sheet.id ? editingCell : null;
          const formulaResolver = workbookFormulaReferenceResolver(workbook, sheet.id);
          const selectedRange = selectionRange?.anchor.sheetId === sheet.id
            ? selectionAddressRange(sheet, selectionRange)
            : referenceSelection?.kind === 'range'
            && referenceSelection.sheetId === sheet.id
            ? addressRangeOf(sheet.content, referenceSelection.range)
            : undefined;
          const highlightTarget = navigationHighlight?.kind === 'cell'
            ? navigationHighlight.target
            : null;
          const navigationHighlightRange = navigationHighlight?.kind === 'range'
            && navigationHighlight.sheetId === sheet.id
            ? addressRangeOf(sheet.content, navigationHighlight.range)
            : undefined;
          const navigationRequest = navigationRequestForSheet(sheet.id);
          const navigationRequestTarget = navigationRequest?.target.kind === 'cell'
            ? navigationRequest.target.target
            : null;
          const navigationRequestRange = navigationRequest?.target.kind === 'range'
            ? addressRangeOf(sheet.content, navigationRequest.target.range)
            : undefined;
          const historyFeedbackCells = contentHistoryFeedback
            ? historyCellsForSheet(contentHistoryFeedback, sheet)
            : undefined;
          const pendingCutCells = clipboard.current.pendingCutSource?.sheetId === sheet.id
            ? new Set(clipboard.current.pendingCutSource.cells.flatMap((row) => row.map((cell) => {
                const address = cellAddressOf(sheet.content, cell.identity);
                return address && cellKey(address);
              })).filter((key): key is string => Boolean(key)))
            : undefined;
          return (
            <SheetFrame
              columnCount={tabular.columns.length + (creatingSheetAxes?.columns.length ?? 0)}
              frame={frame}
              isActiveSheet={activeCell?.sheetId === sheet.id}
              isNavigationReveal={navigationHighlight?.kind === 'cell'
                ? navigationHighlight.target.sheetId === sheet.id
                : navigationHighlight?.sheetId === sheet.id}
              retainDetailedBody={Boolean(
                sheetEditingCell
                || interactionPinnedSheetId === sheet.id
                || gridInteractionSheetIds.has(sheet.id)
                || (gridFocusLease?.phase === 'request-active' && gridFocusLease.sheetId === sheet.id),
              )}
              onDetailedFocusDisplaced={() => handleDetailedFocusDisplaced(sheet.id)}
              onDetailedBodyAvailable={() => handleDetailedBodyAvailable(sheet.id)}
              onDetailedNativeFocusReleased={() => handleDetailedNativeFocusReleased(sheet.id)}
              onRenderingModeChange={reportReferenceRenderingMode}
              overview={(
                <SheetOverview
                  isActive={activeCell?.sheetId === sheet.id}
                  onSelect={() => {
                    const target = onActivateSheet(sheet.id, false);
                    if (target) beginPendingGridFocus(target);
                  }}
                  sheet={tabular}
                />
              )}
              key={sheet.id}
              onOpenSheetMenu={workspaceController.openSheetMenu}
              onResizeCancel={cancelSheetFrameResize}
              onResizeMove={handleSheetFrameResizeMove}
              onResizeStart={handleSheetFrameResizeStart}
              onResizeStop={stopSheetFrameResize}
              onSheetFrameDragCancel={cancelSheetFrameDrag}
              onSheetFrameInteraction={workspaceController.closeSheetMenu}
              onSheetFrameDragMove={handleSheetFrameDragMove}
              onSheetFrameDragStart={handleSheetFrameDragStart}
              onSheetFrameDragStop={stopSheetFrameDrag}
              onSelectSheet={() => { onActivateSheet(sheet.id); }}
              rowCount={tabular.rows.length + (creatingSheetAxes?.rows.length ?? 0)}
              viewportScale={workspaceController.viewport.scale}
            >
              {(scrollContainerRef) => {
                const axisProjection = projectGridAxes(tabular, creatingSheetAxes);
                return (
                  <SheetGrid
                    interactionsEnabled={interactionsEnabled}
                    activeCellKey={cellKeyForTarget(sheet, activeCell)}
                    selectionTransition={selectionTransition}
                    activeSheetId={activeCell?.sheetId ?? null}
                    selectionOwner={selectionOwner}
                    axisProjection={axisProjection}
                    presentation={sheet.presentation}
                    pendingCutCells={pendingCutCells}
                    columnLabels={columnLabels}
                    calculatedColumnIds={calculatedColumnIds}
                    logicalSelection={selectionRange}
                    onWriteAxisSizes={(writes) => commands.writeAxisSizes(sheet.id, writes)}
                    onPointerInteractionChange={handleGridPointerInteractionChange}
                    onScrollContainerAvailable={(element) => registerScrollContainer(sheet.id, element)}
                    onReferenceViewport={reportReferenceViewport}
                    onUserViewportMovement={recordUserGridMovement}
                    historyRestore={historyRestoreForSheet(sheet.id)}
                    navigationRestoreGeneration={navigationRequest ? undefined : navigationRestoreForSheet(sheet.id)}
                    navigationRequestGeneration={navigationRequest?.generation}
                    navigationRequestCellKey={cellKeyForTarget(sheet, navigationRequestTarget)}
                    navigationRequestRange={navigationRequestRange}
                    onNavigationSettled={(generation) => acknowledgeGridRestore(sheet.id, generation)}
                    onNativeFocusTarget={handleDetailedNativeFocus}
                    cellInteraction={{
                      clear: (target) => reportWriteOutcome(onClearCell(target)),
                      navigate: onNavigateCell,
                      navigateKeyboard: onNavigateKeyboardCell,
                      select: onSelectCell,
                      extend: onExtendSelection,
                      focusSelection: onFocusSelection,
                      settleSelectionGesture: onSettleSelectionGesture,
                      startEditing: onStartEdit,
                    }}
                    editingCell={sheetEditingCell}
                    editorInteraction={{
                      cancel: onCancelEdit,
                      commit: (session, restoreFocus) => {
                        const outcome = onCommitEdit(session);
                        reportWriteOutcome(outcome);
                        if (restoreFocus && (!outcome || outcome.ok)) onRestoreGridFocus();
                      },
                      commitAndNavigate: (session, request) => reportWriteOutcome(onCommitEditAndNavigate(session, request)),
                      suspend: onSuspendEdit, updateValue: onEditValueChange, updateView: onUpdateEditView,
                      formulaContext: {
                        resolver: formulaResolver,
                        sheetNames: sheets.map((entry) => entry.name),
                        propertyNames: sheet.modelId ? workbook.dataModels?.[sheet.modelId]?.columns.map((property) => property.name) : [],
                        referenceValues: (identity) => formulaPanelReferenceValues(identity, formulaResolver, formulaResults),
                        inspectionReferences: sheetEditingCell ? formulaInspection?.references : undefined,
                        referenceColors: formulaReferenceColors,
                        onReferenceHover: setHoveredReferenceSpan,
                        onReferenceModifierHover: setModifierReferenceSpan,
                        onReferenceNavigate: navigateReference,
                      },
                    }}
                    formulaResults={formulaResults}
                    keyboardFocusRequest={keyboardFocusRequest?.target.sheetId === sheet.id
                      ? {
                          id: keyboardFocusRequest.id,
                          targetKey: cellKeyForTarget(sheet, keyboardFocusRequest.target),
                        }
                      : null}
                    onKeyboardFocusRequestConsumed={handleKeyboardFocusRequestConsumed}
                    navigationHighlightCellKey={cellKeyForTarget(sheet, highlightTarget)}
                    navigationHighlightRange={navigationHighlightRange}
                    navigationHighlightIdentity={navigationHighlightIdentity}
                    historyFeedbackCells={historyFeedbackCells}
                    historyFeedbackIdentity={gridHistoryReveals.current.identity === contentHistoryFeedback?.identity
                      && gridHistoryReveals.current.sheetIds.has(sheet.id)
                      ? undefined : contentHistoryFeedback?.identity}
                    onHistoryRevealConsumed={handleHistoryRevealConsumed}
                    scrollContainerRef={scrollContainerRef}
                    selectedRange={selectedRange}
                    selectionMode={selectionRange?.anchor.sheetId === sheet.id ? selectionRange.mode : undefined}
                    onSelectAxis={onSelectAxis}
                    clipboardInteraction={{ copy: copyGridSelection, cut: cutGridSelection, paste: pasteGridSelection, cancelCut: cancelPendingCut }}
                    sheet={tabular}
                  />
                );
              }}
            </SheetFrame>
          );
        })}
        {creatingFrames.map((frame) => <CreatingSheetFrame frame={frame} key={frame.operationKey} />)}
      </WorkspaceSurface>
    </>
  );
}
