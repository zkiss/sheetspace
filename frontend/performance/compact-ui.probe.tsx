import { Profiler, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as identity from '@workbook/core/cellIdentity';
import * as numberFormat from '@workbook/core/numberFormat';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from '@app/App';
import { frameProjection, tabularProjection } from '@workbook/read/queries';
import { SheetGridCell } from '@grid/SheetGridCell';
import { NumberFormatControls } from '@workspace/NumberFormatControls';
import { SheetFrame } from '@workspace/SheetFrame';
import { useWorkspaceGestures } from '@workspace/useWorkspaceGestures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('counts stationary and transform-only moving editor work after mount', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback); return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const step = () => act(() => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach((callback) => callback(0));
  });
  const sheet = sheetDocument({ id: 'editor', name: 'Editor', rowCount: 1, columnCount: 1 });
  const target = { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } };
  let commits = 0;
  const component = (editing: boolean) => <Profiler id="editor" onRender={() => commits++}>
    <SheetGridCell cellKey="A1" columnIndex={1} displayText="Draft" isActive isEditing={editing}
      sheet={tabularProjection(sheet)} editingCell={editing ? { target, draft: 'Draft' } : null}
      cellInteraction={{ clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() }}
      editorInteraction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }} />
  </Profiler>;
  const view = render(component(false));
  let left = 40;
  const measure = vi.spyOn(screen.getByRole('cell'), 'getBoundingClientRect')
    .mockImplementation(() => new DOMRect(left, 60, 90, 26));
  view.rerender(component(true));
  // Both revisions receive the same initial scroll notification: the old
  // inline ref is detached during child mount, so its editor otherwise stays
  // absent until scroll/resize. Mount costs are excluded from the counts.
  fireEvent.scroll(window);
  const editor = screen.getByRole('textbox');
  expect(editor).toHaveFocus();
  measure.mockClear(); commits = 0;
  for (let frame = 0; frame < 120; frame++) step();
  const stationary = { reads: measure.mock.calls.length, commits };
  measure.mockClear(); commits = 0;
  for (let frame = 0; frame < 5; frame++) { left += 10; step(); }
  console.log(JSON.stringify({ scenario: 'editor', stationary, moving: {
    reads: measure.mock.calls.length, commits, followsAnchor: editor.style.left === `${left}px`,
  } }));
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(editor).toHaveFocus();
});

it('counts a 200x200 toolbar render and five frame-only drag-preview rerenders', () => {
  const sheet = sheetDocument({ id: 'format', name: 'Format', rowCount: 200, columnCount: 200 });
  const selection = { mode: 'cells' as const,
    anchor: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } },
    extent: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[199]!, columnId: sheet.content.columns[199]! } },
  };
  const keys = vi.spyOn(identity, 'cellIdentityKey');
  const component = (x: number) => <NumberFormatControls sheet={{ ...sheet, frame: { ...sheet.frame, position: { x, y: 0 } } }}
    selection={selection} onWrite={vi.fn()} />;
  const view = render(component(0));
  const initial = keys.mock.calls.length;
  keys.mockClear();
  for (let x = 1; x <= 5; x++) view.rerender(component(x));
  console.log(JSON.stringify({ scenario: 'toolbar-200x200', initialKeys: initial, fiveFrameOnlyRerenderKeys: keys.mock.calls.length }));
  expect(screen.getByRole('button', { name: 'Number format' })).toBeEnabled();
});

