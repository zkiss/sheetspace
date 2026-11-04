import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkspaceActionCommands } from './useWorkspaceActionCommands';
import { NavigationPalette } from './NavigationPalette';
import { useRef, useState } from 'react';
import { useWorkbookController } from '@application/react/useWorkbookController';
import { useExtractionHandoff } from './useExtractionHandoff';
import { cellRawContent } from '@workbook/read/queries';
import type { ExtractionRequest } from '@application/core/extractionPreparation';

type Props = Parameters<typeof useWorkspaceActionCommands>[0];
function setup(columnCount = 1) {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount });
  const cell = { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } };
  const commands = { currentWorkbook: () => ({ documents: new Proxy({}, { get: () => sheet }) }), appendRow: vi.fn(), setSheetVisualScale: vi.fn(), changeSheetZOrder: vi.fn(), undo: vi.fn(), redo: vi.fn(), retryFailedSaves: vi.fn(), renameColumn: vi.fn(), deleteRow: vi.fn(), deleteColumn: vi.fn(), replaceModelDeclaration: vi.fn() };
  const controller = { createSheetAtViewportCenter: vi.fn(), zoomWorkspaceBy: vi.fn(), resetViewport: vi.fn() };
  const clipboard = { canWrite: () => true, canRead: () => true, write: vi.fn().mockResolvedValue(undefined), read: vi.fn() };
  const props = {
    commands, controller, sheet, workbook: workbookWithSheets([sheet]), activeCell: cell, selection: null,
    formatting: { descriptor: { valid: false } }, referencesVisible: true,
    canUndo: false, canRedo: false, canRetryFailedSaves: false,
    navigation: { canGoBack: false, canGoForward: false, traverse: vi.fn() }, closePalette: vi.fn(), openPanel: vi.fn(), onCreateSheet: vi.fn(),
    onOpenDataModels: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onClear: vi.fn(),
    onSelectAxis: vi.fn(), onSelectAll: vi.fn(), onRowDeleted: vi.fn(), onColumnDeleted: vi.fn(), onToggleReferences: vi.fn(), onFeedback: vi.fn(),
    onCopy: vi.fn(), onCut: vi.fn(), onPaste: vi.fn(), onCancelCut: vi.fn(), hasPendingCut: false, clipboardAccess: clipboard,
  } as unknown as Props;
  const hook = renderHook(() => useWorkspaceActionCommands(props));
  const command = (id: string) => hook.result.current.commands.find((item) => item.id === id)!;
  return { hook, command, props, commands, controller, clipboard, sheet, cell };
}

function RenamePalette({ props }: { props: Props }) {
  const [open, setOpen] = useState(true);
  const origin = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); origin.current?.focus(); };
  const actions = useWorkspaceActionCommands({ ...props, closePalette: close, openPanel: () => {} });
  return <><button ref={origin}>Selected column</button>{open && <NavigationPalette commands={actions.commands} panel={actions.panel} onClose={() => { if (!actions.preventClose) { actions.resetPanel(); close(); } }} />}</>;
}

function openRename() {
  fireEvent.change(screen.getByLabelText('Command search'), { target: { value: 'Rename column' } });
  fireEvent.keyDown(screen.getByLabelText('Command search'), { key: 'Enter' });
}

