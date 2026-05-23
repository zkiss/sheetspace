import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { openCellEditor } from './test/appScreen';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';

describe('App startup', () => {
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

  it('restores persisted workbook state on startup and recomputes formulas from raw cells', async () => {
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
});
