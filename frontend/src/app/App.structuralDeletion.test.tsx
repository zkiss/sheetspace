import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithLegacyFormulaFixtures } from '@test-support/workbookFactories';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { App } from './App';

async function deleteAxis(user: ReturnType<typeof userEvent.setup>, axis: 'row' | 'column') {
  fireEvent.keyDown(document.activeElement!, { ctrlKey: true, shiftKey: true, key: 'p' });
  await user.click(screen.getByRole('button', { name: new RegExp(`^Delete ${axis}`) }));
}

describe('structural deletion selection', () => {
  it.each([
    ['row', 'B1', 'B1'], ['row', 'B3', 'B2'],
    ['column', 'A2', 'A2'], ['column', 'C2', 'B2'],
  ] as const)('selects the adjacent %s after deleting %s', async (axis, source, destination) => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 3, columnCount: 3 });
    const workbook = workbookWithLegacyFormulaFixtures([sheet]);
    render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
    await user.click(screen.getByRole('cell', { name: `Sheet ${source} empty cell` }));
    await deleteAxis(user, axis);
    await waitFor(() => expect(screen.getByRole('cell', { name: `Sheet ${destination} empty cell` })).toHaveFocus());
  });

  it.each([false, true])('focuses the empty %s sheet after its last row is deleted', async (bound) => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const workbook = workbookWithLegacyFormulaFixtures([bound ? { ...sheet, modelId: 'model', modelColumnBindings: { input: sheet.content.columns[0]! } } : sheet]);
    if (bound) workbook.dataModels = { model: { id: 'model', name: 'Model', columns: [{ id: 'input', name: 'Input', kind: 'manual', type: 'float' }] } };
    render(<App initialWorkbook={workbook} apiClient={persistedWorkbookClient(workbook)} />);
    await user.click(screen.getByRole('cell', { name: 'Sheet A1 empty cell' }));
    await deleteAxis(user, 'row');
    await waitFor(() => expect(document.querySelector(bound ? '.model-entry-cell' : '.sheet-grid')).toHaveFocus());
    expect(document.querySelector('[data-active-cell="true"]')).toBeNull();
  });

  it('restores the original selection and focus when persistence fails', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2 });
    const workbook = workbookWithLegacyFormulaFixtures([sheet]);
    const api = persistedWorkbookClient(workbook);
    api.saveModelLifecycle.mockRejectedValueOnce(new Error('failed'));
    render(<App initialWorkbook={workbook} apiClient={api} />);
    await user.click(screen.getByRole('cell', { name: 'Sheet B1 empty cell' }));
    await deleteAxis(user, 'row');
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Sheet B1 empty cell' })).toHaveFocus());
    expect(screen.getByRole('cell', { name: 'Sheet B1 empty cell' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('cell', { name: 'Sheet B2 empty cell' })).toBeInTheDocument();
  });

  it('does not reclaim selection after a newer click while row deletion is saving', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 3, columnCount: 2 });
    const workbook = workbookWithLegacyFormulaFixtures([sheet]);
    const api = persistedWorkbookClient(workbook);
    const save = api.saveModelLifecycle.getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    api.saveModelLifecycle.mockImplementationOnce(async (...args) => { await pending; return save(...args); });
    render(<App initialWorkbook={workbook} apiClient={api} />);
    await user.click(screen.getByRole('cell', { name: 'Sheet B1 empty cell' }));
    await deleteAxis(user, 'row');
    await user.click(screen.getByRole('cell', { name: 'Sheet A2 empty cell' }));
    await act(async () => { release(); await api.saveModelLifecycle.mock.results[0]!.value; });
    await waitFor(() => expect(screen.getByRole('cell', { name: 'Sheet A2 empty cell' })).toHaveFocus());
  });
});

describe('shared property deletion', () => {
  function setup() {
    const sheets = ['First', 'Second'].map((name) => {
      const sheet = sheetDocument({ id: name.toLowerCase(), name, rowCount: 1, columnCount: 2, cells: { A1: '12', B1: '34' } });
      return { ...sheet, modelId: 'model', modelColumnBindings: { input: sheet.content.columns[0]!, keep: sheet.content.columns[1]! } };
    });
    const workbook = workbookWithLegacyFormulaFixtures(sheets);
    workbook.dataModels = { model: { id: 'model', name: 'Model', columns: [
      { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
      { id: 'keep', name: 'Keep', kind: 'manual', type: 'float' },
    ] } };
    const api = persistedWorkbookClient(workbook);
    render(<App initialWorkbook={workbook} apiClient={api} />);
    return { workbook, api };
  }

  it('confirms removal from both bound sheets while retaining unrelated data', async () => {
    const user = userEvent.setup();
    const { workbook, api } = setup();
    await user.click(screen.getByRole('cell', { name: 'First A1 cell' }));
    await deleteAxis(user, 'column');
    await user.click(screen.getByRole('button', { name: 'Delete property' }));
    await waitFor(() => expect(api.saveModelLifecycle).toHaveBeenCalledOnce());
    const after = api.saveModelLifecycle.mock.calls[0]![1];
    expect(after.dataModels!.model.columns.map((column: { id: string }) => column.id)).toEqual(['keep']);
    for (const id of ['first', 'second']) {
      const before = workbook.documents[id]!;
      const next = after.documents[id]!;
      expect(next.content.columns).toEqual([before.content.columns[1]]);
      expect(Object.values(next.content.cells)).toEqual([Object.values(before.content.cells)[1]]);
    }
    await waitFor(() => expect(screen.getByRole('cell', { name: 'First A1 cell' })).toHaveFocus());
  });

  it.each(['Cancel', 'Escape'])('cancels with %s without changing data or selection', async (method) => {
    const user = userEvent.setup();
    const { api } = setup();
    const cell = screen.getByRole('cell', { name: 'First A1 cell' });
    await user.click(cell);
    await deleteAxis(user, 'column');
    if (method === 'Cancel') await user.click(screen.getByRole('button', { name: 'Cancel' }));
    else await user.keyboard('{Escape}');
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(screen.getByRole('cell', { name: 'First A1 cell' })).toHaveFocus();
    expect(screen.getByRole('cell', { name: 'First A1 cell' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('cell', { name: 'Second A1 cell' })).toBeInTheDocument();
  });
});
