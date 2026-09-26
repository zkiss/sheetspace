import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient } from '@test-support/apiClients';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

function clipboardData(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => { values.set(type, value); },
    get types() { return [...values.keys()]; },
  };
}

describe('App grid clipboard integration', () => {
  it('copies a grid formula as TSV with provenance and pastes it atomically from the active cell', async () => {
    const sheet = {
      ...positionedSheet('inputs', 'Inputs', { x: 48, y: 96 }),
      columnCount: 3,
      rowCount: 2,
      cells: { A1: '2', B1: '=A1 * 3' },
    };
    const apiClient = autosaveClient();
    render(<App initialWorkbook={workbookWithSheets([sheet])} apiClient={apiClient} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
    const copied = clipboardData();

    fireEvent.click(cell('B1'));
    expect(fireEvent.copy(cell('B1'), { clipboardData: copied })).toBe(false);
    expect(copied.getData('text/plain')).toBe('=A1 * 3');
    expect(copied.getData('application/x-sheetspace-clipboard')).toMatch(/^sheetspace:/);

    fireEvent.click(cell('C1'));
    expect(fireEvent.paste(cell('C1'), { clipboardData: copied })).toBe(false);
    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(1));
    expect(cell('C1')).toHaveTextContent('6');
    expect(vi.mocked(apiClient.writeCells).mock.calls[0]?.[1]).toHaveLength(1);
  });

  it('keeps copy and paste inside a live editor browser-native', () => {
    const sheet = {
      ...positionedSheet('inputs', 'Inputs', { x: 48, y: 96 }),
      cells: { A1: 'Retained' },
    };
    const apiClient = autosaveClient();
    render(<App initialWorkbook={workbookWithSheets([sheet])} apiClient={apiClient} />);
    const cell = within(screen.getByRole('article', { name: 'Sheet Inputs' })).getByRole('cell', { name: 'Inputs A1 cell' });
    fireEvent.doubleClick(cell);
    const editor = within(cell).getByRole('textbox');
    const copied = clipboardData();

    expect(fireEvent.copy(editor, { clipboardData: copied })).toBe(true);
    expect(fireEvent.paste(editor, { clipboardData: clipboardData({ 'text/plain': 'replacement' }) })).toBe(true);
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });

  it('shows, cancels, and completes a pending cut without changing content until paste', async () => {
    const sheet = {
      ...positionedSheet('inputs', 'Inputs', { x: 48, y: 96 }),
      columnCount: 3,
      rowCount: 2,
      cells: { A1: 'move me' },
    };
    const apiClient = autosaveClient();
    render(<App initialWorkbook={workbookWithSheets([sheet])} apiClient={apiClient} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
    const cut = clipboardData();

    fireEvent.click(cell('A1'));
    expect(fireEvent.cut(cell('A1'), { clipboardData: cut })).toBe(false);
    expect(cell('A1')).toHaveAttribute('data-pending-cut', 'true');
    expect(apiClient.writeCells).not.toHaveBeenCalled();
    fireEvent.keyDown(cell('A1'), { key: 'Escape' });
    expect(cell('A1')).not.toHaveAttribute('data-pending-cut');

    expect(fireEvent.cut(cell('A1'), { clipboardData: cut })).toBe(false);
    fireEvent.click(cell('C1'));
    expect(fireEvent.paste(cell('C1'), { clipboardData: cut })).toBe(false);
    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledOnce());
    expect(cell('A1')).toHaveTextContent('');
    expect(cell('C1')).toHaveTextContent('move me');
    expect(cell('A1')).not.toHaveAttribute('data-pending-cut');
  });
});
