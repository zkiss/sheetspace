import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetFrame } from './SheetFrame';
import { sheetDocument } from './test/workbookFactories';
import { frameProjection } from './workbookQueries';

afterEach(cleanup);

function testFrame() {
  return frameProjection(sheetDocument({ id: 'sheet-inputs', name: 'Inputs' }));
}

describe('SheetFrame', () => {
  it('owns frame interactions while rendering supplied body content', () => {
    const interactions = {
      onOpenSheetMenu: vi.fn(),
      onResizeCancel: vi.fn(),
      onResizeMove: vi.fn(),
      onResizeStart: vi.fn(),
      onResizeStop: vi.fn(),
      onSheetFrameDragCancel: vi.fn(),
      onSheetFrameDragMove: vi.fn(),
      onSheetFrameDragStart: vi.fn(),
      onSheetFrameDragStop: vi.fn(),
      onSheetFrameInteraction: vi.fn(),
    };
    const frame = testFrame();

    render(
      <SheetFrame
        columnCount={4}
        frame={frame}
        isActiveSheet
        isNavigationReveal={false}
        {...interactions}
        rowCount={6}
      >
        {() => <table aria-label="Inputs grid" />}
      </SheetFrame>,
    );

    const sheetFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    fireEvent.contextMenu(sheetFrame);
    fireEvent.pointerDown(sheetFrame);
    fireEvent.pointerDown(screen.getByTestId('sheet-frame-header'));
    fireEvent.pointerDown(screen.getByRole('separator', { name: /from right$/ }));

    expect(interactions.onOpenSheetMenu).toHaveBeenCalledWith('sheet-inputs', expect.anything());
    expect(interactions.onSheetFrameInteraction).toHaveBeenCalled();
    expect(interactions.onSheetFrameDragStart).toHaveBeenCalledWith('sheet-inputs', expect.anything());
    expect(interactions.onResizeStart).toHaveBeenCalledWith(
      'sheet-inputs',
      { horizontal: 1, vertical: 0 },
      expect.anything(),
    );
    expect(screen.getByRole('table', { name: 'Inputs grid' })).toBeInTheDocument();
    expect(sheetFrame).toHaveAttribute('data-column-count', '4');
    expect(sheetFrame).toHaveAttribute('data-row-count', '6');
  });
});