it('counts ordinary sheet wheel and portal zoom ownership routing', () => {
  const actions = { start: vi.fn(), pan: vi.fn(), zoom: vi.fn(), closeMenu: vi.fn(), clearSelection: vi.fn() };
  function Harness() {
    const ref = useRef<HTMLElement>(null);
    useWorkspaceGestures(ref, actions);
    return <><section ref={ref} data-testid="surface">
      {Array.from({ length: 100 }, (_, index) => <article data-workspace-sheet-frame data-sheet-id={`sheet-${index}`} key={index}>
        <div data-testid={`cell-${index}`} />
      </article>)}
    </section><textarea data-workspace-sheet-editor="sheet-99" aria-label="Portal" /></>;
  }
  render(<Harness />);
  const surface = screen.getByTestId('surface');
  const closest = vi.spyOn(Element.prototype, 'closest');
  const queries = vi.spyOn(surface, 'querySelectorAll');
  for (let index = 0; index < 100; index++) fireEvent(screen.getByTestId('cell-99'),
    new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }));
  const sheet = { closest: closest.mock.calls.length, frameQueries: queries.mock.calls.length };
  closest.mockClear(); queries.mockClear();
  for (let index = 0; index < 100; index++) fireEvent(screen.getByRole('textbox'),
    new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));
  console.log(JSON.stringify({ scenario: 'routing-100-events-100-frames', sheet, portal: {
    closest: closest.mock.calls.length, frameQueries: queries.mock.calls.length, zooms: actions.zoom.mock.calls.length,
  } }));
  expect(actions.pan).not.toHaveBeenCalled();
});

it('counts toolbar property scans during an actual large-selection header drag', () => {
  const sheet = sheetDocument({ id: 'drag', name: 'Drag', rowCount: 200, columnCount: 200 });
  render(<App initialWorkbook={workbookWithSheets([sheet])} />);
  const first = screen.getByRole('cell', { name: 'Drag A1 empty cell' });
  fireEvent.click(first);
  fireEvent.keyDown(first, { key: 'ArrowRight', ctrlKey: true, shiftKey: true });
  const active = document.querySelector<HTMLElement>('[data-active-cell="true"]')!;
  const resolve = vi.spyOn(numberFormat, 'resolveAppearanceProperty');
  fireEvent.keyDown(active, { key: 'ArrowDown', ctrlKey: true, shiftKey: true });
  const selectionPropertyReads = resolve.mock.calls.length;
  expect(selectionPropertyReads).toBeGreaterThanOrEqual(5 * 200 * 200);
  resolve.mockClear();
  const header = screen.getByTestId('sheet-frame-header');
  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX });
    Object.assign(event, { pointerId: 17 }); fireEvent(header, event);
  };
  pointer('pointerdown', 0);
  const start = resolve.mock.calls.length;
  resolve.mockClear();
  for (let frame = 1; frame <= 5; frame++) pointer('pointermove', frame * 10);
  const previews = resolve.mock.calls.length;
  resolve.mockClear();
  pointer('pointerup', 50);
  console.log(JSON.stringify({ scenario: 'app-header-drag-200x200', selectionPropertyReads, startPropertyReads: start,
    fivePreviewPropertyReads: previews, releasePropertyReads: resolve.mock.calls.length }));
  expect(screen.getByTestId('sheet-frame')).toHaveAttribute('data-position-x', '50');
});

it('counts detail rendering under scale retention from detailed and overview starts', () => {
  const sheet = sheetDocument({ id: 'frame', name: 'Frame' });
  const children = vi.fn(() => <div data-testid="detail">Detail</div>);
  const props = { columnCount: 10, rowCount: 20, frame: frameProjection(sheet), isActiveSheet: true, isNavigationReveal: false,
    onOpenSheetMenu: vi.fn(), onResizeCancel: vi.fn(), onResizeMove: vi.fn(), onResizeStart: vi.fn(), onResizeStop: vi.fn(),
    onSelectSheet: vi.fn(), onSheetFrameDragCancel: vi.fn(), onSheetFrameDragMove: vi.fn(), onSheetFrameDragStart: vi.fn(),
    onSheetFrameDragStop: vi.fn(), onSheetFrameInteraction: vi.fn(),
  };
  const component = (scale: number, retain: boolean) => <SheetFrame {...props} viewportScale={scale}
    retainDetailedBody={retain} overview={<div>Overview</div>}>{children}</SheetFrame>;
  const view = render(component(1, false));
  children.mockClear();
  for (let index = 0; index < 5; index++) view.rerender(component(0.01, true));
  const detailedStart = children.mock.calls.length;
  view.unmount(); children.mockClear();
  const overview = render(component(0.01, false));
  for (let index = 0; index < 5; index++) overview.rerender(component(0.01, true));
  console.log(JSON.stringify({ scenario: 'detail-retention-five-previews', detailedStart, overviewStart: children.mock.calls.length }));
});
