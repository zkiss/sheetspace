import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';
import { useSheetCreationRoute } from './useSheetCreationRoute';

const settled = () => Promise.resolve<'settled' | 'cancelled'>('settled');

it('opens the creation dialog directly on the canvas', () => {
  const ensureCanvas = vi.fn(settled);
  const openCreationDialog = vi.fn();
  const { result } = renderHook(() => useSheetCreationRoute({ ensureCanvas, openCreationDialog, presentationActive: false }));

  act(() => result.current());

  expect(ensureCanvas).not.toHaveBeenCalled();
  expect(openCreationDialog).toHaveBeenCalledOnce();
});

it('restores the canvas before opening creation and coalesces repeated requests', async () => {
  const ensureCanvas = vi.fn(settled);
  const openCreationDialog = vi.fn();
  const { result } = renderHook(() => useSheetCreationRoute({ ensureCanvas, openCreationDialog, presentationActive: true }));

  act(() => { result.current(); result.current(); });

  expect(openCreationDialog).not.toHaveBeenCalled();
  await waitFor(() => expect(openCreationDialog).toHaveBeenCalledOnce());
  expect(ensureCanvas).toHaveBeenCalledOnce();
});

it('does not open twice when the restore settles before an overlapping request runs', async () => {
  const ensureCanvas = vi.fn(settled);
  const openCreationDialog = vi.fn();
  const { result, rerender } = renderHook(
    ({ presentationActive }: { presentationActive: boolean }) => useSheetCreationRoute({ ensureCanvas, openCreationDialog, presentationActive }),
    { initialProps: { presentationActive: true } },
  );

  act(() => result.current());
  rerender({ presentationActive: false });
  act(() => result.current());

  expect(openCreationDialog).not.toHaveBeenCalled();
  await waitFor(() => expect(openCreationDialog).toHaveBeenCalledOnce());
});

it('does not open creation when the restore is cancelled and retries afterwards', async () => {
  const ensureCanvas = vi.fn(() => Promise.resolve<'settled' | 'cancelled'>('cancelled'));
  const openCreationDialog = vi.fn();
  const { result } = renderHook(() => useSheetCreationRoute({ ensureCanvas, openCreationDialog, presentationActive: true }));

  act(() => result.current());

  await waitFor(() => expect(ensureCanvas).toHaveBeenCalledOnce());
  expect(openCreationDialog).not.toHaveBeenCalled();

  ensureCanvas.mockImplementationOnce(settled);
  act(() => result.current());

  await waitFor(() => expect(openCreationDialog).toHaveBeenCalledOnce());
  expect(ensureCanvas).toHaveBeenCalledTimes(2);
});

it('still opens creation after StrictMode replays the mount effect', async () => {
  const ensureCanvas = vi.fn(settled);
  const openCreationDialog = vi.fn();
  const { result } = renderHook(
    () => useSheetCreationRoute({ ensureCanvas, openCreationDialog, presentationActive: true }),
    { wrapper: StrictMode },
  );

  act(() => result.current());

  await waitFor(() => expect(openCreationDialog).toHaveBeenCalledOnce());
});

it('does not open creation after the workspace unmounts', async () => {
  let resolveCanvas!: (result: 'settled' | 'cancelled') => void;
  const ensureCanvas = vi.fn(() => new Promise<'settled' | 'cancelled'>((resolve) => { resolveCanvas = resolve; }));
  const openCreationDialog = vi.fn();
  const { result, unmount } = renderHook(() => useSheetCreationRoute({ ensureCanvas, openCreationDialog, presentationActive: true }));

  act(() => result.current());
  unmount();
  await act(async () => { resolveCanvas('settled'); });

  expect(openCreationDialog).not.toHaveBeenCalled();
});
