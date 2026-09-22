import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';
import { workbookApi } from '@infrastructure/persistence/workbookApi';

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

  it('uses fallback feedback for a non-error startup rejection', async () => {
    render(<App apiClient={{ loadWorkbook: vi.fn().mockRejectedValue('offline') }} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Workbook could not be loaded.');
  });

  it('ignores both resolved and rejected startup requests after unmount', async () => {
    let resolve!: (workbook: ReturnType<typeof workbookWithSheets>) => void;
    const resolved = new Promise<ReturnType<typeof workbookWithSheets>>((done) => { resolve = done; });
    const first = render(<App apiClient={{ loadWorkbook: vi.fn().mockReturnValue(resolved) }} />);
    first.unmount();
    await act(async () => { resolve(workbookWithSheets([])); await resolved; });

    let reject!: (cause: unknown) => void;
    const rejected = new Promise<ReturnType<typeof workbookWithSheets>>((_resolve, fail) => { reject = fail; });
    const second = render(<App apiClient={{ loadWorkbook: vi.fn().mockReturnValue(rejected) }} />);
    second.unmount();
    await act(async () => { reject(new Error('late failure')); await rejected.catch(() => undefined); });
  });

  it('uses the default load API when the partial client omits it', async () => {
    const request = vi.spyOn(workbookApi, 'loadWorkbook').mockResolvedValue(workbookWithSheets([]));
    render(<App apiClient={{}} />);

    expect(await screen.findByRole('region', { name: /spatial workspace/i })).toBeInTheDocument();
    expect(request).toHaveBeenCalledOnce();
    request.mockRestore();
  });
});
