import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

afterEach(() => {
  vi.useRealTimers();
});

describe('content history application integration', () => {
  it('routes workbook history around editor-local undo and preserves selection while showing formula displays', () => {
    const sheet = sheetDocument({
      id: 'inputs',
      name: 'Inputs',
      cells: { A1: '=1+1' },
    });
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    fireEvent.doubleClick(a1);
    const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
    fireEvent.change(editor, { target: { value: '=3+4' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    const a2 = within(frame).getByRole('cell', { name: 'Inputs A2 empty cell' });
    expect(a1).toHaveTextContent('7');
    expect(a2).toHaveAttribute('data-active-cell', 'true');
    expect(undo).toBeEnabled();

    fireEvent.click(undo);
    expect(a1).toHaveTextContent('2');
    expect(a1).toHaveAttribute('data-history-feedback', 'true');
    expect(a1).toHaveAttribute('data-history-before', '7');
    expect(a1).not.toHaveAttribute('data-navigation-highlight');
    expect(a1).not.toHaveAttribute('aria-selected');
    expect(a2).toHaveAttribute('data-active-cell', 'true');
    expect(redo).toBeEnabled();

    fireEvent.click(redo);
    expect(a1).toHaveTextContent('7');
    fireEvent.doubleClick(a2);
    const draft = screen.getByRole('textbox', { name: 'Inputs A2 editor' });
    fireEvent.change(draft, { target: { value: 'draft' } });
    expect(undo).toBeDisabled();
    fireEvent.keyDown(draft, { key: 'z', ctrlKey: true });
    expect(draft).toHaveValue('draft');
    expect(a1).toHaveTextContent('7');

    fireEvent.keyDown(draft, { key: 'Escape' });
    fireEvent.keyDown(a2, { key: 'z', ctrlKey: true });
    expect(a1).toHaveTextContent('2');
    expect(a2).toHaveAttribute('data-active-cell', 'true');
  });

  it('expires feedback and clears it immediately when a new edit supersedes the transition', () => {
    vi.useFakeTimers();
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: 'old' } });
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
    const b1 = within(frame).getByRole('cell', { name: 'Inputs B1 empty cell' });

    replaceCell(a1, 'new');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(a1).toHaveAttribute('data-history-feedback', 'true');
    replaceCell(b1, 'next');
    expect(a1).not.toHaveAttribute('data-history-feedback');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(b1).toHaveAttribute('data-history-feedback', 'true');
    act(() => vi.advanceTimersByTime(1_200));
    expect(b1).not.toHaveAttribute('data-history-feedback');
  });
});

function replaceCell(cell: HTMLElement, value: string) {
  fireEvent.doubleClick(cell);
  const editor = within(cell).getByRole('textbox');
  fireEvent.change(editor, { target: { value } });
  fireEvent.keyDown(editor, { key: 'Enter' });
}
