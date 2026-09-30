import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SheetFrame } from './SheetFrame';
import { sheetDocument } from '@test-support/workbookFactories';
import { frameProjection } from '@workbook/read/queries';
import { SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE } from './sheetRenderingMode';
import { SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE } from '@workbook/core/sheetRenderingPolicy';

function props() {
  return {
    columnCount: 4, rowCount: 6, viewportScale: 1,
    frame: frameProjection(sheetDocument({ id: 'sheet-inputs', name: 'Inputs' })),
    isActiveSheet: true, isNavigationReveal: false,
    onOpenSheetMenu: vi.fn(), onResizeCancel: vi.fn(), onResizeMove: vi.fn(),
    onResizeStart: vi.fn(), onResizeStop: vi.fn(), onSelectSheet: vi.fn(),
    onSheetFrameDragCancel: vi.fn(), onSheetFrameDragMove: vi.fn(),
    onSheetFrameDragStart: vi.fn(), onSheetFrameDragStop: vi.fn(), onSheetFrameInteraction: vi.fn(),
  };
}

describe('SheetFrame compact shell', () => {
  it('activates the sheet from its header and routes frame and resize interactions', () => {
    const interactions = props();
    render(<SheetFrame {...interactions}>{() => <table aria-label="Inputs grid" />}</SheetFrame>);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    fireEvent.contextMenu(frame);
    fireEvent(screen.getByTestId('sheet-frame-header'), new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(interactions.onSelectSheet).toHaveBeenCalledOnce();
    expect(interactions.onSheetFrameDragStart).toHaveBeenCalledWith('sheet-inputs', expect.anything());
    expect(interactions.onOpenSheetMenu).toHaveBeenCalledWith('sheet-inputs', expect.anything());
    const right = screen.getByRole('separator', { name: /from right$/ });
    fireEvent(right, new MouseEvent('pointerdown', { bubbles: true, ctrlKey: true }));
    expect(interactions.onResizeStart).toHaveBeenCalledWith('sheet-inputs', { horizontal: 1, vertical: 0 }, expect.objectContaining({ ctrlKey: true }));
    fireEvent.pointerMove(right);
    fireEvent.pointerUp(right);
    fireEvent.pointerCancel(right);
    expect(interactions.onResizeMove).toHaveBeenCalledOnce();
    expect(interactions.onResizeStop).toHaveBeenCalledOnce();
    expect(interactions.onResizeCancel).toHaveBeenCalledOnce();
    expect(frame).toHaveAttribute('data-column-count', '4');
    expect(frame).toHaveAttribute('data-row-count', '6');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('does not activate a sheet from a non-primary header pointer', () => {
    const interactions = props();
    render(<SheetFrame {...interactions}>{() => null}</SheetFrame>);
    fireEvent(screen.getByTestId('sheet-frame-header'), new MouseEvent('pointerdown', { bubbles: true, button: 2 }));
    expect(interactions.onSelectSheet).not.toHaveBeenCalled();
  });

  it('keeps all resize targets stable in screen size and outside the clipped miniature body', () => {
    const interactions = props();
    render(<SheetFrame {...interactions} frame={{ ...interactions.frame, visualScale: 0.25 }} viewportScale={0.5}>{() => null}</SheetFrame>);
    const body = screen.getByTestId('sheet-frame-body');
    for (const handle of screen.getAllByRole('separator')) expect(body).not.toContainElement(handle);
    expect(screen.getByRole('separator', { name: /from top$/ })).toHaveStyle({ transform: 'scaleY(8)' });
    expect(screen.getByRole('separator', { name: /from right$/ })).toHaveStyle({ transform: 'scaleX(8)' });
    expect(screen.getByRole('separator', { name: /from bottom-right$/ })).toHaveStyle({ transform: 'scale(8)' });
  });

  it('switches only the body at the effective-scale hysteresis boundaries', () => {
    const interactions = props();
    const frame = (scale: number) => <SheetFrame {...interactions} viewportScale={scale} overview={<button>Overview</button>}>{() => <table aria-label="Inputs grid" />}</SheetFrame>;
    const { rerender } = render(frame(SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE + 0.01));
    expect(screen.getByRole('table')).toBeInTheDocument();
    rerender(frame(SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    rerender(frame(SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE - 0.01));
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    rerender(frame(SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('retains the detailed owner during an interaction and hands displaced focus through overview once', async () => {
    const interactions = props();
    const displaced = vi.fn();
    const available = vi.fn();
    const frame = (scale: number, retain = false) => <SheetFrame {...interactions} viewportScale={scale} retainDetailedBody={retain} onDetailedFocusDisplaced={displaced} onDetailedBodyAvailable={available} overview={<button>Overview</button>}>{() => <button>Cell</button>}</SheetFrame>;
    const { rerender } = render(frame(1));
    screen.getByRole('button', { name: 'Cell' }).focus();
    rerender(frame(SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE, true));
    expect(screen.getByRole('button', { name: 'Cell' })).toBeInTheDocument();
    rerender(frame(SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE));
    await waitFor(() => expect(screen.getByTestId('sheet-frame-body')).toHaveFocus());
    expect(displaced).toHaveBeenCalledOnce();
    rerender(frame(SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE));
    expect(available).toHaveBeenCalled();
  });
});
