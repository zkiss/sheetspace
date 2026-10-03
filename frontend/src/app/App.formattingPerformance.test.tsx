import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as formattingSummary from '@workbook/read/formattingSummary';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
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
  // The write replaces overrides, so the next render refreshes the current
  // projection; the shortcut itself did not run another read before writing.
  expect(summarize).toHaveBeenCalledTimes(2);
});
