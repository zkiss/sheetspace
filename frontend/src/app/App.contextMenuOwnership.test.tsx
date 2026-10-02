import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { autosaveClient } from '@test-support/apiClients';
import { panWorkspace, zoomWorkspace } from '@test-support/workspaceActions';

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
  it('never creates on the canvas or plane after pan/zoom, and closes a sheet menu without clearing selection', () => {
    const apiClient = autosaveClient();
    render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([
      smallSheetDocument({ id: 'inputs', name: 'Inputs' }),
    ])} />);
    const surface = screen.getByTestId('workspace-surface');
    const plane = screen.getByTestId('workspace-plane');
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    panWorkspace(-50, -100);
    zoomWorkspace('out');
    const viewport = [surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale];
    const cell = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    fireEvent.click(cell);
    for (const target of [surface, plane]) {
      contextMenu(frame);
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(contextMenu(target).defaultPrevented).toBe(true);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Create sheet' })).not.toBeInTheDocument();
      expect(cell).toHaveAttribute('data-active-cell', 'true');
      expect([surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale]).toEqual(viewport);
    }
    expect(apiClient.createSheet).not.toHaveBeenCalled();
  });

  it.each(['grid', 'input', 'button'])('cancels only the sheet menu when Escape comes from its %s owner', (owner) => {
    const { frame } = setup();
    const cell = screen.getByRole('cell', { name: 'Inputs B1 cell' });
    fireEvent.click(cell);
    fireEvent.cut(cell, { clipboardData: { setData: () => undefined } });
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    contextMenu(frame);
    const menu = screen.getByRole('menu');
    const input = within(menu).getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '75' } });
    const target = owner === 'grid' ? cell : owner === 'input' ? input : within(menu).getByRole('button', { name: 'Set scale' });
    target.focus();
    fireEvent.keyDown(target, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(frame).toHaveAttribute('data-visual-scale', '1');
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    // Once the menu is gone, the grid owns the next Escape.
    fireEvent.keyDown(cell, { key: 'Escape' });
    expect(cell).not.toHaveAttribute('data-pending-cut');
    contextMenu(frame);
    expect(within(screen.getByRole('menu')).getByRole('spinbutton')).toHaveValue(100);
  });

  it('keeps the real menu draft native and applies Enter through to the sheet frame', () => {
    const { frame, surface } = setup();
    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    fireEvent.click(cell);
    contextMenu(frame);
    const menu = screen.getByRole('menu', { name: 'Inputs sheet menu' });
    const input = within(menu).getByRole<HTMLInputElement>('spinbutton');
    input.focus();
    fireEvent.change(input, { target: { value: '75' } });
    // Ordinary background scrolling must not take over the open menu or grid.
    for (const target of [surface, screen.getByTestId('workspace-plane')]) {
      fireEvent.wheel(target, { deltaX: 80, deltaY: 100 });
      expect(screen.getByRole('menu')).toBe(menu);
      expect(input).toHaveFocus();
      expect(input).toHaveValue(75);
      expect(cell).toHaveAttribute('data-active-cell', 'true');
      expectStationary(surface);
    }
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
