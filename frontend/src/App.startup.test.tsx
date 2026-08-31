import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
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
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved');
  });

  it('blocks editing on startup load failure and retries into the workspace', async () => {
    const apiClient = {
      loadWorkbook: vi.fn()
        .mockRejectedValueOnce(new Error('backend unavailable'))
        .mockResolvedValueOnce(workbookWithSheets([])),
    };
    const user = userEvent.setup();
    render(<App apiClient={apiClient} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('backend unavailable');
    expect(screen.queryByRole('button', { name: /new sheet/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('region', { name: /spatial workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new sheet/i })).toBeInTheDocument();
    expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(2);
  });
});
