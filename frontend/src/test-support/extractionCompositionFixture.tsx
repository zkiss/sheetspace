import { act, render } from '@testing-library/react';
import { useRef, useState, type MutableRefObject } from 'react';
import { vi } from 'vitest';
import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { sheetDocument, workbookWithLegacyFormulaFixtures } from '@test-support/workbookFactories';
import { testRect, virtualGridGeometry } from '@test-support/domGeometry';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { createSheetGridAxisMetrics } from '@grid/gridAxisMetrics';
import { SheetGrid } from '@grid/SheetGrid';
import { SheetFrame } from '@workspace/SheetFrame';
import { SheetOverview } from '@workspace/SheetOverview';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';
import { extractionStacking } from '@workspace/extractionStacking';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from '@grid/gridGeometry';
import { SHEET_HEADER_HEIGHT } from '@workspace/workspaceGeometry';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { parseA1Address } from '@workbook/core/address';
import type { CellSelection } from '@grid/cellInteractionContracts';
import type { SheetDocument, Workbook } from '@workbook/core/model';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { frameProjection, sheetsInOrder, tabularProjection, tabularCellsByA1 } from '@workbook/read/queries';
import type { CellRange } from '@workbook/core/address';
import { useExtractionHandoff } from '@app/useExtractionHandoff';
import { useExtractionPaintCoverage } from '@app/useExtractionPaintCoverage';
import { extractionRequest } from '@app/extractionRequest';
import { extractionFeedback } from '@app/extractionFeedback';
import { selectionAddressRange } from '@app/workspaceSelection';

// JSDOM has no layout, so the tests report deterministic rectangles for the
// rendered surface, frames, bodies, corners and cells. The values are derived
// from the same axis metrics and scroll offsets the coverage model consumes.
export const SURFACE_SIZE = { width: 2000, height: 1200 };
export const SOURCE_SCROLL = { left: 0, top: 26 };
export const SOURCE_ID = 'source';
export const TARGET_ID = '00000000-0000-4000-8000-000000000001';
export const PEER_ID = 'peer';
const noop = () => {};

const formulaResults: FormulaEvaluationSnapshot = {
  source: { A4: { kind: 'number', value: 42, display: '42' } },
};

function frameSizeOf(sheet: SheetDocument) {
  return {
    width: Math.max(1, sheet.frame.size.width - 2),
    height: Math.max(1, sheet.frame.size.height - 2 - SHEET_HEADER_HEIGHT),
  };
}

function bodyOriginOf(sheet: SheetDocument) {
  return { left: sheet.frame.position.x + 1, top: sheet.frame.position.y + 1 + SHEET_HEADER_HEIGHT };
}

function mockCompositionGeometry(
  surface: HTMLElement,
  documents: readonly SheetDocument[],
  scrolls: Map<string, { left: number; top: number }>,
) {
  surface.getBoundingClientRect = () => testRect({ left: 0, top: 0, ...SURFACE_SIZE });
  for (const sheet of documents) {
    const frame = surface.querySelector<HTMLElement>(`[data-sheet-id="${sheet.id}"]`);
    const body = frame?.querySelector<HTMLElement>('.sheet-frame-body');
    if (!frame || !body) continue;
    const { width, height } = frameSizeOf(sheet);
    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: height },
      clientWidth: { configurable: true, value: width },
      offsetHeight: { configurable: true, value: height },
      offsetWidth: { configurable: true, value: width },
    });
    const origin = bodyOriginOf(sheet);
    const scroll = scrolls.get(sheet.id) ?? { left: 0, top: 0 };
    body.scrollLeft = scroll.left;
    body.scrollTop = scroll.top;
    body.getBoundingClientRect = () => testRect({ left: origin.left, top: origin.top, width, height });
    const corner = frame.querySelector<HTMLElement>('.sheet-grid-corner');
    if (corner) {
      corner.getBoundingClientRect = () => testRect({
        left: origin.left, top: origin.top, width: GRID_ROW_HEADER_WIDTH, height: GRID_COLUMN_HEADER_HEIGHT,
      });
    }
    const projection = tabularProjection(sheet);
    const metrics = createSheetGridAxisMetrics(projectGridAxes(projection, { columns: [], rows: [] }), sheet.presentation);
    frame.querySelectorAll<HTMLElement>('[data-cell-key]').forEach((cell) => {
      const address = parseA1Address(cell.dataset.cellKey!);
      if (!address.ok) return;
      const column = metrics.columns.itemOffset(address.value.columnIndex) ?? 0;
      const row = metrics.rows.itemOffset(address.value.rowIndex) ?? 0;
      const cellWidth = metrics.columns.itemSize(address.value.columnIndex) ?? 0;
      const cellHeight = metrics.rows.itemSize(address.value.rowIndex) ?? 0;
      cell.getBoundingClientRect = () => testRect({
        left: origin.left + GRID_ROW_HEADER_WIDTH + column - scroll.left,
        top: origin.top + GRID_COLUMN_HEADER_HEIGHT + row - scroll.top,
        width: cellWidth,
        height: cellHeight,
      });
    });
  }
}

