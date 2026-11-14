import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { OutboxSnapshot } from '@infrastructure/persistence/workbookOutbox';
import { useLifecycleSettlement } from './useLifecycleSettlement';
import { useSavedSheetAutosave } from './useSavedSheetAutosave';

const before = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]);
const proposal = { ...before, manifest: { ...before.manifest, revision: 1 } };
const committed = { ...before, manifest: { ...before.manifest, revision: 9 } };
const transitionId = 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4';

it('recovers once with the original callback and installs current authority before notification', async () => {
  const waiting = deferred<{ status: 'failed'; failure: Error }>();
  let listener!: (snapshot: OutboxSnapshot) => void;
  const current = { current: before };
  const setWorkbook = vi.fn((workbook) => { current.current = workbook; });
  const enqueue = vi.fn();
  const autosave = { enqueue, discard: vi.fn(), waitFor: () => waiting.promise, hasModelTransition: () => false, waitForModelTransitions: () => undefined, modelTransitionIsBlockedByFailedPrerequisite: () => false } as unknown as ReturnType<typeof useSavedSheetAutosave>;
  const subscribeOutbox = (callback: typeof listener) => { listener = callback; return () => undefined; };
  const onSuccess = vi.fn((after) => expect(current.current).toBe(after));
  const publication = vi.fn();
  const { result, rerender } = renderHook(() => useLifecycleSettlement({ autosaveEnabled: true, current, setWorkbook, autosave, resetHistory: vi.fn(), subscribeOutbox, revision: () => 0 }));
  let completion!: ReturnType<typeof result.current.submit>;
  act(() => { completion = result.current.submit(before, { ok: true, value: proposal, metadata: 'retained' }, onSuccess, publication, { transitionId, direction: 'undo' }); });
  const [operationId, intent] = enqueue.mock.calls[0]!;
  expect(intent.replay).toEqual({ transitionId, direction: 'undo' });
  await act(async () => { waiting.resolve({ status: 'failed', failure: new Error('response lost') }); await completion; });
  expect(publication.mock.calls.map((call) => call[2])).toEqual(['optimistic', 'rollback']);
  const receipt = { operationId, transitionId, alreadyCommitted: true, workbook: committed };
  const snapshot = [{ operationId, status: 'succeeded', receipt }] as unknown as OutboxSnapshot;
  act(() => { listener(snapshot); listener(snapshot); });
  rerender();
  act(() => listener(snapshot));
  expect(onSuccess).toHaveBeenCalledOnce();
  expect(onSuccess).toHaveBeenCalledWith(committed, receipt);
  expect(current.current).toBe(committed);
  expect(publication).toHaveBeenCalledTimes(2);
});

it('releases large successful lifecycle payloads after repeated settlements and retry recovery', async () => {
  const large = { ...committed, functions: Array.from({ length: 3000 }, (_, i) => ({ identity: `function-${i}`, name: `function${i}`, parameters: [], body: 'x'.repeat(1000) })) } as unknown as typeof committed;
  let attempts = 0;
  const admitModelLifecycle = vi.fn(async (operationId: string) => {
    if (++attempts === 2) throw new Error('response lost');
    return { operationId, transitionId, alreadyCommitted: attempts === 3, workbook: large };
  });
  const client = autosaveClient({ admitModelLifecycle });
  const current = { current: before };
  const setWorkbook = vi.fn((workbook) => { current.current = workbook; });
  const onSuccess = vi.fn();
  const { result } = renderHook(() => {
    const autosave = useSavedSheetAutosave({ autosaveEnabled: true, resolvedApiClient: client, setWorkbook, workbook: before });
    const settlement = useLifecycleSettlement({ autosaveEnabled: true, current, setWorkbook, autosave, resetHistory: onSuccess, subscribeOutbox: autosave.subscribeOutbox, revision: autosave.revision });
    return { autosave, settlement };
  });
  for (let i = 0; i < 5; i++) {
    let completion!: ReturnType<typeof result.current.settlement.submit>;
    act(() => { completion = result.current.settlement.submit(before, { ok: true, value: proposal }); });
    await act(async () => { await completion; });
    if (i === 1) {
      expect(result.current.autosave.currentOutboxSnapshot()).toHaveLength(1);
      act(() => result.current.autosave.retryFailedSaves());
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
    }
    await waitFor(() => expect(result.current.autosave.currentOutboxSnapshot()).toHaveLength(0));
  }
  expect(onSuccess).toHaveBeenCalledTimes(5);
  expect(admitModelLifecycle.mock.calls[1]![0]).toBe(admitModelLifecycle.mock.calls[2]![0]);
});

it('settles offline locally and retains result metadata without fabricating a receipt', async () => {
  const current = { current: before };
  const setWorkbook = vi.fn((workbook) => { current.current = workbook; });
  const autosave = {} as ReturnType<typeof useSavedSheetAutosave>;
  const success = vi.fn();
  const publication = vi.fn();
  const { result } = renderHook(() => useLifecycleSettlement({ autosaveEnabled: false, current, setWorkbook, autosave, resetHistory: vi.fn(), subscribeOutbox: () => () => undefined, revision: () => 0 }));
  let completion!: ReturnType<typeof result.current.submit>;
  act(() => { completion = result.current.submit(before, { ok: true, value: proposal, metadata: 'retained' }, success, publication); });
  expect(await completion).toEqual({ ok: true, value: proposal, metadata: 'retained' });
  expect(success).toHaveBeenCalledWith(proposal);
  expect(publication).toHaveBeenCalledWith(before, proposal, 'optimistic');
});
