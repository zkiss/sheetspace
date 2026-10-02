import { createRef, type ComponentProps } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { virtualGridGeometry } from '@test-support/domGeometry';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';
import { projectGridAxes } from './gridAxisProjection';
import { SheetGrid } from './SheetGrid';

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
    editorInteraction: { cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() },
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
  it('tints a rectangle with selection-owned perimeter only and restarts without replacing focused cells', () => {
    const { cell, show, container } = setup();
    const range = { start: { rowIndex: 1, columnIndex: 1 }, end: { rowIndex: 3, columnIndex: 3 } };
    const feedback = { navigationHighlightRange: range, selectedRange: range, activeCellKey: 'B2', navigationHighlightIdentity: 1 };
    show(feedback);
    const anchor = cell('B2');
    anchor.focus();
    expect(container.querySelectorAll('.sheet-grid-navigation-feedback')).toHaveLength(9);
    expect(cell('C3')).toHaveClass('sheet-grid-cell-range-selected', 'sheet-grid-cell-navigation-target');
    expect(cell('C3').className).not.toMatch(/sheet-grid-selection-(top|bottom|left|right)/);
    expect(anchor).toHaveClass('sheet-grid-selection-top', 'sheet-grid-selection-left', 'sheet-grid-cell-active');
    expect(cell('D4')).toHaveClass('sheet-grid-selection-bottom', 'sheet-grid-selection-right');
    expect(cell('A1')).not.toHaveAttribute('data-navigation-highlight');
    const oldTint = cell('C3').querySelector('span');
    show({ ...feedback, navigationHighlightRange: { ...range } });
    expect(cell('C3').querySelector('span')).toBe(oldTint);
    show({ ...feedback, navigationHighlightIdentity: 2 });
    expect(cell('C3').querySelector('span')).not.toBe(oldTint);
    expect(cell('B2')).toBe(anchor);
    expect(anchor).toHaveFocus();
    show({ activeCellKey: 'B2', selectedRange: range });
    expect(container.querySelector('.sheet-grid-navigation-feedback')).toBeNull();
    expect(cell('C3')).toHaveClass('sheet-grid-cell-range-selected');
  });

  it('replaces a single-cell highlight without disturbing history feedback', () => {
    const { cell, show } = setup();
    const historyFeedbackCells = new Map([['A1', { before: 'old', beforeDisplay: 'old', after: 'new' }]]);
    show({ navigationHighlightCellKey: 'C3', navigationHighlightIdentity: 1, historyFeedbackCells });
    expect(cell('C3').querySelector('.sheet-grid-navigation-feedback')).toHaveAttribute('aria-hidden', 'true');
    expect(cell('A1')).toHaveClass('sheet-grid-cell-history-replacement');
    show({ navigationHighlightCellKey: 'D4', navigationHighlightIdentity: 2, historyFeedbackCells });
    expect(cell('C3').querySelector('.sheet-grid-navigation-feedback')).toBeNull();
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