export function shiftTargetCells(surface: HTMLElement, offset: number) {
  surface.querySelectorAll<HTMLElement>(`[data-sheet-id="${TARGET_ID}"] [data-cell-key]`).forEach((cell) => {
    const original = cell.getBoundingClientRect.bind(cell);
    cell.getBoundingClientRect = () => {
      const base = original();
      return testRect({ left: base.left + offset, top: base.top, width: base.width, height: base.height });
    };
  });
}

function sourceSheet(overrides: Partial<Parameters<typeof sheetDocument>[0]> = {}) {
  return sheetDocument({
    id: SOURCE_ID, name: 'Source', rowCount: 6, columnCount: 4,
    cells: { A2: 'two', A3: 'three', A4: '=1+1' },
    position: { x: 100, y: 100 }, zIndex: 5, frameSize: { width: 420, height: 280 },
    ...overrides,
  });
}

function peerSheet() {
  return sheetDocument({
    id: PEER_ID, name: 'Peer', rowCount: 6, columnCount: 4,
    cells: { B2: 'peer' },
    position: { x: 100, y: 100 }, zIndex: 2, frameSize: { width: 420, height: 280 },
  });
}

export function buildWorkbook(sourceOverrides?: Parameters<typeof sourceSheet>[0]) {
  return workbookWithLegacyFormulaFixtures([sourceSheet(sourceOverrides), peerSheet()]);
}

function deterministicIds() {
  let counter = 0;
  return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}

export function framesInZOrder(surface: HTMLElement) {
  return [...surface.querySelectorAll<HTMLElement>('[data-workspace-sheet-frame]')]
    .sort((left, right) => Number(left.style.zIndex) - Number(right.style.zIndex))
    .map((frame) => frame.getAttribute('data-sheet-id'));
}

export function frameElement(surface: HTMLElement, sheetId: string) {
  const frame = surface.querySelector<HTMLElement>(`[data-sheet-id="${sheetId}"]`);
  if (!frame) throw new Error(`Frame ${sheetId} is not mounted`);
  return frame;
}

export function cellElement(surface: HTMLElement, sheetId: string, cellKey: string) {
  const cell = surface.querySelector<HTMLElement>(`[data-sheet-id="${sheetId}"] [data-cell-key="${cellKey}"]`);
  if (!cell) throw new Error(`Cell ${cellKey} of ${sheetId} is not mounted`);
  return cell;
}

export function cellText(surface: HTMLElement, sheetId: string, cellKey: string) {
  return cellElement(surface, sheetId, cellKey).textContent;
}

type CompositionApi = {
  publish: (mode: CellSelection['mode'], fromKey: string, toKey: string) => void;
  bumpGeometryRevision: () => void;
  controller: ReturnType<typeof useWorkbookController>;
  documents: () => Readonly<Record<string, SheetDocument>>;
  scrolls: Map<string, { left: number; top: number }>;
};

type CompositionProps = {
  apiClient?: Parameters<typeof useWorkbookController>[0]['apiClient'];
  formulaResults?: FormulaEvaluationSnapshot;
  harnessRef: MutableRefObject<CompositionApi | null>;
  initialWorkbook: Workbook;
  onFeedback?: (message: string) => void;
  spies: {
    clear: ReturnType<typeof vi.fn>;
    navigate: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    startEditing: ReturnType<typeof vi.fn>;
  };
  sourceId?: string;
  viewportScale?: number;
};

