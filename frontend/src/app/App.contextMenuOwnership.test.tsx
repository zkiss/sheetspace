import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function setup(visualScale = 1) {
  render(<App initialWorkbook={workbookWithSheets([
    smallSheetDocument({ id: 'inputs', name: 'Inputs', visualScale, cells: { A1: '=B1+1', B1: '2' } }),
  ])} />);
  return { frame: screen.getByRole('article', { name: 'Sheet Inputs' }), surface: screen.getByTestId('workspace-surface') };
}

function contextMenu(target: Element) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 });
  fireEvent(target, event);
  return event;
}

function expectStationary(surface: HTMLElement) {
  expect(surface).toHaveAttribute('data-viewport-x', '0');
  expect(surface).toHaveAttribute('data-viewport-y', '0');
  expect(surface).toHaveAttribute('data-viewport-scale', '1');
  expect(screen.queryByRole('form', { name: 'Create sheet' })).not.toBeInTheDocument();
}

describe('context-menu ownership in the composed workspace', () => {
  it('keeps the real menu draft native and applies Enter through to the sheet frame', () => {
    const { frame, surface } = setup();
    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    fireEvent.click(cell);
    contextMenu(frame);
    const menu = screen.getByRole('menu', { name: 'Inputs sheet menu' });
    const input = within(menu).getByRole<HTMLInputElement>('spinbutton');
    input.focus();
    fireEvent.change(input, { target: { value: '75' } });
    const targets = [input, within(menu).getByText('%')];
    for (const target of targets) {
      expect(contextMenu(target).defaultPrevented).toBe(false);
      expect(screen.getByRole('menu')).toBe(menu);
      expect(within(menu).getByRole('spinbutton')).toBe(input);
      expect(input).toHaveValue(75);
      expect(input).toHaveFocus();
      expect(cell).toHaveAttribute('data-active-cell', 'true');
      expectStationary(surface);
    }
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(frame).toHaveAttribute('data-visual-scale', '0.75');
  });

  it('keeps inspector text, wrapper, status and reference tokens native without changing selection', () => {
    const { surface } = setup();
    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    fireEvent.click(cell);
    const inspector = screen.getByRole('region', { name: 'Selected formula' });
    for (const target of [inspector, inspector.querySelector('code')!, within(inspector).getByText('Formula'),
      within(inspector).getByRole('status'), within(inspector).getByRole('button', { name: 'B1, reference' })]) {
      expect(contextMenu(target).defaultPrevented).toBe(false);
      expect(screen.getByRole('region', { name: 'Selected formula' })).toBe(inspector);
      expect(cell).toHaveAttribute('data-active-cell', 'true');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expectStationary(surface);
    }
  });

  it('keeps the actual body-portaled editor native, commits once and undoes once', () => {
    const { surface } = setup();
    const cell = screen.getByRole('cell', { name: 'Inputs B1 cell' });
    fireEvent.doubleClick(cell);
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox');
    expect(surface).not.toContainElement(editor);
    fireEvent.change(editor, { target: { value: 'draft text' } });
    editor.setSelectionRange(2, 6);
    expect(contextMenu(editor).defaultPrevented).toBe(false);
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('draft text');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 6]);
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expectStationary(surface);
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(cell).toHaveTextContent('draft text');
    // A single undo returns to the original value after one commit.
    fireEvent.keyDown(cell, { key: 'z', ctrlKey: true });
    expect(cell).toHaveTextContent('2');
  });

  it.each([1, 0.25])('retains sheet menu ownership for actual sheet content at visual scale %s', (scale) => {
    const { frame } = setup(scale);
    const targets = [frame, within(frame).getByRole('heading'), within(frame).getByRole('separator', { name: /from right$/ }),
      scale === 1 ? within(frame).getByRole('cell', { name: 'Inputs B1 cell' }) : within(frame).getByRole('button', { name: 'Select sheet Inputs overview' })];
    for (const target of targets) {
      expect(contextMenu(target).defaultPrevented).toBe(true);
      expect(screen.getByRole('menu', { name: 'Inputs sheet menu' })).toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Create sheet' })).not.toBeInTheDocument();
    }
  });

  it('suppresses sheet and canvas menus during explicit pan', () => {
    const { frame, surface } = setup();
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 1, buttons: 4 });
    Object.assign(down, { pointerId: 17 });
    fireEvent(frame, down);
    expect(down.defaultPrevented).toBe(true);
    for (const target of [frame, surface, screen.getByTestId('workspace-plane')]) {
      expect(contextMenu(target).defaultPrevented).toBe(true);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Create sheet' })).not.toBeInTheDocument();
    }
  });
});
