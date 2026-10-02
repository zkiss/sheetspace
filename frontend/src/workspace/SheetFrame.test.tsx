import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SheetFrame } from './SheetFrame';
import { sheetDocument } from '@test-support/workbookFactories';
import { frameProjection } from '@workbook/read/queries';
import { SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE } from './sheetRenderingMode';
import { SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE } from '@workbook/core/sheetRenderingPolicy';
import { useRef, type RefObject } from 'react';
import { useWorkspaceGestures } from './useWorkspaceGestures';

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
  it('shares the body scrollport with its grid and leaves wheel defaults eligible even at edges', () => {
    const interactions = props();
    const actions = { start: vi.fn(), pan: vi.fn(), zoom: vi.fn(), closeMenu: vi.fn(), clearSelection: vi.fn() };
    const parentWheel = vi.fn();
    let scrollRef: RefObject<HTMLDivElement>;
    function Harness() {
      const surface = useRef<HTMLElement>(null);
      useWorkspaceGestures(surface, actions);
      return <section ref={surface} onWheel={parentWheel}>
        <SheetFrame {...interactions}>{(ref) => {
          scrollRef = ref;
          return <div role="cell">Cell</div>;
        }}</SheetFrame>
      </section>;
    }
    render(<Harness />);
    const body = screen.getByTestId('sheet-frame-body');
    expect(scrollRef!.current).toBe(body);
    expect(body).toHaveClass('sheet-frame-body');
    for (const [property, value] of [['clientWidth', 100], ['clientHeight', 100], ['scrollWidth', 300], ['scrollHeight', 300]] as const) {
      Object.defineProperty(body, property, { configurable: true, value });
    }
    // JSDOM does not execute native wheel scrolling. Exercise eligibility at
    // representative start/interior/end offsets without emulating defaults.
    for (const offset of [0, 100, body.scrollWidth - body.clientWidth]) {
      body.scrollLeft = offset;
      body.scrollTop = offset;
      for (const [deltaMode, deltaX, deltaY] of [[0, 80, 0], [1, 0, -3], [2, 1, 1]]) {
        const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode, deltaX, deltaY });
        fireEvent(screen.getByRole('cell'), event);
        expect(event.defaultPrevented).toBe(false);
      }
    }
    for (const target of [body, screen.getByTestId('sheet-frame-header'), screen.getByRole('separator', { name: /from right$/ })]) {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 80, deltaY: 100 });
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(parentWheel).not.toHaveBeenCalled();
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
    expect(interactions.onSheetFrameInteraction).not.toHaveBeenCalled();
    expect(interactions.onSelectSheet).not.toHaveBeenCalled();
  });

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

  it('keeps nested native content and consumed right-clicks out of the sheet menu', () => {
    const interactions = props();
    render(<SheetFrame {...interactions}>{() => <>
      <input aria-label="Native editor" />
      <section data-workspace-native-content><code>Native formula text</code></section>
      <div role="menu"><span>Menu label</span></div>
      <div onContextMenu={(event) => event.preventDefault()}>Consumed content</div>
    </>}</SheetFrame>);
    for (const target of [screen.getByRole('textbox'), screen.getByText('Native formula text'), screen.getByText('Menu label')]) {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(false);
    }
    fireEvent.contextMenu(screen.getByText('Consumed content'));
    expect(interactions.onOpenSheetMenu).not.toHaveBeenCalled();
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
