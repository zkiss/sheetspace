import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { SheetDocument, Workbook, WorkspacePosition } from '@workbook/core/model';
import { cellKey, type CellRange } from '@workbook/core/address';
import { addressRangeOf, cellAddressOf } from '@workbook/core/cellIdentity';
import { cellRawContent, findSheetById, frameProjection, sheetsInOrder, tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from '@grid/gridAxisProjection';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import type {
  SelectionGesture,
  CellTarget,
  CellNavigationDirection,
  CellEditSession,
  CellSelection,
  CellSelectionMode,
  ReferenceNavigationTarget,
} from '@grid/cellInteractionContracts';
import type { SaveStatus } from '@application/core/state';
import { cellKeyForTarget, type CellFocusRequest } from '@grid/cellInteraction';
import { FormulaReferenceInspection } from '@reference-navigation/FormulaReferenceInspection';
import { inspectFormula } from '@reference-navigation/formulaInspection';
import { SheetContextMenu } from '@workspace/SheetContextMenu';
import { SheetFrame } from '@workspace/SheetFrame';
import { SheetOverview } from '@workspace/SheetOverview';
import { CreatingSheetFrame } from '@workspace/CreatingSheetFrame';
import type { CreatingSheetFrame as CreatingSheetFrameState } from '@application/core/sheetCreationState';
import { SheetGrid } from '@grid/SheetGrid';
import { useReferenceNavigation } from '@reference-navigation/useReferenceNavigation';
import { useSheetFrameInteractions } from '@workspace/useSheetFrameInteractions';
import type { WorkbookCommands } from '@application/react/useWorkbookController';
import { useWorkspaceController } from '@workspace/useWorkspaceController';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';
import { WorkspaceToolbar } from '@workspace/WorkspaceToolbar';
import {
  NumberFormatControls,
  selectionAppearanceControlState,
  selectionAppearanceWrites,
  selectionFormatControlState,
  selectionFormatWrites,
} from '@workspace/NumberFormatControls';
import { GENERAL_NUMBER_FORMAT } from '@workbook/core/numberFormat';
import { mountedWorkspaceFrameIds } from '@workspace/workspaceFrameVirtualization';
import {
  workspaceRectForFrame,
  workspaceRectsIntersect,
  workspaceViewportBounds,
} from '@workspace/workspaceGeometry';
import { ClipboardPayloadStore } from '@grid/clipboardPayload';
import {
  activeFocusRequestId,
  pinsFocusedFrame,
  reduceGridFocusLease,
  type GridFocusLease,
  type GridFocusLeaseAction,
} from './gridFocusLease';

export function Workspace({
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
  onCreateSheet,
  onEditValueChange,
  onNavigateCell,
  onNavigateKeyboardCell,
  onOpenRenameDialog,
  onRetryFailedSaves,
  onSelectCell,
  onExtendSelection,
  onFocusSelection,
  onSettleSelectionGesture,
  onRestoreGridFocus,
  onSelectAxis,
  onSelectReferenceTarget,
  onStartEdit,
  referenceSelection,
  selectionRange,
  selectionOwner,
  saveStatus,
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
  onClearCell: (target: CellTarget) => void;
  onClearSelection: () => void;
  onActivateSheet: (sheetId: string, requestFocus?: boolean) => CellTarget | undefined;
  onCommitEdit: (session?: CellEditSession) => void;
  onCommitEditAndNavigate: (session: CellEditSession, request: Pick<import('@grid/cellInteractionContracts').CellNavigationRequest, 'key' | 'shift'>) => void;
  onCreateSheet: (position: WorkspacePosition, viewportScale: number, label: string) => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onNavigateKeyboardCell: (target: CellTarget, request: import('@grid/cellInteractionContracts').CellNavigationRequest) => boolean;
  onOpenRenameDialog: (sheet: SheetDocument) => void;
  onRetryFailedSaves: () => void;
  onSelectCell: (target: CellTarget, gesture?: SelectionGesture) => void;
  onExtendSelection: (target: CellTarget, gesture?: SelectionGesture) => void;
  onFocusSelection: (target: CellTarget, gesture?: SelectionGesture) => void;
  onSettleSelectionGesture: (owner: symbol) => void;
  onRestoreGridFocus: () => number | null;
  onSelectAxis: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture) => void;
  onSelectReferenceTarget: (target: ReferenceNavigationTarget) => void;
  onStartEdit: (target: CellTarget, initialValue?: string) => void;
  referenceSelection: ReferenceNavigationTarget | null;
  selectionRange: CellSelection | null;
  selectionOwner?: symbol | null;
  saveStatus: SaveStatus;
  creatingFrames: CreatingSheetFrameState[];
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>;
  workbook: Workbook;
}) {
  const clipboard = useRef(new ClipboardPayloadStore());
  const [, setClipboardRevision] = useState(0);
  const [gridInteractionSheetIds, setGridInteractionSheetIds] = useState<ReadonlySet<string>>(() => new Set());
  const [gridFocusLease, setGridFocusLease] = useState<GridFocusLease | null>(null);
  const gridFocusLeaseRef = useRef<GridFocusLease | null>(null);
  const nextGridFocusToken = useRef(1);
  const revealedHistoryIdentity = useRef<string | undefined>(undefined);
  const dispatchGridFocusLease = useCallback((action: GridFocusLeaseAction) => {
    const next = reduceGridFocusLease(gridFocusLeaseRef.current, action);
    gridFocusLeaseRef.current = next;
    setGridFocusLease(next);
  }, []);
  const beginPendingGridFocus = useCallback((target: CellTarget) => {
    dispatchGridFocusLease({ type: 'await-detail', token: nextGridFocusToken.current++, target });
  }, [dispatchGridFocusLease]);
  const endGridFocusLease = useCallback(() => {
    const requestId = activeFocusRequestId(gridFocusLeaseRef.current);
    if (requestId !== null) {
      onKeyboardFocusRequestCancelled(requestId);
      dispatchGridFocusLease({ type: 'cancel-request', requestId });
    } else dispatchGridFocusLease({ type: 'external-focus' });
  }, [dispatchGridFocusLease, onKeyboardFocusRequestCancelled]);
  useEffect(() => {
    function handleFocusIn(event: FocusEvent) {
      const lease = gridFocusLeaseRef.current;
      const pendingSheetId = lease?.sheetId;
      const focusOwner = event.target;
      if (!pendingSheetId || !(focusOwner instanceof Element)) return;
      // Losing focus to body while a frame unmounts does not establish a new
      // owner. A subsequent focusin identifies an intentional external owner.
      if (focusOwner === document.body || focusOwner === document.documentElement) return;
      const frame = focusOwner.closest<HTMLElement>('article.sheet-frame[data-sheet-id]');
      if (frame?.dataset.sheetId !== pendingSheetId) endGridFocusLease();
    }

    document.addEventListener('focusin', handleFocusIn, true);
    return () => document.removeEventListener('focusin', handleFocusIn, true);
  }, [endGridFocusLease]);
  useLayoutEffect(() => {
    if (!keyboardFocusRequest) return;
    dispatchGridFocusLease({
      type: 'adopt-request',
      token: nextGridFocusToken.current++,
      requestId: keyboardFocusRequest.id,
      target: keyboardFocusRequest.target,
    });
  }, [dispatchGridFocusLease, keyboardFocusRequest]);
  const sheets = sheetsInOrder(workbook);
  useEffect(() => {
    const lease = gridFocusLeaseRef.current;
    if (lease && !sheets.some((sheet) => sheet.id === lease.sheetId)) {
      endGridFocusLease();
    }
  }, [endGridFocusLease, sheets]);
  const selectedSheet = activeCell ? findSheetById(workbook, activeCell.sheetId) : undefined;
  const selectedCellKey = selectedSheet ? cellKeyForTarget(selectedSheet, activeCell) : null;
  const selectedRaw = selectedSheet && selectedCellKey
    ? cellRawContent(selectedSheet, selectedCellKey)
    : undefined;
  const formulaInspection = selectedSheet && selectedRaw
    ? inspectFormula(selectedRaw, workbook, selectedSheet)
    : undefined;
  const workspaceController = useWorkspaceController({ onClearSelection, onCreateSheet });
  useEffect(() => {
    function writeFormat(write: () => readonly import('@workbook/core/model').FormatWrite[]) {
      if (!selectedSheet || !selectionRange || editingCell) return;
      const writes = write();
      if (writes.length === 0) return;
      commands.writeNumberFormats(selectedSheet.id, writes);
      onRestoreGridFocus();
    }

    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('textarea, input, select, [contenteditable="true"]') || event.defaultPrevented) return;
      const key = event.shiftKey && /^Digit[015]$/.test(event.code)
        ? event.code.slice(-1)
        : event.key.toLowerCase();
      const primaryModifier = event.ctrlKey || event.metaKey;
      if (!primaryModifier && event.shiftKey && !event.altKey && key === 'n') {
        event.preventDefault();
        workspaceController.createSheetAtViewportCenter();
        return;
      }
      if (!primaryModifier || event.altKey) return;

      if (key === 'b' && !event.shiftKey) {
        event.preventDefault();
        const appearance = selectionAppearanceControlState(selectedSheet, selectionRange);
        writeFormat(() => selectionAppearanceWrites(selectedSheet, selectionRange, {
          fontWeight: appearance.fontWeight.value === 'bold' ? 'normal' : 'bold',
        }));
        return;
      }

      if (!event.shiftKey) return;
      if (key === 'e' || key === 'l' || key === 'r') {
        event.preventDefault();
        writeFormat(() => selectionAppearanceWrites(selectedSheet, selectionRange, {
          horizontalAlignment: key === 'e' ? 'center' : key === 'l' ? 'left' : 'right',
        }));
        return;
      }
      if (key === '0') {
        event.preventDefault();
        writeFormat(() => selectionFormatWrites(selectedSheet, selectionRange, GENERAL_NUMBER_FORMAT));
        return;
      }
      if (key === '1' || key === '5') {
        event.preventDefault();
        const format = selectionFormatControlState(selectedSheet, selectionRange).format;
        const kind = key === '1' ? 'number' : 'percent';
        writeFormat(() => selectionFormatWrites(selectedSheet, selectionRange, {
          kind,
          precision: format?.kind === kind ? format.precision : kind === 'number' ? 2 : 0,
        }));
      }
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [commands, editingCell, onRestoreGridFocus, selectedSheet, selectionRange, workspaceController]);
  useEffect(() => {
    if (!contentHistoryFeedback || editingCell) return;
    const destination = sheets.find((sheet) => contentHistoryFeedback.after.some((cell) => cell.sheetId === sheet.id));
    if (!destination || !workspaceController.workspaceSurfaceSize) return;
    if (revealedHistoryIdentity.current === contentHistoryFeedback.identity) return;
    revealedHistoryIdentity.current = contentHistoryFeedback.identity;
    const viewportBounds = workspaceViewportBounds(
      workspaceController.workspaceSurfaceSize,
      workspaceController.viewport,
    );
    if (!workspaceRectsIntersect(workspaceRectForFrame(destination.frame), viewportBounds)) {
      workspaceController.navigateToTarget(workspaceRectForFrame(destination.frame));
    }
  }, [
    contentHistoryFeedback?.identity,
    editingCell,
    sheets,
    workspaceController.navigateToTarget,
    workspaceController.viewport,
    workspaceController.workspaceSurfaceSize,
  ]);
  const {
    navigateReference,
    navigationHighlight,
    navigationMotion,
  } = useReferenceNavigation({
    navigateToTarget: workspaceController.navigateToTarget,
    onSelectReferenceTarget,
    workbook,
  });
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
    viewportScale: workspaceController.viewport.scale,
    workbook,
  });
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
  const mountedSheetIds = mountedWorkspaceFrameIds({
    frames: projectedFrames,
    pins: {
      editingSheetId: editingCell?.target.sheetId,
      gridInteractionSheetIds,
      interactionSheetId: interactionPinnedSheetId,
      pendingFocusSheetId: pinsFocusedFrame(gridFocusLease) ? gridFocusLease?.sheetId : undefined,
    },
    surfaceSize: workspaceController.workspaceSurfaceSize,
    viewport: workspaceController.viewport,
  });

  const handleGridPointerInteractionChange = useCallback((sheetId: string, active: boolean) => {
    setGridInteractionSheetIds((current) => {
      if (current.has(sheetId) === active) return current;
      const next = new Set(current);
      if (active) next.add(sheetId);
      else next.delete(sheetId);
      return next;
    });
  }, []);

  const handleDetailedBodyAvailable = useCallback((sheetId: string) => {
    const lease = gridFocusLeaseRef.current;
    if (lease?.sheetId !== sheetId) return;
    if (lease.phase === 'consumed-awaiting-release') {
      dispatchGridFocusLease({ type: 'detailed-release', token: lease.token });
      return;
    }
    if (lease.phase !== 'awaiting-detail' || activeCell?.sheetId !== sheetId) return;
    // A retained grid keeps an in-progress frame control usable, but is not yet
    // the focus destination. Re-evaluate after that control settles.
    if (interactionPinnedSheetId === sheetId) return;
    const requestId = onRestoreGridFocus();
    if (requestId === null) {
      dispatchGridFocusLease({ type: 'external-focus' });
      return;
    }
    dispatchGridFocusLease({ type: 'bind-request', token: lease.token, requestId, target: activeCell });
  }, [activeCell, dispatchGridFocusLease, interactionPinnedSheetId, onRestoreGridFocus]);

  const handleDetailedFocusDisplaced = useCallback((sheetId: string) => {
    const lease = gridFocusLeaseRef.current;
    const target = activeCell?.sheetId === sheetId ? activeCell : lease?.sheetId === sheetId ? lease.target : null;
    if (!target) return;
    dispatchGridFocusLease({
      type: 'detail-displaced',
      observedToken: lease?.sheetId === sheetId ? lease.token : null,
      token: nextGridFocusToken.current++,
      target,
    });
  }, [activeCell, dispatchGridFocusLease]);

  const handleDetailedNativeFocusReleased = useCallback((sheetId: string) => {
    const lease = gridFocusLeaseRef.current;
    if (lease?.sheetId !== sheetId || lease.phase !== 'native-owned') return;
    dispatchGridFocusLease({ type: 'native-blur', token: lease.token });
  }, [dispatchGridFocusLease]);

  const handleDetailedNativeFocus = useCallback((target: CellTarget) => {
    dispatchGridFocusLease({ type: 'native-focus', token: nextGridFocusToken.current++, target });
  }, [dispatchGridFocusLease]);

  const handleKeyboardFocusRequestConsumed = useCallback((requestId: number) => {
    dispatchGridFocusLease({ type: 'consume-request', requestId });
    onKeyboardFocusRequestConsumed(requestId);
  }, [dispatchGridFocusLease, onKeyboardFocusRequestConsumed]);

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
      if (moved.ok || moved.reason === 'stale-move-source' || moved.reason === 'invalid-move-source') cancelPendingCut();
    } else commands.pasteCells(destination.id, destinationKey, parsed);
  }

  return (
    <>
      <WorkspaceToolbar
        formatControls={<NumberFormatControls
            onWrite={(writes) => {
              if (!selectedSheet || writes.length === 0) return;
              commands.writeNumberFormats(selectedSheet.id, writes);
              onRestoreGridFocus();
            }}
            selection={selectionRange}
            sheet={selectedSheet}
          />}
        onCreateSheet={workspaceController.createSheetAtViewportCenter}
        onRetryFailedSaves={onRetryFailedSaves}
        saveStatus={saveStatus}
        canRetryFailedSaves={canRetryFailedSaves}
      />

      <WorkspaceSurface
        contextMenu={workspaceController.pendingSheetMenu && menuSheet ? (
          <SheetContextMenu
            key={menuSheet.id}
            menu={workspaceController.pendingSheetMenu}
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
        navigationMotion={navigationMotion && !workspaceController.navigationInterrupted && !workspaceController.isPanningWorkspace}
        onCreateSheet={workspaceController.createSheetAtViewportCenter}
        onContextMenu={workspaceController.handleWorkspaceContextMenu}
        overlay={(
          <FormulaReferenceInspection
            inspection={formulaInspection}
            key={`${activeCell?.sheetId}:${selectedCellKey}:${selectedRaw}:${formulaInspection?.raw}`}
            onNavigate={navigateReference}
          />
        )}
        viewport={workspaceController.viewport}
        workspaceSurfaceRef={workspaceController.workspaceSurfaceRef}
        workspacePlaneRef={workspaceController.workspacePlaneRef}
      >
        {sheets.map((sheet) => {
          if (!mountedSheetIds.has(sheet.id)) return null;
          const frame = projectedFramesById.get(sheet.id)!;
          const tabular = tabularProjection(sheet);
          const creatingSheetAxes = creatingAxes[sheet.id];
          const sheetEditingCell = editingCell?.target.sheetId === sheet.id ? editingCell : null;
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
                    activeCellKey={cellKeyForTarget(sheet, activeCell)}
                    activeSheetId={activeCell?.sheetId ?? null}
                    selectionOwner={selectionOwner}
                    axisProjection={axisProjection}
                    presentation={sheet.presentation}
                    pendingCutCells={pendingCutCells}
                    logicalSelection={selectionRange}
                    onWriteAxisSizes={(writes) => commands.writeAxisSizes(sheet.id, writes)}
                    onPointerInteractionChange={handleGridPointerInteractionChange}
                    onNativeFocusTarget={handleDetailedNativeFocus}
                    cellInteraction={{
                      clear: onClearCell,
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
                      commit: onCommitEdit,
                      commitAndNavigate: onCommitEditAndNavigate,
                      updateValue: onEditValueChange,
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
                    historyFeedbackCells={historyFeedbackCells}
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

function historyCellsForSheet(
  feedback: import('@application/react/useWorkbookController').ContentHistoryFeedback,
  sheet: SheetDocument,
) {
  const beforeByIdentity = new Map(feedback.before.map((cell) => [
    `${cell.sheetId}:${cell.rowId}:${cell.columnId}`,
    cell,
  ]));
  const cells = new Map<string, { before: string | null; beforeDisplay: string | null; after: string | null }>();
  for (const after of feedback.after) {
    if (after.sheetId !== sheet.id) continue;
    const address = cellAddressOf(sheet.content, after);
    if (!address) continue;
    const before = beforeByIdentity.get(`${after.sheetId}:${after.rowId}:${after.columnId}`);
    cells.set(cellKey(address), {
      before: before?.raw ?? null,
      beforeDisplay: before?.display ?? null,
      after: after.raw,
    });
  }
  return cells;
}

function selectionAddressRange(sheet: SheetDocument, selection: CellSelection): CellRange | undefined {
  const range = addressRangeOf(sheet.content, { start: selection.anchor.cell, end: selection.extent.cell });
  if (!range) return undefined;
  const rowStart = Math.min(range.start.rowIndex, range.end.rowIndex);
  const rowEnd = Math.max(range.start.rowIndex, range.end.rowIndex);
  const columnStart = Math.min(range.start.columnIndex, range.end.columnIndex);
  const columnEnd = Math.max(range.start.columnIndex, range.end.columnIndex);
  return {
    start: { rowIndex: selection.mode === 'columns' ? 0 : rowStart, columnIndex: selection.mode === 'rows' ? 0 : columnStart },
    end: {
      rowIndex: selection.mode === 'columns' ? sheet.content.rows.length - 1 : rowEnd,
      columnIndex: selection.mode === 'rows' ? sheet.content.columns.length - 1 : columnEnd,
    },
  };
}
