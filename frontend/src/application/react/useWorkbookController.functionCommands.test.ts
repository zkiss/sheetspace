import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { commitCellRawContent } from '@workbook/mutations/operations';
import { setCustomFunction } from '@calculation/customFunctions';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { autosaveClient, deferred, persistedWorkbookClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

const declaration = { name: 'fibonacci', parameters: [{ name: 'a', type: 'int' as const }, { name: 'b', type: 'int' as const }], body: '=SUM(a,b)' };
function fixture() { return workbookWithSheets([sheetDocument({ id: 'one', name: 'One', rowCount: 2, columnCount: 1 })]); }

it('recalculates previously unknown callers and downstream cells after local function edits and deletion', () => {
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: fixture() }));
  act(() => { result.current.commands.updateCellContent('one', 'A1', '=fibonacci(3,5)'); result.current.commands.updateCellContent('one', 'A2', '=@A[1]+1'); });
  expect(result.current.formulaResults.one.A1.display).toBe('#NAME!');
  act(() => { expect(result.current.commands.setFunction(declaration).result.ok).toBe(true); });
  expect(result.current.formulaResults.one.A1.display).toBe('8');
  expect(result.current.formulaResults.one.A2.display).toBe('9');
  act(() => { expect(result.current.commands.setFunction({ ...declaration, body: '=SUM(a,b,1)' }, 'fibonacci').result.ok).toBe(true); });
  expect(result.current.formulaResults.one.A2.display).toBe('10');
  act(() => { expect(result.current.commands.deleteFunction('fibonacci').result.ok).toBe(true); });
  expect(result.current.formulaResults.one.A1.display).toBe('#NAME!');
});

it('fences edits after a lost response and retries the same request before adopting authority', async () => {
  const initial = fixture();
  const defined = setCustomFunction(initial, declaration);
  if (!defined.ok) throw new Error(defined.error);
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async (id: string) => ({ operationId: id, committedIdentity: 'identity', alreadyCommitted: true, workbook: defined.workbook }));
  const api = autosaveClient({ loadWorkbook: vi.fn().mockResolvedValue(initial), setFunction: save });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  let submission: ReturnType<typeof result.current.commands.setFunction>;
  act(() => { submission = result.current.commands.setFunction(declaration); });
  await act(async () => { expect(await submission!.completion).toMatchObject({ ok: false, reason: 'persistence-failed' }); });
  expect(result.current.saveStatus).toBe('failed');
  expect(result.current.canRetryFailedSaves).toBe(true);
  act(() => { expect(result.current.commands.updateCellContent('one', 'A1', '1')).toMatchObject({ ok: false }); result.current.commands.retryFailedSaves(); });
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  expect(result.current.workbook.functions?.[0].name).toBe('fibonacci');
});

it('retries a function after preparation recovers', async () => {
  const initial = fixture();
  const defined = setCustomFunction(initial, declaration);
  if (!defined.ok) throw new Error(defined.error);
  const loadWorkbook = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(initial);
  const save = vi.fn(async (id: string) => ({ operationId: id, committedIdentity: 'identity', alreadyCommitted: false, workbook: defined.workbook }));
  const api = autosaveClient({ loadWorkbook, setFunction: save });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  let submission: ReturnType<typeof result.current.commands.setFunction>;
  act(() => { submission = result.current.commands.setFunction(declaration); });
  await act(async () => { expect(await submission!.completion).toMatchObject({ ok: false }); });
  expect(result.current.saveStatus).toBe('failed');
  expect(result.current.canRetryFailedSaves).toBe(true);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(result.current.canRetryFailedSaves).toBe(false);
  expect(save).toHaveBeenCalledOnce();
  expect(result.current.workbook.functions?.[0].name).toBe('fibonacci');
});

it('recalculates hidden body references, rename and invalid bodies without changing caller text', () => {
  const initial = workbookWithSheets([sheetDocument({ id: 'one', name: 'One', cells: { A1: '2', B1: '=value()', C1: '=@B[1]+1' } })]);
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial }));
  act(() => { result.current.commands.updateCellContent('one', 'B1', '=value()'); result.current.commands.updateCellContent('one', 'C1', '=@B[1]+1'); result.current.commands.setFunction({ name: 'value', parameters: [], body: '=@A[1]' }); });
  expect(result.current.formulaResults.one.C1.display).toBe('3');
  act(() => { result.current.commands.updateCellContent('one', 'A1', '5'); });
  expect(result.current.formulaResults.one.C1.display).toBe('6');
  act(() => { result.current.commands.setFunction({ name: 'renamed', parameters: [], body: '=@A[1]' }, 'value'); });
  expect(result.current.formulaResults.one.B1.display).toBe('#NAME!');
  act(() => { result.current.commands.setFunction({ name: 'value', parameters: [], body: '=SUM(' }); });
  expect(result.current.formulaResults.one.B1.display).toBe('#PARSE!');
  expect(result.current.workbook.functions?.find((fn) => fn.name === 'value')?.body).toBe('=SUM(');
});

