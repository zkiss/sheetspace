import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient, deferred, persistedWorkbookClient } from './test/apiClients';
import {
  createSheetFromToolbar,
  openCellEditor,
  openSheetContextMenu,
  resizeHandle,
  workspaceSurface,
} from './test/appScreen';
import { testRect, workspaceRect } from './test/domGeometry';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';
import type { Workbook } from './workbook';
import { WorkbookApiError } from './workbookApi';

afterEach(() => {
  cleanup();
});

describe('App workspace', () => {
  it('loads the current workbook before showing the editable workspace', async () => {
    const apiClient = {
      loadWorkbook: vi.fn().mockResolvedValue(
        workbookWithSheets([positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 })]),
      ),
    };

    render(<App apiClient={apiClient} />);

    expect(screen.getByText('Loading workbook...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new sheet/i })).not.toBeInTheDocument();

    expect(await screen.findByRole('article', { name: 'Sheet Inputs' })).toBeInTheDocument();
    expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1 sheets')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved');
  });

  it('restores persisted MVP workbook state on startup and recomputes formulas from raw cells', async () => {
    const user = userEvent.setup();
    const rawFormula = '= \n SuM ( B1 , B2 )';
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Renamed Inputs', { x: 72, y: 144 }),
      rowCount: 22,
      columnCount: 12,
      cells: {
        A1: { raw: 'Region' },
        A2: { raw: rawFormula },
        B1: { raw: '10' },
        B2: { raw: '5' },
      },
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 }),
      rowCount: 3,
      columnCount: 3,
      cells: {
        A1: { raw: '=SUM(Renamed Inputs!B1:B2)' },
      },
    };
    const apiClient = {
      loadWorkbook: vi.fn().mockResolvedValue(workbookWithSheets([inputs, outputs])),
    };

    render(<App apiClient={apiClient} />);

    const inputFrame = await screen.findByRole('article', { name: 'Sheet Renamed Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

    expect(inputFrame).toHaveAttribute('data-sheet-id', 'sheet-inputs');
    expect(inputFrame).toHaveAttribute('data-position-x', '72');
    expect(inputFrame).toHaveAttribute('data-position-y', '144');
    expect(inputFrame).toHaveAttribute('data-row-count', '22');
    expect(inputFrame).toHaveAttribute('data-column-count', '12');
    expect(outputFrame).toHaveAttribute('data-position-x', '420');
    expect(outputFrame).toHaveAttribute('data-position-y', '260');
    expect(within(inputFrame).getByRole('cell', { name: 'Renamed Inputs A1 cell' })).toHaveTextContent('Region');
    expect(within(inputFrame).getByRole('cell', { name: 'Renamed Inputs B1 cell' })).toHaveTextContent('10');
    expect(within(inputFrame).getByRole('cell', { name: 'Renamed Inputs A2 cell' })).toHaveTextContent('15');
    expect(within(outputFrame).getByRole('cell', { name: 'Outputs A1 cell' })).toHaveTextContent('15');

    const formulaEditor = await openCellEditor(
      user,
      within(inputFrame).getByRole('cell', { name: 'Renamed Inputs A2 cell' }),
    );
    expect(formulaEditor).toHaveValue(rawFormula);

    await user.keyboard('{Escape}');
    const crossSheetFormulaEditor = await openCellEditor(
      user,
      within(outputFrame).getByRole('cell', { name: 'Outputs A1 cell' }),
    );
    expect(crossSheetFormulaEditor).toHaveValue('=SUM(Renamed Inputs!B1:B2)');
    expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(1);
  });

  it(
    'persists and reloads the complete MVP workflow across creation paths, arrangement, rename, formulas, and appended dimensions',
    async () => {
      const user = userEvent.setup();
      const rawSameSheetFormula = '= \n SuM ( B1 , B2 )';
      const rawCrossSheetFormula = '=SUM(Renamed Inputs!B1:B2)';
      const apiClient = persistedWorkbookClient();

      render(<App initialWorkbook={workbookWithSheets([])} apiClient={apiClient} />);

      await createSheetFromToolbar('Inputs');
      await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(1));

      workspaceSurface().getBoundingClientRect = workspaceRect;
      fireEvent.contextMenu(workspaceSurface(), { clientX: 440, clientY: 290 });
      await user.type(screen.getByLabelText(/sheet name/i), 'Outputs');
      await user.click(screen.getByRole('button', { name: /^create$/i }));
      await waitFor(() => expect(apiClient.createSheet).toHaveBeenCalledTimes(2));

      let inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
      const inputHeader = within(inputFrame).getByTestId('sheet-frame-header');
      fireEvent(inputHeader, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
      fireEvent(inputHeader, new MouseEvent('pointermove', { bubbles: true, clientX: 172, clientY: 264 }));
      fireEvent(inputHeader, new MouseEvent('pointerup', { bubbles: true, clientX: 172, clientY: 264 }));
      await waitFor(() =>
        expect(apiClient.updateSheetPosition).toHaveBeenCalledWith('sheet-1', { x: 72, y: 144 }, { revision: 0 }),
      );

      await user.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Rename' }));
      await user.clear(screen.getByLabelText(/sheet name/i));
      await user.type(screen.getByLabelText(/sheet name/i), 'Renamed Inputs');
      await user.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() =>
        expect(apiClient.renameSheet).toHaveBeenCalledWith('sheet-1', 'Renamed Inputs', { revision: 0 }),
      );

      inputFrame = screen.getByRole('article', { name: 'Sheet Renamed Inputs' });
      const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

      let editor = await openCellEditor(
        user,
        within(inputFrame).getByRole('cell', { name: 'Renamed Inputs B1 empty cell' }),
      );
      await user.type(editor, '10');
      await user.keyboard('{Enter}');

      editor = await openCellEditor(
        user,
        within(inputFrame).getByRole('cell', { name: 'Renamed Inputs B2 empty cell' }),
      );
      await user.type(editor, '5');
      await user.keyboard('{Enter}');

      editor = await openCellEditor(
        user,
        within(inputFrame).getByRole('cell', { name: 'Renamed Inputs C1 empty cell' }),
      );
      fireEvent.change(editor, { target: { value: rawSameSheetFormula } });
      await user.keyboard('{Enter}');

      editor = await openCellEditor(user, within(outputFrame).getByRole('cell', { name: 'Outputs A1 empty cell' }));
      await user.type(editor, rawCrossSheetFormula);
      await user.keyboard('{Enter}');

      await user.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Append row' }));
      await user.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Append column' }));

      await waitFor(() => expect(apiClient.updateCellContent).toHaveBeenCalledTimes(4));
      await waitFor(() => expect(apiClient.appendRow).toHaveBeenCalledWith('sheet-1', { revision: 0 }));
      await waitFor(() => expect(apiClient.appendColumn).toHaveBeenCalledWith('sheet-1', { revision: 0 }));
      expect(within(inputFrame).getByRole('cell', { name: 'Renamed Inputs C1 cell' })).toHaveTextContent('15');
      expect(within(outputFrame).getByRole('cell', { name: 'Outputs A1 cell' })).toHaveTextContent('15');

      cleanup();
      render(<App apiClient={apiClient} />);

      const reloadedInputFrame = await screen.findByRole('article', { name: 'Sheet Renamed Inputs' });
      const reloadedOutputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

      expect(reloadedInputFrame).toHaveAttribute('data-sheet-id', 'sheet-1');
      expect(reloadedInputFrame).toHaveAttribute('data-position-x', '72');
      expect(reloadedInputFrame).toHaveAttribute('data-position-y', '144');
      expect(reloadedInputFrame).toHaveAttribute('data-row-count', '21');
      expect(reloadedInputFrame).toHaveAttribute('data-column-count', '11');
      expect(reloadedOutputFrame).toHaveAttribute('data-sheet-id', 'sheet-2');
      expect(reloadedOutputFrame).toHaveAttribute('data-position-x', '420');
      expect(reloadedOutputFrame).toHaveAttribute('data-position-y', '260');
      expect(within(reloadedInputFrame).getByRole('cell', { name: 'Renamed Inputs C1 cell' })).toHaveTextContent(
        '15',
      );
      expect(within(reloadedOutputFrame).getByRole('cell', { name: 'Outputs A1 cell' })).toHaveTextContent('15');

      editor = await openCellEditor(
        user,
        within(reloadedInputFrame).getByRole('cell', { name: 'Renamed Inputs C1 cell' }),
      );
      expect(editor).toHaveValue(rawSameSheetFormula);
      await user.keyboard('{Escape}');

      editor = await openCellEditor(user, within(reloadedOutputFrame).getByRole('cell', { name: 'Outputs A1 cell' }));
      expect(editor).toHaveValue(rawCrossSheetFormula);
      expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(1);
    },
    10_000,
  );

  it('autosaves committed sheet creation and reports app-level save status', async () => {
    const savedWorkbook = workbookWithSheets([positionedSheet('sheet-1', 'Inputs', { x: 0, y: 0 })]);
    const createSave = deferred<Workbook>();
    const apiClient = autosaveClient({
      createSheet: vi.fn().mockReturnValue(createSave.promise),
    });
    const user = userEvent.setup();

    render(<App initialWorkbook={workbookWithSheets([])} apiClient={apiClient} />);

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.type(screen.getByLabelText(/sheet name/i), 'Inputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(apiClient.createSheet).toHaveBeenCalledWith({
      id: 'sheet-1',
      name: 'Inputs',
      position: { x: 0, y: 0 },
      frameSize: { width: 240, height: 160 },
      zIndex: 1,
    });
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saving...');

    createSave.resolve(savedWorkbook);

    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
  });

  it('autosaves committed renames, positions, row appends, column appends, and z-order updates', async () => {
    const user = userEvent.setup();
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 }), zIndex: 2 };
    const apiClient = autosaveClient();

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} apiClient={apiClient} />);

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    await user.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Rename' }));
    await user.clear(screen.getByLabelText(/sheet name/i));
    await user.type(screen.getByLabelText(/sheet name/i), 'Renamed Inputs');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(apiClient.renameSheet).toHaveBeenCalledWith('sheet-inputs', 'Renamed Inputs', { revision: 0 });

    const renamedFrame = screen.getByRole('article', { name: 'Sheet Renamed Inputs' });
    const header = within(renamedFrame).getByTestId('sheet-frame-header');
    fireEvent(header, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(header, new MouseEvent('pointermove', { bubbles: true, clientX: 130, clientY: 150 }));
    fireEvent(header, new MouseEvent('pointerup', { bubbles: true, clientX: 130, clientY: 150 }));

    expect(apiClient.updateSheetPosition).toHaveBeenCalledWith('sheet-inputs', { x: 78, y: 126 }, { revision: 0 });

    await user.click(within(openSheetContextMenu(renamedFrame)).getByRole('menuitem', { name: 'Append row' }));
    await user.click(within(openSheetContextMenu(renamedFrame)).getByRole('menuitem', { name: 'Append column' }));

    expect(apiClient.appendRow).toHaveBeenCalledWith('sheet-inputs', { revision: 0 });
    expect(apiClient.appendColumn).toHaveBeenCalledWith('sheet-inputs', { revision: 0 });

    await user.click(within(openSheetContextMenu(renamedFrame)).getByRole('menuitem', { name: 'Bring forward' }));

    expect(apiClient.updateSheetZIndex).toHaveBeenCalledWith('sheet-inputs', 2, { revision: 0 });
    expect(apiClient.updateSheetZIndex).toHaveBeenCalledWith('sheet-outputs', 1, { revision: 0 });
  });

  it('does not autosave transient in-progress cell edits until they are committed', async () => {
    const user = userEvent.setup();
    const apiClient = autosaveClient();

    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
        apiClient={apiClient}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const editor = await openCellEditor(user, cell);
    await user.type(editor, 'Draft');

    expect(apiClient.updateCellContent).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');

    expect(apiClient.updateCellContent).toHaveBeenCalledWith('sheet-inputs', 'A1', 'Draft', { revision: 0 });
  });

  it('keeps the workbook editable and shows failed unsaved state after autosave failure', async () => {
    const user = userEvent.setup();
    const failedSave = deferred<Workbook>();
    const apiClient = autosaveClient({
      updateCellContent: vi.fn().mockReturnValue(failedSave.promise),
    });

    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
        apiClient={apiClient}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const a1Editor = await openCellEditor(user, a1);
    await user.type(a1Editor, 'Local value');
    await user.keyboard('{Enter}');

    failedSave.reject(new Error('backend unavailable'));

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Save failed - unsaved changes'),
    );
    expect(a1).toHaveTextContent('Local value');

    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const b1Editor = await openCellEditor(user, b1);
    await user.type(b1Editor, 'Still editable');
    await user.keyboard('{Enter}');

    expect(b1).toHaveTextContent('Still editable');
  });

  it('reloads a fresh revision and retries a conflicting autosave without replacing local committed edits', async () => {
    const user = userEvent.setup();
    const initialSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 });
    const staleServerSheet = { ...initialSheet, revision: 4, cells: { A1: { raw: 'server value' } } };
    const savedServerSheet = { ...staleServerSheet, revision: 5, cells: { A1: { raw: 'Local value' } } };
    const apiClient = autosaveClient({
      loadWorkbook: vi.fn().mockResolvedValue(workbookWithSheets([staleServerSheet])),
      updateCellContent: vi
        .fn()
        .mockRejectedValueOnce(new WorkbookApiError('sheet-revision-conflict', 409, 'sheet-revision-conflict'))
        .mockResolvedValueOnce(workbookWithSheets([savedServerSheet])),
    });

    render(<App initialWorkbook={workbookWithSheets([initialSheet])} apiClient={apiClient} />);

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const a1Editor = await openCellEditor(user, a1);
    await user.type(a1Editor, 'Local value');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(apiClient.updateCellContent).toHaveBeenCalledTimes(2));
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(1, 'sheet-inputs', 'A1', 'Local value', {
      revision: 0,
    });
    expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(1);
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(2, 'sheet-inputs', 'A1', 'Local value', {
      revision: 4,
    });
    expect(a1).toHaveTextContent('Local value');
    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
  });

  it('runs one save per entity key and keeps only the latest queued replacement', async () => {
    const user = userEvent.setup();
    const firstSave = deferred<Workbook>();
    const queuedSave = deferred<Workbook>();
    const apiClient = autosaveClient({
      updateCellContent: vi.fn().mockReturnValueOnce(firstSave.promise).mockReturnValueOnce(queuedSave.promise),
    });

    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
        apiClient={apiClient}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    let editor = await openCellEditor(user, cell);
    await user.type(editor, 'One');
    await user.keyboard('{Enter}');

    editor = await openCellEditor(user, cell);
    await user.clear(editor);
    await user.type(editor, 'Two');
    await user.keyboard('{Enter}');

    editor = await openCellEditor(user, cell);
    await user.clear(editor);
    await user.type(editor, 'Three');
    await user.keyboard('{Enter}');

    expect(apiClient.updateCellContent).toHaveBeenCalledTimes(1);
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(1, 'sheet-inputs', 'A1', 'One', { revision: 0 });
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saving...');

    firstSave.resolve(workbookWithSheets([]));

    await waitFor(() => expect(apiClient.updateCellContent).toHaveBeenCalledTimes(2));
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(2, 'sheet-inputs', 'A1', 'Three', { revision: 0 });
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saving...');

    queuedSave.resolve(workbookWithSheets([]));

    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
  });

  it('saves different entity keys in parallel', async () => {
    const user = userEvent.setup();
    const a1Save = deferred<Workbook>();
    const b1Save = deferred<Workbook>();
    const apiClient = autosaveClient({
      updateCellContent: vi.fn().mockReturnValueOnce(a1Save.promise).mockReturnValueOnce(b1Save.promise),
    });

    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
        apiClient={apiClient}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const a1Editor = await openCellEditor(user, a1);
    await user.type(a1Editor, 'A');
    await user.keyboard('{Enter}');

    const b1Editor = await openCellEditor(user, b1);
    await user.type(b1Editor, 'B');
    await user.keyboard('{Enter}');

    expect(apiClient.updateCellContent).toHaveBeenCalledTimes(2);
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(1, 'sheet-inputs', 'A1', 'A', { revision: 0 });
    expect(apiClient.updateCellContent).toHaveBeenNthCalledWith(2, 'sheet-inputs', 'B1', 'B', { revision: 0 });
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saving...');

    b1Save.resolve(workbookWithSheets([]));

    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saving...'));

    a1Save.resolve(workbookWithSheets([]));

    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved'));
  });

  it('keeps failed unsaved status when an older parallel different-key save fails', async () => {
    const user = userEvent.setup();
    const a1Save = deferred<Workbook>();
    const b1Save = deferred<Workbook>();
    const apiClient = autosaveClient({
      updateCellContent: vi.fn().mockReturnValueOnce(a1Save.promise).mockReturnValueOnce(b1Save.promise),
    });

    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
        apiClient={apiClient}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const a1Editor = await openCellEditor(user, a1);
    await user.type(a1Editor, 'A');
    await user.keyboard('{Enter}');

    const b1Editor = await openCellEditor(user, b1);
    await user.type(b1Editor, 'B');
    await user.keyboard('{Enter}');

    expect(apiClient.updateCellContent).toHaveBeenCalledTimes(2);

    b1Save.resolve(workbookWithSheets([]));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saving...'));

    a1Save.reject(new Error('backend unavailable'));

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Save failed - unsaved changes'),
    );
  });

  it('renders an empty workspace after loading an empty backend state', async () => {
    const apiClient = {
      loadWorkbook: vi.fn().mockResolvedValue(workbookWithSheets([])),
    };

    render(<App apiClient={apiClient} />);

    expect(await screen.findByText(/right-click the workspace/i)).toBeInTheDocument();
    expect(screen.queryByTestId('sheet-frame')).not.toBeInTheDocument();
    expect(screen.getByText('0 sheets')).toBeInTheDocument();
  });

  it('blocks editing on startup load failure and retries into the workspace', async () => {
    const apiClient = {
      loadWorkbook: vi
        .fn()
        .mockRejectedValueOnce(new Error('backend unavailable'))
        .mockResolvedValueOnce(workbookWithSheets([])),
    };
    const user = userEvent.setup();

    render(<App apiClient={apiClient} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('backend unavailable');
    expect(screen.queryByRole('button', { name: /new sheet/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-surface')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('region', { name: /spatial workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new sheet/i })).toBeInTheDocument();
    expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(2);
  });

  it('opens to an empty spatial workspace without a default sheet', () => {
    render(<App initialWorkbook={workbookWithSheets([])} />);

    expect(screen.getByRole('heading', { name: 'Sheetspace' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /spatial workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/right-click the workspace/i)).toBeInTheDocument();
    expect(screen.queryByTestId('sheet-frame')).not.toBeInTheDocument();
    expect(screen.getByText('0 sheets')).toBeInTheDocument();
  });

  it('renders an empty workbook without sheet frames', () => {
    render(<App initialWorkbook={workbookWithSheets([])} />);

    expect(screen.queryByTestId('sheet-frame')).not.toBeInTheDocument();
    expect(screen.getByText('0 sheets')).toBeInTheDocument();
  });

  it('renders one positioned sheet frame with the visible sheet name and grid body area', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    expect(frame).toHaveAttribute('data-sheet-id', 'sheet-inputs');
    expect(frame).toHaveStyle({ left: '120px', top: '80px' });
    expect(frame).toHaveStyle({ width: '240px', height: '160px' });
    expect(frame).toHaveAttribute('data-frame-width', '240');
    expect(frame).toHaveAttribute('data-frame-height', '160');
    expect(within(frame).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(within(frame).getByRole('table', { name: 'Inputs grid' })).toBeInTheDocument();
    expect(screen.queryByText(/right-click the workspace/i)).not.toBeInTheDocument();
  });

  it('renders multiple frames at their independent sheet positions without requiring cell values', () => {
    const first = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const second = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 }),
      cells: {},
    };

    render(<App initialWorkbook={workbookWithSheets([first, second])} />);

    const frames = screen.getAllByTestId('sheet-frame');
    expect(frames).toHaveLength(2);
    expect(frames[0]).toHaveAttribute('data-sheet-id', 'sheet-inputs');
    expect(frames[0]).toHaveStyle({ left: '48px', top: '96px' });
    expect(within(frames[0]).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(frames[1]).toHaveAttribute('data-sheet-id', 'sheet-outputs');
    expect(frames[1]).toHaveStyle({ left: '420px', top: '260px' });
    expect(within(frames[1]).getByRole('heading', { name: 'Outputs' })).toBeInTheDocument();
    expect(screen.getAllByTestId('sheet-frame-body')).toHaveLength(2);
  });

  it('pans the workspace with viewport controls while preserving frame workspace coordinates', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const surface = workspaceSurface();
    const plane = screen.getByTestId('workspace-plane');
    const frame = screen.getByTestId('sheet-frame');

    await user.click(screen.getByRole('button', { name: 'Pan workspace right' }));
    await user.click(screen.getByRole('button', { name: 'Pan workspace down' }));

    expect(surface).toHaveAttribute('data-viewport-x', '80');
    expect(surface).toHaveAttribute('data-viewport-y', '80');
    expect(surface).toHaveAttribute('data-viewport-scale', '1');
    expect(plane).toHaveStyle({ transform: 'translate(80px, 80px) scale(1)' });
    expect(frame).toHaveStyle({ left: '120px', top: '80px' });
  });

  it('pans the workspace by dragging empty workspace without starting cell interaction', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const surface = workspaceSurface();
    fireEvent(surface, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(surface, new MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 170 }));
    fireEvent(surface, new MouseEvent('pointerup', { bubbles: true, clientX: 160, clientY: 170 }));

    expect(surface).toHaveAttribute('data-viewport-x', '60');
    expect(surface).toHaveAttribute('data-viewport-y', '50');
    expect(screen.getByTestId('sheet-frame')).not.toHaveAttribute('data-active-sheet');
  });

  it('moves a sheet frame by dragging its header', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const header = within(frame).getByTestId('sheet-frame-header');

    fireEvent(header, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(header, new MouseEvent('pointermove', { bubbles: true, clientX: 148, clientY: 154 }));
    fireEvent(header, new MouseEvent('pointerup', { bubbles: true, clientX: 148, clientY: 154 }));

    expect(frame).toHaveStyle({ left: '168px', top: '114px' });
    expect(frame).toHaveAttribute('data-position-x', '168');
    expect(frame).toHaveAttribute('data-position-y', '114');
  });

  it('keeps other sheet positions unchanged when one frame header is dragged', () => {
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const inputHeader = within(inputFrame).getByTestId('sheet-frame-header');

    fireEvent(inputHeader, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(inputHeader, new MouseEvent('pointermove', { bubbles: true, clientX: 130, clientY: 105 }));
    fireEvent(inputHeader, new MouseEvent('pointerup', { bubbles: true, clientX: 130, clientY: 105 }));

    expect(inputFrame).toHaveStyle({ left: '78px', top: '81px' });
    expect(outputFrame).toHaveStyle({ left: '420px', top: '260px' });
  });

  it('does not move a sheet frame when dragging the grid body', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const body = within(frame).getByTestId('sheet-frame-body');

    fireEvent(body, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(body, new MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 170 }));
    fireEvent(body, new MouseEvent('pointerup', { bubbles: true, clientX: 160, clientY: 170 }));

    expect(frame).toHaveStyle({ left: '120px', top: '80px' });
  });

  it('resizes a sheet frame horizontally from the right border', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const rightHandle = resizeHandle(frame, 'right');

    fireEvent(rightHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 360, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 440, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 440, clientY: 120 }));

    expect(frame).toHaveStyle({ left: '120px', top: '80px', width: '320px', height: '160px' });
    expect(frame).toHaveAttribute('data-frame-width', '320');
    expect(frame).toHaveAttribute('data-frame-height', '160');
  });

  it('resizes a sheet frame vertically from the top border while keeping the bottom edge fixed', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const topHandle = resizeHandle(frame, 'top');

    fireEvent(topHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 220, clientY: 80 }));
    fireEvent(topHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 220, clientY: 40 }));
    fireEvent(topHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 220, clientY: 40 }));

    expect(frame).toHaveStyle({ left: '120px', top: '40px', width: '240px', height: '200px' });
    expect(frame).toHaveAttribute('data-position-y', '40');
    expect(frame).toHaveAttribute('data-frame-height', '200');
  });

  it('resizes both dimensions from a corner without affecting other frames', () => {
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const cornerHandle = resizeHandle(inputFrame, 'bottom-right');

    fireEvent(cornerHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 288, clientY: 256 }));
    fireEvent(cornerHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 328, clientY: 306 }));
    fireEvent(cornerHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 328, clientY: 306 }));

    expect(inputFrame).toHaveStyle({ left: '48px', top: '96px', width: '280px', height: '210px' });
    expect(outputFrame).toHaveStyle({ left: '420px', top: '260px', width: '240px', height: '160px' });
  });

  it('clamps resized frames to practical minimum dimensions', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const leftHandle = resizeHandle(frame, 'left');

    fireEvent(leftHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 120, clientY: 120 }));
    fireEvent(leftHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 260, clientY: 120 }));
    fireEvent(leftHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 260, clientY: 120 }));

    expect(frame).toHaveStyle({ left: '180px', top: '80px', width: '180px', height: '160px' });
    expect(frame).toHaveAttribute('data-position-x', '180');
  });

  it('uses workspace-coordinate deltas when resizing after pan and zoom', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pan workspace right' }));
    await user.click(screen.getByRole('button', { name: 'Pan workspace down' }));
    await user.click(screen.getByRole('button', { name: 'Zoom workspace in' }));

    const frame = screen.getByTestId('sheet-frame');
    const rightHandle = resizeHandle(frame, 'right');

    fireEvent(rightHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 360, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 420, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 420, clientY: 120 }));

    expect(workspaceSurface()).toHaveAttribute('data-viewport-scale', '1.2');
    expect(frame).toHaveStyle({ left: '120px', top: '80px', width: '290px', height: '160px' });
  });

  it('autosaves updated frame size after resizing a persisted workbook', () => {
    const apiClient = autosaveClient();
    render(
      <App
        apiClient={apiClient}
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const rightHandle = resizeHandle(frame, 'right');

    fireEvent(rightHandle, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 360, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointermove', { bubbles: true, clientX: 420, clientY: 120 }));
    fireEvent(rightHandle, new MouseEvent('pointerup', { bubbles: true, clientX: 420, clientY: 120 }));

    expect(apiClient.updateSheetFrameSize).toHaveBeenCalledWith(
      'sheet-inputs',
      { width: 300, height: 160 },
      { revision: 0 },
    );
  });

  it('uses workspace-coordinate deltas when dragging a frame header after pan and zoom', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pan workspace right' }));
    await user.click(screen.getByRole('button', { name: 'Pan workspace down' }));
    await user.click(screen.getByRole('button', { name: 'Zoom workspace in' }));

    const frame = screen.getByTestId('sheet-frame');
    const header = within(frame).getByTestId('sheet-frame-header');

    fireEvent(header, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));
    fireEvent(header, new MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 156 }));
    fireEvent(header, new MouseEvent('pointerup', { bubbles: true, clientX: 160, clientY: 156 }));

    expect(workspaceSurface()).toHaveAttribute('data-viewport-x', '96');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-y', '96');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-scale', '1.2');
    expect(frame).toHaveStyle({ left: '170px', top: '110px' });
  });

  it('accumulates zoomed frame drag movement from total pointer displacement', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    for (let count = 0; count < 5; count += 1) {
      await user.click(screen.getByRole('button', { name: 'Zoom workspace in' }));
    }

    const frame = screen.getByTestId('sheet-frame');
    const header = within(frame).getByTestId('sheet-frame-header');

    fireEvent(header, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 120 }));

    for (let clientX = 101; clientX <= 110; clientX += 1) {
      fireEvent(header, new MouseEvent('pointermove', { bubbles: true, clientX, clientY: 120 }));
    }

    fireEvent(header, new MouseEvent('pointerup', { bubbles: true, clientX: 110, clientY: 120 }));

    expect(Number(workspaceSurface().dataset.viewportScale)).toBeCloseTo(2);
    expect(frame).toHaveStyle({ left: '125px', top: '80px' });
  });

  it('zooms the workspace with controls and clamps unusable extreme scales', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    const surface = workspaceSurface();

    for (let count = 0; count < 10; count += 1) {
      await user.click(screen.getByRole('button', { name: 'Zoom workspace in' }));
    }

    expect(surface).toHaveAttribute('data-viewport-scale', '2');
    expect(screen.getByLabelText('Workspace zoom level')).toHaveTextContent('200%');

    for (let count = 0; count < 12; count += 1) {
      await user.click(screen.getByRole('button', { name: 'Zoom workspace out' }));
    }

    expect(surface).toHaveAttribute('data-viewport-scale', '0.5');
    expect(screen.getByLabelText('Workspace zoom level')).toHaveTextContent('50%');

    await user.click(screen.getByRole('button', { name: 'Reset workspace viewport' }));

    expect(surface).toHaveAttribute('data-viewport-x', '0');
    expect(surface).toHaveAttribute('data-viewport-y', '0');
    expect(surface).toHaveAttribute('data-viewport-scale', '1');
  });

  it('zooms empty workspace around the wheel pointer without changing stored frame positions', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    workspaceSurface().getBoundingClientRect = workspaceRect;

    fireEvent.wheel(workspaceSurface(), { clientX: 220, clientY: 180, deltaY: -100 });

    expect(workspaceSurface()).toHaveAttribute('data-viewport-scale', '1.2');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-x', '-40');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-y', '-30');
    expect(screen.getByTestId('sheet-frame')).toHaveStyle({ left: '120px', top: '80px' });
  });

  it('renders new sheets as default 10-column by 20-row grids without stored cells', () => {
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 });

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByTestId('sheet-frame');
    expect(frame).toHaveAttribute('data-column-count', '10');
    expect(frame).toHaveAttribute('data-row-count', '20');
    expect(sheet.cells).toEqual({});
    expect(within(frame).getAllByRole('columnheader')).toHaveLength(11);
    expect(within(frame).getAllByRole('rowheader')).toHaveLength(20);
    expect(within(frame).getAllByTestId('sheet-grid-cell')).toHaveLength(200);
  });

  it('renders spreadsheet row numbers and Excel-style column labels beyond Z', () => {
    const sheet = {
      ...positionedSheet('sheet-wide', 'Wide Sheet', { x: 0, y: 0 }),
      columnCount: 28,
      rowCount: 3,
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const grid = screen.getByRole('table', { name: 'Wide Sheet grid' });
    expect(within(grid).getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: 'Z' })).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: 'AA' })).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: 'AB' })).toBeInTheDocument();
    expect(within(grid).getByRole('rowheader', { name: '1' })).toBeInTheDocument();
    expect(within(grid).getByRole('rowheader', { name: '3' })).toBeInTheDocument();
  });

  it('renders empty cells as visible addressable cells', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const j20 = within(frame).getByRole('cell', { name: 'Inputs J20 empty cell' });

    expect(a1).toHaveAttribute('data-cell-key', 'A1');
    expect(a1).toHaveTextContent('');
    expect(j20).toHaveAttribute('data-cell-key', 'J20');
    expect(j20).toHaveTextContent('');
  });

  it('selects a single cell and visibly marks it as active', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });

    await user.click(a1);

    expect(frame).toHaveAttribute('data-active-sheet', 'true');
    expect(a1).toHaveAttribute('data-active-cell', 'true');
    expect(a1).toHaveClass('sheet-grid-cell-active');
  });

  it('moves single-cell selection within a sheet', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b2 = within(frame).getByRole('cell', { name: 'Inputs B2 empty cell' });

    await user.click(a1);
    await user.click(b2);

    expect(a1).not.toHaveAttribute('data-active-cell');
    expect(b2).toHaveAttribute('data-active-cell', 'true');
    expect(within(frame).getAllByTestId('sheet-grid-cell').filter((cell) => cell.dataset.activeCell)).toHaveLength(
      1,
    );
  });

  it('moves active sheet and cell focus when selecting a cell in another sheet', async () => {
    const user = userEvent.setup();
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const inputsA1 = within(inputFrame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const outputsB2 = within(outputFrame).getByRole('cell', { name: 'Outputs B2 empty cell' });

    await user.click(inputsA1);
    await user.click(outputsB2);

    expect(inputFrame).not.toHaveAttribute('data-active-sheet');
    expect(inputsA1).not.toHaveAttribute('data-active-cell');
    expect(outputFrame).toHaveAttribute('data-active-sheet', 'true');
    expect(outputsB2).toHaveAttribute('data-active-cell', 'true');
  });

  it('moves selected cells with arrow keys and clamps at sheet bounds', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      rowCount: 2,
      columnCount: 2,
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = within(frame).getByRole('cell', { name: 'Inputs B1 empty cell' });
    const a2 = within(frame).getByRole('cell', { name: 'Inputs A2 empty cell' });
    const b2 = within(frame).getByRole('cell', { name: 'Inputs B2 empty cell' });

    await user.click(a1);
    await user.keyboard('{ArrowRight}');
    expect(b1).toHaveAttribute('data-active-cell', 'true');
    expect(b1).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(b2).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(a2).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('{ArrowUp}');
    expect(a1).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(a1).toHaveAttribute('data-active-cell', 'true');
  });

  it('scrolls the selected cell into view after keyboard navigation', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      render(
        <App
          initialWorkbook={workbookWithSheets([
            positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
          ])}
        />,
      );

      const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
      const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });

      await user.click(a1);
      scrollIntoView.mockClear();
      await user.keyboard('{ArrowRight}');

      expect(b1).toHaveAttribute('data-active-cell', 'true');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('keeps keyboard-navigated cells fully visible outside sticky headers', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    Element.prototype.getBoundingClientRect = function getMockRect() {
      if (this.classList.contains('sheet-frame-body')) {
        return testRect({ left: 0, top: 0, width: 220, height: 140 });
      }

      if (this.classList.contains('sheet-grid-column-header')) {
        return testRect({ left: 40, top: 0, width: 76, height: 24 });
      }

      if (this.classList.contains('sheet-grid-row-header')) {
        return testRect({ left: 0, top: 24, width: 40, height: 24 });
      }

      if ((this as HTMLElement).dataset.cellKey === 'B1') {
        return testRect({ left: 80, top: 10, width: 76, height: 24 });
      }

      if ((this as HTMLElement).dataset.cellKey === 'A1') {
        return testRect({ left: 20, top: 10, width: 76, height: 24 });
      }

      return testRect({ left: 80, top: 48, width: 76, height: 24 });
    };

    try {
      render(
        <App
          initialWorkbook={workbookWithSheets([
            {
              ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
              rowCount: 2,
              columnCount: 2,
            },
          ])}
        />,
      );

      const frame = screen.getByTestId('sheet-frame');
      const frameBody = within(frame).getByTestId('sheet-frame-body');
      const b2 = within(frame).getByRole('cell', { name: 'Inputs B2 empty cell' });
      const b1 = within(frame).getByRole('cell', { name: 'Inputs B1 empty cell' });
      const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });

      await user.click(b2);
      frameBody.scrollTop = 100;
      frameBody.scrollLeft = 100;

      await user.keyboard('{ArrowUp}');

      expect(b1).toHaveAttribute('data-active-cell', 'true');
      expect(frameBody.scrollTop).toBe(86);
      expect(frameBody.scrollLeft).toBe(100);

      await user.keyboard('{ArrowLeft}');

      expect(a1).toHaveAttribute('data-active-cell', 'true');
      expect(frameBody.scrollTop).toBe(72);
      expect(frameBody.scrollLeft).toBe(80);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it('moves active selection when keyboard focus moves to another cell', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const a1 = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = within(frame).getByRole('cell', { name: 'Inputs B1 empty cell' });

    fireEvent.focus(a1);
    expect(a1).toHaveAttribute('data-active-cell', 'true');

    fireEvent.focus(b1);
    expect(a1).not.toHaveAttribute('data-active-cell');
    expect(b1).toHaveAttribute('data-active-cell', 'true');
  });

  it('commits an active edit when keyboard focus moves to another cell', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByTestId('sheet-frame');
    const editedCell = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const nextCell = within(frame).getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, editedCell);
    await user.type(editor, 'Keyboard commit');
    await user.tab();

    expect(editedCell).toHaveTextContent('Keyboard commit');
    expect(nextCell).toHaveFocus();
    expect(nextCell).toHaveAttribute('data-active-cell', 'true');
  });

  it('selects empty, text, numeric-looking, and formula cells through the same cell path', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: 'Region' },
        B1: { raw: '42' },
        C1: { raw: '=SUM(B1:B2)' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByTestId('sheet-frame');
    const cells = [
      within(frame).getByRole('cell', { name: 'Inputs A1 cell' }),
      within(frame).getByRole('cell', { name: 'Inputs B1 cell' }),
      within(frame).getByRole('cell', { name: 'Inputs C1 cell' }),
      within(frame).getByRole('cell', { name: 'Inputs D1 empty cell' }),
    ];

    for (const cell of cells) {
      await user.click(cell);
      expect(cell).toHaveAttribute('data-active-cell', 'true');
    }

    expect(within(frame).getAllByTestId('sheet-grid-cell').filter((cell) => cell.dataset.activeCell)).toHaveLength(
      1,
    );
  });

  it('enters edit mode for a selected cell', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.click(cell);
    await user.keyboard('{Enter}');

    expect(cell).toHaveAttribute('data-editing-cell', 'true');
    expect(within(cell).getByRole('textbox', { name: 'Inputs A1 editor' })).toHaveValue('');
  });

  it('starts editing a selected cell when typing a printable character', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.click(cell);
    await user.keyboard('R');

    const editor = within(cell).getByRole('textbox', { name: 'Inputs A1 editor' });
    expect(editor).toHaveValue('R');
    expect((editor as HTMLTextAreaElement).selectionStart).toBe(1);
    expect((editor as HTMLTextAreaElement).selectionEnd).toBe(1);

    await user.keyboard('egion');
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('Region');
  });

  it('enters edit mode for a selected cell with F2', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.click(cell);
    await user.keyboard('{F2}');

    expect(cell).toHaveAttribute('data-editing-cell', 'true');
    expect(within(cell).getByRole('textbox', { name: 'Inputs A1 editor' })).toHaveValue('');
  });

  it('keeps printable-key edit entry working after arrow-key navigation', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });

    await user.click(a1);
    await user.keyboard('{ArrowRight}');
    await user.keyboard('R');

    const editor = within(b1).getByRole('textbox', { name: 'Inputs B1 editor' });
    expect(editor).toHaveValue('R');
  });

  it.each([
    ['Backspace', '{Backspace}'],
    ['Delete', '{Delete}'],
  ])('clears a selected cell with %s without entering edit mode', async (_label, keyCommand) => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: 'Remove me' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    await user.click(cell);
    await user.keyboard(keyCommand);

    expect(screen.getByRole('cell', { name: 'Inputs A1 empty cell' })).toBe(cell);
    expect(cell).not.toHaveAttribute('data-editing-cell');
    expect(cell).toHaveFocus();
  });

  it('leaves an empty selected cell empty on Backspace without entering edit mode', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await user.click(cell);
    await user.keyboard('{Backspace}');

    expect(cell).not.toHaveAttribute('data-editing-cell');
    expect(cell).toHaveTextContent('');
    expect(cell).toHaveFocus();
  });

  it('keeps Delete and Backspace as normal text editing keys inside the cell editor', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: 'Remove me' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const editor = await openCellEditor(user, cell);

    await user.keyboard('{Backspace}');
    expect(editor).toHaveValue('Remove m');

    (editor as HTMLTextAreaElement).setSelectionRange(0, 0);
    await user.keyboard('{Delete}');

    expect(editor).toHaveValue('emove m');
    expect(cell).toHaveAttribute('data-editing-cell', 'true');
  });

  it('commits typed text as raw cell content with Enter', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const editor = await openCellEditor(user, cell);
    await user.type(editor, 'Region');
    await user.keyboard('{Enter}');

    expect(cell).not.toHaveAttribute('data-editing-cell');
    expect(cell).toHaveTextContent('Region');
    expect(screen.getByRole('cell', { name: 'Inputs A1 cell' })).toBe(cell);
  });

  it('commits numeric-looking values as raw cell content', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, cell);
    await user.type(editor, '42.50');
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('42.50');
  });

  it('commits formula-looking values as raw cell content without normalization', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs C1 empty cell' });
    const editor = await openCellEditor(user, cell);
    await user.type(editor, '=SUM(B1:B2)');
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('0');

    const reopenedEditor = await openCellEditor(user, cell);
    expect(reopenedEditor).toHaveValue('=SUM(B1:B2)');
  });

  it('displays mixed-case spaced multiline formulas while preserving raw edit text', async () => {
    const user = userEvent.setup();
    const rawFormula = '= \n sUm \t ( \n B1 \n : \t B2 \n ) ';
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: rawFormula },
        B1: { raw: '3' },
        B2: { raw: '4' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('7');

    const editor = await openCellEditor(user, formulaCell);
    expect(editor).toHaveValue(rawFormula);
  });

  it('displays cross-sheet formula results outside edit mode', async () => {
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '2' },
        A2: { raw: '5' },
      },
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 80 }),
      cells: {
        A1: { raw: '=SUM(Inputs!A1:A2)' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    expect(within(outputFrame).getByRole('cell', { name: 'Outputs A1 cell' })).toHaveTextContent('7');
  });

  it('keeps formula error cells selectable and editable without crashing unrelated results', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(B1)' },
        A2: { raw: '=SUM(B1,)' },
        B1: { raw: '8' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const validFormulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const errorCell = screen.getByRole('cell', { name: 'Inputs A2 cell' });
    expect(validFormulaCell).toHaveTextContent('8');
    expect(errorCell).toHaveTextContent('#PARSE!');

    await user.click(errorCell);
    expect(errorCell).toHaveAttribute('data-active-cell', 'true');

    const editor = await openCellEditor(user, errorCell);
    expect(editor).toHaveValue('=SUM(B1,)');

    await user.clear(editor);
    await user.type(editor, '=SUM(B1)');
    await user.keyboard('{Enter}');

    expect(errorCell).toHaveTextContent('8');
  });

  it('displays formula results and recomputes after referenced cell edits', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(B1:B2)' },
        B1: { raw: '1' },
        B2: { raw: '2' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('3');

    const b2 = screen.getByRole('cell', { name: 'Inputs B2 cell' });
    const editor = await openCellEditor(user, b2);
    await user.clear(editor);
    await user.type(editor, '5');
    await user.keyboard('{Enter}');

    expect(formulaCell).toHaveTextContent('6');
  });

  it('keeps uncommitted edit text out of formula recomputation until commit', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(B1)' },
        B1: { raw: '1' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const inputCell = screen.getByRole('cell', { name: 'Inputs B1 cell' });
    expect(formulaCell).toHaveTextContent('1');

    const editor = await openCellEditor(user, inputCell);
    await user.clear(editor);
    await user.type(editor, '9');

    expect(editor).toHaveValue('9');
    expect(formulaCell).toHaveTextContent('1');

    await user.keyboard('{Enter}');
    expect(formulaCell).toHaveTextContent('9');
  });

  it('recomputes formula edits and removes formula display after editing back to plain content', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(B1)' },
        B1: { raw: '2' },
        C1: { raw: '4' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const formulaCell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('2');

    const formulaEditor = await openCellEditor(user, formulaCell);
    await user.clear(formulaEditor);
    await user.type(formulaEditor, '=SUM(C1)');
    await user.keyboard('{Enter}');

    expect(formulaCell).toHaveTextContent('4');

    const plainEditor = await openCellEditor(user, formulaCell);
    await user.clear(plainEditor);
    await user.type(plainEditor, 'Plain text');
    await user.keyboard('{Enter}');

    expect(formulaCell).toHaveTextContent('Plain text');
    expect(await openCellEditor(user, formulaCell)).toHaveValue('Plain text');
  });

  it('recomputes formula references that become valid after appending a row', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      rowCount: 2,
      columnCount: 2,
      cells: {
        A1: { raw: '=SUM(A3)' },
        A2: { raw: '=SUM(K1)' },
        A3: { raw: '7' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const formulaCell = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
    const persistentErrorCell = within(frame).getByRole('cell', { name: 'Inputs A2 cell' });

    expect(formulaCell).toHaveTextContent('#REF!');
    expect(persistentErrorCell).toHaveTextContent('#REF!');

    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Append row' }));

    expect(formulaCell).toHaveTextContent('7');
    expect(persistentErrorCell).toHaveTextContent('#REF!');

    const editor = await openCellEditor(user, persistentErrorCell);
    expect(editor).toHaveValue('=SUM(K1)');
  });

  it('recomputes formula references that become valid after appending a column', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      rowCount: 2,
      columnCount: 2,
      cells: {
        A1: { raw: '=SUM(C1)' },
        B1: { raw: '=SUM(A99)' },
        C1: { raw: '11' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const formulaCell = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
    const persistentErrorCell = within(frame).getByRole('cell', { name: 'Inputs B1 cell' });

    expect(formulaCell).toHaveTextContent('#REF!');
    expect(persistentErrorCell).toHaveTextContent('#REF!');

    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Append column' }));

    expect(formulaCell).toHaveTextContent('11');
    expect(persistentErrorCell).toHaveTextContent('#REF!');

    const editor = await openCellEditor(user, persistentErrorCell);
    expect(editor).toHaveValue('=SUM(A99)');
  });

  it('commits an active edit when selection moves within a sheet', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const editedCell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const nextCell = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, editedCell);
    await user.type(editor, 'Committed on move');
    await user.click(nextCell);

    expect(editedCell).toHaveTextContent('Committed on move');
    expect(editedCell).not.toHaveAttribute('data-editing-cell');
    expect(nextCell).toHaveAttribute('data-active-cell', 'true');
  });

  it('commits an active edit when selection moves to another sheet', async () => {
    const user = userEvent.setup();
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const editedCell = within(inputFrame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const outputCell = within(outputFrame).getByRole('cell', { name: 'Outputs A1 empty cell' });
    const editor = await openCellEditor(user, editedCell);
    await user.type(editor, 'Cross-sheet commit');
    await user.click(outputCell);

    expect(editedCell).toHaveTextContent('Cross-sheet commit');
    expect(outputFrame).toHaveAttribute('data-active-sheet', 'true');
    expect(outputCell).toHaveAttribute('data-active-cell', 'true');
  });

  it('cancels active edits with Escape and restores prior content', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: 'Original' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const editor = await openCellEditor(user, cell);
    await user.clear(editor);
    await user.type(editor, 'Changed');
    await user.keyboard('{Escape}');

    expect(cell).not.toHaveAttribute('data-editing-cell');
    expect(cell).toHaveTextContent('Original');
  });

  it('restores cell keyboard focus after canceling an edit with Escape', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      rowCount: 1,
      columnCount: 2,
      cells: {
        A1: { raw: 'Original' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, a1);
    await user.clear(editor);
    await user.type(editor, 'Changed');
    await user.keyboard('{Escape}');

    expect(a1).not.toHaveAttribute('data-editing-cell');
    expect(a1).toHaveTextContent('Original');
    expect(a1).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(b1).toHaveAttribute('data-active-cell', 'true');
    expect(b1).toHaveFocus();

    await user.keyboard('N');
    const nextEditor = within(b1).getByRole('textbox', { name: 'Inputs B1 editor' });
    expect(nextEditor).toHaveValue('N');

    await user.keyboard('ext{Enter}');
    expect(b1).toHaveTextContent('Next');
  });

  it('commits an active edit with Tab and moves one cell to the right', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const editor = await openCellEditor(user, a1);

    await user.type(editor, 'Region');
    await user.keyboard('{Tab}');

    expect(a1).toHaveTextContent('Region');
    expect(a1).not.toHaveAttribute('data-editing-cell');
    expect(b1).toHaveAttribute('data-active-cell', 'true');
    expect(b1).toHaveFocus();
  });

  it('commits an active edit with Enter and moves down in the same column without a tab run', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const b2 = screen.getByRole('cell', { name: 'Inputs B2 empty cell' });
    const editor = await openCellEditor(user, b1);

    await user.type(editor, 'Value');
    await user.keyboard('{Enter}');

    expect(b1).toHaveTextContent('Value');
    expect(b2).toHaveAttribute('data-active-cell', 'true');
    expect(b2).toHaveFocus();
  });

  it('returns to the tab-run origin column on Enter after tabbing through edits', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const a1 = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    const b1 = screen.getByRole('cell', { name: 'Inputs B1 empty cell' });
    const a2 = screen.getByRole('cell', { name: 'Inputs A2 empty cell' });
    const a1Editor = await openCellEditor(user, a1);

    await user.type(a1Editor, 'First');
    await user.keyboard('{Tab}');
    expect(b1).toHaveAttribute('data-active-cell', 'true');

    await user.keyboard('S');
    const b1Editor = within(b1).getByRole('textbox', { name: 'Inputs B1 editor' });
    await user.type(b1Editor, 'econd');
    await user.keyboard('{Enter}');

    expect(a1).toHaveTextContent('First');
    expect(b1).toHaveTextContent('Second');
    expect(a2).toHaveAttribute('data-active-cell', 'true');
    expect(a2).toHaveFocus();
  });

  it.each([
    ['text', 'Remove me'],
    ['numeric-looking', '123'],
    ['formula', '=SUM(A2:A3)'],
  ])('clears existing %s content when an empty edit is committed', async (_label, raw) => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    const editor = await openCellEditor(user, cell);
    await user.clear(editor);
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('');
    expect(screen.getByRole('cell', { name: 'Inputs A1 empty cell' })).toBe(cell);
  });

  it('commits an empty edit on an already-empty cell without adding visible content', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const cell = screen.getByRole('cell', { name: 'Inputs A1 empty cell' });
    await openCellEditor(user, cell);
    await user.keyboard('{Enter}');

    expect(cell).toHaveTextContent('');
    expect(screen.getByRole('cell', { name: 'Inputs A1 empty cell' })).toBe(cell);
  });

  it('clears a stored empty cell so it renders as an empty cell again', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
    await openCellEditor(user, cell);
    await user.keyboard('{Enter}');

    expect(screen.getByRole('cell', { name: 'Inputs A1 empty cell' })).toBe(cell);
  });

  it('renders multiple sheet grids independently inside their frames', () => {
    const first = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const second = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 }),
      columnCount: 2,
      rowCount: 2,
    };

    render(<App initialWorkbook={workbookWithSheets([first, second])} />);

    const frames = screen.getAllByTestId('sheet-frame');
    expect(within(frames[0]).getByRole('table', { name: 'Inputs grid' })).toBeInTheDocument();
    expect(within(frames[0]).getAllByTestId('sheet-grid-cell')).toHaveLength(200);
    expect(within(frames[1]).getByRole('table', { name: 'Outputs grid' })).toBeInTheDocument();
    expect(within(frames[1]).getAllByTestId('sheet-grid-cell')).toHaveLength(4);
    expect(within(frames[1]).queryByRole('cell', { name: 'Outputs C1 empty cell' })).not.toBeInTheDocument();
  });

  it('appends a row at the end of one sheet and preserves existing cell content', async () => {
    const user = userEvent.setup();
    const inputs = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 }),
      rowCount: 2,
      columnCount: 2,
    };
    const outputs = {
      ...positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 }),
      rowCount: 2,
      columnCount: 2,
    };

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

    const existingCell = within(inputFrame).getByRole('cell', { name: 'Inputs A1 empty cell' });
    const editor = await openCellEditor(user, existingCell);
    await user.type(editor, 'Existing');
    await user.keyboard('{Enter}');
    await user.click(within(openSheetContextMenu(inputFrame)).getByRole('menuitem', { name: 'Append row' }));

    expect(inputFrame).toHaveAttribute('data-row-count', '3');
    expect(within(inputFrame).getByRole('rowheader', { name: '3' })).toBeInTheDocument();
    expect(within(inputFrame).getByRole('cell', { name: 'Inputs A1 cell' })).toHaveTextContent('Existing');
    expect(within(inputFrame).getByRole('cell', { name: 'Inputs B3 empty cell' })).toBeInTheDocument();
    expect(outputFrame).toHaveAttribute('data-row-count', '2');
    expect(within(outputFrame).queryByRole('rowheader', { name: '3' })).not.toBeInTheDocument();
  });

  it('appends a column at the end of one sheet and updates labels beyond Z', async () => {
    const user = userEvent.setup();
    const wide = {
      ...positionedSheet('sheet-wide', 'Wide Sheet', { x: 48, y: 96 }),
      rowCount: 2,
      columnCount: 26,
    };
    const compact = {
      ...positionedSheet('sheet-compact', 'Compact', { x: 420, y: 260 }),
      rowCount: 2,
      columnCount: 2,
    };

    render(<App initialWorkbook={workbookWithSheets([wide, compact])} />);

    const wideFrame = screen.getByRole('article', { name: 'Sheet Wide Sheet' });
    const compactFrame = screen.getByRole('article', { name: 'Sheet Compact' });

    const edgeCell = within(wideFrame).getByRole('cell', { name: 'Wide Sheet Z1 empty cell' });
    const editor = await openCellEditor(user, edgeCell);
    await user.type(editor, 'Edge');
    await user.keyboard('{Enter}');
    await user.click(within(openSheetContextMenu(wideFrame)).getByRole('menuitem', { name: 'Append column' }));

    expect(wideFrame).toHaveAttribute('data-column-count', '27');
    expect(within(wideFrame).getByRole('columnheader', { name: 'AA' })).toBeInTheDocument();
    expect(within(wideFrame).getByRole('cell', { name: 'Wide Sheet Z1 cell' })).toHaveTextContent('Edge');
    expect(within(wideFrame).getByRole('cell', { name: 'Wide Sheet AA2 empty cell' })).toBeInTheDocument();
    expect(compactFrame).toHaveAttribute('data-column-count', '2');
    expect(within(compactFrame).queryByRole('columnheader', { name: 'C' })).not.toBeInTheDocument();
  });

  it('creates a named sheet from the toolbar at the viewport center', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    Object.defineProperties(workspaceSurface(), {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    await user.click(screen.getByRole('button', { name: 'Pan workspace right' }));
    await user.click(screen.getByRole('button', { name: 'Pan workspace down' }));

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    expect(screen.getByRole('form', { name: /create sheet/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/sheet name/i), 'Inputs');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const frame = screen.getByTestId('sheet-frame');
    expect(within(frame).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(frame).toHaveAttribute('data-sheet-id', 'sheet-1');
    expect(frame).toHaveAttribute('data-column-count', '10');
    expect(frame).toHaveAttribute('data-row-count', '20');
    expect(frame).toHaveStyle({ left: '320px', top: '220px' });
    expect(screen.queryByText(/right-click the workspace/i)).not.toBeInTheDocument();
    expect(screen.getByText('1 sheets')).toBeInTheDocument();
  });

  it('creates a named sheet from the workspace context menu at the clicked coordinate', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    workspaceSurface().getBoundingClientRect = workspaceRect;
    await user.click(screen.getByRole('button', { name: 'Zoom workspace in' }));

    fireEvent.contextMenu(workspaceSurface(), { clientX: 240, clientY: 330 });
    expect(screen.getByRole('form', { name: /create sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /create sheet here/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/sheet name/i), 'Assumptions');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const frame = screen.getByTestId('sheet-frame');
    expect(within(frame).getByRole('heading', { name: 'Assumptions' })).toBeInTheDocument();
    expect(frame).toHaveStyle({ left: '183px', top: '250px' });
  });

  it('rejects empty sheet names without adding a sheet', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await user.click(screen.getByRole('button', { name: /new sheet/i }));
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Sheet name is required.');
    expect(screen.queryByTestId('sheet-frame')).not.toBeInTheDocument();
    expect(screen.getByText('0 sheets')).toBeInTheDocument();
  });

  it('rejects duplicate sheet names without adding another sheet', async () => {
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await createSheetFromToolbar('Inputs');
    await createSheetFromToolbar('Inputs');

    expect(screen.getByRole('alert')).toHaveTextContent('A sheet with that name already exists.');
    expect(screen.getAllByTestId('sheet-frame')).toHaveLength(1);
    expect(screen.getByText('1 sheets')).toBeInTheDocument();
  });

  it('creates multiple sheets with stable ids and distinguishable names', async () => {
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await createSheetFromToolbar('Inputs');
    await createSheetFromToolbar('Outputs');

    const frames = screen.getAllByTestId('sheet-frame');
    expect(frames).toHaveLength(2);
    expect(frames[0]).toHaveAttribute('data-sheet-id', 'sheet-1');
    expect(frames[1]).toHaveAttribute('data-sheet-id', 'sheet-2');
    expect(within(frames[0]).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(within(frames[1]).getByRole('heading', { name: 'Outputs' })).toBeInTheDocument();
    expect(frames[0]).toHaveAttribute('data-z-index', '1');
    expect(frames[1]).toHaveAttribute('data-z-index', '2');
    expect(screen.getByText('2 sheets')).toBeInTheDocument();
  });

  it('changes only the requested sheet z-order through explicit frame controls', async () => {
    const user = userEvent.setup();
    render(<App initialWorkbook={workbookWithSheets([])} />);

    await createSheetFromToolbar('Inputs');
    await createSheetFromToolbar('Assumptions');
    await createSheetFromToolbar('Outputs');

    const inputsFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const assumptionsFrame = screen.getByRole('article', { name: 'Sheet Assumptions' });
    const outputsFrame = screen.getByRole('article', { name: 'Sheet Outputs' });

    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Bring forward' }));

    expect(inputsFrame).toHaveAttribute('data-z-index', '2');
    expect(assumptionsFrame).toHaveAttribute('data-z-index', '1');
    expect(outputsFrame).toHaveAttribute('data-z-index', '3');
    expect(screen.getAllByTestId('sheet-frame').map((frame) => frame.dataset.sheetId)).toEqual([
      'sheet-1',
      'sheet-2',
      'sheet-3',
    ]);

    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Bring to front' }));
    expect(inputsFrame).toHaveAttribute('data-z-index', '3');
    expect(assumptionsFrame).toHaveAttribute('data-z-index', '1');
    expect(outputsFrame).toHaveAttribute('data-z-index', '2');

    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Send backward' }));
    expect(inputsFrame).toHaveAttribute('data-z-index', '2');
    expect(assumptionsFrame).toHaveAttribute('data-z-index', '1');
    expect(outputsFrame).toHaveAttribute('data-z-index', '3');

    await user.click(within(openSheetContextMenu(inputsFrame)).getByRole('menuitem', { name: 'Send to back' }));
    expect(inputsFrame).toHaveAttribute('data-z-index', '1');
    expect(assumptionsFrame).toHaveAttribute('data-z-index', '2');
    expect(outputsFrame).toHaveAttribute('data-z-index', '3');
  });

  it('closes the sheet context menu when returning to frame editing', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const cell = within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' });

    expect(openSheetContextMenu(frame)).toBeInTheDocument();

    fireEvent(cell, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 130, clientY: 120 }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the sheet context menu when opening rename or create dialogs', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Rename' }));

    expect(screen.getByRole('form', { name: 'Rename sheet' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    openSheetContextMenu(frame);
    await user.click(screen.getByRole('button', { name: /new sheet/i }));

    expect(screen.getByRole('form', { name: 'Create sheet' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not pan the workspace when interacting with the sheet context menu', () => {
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const menu = openSheetContextMenu(frame);

    fireEvent(menu, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 120, clientY: 80 }));
    fireEvent.pointerMove(workspaceSurface(), { clientX: 180, clientY: 120, pointerId: 1 });

    expect(workspaceSurface()).toHaveAttribute('data-viewport-x', '0');
    expect(workspaceSurface()).toHaveAttribute('data-viewport-y', '0');
    expect(workspaceSurface()).not.toHaveClass('workspace-surface-panning');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('does not implicitly raise a sheet when dragging selecting or editing it', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
          positionedSheet('sheet-outputs', 'Outputs', { x: 140, y: 100 }),
        ])}
      />,
    );

    const inputFrame = screen.getByRole('article', { name: 'Sheet Inputs' });
    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    const inputHeader = within(inputFrame).getByTestId('sheet-frame-header');
    const inputCell = within(inputFrame).getByRole('cell', { name: 'Inputs A1 empty cell' });

    expect(inputFrame).toHaveAttribute('data-z-index', '1');
    expect(outputFrame).toHaveAttribute('data-z-index', '1');

    fireEvent(inputHeader, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 120, clientY: 80 }));
    fireEvent(inputHeader, new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 110 }));
    fireEvent(inputHeader, new MouseEvent('pointerup', { bubbles: true, clientX: 150, clientY: 110 }));
    await user.click(inputCell);
    await openCellEditor(user, inputCell);

    expect(inputFrame).toHaveAttribute('data-z-index', '1');
    expect(outputFrame).toHaveAttribute('data-z-index', '1');
  });

  it('renames an existing sheet and preserves raw formula text', async () => {
    const user = userEvent.setup();
    const sheet = {
      ...positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
      cells: {
        A1: { raw: '=SUM(Old Name!A1)' },
      },
    };

    render(<App initialWorkbook={workbookWithSheets([sheet])} />);

    const frame = screen.getByTestId('sheet-frame');
    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByRole('form', { name: /rename sheet/i })).toBeInTheDocument();

    const input = screen.getByLabelText(/sheet name/i);
    await user.clear(input);
    await user.type(input, '  Renamed Inputs  ');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const renamedFrame = screen.getByRole('article', { name: 'Sheet Renamed Inputs' });
    expect(within(renamedFrame).getByRole('heading', { name: 'Renamed Inputs' })).toBeInTheDocument();
    expect(within(renamedFrame).getByRole('table', { name: 'Renamed Inputs grid' })).toBeInTheDocument();
    const formulaCell = within(renamedFrame).getByRole('cell', { name: 'Renamed Inputs A1 cell' });
    expect(formulaCell).toHaveTextContent('#REF!');

    const editor = await openCellEditor(user, formulaCell);
    expect(editor).toHaveValue('=SUM(Old Name!A1)');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('heading', { name: 'Inputs' })).not.toBeInTheDocument();
  });

  it('rejects empty sheet renames and keeps the old name active', async () => {
    const user = userEvent.setup();
    render(
      <App
        initialWorkbook={workbookWithSheets([
          positionedSheet('sheet-inputs', 'Inputs', { x: 120, y: 80 }),
        ])}
      />,
    );

    const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
    await user.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText(/sheet name/i);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Sheet name is required.');
    expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Sheet Renamed Inputs' })).not.toBeInTheDocument();
  });

  it('rejects duplicate sheet renames and keeps the old name active', async () => {
    const user = userEvent.setup();
    const inputs = positionedSheet('sheet-inputs', 'Inputs', { x: 48, y: 96 });
    const outputs = positionedSheet('sheet-outputs', 'Outputs', { x: 420, y: 260 });

    render(<App initialWorkbook={workbookWithSheets([inputs, outputs])} />);

    const outputFrame = screen.getByRole('article', { name: 'Sheet Outputs' });
    await user.click(within(openSheetContextMenu(outputFrame)).getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText(/sheet name/i);
    await user.clear(input);
    await user.type(input, 'Inputs');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('A sheet with that name already exists.');
    expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Sheet Outputs' })).toBeInTheDocument();
    expect(screen.queryAllByRole('article', { name: 'Sheet Inputs' })).toHaveLength(1);
  });
});
