import { createRef, type ComponentProps } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';

function setup() {
  const sheet = tabularProjection(sheetDocument({ id: 'history', name: 'History', rowCount: 30, columnCount: 10 }));
  const axisProjection = projectGridAxes(sheet);
  const scrollContainerRef = createRef<HTMLDivElement>();
  const onUserViewportMovement = vi.fn();
  const onHistoryRestoreSettled = vi.fn();
  const props: ComponentProps<typeof SheetGrid> = {
    activeCellKey: null, axisProjection, sheet, scrollContainerRef,
    cellInteraction: { clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() },
    editingCell: null,
    editorInteraction: { cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() },
    formulaResults: {}, keyboardFocusRequest: null, onKeyboardFocusRequestConsumed: vi.fn(), navigationHighlightCellKey: null, onUserViewportMovement,
  };
  const grid = (target?: string, identity = 'undo-1', historyRestore?: { generation: number; left: number; top: number }, navigationRevealGeneration?: number | null, navigationTarget?: string) => <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
    <SheetGrid {...props} axisProjection={projectGridAxes(sheet)} historyFeedbackIdentity={target ? identity : undefined}
      historyFeedbackCells={target ? new Map([[target, { before: 'old', beforeDisplay: 'old', after: 'new' }]]) : undefined}
      historyRestore={historyRestore} navigationHighlightCellKey={navigationTarget ?? null} navigationHighlightIdentity={navigationTarget ? Number(identity) : undefined}
      navigationRevealGeneration={navigationRevealGeneration} onHistoryRestoreSettled={onHistoryRestoreSettled} />
  </div>;
  const view = render(grid());
  const viewport = scrollContainerRef.current!;
  act(() => { virtualGridGeometry(viewport); });
  return { viewport, sheet, onHistoryRestoreSettled, onUserViewportMovement, reveal: (target: string, identity?: string) => view.rerender(grid(target, identity)), restore: (historyRestore: { generation: number; left: number; top: number }) => view.rerender(grid(undefined, undefined, historyRestore)), renderNavigationTarget: (target: string, generation: number | null) => view.rerender(grid(undefined, '9', undefined, generation, target)) };
}

describe('history reveal scroll-axis independence', () => {
  it('does not mistake programmatic reveal scroll events for user movement', () => {
    const { viewport, onUserViewportMovement } = setup();

    viewport.scrollTop = 400;
    fireEvent.scroll(viewport);

    expect(onUserViewportMovement).not.toHaveBeenCalled();
    fireEvent.wheel(viewport, { deltaY: 100 });
    expect(onUserViewportMovement).toHaveBeenCalledOnce();
  });

  it('acknowledges a generation only after applying its final saved scroll', () => {
    const { viewport, onHistoryRestoreSettled, restore } = setup();
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1_000 },
      scrollWidth: { configurable: true, value: 1_000 },
    });

    restore({ generation: 7, left: 240, top: 360 });

    expect(viewport.scrollLeft).toBe(240);
    expect(viewport.scrollTop).toBe(360);
    expect(onHistoryRestoreSettled).toHaveBeenCalledWith(7);
  });

  it('reveals once per action, not per feedback map or axis projection allocation', () => {
    const { viewport, reveal } = setup();
    reveal('A1');
    viewport.scrollLeft = 500;
    viewport.scrollTop = 400;
    fireEvent.scroll(viewport);
    reveal('A1');
    expect(viewport.scrollLeft).toBe(500);
    expect(viewport.scrollTop).toBe(400);
    // A genuine redo at the same address must reveal again, even before expiry.
    reveal('A1', 'redo-2');
    expect(viewport.scrollLeft).toBe(0);
    expect(viewport.scrollTop).toBe(0);
  });

  it('does not reveal a delayed reference target after its shared operation is cancelled', () => {
    const { viewport, onHistoryRestoreSettled, renderNavigationTarget } = setup();
    viewport.scrollLeft = 500;
    viewport.scrollTop = 400;

    // The reference highlight can remain visible during its tint lifetime, but
    // the operation was cancelled before this delayed grid mounted.
    renderNavigationTarget('A1', null);

    expect(viewport.scrollLeft).toBe(500);
    expect(viewport.scrollTop).toBe(400);
    expect(onHistoryRestoreSettled).not.toHaveBeenCalled();
  });

  it.each([
    { target: 'C20', left: 100, top: 0, movesX: false, movesY: true },
    { target: 'I3', left: 0, top: 30, movesX: true, movesY: false },
    { target: 'C3', left: 100, top: 400, movesX: false, movesY: true },
    { target: 'A3', left: 500, top: 30, movesX: true, movesY: false },
    { target: 'C3', left: 100, top: 30, movesX: false, movesY: false },
    { target: 'I20', left: 0, top: 0, movesX: true, movesY: true },
    // Cells partly covered by either sticky header still need revealing.
    { target: 'C3', left: 160, top: 30, movesX: true, movesY: false },
    { target: 'C3', left: 100, top: 60, movesX: false, movesY: true },
    { target: 'C3', left: 160, top: 60, movesX: true, movesY: true },
    { target: 'J30', left: 0, top: 0, movesX: true, movesY: true },
  ])('reveals $target from ($left, $top) only on obscured axes', ({ target, left, top, movesX, movesY }) => {
    const { viewport, reveal } = setup();
    viewport.scrollLeft = left;
    viewport.scrollTop = top;
    fireEvent.scroll(viewport);
    reveal(target);
    if (movesX) expect(viewport.scrollLeft).not.toBe(left);
    else expect(viewport.scrollLeft).toBe(left);
    if (movesY) expect(viewport.scrollTop).not.toBe(top);
    else expect(viewport.scrollTop).toBe(top);
    const cell = viewport.querySelector<HTMLElement>(`[data-cell-key="${target}"]`)!;
    const row = cell.parentElement!;
    const visibleLeft = Number.parseFloat(cell.style.left) - viewport.scrollLeft;
    const visibleTop = Number.parseFloat(row.style.top) - viewport.scrollTop;
    expect(visibleLeft).toBeGreaterThanOrEqual(40);
    expect(visibleTop).toBeGreaterThanOrEqual(26.4 - 1e-9);
    expect(visibleLeft + Number.parseFloat(cell.style.width)).toBeLessThanOrEqual(viewport.clientWidth + 1e-9);
    expect(visibleTop + Number.parseFloat(row.style.height)).toBeLessThanOrEqual(viewport.clientHeight + 1e-9);
  });
});
