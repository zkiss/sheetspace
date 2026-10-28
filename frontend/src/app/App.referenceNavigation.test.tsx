import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { openSheetContextMenu, workspaceSurface } from '@test-support/appScreen';
import { resetWorkspaceViewport, setSheetScale } from '@test-support/workspaceActions';
import { measuredElementGeometry, virtualGridGeometry } from '@test-support/domGeometry';
import { positionedSheet, sheetDocument, sparseLargeSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function modifierClickReference(modifier: 'ctrl' | 'meta' = 'ctrl') {
  const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.keyDown(source, { key: 'F2' });
  const editor = screen.getByRole('textbox', { name: 'Outputs A1 editor' });
  const token = document.querySelector<HTMLElement>('[data-reference-index="0"]')!;
  vi.spyOn(token, 'getClientRects').mockReturnValue([{ left: 10, right: 100, top: 10, bottom: 30 } as DOMRect] as unknown as DOMRectList);
  const options = { clientX: 20, clientY: 20, ...(modifier === 'ctrl' ? { ctrlKey: true } : { metaKey: true }) };
  fireEvent.mouseMove(editor, options);
  fireEvent.mouseDown(editor, options);
}

function setSurfaceSize(width: number, height: number) {
  return measuredElementGeometry(workspaceSurface(), { height, width });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('formula reference navigation', () => {
  it('shows a hovered editor reference and emphasizes it under either modifier', async () => {
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 400, y: 20 } });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', position: { x: 20, y: 20 }, cells: { A1: '=@inputs!B[2]' } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => {
      setSurfaceSize(800, 600);
      virtualGridGeometry(within(screen.getByRole('article', { name: 'Sheet Inputs' })).getByTestId('sheet-frame-body'), { height: 126, width: 238 });
      virtualGridGeometry(within(screen.getByRole('article', { name: 'Sheet Outputs' })).getByTestId('sheet-frame-body'), { height: 126, width: 238 });
    });
    const cell = screen.getByRole('cell', { name: 'Outputs A1 cell' });
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'F2' });
    const editor = screen.getByRole('textbox', { name: 'Outputs A1 editor' });
    const token = document.querySelector<HTMLElement>('[data-reference-index="0"]')!;
    vi.spyOn(token, 'getClientRects').mockReturnValue([{ left: 10, right: 100, top: 10, bottom: 30 } as DOMRect] as unknown as DOMRectList);

    expect(screen.queryByRole('button', { name: 'Navigate to @Inputs!B[2]' })).not.toBeInTheDocument();
    fireEvent.mouseMove(editor, { clientX: 20, clientY: 20 });
    await screen.findByRole('button', { name: 'Navigate to @Inputs!B[2]' });
    const line = document.querySelector('.contextual-reference-visible-line')!;
    expect(line).not.toHaveClass('contextual-reference-line-editor');
    fireEvent.mouseMove(editor, { clientX: 20, clientY: 20, ctrlKey: true });
    await waitFor(() => expect(line).toHaveClass('contextual-reference-line-editor'));
    fireEvent.mouseMove(editor, { clientX: 20, clientY: 20, metaKey: true });
    expect(line).toHaveClass('contextual-reference-line-editor');
    fireEvent.mouseLeave(editor);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Navigate to @Inputs!B[2]' })).not.toBeInTheDocument());
  });

  it('replaces contextual links for the current selection and clears them for a non-formula cell', async () => {
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 400, y: 20 } });
    const outputs = sheetDocument({
      id: 'outputs', name: 'Outputs', position: { x: 20, y: 20 },
      cells: { A1: '=@inputs!B[2]', B1: '=@inputs!A[1]', C1: 'plain text' },
    });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });

    act(() => {
      virtualGridGeometry(within(screen.getByRole('article', { name: 'Sheet Inputs' })).getByTestId('sheet-frame-body'), { height: 126, width: 238 });
      virtualGridGeometry(within(screen.getByRole('article', { name: 'Sheet Outputs' })).getByTestId('sheet-frame-body'), { height: 126, width: 238 });
    });
    const outputCells = within(screen.getByRole('article', { name: 'Sheet Outputs' }));
    fireEvent.click(outputCells.getByRole('cell', { name: 'Outputs A1 cell' }));
    fireEvent.keyDown(outputCells.getByRole('cell', { name: 'Outputs A1 cell' }), { key: 'F2' });
    fireEvent.click(screen.getByRole('button', { name: 'Show references' }));
    expect(await screen.findByRole('button', { name: 'Navigate to @Inputs!B[2]' })).toBeInTheDocument();

    fireEvent.click(outputCells.getByRole('cell', { name: 'Outputs B1 cell' }));
    fireEvent.keyDown(outputCells.getByRole('cell', { name: 'Outputs B1 cell' }), { key: 'F2' });
    expect(await screen.findByRole('button', { name: 'Navigate to @Inputs!A[1]' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Navigate to @Inputs!B[2]' })).not.toBeInTheDocument();

    fireEvent.click(outputCells.getByRole('cell', { name: 'Outputs C1 cell' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Navigate to @Inputs!A[1]' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Hide reference links' })).not.toBeInTheDocument();
  });

  it('keeps an active formula editor focus and caret while grid scrolling refreshes contextual geometry', async () => {
    const user = userEvent.setup();
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 400, y: 20 } });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', position: { x: 20, y: 20 }, cells: { A1: '=@inputs!B[2]' } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });

    const inputsBody = within(screen.getByRole('article', { name: 'Sheet Inputs' })).getByTestId('sheet-frame-body');
    act(() => {
      virtualGridGeometry(inputsBody, { height: 126, width: 238 });
      virtualGridGeometry(within(screen.getByRole('article', { name: 'Sheet Outputs' })).getByTestId('sheet-frame-body'), { height: 126, width: 238 });
    });
    const outputCell = within(screen.getByRole('article', { name: 'Sheet Outputs' })).getByRole('cell', { name: 'Outputs A1 cell' });
    await user.click(outputCell);
    await user.keyboard('{F2}');
    const editor = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
    fireEvent.change(editor, { target: { value: '=@inputs!A[1]' } });
    await waitFor(() => expect(document.querySelector('[data-reference-index="0"]')).toHaveTextContent('@inputs!A[1]'));
    editor.setSelectionRange(3, 8);

    inputsBody.scrollTop = 40;
    fireEvent.scroll(inputsBody);

    await act(async () => {});
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(3);
    expect(editor.selectionEnd).toBe(8);
  });

  it('updates contextual link geometry through real grid scrolling and follows a cross-sheet link through navigation history', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 400, y: 20 } });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', position: { x: 20, y: 20 }, cells: { A1: '=@inputs!B[2]' } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });

    const inputsBody = within(screen.getByRole('article', { name: 'Sheet Inputs' })).getByTestId('sheet-frame-body');
    const outputsFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const outputsBody = within(outputsFrame).getByTestId('sheet-frame-body');
    act(() => {
      virtualGridGeometry(inputsBody, { height: 126, width: 238 });
      virtualGridGeometry(outputsBody, { height: 126, width: 238 });
    });

    fireEvent.click(within(outputsFrame).getByRole('cell', { name: 'Outputs A1 cell' }));
    fireEvent.keyDown(within(outputsFrame).getByRole('cell', { name: 'Outputs A1 cell' }), { key: 'F2' });
    fireEvent.click(screen.getByRole('button', { name: 'Show references' }));
    await screen.findByRole('button', { name: 'Navigate to @Inputs!B[2]' });
    const canvas = document.querySelector<SVGElement>('.contextual-reference-canvas')!;
    const initialTargetX = canvas.querySelectorAll('line')[0]!.getAttribute('x2');
    expect(canvas.querySelector('rect')).toHaveAttribute('stroke', canvas.querySelector('line')!.getAttribute('stroke'));

    inputsBody.scrollTop = 40;
    fireEvent.scroll(inputsBody);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Navigate to @Inputs!B[2]' })).not.toBeInTheDocument());
    expect(within(outputsFrame).getByRole('cell', { name: 'Outputs A1 cell' })).toHaveAttribute('data-active-cell', 'true');

    inputsBody.scrollTop = 0;
    fireEvent.scroll(inputsBody);
    const restoredLink = await screen.findByRole('button', { name: 'Navigate to @Inputs!B[2]' });
    expect(canvas.querySelectorAll('line')[0]!.getAttribute('x2')).toBe(initialTargetX);
    fireEvent.click(restoredLink);
    expect(screen.getByRole('cell', { name: 'Inputs B2 empty cell' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('cell', { name: 'Outputs A1 cell' })).toHaveAttribute('data-active-cell', 'true');
  });

  it('reports an unmounted virtualized reference as a fallback instead of mounting its source sheet', async () => {
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 4_000, y: 3_000 } });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=@inputs!B[2]' } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    act(() => { virtualGridGeometry(within(screen.getByRole('article', { name: 'Sheet Outputs' })).getByTestId('sheet-frame-body'), { height: 126, width: 238 }); });
    fireEvent.keyDown(screen.getByRole('cell', { name: 'Outputs A1 cell' }), { key: 'F2' });
    fireEvent.click(screen.getByRole('button', { name: 'Show references' }));

    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();
    const link = await screen.findByRole('button', { name: 'Navigate to @Inputs!B[2]' });
    const marker = document.querySelector('.contextual-reference-offscreen-marker');
    expect(marker).toBeInTheDocument();
    expect(marker).toHaveAttribute('fill', document.querySelector('.contextual-reference-visible-line')?.getAttribute('stroke'));
    expect(link).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Outputs A1 editor' })).toHaveFocus();
  });

  it('captures and restores a delayed grid reference arrival only after Workspace motion settles', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const inputs = sheetDocument({
      id: 'inputs', name: 'Inputs', position: { x: 4_000, y: 3_000 }, rowCount: 30, columnCount: 10,
    });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=@inputs!J[30]' } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });

    const surface = workspaceSurface();
    const departure = [surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale];
    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClickReference();


    // The actual SheetGrid starts unavailable to the virtual window. Giving
    // it geometry drives its own virtualizer and focus lifecycle for J30.
    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const inputsBody = within(inputsFrame).getByTestId('sheet-frame-body');
    act(() => { virtualGridGeometry(inputsBody, { height: 160, width: 240 }); });
    Object.defineProperties(inputsBody, {
      scrollHeight: { configurable: true, value: 1_000 },
      scrollWidth: { configurable: true, value: 1_000 },
    });
    await act(async () => {});
    expect(screen.getByRole('cell', { name: 'Inputs J30 empty cell' })).toHaveFocus();
    expect(screen.getByTestId('workspace-plane')).toHaveAttribute('data-navigation-motion', 'smooth');

    act(() => { vi.advanceTimersByTime(179); });
    act(() => { vi.advanceTimersByTime(1); });

    const arrival = [surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale];
    const arrivalScroll = [inputsBody.scrollLeft, inputsBody.scrollTop];
    expect(arrival).not.toEqual(departure);
    expect(arrivalScroll[0]).toBeGreaterThan(0);
    expect(arrivalScroll[1]).toBeGreaterThan(0);

    // Highlight expiry is presentation-only: the settled request must already
    // be retired and leave the captured destination intact.
    act(() => { vi.advanceTimersByTime(1_200); });
    expect([inputsBody.scrollLeft, inputsBody.scrollTop]).toEqual(arrivalScroll);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    act(() => { vi.advanceTimersByTime(180); });
    expect([surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale]).toEqual(departure);
    expect(screen.getByRole('cell', { name: 'Outputs A1 cell' })).toHaveAttribute('data-active-cell', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    act(() => { vi.advanceTimersByTime(180); });
    fireEvent.scroll(inputsBody);
    await act(async () => {});
    expect([surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale]).toEqual(arrival);
    expect(screen.getByRole('cell', { name: 'Inputs J30 empty cell' })).toHaveAttribute('data-active-cell', 'true');
    expect([inputsBody.scrollLeft, inputsBody.scrollTop]).toEqual(arrivalScroll);
  });

  it('keeps an outer zoom after cancelling a smooth reference restoration', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 4_000, y: 3_000 } });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=@inputs!B[2]' } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClickReference();
    fireEvent.wheel(workspaceSurface(), { ctrlKey: true, deltaY: -120, clientX: 300, clientY: 200 });
    expect(Number(workspaceSurface().dataset.viewportScale)).toBeGreaterThan(1);

    // Drain the cancelled operation after the controller has synchronously
    // invalidated it, including its delayed motion/reveal work.
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(Number(workspaceSurface().dataset.viewportScale)).toBeGreaterThan(1);
  });

  it('records an empty-sheet palette jump so Back restores the prior context', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const source = sheetDocument({ id: 'source', name: 'Source', position: { x: 0, y: 0 } });
    const empty = sheetDocument({ id: 'empty', name: 'Empty', position: { x: 4_000, y: 3_000 }, rowCount: 0, columnCount: 0 });
    render(<App initialWorkbook={workbookWithSheets([source, empty])} />);
    act(() => { setSurfaceSize(800, 600); });
    const surface = workspaceSurface();
    const departure = [surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale];

    fireEvent.click(screen.getByRole('cell', { name: 'Source A1 empty cell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    fireEvent.click(screen.getByRole('button', { name: /Go to sheet…/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Empty' }));
    act(() => { vi.advanceTimersByTime(180); });

    expect([surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale]).not.toEqual(departure);
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    act(() => { vi.advanceTimersByTime(180); });

    expect([surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale]).toEqual(departure);
    expect(screen.getByRole('cell', { name: 'Source A1 empty cell' })).toHaveAttribute('data-active-cell', 'true');
  });

  it('wires smooth navigation feedback expiry without clearing the range selection', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=SUM(@inputs!B[2]:D[4])' } });
    const view = render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    const navigate = () => {
      fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
      modifierClickReference();
    };
    navigate();
    const anchor = screen.getByRole('cell', { name: 'Inputs B2 empty cell' });
    const center = screen.getByRole('cell', { name: 'Inputs C3 empty cell' });
    expect(center).toHaveAttribute('data-navigation-highlight', 'true');
    expect(anchor).toHaveFocus();
    expect(center.className).not.toMatch(/sheet-grid-selection-(top|bottom|left|right)/);
    expect(screen.getByTestId('workspace-plane')).toHaveAttribute('data-navigation-motion', 'smooth');
    const surface = workspaceSurface();
    const viewport = [surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale];
    fireEvent.wheel(surface, { deltaX: 80, deltaY: 100 });
    expect([surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale]).toEqual(viewport);
    expect(screen.getByTestId('workspace-plane')).toHaveAttribute('data-navigation-motion', 'smooth');
    expect(anchor).toHaveFocus();
    expect(center).toHaveAttribute('data-reference-selected', 'true');
    expect(center).toHaveAttribute('data-navigation-highlight', 'true');
    act(() => { vi.advanceTimersByTime(1_200); });
    expect(view.container.querySelector('[data-navigation-highlight="true"]')).toBeNull();
    expect(center).toHaveAttribute('data-reference-selected', 'true');
    expect(anchor).toHaveFocus();
  });

  it('wires reduced-motion navigation to an instant workspace transition', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=@inputs!B[2]' } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClickReference();
    expect(screen.getByTestId('workspace-plane')).toHaveAttribute('data-navigation-motion', 'instant');
    expect(screen.getByRole('cell', { name: 'Inputs B2 empty cell' })).toHaveFocus();
  });

  it('jumps across sheets to a distant range through a measured virtual window', async () => {
    const inputs = sparseLargeSheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=SUM(@sheet-inputs!CU[9999]:CV[10000])' },
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });
    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const body = within(inputsFrame).getByTestId('sheet-frame-body');
    virtualGridGeometry(body, { height: 160, width: 240 });

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClickReference();
    expect(within(inputsFrame).getByRole('cell', { name: 'Inputs CU9999 empty cell' }))
      .toHaveAttribute('data-navigation-highlight', 'true');

    await within(inputsFrame).findByRole('cell', { name: 'Inputs CU9999 empty cell' });
    body.scrollTop = 9_998 * 26.4;
    body.scrollLeft = 98 * 76;
    fireEvent.scroll(body);
    await waitFor(() => expect(within(inputsFrame).getByRole('cell', { name: 'Inputs CU9999 empty cell' })).toHaveFocus());
    expect(within(inputsFrame).getByRole('cell', { name: 'Inputs CV10000 empty cell' })).toHaveAttribute('data-reference-selected', 'true');
    expect(within(inputsFrame).getAllByTestId('sheet-grid-cell').length).toBeLessThan(1_000);
  });

  it.each(['toolbar', 'dialog', 'editor'])('cancels deferred off-window focus when a %s takes ownership', async (owner) => {
    const sparseInputs = sparseLargeSheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
    const inputs = {
      ...sparseInputs,
      frame: { ...sparseInputs.frame, position: { x: 4_000, y: 3_000 } },
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=@sheet-inputs!CU[9999]' },
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClickReference();

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const body = within(inputsFrame).getByTestId('sheet-frame-body');
    virtualGridGeometry(body, { height: 160, width: 240 });
    await waitFor(() => expect(within(inputsFrame).getByRole('table', { name: 'Inputs grid' })).toHaveFocus());

    let newOwner: HTMLElement;
    if (owner === 'dialog') {
      fireEvent.click(screen.getByRole('button', { name: 'New sheet' }));
      newOwner = within(screen.getByRole('form', { name: 'Create sheet' })).getByRole('textbox');
      expect(newOwner).toHaveFocus();
    } else if (owner === 'editor') {
      fireEvent.doubleClick(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
      newOwner = screen.getByRole('textbox', { name: 'Outputs A1 editor' });
    } else {
      newOwner = screen.getByRole('button', { name: 'New sheet' });
      newOwner.focus();
    }
    await act(async () => {});
    body.scrollTop = 9_998 * 26.4;
    body.scrollLeft = 98 * 76;
    fireEvent.scroll(body);

    const target = await within(inputsFrame).findByRole('cell', { name: 'Inputs CU9999 empty cell' });
    expect(newOwner).toHaveFocus();
    expect(target).not.toHaveFocus();

    if (owner === 'dialog') fireEvent.keyDown(newOwner, { key: 'Escape' });
    resetWorkspaceViewport();
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument());
  });

  it('retains a deep focus request through gesture zoom and does not replay it after overview release', async () => {
    const inputs = sheetDocument({
      id: 'sheet-inputs', name: 'Inputs', position: { x: 4_000, y: 3_000 }, visualScale: 0.25,
      columnCount: 100, rowCount: 10_000,
    });
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=@sheet-inputs!CU[9999]' },
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClickReference();

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const body = within(inputsFrame).getByTestId('sheet-frame-body');
    virtualGridGeometry(body, { height: 160, width: 240 });
    await waitFor(() => expect(within(inputsFrame).getByRole('table', { name: 'Inputs grid' })).toHaveFocus());

    fireEvent.wheel(body, { ctrlKey: true, deltaY: 1_200, clientX: 100, clientY: 80 });
    expect(screen.getByTestId('workspace-plane')).toHaveAttribute('data-navigation-motion', 'instant');
    expect(inputsFrame).toHaveAttribute('data-rendering-mode', 'detailed');

    body.scrollTop = 9_998 * 26.4;
    body.scrollLeft = 98 * 76;
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    fireEvent.scroll(body);
    await waitFor(() => expect((focus.mock.instances as unknown as HTMLElement[]).some((element) =>
      element.getAttribute('aria-label') === 'Inputs CU9999 empty cell',
    )).toBe(true));
    await waitFor(() => expect(inputsFrame).toHaveAttribute('data-rendering-mode', 'overview'));

    const targetFocusClaims = () => (focus.mock.instances as unknown as HTMLElement[]).filter((element) =>
      element.getAttribute('aria-label') === 'Inputs CU9999 empty cell').length;
    expect(targetFocusClaims()).toBe(1);
    screen.getByRole('button', { name: 'New sheet' }).focus();
    setSheetScale(inputsFrame, 400);
    await waitFor(() => expect(inputsFrame).toHaveAttribute('data-rendering-mode', 'detailed'));
    expect(targetFocusClaims()).toBe(1);

    resetWorkspaceViewport();
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument());
  });

  it('navigates by stable sheet id after a quoted-name rename', async () => {
    const user = userEvent.setup();
    const inputs = { ...positionedSheet('sheet-inputs', 'Sales Q1', { x: 120, y: 80 }), cells: { A1: '7' }, zIndex: 2 };
    const outputs = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 140, y: 100 }), cells: { A1: '=@sheet-inputs!A[1]' }, zIndex: 9 };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    setSurfaceSize(800, 600);

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Sales Q1' });
    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText(/sheet name/i);
    await user.clear(input);
    await user.type(input, 'Sales 2026');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClickReference('meta');

    expect(screen.getByRole('cell', { name: 'Sales 2026 A1 cell' })).toHaveFocus();
    const revealedFrame = screen.getByRole('article', { name: 'Sheet Sales 2026' });
    const overlappingFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    expect(revealedFrame).toHaveAttribute('data-navigation-reveal', 'true');
    expect(revealedFrame).toHaveAttribute('data-z-index', '2');
    expect(revealedFrame).toHaveStyle({ zIndex: '2' });
    expect(overlappingFrame).toHaveStyle({ zIndex: '9' });
  });

  it('reveals an initially culled miniature at detailed scale and releases its navigation pin', async () => {
    const inputs = sheetDocument({
      id: 'sheet-inputs', name: 'Inputs', position: { x: 4_000, y: 3_000 }, visualScale: 0.25,
      cells: { B2: 'target' }, zIndex: 2,
    });
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=@sheet-inputs!B[2]' },
    };
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    act(() => { setSurfaceSize(800, 600); });
    expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClickReference();

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    expect(inputsFrame).toHaveAttribute('data-rendering-mode', 'detailed');
    virtualGridGeometry(within(inputsFrame).getByTestId('sheet-frame-body'), { height: 160, width: 240 });
    const target = await within(inputsFrame).findByRole('cell', { name: 'Inputs B2 cell' });
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('data-navigation-highlight', 'true');
    expect(inputsFrame).toHaveAttribute('data-z-index', '2');

    const reset = screen.getByRole('button', { name: 'New sheet' });
    reset.focus();
    resetWorkspaceViewport();
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument());
  });

  it('immediately focuses the anchor of an oversized custom-axis range with reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const inputs = sheetDocument({
      id: 'sheet-inputs', name: 'Inputs', position: { x: 3_000, y: 2_000 }, visualScale: 0.25,
      columnCount: 100, rowCount: 10_000,
      presentation: { columnWidths: { 'sheet-inputs:column:99': 260 }, rowHeights: { 'sheet-inputs:row:9999': 90 } },
    });
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }),
      cells: { A1: '=SUM(@sheet-inputs!CU[9999]:CV[10000])' },
    };
    const archive = sheetDocument({
      id: 'sheet-archive', name: 'Archive', position: { x: 6_000, y: 4_000 }, visualScale: 0.25,
    });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs, archive])} />);
    act(() => { setSurfaceSize(800, 600); });
    expect(screen.queryByRole('article', { name: 'Sheet Archive' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    modifierClickReference();

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    expect(screen.getByTestId('workspace-plane')).toHaveAttribute('data-navigation-motion', 'instant');
    expect(inputsFrame).toHaveAttribute('data-rendering-mode', 'detailed');
    const body = within(inputsFrame).getByTestId('sheet-frame-body');
    virtualGridGeometry(body, { height: 160, width: 240 });
    body.scrollTop = 9_998 * 26.4;
    body.scrollLeft = 98 * 76;
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    fireEvent.scroll(body);
    await waitFor(() => expect((focus.mock.instances as unknown as HTMLElement[]).some((element) =>
      element.getAttribute('aria-label') === 'Inputs CU9999 empty cell',
    )).toBe(true));
    await waitFor(() => expect(within(inputsFrame).getByRole('cell', { name: 'Inputs CU9999 empty cell' })).toHaveFocus());
    expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Sheet Archive' })).not.toBeInTheDocument();

    resetWorkspaceViewport();
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Sheet Inputs' })).not.toBeInTheDocument());
  });

  it('reports a broken reference without selecting a similarly named sheet', () => {
    const alias = positionedSheet('sheet-other', 'sheet-deleted', { x: 300, y: 80 });
    const outputs = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 20, y: 20 }), cells: { A1: '=@sheet-deleted!A[1]' } };
    render(<App initialWorkbook={workbookWithSheets([alias, outputs])} />);
    setSurfaceSize(800, 600);

    const formula = screen.getByRole('cell', { name: 'Outputs A1 cell' });
    fireEvent.click(formula);
    modifierClickReference();

    expect(formula).toHaveAttribute('data-active-cell', 'true');
    expect(screen.getByText('Cannot navigate: @#REF!A[1] has a broken target.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('textbox', { name: 'Outputs A1 editor' })).toHaveFocus();
    expect(screen.getByRole('article', { name: 'Sheet sheet-deleted' })).not.toHaveAttribute('data-active-sheet');
  });
});
