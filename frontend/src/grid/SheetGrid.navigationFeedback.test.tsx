import { FormulaEditorPanel } from '@application/react/FormulaEditorPanel';
import { createRef, type ComponentProps } from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';
import { useReferenceViewports } from '@app/useReferenceViewports';

function setup(rowCount = 30, columnCount = 10) {
  const document = sheetDocument({ id: 'target', name: 'Target', rowCount, columnCount,
    presentation: { rowHeights: { 'target:row:3': 70 }, columnWidths: { 'target:column:3': 160 } } });
  const sheet = tabularProjection(document);
  const scrollContainerRef = createRef<HTMLDivElement>();
  const props: ComponentProps<typeof SheetGrid> = {
    sheet, scrollContainerRef, presentation: document.presentation, axisProjection: projectGridAxes(sheet),
    activeCellKey: null, editingCell: null, formulaResults: {}, keyboardFocusRequest: null,
    onKeyboardFocusRequestConsumed: vi.fn(), navigationHighlightCellKey: null,
    cellInteraction: { clear: vi.fn(), navigate: vi.fn(), select: vi.fn(), startEditing: vi.fn() },
    editorInteraction: { FormulaEditor: FormulaEditorPanel, cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() },
  };
  const grid = (overrides: Partial<typeof props> = {}) => <div ref={scrollContainerRef} style={{ overflow: 'auto' }}>
    <SheetGrid {...props} axisProjection={projectGridAxes(sheet)} {...overrides} />
  </div>;
  const view = render(grid());
  const viewport = scrollContainerRef.current!;
  act(() => { virtualGridGeometry(viewport); });
  const cell = (key: string) => view.container.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
  return { ...view, viewport, cell, show: (overrides: Partial<typeof props>) => view.rerender(grid(overrides)) };
}