function ExtractionComposition({
  apiClient, formulaResults: liveFormulaResults = formulaResults, harnessRef, initialWorkbook, onFeedback,
  spies, sourceId = SOURCE_ID, viewportScale = 1,
}: CompositionProps) {
  const controller = useWorkbookController({ initialWorkbook, ...(apiClient ? { apiClient } : {}) });
  const sheets = sheetsInOrder(controller.workbook);
  const owner = useExtractionHandoff(sheets.map((sheet) => sheet.id));
  const [geometryRevision, setGeometryRevision] = useState(0);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const planeRef = useRef<HTMLDivElement | null>(null);
  const bodiesRef = useRef(new Map<string, HTMLElement>());
  const scrollsRef = useRef(new Map<string, { left: number; top: number }>());
  const tokensRef = useRef(new WeakMap<object, number>());
  const capturedScrollRef = useRef<{ token: number; position: { left: number; top: number } } | null>(null);
  const capturedRangeRef = useRef<{ token: number; range: CellRange } | null>(null);
  const formulaSnapshotRef = useRef(liveFormulaResults);

  const paintOwner = owner.handoff;
  const operation = paintOwner && capturedRangeRef.current?.token === paintOwner.token
    ? {
        token: paintOwner.token, source: paintOwner.source, targetId: paintOwner.targetId,
        range: capturedRangeRef.current.range, ready: paintOwner.ready,
      }
    : null;
  useExtractionPaintCoverage(surfaceRef, operation, owner.targetReady, owner.targetNotReady, owner.cancel, geometryRevision);

  const publish = (mode: CellSelection['mode'], fromKey: string, toKey: string) => {
    const current = controller.workbook.documents[sourceId]!;
    const tabular = tabularProjection(current);
    const from = cellIdentityAt(tabular, fromKey);
    const to = cellIdentityAt(tabular, toKey);
    if (!from || !to) throw new Error(`Selection ${fromKey}..${toKey} is outside ${sourceId}`);
    const selection: CellSelection = { mode, anchor: { sheetId: sourceId, cell: from }, extent: { sheetId: sourceId, cell: to } };
    const body = bodiesRef.current.get(sourceId);
    const scroll = body ? { x: body.scrollLeft, y: body.scrollTop } : { x: 0, y: 0 };
    const newId = deterministicIds();
    const request = extractionRequest(controller.workbook, current, selection, scroll, current.frame.position, newId);
    if (!request) throw new Error('Extraction request was rejected');
    formulaSnapshotRef.current = liveFormulaResults;
    const token = owner.begin(current, request.targetSheetId);
    tokensRef.current.set(request, token);
    capturedScrollRef.current = { token, position: { left: scroll.x, top: scroll.y } };
    const range = selectionAddressRange(current, selection);
    capturedRangeRef.current = range ? { token, range } : null;
    const submission = controller.commands.extractSelection(request);
    if (!submission.result.ok) {
      owner.cancel(token);
      return;
    }
    owner.accepted(token);
    void submission.completion.then((result) => {
      const error = extractionFeedback(result);
      if (error) {
        owner.cancel(token);
        onFeedback?.(error);
      }
    }, () => {
      owner.cancel(token);
      onFeedback?.('The extraction could not be saved.');
    });
  };

  harnessRef.current = {
    publish,
    bumpGeometryRevision: () => setGeometryRevision((revision) => revision + 1),
    controller,
    documents: () => controller.workbook.documents,
    scrolls: scrollsRef.current,
  };

  const evaluatedResults: FormulaEvaluationSnapshot = Object.fromEntries(sheets.map((sheet) => [sheet.id, Object.fromEntries(
    Object.entries(tabularCellsByA1(sheet.content)).filter(([, raw]) => raw.startsWith('=')).map(([key]) => [key, { kind: 'number', value: 42, display: '42' }]),
  )]));
  const projectedFrames = sheets.map(frameProjection);
  const extractionSlots = owner.handoff ? extractionStacking(projectedFrames, owner.handoff.source.id) : undefined;
  const editorInteraction = {
    FormulaEditor: FormulaEditorPanel, cancel: noop, commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn(),
  };
  const frameHandlers = {
    onOpenSheetMenu: noop, onResizeCancel: noop, onResizeMove: noop, onResizeStart: noop, onResizeStop: noop,
    onSheetFrameDragCancel: noop, onSheetFrameDragMove: noop, onSheetFrameDragStart: noop, onSheetFrameDragStop: noop,
    onSheetFrameInteraction: noop, onSelectSheet: noop,
  };

  return (
    <WorkspaceSurface hasSheets isPanningWorkspace={false} navigationMotion={false}
      viewport={{ x: 0, y: 0, scale: viewportScale }} workspacePlaneRef={planeRef} workspaceSurfaceRef={surfaceRef}>
      {sheets.map((liveSheet) => {
        const sheet = owner.handoff?.source.id === liveSheet.id ? owner.handoff.source : liveSheet;
        const frame = frameProjection(liveSheet);
        const tabular = tabularProjection(sheet);
        const axisProjection = projectGridAxes(tabular, { columns: [], rows: [] });
        const isSnapshotSource = owner.handoff?.source.id === sheet.id;
        const interactionsEnabled = owner.handoff?.source.id !== sheet.id;
        const revealEnabled = owner.handoff?.source.id !== sheet.id && owner.handoff?.targetId !== sheet.id;
        return (
          <SheetFrame
            {...frameHandlers}
            columnCount={tabular.columns.length}
            extractionHandoff={owner.handoff?.targetId === sheet.id}
            extractionReady={owner.handoff?.ready}
            extractionSource={isSnapshotSource}
            extractionWaitingZIndex={extractionSlots?.waiting}
            frame={frame}
            isActiveSheet={false}
            isNavigationReveal={false}
            key={sheet.id}
            overview={<SheetOverview isActive={false} onSelect={noop} sheet={tabular} />}
            presentationZIndex={extractionSlots?.slots.get(sheet.id)}
            rowCount={tabular.rows.length}
            viewportScale={viewportScale}
          >
            {(scrollContainerRef) => (
              <SheetGrid
                activeCellKey={null}
                axisProjection={axisProjection}
                cellInteraction={{
                  clear: spies.clear, navigate: spies.navigate, select: spies.select, startEditing: spies.startEditing,
                }}
                editingCell={null}
                editorInteraction={editorInteraction}
                formulaResults={isSnapshotSource ? formulaSnapshotRef.current : evaluatedResults}
                interactionsEnabled={interactionsEnabled}
                keyboardFocusRequest={null}
                navigationHighlightCellKey={null}
                onKeyboardFocusRequestConsumed={noop}
                onScrollContainerAvailable={(element) => {
                  if (element) bodiesRef.current.set(sheet.id, element);
                  else bodiesRef.current.delete(sheet.id);
                }}
                ownedScroll={isSnapshotSource && capturedScrollRef.current?.token === owner.handoff?.token
                  ? capturedScrollRef.current?.position
                  : undefined}
                presentation={sheet.presentation}
                revealEnabled={revealEnabled}
                scrollContainerRef={scrollContainerRef}
                sheet={tabular}
              />
            )}
          </SheetFrame>
        );
      })}
    </WorkspaceSurface>
  );
}

