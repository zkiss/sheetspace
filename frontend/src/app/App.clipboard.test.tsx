import { activateCellEditor } from '@test-support/appScreen';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient } from '@test-support/apiClients';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { formulaRawForStorage } from '@workbook/formula/reference';

function clipboardData(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => { values.set(type, value); },
    get types() { return [...values.keys()]; },
  };
}

describe('App grid clipboard integration', () => {
  it('reports malformed tabular paste without changing existing cells', () => {
    const sheet = { ...positionedSheet('inputs', 'Inputs', { x: 48, y: 96 }), cells: { A1: 'original' } };
    const apiClient = autosaveClient();
    render(<App initialWorkbook={workbookWithSheets([sheet])} apiClient={apiClient} />);
    const cell = screen.getByRole('article', { name: 'Sheet Inputs' }).querySelector<HTMLElement>('[data-cell-key="A1"]')!;
    fireEvent.click(cell);
    fireEvent.paste(cell, { clipboardData: clipboardData({ 'text/plain': '"unterminated' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('malformed tabular text');
    expect(cell).toHaveTextContent('original');
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });
  it('explains an unrepresentable range move without changing cells or clearing the cut', () => {
    const sheet = { ...positionedSheet('inputs', 'Inputs', { x: 48, y: 96 }), columnCount: 3, rowCount: 4,
      cells: { A1: '10', B1: '20' } };
    const apiClient = autosaveClient();
    const workbook = workbookWithSheets([sheet]);
    const document = workbook.documents.inputs!;
    document.content.cells[cellIdentityKey(cellIdentityAt(document.content, 'C1')!)] = formulaRawForStorage('=SUM(@A[1]:B[1])', workbook, document.id);
    render(<App initialWorkbook={workbook} apiClient={apiClient} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
    const cut = clipboardData();

    fireEvent.click(cell('A1'));
    fireEvent.cut(cell('A1'), { clipboardData: cut });
    fireEvent.click(cell('A4'));
    fireEvent.paste(cell('A4'), { clipboardData: cut });

    expect(screen.getByRole('alert')).toHaveTextContent('move did not happen');
    expect(screen.getByRole('alert')).toHaveTextContent('referenced range');
    expect(cell('A1')).toHaveTextContent('10');
    expect(cell('A4')).toBeEmptyDOMElement();
    expect(cell('A1')).toHaveAttribute('data-pending-cut', 'true');
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });

  it('rejects calculated cut, paste, and move with feedback and cancels a rejected pending cut', () => {
    render(<App initialWorkbook={calculatedWorkbook()} apiClient={autosaveClient()} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
    const cut = clipboardData();

    fireEvent.click(cell('B1'));
    fireEvent.cut(cell('B1'), { clipboardData: cut });
    expect(cell('B1')).not.toHaveAttribute('data-pending-cut');
    expect(screen.getByRole('alert')).toHaveTextContent('calculated in the data model');

    fireEvent.click(cell('B2'));
    fireEvent.paste(cell('B2'), { clipboardData: clipboardData({ 'text/plain': 'replacement' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('calculated in the data model');
    expect(cell('B2')).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(cell('A1'));
    fireEvent.cut(cell('A1'), { clipboardData: cut });
    expect(cell('A1')).toHaveAttribute('data-pending-cut', 'true');
    fireEvent.click(cell('B2'));
    fireEvent.paste(cell('B2'), { clipboardData: cut });
    expect(cell('A1')).not.toHaveAttribute('data-pending-cut');
    expect(cell('B2')).toHaveAttribute('aria-selected', 'true');
  });

  it('cancels an earlier pending cut when a calculated selection rejects a new cut', () => {
    render(<App initialWorkbook={calculatedWorkbook()} apiClient={autosaveClient()} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;

    fireEvent.click(cell('A1'));
    fireEvent.cut(cell('A1'), { clipboardData: clipboardData() });
    expect(cell('A1')).toHaveAttribute('data-pending-cut', 'true');

    fireEvent.click(cell('B1'));
    fireEvent.cut(cell('B1'), { clipboardData: clipboardData() });

    expect(cell('A1')).not.toHaveAttribute('data-pending-cut');
    expect(cell('B1')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('calculated in the data model');
  });

  it('copies a grid formula as TSV with provenance and pastes it atomically from the active cell', async () => {
    const sheet = {
      ...positionedSheet('inputs', 'Inputs', { x: 48, y: 96 }),
      columnCount: 3,
      rowCount: 2,
      cells: { A1: '2', B1: '=@A[1] * 3' },
    };
    const apiClient = autosaveClient();
    render(<App initialWorkbook={workbookWithSheets([sheet])} apiClient={apiClient} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;
    const copied = clipboardData();

    fireEvent.click(cell('B1'));
    expect(fireEvent.copy(cell('B1'), { clipboardData: copied })).toBe(false);
    expect(copied.getData('text/plain')).toBe('=@A[1] * 3');
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
    activateCellEditor(cell);
    const editor = screen.getByRole('textbox');
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

  it('removes pending-cut styling when an external no-op paste replaces the clipboard', () => {
    const sheet = {
      ...positionedSheet('inputs', 'Inputs', { x: 48, y: 96 }),
      columnCount: 2,
      cells: { A1: 'move me', B1: 'outside' },
    };
    const apiClient = autosaveClient();
    render(<App initialWorkbook={workbookWithSheets([sheet])} apiClient={apiClient} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;

    fireEvent.click(cell('A1'));
    fireEvent.cut(cell('A1'), { clipboardData: clipboardData() });
    expect(cell('A1')).toHaveAttribute('data-pending-cut', 'true');

    fireEvent.click(cell('B1'));
    fireEvent.paste(cell('B1'), { clipboardData: clipboardData({ 'text/plain': 'outside' }) });

    expect(cell('A1')).not.toHaveAttribute('data-pending-cut');
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });

  it('removes pending-cut styling immediately when a grid copy replaces the cut', () => {
    const sheet = {
      ...positionedSheet('inputs', 'Inputs', { x: 48, y: 96 }),
      columnCount: 2,
      cells: { A1: 'move me', B1: 'copy me' },
    };
    render(<App initialWorkbook={workbookWithSheets([sheet])} apiClient={autosaveClient()} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = (key: string) => frame.querySelector<HTMLElement>(`[data-cell-key="${key}"]`)!;

    fireEvent.click(cell('A1'));
    fireEvent.cut(cell('A1'), { clipboardData: clipboardData() });
    expect(cell('A1')).toHaveAttribute('data-pending-cut', 'true');

    fireEvent.click(cell('B1'));
    fireEvent.copy(cell('B1'), { clipboardData: clipboardData() });

    expect(cell('A1')).not.toHaveAttribute('data-pending-cut');
  });
});

function calculatedWorkbook(): Workbook {
  const sheet = positionedSheet('inputs', 'Inputs', { x: 48, y: 96 });
  const model: DataModel = {
    id: 'model', name: 'Model', columns: [
      { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
      { id: 'result', name: 'Result', kind: 'calculated', type: 'float', formula: '=1' },
    ],
  };
  return {
    ...workbookWithSheets([{
      ...sheet,
      modelId: model.id,
      modelColumnBindings: { input: sheet.content.columns[0]!, result: sheet.content.columns[1]! },
    }]),
    dataModels: { [model.id]: model },
  };
}
