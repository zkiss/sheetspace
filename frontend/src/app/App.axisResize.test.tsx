import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { virtualGridGeometry } from '@test-support/domGeometry';

afterEach(cleanup);
function pointer(element: Element, type: string, x = 0, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 8 });
  fireEvent(element, event);
}

describe('axis resize application integration', () => {
  it.each(['row', 'column'] as const)('cancels a %s resize when Escape comes from the focused cell editor', async (axis) => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '7' } });
    const apiClient = persistedWorkbookClient(workbookWithSheets([sheet]));
    render(<App initialWorkbook={await apiClient.loadWorkbook()} apiClient={apiClient} />);
    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    fireEvent.doubleClick(cell);
    const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
    expect(editor).toHaveFocus();
    fireEvent.change(editor, { target: { value: '99' } });
    const boundary = screen.getByRole('separator', { name: `Resize ${axis} ${axis === 'row' ? '1' : 'A'}` });
    const x = axis === 'column' ? 50 : 0;
    const y = axis === 'row' ? 50 : 0;
    pointer(boundary, 'pointerdown'); pointer(boundary, 'pointermove', x, y);
    expect(editor).toHaveFocus();
    expect(cell).toHaveStyle(axis === 'row' ? { height: '76.4px' } : { width: '126px' });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(cell).toHaveTextContent('7');
    expect(cell).toHaveStyle(axis === 'row' ? { height: '26.4px' } : { width: '76px' });
    await act(async () => { pointer(boundary, 'pointerup', x, y); });
    expect(apiClient.writeAxisSizes).not.toHaveBeenCalled();
    expect(apiClient.writeCells).not.toHaveBeenCalled();
    expect((await apiClient.loadWorkbook()).documents.inputs).toEqual(sheet);
  });
  it.each([16, 40])('saves committed dimensions with a %spx row, restores them on reload, aligns the editor and leaves frames and formulas intact', async (rowHeight) => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '7', B2: '=A1*2' } });
    const apiClient = persistedWorkbookClient(workbookWithSheets([sheet]));
    const view = render(<App initialWorkbook={await apiClient.loadWorkbook()} apiClient={apiClient} />);
    const column = screen.getByRole('separator', { name: 'Resize column A' });
    pointer(column, 'pointerdown'); pointer(column, 'pointermove', 44); pointer(column, 'pointerup', 44);
    const row = screen.getByRole('separator', { name: 'Resize row 1' });
    pointer(row, 'pointerdown'); pointer(row, 'pointermove', 0, rowHeight - 26.4); pointer(row, 'pointerup', 0, rowHeight - 26.4);
    await waitFor(() => expect(apiClient.writeAxisSizes).toHaveBeenCalledTimes(2));
    const persisted = await apiClient.loadWorkbook();
    expect(persisted.documents.inputs.presentation).toEqual({ columnWidths: { [sheet.content.columns[0]]: 120 }, rowHeights: { [sheet.content.rows[0]]: rowHeight } });
    expect(persisted.documents.inputs.content).toEqual(sheet.content);
    expect(persisted.documents.inputs.frame).toEqual(sheet.frame);
    view.unmount();
    render(<App initialWorkbook={persisted} apiClient={apiClient} />);
    const first = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(first).toHaveStyle({ width: '120px', height: `${rowHeight}px`, lineHeight: `${rowHeight}px` });
    expect(first).toHaveTextContent('7');
    expect(screen.getByRole('cell', { name: 'Inputs B2 cell' })).toHaveTextContent('14');
    fireEvent.doubleClick(first);
    expect(screen.getByRole('textbox')).toHaveValue('7');
    expect(screen.getByRole('textbox').closest('[role="cell"]')).toHaveStyle({ width: '120px', height: `${rowHeight}px` });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    const frame = screen.getByTestId('sheet-frame');
    const right = within(frame).getByRole('separator', { name: 'Resize sheet Inputs from right' });
    pointer(right, 'pointerdown'); pointer(right, 'pointermove', 80); pointer(right, 'pointerup', 80);
    await waitFor(() => expect(apiClient.updateSheetFrameLayout).toHaveBeenCalledTimes(1));
    expect((await apiClient.loadWorkbook()).documents.inputs.presentation).toEqual(persisted.documents.inputs.presentation);
    expect(apiClient.writeAxisSizes).toHaveBeenCalledTimes(2);
  });
  it('reveals a distant reference using variable offsets and keeps headers and selected cells aligned', async () => {
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 1000, columnCount: 100 });
    inputs.presentation = { rowHeights: { [inputs.content.rows[0]]: 80 }, columnWidths: { [inputs.content.columns[0]]: 160 } };
    const outputs = sheetDocument({ id: 'outputs', name: 'Outputs', cells: { A1: '=SUM(inputs!K100:L101)' } });
    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);
    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const body = within(frame).getByTestId('sheet-frame-body');
    act(() => { virtualGridGeometry(body, { height: 160, width: 240 }); });
    fireEvent.click(screen.getByRole('cell', { name: 'Outputs A1 cell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inputs!K100:L101, reference' }), { ctrlKey: true });
    expect(body.scrollLeft).toBe(160 + 9 * 76);
    expect(body.scrollTop).toBe(Math.round(80 + 98 * 26.4));
    fireEvent.scroll(body);
    const target = await within(frame).findByRole('cell', { name: 'Inputs K100 empty cell' });
    expect(target).toHaveAttribute('data-navigation-highlight', 'true');
    expect(target).toHaveAttribute('data-reference-selected', 'true');
    expect(target).toHaveStyle({ left: `${40 + 160 + 9 * 76}px` });
    expect(within(frame).getAllByTestId('sheet-grid-cell').length).toBeLessThan(500);
  });
});
