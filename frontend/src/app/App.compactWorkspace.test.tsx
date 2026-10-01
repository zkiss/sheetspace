import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { measuredElementGeometry } from '@test-support/domGeometry';

function pointer(element: Element, type: string, options: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...options });
  Object.defineProperty(event, 'pointerId', { value: 17 });
  fireEvent(element, event);
}

describe('compact workspace interactions', () => {
  it('restores the remembered target when a different sheet header is activated, including after pan clears focus', () => {
    render(<App initialWorkbook={workbookWithSheets([
      smallSheetDocument({ id: 'inputs', name: 'Inputs' }),
      smallSheetDocument({ id: 'outputs', name: 'Outputs' }),
    ])} />);
    const inputs = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputs = screen.getByRole('article', { name: 'Sheet Outputs' });
    const b2 = within(inputs).getByRole('cell', { name: 'Inputs B2 empty cell' });
    fireEvent.click(b2);
    fireEvent.click(within(outputs).getByRole('cell', { name: 'Outputs C3 empty cell' }));
    const header = within(inputs).getByTestId('sheet-frame-header');
    pointer(header, 'pointerdown'); pointer(header, 'pointerup');
    expect(b2).toHaveAttribute('data-active-cell', 'true');
    expect(b2).toHaveFocus();
    const surface = screen.getByTestId('workspace-surface');
    pointer(surface, 'pointerdown'); pointer(surface, 'pointerup');
    expect(b2).not.toHaveAttribute('data-active-cell');
    expect(b2).not.toHaveFocus();
    pointer(header, 'pointerdown'); pointer(header, 'pointerup');
    expect(b2).toHaveAttribute('data-active-cell', 'true');
  });

  it('uses physical shifted digits for formatting shortcuts and leaves editor text shortcuts native', () => {
    render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '1.234' } })])} />);
    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(cell).toHaveTextContent('1.23');
    fireEvent.keyDown(cell, { key: '%', code: 'Digit5', metaKey: true, shiftKey: true });
    expect(cell).toHaveTextContent('123%');
    fireEvent.keyDown(cell, { key: ')', code: 'Digit0', ctrlKey: true, shiftKey: true });
    expect(cell).toHaveTextContent('1.234');
    fireEvent.keyDown(cell, { key: 'b', ctrlKey: true });
    expect(cell).toHaveStyle({ fontWeight: 'bold' });
    fireEvent.keyDown(cell, { key: 'b', metaKey: true });
    expect(cell).toHaveStyle({ fontWeight: 'normal' });
    fireEvent.keyDown(cell, { key: 'b', ctrlKey: true });
    fireEvent.doubleClick(cell);
    const editor = screen.getByRole('textbox');
    fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
    expect(cell).toHaveStyle({ fontWeight: 'bold' });
  });

  it('formats alignment and preserves precision on repeated number shortcuts without accepting unrelated modifiers', () => {
    render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { A1: '1.2345' } })])} />);
    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    fireEvent.click(cell);
    for (const [key, alignment] of [['e', 'center'], ['l', 'left'], ['r', 'right']]) {
      fireEvent.keyDown(cell, { key, ctrlKey: true, shiftKey: true });
      expect(cell).toHaveStyle({ textAlign: alignment });
      expect(cell).toHaveFocus();
    }
    fireEvent.keyDown(cell, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number format precision' }), { target: { value: '3' } });
    fireEvent.keyDown(cell, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(cell).toHaveTextContent('1.235');
    fireEvent.keyDown(cell, { key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(cell, { key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true });
    expect(cell).toHaveTextContent('123%');
    fireEvent.keyDown(cell, { key: 'r', ctrlKey: true, shiftKey: true, altKey: true });
    fireEvent.keyDown(cell, { key: 'r', ctrlKey: true });
    fireEvent.keyDown(cell, { key: 'x', ctrlKey: true, shiftKey: true });
    expect(cell).toHaveStyle({ textAlign: 'right' });
  });

  it('creates a sheet with Shift+N and ignores new-sheet shortcuts inside text entry', () => {
    render(<App initialWorkbook={workbookWithSheets([])} />);
    fireEvent.keyDown(document.body, { key: 'N', shiftKey: true });
    expect(screen.getByRole('form', { name: 'Create sheet' })).toBeInTheDocument();
    const input = screen.getByLabelText(/sheet name/i);
    fireEvent.change(input, { target: { value: 'Draft name' } });
    fireEvent.keyDown(input, { key: 'N', shiftKey: true });
    expect(input).toHaveValue('Draft name');
  });

  it('does not write formatting for a cleared selection or steal active editor keyboard input', () => {
    render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, columnCount: 2 })])} />);
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    expect(screen.getByRole('button', { name: /Bold:/ })).toBeDisabled();
    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    fireEvent.doubleClick(cell);
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
    expect(cell).toHaveStyle({ fontWeight: 'normal' });
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('zooms from the portal editor and commits its draft before a middle-button canvas pan', () => {
    render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs' })])} />);
    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    fireEvent.doubleClick(cell);
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Draft' } });
    fireEvent.wheel(editor, { ctrlKey: true, deltaY: -100 });
    const surface = screen.getByTestId('workspace-surface');
    expect(Number(surface.dataset.viewportScale)).toBeGreaterThan(1);
    expect(editor).toHaveFocus();
    pointer(editor, 'pointerdown', { button: 1, buttons: 4 });
    pointer(surface, 'pointermove', { button: 1, buttons: 4, clientX: 20 });
    pointer(surface, 'pointerup', { button: 1 });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(cell).toHaveTextContent('Draft');
    expect(cell).not.toHaveAttribute('data-active-cell');
  });

  it('does not recenter a visible undo target or repeatedly pull the viewport back after history navigation', () => {
    render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 50, y: 50 }, cells: { A1: 'old' } })])} />);
    const surface = screen.getByTestId('workspace-surface');
    act(() => { measuredElementGeometry(surface, { width: 800, height: 600 }); });
    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    fireEvent.doubleClick(cell);
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'new' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(surface).toHaveAttribute('data-viewport-x', '0');
    expect(cell).toHaveClass('sheet-grid-history-top', 'sheet-grid-history-left');
    fireEvent.wheel(surface, { deltaX: 2000 });
    expect(surface).toHaveAttribute('data-viewport-x', '-2000');
  });
});