export function renderComposition(props: Partial<Omit<CompositionProps, 'harnessRef'>> = {}) {
  const harnessRef: CompositionProps['harnessRef'] = { current: null };
  const spies = props.spies ?? { clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() };
  const view = render(
    <ExtractionComposition
      {...props}
      harnessRef={harnessRef}
      initialWorkbook={props.initialWorkbook ?? buildWorkbook()}
      spies={spies}
    />,
  );
  const surface = view.container.querySelector<HTMLElement>('[data-testid="workspace-surface"]')!;
  const api = () => {
    if (!harnessRef.current) throw new Error('Composition harness is not ready');
    return harnessRef.current;
  };
  const scrolls = new Map([[SOURCE_ID, { ...SOURCE_SCROLL }]]);
  const remock = () => mockCompositionGeometry(surface, Object.values(api().documents()), scrolls);
  return { ...view, api, remock, scrolls, surface, spies };
}

export function mountAndMeasure(result: ReturnType<typeof renderComposition>) {
  const { surface, scrolls, api } = result;
  act(() => {
    for (const body of surface.querySelectorAll<HTMLElement>('.sheet-frame-body')) {
      const frameWidth = Number(body.closest('[data-workspace-sheet-frame]')?.getAttribute('data-frame-width')) || 420;
      virtualGridGeometry(body, { width: Math.max(1, frameWidth - 2), height: 244 });
    }
    const source = surface.querySelector<HTMLElement>(`[data-sheet-id="${SOURCE_ID}"] .sheet-frame-body`);
    if (source) {
      source.scrollTop = SOURCE_SCROLL.top;
      source.scrollLeft = SOURCE_SCROLL.left;
    }
    mockCompositionGeometry(surface, Object.values(api().documents()), scrolls);
  });
  return result;
}
