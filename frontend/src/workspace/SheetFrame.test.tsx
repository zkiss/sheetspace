import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SheetFrame } from '@workspace/SheetFrame';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { frameProjection } from '@workbook/read/queries';
import { useSheetFrameInteractions } from '@workspace/useSheetFrameInteractions';

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

  it('keeps the inverse-scaled handle outside the clipped sheet body at miniature combined scale', () => {
    const interactions = {
      onOpenSheetMenu: vi.fn(), onResizeCancel: vi.fn(), onResizeMove: vi.fn(), onResizeStart: vi.fn(), onResizeStop: vi.fn(),
      onScaleInputCancel: vi.fn(), onScalePointerCancel: vi.fn(), onScaleCommit: vi.fn(), onScaleMove: vi.fn(), onScalePreview: vi.fn(), onScaleInputStart: vi.fn(), onScaleStart: vi.fn(), onScaleStop: vi.fn(),
      onSheetFrameDragCancel: vi.fn(), onSheetFrameDragMove: vi.fn(), onSheetFrameDragStart: vi.fn(), onSheetFrameDragStop: vi.fn(), onSheetFrameInteraction: vi.fn(),
    };
    const frame = { ...testFrame(), visualScale: 0.25 };

    render(
      <SheetFrame columnCount={4} frame={frame} isActiveSheet isNavigationReveal={false} {...interactions} rowCount={6} viewportScale={0.5}>
        {() => <table aria-label="Inputs grid" />}
      </SheetFrame>,
    );

    const body = screen.getByTestId('sheet-frame-body');
    const controls = screen.getByTestId('sheet-frame-controls');
    const handle = screen.getByTestId('sheet-frame-scale-handle');

    expect(controls).toContainElement(handle);
    expect(body).not.toContainElement(handle);
    expect(handle).toHaveStyle({ transform: 'scale(8)' });

    // The handle remains in the unclipped frame layer even though it protrudes
    // beyond the clipped scroll body, so its full stable-size target is usable.
    fireEvent.pointerDown(handle);
    expect(interactions.onScaleStart).toHaveBeenCalledWith('sheet-inputs', expect.anything());
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

  it('keeps a scale-handle drag alive when its pointerdown precedes numeric input blur', () => {
    const setSheetVisualScale = vi.fn();
    const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
    const workbook = workbookWithSheets([sheet]);

    function FrameWithInteractions() {
      const interactions = useSheetFrameInteractions({
        commands: {
          moveSheetFrame: vi.fn(),
          resizeSheetFrame: vi.fn(),
          setSheetVisualScale,
        },
        viewportScale: 1,
        workbook,
      });
      const persistedFrame = frameProjection(sheet);
      const frame = interactions.frameScalePreview?.sheetId === sheet.id
        ? { ...persistedFrame, visualScale: interactions.frameScalePreview.visualScale }
        : persistedFrame;

      return (
        <>
          <output data-testid="scale-preview">
            {interactions.frameScalePreview?.visualScale ?? 'none'}
          </output>
          <output data-testid="scale-pin">{interactions.interactionPinnedSheetId ?? 'none'}</output>
          <SheetFrame
            columnCount={4}
            frame={frame}
            isActiveSheet
            isNavigationReveal={false}
            onOpenSheetMenu={vi.fn()}
            onResizeCancel={vi.fn()}
            onResizeMove={vi.fn()}
            onResizeStart={vi.fn()}
            onResizeStop={vi.fn()}
            onScaleInputCancel={interactions.cancelSheetFrameScaleInput}
            onScalePointerCancel={interactions.cancelSheetFrameScalePointer}
            onScaleCommit={interactions.commitSheetFrameScale}
            onScaleMove={interactions.handleSheetFrameScaleMove}
            onScalePreview={interactions.previewSheetFrameScale}
            onScaleInputStart={interactions.startSheetFrameScaleInput}
            onScaleStart={interactions.handleSheetFrameScaleStart}
            onScaleStop={interactions.stopSheetFrameScale}
            onSheetFrameDragCancel={vi.fn()}
            onSheetFrameDragMove={vi.fn()}
            onSheetFrameDragStart={vi.fn()}
            onSheetFrameDragStop={vi.fn()}
            onSheetFrameInteraction={vi.fn()}
            rowCount={6}
            viewportScale={1}
          >
            {() => <table aria-label="Inputs grid" />}
          </SheetFrame>
        </>
      );
    }

    render(<FrameWithInteractions />);
    const input = screen.getByRole('spinbutton', { name: 'Scale sheet Inputs percentage' });
    const scaleHandle = screen.getByTestId('sheet-frame-scale-handle');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '150' } });
    expect(screen.getByTestId('scale-preview')).toHaveTextContent('1.5');

    // Browsers dispatch the handle pointerdown before blurring the focused input.
    fireEvent(scaleHandle, new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 100, clientY: 0,
    }));
    fireEvent.blur(input);
    expect(screen.getByTestId('scale-preview')).toHaveTextContent('1');
    expect(screen.getByTestId('scale-pin')).toHaveTextContent('sheet-inputs');
    expect(setSheetVisualScale).not.toHaveBeenCalled();

    fireEvent(scaleHandle, new MouseEvent('pointermove', {
      bubbles: true, clientX: 200, clientY: 0,
    }));
    expect(screen.getByTestId('scale-preview')).toHaveTextContent('2');
    expect(screen.getByTestId('scale-pin')).toHaveTextContent('sheet-inputs');

    fireEvent(scaleHandle, new MouseEvent('pointerup', {
      bubbles: true, clientX: 200, clientY: 0,
    }));
    expect(setSheetVisualScale).toHaveBeenCalledTimes(1);
    expect(setSheetVisualScale).toHaveBeenCalledWith('sheet-inputs', 2);
  });
});
