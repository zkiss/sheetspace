import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SheetFrame } from './SheetFrame';
import { WorkspaceSurface } from './WorkspaceSurface';
import { frameProjection } from '@workbook/read/queries';
import { sheetDocument } from '@test-support/workbookFactories';
import { createRef, type RefObject } from 'react';
import type { SheetPresentation } from './maximiseGeometry';

const frame = frameProjection(sheetDocument({ id: 'one', name: 'One' }));
const viewport = { x: 40, y: -20, scale: 0.5 };
const start: SheetPresentation = { frame: { left: 60, top: 30, width: 200, height: 160 }, body: { left: 61, top: 50, width: 198, height: 139 }, tableScale: 0.5, chrome: 1 };
const middle: SheetPresentation = { frame: { left: 30, top: 15, width: 500, height: 380 }, body: { left: 30.5, top: 25, width: 499, height: 370 }, tableScale: 0.75, chrome: 0.5 };
const end: SheetPresentation = { frame: { left: 0, top: 0, width: 800, height: 600 }, body: { left: 0, top: 0, width: 800, height: 600 }, tableScale: 1, chrome: 0 };

function harness(sample?: SheetPresentation, conceal = false, viewportScale = viewport.scale) {
  const noop = vi.fn();
  let scrollRef: RefObject<HTMLDivElement> | undefined;
  const content = (sample?: SheetPresentation, conceal = false) => <WorkspaceSurface hasSheets isPanningWorkspace={false} navigationMotion={false} viewport={viewport} workspacePlaneRef={createRef()} workspaceSurfaceRef={createRef()} concealBackground={conceal} concealPeers={conceal}>
    <SheetFrame frame={frame} columnCount={2} rowCount={2} viewportScale={viewportScale} isActiveSheet isNavigationReveal={false}
      presentation={sample ? { sample, viewport } : undefined} retainDetailedBody
      onOpenSheetMenu={noop} onResizeCancel={noop} onResizeMove={noop} onResizeStart={noop} onResizeStop={noop}
      onSheetFrameDragCancel={noop} onSheetFrameDragMove={noop} onSheetFrameDragStart={noop} onSheetFrameDragStop={noop} onSheetFrameInteraction={noop} onSelectSheet={noop}>
      {(ref) => { scrollRef = ref; return <input aria-label="editor" />; }}
    </SheetFrame>
  </WorkspaceSurface>;
  const result = render(content(sample, conceal));
  return { ...result, update: (sample?: SheetPresentation, conceal = false) => result.rerender(content(sample, conceal)), scrollRef: () => scrollRef, noop };
}

describe('retained presentation', () => {
  it('forces the extraction source into detail without starting target chrome and starts chrome only on readiness', () => {
    const noop = vi.fn();
    const content = (source: boolean, target: boolean, ready: boolean) => <SheetFrame
      frame={frame} columnCount={2} rowCount={2} viewportScale={0.01} isActiveSheet isNavigationReveal={false}
      extractionSource={source} extractionHandoff={target} extractionReady={ready} extractionWaitingZIndex={-1} presentation={{ sample: start, viewport }}
      onOpenSheetMenu={noop} onResizeCancel={noop} onResizeMove={noop} onResizeStart={noop} onResizeStop={noop}
      onSheetFrameDragCancel={noop} onSheetFrameDragMove={noop} onSheetFrameDragStart={noop} onSheetFrameDragStop={noop} onSheetFrameInteraction={noop} onSelectSheet={noop}>
      {() => <span>cell content</span>}
    </SheetFrame>;
    const view = render(content(true, false, false));
    const article = screen.getByTestId('sheet-frame');
    expect(article).toHaveAttribute('data-rendering-mode', 'detailed');
    expect(article).not.toHaveClass('sheet-frame-extraction-handoff');
    expect(screen.getByTestId('sheet-frame-header')).toHaveStyle({ opacity: '1' });
    view.rerender(content(false, true, false));
    expect(article).toHaveClass('sheet-frame-extraction-handoff');
    expect(article).not.toHaveClass('sheet-frame-extraction-ready');
    expect(screen.getByTestId('sheet-frame-header').style.opacity).toBe('');
    expect(article).toHaveStyle({ zIndex: '-1' });
    expect(screen.getByText('cell content')).toBeVisible();
    view.rerender(content(false, true, true));
    expect(article).toHaveClass('sheet-frame-extraction-ready');
    expect(screen.getByTestId('sheet-frame-header').style.opacity).toBe('');
    expect(article).toHaveStyle({ zIndex: String(frame.zIndex) });
    expect(screen.getByText('cell content')).toBeVisible();
  });

  it('projects sampled surface geometry through the transformed plane and preserves the editor through the round trip', () => {
    const view = harness(start, true);
    const article = screen.getByTestId('sheet-frame');
    const body = screen.getByTestId('sheet-frame-body');
    const editor = screen.getByLabelText('editor');
    editor.focus();
    expect(article).toHaveStyle({ left: '40px', top: '100px', transform: 'scale(2)', width: '200px' });
    expect(body).toHaveStyle({ left: '1px', top: '20px', width: '396px', transform: 'scale(0.5)' });
    expect(view.scrollRef()?.current).toBe(body);
    expect(screen.queryByTestId('sheet-frame-resize-handle')).not.toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId('sheet-frame-header'));
    expect(view.noop).toHaveBeenCalledTimes(1);
    expect(article).toHaveAttribute('data-z-index', String(frame.zIndex));
    expect(screen.getByTestId('workspace-plane')).toHaveAttribute('data-conceal-peers', 'true');
    view.update(middle, true);
    expect(body).toHaveStyle({ transform: 'scale(0.75)' });
    expect(screen.getByLabelText('editor')).toBe(editor);
    expect(editor).toHaveFocus();
    view.update(end, true);
    expect(body).toHaveStyle({ left: '0px', top: '0px', width: '800px', height: '600px', transform: 'scale(1)' });
    expect(screen.getByTestId('sheet-frame-header')).toHaveStyle({ height: '0px', opacity: '0' });
    view.update(start, true);
    view.update();
    expect(screen.getByLabelText('editor')).toBe(editor);
    expect(view.scrollRef()?.current).toBe(body);
    expect(editor).toHaveFocus();
    expect(screen.getAllByTestId('sheet-frame-resize-handle')).toHaveLength(8);
  });

  it('forces detail from overview and independently applies body scale at intermediate and full bounds', () => {
    const view = harness(middle, false, 0.01);
    const body = screen.getByTestId('sheet-frame-body');
    const editor = screen.getByLabelText('editor');
    editor.focus();
    expect(body).toHaveStyle({ transform: 'scale(0.75)' });
    expect(body).toHaveAttribute('data-rendering-mode', 'detailed');
    expect(screen.getByTestId('sheet-frame-header')).toHaveStyle({ opacity: '0.5' });
    expect(editor).toHaveFocus();
    expect(end.body.left).toBe(0);
    view.unmount();
  });
});
