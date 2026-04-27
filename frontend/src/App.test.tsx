import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('shows backend health when api request succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ service: 'sheetspace-api', status: 'ok' }),
    } as Response);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('api-status')).toHaveTextContent('sheetspace-api:ok');
    });
  });

  it('shows unreachable when api request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('api-status')).toHaveTextContent('unreachable');
    });
  });
});
