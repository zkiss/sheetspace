import type { RefObject } from 'react';
import type { CellRange } from '@workbook/core/address';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import type { AxisSizeWrite, DataModel, SheetPresentation, SheetTabularProjection } from '@workbook/core/model';
import type { GridAxisProjection } from './gridAxisProjection';
import type { EntryCommands } from './ModelEntryRow';
import type { EntrySessionState } from '@application/core/modelEntrySession';
import type { CellEditSession, CellSelection, CellSelectionMode, CellTarget, SelectionGesture } from './cellInteractionContracts';
import type { SheetGridCellInteraction } from './SheetGridCell';
import type { SheetGridCellEditorInteraction } from './SheetGridCellEditor';
import type { GridAxisMetrics } from './gridAxisMetrics';

type SheetGridAxisMetrics = { readonly columns: GridAxisMetrics; readonly rows: GridAxisMetrics };

export type SheetGridProps = {
  entryRow?: { model: DataModel; session: EntrySessionState; commands: EntryCommands; onEntryFocus?: () => void };
  presentation?: SheetPresentation;
  logicalSelection?: CellSelection | null;
  onWriteAxisSizes?: (writes: readonly AxisSizeWrite[]) => void;
  onGatherAxis?: (axis: 'row' | 'column', ids: readonly string[], gap: number) => void;
  allowColumnGather?: boolean;
  modelId?: string;
  interactionsEnabled?: boolean;
  /** Keeps this grid mounted while a live pointer session owns it. */
  onPointerInteractionChange?: (sheetId: string, active: boolean) => void;
  /** Publishes native ownership only after focus reaches a concrete cell. */
  onNativeFocusTarget?: (target: CellTarget) => void;
  pendingCutCells?: ReadonlySet<string>;
  columnLabels?: ReadonlyMap<string, string>;
  calculatedColumnIds?: ReadonlySet<string>;
  /** Announces the committed scroll container to workspace integrations. */
  onScrollContainerAvailable?: (element: HTMLElement | null) => void;
  /** Reports positively identified user scroll input to the spatial history owner. */
  onUserViewportMovement?: () => void;
  historyRestore?: { generation: number; left: number; top: number };
  navigationRestoreGeneration?: number;
  navigationRequestGeneration?: number; navigationRequestCellKey?: string | null; navigationRequestRange?: CellRange;
  /** Acknowledges either final saved-scroll restoration or an explicit reveal. */
  onNavigationSettled?: (generation: number) => void;
  /** Publishes real detailed-grid viewport changes for workspace reference geometry. */
  onReferenceViewport?: (sheetId: string, viewport: { scrollLeft: number; scrollTop: number; width: number; height: number } | null, measure?: () => { scrollLeft: number; scrollTop: number; width: number; height: number }) => void;
  activeCellKey: string | null;
  selectionTransition?: { from: CellTarget; to: CellTarget; id: number } | null;
  /**
   * The sheet that currently owns logical selection/focus.  A mounted grid may
   * remain visible after ownership moves to another sheet, so its pointer
   * session must not continue dispatching into the shared selection state.
   */
  activeSheetId?: string | null;
  axisMetrics?: SheetGridAxisMetrics;
  axisProjection: GridAxisProjection;
  cellInteraction: SheetGridCellInteraction;
  editorInteraction: SheetGridCellEditorInteraction;
  editingCell: CellEditSession | null;
  keyboardFocusRequest: { id: number; targetKey: string | null } | null;
  onKeyboardFocusRequestConsumed: (requestId: number) => void;
  navigationHighlightCellKey: string | null;
  navigationHighlightRange?: CellRange;
  /** One reference-navigation action, independent of range/projection allocations. */
  navigationHighlightIdentity?: number;
  historyFeedbackCells?: ReadonlyMap<string, { before: string | null; beforeDisplay: string | null; after: string | null }>;
  historyRevealCells?: ReadonlyMap<string, { before: string | null; beforeDisplay: string | null; after: string | null }>;
  canRevealHistory?: (sheetId: string, identity: string) => boolean;
  revealEnabled?: boolean;
  requireMeasuredViewport?: boolean;
  ownsGridRestore?: (sheetId: string, generation: number) => boolean;
  /** Identity of the undo/redo action, independent of feedback map/projection allocations. */
  historyFeedbackIdentity?: string;
  historyRevealReady?: boolean;
  onHistoryRevealConsumed?: (sheetId: string, identity: string) => void;
  formulaResults: FormulaEvaluationSnapshot;
  scrollContainerRef: RefObject<HTMLElement>;
  ownedScroll?: { left: number; top: number };
  selectionMode?: CellSelectionMode;
  /** Controlled selection owner; omitted only by consumers without shared interaction state. */
  selectionOwner?: symbol | null;
  sheet: SheetTabularProjection;
  selectedRange?: CellRange;
  onSelectAxis?: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture, intent?: 'plain' | 'extend' | 'toggle') => void;
  /** Clipboard operations are owned by the application, while this grid owns DOM routing. */
  clipboardInteraction?: {
    copy: () => { text: string; marker: string } | undefined;
    cut?: () => { text: string; marker: string } | undefined;
    paste: (clipboard: { text: string; marker?: string }) => void;
    cancelCut?: () => void;
  };
};