describe('workspace palette actions', () => {
  it('releases rendered ownership when an accepted extraction completion rejects', async () => {
    const { props, sheet, cell, hook } = setup();
    hook.unmount();
    let reject!: (reason: Error) => void;
    const completion = new Promise<never>((_resolve, fail) => { reject = fail; });
    const request = { sourceSheetId: sheet.id, targetSheetId: 'target' } as ExtractionRequest;
    props.commands.extractSelection = vi.fn().mockReturnValue({ result: { ok: true, workbook: { documents: { target: sheet } } }, completion });
    const { result } = renderHook(() => {
      const owner = useExtractionHandoff([sheet.id, 'target']);
      const token = useRef(0);
      const actions = useWorkspaceActionCommands({ ...props, selection: { mode: 'cells', anchor: cell, extent: cell },
        extraction: {
          request: () => { token.current = owner.begin(sheet, 'target'); return request; },
          onAccepted: () => owner.accepted(token.current),
          onFailure: () => owner.cancel(token.current),
          onSuccess: vi.fn(),
        } });
      return { owner, actions };
    });
    act(() => result.current.actions.commands.find((item) => item.id === 'extract-selection')!.run());
    expect(result.current.owner.handoff).toMatchObject({ accepted: true, ready: false });
    await act(async () => reject(new Error('save failed')));
    expect(result.current.owner.handoff).toBeNull();
    expect(props.onFeedback).toHaveBeenCalledWith('The extraction could not be saved.');
  });

  it.each([false, true])('uses real controller publication receipt with same-batch undo %s', async (undo) => {
    const { props, sheet, cell, hook } = setup();
    hook.unmount();
    const source = sheetDocument({ id: sheet.id, name: 'Sheet', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
    const identity = { rowId: source.content.rows[0]!, columnId: source.content.columns[0]! };
    const targetId = '00000000-0000-0000-0000-000000000001';
    const selectAndFocus = vi.fn();
    const request: ExtractionRequest = { sourceSheetId: source.id, selection: { kind: 'cells', start: identity, end: identity }, targetSheetId: targetId, targetName: 'Target', targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'], frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 2 } };
    const { result } = renderHook(() => {
      const controller = useWorkbookController({ initialWorkbook: workbookWithSheets([source]) });
      const owner = useExtractionHandoff(Object.keys(controller.workbook.documents));
      const tokens = useRef(new WeakMap<object, number>());
      const selected = { ...cell, cell: identity };
      const actions = useWorkspaceActionCommands({ ...props, commands: controller.commands, workbook: controller.workbook, sheet: controller.workbook.documents[source.id], activeCell: selected, selection: { anchor: selected, extent: selected, mode: 'cells' }, extraction: {
        request: () => { tokens.current.set(request, owner.begin(source, targetId)); return request; },
        onAccepted: (value) => owner.accepted(tokens.current.get(value)!),
        onFailure: (value) => { if (value) owner.cancel(tokens.current.get(value)!); },
        onSuccess: selectAndFocus,
      } });
      return { controller, owner, actions };
    });
    await act(async () => {
      result.current.actions.commands.find((item) => item.id === 'extract-selection')!.run();
      if (undo) result.current.controller.commands.undo();
    });
    if (undo) {
      expect(result.current.controller.workbook.documents[targetId]).toBeUndefined();
      expect(cellRawContent(result.current.controller.workbook.documents[source.id]!, 'A1')).toBe('42');
      expect(result.current.owner.handoff).toBeNull();
      expect(selectAndFocus).not.toHaveBeenCalled();
      expect(props.onCancelCut).not.toHaveBeenCalled();
    } else {
      expect(result.current.controller.workbook.documents[targetId]).toBeDefined();
      expect(result.current.owner.handoff).toMatchObject({ accepted: true, ready: false });
      expect(selectAndFocus).toHaveBeenCalledWith(request);
    }
  });
  it('prevents duplicate extraction while saving and permits another after settlement', async () => {
    const { command, hook, props, cell } = setup();
    let finish!: (value: unknown) => void;
    const submit = vi.fn().mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    props.commands.extractSelection = submit;
    props.selection = { mode: 'cells', anchor: cell, extent: cell };
    props.extraction = { request: vi.fn().mockReturnValue({}), onSuccess: vi.fn() };
    hook.rerender();
    const run = command('extract-selection').run;
    act(() => { run(); run(); });
    expect(submit).toHaveBeenCalledOnce();
    expect(command('extract-selection').unavailable).toBe('Extraction is being saved');
    await act(async () => finish({ ok: true }));
    expect(command('extract-selection').unavailable).toBeUndefined();
  });
  it.each(['request', 'submission'] as const)('cleans up when extraction %s throws synchronously', (stage) => {
    const { command, hook, props, cell } = setup();
    const fail = vi.fn(() => { throw new Error('failed'); });
    props.commands.extractSelection = stage === 'submission' ? fail : vi.fn();
    props.selection = { mode: 'cells', anchor: cell, extent: cell };
    props.extraction = { request: stage === 'request' ? fail : vi.fn().mockReturnValue({}), onSuccess: vi.fn(), onFailure: vi.fn() };
    hook.rerender();
    act(() => command('extract-selection').run());
    expect(props.extraction.onFailure).toHaveBeenCalledOnce();
    expect(props.onFeedback).toHaveBeenCalledWith('The extraction could not be started.');
    expect(command('extract-selection').unavailable).toBeUndefined();
  });
  it.each(['cells', 'rows', 'columns'] as const)('submits %s extraction and transfers ownership only after settlement', async (mode) => {
    const { command, hook, props, cell } = setup();
    const request = { sourceSheetId: 'sheet' } as ReturnType<NonNullable<Props['extraction']>['request']>;
    const onSuccess = vi.fn();
    let finish!: (value: unknown) => void;
    const submit = vi.fn().mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    props.commands.extractSelection = submit;
    props.selection = { mode, anchor: cell, extent: cell };
    props.extraction = { request: vi.fn().mockReturnValue(request), onSuccess };
    hook.rerender();
    expect(command('extract-selection').unavailable).toBeUndefined();
    act(() => command('extract-selection').run());
    expect(submit).toHaveBeenCalledWith(request);
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true }));
    expect(onSuccess).toHaveBeenCalledWith(request);
    expect(props.onCancelCut).toHaveBeenCalledOnce();
  });
  it('keeps newer selection ownership and reports failed extraction', async () => {
    const { command, hook, props, cell } = setup();
    let finish!: (value: unknown) => void;
    props.commands.extractSelection = vi.fn().mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    props.selection = { mode: 'cells', anchor: cell, extent: cell };
    props.extraction = { request: vi.fn().mockReturnValue({}), onSuccess: vi.fn() };
    hook.rerender();
    act(() => command('extract-selection').run());
    props.selection = null;
    hook.rerender();
    await act(async () => finish({ ok: true }));
    expect(props.extraction.onSuccess).not.toHaveBeenCalled();
    expect(props.onCancelCut).not.toHaveBeenCalled();
    props.selection = { mode: 'cells', anchor: cell, extent: cell };
    props.commands.extractSelection = vi.fn().mockReturnValue({ result: { ok: false, reason: 'protected-source' } });
    hook.rerender();
    act(() => command('extract-selection').run());
    expect(props.onFeedback).toHaveBeenCalledWith(expect.stringContaining('bound to a data model'));
  });
  it('explains asynchronous range rejection without transferring ownership', async () => {
    const { command, hook, props, cell } = setup();
    let finish!: (value: unknown) => void;
    props.commands.extractSelection = vi.fn().mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    props.selection = { mode: 'cells', anchor: cell, extent: cell };
    props.extraction = { request: vi.fn().mockReturnValue({}), onSuccess: vi.fn() };
    hook.rerender();
    act(() => command('extract-selection').run());
    await act(async () => finish({ ok: false, reason: 'unrepresentable-range' }));
    expect(props.onFeedback).toHaveBeenCalledWith(expect.stringContaining('entire referenced range'));
    expect(props.extraction.onSuccess).not.toHaveBeenCalled();
    expect(props.onCancelCut).not.toHaveBeenCalled();
  });
  it('suppresses extraction callbacks after unmount', async () => {
    const { command, hook, props, cell } = setup();
    let finish!: (value: unknown) => void;
    props.commands.extractSelection = vi.fn().mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    props.selection = { mode: 'cells', anchor: cell, extent: cell };
    props.extraction = { request: vi.fn().mockReturnValue({}), onSuccess: vi.fn() };
    hook.rerender();
    act(() => command('extract-selection').run());
    hook.unmount();
    await act(async () => finish({ ok: false, reason: 'unrepresentable-range' }));
    expect(props.onFeedback).not.toHaveBeenCalled();
    expect(props.extraction.onSuccess).not.toHaveBeenCalled();
  });
  it.each(['row', 'column'] as const)('selects an adjacent cell only after %s deletion succeeds', async (axis) => {
    const { command, commands, props, sheet, cell } = setup();
    const mutation = axis === 'row' ? commands.deleteRow : commands.deleteColumn;
    let finish!: (result: { ok: boolean; reason?: string }) => void;
    mutation.mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    act(() => command(`delete-${axis}`).run());
    const callback = axis === 'row' ? props.onRowDeleted : props.onColumnDeleted;
    expect(callback).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true }));
    expect(callback).toHaveBeenCalledWith(sheet, cell);
  });
  it.each(['row', 'column'] as const)('does not override navigation while %s deletion is saving', async (axis) => {
    const { command, commands, props, hook, cell } = setup();
    let finish!: (result: { ok: boolean }) => void;
    (axis === 'row' ? commands.deleteRow : commands.deleteColumn).mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    act(() => command(`delete-${axis}`).run());
    props.activeCell = { ...cell, cell: { ...cell.cell, rowId: 'another-row' } };
    hook.rerender();
    props.activeCell = cell;
    hook.rerender();
    await act(async () => finish({ ok: true }));
    expect(axis === 'row' ? props.onRowDeleted : props.onColumnDeleted).not.toHaveBeenCalled();
  });
  it('does not override a sheet change while property deletion is saving', async () => {
    const { command, hook, props, commands, sheet, cell } = setup();
    const bound = { ...sheet, modelId: 'model', modelColumnBindings: { property: cell.cell.columnId } };
    props.sheet = bound;
    props.workbook = { ...workbookWithSheets([bound]), dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'property', name: 'Amount', kind: 'manual', type: 'float' }] } } };
    let finish!: (result: { ok: boolean }) => void;
    commands.replaceModelDeclaration.mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    hook.rerender();
    act(() => command('delete-column').run());
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete property' }));
    props.sheet = undefined;
    hook.rerender();
    await act(async () => finish({ ok: true }));
    expect(props.onColumnDeleted).not.toHaveBeenCalled();
    expect(props.closePalette).not.toHaveBeenCalled();
  });
  it.each(['row', 'column'] as const)('reports rejected and failed %s deletions without moving selection', async (axis) => {
    const { command, commands, props } = setup();
    const mutation = axis === 'row' ? commands.deleteRow : commands.deleteColumn;
    mutation.mockReturnValueOnce({ result: { ok: false, reason: 'pending-axis-creation' } });
    act(() => command(`delete-${axis}`).run());
    expect(props.onFeedback).toHaveBeenCalledWith(expect.stringContaining('pending-axis-creation'));
    mutation.mockReturnValueOnce({ result: { ok: true }, completion: Promise.resolve({ ok: false, reason: 'persistence-failed' }) });
    await act(async () => command(`delete-${axis}`).run());
    expect(props.onFeedback).toHaveBeenCalledWith(expect.stringContaining('persistence-failed'));
    expect(axis === 'row' ? props.onRowDeleted : props.onColumnDeleted).not.toHaveBeenCalled();
  });
  it('confirms shared property deletion and rejects a stale selection', async () => {
    const { command, hook, props, commands, sheet, cell } = setup();
    const bound = { ...sheet, modelId: 'model', modelColumnBindings: { property: cell.cell.columnId } };
    props.sheet = bound;
    props.workbook = { ...workbookWithSheets([bound]), dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'property', name: 'Amount', kind: 'manual', type: 'float' }] } } };
    hook.rerender();
    act(() => command('delete-column').run());
    props.sheet = undefined;
    hook.rerender();
    render(<>{hook.result.current.panel?.content}</>);
    expect(screen.getByText(/removes the property and its data/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete property' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed');
    expect(commands.replaceModelDeclaration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });
  it('removes a shared property only after confirmation and successful persistence', async () => {
    const { command, hook, props, commands, sheet, cell } = setup();
    const bound = { ...sheet, modelId: 'model', modelColumnBindings: { property: cell.cell.columnId } };
    const model = { id: 'model', name: 'Model', columns: [{ id: 'property', name: 'Amount', kind: 'manual' as const, type: 'float' as const }] };
    props.sheet = bound;
    props.workbook = { ...workbookWithSheets([bound]), dataModels: { model } };
    commands.replaceModelDeclaration.mockReturnValue({ result: { ok: true }, completion: Promise.resolve({ ok: true }) });
    hook.rerender();
    act(() => command('delete-column').run());
    expect(commands.replaceModelDeclaration).not.toHaveBeenCalled();
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete property' }));
    await waitFor(() => expect(props.onColumnDeleted).toHaveBeenCalledWith(bound, cell));
    expect(commands.replaceModelDeclaration).toHaveBeenCalledWith({ ...model, columns: [] });
  });
  it('hides structural commands for a bound sheet and restores them when unbound', () => {
    const { hook, props, sheet } = setup();
    expect(hook.result.current.commands.map((item) => item.id)).toEqual(expect.arrayContaining(['append-row', 'append-column']));
    props.sheet = { ...sheet, modelId: 'model' };
    hook.rerender();
    expect(hook.result.current.commands.map((item) => item.id)).not.toEqual(expect.arrayContaining(['append-row']));
    expect(hook.result.current.commands.map((item) => item.id)).not.toEqual(expect.arrayContaining(['append-column']));
    props.sheet = sheet;
    hook.rerender();
    expect(hook.result.current.commands.map((item) => item.id)).toEqual(expect.arrayContaining(['append-row', 'append-column']));
  });
  it.each(['Escape', 'Cancel'])('cancels an ordinary rename with %s and restores the selection focus', (method) => {
    const { props, commands, cell } = setup();
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    render(<RenamePalette props={props} />);
    openRename();
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Draft' } });
    if (method === 'Escape') fireEvent.keyDown(screen.getByLabelText('Column name'), { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(commands.renameColumn).not.toHaveBeenCalled();
    expect(props.selection).toEqual({ mode: 'columns', anchor: cell, extent: cell });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selected column' })).toHaveFocus();
  });

  it.each(['Escape', 'Cancel'])('cancels model confirmation with %s without mutation and restores focus', (method) => {
    const { props, commands, sheet, cell } = setup();
    const bound = { ...sheet, modelId: 'model', modelColumnBindings: { property: cell.cell.columnId } };
    props.sheet = bound;
    props.workbook = { ...workbookWithSheets([bound]), dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'property', name: 'Amount', kind: 'manual', type: 'float' }] } } };
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    render(<RenamePalette props={props} />);
    openRename();
    expect(screen.getByText('Model').closest('p')).toHaveTextContent('Amount');
    expect(screen.queryByLabelText('Column name')).not.toBeInTheDocument();
    if (method === 'Escape') fireEvent.keyDown(screen.getByRole('button', { name: 'Continue' }), { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(commands.renameColumn).not.toHaveBeenCalled();
    expect(props.selection).toEqual({ mode: 'columns', anchor: cell, extent: cell });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selected column' })).toHaveFocus();
  });

  it('retains the focused draft and shows an immediate pending-operation rejection', async () => {
    const { props, commands, cell } = setup();
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    commands.renameColumn.mockReturnValue({ result: { ok: false, reason: 'pending-axis-creation' } });
    render(<RenamePalette props={props} />);
    openRename();
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('pending-axis-creation');
    await waitFor(() => expect(screen.getByLabelText('Column name')).toHaveFocus());
    expect(screen.getByLabelText('Column name')).toHaveValue('Draft');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('routes representative workspace, sheet, stacking, view, selection and model commands and exposes guards', () => {
    const { command, commands, controller, props, sheet, cell } = setup();
    expect(command('undo').unavailable).toBe('Nothing to undo');
    expect(command('unbind-model').unavailable).toBe('The selected sheet has no bound model');
    expect(command('bold').unavailable).toBe('Select cells, rows, or columns first');
    act(() => {
      command('new-sheet').run(); command('append-row').run(); command('sheet-order-up').run();
      command('zoom-in').run(); command('select-row').run(); command('data-models').run();
    });
    expect(props.onCreateSheet).toHaveBeenCalledOnce();
    expect(controller.createSheetAtViewportCenter).not.toHaveBeenCalled();
    expect(commands.appendRow).toHaveBeenCalledWith(sheet.id);
    expect(commands.changeSheetZOrder).toHaveBeenCalledWith(sheet.id, 'up');
    expect(controller.zoomWorkspaceBy).toHaveBeenCalledWith(1.2);
    expect(props.onSelectAxis).toHaveBeenCalledWith('rows', cell);
    expect(props.onOpenDataModels).toHaveBeenCalledOnce();
  });

  it('applies numeric sheet controls through the existing command and closes the palette', () => {
    const { command, hook, commands, props, sheet } = setup();
    act(() => command('sheet-scale').run());
    expect(props.openPanel).toHaveBeenCalledOnce();
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.change(screen.getByLabelText('Display scale (%)'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(commands.setSheetVisualScale).toHaveBeenCalledWith(sheet.id, 1.2);
    expect(props.closePalette).toHaveBeenCalledOnce();
  });

  it.each(['row', 'column'] as const)('sizes and resets exact selected %ss without gaps', (axis) => {
    const { command, hook, props } = setup(5);
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 5, columnCount: 5 });
    props.sheet = sheet;
    const ids = axis === 'row' ? sheet.content.rows : sheet.content.columns;
    const target = (index: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[index]!, columnId: sheet.content.columns[index]! } });
    props.selection = { mode: axis === 'row' ? 'rows' : 'columns', anchor: target(0), extent: target(4), members: [ids[0]!, ids[2]!, ids[4]!] };
    props.commands.writeAxisSizes = vi.fn();
    hook.rerender();
    act(() => command(`size-${axis}`).run());
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.change(screen.getByLabelText(axis === 'row' ? 'Row height (pixels)' : 'Column width (pixels)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(props.commands.writeAxisSizes).toHaveBeenCalledWith(sheet.id, [ids[0], ids[2], ids[4]].map((axisId) => ({ axis, axisId, size: 100 })));
    act(() => command(`reset-size-${axis}`).run());
    expect(props.commands.writeAxisSizes).toHaveBeenLastCalledWith(sheet.id, [ids[0], ids[2], ids[4]].map((axisId) => ({ axis, axisId, size: null })));
    props.selection = { ...props.selection, members: [ids[0]!, 'deleted', ids[4]!] };
    hook.rerender();
    expect(command(`size-${axis}`).unavailable).toBe('Select cells, rows, or columns first');
  });

  it('renames a selected column only after persistence succeeds', async () => {
    const { command, hook, commands, props, sheet, cell } = setup();
    expect(command('rename-column').unavailable).toBe('Select one existing column first');
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    hook.rerender();
    expect(command('rename-column').unavailable).toBeUndefined();
    let finish!: (result: { ok: false; reason: 'persistence-failed' }) => void;
    commands.renameColumn.mockReturnValue({ result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) });
    act(() => command('rename-column').run());
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Revenue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(commands.renameColumn).toHaveBeenCalledWith(sheet.id, cell.cell.columnId, 'Revenue');
    expect(hook.result.current.preventClose).toBe(true);
    expect(props.closePalette).not.toHaveBeenCalled();
    await act(async () => finish({ ok: false, reason: 'persistence-failed' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('persistence-failed');
    expect(props.closePalette).not.toHaveBeenCalled();
  });

  it('closes and restores focus only after a successful rename', async () => {
    const { command, hook, commands, props, cell } = setup();
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    hook.rerender();
    commands.renameColumn.mockReturnValue({ result: { ok: true }, completion: Promise.resolve({ ok: true }) });
    act(() => command('rename-column').run());
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Revenue' } });
    fireEvent.submit(screen.getByLabelText('Column name').closest('form')!);
    await waitFor(() => expect(props.closePalette).toHaveBeenCalledOnce());
    expect(hook.result.current.panel).toBeUndefined();
  });

  it('disables rename for missing or cross-sheet columns and rejects a stale target', async () => {
    const { command, hook, commands, props, cell } = setup();
    const missing = { ...cell, cell: { ...cell.cell, columnId: 'missing' } };
    props.selection = { mode: 'columns', anchor: missing, extent: missing };
    hook.rerender();
    expect(command('rename-column').unavailable).toBeDefined();
    props.selection = { mode: 'columns', anchor: cell, extent: { ...cell, sheetId: 'other' } };
    hook.rerender();
    expect(command('rename-column').unavailable).toBeDefined();
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    hook.rerender();
    act(() => command('rename-column').run());
    props.sheet = undefined;
    hook.rerender();
    render(<>{hook.result.current.panel?.content}</>);
    fireEvent.submit(screen.getByLabelText('Column name').closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('selected column has changed');
    expect(commands.renameColumn).not.toHaveBeenCalled();
  });

  it('preserves the draft and rejects a newer ordinary column name', async () => {
    const { command, hook, commands, props, sheet, cell } = setup();
    props.selection = { mode: 'columns', anchor: cell, extent: cell };
    hook.rerender();
    act(() => command('rename-column').run());
    const view = render(<>{hook.result.current.panel?.content}</>);
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'My draft' } });
    const updated = { ...sheet, columnNames: { [cell.cell.columnId]: 'Newer name' } };
    props.workbook = workbookWithSheets([updated]);
    props.sheet = updated;
    hook.rerender();
    view.rerender(<>{hook.result.current.panel?.content}</>);
    fireEvent.submit(screen.getByLabelText('Column name').closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('selected column has changed');
    expect(screen.getByLabelText('Column name')).toHaveValue('My draft');
    expect(commands.renameColumn).not.toHaveBeenCalled();
    expect(props.closePalette).not.toHaveBeenCalled();
  });

  it('disables rename for a multi-column selection and an unsaved column', () => {
    const { command, hook, props, sheet, cell } = setup(2);
    props.selection = { mode: 'columns', anchor: cell, extent: { ...cell, cell: { ...cell.cell, columnId: sheet.content.columns[1]! } } };
    hook.rerender();
    expect(command('rename-column').unavailable).toBe('Select one existing column first');
    const pending = { ...cell, cell: { ...cell.cell, columnId: 'pending-column' } };
    props.selection = { mode: 'columns', anchor: pending, extent: pending };
    hook.rerender();
    expect(command('rename-column').unavailable).toBe('Select one existing column first');
  });

  it('preserves clipboard markers and cancels a failed cut', async () => {
    const { command, props, clipboard } = setup();
    const content = { text: '=A1', marker: 'cut-token' };
    vi.mocked(props.onCopy).mockReturnValue(content);
    await act(async () => { command('copy').run(); });
    expect(clipboard.write).toHaveBeenCalledWith(content);
    clipboard.read.mockResolvedValue(content);
    await act(async () => { command('paste').run(); });
    expect(props.onPaste).toHaveBeenCalledWith(content);
    vi.mocked(props.onCut).mockReturnValue(content);
    clipboard.write.mockRejectedValueOnce(new Error('denied'));
    await act(async () => { command('cut').run(); });
    expect(props.onCancelCut).toHaveBeenCalledOnce();
    expect(props.onFeedback).toHaveBeenCalledWith(expect.stringContaining('Clipboard access failed'));
  });

  it('ignores a pending clipboard result after the palette resets', async () => {
    const { command, hook, props, clipboard } = setup();
    let resolve!: (content: { text: string }) => void;
    clipboard.read.mockReturnValue(new Promise((done) => { resolve = done; }));
    act(() => command('paste').run());
    expect(hook.result.current.busy).toBe(true);
    act(() => hook.result.current.resetPanel());
    await act(async () => resolve({ text: 'late' }));
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(props.onPaste).not.toHaveBeenCalled();
  });
});
