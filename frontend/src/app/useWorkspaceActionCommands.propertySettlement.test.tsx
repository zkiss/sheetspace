import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useCellEditing } from '@grid/useCellEditing';
import { cellTargetAt } from '@grid/cellInteraction';
import { useWorkspaceActionCommands } from './useWorkspaceActionCommands';

it.each(['owned', 'away-and-back', 'superseded', 'unmounted', 'success-after-selection-change'] as const)('settles property deletion with %s selection ownership', async (ownership) => {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 3 });
  const cell = cellTargetAt(sheet, 'A1')!;
  const bound = { ...sheet, modelId: 'model', modelColumnBindings: { property: cell.cell.columnId } };
  const model = { id: 'model', name: 'Model', columns: [{ id: 'property', name: 'Amount', kind: 'manual' as const, type: 'float' as const }] };
  const before = { ...workbookWithSheets([bound]), dataModels: { model } };
  const after = { ...before, documents: { ...before.documents, [bound.id]: { ...bound, content: { ...bound.content, columns: bound.content.columns.slice(1) } } } };
  let current = before;
  let finish!: (result: { ok: boolean; reason?: string }) => void;
  let publish!: (before: typeof current, after: typeof current) => void;
  const replaceModelDeclaration = vi.fn((_model, observer) => {
    publish = observer;
    current = after;
    publish(before, after);
    return { result: { ok: true }, completion: new Promise((resolve) => { finish = resolve; }) };
  });
  const onColumnDeleted = vi.fn();
  const onRestore = vi.fn();
  const props = {
    commands: { currentWorkbook: () => current, replaceModelDeclaration }, controller: {}, sheet: bound, workbook: before, activeCell: cell,
    formatting: { descriptor: { valid: false } }, referencesVisible: true, canUndo: false, canRedo: false, canRetryFailedSaves: false,
    navigation: { canGoBack: false, canGoForward: false, traverse: vi.fn() }, closePalette: vi.fn(), openPanel: vi.fn(), onCreateSheet: vi.fn(),
    onRename: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onClear: vi.fn(), onSelectAxis: vi.fn(), onSelectAll: vi.fn(),
    onRowDeleted: vi.fn(), onColumnDeleted, onToggleReferences: vi.fn(), onFeedback: vi.fn(), onCopy: vi.fn(), onCut: vi.fn(),
    onPaste: vi.fn(), onCancelCut: vi.fn(), hasPendingCut: false,
  } as unknown as Parameters<typeof useWorkspaceActionCommands>[0];
  const { result, unmount } = renderHook(() => {
    const editing = useCellEditing({ commands: { updateCellContent: vi.fn(), writeCells: vi.fn() }, workbook: before, currentWorkbook: () => current });
    const actions = useWorkspaceActionCommands({ ...props, selection: editing.selectionRange, selectionSettlement: editing, restoreSelection: (...args) => { onRestore(); return editing.restoreSelection(...args); } });
    return { editing, actions };
  });
  act(() => result.current.editing.selectCell(cell));
  const original = result.current.editing.selectionRange;
  act(() => result.current.actions.commands.find((item) => item.id === 'delete-column')!.run());
  if (ownership === 'success-after-selection-change') {
    act(() => result.current.editing.selectCell(cellTargetAt(bound, 'B1')!));
  }
  render(<>{result.current.actions.panel?.content}</>);
  fireEvent.click(screen.getByRole('button', { name: 'Delete property' }));
  expect(replaceModelDeclaration).toHaveBeenCalledOnce();
  if (ownership === 'success-after-selection-change') {
    await act(async () => { finish({ ok: true }); });
    expect(onColumnDeleted).toHaveBeenCalledOnce();
    expect(onRestore).not.toHaveBeenCalled();
    return;
  }
  if (ownership === 'away-and-back') {
    act(() => { result.current.editing.selectCell(cellTargetAt(bound, 'C1')!); result.current.editing.selectCell(cellTargetAt(bound, 'B1')!); });
  } else if (ownership === 'superseded') {
    result.current.editing.beginSelectionSettlement();
  } else if (ownership === 'unmounted') {
    unmount();
  }
  await act(async () => { current = before; publish(after, before); finish({ ok: false, reason: 'persistence-failed' }); });
  expect(await screen.findByRole('alert')).toHaveTextContent('persistence-failed');
  expect(screen.getByRole('button', { name: 'Delete property' })).toBeEnabled();
  expect(onColumnDeleted).not.toHaveBeenCalled();
  if (ownership === 'unmounted') expect(onRestore).not.toHaveBeenCalled();
  if (ownership === 'owned') expect(result.current.editing.selectionRange).toEqual(original);
  else if (ownership !== 'unmounted') expect(result.current.editing.selectionRange).not.toEqual(original);
});