describe('reference-navigation range feedback', () => {
  it('measures the settled grid before a deferred resize observer report', () => {
    const { result, rerender } = renderHook(({ paused }) => useReferenceViewports(paused), { initialProps: { paused: false } });
    const { viewport, show } = setup();
    show({ onReferenceViewport: result.current.reportReferenceViewport });
    rerender({ paused: true });
    let width = 320;
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, get: () => width });
    fireEvent.scroll(viewport);
    width = 280;
    rerender({ paused: false });
    const settled = result.current.referenceGridViewports;
    expect(settled.target?.size.width).toBe(280);
    fireEvent.scroll(viewport);
    expect(result.current.referenceGridViewports).toBe(settled);
  });

  it('reports viewport changes and releases the old observer when its owner changes', () => {
    const { viewport, show, unmount } = setup();
    const first = vi.fn();
    const second = vi.fn();
    show({ onReferenceViewport: first });
    expect(first).toHaveBeenLastCalledWith('target', { scrollLeft: 0, scrollTop: 0, width: 240, height: 160 }, expect.any(Function));
    viewport.scrollLeft = 25;
    viewport.scrollTop = 30;
    fireEvent.scroll(viewport);
    expect(first).toHaveBeenLastCalledWith('target', { scrollLeft: 25, scrollTop: 30, width: 240, height: 160 }, expect.any(Function));
    act(() => { virtualGridGeometry(viewport, { width: 320, height: 180 }); });
    expect(first).toHaveBeenLastCalledWith('target', { scrollLeft: 25, scrollTop: 30, width: 320, height: 180 }, expect.any(Function));
    show({ onReferenceViewport: second });
    expect(first).toHaveBeenLastCalledWith('target', null);
    expect(second).toHaveBeenLastCalledWith('target', { scrollLeft: 25, scrollTop: 30, width: 320, height: 180 }, expect.any(Function));
    unmount();
    expect(second).toHaveBeenLastCalledWith('target', null);
  });

  it('attributes scrolling gestures to the user without treating editor keys as movement', () => {
    const { viewport, show } = setup();
    const moved = vi.fn();
    show({ onUserViewportMovement: moved });
    fireEvent.wheel(viewport);
    fireEvent.touchMove(viewport);
    fireEvent.keyDown(viewport, { key: 'PageDown' });
    fireEvent.keyDown(viewport, { key: 'a' });
    const editor = document.createElement('input');
    viewport.appendChild(editor);
    fireEvent.keyDown(editor, { key: 'PageDown' });
    expect(moved).toHaveBeenCalledTimes(3);
    editor.remove();
  });

  it('reports scrolling even without ResizeObserver', () => {
    const { viewport, show, unmount } = setup();
    const report = vi.fn();
    vi.stubGlobal('ResizeObserver', undefined);
    try {
      show({ onReferenceViewport: report });
      viewport.scrollTop = 40;
      fireEvent.scroll(viewport);
      expect(report).toHaveBeenLastCalledWith('target', { scrollLeft: 0, scrollTop: 40, width: 240, height: 160 }, expect.any(Function));
      unmount();
      expect(report).toHaveBeenLastCalledWith('target', null);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores missing and invalid navigation destinations without moving the viewport', () => {
    const { viewport, show } = setup();
    const settled = vi.fn();
    viewport.scrollTop = 30;
    show({ navigationRequestGeneration: 1, onNavigationSettled: settled });
    show({ navigationRequestGeneration: 2, navigationRequestCellKey: 'ZZ99999', onNavigationSettled: settled });
    expect(viewport.scrollTop).toBe(30);
    expect(settled).not.toHaveBeenCalled();
  });

  it('reveals a valid single-cell navigation destination', () => {
    const { viewport, show } = setup();
    const settled = vi.fn();
    show({ navigationRequestGeneration: 1, navigationRequestCellKey: 'C20', onNavigationSettled: settled });
    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(settled).toHaveBeenCalledWith(1);
  });

  it('does not reveal navigation ranges outside the sheet', () => {
    const { viewport, show } = setup();
    const settled = vi.fn();
    const outside = { rowIndex: 40, columnIndex: 0 };
    const inside = { rowIndex: 0, columnIndex: 0 };
    show({ navigationRequestGeneration: 1, navigationRequestRange: { start: outside, end: outside }, onNavigationSettled: settled });
    expect(settled).not.toHaveBeenCalled();
    show({ navigationHighlightIdentity: 2, navigationHighlightRange: { start: inside, end: outside } });
    expect(viewport.scrollTop).toBe(0);
    expect(settled).not.toHaveBeenCalled();
  });

  it('marks a rectangle with selection-owned perimeter without replacing focused cells', () => {
    const { cell, show, container } = setup();
    const range = { start: { rowIndex: 1, columnIndex: 1 }, end: { rowIndex: 3, columnIndex: 3 } };
    const feedback = { navigationHighlightRange: range, selectedRange: range, activeCellKey: 'B2', navigationHighlightIdentity: 1 };
    show(feedback);
    const anchor = cell('B2');
    anchor.focus();
    expect(container.querySelectorAll('[data-navigation-highlight="true"]')).toHaveLength(9);
    expect(cell('C3')).toHaveClass('sheet-grid-cell-range-selected', 'sheet-grid-cell-navigation-target');
    expect(cell('C3').className).not.toMatch(/sheet-grid-selection-(top|bottom|left|right)/);
    expect(anchor).toHaveClass('sheet-grid-selection-top', 'sheet-grid-selection-left', 'sheet-grid-cell-active');
    expect(cell('D4')).toHaveClass('sheet-grid-selection-bottom', 'sheet-grid-selection-right');
    expect(cell('A1')).not.toHaveAttribute('data-navigation-highlight');
    const target = cell('C3');
    show({ ...feedback, navigationHighlightRange: { ...range } });
    expect(cell('C3')).toBe(target);
    show({ ...feedback, navigationHighlightIdentity: 2 });
    expect(cell('C3')).toBe(target);
    expect(target).toHaveAttribute('data-navigation-highlight', 'true');
    expect(cell('B2')).toBe(anchor);
    expect(anchor).toHaveFocus();
    show({ activeCellKey: 'B2', selectedRange: range });
    expect(container.querySelector('[data-navigation-highlight="true"]')).toBeNull();
    expect(cell('C3')).toHaveClass('sheet-grid-cell-range-selected');
  });

  it('replaces a single-cell highlight without disturbing history feedback', () => {
    const { cell, show } = setup();
    const historyFeedbackCells = new Map([['A1', { before: 'old', beforeDisplay: 'old', after: 'new' }]]);
    show({ navigationHighlightCellKey: 'C3', navigationHighlightIdentity: 1, historyFeedbackCells });
    expect(cell('C3')).toHaveAttribute('data-navigation-highlight', 'true');
    expect(cell('A1')).toHaveClass('sheet-grid-cell-history-replacement');
    show({ navigationHighlightCellKey: 'D4', navigationHighlightIdentity: 2, historyFeedbackCells });
    expect(cell('C3')).not.toHaveAttribute('data-navigation-highlight');
    expect(cell('D4')).toHaveAttribute('data-navigation-highlight', 'true');
    expect(cell('A1')).toHaveAttribute('data-history-feedback', 'true');
  });

  it('shares history reveal: preserves visible axes and does not replay after range allocations', () => {
    const { viewport, show } = setup();
    act(() => { virtualGridGeometry(viewport, { width: 400, height: 160 }); });
    viewport.scrollLeft = 100;
    fireEvent.scroll(viewport);
    const range = { start: { rowIndex: 19, columnIndex: 2 }, end: { rowIndex: 20, columnIndex: 3 } };
    show({ navigationHighlightRange: range, navigationHighlightIdentity: 1 });
    expect(viewport.scrollLeft).toBe(100);
    expect(viewport.scrollTop).toBeGreaterThan(0);
    viewport.scrollLeft = 500;
    viewport.scrollTop = 400;
    fireEvent.scroll(viewport);
    show({ navigationHighlightRange: { ...range }, navigationHighlightIdentity: 1 });
    expect(viewport.scrollLeft).toBe(500);
    expect(viewport.scrollTop).toBe(400);
    show({ navigationHighlightRange: range, navigationHighlightIdentity: 2 });
    expect(viewport.scrollLeft).not.toBe(500);
    expect(viewport.scrollTop).not.toBe(400);
  });

  it('keeps a huge partially virtualized range bounded with custom axis geometry', () => {
    const { container, cell, show } = setup(10_000, 100);
    const range = { start: { rowIndex: 2, columnIndex: 2 }, end: { rowIndex: 9_999, columnIndex: 99 } };
    show({ selectedRange: range, navigationHighlightRange: range, navigationHighlightIdentity: 1 });
    expect(container.querySelectorAll('[data-cell-key]').length).toBeLessThan(1_000);
    expect(cell('C3')).toHaveStyle({ width: '160px', height: '70px' });
    expect(cell('CV10000')).toHaveAttribute('data-navigation-highlight', 'true');
    expect(cell('CV10000')).toHaveClass('sheet-grid-selection-bottom', 'sheet-grid-selection-right');
    expect(cell('D4').className).not.toMatch(/sheet-grid-selection-(top|bottom|left|right)/);
  });
});
