import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { persistedWorkbookClient } from '@test-support/apiClients';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { workbookApi } from '@infrastructure/persistence/workbookApi';
import { App } from './App';

const confirm = vi.hoisted(() => vi.fn());
const capture = vi.hoisted(() => ({ real: false, controller: undefined as unknown }));
vi.mock('@application/react/useWorkbookController', async (importOriginal) => {
  const original = await importOriginal<typeof import('@application/react/useWorkbookController')>();
  return { useWorkbookController: (...args: Parameters<typeof original.useWorkbookController>) => {
    const controller = original.useWorkbookController(...args);
    capture.controller = controller;
    if (capture.real) return controller;
    return { ...controller, commands: { ...controller.commands, undo: confirm },
      recordReplay: { pending: false, unresolved: true, error: 'The workbook changed on sheet Inputs.' } };
  } };
});

it('shows contextual HTTP replay errors from the real controller', async () => {
  const model = { id: 'model', name: 'Model', columns: [{ id: 'input', name: 'Input', kind: 'manual' as const, type: 'float' as const }] };
  const workbook = { ...workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 })]), dataModels: { model } };
  const bound = bindSheetToModel(workbook, 'sheet', 'model', () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  const api = persistedWorkbookClient(bound.value);
  api.replayRecord.mockImplementation(workbookApi.replayRecord);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'sheet-revision-conflict', sheetId: 'dependency', expectedRevision: 3, actualRevision: 4 }) }));
  capture.real = true;
  try {
    const view = render(<App initialWorkbook={bound.value} apiClient={api} />);
    const controller = () => capture.controller as ReturnType<typeof import('@application/react/useWorkbookController').useWorkbookController>;
    act(() => controller().commands.changeEntryField('sheet', 'input', '1'));
    await act(async () => { await controller().commands.submitEntryDraft('sheet'); });
    act(() => controller().commands.undo());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('sheet dependency, expected revision 3, actual revision 4'));
    view.unmount();
  } finally { capture.real = false; vi.unstubAllGlobals(); }
});

it('shows replay failure context and offers confirmation even without undo history', () => {
  render(<App initialWorkbook={workbookWithSheets([])} />);
  expect(screen.getByRole('alert')).toHaveTextContent('The workbook changed on sheet Inputs.');
  expect(screen.getByText(/needs confirmation/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm previous undo or redo' }));
  expect(confirm).toHaveBeenCalledOnce();
});
