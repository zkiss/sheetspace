import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

function setup() {
  render(<App initialWorkbook={workbookWithSheets([
    smallSheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=B1+1', B1: '2' } }),
  ])} />);
  const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
  fireEvent.click(cell);
  const inspector = screen.getByRole('region', { name: 'Selected formula' });
  return { cell, inspector, code: inspector.querySelector('code')!, surface: screen.getByTestId('workspace-surface') };
}

function pointer(target: Element, type: string, options: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...options });
  Object.defineProperty(event, 'pointerId', { value: 17 });
  fireEvent(target, event);
  return event;
}

describe('formula inspector workspace gesture ownership', () => {
  it('preserves selection and native primary pointers throughout the inspector, including plain formula text', () => {
    const { cell, inspector, code, surface } = setup();
    for (const target of [inspector, within(inspector).getByText('Formula'), code, within(inspector).getByRole('status')]) {
      expect(pointer(target, 'pointerdown').defaultPrevented).toBe(false);
      pointer(surface, 'pointermove', { clientX: 40, clientY: 20 });
      pointer(target, 'pointerup');
      fireEvent.click(target, { detail: 1 });
      expect(cell).toHaveAttribute('data-active-cell', 'true');
      expect(screen.getByRole('region', { name: 'Selected formula' })).toBe(inspector);
      expect(surface).toHaveAttribute('data-viewport-x', '0');
      expect(surface).toHaveAttribute('data-viewport-y', '0');
    }
  });

  it('leaves ordinary formula overflow wheel input native without panning or clearing selection', () => {
    const { cell, code, surface } = setup();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 80, deltaY: 100 });
    fireEvent(code, event);
    expect(event.defaultPrevented).toBe(false);
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(surface).toHaveAttribute('data-viewport-x', '0');
    expect(surface).toHaveAttribute('data-viewport-y', '0');
  });

  it('routes Ctrl wheel over real formula text without clearing the inspector', () => {
    const { cell, code, surface, inspector } = setup();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    fireEvent(code, event);
    expect(event.defaultPrevented).toBe(true);
    expect(Number(surface.dataset.viewportScale)).toBeGreaterThan(1);
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(screen.getByRole('region', { name: 'Selected formula' })).toBe(inspector);
  });

  it('routes Space pan over the real inspector and clears selection intentionally', () => {
    const { cell, code, surface } = setup();
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    const button = 0;
    const buttons = 1;
    expect(pointer(code, 'pointerdown', { button, buttons }).defaultPrevented).toBe(true);
    pointer(surface, 'pointermove', { button, buttons, clientX: 40, clientY: 20 });
    pointer(surface, 'pointerup', { button, buttons: 0 });
    fireEvent.keyUp(document.body, { code: 'Space' });
    expect(surface).toHaveAttribute('data-viewport-x', '40');
    expect(surface).toHaveAttribute('data-viewport-y', '20');
    expect(cell).not.toHaveAttribute('data-active-cell');
    expect(screen.queryByRole('region', { name: 'Selected formula' })).not.toBeInTheDocument();
  });
});
