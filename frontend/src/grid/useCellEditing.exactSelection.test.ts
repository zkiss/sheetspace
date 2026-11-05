import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from '@grid/cellInteraction';
import { useCellEditing } from '@grid/useCellEditing';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('exact content selection', () => {
  it.each(['rows', 'columns'] as const)('keeps a newer queued %s selection after a stale gesture settles', (mode) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 4, columnCount: 4 });
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const workbook = workbookWithSheets([sheet]);
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const first = cellTargetAt(sheet, 'A1')!;
    const newer = cellTargetAt(sheet, mode === 'rows' ? 'A4' : 'D1')!;
    const owner = Symbol('old gesture');
    act(() => {
      result.current.selectAxis(mode, first, false, { owner, start: true });
      result.current.selectAxis(mode, newer, false);
      result.current.extendSelection(first, { owner });
      result.current.settleSelectionGesture(owner);
    });
    expect(result.current.activeCell).toEqual(newer);
    expect(result.current.selectionRange?.members).toEqual([mode === 'rows' ? newer.cell.rowId : newer.cell.columnId]);
    expect(result.current.selectionOwner).toBeNull();
  });
  it.each(['rows', 'columns'] as const)('invalidates queued %s gesture when an orthogonal anchor disappears', (mode) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2 });
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result, rerender } = renderHook(({ workbook }) => useCellEditing({ commands, workbook }),
      { initialProps: { workbook: workbookWithSheets([sheet]) } });
    const anchor = cellTargetAt(sheet, mode === 'rows' ? 'B1' : 'A2')!;
    const extent = cellTargetAt(sheet, mode === 'rows' ? 'A2' : 'B1')!;
    const owner = Symbol('gesture');
    act(() => {
      result.current.selectAxis(mode, anchor, false, { owner, start: true });
      result.current.selectAxis(mode, extent, true, { owner });
    });
    const revision = result.current.interactionRevision();
    const orthogonal = mode === 'rows' ? 'columns' : 'rows';
    const reduced = { ...sheet, content: { ...sheet.content, [orthogonal]: sheet.content[orthogonal].slice(0, 1) } };
    rerender({ workbook: workbookWithSheets([reduced]) });
    expect(result.current.interactionRevision()).toBeGreaterThan(revision);
    expect(result.current.activeCell).toEqual(extent);
    const updatedRevision = result.current.interactionRevision();
    act(() => {
      result.current.extendSelection(extent, { owner });
      result.current.settleSelectionGesture(owner);
    });
    expect(result.current.interactionRevision()).toBe(updatedRevision);
    expect(result.current.selectionOwner).toBeNull();
  });
  it.each(['rows', 'columns'] as const)('creates and extends exact %s through queued header actions', (mode) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: {} });
    const workbook = workbookWithSheets([sheet]);
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, mode === 'rows' ? 'A3' : 'C1')!;
    const axis = mode === 'rows' ? sheet.content.rows : sheet.content.columns;
    act(() => {
      result.current.selectAxis(mode, anchor, false);
      result.current.extendSelection(extent);
    });
    expect(result.current.selectionRange?.members).toEqual(axis.slice(0, 3));
  });
  it.each(['rows', 'columns'] as const)('clears only selected %s and keeps membership when endpoints are unchanged', (mode) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: { A1: 'a', A2: 'b', A3: 'c', A4: 'd', B1: 'e', C1: 'f', D1: 'g' } });
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const workbook = workbookWithSheets([sheet]);
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, mode === 'rows' ? 'A4' : 'D1')!;
    const axis = mode === 'rows' ? sheet.content.rows : sheet.content.columns;
    const selection = { mode, anchor, extent, members: [axis[0]!, axis[2]!, axis[3]!] };
    act(() => { result.current.restoreSelection(selection); });
    act(() => { result.current.clearCellContent(extent); });
    const writes = commands.writeCells.mock.calls[0]![0] as { rowId: string; columnId: string }[];
    expect(writes.every((write) => (mode === 'rows' ? write.rowId : write.columnId) !== axis[1])).toBe(true);
    expect(writes.some((write) => (mode === 'rows' ? write.rowId : write.columnId) === axis[2])).toBe(true);
    expect(result.current.selectionRange).toEqual(selection);
    const changed = { ...selection, members: [axis[0]!, axis[1]!, axis[3]!] };
    act(() => { result.current.restoreSelection(changed); });
    act(() => { result.current.clearCellContent(extent); });
    const next = commands.writeCells.mock.calls[1]![0] as { rowId: string; columnId: string }[];
    expect(next.some((write) => (mode === 'rows' ? write.rowId : write.columnId) === axis[1])).toBe(true);
    expect(next.every((write) => (mode === 'rows' ? write.rowId : write.columnId) !== axis[2])).toBe(true);
  });

  it.each(['rows', 'columns'] as const)('reconciles %s membership on deletion without reviving it on undo', (mode) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: {} });
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result, rerender } = renderHook(({ workbook }) => useCellEditing({ commands, workbook }),
      { initialProps: { workbook: workbookWithSheets([sheet]) } });
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, mode === 'rows' ? 'A3' : 'C1')!;
    const axis = mode === 'rows' ? 'rows' : 'columns';
    const ids = sheet.content[axis].slice(0, 3);
    act(() => { result.current.restoreSelection({ mode, anchor, extent, members: ids }); });
    const revision = result.current.interactionRevision();
    const reordered = { ...sheet, content: { ...sheet.content, [axis]: [...sheet.content[axis]].reverse() } };
    rerender({ workbook: workbookWithSheets([reordered]) });
    expect(result.current.interactionRevision()).toBe(revision);
    const reduced = { ...sheet, content: { ...sheet.content, [axis]: sheet.content[axis].filter((id) => id !== ids[1]) } };
    rerender({ workbook: workbookWithSheets([reduced]) });
    expect(result.current.selectionRange?.members).toEqual([ids[0], ids[2]]);
    expect(result.current.interactionRevision()).toBeGreaterThan(revision);
    rerender({ workbook: workbookWithSheets([sheet]) });
    expect(result.current.selectionRange?.members).toEqual([ids[0], ids[2]]);
  });

  it('prunes missing identities when restoring and preserves the selection on rejected clear', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: { A1: 'a', A3: 'c' } });
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn(() => ({ ok: false as const, reason: 'calculated-cell-write' as const })) };
    const workbook = workbookWithSheets([sheet]);
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, 'A3')!;
    const selection = { mode: 'rows' as const, anchor, extent, members: [anchor.cell.rowId, 'deleted', extent.cell.rowId] };
    act(() => { expect(result.current.restoreSelection(selection)).toBe(true); });
    const restored = result.current.selectionRange;
    expect(restored?.members).toEqual([anchor.cell.rowId, extent.cell.rowId]);
    act(() => { expect(result.current.clearCellContent(extent)).toEqual({ ok: false, reason: 'calculated-cell-write' }); });
    expect(commands.writeCells).toHaveBeenCalledOnce();
    expect(result.current.selectionRange).toEqual(restored);
  });

  it.each(['ArrowRight', 'Tab', 'Enter'] as const)('%s leaves an axis selection as an ordinary cell selection', (key) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: {} });
    const workbook = workbookWithSheets([sheet]);
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, 'A3')!;
    act(() => { result.current.restoreSelection({ mode: 'rows', anchor, extent, members: [anchor.cell.rowId, extent.cell.rowId] }); });
    act(() => { result.current.navigateKeyboardCell(extent, { key }); });
    expect(result.current.selectionRange?.mode).toBe('cells');
    expect(result.current.selectionRange?.members).toBeUndefined();
  });

  it('editing an axis selection intentionally starts an ordinary cell selection', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', cells: {} });
    const workbook = workbookWithSheets([sheet]);
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const anchor = cellTargetAt(sheet, 'A1')!;
    const extent = cellTargetAt(sheet, 'A3')!;
    act(() => { result.current.restoreSelection({ mode: 'rows', anchor, extent, members: [anchor.cell.rowId, extent.cell.rowId] }); });
    act(() => { result.current.startEditingCell(extent); });
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: extent, extent });
  });
});