it('recalculates callers only when persisted authority is adopted', async () => {
  const initial = workbookWithSheets([sheetDocument({ id: 'one', name: 'One', cells: { A1: '=fibonacci(3,5)', A2: '=@A[1]+1', A3: '42' } })]);
  const bound = commitCellRawContent(commitCellRawContent(initial, 'one', 'A1', '=fibonacci(3,5)'), 'one', 'A2', '=@A[1]+1');
  const defined = setCustomFunction(bound, declaration);
  if (!defined.ok) throw new Error(defined.error);
  const api = autosaveClient({ loadWorkbook: vi.fn().mockResolvedValue(bound), setFunction: vi.fn(async (id: string) => ({ operationId: id, committedIdentity: 'identity', alreadyCommitted: false, workbook: defined.workbook })) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: bound, apiClient: api }));
  expect(result.current.formulaResults.one.A1.display).toBe('#NAME!');
  let submission: ReturnType<typeof result.current.commands.setFunction>;
  act(() => { submission = result.current.commands.setFunction(declaration); });
  await act(async () => { expect(await submission!.completion).toMatchObject({ ok: true }); });
  expect(result.current.formulaResults.one.A1.display).toBe('8');
  expect(result.current.formulaResults.one.A2.display).toBe('9');
});

it('fences structural, model, creation and history commands while function persistence is pending', async () => {
  const initial = fixture();
  const pending = deferred<never>();
  const api = autosaveClient({ loadWorkbook: vi.fn().mockResolvedValue(initial), setFunction: vi.fn(() => pending.promise) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  let submission: ReturnType<typeof result.current.commands.setFunction>;
  act(() => { submission = result.current.commands.setFunction(declaration); });
  await waitFor(() => expect(api.setFunction).toHaveBeenCalled());
  act(() => {
    expect(result.current.commands.deleteSheet('one')).toMatchObject({ ok: false });
    expect(result.current.commands.createSheet('New', { x: 0, y: 0 })).toMatchObject({ ok: false });
    expect(result.current.commands.addDataModel({ id: 'm', name: 'Model', columns: [] }).result).toMatchObject({ ok: false });
    result.current.commands.undo();
    result.current.commands.redo();
    result.current.retryStartupLoad();
  });
  expect(result.current.workbook.manifest.sheetIds).toEqual(['one']);
  await act(async () => { pending.reject(new Error('offline')); await submission!.completion; });
  expect(result.current.saveStatus).toBe('failed');
  act(() => { expect(result.current.commands.deleteSheet('one')).toMatchObject({ ok: false }); });
});

it('drains a queued cell save before capturing authority and uses receipt revisions for later writes', async () => {
  const initial = fixture();
  const base = persistedWorkbookClient(initial);
  const write = base.writeCells.getMockImplementation()!;
  const held = deferred<void>();
  base.writeCells.mockImplementationOnce(async (...args) => { await held.promise; return write(...args); });
  const persisted = base.loadWorkbook.getMockImplementation()!;
  base.loadWorkbook.mockImplementation(async () => { const workbook = await persisted(); workbook.documents.one.revision = 1; return workbook; });
  const setFunction = vi.fn(async (id: string, before: typeof initial) => {
    const defined = setCustomFunction(before, declaration);
    if (!defined.ok) throw new Error(defined.error);
    const workbook = structuredClone(defined.workbook);
    workbook.documents.one.revision = 7;
    return { operationId: id, committedIdentity: 'identity', alreadyCommitted: false, workbook };
  });
  const api = { ...base, setFunction };
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  act(() => { result.current.commands.updateCellContent('one', 'A1', '42'); });
  await waitFor(() => expect(base.writeCells).toHaveBeenCalled());
  let submission: ReturnType<typeof result.current.commands.setFunction>;
  act(() => { submission = result.current.commands.setFunction(declaration); });
  expect(setFunction).not.toHaveBeenCalled();
  await act(async () => { held.resolve(); expect(await submission!.completion).toMatchObject({ ok: true }); });
  expect(setFunction.mock.calls[0][1].documents.one.revision).toBeGreaterThan(initial.documents.one.revision);
  act(() => { result.current.commands.updateCellContent('one', 'A2', '9'); });
  await waitFor(() => expect(base.writeCells).toHaveBeenLastCalledWith([{ sheetId: 'one', revision: 7 }], expect.anything()));
});

it('retries the predecessor before dispatching the retained function intent', async () => {
  const initial = fixture();
  const held = deferred<never>();
  const writeCells = vi.fn().mockImplementationOnce(() => held.promise).mockResolvedValue({ sheets: [{ sheetId: 'one', revision: 1 }] });
  const before = structuredClone(initial);
  before.documents.one.revision = 1;
  const defined = setCustomFunction(before, declaration);
  if (!defined.ok) throw new Error(defined.error);
  const setFunction = vi.fn(async (id: string) => ({ operationId: id, committedIdentity: 'identity', alreadyCommitted: false, workbook: defined.workbook }));
  const api = autosaveClient({ writeCells, setFunction, loadWorkbook: vi.fn().mockResolvedValue(before), loadSheet: vi.fn().mockResolvedValue(initial.documents.one) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  act(() => { result.current.commands.updateCellContent('one', 'A1', '42'); });
  await waitFor(() => expect(writeCells).toHaveBeenCalled());
  let submission: ReturnType<typeof result.current.commands.setFunction>;
  act(() => { submission = result.current.commands.setFunction(declaration); });
  await act(async () => { held.reject(new Error('offline')); expect(await submission!.completion).toMatchObject({ ok: false }); });
  expect(setFunction).not.toHaveBeenCalled();
  expect(result.current.saveStatus).toBe('failed');
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(setFunction).toHaveBeenCalledOnce();
  expect(result.current.workbook.functions?.[0].name).toBe('fibonacci');
});

it.each(['dispatch', 'preparation'] as const)('preserves editable model drafts across a failed function %s and retry', async (failure) => {
  const base = { ...fixture(), dataModels: { m: { id: 'm', name: 'Model', columns: [{ id: 'n', name: 'Number', kind: 'manual' as const, type: 'int' as const }] } } };
  const bound = bindSheetToModel(base, 'one', 'm', () => 'new');
  if (!bound.ok) throw new Error(bound.reason);
  const initial = bound.value;
  const defined = setCustomFunction(initial, declaration);
  if (!defined.ok) throw new Error(defined.error);
  const pending = deferred<never>();
  const loadWorkbook = vi.fn().mockResolvedValue(initial);
  if (failure === 'preparation') loadWorkbook.mockRejectedValueOnce(new Error('offline'));
  const save = vi.fn().mockImplementation(async (id: string) => ({ operationId: id, committedIdentity: 'identity', alreadyCommitted: true, workbook: defined.workbook }));
  if (failure === 'dispatch') save.mockImplementationOnce(() => pending.promise);
  const api = persistedWorkbookClient(initial);
  api.loadWorkbook = loadWorkbook;
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: { ...api, setFunction: save } }));
  let submission: ReturnType<typeof result.current.commands.setFunction>;
  act(() => { submission = result.current.commands.setFunction(declaration); });
  if (failure === 'dispatch') {
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    act(() => { result.current.commands.changeEntryField('one', 'n', '1'); result.current.commands.leaveEntryField('one', 'n'); });
    await act(async () => { pending.reject(new Error('lost response')); await submission!.completion; });
  } else await act(async () => { await submission!.completion; });
  act(() => { result.current.commands.changeEntryField('one', 'n', '123'); result.current.commands.leaveEntryField('one', 'n'); });
  await act(async () => { expect(await result.current.commands.submitEntryDraft('one')).toEqual({}); });
  expect(api.admitRecord).not.toHaveBeenCalled();
  expect(result.current.entrySessions.one.draft.fields.n.raw).toBe('123');
  act(() => { result.current.commands.retryFailedSaves(); result.current.commands.retryFailedSaves(); });
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(result.current.entrySessions.one.draft.fields.n.raw).toBe('123');
  expect(save).toHaveBeenCalledTimes(failure === 'dispatch' ? 2 : 1);
  await act(async () => { await result.current.commands.submitEntryDraft('one'); });
  expect(api.admitRecord).toHaveBeenCalledOnce();
});
