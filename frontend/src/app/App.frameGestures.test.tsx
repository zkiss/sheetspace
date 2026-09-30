import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { measuredElementGeometry } from '@test-support/domGeometry';
import { zoomWorkspace } from '@test-support/workspaceActions';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function pointer(target: Element, type: string, clientX = 100) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX, clientY: 100 });
  Object.defineProperty(event, 'pointerId', { value: 17 });
  fireEvent(target, event);
}

describe('frame gesture rendering ownership', () => {
  it('drags an initially miniature frame without revealing a grid and keeps its capture owner through culling', async () => {
    render(<App initialWorkbook={workbookWithSheets([
      sheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.25, position: { x: 48, y: 96 } }),
    ])} />);
    const surface = screen.getByTestId('workspace-surface');
    const geometry = measuredElementGeometry(surface, { width: 800, height: 600 });
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const header = within(frame).getByTestId('sheet-frame-header');
    const capture = new Set<number>();
    header.setPointerCapture = vi.fn((id) => { capture.add(id); });
    header.hasPointerCapture = (id) => capture.has(id);
    header.releasePointerCapture = vi.fn((id) => { capture.delete(id); });

    expect(frame).toHaveAttribute('data-rendering-mode', 'overview');
    pointer(header, 'pointerdown');
    expect(capture.has(17)).toBe(true);
    expect(frame).toHaveAttribute('data-rendering-mode', 'overview');
    expect(within(frame).queryByTestId('sheet-grid')).not.toBeInTheDocument();

    pointer(header, 'pointermove', 150);
    expect(frame).toHaveAttribute('data-position-x', '98');
    expect(frame).toHaveAttribute('data-rendering-mode', 'overview');
    // Release the header activation's pending grid focus so only the live drag
    // owns the culling pin, not a separate keyboard-focus request.
    screen.getByRole('button', { name: 'New sheet' }).focus();
    act(() => { geometry.resize({ width: 0, height: 0 }); });
    expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toBe(frame);
    expect(within(frame).queryByTestId('sheet-grid')).not.toBeInTheDocument();
    expect(header.hasPointerCapture(17)).toBe(true);

    pointer(header, 'pointerup', 150);
    expect(capture.size).toBe(0);
    await waitFor(() => expect(frame).not.toBeInTheDocument());
    act(() => { geometry.resize({ width: 800, height: 600 }); });
    const remounted = await screen.findByRole('article', { name: 'Sheet Inputs' });
    expect(remounted).toHaveAttribute('data-position-x', '98');
    expect(remounted).toHaveAttribute('data-rendering-mode', 'overview');
    expect(within(remounted).queryByTestId('sheet-grid')).not.toBeInTheDocument();
  });

  it('reveals detail only when actual scale requires it, then retains that body until the drag ends', async () => {
    render(<App initialWorkbook={workbookWithSheets([
      sheetDocument({ id: 'inputs', name: 'Inputs', visualScale: 0.25 }),
    ])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const header = within(frame).getByTestId('sheet-frame-header');
    pointer(header, 'pointerdown');
    expect(frame).toHaveAttribute('data-rendering-mode', 'overview');
    zoomWorkspace('in', 8);
    await waitFor(() => expect(frame).toHaveAttribute('data-rendering-mode', 'detailed'));
    const grid = within(frame).getByTestId('sheet-grid');
    zoomWorkspace('out', 8);
    expect(frame).toHaveAttribute('data-rendering-mode', 'detailed');
    expect(within(frame).getByTestId('sheet-grid')).toBe(grid);
    pointer(header, 'pointerup');
    await waitFor(() => expect(frame).toHaveAttribute('data-rendering-mode', 'overview'));
    expect(grid).not.toBeInTheDocument();
  });
});
