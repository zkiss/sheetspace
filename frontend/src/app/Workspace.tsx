import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
/* eslint-disable max-lines -- Workspace remains the existing composition root; focused history ownership is extracted. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { SheetDocument, Workbook, WorkspacePosition } from '@workbook/core/model';
import { cellKey, columnIndexToLabel } from '@workbook/core/address';
import { addressRangeOf, cellAddressOf, cellIdentityAt } from '@workbook/core/cellIdentity';
import { selectionAddressRange } from './workspaceSelection';
import { mappedExtractionSelection } from './extractionSelection';
import { cellRawContent, findSheetById, frameProjection, sheetsInOrder, tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from '@grid/gridAxisProjection';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import type { SelectionGesture, CellTarget, CellNavigationDirection, CellEditSession, CellSelection, CellSelectionMode, ReferenceNavigationTarget } from '@grid/cellInteractionContracts';
import type { SaveStatus } from '@application/core/state';
import { cellKeyForTarget, type CellFocusRequest } from '@grid/cellInteraction';
import { ContextualReferenceLinks } from '@reference-navigation/ContextualReferenceLinks';
import { contextualReferences, projectReferenceGeometry, type GridReferenceViewport } from '@reference-navigation/contextualReferenceProjection';
import { inspectStoredFormula, navigableReferencesAtCaret } from '@reference-navigation/formulaInspection';
import { prepareCellInput } from '@application/core/cellInputPreparation';
import { formulaPanelReferenceValues } from './formulaPanelValues';
import { workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import { SheetContextMenu } from '@workspace/SheetContextMenu';
import { SheetFrame } from '@workspace/SheetFrame';
import { extractionStacking } from '@workspace/extractionStacking';
import { SheetOverview } from '@workspace/SheetOverview';
import { CreatingSheetFrame } from '@workspace/CreatingSheetFrame';
import type { CreatingSheetFrame as CreatingSheetFrameState } from '@application/core/sheetCreationState';
import { SheetGrid } from '@grid/SheetGrid';
import { useReferenceNavigation } from '@reference-navigation/useReferenceNavigation';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';
import { createNavigationTransport } from './navigationTransport';
import { useSheetFrameInteractions } from '@workspace/useSheetFrameInteractions';
import type { WorkbookCommands } from '@application/react/useWorkbookController';
import { useWorkspaceController } from '@workspace/useWorkspaceController';
import { useMaximiseRuntime } from '@workspace/useMaximiseRuntime';
import { canvasPresentation, interpolatePresentation, restoredViewport, type SheetPresentation } from '@workspace/maximiseGeometry';
import { displayedExtractionFramePosition, extractionOverlayPresentation } from './extractionGeometry';
import type { ExtractionHandoffResult } from './useExtractionHandoff';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';
import { isOwnedPortalTarget, eventTargetElement, isNativeContentTarget } from '@workspace/workspaceEventPolicy';
import { WorkspaceToolbar } from '@workspace/WorkspaceToolbar';
import { NumberFormatControls } from '@workspace/NumberFormatControls';
import { useFormattingSelection } from '@workspace/useFormattingSelection';
import { mountedWorkspaceFrameIds } from '@workspace/workspaceFrameVirtualization';
import { useOwnedHistoryReveal } from './useOwnedHistoryReveal';
import { ClipboardPayloadStore } from '@grid/clipboardPayload';
import { useGridFocusLease } from './useGridFocusLease';
import { SheetModelControls } from '@workspace/SheetModelControls';
import { historyCellsForSheet } from './historyCellsForSheet';
import { useSelectionTransition } from './useSelectionTransition';
import { modelColumnPresentation, selectionIncludesCalculatedColumn } from './modelColumnPresentation';
import type { CellWriteResult } from '@application/core/userActions';
import { usageQueries, type UsageQueryResult } from '@calculation/usageQueries';
import { NavigationPalette, type NavigationCommand } from './NavigationPalette';
import { dispatchShortcut, matchesNativeClipboard, matchesShortcut, shortcutLabel } from '@shared/keyboard/keymap';
import { ErrorList } from './ErrorList';
import { ErrorReferencePreview } from './ErrorReferencePreview';
import type { ErrorReferenceHover } from './errorCellText';
import { workbookErrors } from './workbookErrors';
import { useWorkspaceActionCommands } from './useWorkspaceActionCommands';
import { extractionRequest } from './extractionRequest';
import { useExtractionHandoff } from './useExtractionHandoff';
import { useExtractionPaintCoverage } from './useExtractionPaintCoverage';
import type { CellRange } from '@workbook/core/address';
import { useSheetCreationRoute } from './useSheetCreationRoute';
import type { PresentationSnapshot } from './sheetDialogContracts';
import { clampWorkspaceZoom, normalizedWheelDelta, workspaceRectForFrame, zoomFactorFromWheelDelta } from '@workspace/workspaceGeometry';
const CALCULATED_CELL_PROTECTION = 'This cell is calculated in the data model. Edit the calculation in Data models.';
const titleWithShortcut = (label: string, id: string) => {
  const hint = shortcutLabel(id);
  return hint ? `${label} (${hint})` : label;
};

export function Workspace({
  activeCell,
  canRetryFailedSaves,
  canUndo = false,
  canRedo = false,
  commands,
  contentHistoryFeedback,
  editingCell,
  entrySessions,
  formulaResults,
  keyboardFocusRequest,
  onKeyboardFocusRequestConsumed,
  onKeyboardFocusRequestCancelled,
  onCancelEdit,
  onClearCell,
  onClearSelection,
  onActivateSheet,
  sheetSelectionTarget,
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
  onPresentationChange,
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
  interactionRevision,
  saveStatus,
  sheetDialogOpen = false,
  creatingAxes,
  creatingFrames,
  workbook,
}: {
  activeCell: CellTarget | null;
  canRetryFailedSaves: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  commands: WorkbookCommands;
  contentHistoryFeedback: import('@application/react/useWorkbookController').ContentHistoryFeedback | undefined;
  editingCell: CellEditSession | null;
  entrySessions?: Readonly<Record<string, import('@application/core/modelEntrySession').EntrySessionState>>;
  formulaResults: FormulaEvaluationSnapshot;
  keyboardFocusRequest: CellFocusRequest | null;
  onKeyboardFocusRequestConsumed: (requestId: number) => void;
  onKeyboardFocusRequestCancelled: (requestId: number) => void;
  onCancelEdit: () => void;
  onClearCell: (target: CellTarget) => CellWriteResult | undefined;
  onClearSelection: () => void;
  onActivateSheet: (sheetId: string, requestFocus?: boolean) => CellTarget | undefined;
  sheetSelectionTarget: (sheetId: string) => CellTarget | undefined;
  onCommitEdit: (session?: CellEditSession) => CellWriteResult | undefined;
  onCommitEditAndNavigate: (session: CellEditSession, request: Pick<import('@grid/cellInteractionContracts').CellNavigationRequest, 'key' | 'shift'>) => CellWriteResult | undefined;
  onSuspendEdit?: (session: CellEditSession) => void;
  onCreateSheet: (position: WorkspacePosition, viewportScale: number, label: string, confirm: () => void) => void;
  onEditValueChange: (value: string) => void;
  onUpdateEditView?: (selection: { start: number; end: number }, scrollTop: number) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onNavigateKeyboardCell: (target: CellTarget, request: import('@grid/cellInteractionContracts').CellNavigationRequest) => boolean;
  onOpenDataModels?: (modelId?: string, propertyId?: string, onClose?: () => void) => void;
  onOpenRenameDialog: (sheet: SheetDocument) => void;
  onPresentationChange?: (snapshot: PresentationSnapshot) => void;
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
  interactionRevision?: () => number;
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
  const [entrySheetId, setEntrySheetId] = useState<string | null>(null);
  useEffect(() => { if (activeCell) setEntrySheetId(null); }, [activeCell]);
  const [referenceLinksVisible, setReferenceLinksVisible] = useState(false);
  const selectionTransition = useSelectionTransition(activeCell);
  const [hoveredReferenceSpan, setHoveredReferenceSpan] = useState<{ start: number; end: number } | null>(null);
  const [modifierReferenceSpan, setModifierReferenceSpan] = useState<{ start: number; end: number } | null>(null);
  const [referenceGridViewports, setReferenceGridViewports] = useState<Readonly<Record<string, GridReferenceViewport | undefined>>>({});
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [errorReferenceHover, setErrorReferenceHover] = useState<ErrorReferenceHover>(null);
  const [errorsFocusRequest, setErrorsFocusRequest] = useState(0);
  const closeErrors = useCallback(() => { setErrorsOpen(false); setErrorReferenceHover(null); onRestoreGridFocus(); }, [onRestoreGridFocus]);
  const toggleErrors = useCallback(() => {
    if (errorsOpen) closeErrors();
    else { setErrorsOpen(true); setErrorsFocusRequest((value) => value + 1); }
  }, [closeErrors, errorsOpen]);
  const errors = useMemo(() => workbookErrors(workbook, formulaResults), [workbook, formulaResults]);
  const [paletteChoices, setPaletteChoices] = useState<NavigationCommand[] | null>(null);
  const [rowPickerOpen, setRowPickerOpen] = useState(false);
  const [paletteView, setPaletteView] = useState(0);
  const paletteInvoker = useRef<HTMLElement | null>(null);
  const propertyDefinitionInvoker = useRef<HTMLElement | null>(null);
  const keyboardCommandsRef = useRef<readonly NavigationCommand[]>([]);
  const [gridInteractionSheetIds, setGridInteractionSheetIds] = useState<ReadonlySet<string>>(() => new Set());
  const sheets = sheetsInOrder(workbook);
  const extractionExit = useRef<(token: number, result: ExtractionHandoffResult) => void>(() => {});
  const extractionHandoff = useExtractionHandoff(sheets.map((sheet) => sheet.id), (token, result) => extractionExit.current(token, result));
  const [extractionPresentation, setExtractionPresentation] = useState<{ token: number; sourceId: string; targetId: string; sample: SheetPresentation; maximised: boolean; accepted: boolean } | null>(null);
  const extractionOwner = useRef<typeof extractionPresentation>(null);
  const extractionLease = useRef<ReturnType<ReturnType<typeof useMaximiseRuntime>['ownedCanvasRestore']> | null>(null);
  const extractionAnimation = useRef<number>();
  const extractionGuard = useRef<{ sourceFrame: string; targetFrame?: string; size: string; viewport: string; identity: number; settling: boolean } | null>(null);
  const extractionFormulaSnapshot = useRef(formulaResults);
  const extractionTokens = useRef(new WeakMap<object, number>());
  const extractionRange = useRef<{ token: number; range: CellRange } | null>(null);
  const extractionScroll = useRef<{ token: number; position: { left: number; top: number } } | null>(null);
  const extractionSelectionOwner = useRef<{ token: number; selection: CellSelection; revision: number; saved: boolean; presented: boolean; paletteClosed: boolean; viewport?: string; identity?: number; frame?: string; size?: string } | null>(null);
  const extractionCuts = useRef(new WeakMap<object, NonNullable<typeof clipboard.current.pendingCutSource>>());
  const completeExtractionSelection = useRef<(token: number) => void>(() => {});
  const tryExtractionSelection = useRef<(token: number) => void>(() => {});
  const activeSheetId = entrySheetId ?? activeCell?.sheetId;
  const selectedSheet = activeSheetId ? findSheetById(workbook, activeSheetId) : undefined;
  const dataModels = Object.values(workbook.dataModels ?? {});
  const selectedCellKey = selectedSheet ? cellKeyForTarget(selectedSheet, activeCell) : null;
  const selectedRaw = selectedSheet && selectedCellKey
    ? cellRawContent(selectedSheet, selectedCellKey)
    : undefined;
  const editingCellKey = selectedSheet && editingCell ? cellKeyForTarget(selectedSheet, editingCell.target) : null;
  const inspectedRaw = editingCell && editingCell.target.sheetId === selectedSheet?.id
    ? editingCell.draft.startsWith('=') ? prepareCellInput(editingCell.draft, workbook, selectedSheet.id, editingCellKey ? cellRawContent(selectedSheet, editingCellKey) : undefined) : undefined
    : selectedRaw;
  const formulaInspection = selectedSheet && inspectedRaw?.startsWith('=')
    ? inspectStoredFormula(inspectedRaw, workbook, selectedSheet)
    : undefined;
  // A sheet dialog takes ownership from all background transient sessions.
  const interactionsEnabled = !sheetDialogOpen && !commandPaletteOpen;
  const formattingProjection = useFormattingSelection(selectedSheet, selectionRange);
  const cancelNavigationBeforeUserMovement = useRef<() => void>(() => {});
  const panViewportNeedsRender = useRef<(viewport: import('@workspace/workspaceContracts').WorkspaceViewport) => boolean>(() => true);
  const [maximiseActive, setMaximiseActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const changed = () => setReducedMotion(media.matches);
    media.addEventListener?.('change', changed);
    return () => media.removeEventListener?.('change', changed);
  }, []);
  const workspaceController = useWorkspaceController({
    onBeforeUserMovement: () => cancelNavigationBeforeUserMovement.current(),
    shouldRenderPanViewport: (viewport) => panViewportNeedsRender.current(viewport),
    onClearSelection,
    onCreateSheet,
    interactionsEnabled: interactionsEnabled && !maximiseActive,
    commandsEnabled: !sheetDialogOpen,
  });
  const paintOwner = extractionHandoff.handoff;
  useExtractionPaintCoverage(workspaceController.workspaceSurfaceRef,
    paintOwner && extractionRange.current?.token === paintOwner.token
      ? { token: paintOwner.token, source: paintOwner.source, targetId: paintOwner.targetId, range: extractionRange.current.range, ready: paintOwner.ready }
      : null, extractionHandoff.targetReady, extractionHandoff.targetNotReady, extractionHandoff.empty, workspaceController.viewport, extractionHandoff.registerCoverage);
  const maximise = useMaximiseRuntime(workspaceController, workspaceController.workspaceSurfaceSize, reducedMotion, (id) => Boolean(findSheetById(workbook, id)), (id) => {
    const sheet = findSheetById(workbook, id);
    return sheet && frameProjection(sheet);
  });
  const extractionInputs = useRef({ workbook, workspaceController, maximise, reducedMotion, sheetDialogOpen, commandPaletteOpen, interactionRevision, onRestoreGridFocus });
  extractionInputs.current = { workbook, workspaceController, maximise, reducedMotion, sheetDialogOpen, commandPaletteOpen, interactionRevision, onRestoreGridFocus };
  const abortExtractionPresentation = () => {
    const owner = extractionOwner.current;
    if (owner && extractionSelectionOwner.current?.token === owner.token && !extractionSelectionOwner.current.presented) extractionSelectionOwner.current = null;
    extractionOwner.current = null;
    extractionGuard.current = null;
    if (extractionAnimation.current !== undefined) cancelAnimationFrame(extractionAnimation.current);
    extractionAnimation.current = undefined;
    extractionLease.current?.cancel();
    extractionLease.current = null;
    setExtractionPresentation(null);
  };
  const extractionValid = (operation: NonNullable<typeof extractionPresentation>) => {
    const inputs = extractionInputs.current;
    const guard = extractionGuard.current;
    const source = findSheetById(inputs.workbook, operation.sourceId);
    const target = findSheetById(inputs.workbook, operation.targetId);
    return extractionOwner.current === operation && operation.accepted && guard && source && target && guard.targetFrame
      && JSON.stringify({ position: source.frame.position, size: source.frame.size, visualScale: source.frame.visualScale }) === guard.sourceFrame
      && JSON.stringify(frameProjection(target)) === guard.targetFrame
      && JSON.stringify(inputs.workspaceController.workspaceSurfaceSize) === guard.size
      && ((extractionLease.current && !guard.settling) || JSON.stringify(inputs.workspaceController.viewport) === guard.viewport)
      && (extractionLease.current ? extractionLease.current.owned() : inputs.maximise.currentState().identity === guard.identity);
  };
  extractionExit.current = (token, result) => {
    const operation = extractionOwner.current;
    if (!operation || operation.token !== token) return;
    if (result === 'aborted') { abortExtractionPresentation(); return; }
    if (!extractionValid(operation)) { abortExtractionPresentation(); return; }
    const settle = () => {
      if (extractionOwner.current !== operation) return;
      const inputs = extractionInputs.current;
      const target = findSheetById(inputs.workbook, operation.targetId);
      if (!target || !extractionValid(operation)) { abortExtractionPresentation(); return; }
      const end = canvasPresentation(frameProjection(target), inputs.workspaceController.viewport);
      if (extractionGuard.current) {
        extractionGuard.current.settling = true;
        extractionGuard.current.viewport = JSON.stringify(inputs.workspaceController.viewport);
      }
      if (result === 'empty' || inputs.reducedMotion) { completeExtractionSelection.current(token); abortExtractionPresentation(); return; }
      const start = performance.now();
      const tick = (now: number) => {
        if (extractionOwner.current !== operation) return;
        if (!extractionValid(operation)) { abortExtractionPresentation(); return; }
        const progress = Math.min(1, (now - start) / 240);
        if (progress >= 1) { completeExtractionSelection.current(token); abortExtractionPresentation(); return; }
        setExtractionPresentation({ ...operation, sample: interpolatePresentation(operation.sample, end, progress) });
        extractionAnimation.current = requestAnimationFrame(tick);
      };
      extractionAnimation.current = requestAnimationFrame(tick);
    };
    if (!operation.maximised) { settle(); return; }
    const lease = extractionInputs.current.maximise.ownedCanvasRestore();
    extractionLease.current = lease;
    void lease.completion.then((outcome) => {
      if (extractionOwner.current !== operation) return;
      if (outcome === 'settled' && extractionValid(operation)) extractionAnimation.current = requestAnimationFrame(settle);
      else abortExtractionPresentation();
    });
  };
  useLayoutEffect(() => {
    const operation = extractionOwner.current;
    const invalid = operation?.accepted && !extractionValid(operation);
    if (operation && invalid) {
      extractionHandoff.cancel(operation.token);
      abortExtractionPresentation();
    }
  });
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const owner = extractionSelectionOwner.current;
      if (!owner?.paletteClosed || !(event.target instanceof Element)) return;
      if (event.target === document.body || event.target === document.documentElement) return;
      const source = extractionOwner.current?.sourceId;
      const frame = event.target.closest<HTMLElement>('article.sheet-frame[data-sheet-id]');
      if (!source || frame?.dataset.sheetId !== source) extractionSelectionOwner.current = null;
    };
    document.addEventListener('focusin', onFocus, true);
    return () => document.removeEventListener('focusin', onFocus, true);
  }, []);
  useEffect(() => () => { if (extractionAnimation.current !== undefined) cancelAnimationFrame(extractionAnimation.current); extractionLease.current?.cancel(); extractionOwner.current = null; }, []);
  const modeActive = maximise.state.mode !== 'canvas';
  useEffect(() => setMaximiseActive(modeActive), [modeActive]);
  // Publish in the commit that changes ownership so a creation result that
  // resolves later cannot select against a superseded presentation.
  useLayoutEffect(() => {
    onPresentationChange?.({ canvas: maximise.state.mode === 'canvas', generation: maximise.state.identity });
  }, [maximise.state.identity, maximise.state.mode, onPresentationChange]);
  const createSheet = useSheetCreationRoute({
    ensureCanvas: maximise.ensureCanvas,
    openCreationDialog: workspaceController.createSheetAtViewportCenter,
    presentationActive: modeActive,
  });
  const zoomMaximised = useRef(maximise.zoom);
  const zoomMaximisedView = (factor: number) => { cancelNavigationBeforeUserMovement.current(); maximise.zoom(factor); };
  zoomMaximised.current = zoomMaximisedView;
  useEffect(() => {
    const surface = workspaceController.workspaceSurfaceRef.current;
    if (!surface || !modeActive || !interactionsEnabled) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = normalizedWheelDelta(event.deltaY, event.deltaMode, surface.clientHeight);
      zoomMaximised.current(zoomFactorFromWheelDelta(event.deltaMode === 0 && Math.abs(delta) < 20 ? delta * 8 : delta));
    };
    let gestureScale: number | undefined;
    const gesture = (event: Event) => {
      const input = event as Event & { scale: number };
      if (event.type === 'gestureend') {
        if (gestureScale !== undefined) { event.preventDefault(); event.stopPropagation(); }
        gestureScale = undefined;
        return;
      }
      if (!Number.isFinite(input.scale) || input.scale <= 0) return;
      if (event.type !== 'gesturestart' && gestureScale === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'gesturechange' && gestureScale !== undefined) zoomMaximised.current(input.scale / gestureScale);
      gestureScale = input.scale;
    };
    const portalWheel = (event: WheelEvent) => { if (isOwnedPortalTarget(event.target, surface)) wheel(event); };
    const portalGesture = (event: Event) => { if (isOwnedPortalTarget(event.target, surface)) gesture(event); };
    surface.addEventListener('wheel', wheel, { capture: true, passive: false });
    document.addEventListener('wheel', portalWheel, { capture: true, passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      surface.addEventListener(type, gesture, { capture: true, passive: false });
      document.addEventListener(type, portalGesture, { capture: true, passive: false });
    }
    return () => {
      surface.removeEventListener('wheel', wheel, true);
      document.removeEventListener('wheel', portalWheel, true);
      for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
        surface.removeEventListener(type, gesture, true);
        document.removeEventListener(type, portalGesture, true);
      }
    };
  }, [modeActive, interactionsEnabled, workspaceController.workspaceSurfaceRef]);
  const displayedFrames = useRef(new Map<string, ReturnType<typeof frameProjection>>());
  const transportInputs = useRef({ maximise, workspaceController, workbook });
  transportInputs.current = { maximise, workspaceController, workbook };
  const transport = useMemo(() => createNavigationTransport({
    currentState: () => transportInputs.current.maximise.currentState(),
    ensureCanvas: () => transportInputs.current.maximise.ensureCanvas(),
    ensureMaximised: (id) => transportInputs.current.maximise.ensureMaximised(id),
    enter: (id, saved, displayed, programmatic) => transportInputs.current.maximise.enter(id, saved, displayed, programmatic),
    claimPresentation: () => transportInputs.current.maximise.claimPresentation(),
  }, {
    navigateToTarget: (target, options) => transportInputs.current.workspaceController.navigateToTarget(target, options),
    restoreViewport: (viewport, settled, cancelled) => transportInputs.current.workspaceController.restoreViewport(viewport, settled, cancelled),
  }, (id) => Boolean(findSheetById(transportInputs.current.workbook, id)), (id) => {
    const sheet = findSheetById(transportInputs.current.workbook, id);
    if (!sheet) return undefined;
    const saved = frameProjection(sheet);
    return { saved, displayed: displayedFrames.current.get(id) ?? saved };
  }), []);
  useEffect(() => { transport.activate(); return () => transport.deactivate(); }, [transport]);
  useEffect(() => transport.reconcile(), [transport, workbook]);
  const restoreIntent = useRef<(() => boolean) | null>(null);
  const [focusedRestore, setFocusedRestore] = useState(false);
  function clearRestoreIntent() {
    restoreIntent.current = null;
    setFocusedRestore(false);
  }
  function focusMaximise() {
    if (maximise.currentState().mode === 'canvas') { cancelNavigationBeforeUserMovement.current(); return; }
    const ownsPresentation = maximise.adoptPresentation();
    const navigationGeneration = navigationHistory.ownershipGeneration();
    cancelNavigationBeforeUserMovement.current();
    if (!document.activeElement?.hasAttribute('data-workspace-presentation-action')) return;
    restoreIntent.current = () => ownsPresentation() && navigationHistory.ownershipGeneration() === navigationGeneration;
    setFocusedRestore(true);
  }
  function activateMaximise() {
    const intent = restoreIntent.current;
    if (!intent) { toggleMaximise(); return; }
    clearRestoreIntent();
    if (!intent()) return;
    void maximise.restoreToCanvas();
    cancelNavigationBeforeUserMovement.current();
  }
  function toggleMaximise() {
    if (modeActive) void maximise.restoreToCanvas();
    cancelNavigationBeforeUserMovement.current();
    if (!modeActive && selectedSheet) {
      const saved = frameProjection(selectedSheet);
      const displayed = displayedFrames.current.get(selectedSheet.id) ?? saved;
      cancelSheetFrameScale();
      maximise.enter(selectedSheet.id, saved, displayed);
    }
  }
  const navigationKeyboardEnabled = interactionsEnabled && !workspaceController.pendingSheetMenu;
  const { acknowledgeGridRestore, cancelNavigationRestore, history: navigationHistory, historyRestoreForSheet, navigationRestoreForSheet, navigationRequestForSheet, ownsGridRestore, pendingNavigationSheetId, registerScrollContainer, recordUserGridMovement, startContentNavigation, startExplicitNavigation, startExplicitSheetNavigation } = useWorkspaceNavigationHistory({
    onHistoryTraversal: () => clearNavigationHighlight(),
    onRestoreSelection, onUnavailableTarget: () => setNavigationFeedback('The saved navigation target is no longer available.'), restoreViewport: workspaceController.restoreViewport,
    restoreDestination: (id, viewport, onSettled, onFailure) => transport.restore(id, viewport, { onSettled, onFailure }),
    stageDestination: transport.stageDestination,
    selection: selectionRange, viewport: workspaceController.viewport,
  });
  const contentReveal = useOwnedHistoryReveal({
    feedback: contentHistoryFeedback, editing: editingCell !== null, sheets, creatingAxes,
    controller: workspaceController, stageDestination: transport.stageDestination,
    acquire: startContentNavigation,
    reveal: ({ sheetId, target, outsideViewport }, callbacks) => transport.content(sheetId, target, outsideViewport, callbacks),
    onPresentedCell: ({ sheetId, rowId, columnId }) => {
      const target = { sheetId, cell: { rowId, columnId } };
      onSelectCell(target);
      onFocusSelection(target);
    },
  });
  cancelNavigationBeforeUserMovement.current = () => {
    extractionSelectionOwner.current = null;
    const operation = extractionOwner.current;
    if (operation) { extractionHandoff.cancel(operation.token); abortExtractionPresentation(); }
    if (restoreIntent.current) restoreIntent.current = () => false;
    cancelNavigationRestore();
    transport.cancel();
  };
  useLayoutEffect(() => { if (sheetDialogOpen) cancelNavigationBeforeUserMovement.current(); }, [sheetDialogOpen]);
  const pendingNavigation = useRef(false);
  pendingNavigation.current = Boolean(pendingNavigationSheetId) || contentReveal.pending;
  useEffect(() => {
    const retireOnExternalFocus = (event: FocusEvent) => {
      if (!transport.activeDestination() && !pendingNavigation.current) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // This control has already adopted presentation and retired navigation in onFocus.
      if (target.hasAttribute('data-workspace-presentation-action')) return;
      if (target.closest('[data-workspace-sheet-frame]') && !target.closest('input, textarea, select, [contenteditable="true"], [data-workspace-sheet-editor]')) return;
      cancelNavigationBeforeUserMovement.current();
    };
    document.addEventListener('focusin', retireOnExternalFocus);
    return () => document.removeEventListener('focusin', retireOnExternalFocus);
  }, [transport]);
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
  const {
    clearNavigationHighlight,
    navigateReference,
    navigateTarget,
    navigationHighlight,
    navigationHighlightIdentity,
    navigationMotion,
  } = useReferenceNavigation({
    navigateToTarget: workspaceController.navigateToTarget,
    navigateDestination: (id, target, options) => transport.target(id, target, options, { onSettled: options.onSettled ?? (() => {}), onFailure: options.onFailure ?? (() => {}) }),
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
    startExplicitSheetNavigation(sheet.id, onClearSelection, (onSettled, onFailure) => transport.target(sheet.id, workspaceRectForFrame(sheet.frame), {
      naturalScale: clampWorkspaceZoom(1 / sheet.frame.visualScale),
    }, { onSettled, onFailure }));
  }, [onClearSelection, startExplicitSheetNavigation, transport]);
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
    const caret = editingCell?.selection?.start;
    const references = formulaInspection?.references.filter((reference) => reference.navigable) ?? [];
    const atCaret = caret === undefined ? references : references.filter((reference) => caret >= reference.displaySpan.start && caret <= reference.displaySpan.end);
    const candidates = (atCaret.length ? atCaret : references).flatMap((reference) => {
      const property = propertyForReference(reference);
      return property ? [{ reference, property }] : [];
    });
    return [...new Map(candidates.map((candidate) => [`${candidate.property.modelId}:${candidate.property.propertyId}`, candidate])).values()];
  }, [editingCell, formulaInspection, propertyForReference]);
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
    const caret = editingCell?.selection?.start;
    return navigableReferencesAtCaret(formulaInspection, caret);
  }, [editingCell, formulaInspection]);
  const openReferenceChoices = useCallback(() => {
    const choices = navigableReferencesForFollow();
    if (choices.length === 0) { setNavigationFeedback('No resolvable reference is available.'); return; }
    if (choices.length === 1) {
      if (navigateReference(choices[0]!) && commandPaletteOpen) closeCommandPalette(false);
      return;
    }
    openChoices(choices.map((reference, index) => ({ id: `reference:${index}`, label: `Follow reference: ${reference.text}`, run: () => { if (navigateReference(reference)) closeCommandPalette(false); } })));
  }, [closeCommandPalette, commandPaletteOpen, navigateReference, navigableReferencesForFollow, openChoices]);
  const openSheetChoices = useCallback(() => {
    openChoices(sheets.map((sheet) => {
      const first = cellIdentityAt(sheet.content, { columnIndex: 0, rowIndex: 0 });
      return {
        id: `sheet:${sheet.id}`,
        group: 'Sheets',
        label: sheet.name,
        run: () => {
          const remembered = sheetSelectionTarget(sheet.id);
          if (remembered) navigateCellTarget(remembered);
          else if (first) navigateCellTarget({ sheetId: sheet.id, cell: first });
          else navigateEmptySheet(sheet);
          closeCommandPalette(false);
        },
      };
    }));
  }, [closeCommandPalette, navigateCellTarget, navigateEmptySheet, sheetSelectionTarget, openChoices, sheets]);
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
    result.unshift({ id: 'errors', label: 'Toggle error list', shortcut: shortcutLabel('errors'), keyboardContext: ['navigation', 'no-editing'], run: () => { closeCommandPalette(false); toggleErrors(); } });
    result.unshift({ id: 'row', label: 'Go to row…', shortcut: shortcutLabel('row'), keyboardContext: ['navigation'], unavailable: selectedSheet?.content.rows.length ? undefined : 'No current sheet rows', run: () => {
      setPaletteChoices(null);
      setRowPickerOpen(true);
      setPaletteView((view) => view + 1);
      setCommandPaletteOpen(true);
    } });
    result.unshift({ id: 'column', label: 'Go to column…', shortcut: shortcutLabel('column'), keyboardContext: ['navigation'], unavailable: selectedSheet?.content.columns.length && selectedSheet.content.rows.length ? undefined : 'No current sheet columns', run: openColumnChoices });
    result.unshift({ id: 'definition', label: 'Go to property definition', shortcut: shortcutLabel('definition'), keyboardContext: ['navigation'], unavailable: propertyForActiveCell() || propertyReferenceChoices().length ? undefined : 'Select a named property or property reference first', run: openPropertyDefinition });
    result.unshift({ id: 'sheet', label: 'Go to sheet…', shortcut: shortcutLabel('sheet'), keyboardContext: ['navigation'], unavailable: sheets.length ? undefined : 'No sheets available', run: openSheetChoices });
    result.unshift({ id: 'reference', label: 'Follow reference', shortcut: shortcutLabel('reference'), keyboardContext: ['navigation'], unavailable: navigableReferencesForFollow().length ? undefined : 'No resolvable reference', run: openReferenceChoices });
    result.unshift({ id: 'usages', label: 'Find usages', shortcut: shortcutLabel('usages'), keyboardContext: ['navigation'], unavailable: activeCell ? undefined : 'Select a cell first', run: openUsages });
    return result;
  }, [activeCell, closeCommandPalette, navigableReferencesForFollow, openColumnChoices, toggleErrors, openPropertyDefinition, openReferenceChoices, openSheetChoices, openUsages, propertyForActiveCell, propertyReferenceChoices, selectedSheet, sheets]);
  const {
    cancelSheetFrameDrag,
    cancelSheetFrameResize,
    cancelSheetFrameScale,
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
    interactionsEnabled: interactionsEnabled && !modeActive,
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
  tryExtractionSelection.current = (token) => {
    const owner = extractionSelectionOwner.current;
    if (!owner || owner.token !== token || !owner.saved || !owner.presented) return;
    extractionSelectionOwner.current = null;
    if ((interactionRevision?.() ?? 0) !== owner.revision || sheetDialogOpen || commandPaletteOpen
      || !commands.currentWorkbook().documents[owner.selection.anchor.sheetId]
      || JSON.stringify(frameProjection(commands.currentWorkbook().documents[owner.selection.anchor.sheetId]!)) !== owner.frame
      || JSON.stringify(workspaceController.workspaceSurfaceSize) !== owner.size
      || JSON.stringify(workspaceController.viewport) !== owner.viewport || maximise.currentState().identity !== owner.identity) return;
    if (onRestoreSelection(owner.selection)) beginPendingGridFocus(owner.selection.extent);
  };
  completeExtractionSelection.current = (token) => {
    const owner = extractionSelectionOwner.current;
    if (!owner || owner.token !== token) return;
    owner.presented = true;
    owner.viewport = JSON.stringify(extractionInputs.current.workspaceController.viewport);
    owner.identity = extractionInputs.current.maximise.currentState().identity;
    owner.size = JSON.stringify(extractionInputs.current.workspaceController.workspaceSurfaceSize);
    const target = extractionInputs.current.workbook.documents[owner.selection.anchor.sheetId];
    owner.frame = target && JSON.stringify(frameProjection(target));
    tryExtractionSelection.current(token);
  };
  useLayoutEffect(() => {
    const owner = extractionSelectionOwner.current;
    if (owner && !commandPaletteOpen) owner.paletteClosed = true;
    if (owner && ((interactionRevision?.() ?? 0) !== owner.revision || sheetDialogOpen
      || (owner.paletteClosed && commandPaletteOpen)
      || (owner.presented && (!workbook.documents[owner.selection.anchor.sheetId]
        || JSON.stringify(frameProjection(workbook.documents[owner.selection.anchor.sheetId]!)) !== owner.frame
        || JSON.stringify(workspaceController.workspaceSurfaceSize) !== owner.size
        || JSON.stringify(workspaceController.viewport) !== owner.viewport || maximise.currentState().identity !== owner.identity)))) extractionSelectionOwner.current = null;
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
  const extractionSlots = extractionHandoff.handoff
    ? extractionStacking(projectedFrames, extractionHandoff.handoff.source.id)
    : undefined;
  displayedFrames.current = projectedFramesById;
  const referenceSurfaceSize = useMemo(() => workspaceController.workspaceSurfaceSize ?? { width: 0, height: 0 }, [workspaceController.workspaceSurfaceSize]);
  const frameVisibilityOptions = {
    frames: projectedFrames,
    pins: {
      editingSheetId: editingCell?.target.sheetId,
      gridInteractionSheetIds,
      interactionSheetId: interactionPinnedSheetId,
      pendingFocusSheetId: pinsFocusedFrame(gridFocusLease) ? gridFocusLease?.sheetId : undefined,
      referenceSheetId: referenceSelection?.kind === 'cell' ? referenceSelection.target.sheetId : referenceSelection?.sheetId,
      historySheetIds: [pendingNavigationSheetId, contentReveal.pendingSheetId, selectionTransition?.from.sheetId, ...(contentHistoryFeedback?.after.map((cell) => cell.sheetId) ?? [])].filter((id): id is string => Boolean(id)),
    },
    surfaceSize: workspaceController.workspaceSurfaceSize,
  };
  const mountedSheetIds = new Set(mountedWorkspaceFrameIds({ ...frameVisibilityOptions, viewport: workspaceController.displayedViewport }));
  if (extractionHandoff.handoff) {
    mountedSheetIds.add(extractionHandoff.handoff.source.id);
    mountedSheetIds.add(extractionHandoff.handoff.targetId);
  }
  if (extractionPresentation) { mountedSheetIds.add(extractionPresentation.sourceId); mountedSheetIds.add(extractionPresentation.targetId); }
  if (maximise.state.sheetId) mountedSheetIds.add(maximise.state.sheetId);
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
    if (active) cancelNavigationBeforeUserMovement.current();
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
      const moved = commands.moveStoredCells(destination.id, destinationKey, parsed.value.source);
      if (moved.ok || moved.reason === 'stale-move-source' || moved.reason === 'invalid-move-source' || moved.reason === 'calculated-cell-write') cancelPendingCut();
      if (!moved.ok && moved.reason === 'calculated-cell-write') setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
      if (!moved.ok && moved.reason === 'invalid-cell-type') setCalculatedCellFeedback('The value does not match the data model column type. No cells were changed.');
      if (!moved.ok && moved.reason === 'unrepresentable-range') setCalculatedCellFeedback('The move did not happen because it would split a referenced range. Move the entire referenced range or choose another destination.');
    } else {
      const pasted = commands.pasteStoredCells(destination.id, destinationKey, parsed);
      if (!pasted.ok && pasted.reason === 'malformed-tsv') setCalculatedCellFeedback('The clipboard contains malformed tabular text. Check quoted fields and try again. No cells were changed.');
      if (!pasted.ok && pasted.reason === 'calculated-cell-write') setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
      if (!pasted.ok && pasted.reason === 'invalid-cell-type') setCalculatedCellFeedback('The value does not match the data model column type. No cells were changed.');
    }
  }
  /** Reports a rejected content write instead of leaving the user without a reason. */
  function reportWriteOutcome(outcome: CellWriteResult | undefined) {
    if (outcome && !outcome.ok && outcome.reason === 'calculated-cell-write') {
      setCalculatedCellFeedback(CALCULATED_CELL_PROTECTION);
    } else if (outcome && !outcome.ok && outcome.reason === 'invalid-cell-type') {
      setCalculatedCellFeedback('The value does not match the data model column type.');
    }
  }
  const actionPalette = useWorkspaceActionCommands({
    commands, controller: workspaceController, sheet: selectedSheet, workbook, activeCell, selection: selectionRange,
    maximise: { active: modeActive, toggle: toggleMaximise, zoom: zoomMaximisedView },
    extraction: {
      managesOwnership: true,
      request: (sheet, selection) => {
        cancelNavigationBeforeUserMovement.current();
        const viewport = referenceGridViewports[sheet.id];
        const body = workspaceController.workspaceSurfaceRef.current?.querySelector<HTMLElement>(
          `[data-workspace-sheet-frame][data-sheet-id="${CSS.escape(sheet.id)}"] .sheet-frame-body`,
        );
        const scroll = { x: body?.scrollLeft ?? viewport?.scrollLeft ?? 0, y: body?.scrollTop ?? viewport?.scrollTop ?? 0 };
        const request = extractionRequest(workbook, sheet, selection, scroll, projectedFramesById.get(sheet.id)?.position);
        const range = selectionAddressRange(sheet, selection);
        const surface = workspaceController.workspaceSurfaceRef.current;
        const sourceFrame = projectedFramesById.get(sheet.id) ?? frameProjection(sheet);
        const presented = maximise.state.sheetId === sheet.id && maximise.presentation ? maximise.presentation : canvasPresentation(sourceFrame, workspaceController.displayedViewport);
        const bodyBounds = body?.getBoundingClientRect(), surfaceBounds = surface?.getBoundingClientRect();
        const displayed = bodyBounds && surfaceBounds && bodyBounds.width > 0 && bodyBounds.height > 0
          ? { ...presented, body: { left: bodyBounds.left - surfaceBounds.left, top: bodyBounds.top - surfaceBounds.top, width: bodyBounds.width, height: bodyBounds.height } }
          : presented;
        const maximised = maximise.currentState().mode !== 'canvas' && maximise.currentState().sheetId === sheet.id;
        const finalViewport = maximised && workspaceController.workspaceSurfaceSize
          ? restoredViewport(frameProjection(sheet), workspaceController.workspaceSurfaceSize) : workspaceController.viewport;
        if (request && range) {
          request.frame.position = displayedExtractionFramePosition(sheet, range.start, scroll, displayed, finalViewport, request.frame.size);
          extractionFormulaSnapshot.current = formulaResults;
          const token = extractionHandoff.begin(sheet, request.targetSheetId);
          const mapped = mappedExtractionSelection(sheet, selection, request);
          extractionSelectionOwner.current = mapped ? { token, selection: mapped, revision: interactionRevision?.() ?? 0, saved: false, presented: false, paletteClosed: !commandPaletteOpen } : null;
          if (clipboard.current.pendingCutSource) extractionCuts.current.set(request, clipboard.current.pendingCutSource);
          const operation = { token, sourceId: sheet.id, targetId: request.targetSheetId, sample: extractionOverlayPresentation(sheet, range.start, scroll, displayed, request.frame.size), maximised, accepted: false };
          extractionOwner.current = operation;
          extractionGuard.current = { sourceFrame: JSON.stringify({ position: sheet.frame.position, size: sheet.frame.size, visualScale: sheet.frame.visualScale }), size: JSON.stringify(workspaceController.workspaceSurfaceSize), viewport: JSON.stringify(workspaceController.viewport), identity: maximise.currentState().identity, settling: false };
          setExtractionPresentation(operation);
          extractionScroll.current = { token, position: { left: body?.scrollLeft ?? viewport?.scrollLeft ?? 0, top: body?.scrollTop ?? viewport?.scrollTop ?? 0 } };
          extractionRange.current = range ? { token, range } : null;
          extractionTokens.current.set(request, token);
        }
        return request;
      },
      onAccepted: (request, target) => {
        const token = extractionTokens.current.get(request);
        if (token !== undefined) {
          if (extractionOwner.current?.token === token && extractionGuard.current) {
            extractionGuard.current.targetFrame = JSON.stringify(frameProjection(target));
            extractionOwner.current.accepted = true;
          }
          extractionHandoff.accepted(token);
        }
      },
      onFailure: (request) => {
        const token = request && extractionTokens.current.get(request);
        if (token !== undefined) {
          const owner = extractionSelectionOwner.current;
          const inputs = extractionInputs.current;
          if (owner?.token === token && (inputs.interactionRevision?.() ?? 0) === owner.revision && !inputs.sheetDialogOpen && !inputs.commandPaletteOpen
            && commands.currentWorkbook().documents[request!.sourceSheetId]) inputs.onRestoreGridFocus();
          if (extractionSelectionOwner.current?.token === token) extractionSelectionOwner.current = null;
          extractionHandoff.cancel(token);
          if (extractionOwner.current?.token === token) abortExtractionPresentation();
        }
      },
      onSuccess: (request) => {
        const cut = extractionCuts.current.get(request);
        if (cut && clipboard.current.pendingCutSource === cut) cancelPendingCut();
        const token = extractionTokens.current.get(request);
        if (token === undefined || extractionSelectionOwner.current?.token !== token) return;
        extractionSelectionOwner.current.saved = true;
        tryExtractionSelection.current(token);
      },
    },
    onCreateSheet: createSheet,
    formatting: formattingProjection, referencesVisible: referenceLinksVisible, canUndo, canRedo, canRetryFailedSaves,
    navigation: navigationHistory, closePalette: closeCommandPalette,
    openPanel: () => { setPaletteChoices(null); setRowPickerOpen(false); setPaletteView((view) => view + 1); setCommandPaletteOpen(true); },
    onOpenDataModels, onRename: handleOpenRenameDialog,
    onDelete: (sheet) => { if (editingCell?.target.sheetId === sheet.id) onCancelEdit(); return commands.deleteSheet(sheet.id); },
    onEdit: onStartEdit, onClear: (target) => reportWriteOutcome(onClearCell(target)),
    onSelectAxis: (axis, target) => onSelectAxis(axis, target, false),
    onRowDeleted: (sheet, target) => {
      const index = sheet.content.rows.indexOf(target.cell.rowId);
      const remaining = sheet.content.rows.filter((rowId) => rowId !== target.cell.rowId);
      const rowId = remaining[Math.min(index, remaining.length - 1)];
      if (rowId) {
        const next = { sheetId: sheet.id, cell: { ...target.cell, rowId } };
        onSelectCell(next);
        onFocusSelection(next);
      } else {
        onClearSelection();
        requestAnimationFrame(() => {
          const frame = document.querySelector<HTMLElement>(`[data-workspace-sheet-frame][data-sheet-id="${CSS.escape(sheet.id)}"]`);
          (frame?.querySelector<HTMLElement>('.model-entry-cell') ?? frame?.querySelector<HTMLElement>('.sheet-grid'))?.focus();
        });
      }
    },
    onColumnDeleted: (sheet, target) => {
      const index = sheet.content.columns.indexOf(target.cell.columnId);
      const remaining = sheet.content.columns.filter((columnId) => columnId !== target.cell.columnId);
      const columnId = remaining[Math.min(index, remaining.length - 1)];
      if (columnId) {
        const next = { sheetId: sheet.id, cell: { ...target.cell, columnId } };
        onSelectCell(next);
        onFocusSelection(next);
      } else {
        onClearSelection();
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-workspace-sheet-frame][data-sheet-id="${CSS.escape(sheet.id)}"] .sheet-grid`)?.focus());
      }
    },
    onSelectAll: (sheet) => {
      const first = cellIdentityAt(sheet.content, { rowIndex: 0, columnIndex: 0 });
      const last = cellIdentityAt(sheet.content, { rowIndex: sheet.content.rows.length - 1, columnIndex: sheet.content.columns.length - 1 });
      if (first && last) { onSelectCell({ sheetId: sheet.id, cell: first }); onExtendSelection({ sheetId: sheet.id, cell: last }); }
    },
    onToggleReferences: () => setReferenceLinksVisible((visible) => !visible), onFeedback: setNavigationFeedback,
    onCopy: copyGridSelection, onCut: cutGridSelection, onPaste: pasteGridSelection, onCancelCut: cancelPendingCut,
    hasPendingCut: clipboard.current.pendingCutSource !== undefined,
  });
  const commandPaletteCommand: NavigationCommand = { id: 'command-palette', label: 'Command palette', group: 'Workspace', keyboardContext: ['navigation'], run: () => { setCommandPaletteOpen(true); } };
  const keyboardCommands = [commandPaletteCommand, ...paletteCommands, ...actionPalette.commands];
  keyboardCommandsRef.current = keyboardCommands;
  const allPaletteCommands = [...paletteCommands.map((command) => ({ ...command, group: 'Navigation' })), ...actionPalette.commands]
    .sort((left, right) => left.group === right.group ? 0 : left.group === 'Navigation' ? -1 : right.group === 'Navigation' ? 1 : (left.group ?? '').localeCompare(right.group ?? ''));
  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.defaultPrevented || !interactionsEnabled) return;
      const target = eventTargetElement(event.target);
      if (isNativeContentTarget(target)) return;
      const surface = workspaceController.workspaceSurfaceRef.current;
      if (target && surface && isOwnedPortalTarget(target, surface)) return;
      const eligible = keyboardCommandsRef.current.filter((command) => (command.keyboardContext ?? []).every((context) => {
        switch (context) {
          case 'navigation': return navigationKeyboardEnabled;
          case 'no-editing': return editingCell === null;
          case 'grid-cells': return !!target?.closest('[data-cell-key][data-active-cell="true"]');
          case 'native-clipboard': return editingCell === null && !matchesNativeClipboard(event, command.id);
          case 'formatting': return true;
          case 'grid-focus': return true;
        }
      }));
      const dispatched = eligible.find((command) => !command.unavailable && matchesShortcut(event, command.id));
      if (dispatched && target instanceof HTMLElement) {
        paletteInvoker.current = target;
        propertyDefinitionInvoker.current = target;
      }
      const restoreGridFocus = dispatched?.keyboardContext?.includes('grid-focus') ?? false;
      if (dispatchShortcut(event, eligible, restoreGridFocus ? { restoreFocus: false } : undefined)) {
        event.preventDefault();
        if (restoreGridFocus) onRestoreGridFocus();
        return;
      }
      if (eligible.some((command) => command.keyboardContext?.includes('formatting') && matchesShortcut(event, command.id))) event.preventDefault();
    }
    function handleGridTypingShortcut(event: KeyboardEvent) {
      const target = eventTargetElement(event.target);
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || !target?.matches('[data-cell-key][data-active-cell="true"]')) return;
      handleKeydown(event);
    }
    window.addEventListener('keydown', handleGridTypingShortcut, true);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleGridTypingShortcut, true);
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [editingCell, interactionsEnabled, navigationKeyboardEnabled, onRestoreGridFocus, workspaceController]);
  return (
    <>
      <WorkspaceToolbar
        canMaximise={Boolean(selectedSheet) || modeActive}
        titles={{
          back: titleWithShortcut('Back', 'back'),
          forward: titleWithShortcut('Forward', 'forward'),
          commandPalette: titleWithShortcut('Command palette', 'command-palette'),
          errorsList: `${errors.length} workbook ${errors.length === 1 ? 'error' : 'errors'} · ${titleWithShortcut(errorsOpen ? 'Hide error list' : 'Show error list', 'errors')}`,
        }}
        maximised={modeActive || focusedRestore}
        onToggleMaximise={activateMaximise}
        onFocusMaximise={focusMaximise}
        onBlurMaximise={clearRestoreIntent}
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
        onCreateSheet={createSheet}
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
        errorCount={errors.length}
        errorsDisabled={!interactionsEnabled}
        errorsOpen={errorsOpen}
        onOpenErrors={toggleErrors}
      />
      <ErrorList errors={errors} open={errorsOpen && !sheetDialogOpen} focusRequest={errorsFocusRequest} onReferenceHover={setErrorReferenceHover} onClose={closeErrors} onNavigate={(target) => {
        const sheet = findSheetById(workbook, target.sheetId);
        if (sheet && sheet.content.rows.includes(target.cell.rowId) && sheet.content.columns.includes(target.cell.columnId)) navigateTarget({ kind: 'cell', target }, sheet);
      }} onActivate={(error) => {
        const current = errors.find((item) => item.key === error.key);
        const sheet = current && findSheetById(workbook, current.sheetId);
        if (current && sheet) navigateTarget({ kind: 'cell', target: { sheetId: current.sheetId, cell: current.cell } }, sheet);
      }} />
      {errorsOpen && !sheetDialogOpen && !modeActive && errorReferenceHover ? <ErrorReferencePreview hover={errorReferenceHover} surface={workspaceController.workspaceSurfaceRef.current}
        geometry={projectReferenceGeometry({ reference: errorReferenceHover.reference, workbook, frames: projectedFrames, gridViewports: referenceGridViewports, workspaceViewport: workspaceController.viewport, surfaceSize: referenceSurfaceSize })}
        onNavigate={navigateReference} /> : null}
      {calculatedCellFeedback ? <p className="form-error" role="alert">{calculatedCellFeedback}</p> : null}
      {navigationFeedback ? <p className="form-error" role="alert">{navigationFeedback}</p> : null}
       {commandPaletteOpen ? <NavigationPalette key={paletteView} panel={actionPalette.panel} commands={(paletteChoices ?? allPaletteCommands).map((command) => actionPalette.busy ? { ...command, unavailable: 'Waiting for clipboard access' } : command)} onClose={() => { if (!actionPalette.preventClose) { actionPalette.resetPanel(); closeCommandPalette(); } }} rowPicker={rowPickerOpen && selectedSheet ? {
         sheetName: selectedSheet.name,
         rowCount: selectedSheet.content.rows.length,
         onNavigate: (row) => {
           const columnId = activeCell && selectedSheet.content.columns.includes(activeCell.cell.columnId) ? activeCell.cell.columnId : selectedSheet.content.columns[0];
           const rowId = selectedSheet.content.rows[row - 1];
           if (columnId && rowId) { navigateCellTarget({ sheetId: selectedSheet.id, cell: { rowId, columnId } }); closeCommandPalette(false); }
         },
       } : undefined} /> : null}
      <WorkspaceSurface
        concealBackground={modeActive}
        concealPeers={modeActive}
        contextMenu={workspaceController.pendingSheetMenu && menuSheet ? (
          <SheetContextMenu
            key={menuSheet.id}
            menu={workspaceController.pendingSheetMenu}
            extraction={(() => {
              const action = actionPalette.commands.find((item) => item.id === 'extract-selection')!;
              return { unavailable: menuSheet.id === selectedSheet?.id ? action.unavailable : 'Select cells on this sheet first', run: () => { workspaceController.closeSheetMenu(); action.run(); } };
            })()}
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
        onCreateSheet={createSheet}
        onContextMenu={workspaceController.handleWorkspaceContextMenu}
        overlay={(
          <>
            {formulaInspection && !modeActive ? <ContextualReferenceLinks editorActive={Boolean(editingCell)} hoveredSourceSpan={hoveredReferenceSpan} pulseSourceSpan={modifierReferenceSpan} onNavigate={navigateReference} references={contextualReferenceItems} source={contextualSourceGeometry} surfaceSize={referenceSurfaceSize} visible={referenceLinksVisible} /> : null}
          </>
        )}
        viewport={workspaceController.viewport}
        workspaceSurfaceRef={workspaceController.workspaceSurfaceRef}
        workspacePlaneRef={workspaceController.workspacePlaneRef}
      >
        {sheets.map((liveSheet) => {
          const sheet = extractionHandoff.handoff?.source.id === liveSheet.id ? extractionHandoff.handoff.source : liveSheet;
          if (!mountedSheetIds.has(sheet.id)) return null;
          const frame = projectedFramesById.get(sheet.id)!;
          const tabular = tabularProjection(sheet);
          const model = sheet.modelId ? workbook.dataModels?.[sheet.modelId] : undefined;
          const entrySession = entrySessions?.[sheet.id];
          const entryModel = model && { ...model, columns: tabular.columns.flatMap((columnId) => {
            const column = model.columns.find((item) => sheet.modelColumnBindings?.[item.id] === columnId);
            return column ? [column] : [];
          }) };
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
          const gridPresentationReady = (maximise.state.mode === 'canvas' && !transport.activeStaged())
            || (maximise.state.mode === 'maximised' && maximise.state.sheetId === sheet.id);
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
              extractionHandoff={extractionHandoff.handoff?.targetId === sheet.id}
              extractionSource={extractionHandoff.handoff?.source.id === sheet.id}
              extractionReady={extractionHandoff.handoff?.ready}
              extractionWaitingZIndex={extractionSlots?.waiting}
              presentationZIndex={extractionSlots?.slots.get(sheet.id)}
              columnCount={tabular.columns.length + (creatingSheetAxes?.columns.length ?? 0)}
              frame={frame}
              presentation={extractionPresentation?.targetId === sheet.id ? { sample: extractionPresentation.sample, viewport: workspaceController.viewport } : maximise.state.sheetId === sheet.id && maximise.presentation ? { sample: maximise.presentation, viewport: workspaceController.viewport } : undefined}
              isActiveSheet={activeSheetId === sheet.id}
              isNavigationReveal={navigationHighlight?.kind === 'cell'
                ? navigationHighlight.target.sheetId === sheet.id
                : navigationHighlight?.sheetId === sheet.id}
              retainDetailedBody={Boolean(
                sheetEditingCell
                || interactionPinnedSheetId === sheet.id
                || gridInteractionSheetIds.has(sheet.id)
                || pendingNavigationSheetId === sheet.id
                || contentReveal.pendingSheetId === sheet.id
                || (gridFocusLease?.phase === 'request-active' && gridFocusLease.sheetId === sheet.id),
              )}
              onDetailedFocusDisplaced={() => handleDetailedFocusDisplaced(sheet.id)}
              onDetailedBodyAvailable={() => handleDetailedBodyAvailable(sheet.id)}
              onDetailedNativeFocusReleased={() => handleDetailedNativeFocusReleased(sheet.id)}
              onRenderingModeChange={reportReferenceRenderingMode}
              overview={(
                <SheetOverview
                  isActive={activeSheetId === sheet.id}
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
              onResizeStart={(id, direction, event) => {
                if (id !== paintOwner?.source.id && id !== paintOwner?.targetId && id !== extractionPresentation?.targetId) handleSheetFrameResizeStart(id, direction, event);
              }}
              onResizeStop={stopSheetFrameResize}
              onSheetFrameDragCancel={cancelSheetFrameDrag}
              onSheetFrameInteraction={workspaceController.closeSheetMenu}
              onSheetFrameDragMove={handleSheetFrameDragMove}
              onSheetFrameDragStart={(id, event) => {
                if (id !== paintOwner?.source.id && id !== paintOwner?.targetId && id !== extractionPresentation?.targetId) handleSheetFrameDragStart(id, event);
              }}
              onSheetFrameDragStop={stopSheetFrameDrag}
              onSelectSheet={() => {
                const target = onActivateSheet(sheet.id);
                if (!target && entryModel && tabular.rows.length === 0) {
                  document.querySelector<HTMLElement>(`[data-workspace-sheet-frame][data-sheet-id="${CSS.escape(sheet.id)}"] .model-entry-cell`)?.focus();
                }
              }}
              rowCount={tabular.rows.length + (creatingSheetAxes?.rows.length ?? 0)}
              viewportScale={workspaceController.viewport.scale}
            >
              {(scrollContainerRef) => {
                const axisProjection = projectGridAxes(tabular, creatingSheetAxes);
                return (
                  <SheetGrid
                    entryRow={entryModel && entrySession ? { model: entryModel, session: entrySession, onEntryFocus: () => { setEntrySheetId(sheet.id); onClearSelection(); }, commands: {
                      change: (id, raw) => commands.changeEntryField(sheet.id, id, raw),
                      leave: (id) => commands.leaveEntryField(sheet.id, id),
                      dismiss: (id) => commands.dismissEntryFeedback(sheet.id, id),
                      submit: () => commands.submitEntryDraft(sheet.id),
                    } } : undefined}
                    interactionsEnabled={interactionsEnabled && extractionHandoff.handoff?.source.id !== sheet.id}
                    revealEnabled={extractionHandoff.handoff?.source.id !== sheet.id && extractionHandoff.handoff?.targetId !== sheet.id && extractionPresentation?.targetId !== sheet.id && gridPresentationReady && (!contentReveal.pending || contentReveal.ready)}
                    requireMeasuredViewport={modeActive}
                    ownsGridRestore={ownsGridRestore}
                    activeCellKey={cellKeyForTarget(sheet, activeCell)}
                    selectionTransition={selectionTransition}
                    activeSheetId={activeSheetId ?? null}
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
                    onUserViewportMovement={() => { recordUserGridMovement(); cancelNavigationBeforeUserMovement.current(); }}
                    historyRestore={gridPresentationReady ? historyRestoreForSheet(sheet.id) : undefined}
                    navigationRestoreGeneration={gridPresentationReady && !navigationRequest ? navigationRestoreForSheet(sheet.id) : undefined}
                    navigationRequestGeneration={gridPresentationReady ? navigationRequest?.generation : undefined}
                    navigationRequestCellKey={cellKeyForTarget(sheet, navigationRequestTarget)}
                    navigationRequestRange={navigationRequestRange}
                    onNavigationSettled={(generation) => acknowledgeGridRestore(sheet.id, generation)}
                    onNativeFocusTarget={handleDetailedNativeFocus}
                    cellInteraction={{
                      clear: (target) => { cancelNavigationBeforeUserMovement.current(); reportWriteOutcome(onClearCell(target)); },
                      navigate: (target, direction) => { cancelNavigationBeforeUserMovement.current(); onNavigateCell(target, direction); },
                      navigateKeyboard: (...args) => { cancelNavigationBeforeUserMovement.current(); return onNavigateKeyboardCell(...args); },
                      select: (...args) => { cancelNavigationBeforeUserMovement.current(); onSelectCell(...args); },
                      extend: (...args) => { cancelNavigationBeforeUserMovement.current(); onExtendSelection(...args); },
                      focusSelection: onFocusSelection,
                      settleSelectionGesture: onSettleSelectionGesture,
                      startEditing: (...args) => { cancelNavigationBeforeUserMovement.current(); onStartEdit(...args); },
                    }}
                    editingCell={sheetEditingCell}
                    editorInteraction={{
                      FormulaEditor: FormulaEditorPanel,
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
                    propertyNames: [...modelColumnPresentation(sheet, workbook.dataModels).columnLabels.values()],
                        referenceValues: (identity) => formulaPanelReferenceValues(identity, formulaResolver, formulaResults),
                        inspectionReferences: sheetEditingCell ? formulaInspection?.references : undefined,
                        referenceColors: formulaReferenceColors,
                        onReferenceHover: setHoveredReferenceSpan,
                        onReferenceModifierHover: setModifierReferenceSpan,
                        onReferenceNavigate: navigateReference,
                      },
                    }}
                    formulaResults={extractionHandoff.handoff?.source.id === sheet.id ? extractionFormulaSnapshot.current : formulaResults}
                    keyboardFocusRequest={gridPresentationReady && keyboardFocusRequest?.target.sheetId === sheet.id
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
                    historyRevealCells={contentReveal.feedback ? historyCellsForSheet(contentReveal.feedback, sheet) : historyFeedbackCells}
                    historyRevealReady={extractionHandoff.handoff?.source.id !== sheet.id && extractionHandoff.handoff?.targetId !== sheet.id && extractionPresentation?.targetId !== sheet.id && gridPresentationReady && contentReveal.ready}
                    historyFeedbackIdentity={contentReveal.feedback?.identity}
                    canRevealHistory={contentReveal.canReveal}
                    onHistoryRevealConsumed={contentReveal.consume}
                    scrollContainerRef={scrollContainerRef}
                    ownedScroll={extractionHandoff.handoff?.source.id === sheet.id && extractionScroll.current?.token === extractionHandoff.handoff.token ? extractionScroll.current.position : undefined}
                    selectedRange={selectedRange}
                    selectionMode={selectionRange?.anchor.sheetId === sheet.id ? selectionRange.mode : undefined}
                    onSelectAxis={(...args) => { cancelNavigationBeforeUserMovement.current(); onSelectAxis(...args); }}
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
