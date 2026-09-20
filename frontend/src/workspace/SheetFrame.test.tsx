import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetFrame } from '@workspace/SheetFrame';
import { sheetDocument } from '@test-support/workbookFactories';
import { frameProjection } from '@workbook/read/queries';

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
      onScaleInputCancel: vi.fn(),
      onScalePointerCancel: vi.fn(),
      onScaleCommit: vi.fn(),
      onScaleMove: vi.fn(),
      onScalePreview: vi.fn(),
      onScaleInputStart: vi.fn(),
      onScaleStart: vi.fn(),
      onScaleStop: vi.fn(),
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
        viewportScale={1}
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

  it('synchronizes handle commits, commits numeric previews on Enter, and cancels blur', () => {
    const interactions = {
      onOpenSheetMenu: vi.fn(), onResizeCancel: vi.fn(), onResizeMove: vi.fn(), onResizeStart: vi.fn(), onResizeStop: vi.fn(),
      onScaleInputCancel: vi.fn(), onScalePointerCancel: vi.fn(), onScaleCommit: vi.fn(), onScaleMove: vi.fn(), onScalePreview: vi.fn(), onScaleInputStart: vi.fn(), onScaleStart: vi.fn(), onScaleStop: vi.fn(),
      onSheetFrameDragCancel: vi.fn(), onSheetFrameDragMove: vi.fn(), onSheetFrameDragStart: vi.fn(), onSheetFrameDragStop: vi.fn(), onSheetFrameInteraction: vi.fn(),
    };
    const frame = testFrame();
    const renderFrame = (currentFrame = frame) => (
      <SheetFrame columnCount={4} frame={currentFrame} isActiveSheet isNavigationReveal={false} {...interactions} rowCount={6} viewportScale={1}>
        {() => <table aria-label="Inputs grid" />}
      </SheetFrame>
    );
    const { rerender } = render(renderFrame());
    const input = screen.getByRole('spinbutton', { name: 'Scale sheet Inputs percentage' });

    fireEvent.pointerDown(screen.getByTestId('sheet-frame-scale-handle'));
    fireEvent.pointerUp(screen.getByTestId('sheet-frame-scale-handle'));
    rerender(renderFrame({ ...frame, visualScale: 2 }));
    expect(input).toHaveValue(200);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);
    expect(interactions.onScalePreview).toHaveBeenLastCalledWith('sheet-inputs', 9.99);
    expect(interactions.onScaleCommit).not.toHaveBeenCalled();
    expect(interactions.onScaleInputCancel).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(200);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(interactions.onScaleCommit).toHaveBeenLastCalledWith('sheet-inputs', 8);
    expect(input).toHaveValue(800);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(interactions.onScaleInputCancel).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue(200);
  });

  it('cancels an in-progress numeric preview when its control unmounts', () => {
    const interactions = {
      onOpenSheetMenu: vi.fn(), onResizeCancel: vi.fn(), onResizeMove: vi.fn(), onResizeStart: vi.fn(), onResizeStop: vi.fn(),
      onScaleInputCancel: vi.fn(), onScalePointerCancel: vi.fn(), onScaleCommit: vi.fn(), onScaleMove: vi.fn(), onScalePreview: vi.fn(), onScaleInputStart: vi.fn(), onScaleStart: vi.fn(), onScaleStop: vi.fn(),
      onSheetFrameDragCancel: vi.fn(), onSheetFrameDragMove: vi.fn(), onSheetFrameDragStart: vi.fn(), onSheetFrameDragStop: vi.fn(), onSheetFrameInteraction: vi.fn(),
    };
    const frame = testFrame();
    const renderFrame = (isActiveSheet: boolean) => (
      <SheetFrame columnCount={4} frame={frame} isActiveSheet={isActiveSheet} isNavigationReveal={false} {...interactions} rowCount={6} viewportScale={1}>
        {() => <table aria-label="Inputs grid" />}
      </SheetFrame>
    );
    const { rerender } = render(renderFrame(true));
    const input = screen.getByRole('spinbutton', { name: 'Scale sheet Inputs percentage' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '150' } });
    rerender(renderFrame(false));

    expect(interactions.onScaleInputStart).toHaveBeenCalledWith('sheet-inputs');
    expect(interactions.onScalePreview).toHaveBeenCalledWith('sheet-inputs', 1.5);
    expect(interactions.onScaleInputCancel).toHaveBeenCalledTimes(1);
    expect(interactions.onScaleCommit).not.toHaveBeenCalled();
  });
});
