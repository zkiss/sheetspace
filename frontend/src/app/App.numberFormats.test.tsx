import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

afterEach(cleanup);

function selectColumn(element: Element, clientX: number, clientY: number) {
  const pointerEvent = (type: 'pointerdown' | 'pointerup') => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
    Object.defineProperty(event, 'pointerId', { value: 17 });
    fireEvent(element, event);
  };
  pointerEvent('pointerdown');
  pointerEvent('pointerup');
}

describe('App number formatting workflow', () => {
  it('formats a whole column including blanks, restores grid focus, and persists reset and inheritance', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { A1: '1.23', B1: '=A1*2' } });
    const apiClient = persistedWorkbookClient(workbookWithSheets([sheet]));
    const view = render(<App initialWorkbook={await apiClient.loadWorkbook()} apiClient={apiClient} />);

    selectColumn(screen.getByRole('columnheader', { name: /^A / }), 50, 10);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Number format' }), 'number');
    await waitFor(() => expect(apiClient.writeNumberFormats).toHaveBeenCalledTimes(1));
    const a1 = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(a1).toHaveTextContent('1');
    await waitFor(() => expect(a1).toHaveFocus());
    expect(screen.getByRole('cell', { name: 'Inputs A2 empty cell' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('cell', { name: 'Inputs B1 cell' })).not.toHaveAttribute('aria-selected', 'true');

    const persisted = await apiClient.loadWorkbook();
    expect(persisted.documents.inputs.presentation.formatOverrides?.columns[sheet.content.columns[0]!]?.numberFormat)
      .toEqual({ kind: 'number', precision: 0 });
    expect(persisted.documents.inputs.presentation.formatOverrides?.cells).toEqual({});

    await user.click(screen.getByRole('button', { name: 'Inherit' }));
    await waitFor(() => expect(apiClient.writeNumberFormats).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(apiClient.writeNumberFormats).toHaveBeenCalledTimes(3));
    expect((await apiClient.loadWorkbook()).documents.inputs.presentation.formatOverrides?.columns[sheet.content.columns[0]!]?.numberFormat)
      .toEqual({ kind: 'general' });

    view.unmount();
    render(<App initialWorkbook={await apiClient.loadWorkbook()} apiClient={apiClient} />);
    expect(screen.getByRole('cell', { name: 'Inputs A1 cell' })).toHaveTextContent('1.23');
    expect(screen.getByRole('cell', { name: 'Inputs B1 cell' })).toHaveTextContent('2.46');
  });
});
