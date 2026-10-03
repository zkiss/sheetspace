import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as formattingSummary from '@workbook/read/formattingSummary';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { formattingModes, observeFormattingProjection } from '@test-support/formattingProjection';
import { App } from './App';

afterEach(() => vi.restoreAllMocks());

it('keeps a range and cached toolbar summaries through a real header drag and committed frame move', () => {
  render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'inputs', name: 'Inputs',
    rowCount: 2, columnCount: 2, cells: { A1: '1.234', B1: '2.345', A2: '3.456', B2: '4.567' },
  })])} />);
  fireEvent.click(screen.getByRole('cell', { name: 'Inputs A1 cell' }));
  fireEvent.click(screen.getByRole('cell', { name: 'Inputs B2 cell' }), { shiftKey: true });
  const summarize = vi.spyOn(formattingSummary, 'summarizeFormatting');
  const header = screen.getByTestId('sheet-frame-header');
  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX });
    Object.assign(event, { pointerId: 17 });
    fireEvent(header, event);
  };
  pointer('pointerdown', 0);
  for (let frame = 1; frame <= 5; frame++) pointer('pointermove', frame * 10);
  pointer('pointerup', 50);
  expect(screen.getByTestId('sheet-frame')).toHaveAttribute('data-position-x', '50');
  expect(summarize).not.toHaveBeenCalled();
  for (const cell of screen.getAllByRole('cell')) expect(cell).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Number format' }));
  for (const [key, value] of [['A1', '1.23'], ['B1', '2.35'], ['A2', '3.46'], ['B2', '4.57']]) {
    expect(screen.getByRole('cell', { name: `Inputs ${key} cell` })).toHaveTextContent(value!);
  }
  // The write refreshes Workspace's projection once; the toolbar consumes that
  // projection rather than independently summarizing the replacement overrides.
  expect(summarize).toHaveBeenCalledTimes(1);
});

it.each(formattingModes)('refreshes the shared %s projection once after a real shortcut write and restores grid focus', (mode) => {
  render(<App initialWorkbook={workbookWithSheets([smallSheetDocument({ id: 'focus', name: 'Focus',
    rowCount: 2, columnCount: 2, cells: { A1: '1.234', B1: '2.345', A2: '3.456', B2: '4.567' },
  })])} />);
  const a1 = screen.getByRole('cell', { name: 'Focus A1 cell' });
  if (mode === 'cells') {
    fireEvent.click(a1);
    fireEvent.click(screen.getByRole('cell', { name: 'Focus B2 cell' }), { shiftKey: true });
  } else {
    const header = mode === 'rows'
      ? screen.getByRole('rowheader', { name: /^1 / })
      : screen.getByRole('columnheader', { name: /^A / });
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 10 });
      Object.assign(event, { pointerId: 17 });
      fireEvent(header, event);
    }
  }
  const focusTarget = mode === 'cells' ? screen.getByRole('cell', { name: 'Focus B2 cell' }) : a1;
  screen.getByRole('button', { name: 'General number format' }).focus();
  const work = observeFormattingProjection();
  // Keyboard dispatch is covered without conflating its reads with the one
  // legitimate immutable-override refresh caused by the real command.
  fireEvent.keyDown(document.body, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
  work.expectCalls(0, 1, 1);
  expect(a1).toHaveTextContent('1.23');
  expect(focusTarget).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Number format' })).toHaveAttribute('aria-pressed', 'true');
  work.clear();
  screen.getByRole('button', { name: 'General number format' }).focus();
  fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
  work.expectCalls(0, 1, 1);
  expect(a1).toHaveStyle({ fontWeight: 'bold' });
  expect(focusTarget).toHaveFocus();
});
