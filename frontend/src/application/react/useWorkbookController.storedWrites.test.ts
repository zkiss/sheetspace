import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';
import { cellRawContent } from '@workbook/read/queries';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { useCellEditing } from '@grid/useCellEditing';
import { cellTargetAt } from '@grid/cellInteraction';

describe('trusted controller writes', () => {
  it('edits ordinary saved text into a formula through the editing session and controller', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const initialWorkbook = workbookWithSheets([sheet]);
    const { result } = renderHook(() => {
      const controller = useWorkbookController({ initialWorkbook });
      const editing = useCellEditing({ commands: controller.commands, workbook: controller.workbook });
      return { controller, editing };
    });
    act(() => { result.current.controller.commands.updateCellContent(sheet.id, 'A1', 'hello'); });
    const savedSheet = result.current.controller.workbook.documents.sheet;
    expect(cellRawContent(savedSheet, 'A1')).toBe('hello');
    act(() => result.current.editing.startEditingCell(cellTargetAt(savedSheet, 'A1')!));
    expect(result.current.editing.editingCell).toMatchObject({ draft: 'hello', mode: 'auto' });
    act(() => result.current.editing.updateEditingCellValue('=1+2'));
    act(() => result.current.editing.commitActiveEdit());
    const raw = cellRawContent(result.current.controller.workbook.documents.sheet, 'A1')!;
    expect(projectStoredFormula(raw, result.current.controller.workbook, sheet.id).text).toBe('=1+2');
    expect(result.current.controller.formulaResults.sheet.A1).toMatchObject({ value: 3 });
  });
  it.each(['=1+2', '2024-02-29', '2023-02-29'])('retains explicit Text intent when editing to %s', (draft) => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const initialWorkbook = workbookWithSheets([sheet]);
    const { result } = renderHook(() => {
      const controller = useWorkbookController({ initialWorkbook });
      return { controller, editing: useCellEditing({ commands: controller.commands, workbook: controller.workbook }) };
    });
    act(() => { result.current.controller.commands.updateCellContent(sheet.id, 'A1', '03/04/2026', 'text'); });
    act(() => result.current.editing.startEditingCell(cellTargetAt(result.current.controller.workbook.documents.sheet, 'A1')!));
    expect(result.current.editing.editingCell).toMatchObject({ mode: 'text' });
    act(() => result.current.editing.updateEditingCellValue(draft));
    act(() => result.current.editing.commitActiveEdit());
    expect(cellRawContent(result.current.controller.workbook.documents.sheet, 'A1')).toBe(`"${draft}"`);
    act(() => result.current.editing.startEditingCell(cellTargetAt(result.current.controller.workbook.documents.sheet, 'A1')!));
    expect(result.current.editing.editingCell).toMatchObject({ draft, mode: 'text' });
  });
  it('persists mode-only changes in both directions', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
    const initialWorkbook = workbookWithSheets([sheet]);
    const { result } = renderHook(() => {
      const controller = useWorkbookController({ initialWorkbook });
      return { controller, editing: useCellEditing({ commands: controller.commands, workbook: controller.workbook }) };
    });
    act(() => { result.current.controller.commands.updateCellContent(sheet.id, 'A1', 'hello'); });
    for (const [mode, raw] of [['text', '"hello"'], ['auto', 'hello']] as const) {
      act(() => result.current.editing.startEditingCell(cellTargetAt(result.current.controller.workbook.documents.sheet, 'A1')!));
      act(() => result.current.editing.updateEditingCellMode(mode));
      act(() => result.current.editing.commitActiveEdit());
      expect(cellRawContent(result.current.controller.workbook.documents.sheet, 'A1')).toBe(raw);
    }
  });
  it('writes temporal modes through the controller and rejects invalid values without mutation', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]) }));
    act(() => { result.current.commands.updateCellContent(sheet.id, 'A1', '2024-02-29 12:30:01.123400000', 'datetime'); });
    expect(cellRawContent(result.current.workbook.documents.sheet, 'A1')).toBe('@datetime:2024-02-29 12:30:01.123400000');
    act(() => { expect(result.current.commands.updateCellContent(sheet.id, 'A1', '2023-02-29', 'date')).toMatchObject({ ok: false, reason: 'invalid-temporal-value' }); });
    expect(cellRawContent(result.current.workbook.documents.sheet, 'A1')).toBe('@datetime:2024-02-29 12:30:01.123400000');
    act(() => { result.current.commands.updateCellContent(sheet.id, 'B1', '@date:2024-02-29'); });
    expect(cellRawContent(result.current.workbook.documents.sheet, 'B1')).toBe('"@date:2024-02-29"');
  });
  it('preserves an unchanged reference when an editor corrects another part of a formula', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4' } });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]) }));
    act(() => { result.current.commands.updateCellContent(sheet.id, 'B1', '=@A[1]+@Missing!A[1]'); });
    const before = cellRawContent(result.current.workbook.documents.sheet, 'B1')!;
    act(() => { result.current.commands.updateCellContent(sheet.id, 'B1', '=@A[1]+3'); });
    const after = cellRawContent(result.current.workbook.documents.sheet, 'B1')!;
    expect(after.split('+')[0]).toBe(before.split('+')[0]);
    expect(result.current.formulaResults.sheet.B1).toMatchObject({ value: 7 });
  });
  it('calculates against the request workbook when a later rename advances the optimistic workbook', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '7' } });
    const target = sheetDocument({ id: 'target', name: 'Target', rowCount: 1, columnCount: 1 });
    const workbook = workbookWithSheets([source, target]);
    const update = vi.spyOn(FormulaCalculation.prototype, 'updateStored');
    const { result, unmount } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    update.mockClear();

    act(() => {
      result.current.commands.updateCellContent('target', 'A1', '=@Source!A[1]');
      result.current.commands.renameSheet('source', 'Renamed');
    });

    expect(result.current.workbook.documents.source.name).toBe('Renamed');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1].documents.source.name).toBe('Source');
    expect(result.current.formulaResults.target.A1).toMatchObject({ value: 7 });
    unmount();
    update.mockRestore();
  });
  it('prepares fresh mixed invalid input once and calculates diagnostics without erasing it', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4' } });
    const workbook = workbookWithSheets([sheet]);
    const text = '=@A[1]+@Missing!A[1]+@A[bad]';
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));

    act(() => { result.current.commands.updateCellContent(sheet.id, 'B1', text); });

    const stored = cellRawContent(result.current.workbook.documents.sheet, 'B1')!;
    expect(stored).toContain(sheet.content.columns[0]);
    expect(projectStoredFormula(stored, result.current.workbook, sheet.id).text).toBe(text);
    expect(result.current.formulaResults.sheet.B1).toMatchObject({ kind: 'error' });
    act(() => { result.current.commands.undo(); result.current.commands.redo(); });
    expect(cellRawContent(result.current.workbook.documents.sheet, 'B1')).toBe(stored);
  });

  it('treats an internal canonical reference entered through the editor as fresh formula text', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const envelope = prepareUserFormula('=@A[1]', workbook, sheet.id);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));

    act(() => { result.current.commands.updateCellContent(sheet.id, 'B1', envelope); });

    const stored = cellRawContent(result.current.workbook.documents.sheet, 'B1')!;
    expect(stored).not.toBe(envelope);
    expect(projectStoredFormula(stored, result.current.workbook, sheet.id).text).toBe(envelope);
    expect(result.current.formulaResults.sheet.B1).toMatchObject({ kind: 'error' });
  });

  it('moves stored content and dependent bindings atomically through undo and redo', () => {
    const base = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 4 });
    const initial = workbookWithSheets([base]);
    const moved = prepareUserFormula('=@D[1]+@Missing!A[0]', initial, base.id);
    const dependent = prepareUserFormula('=@A[1]+@Missing!A[0]', initial, base.id);
    const a = cellIdentityAt(base.content, 'A1')!;
    const b = cellIdentityAt(base.content, 'B1')!;
    const c = cellIdentityAt(base.content, 'C1')!;
    const sheet = { ...base, content: { ...base.content, cells: { [cellIdentityKey(a)]: moved, [cellIdentityKey(c)]: dependent } } };
    const workbook = workbookWithSheets([sheet]);
    const source = { sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 1 }, cells: [[{ identity: a, raw: moved }]] };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => { expect(result.current.commands.moveStoredCells(sheet.id, 'B1', source)).toEqual({ ok: true, changed: true }); });
    const cells = result.current.workbook.documents[sheet.id]!.content.cells;
    const afterMoved = cells[cellIdentityKey(b)]!;
    const afterDependent = cells[cellIdentityKey(c)]!;
    expect(projectStoredFormula(afterMoved, result.current.workbook, sheet.id).text).toBe('=@D[1]+@Missing!A[0]');
    expect(projectStoredFormula(afterDependent, result.current.workbook, sheet.id).text).toBe('=@B[1]+@Missing!A[0]');
    act(() => { result.current.commands.undo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(a)]).toBe(moved);
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(c)]).toBe(dependent);
    act(() => { result.current.commands.redo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(b)]).toBe(afterMoved);
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(c)]).toBe(afterDependent);
  });
  it('admits an unchanged internal snapshot without preparing its formula again', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const raw = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const identity = { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! };
    const clipboard = { ok: true as const, value: { kind: 'internal' as const,
      grid: { rows: [[raw]], rowCount: 1, columnCount: 1 },
      source: { sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 1 }, cells: [[{ identity, raw }]] } } };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => { expect(result.current.commands.pasteStoredCells(sheet.id, 'B1', clipboard)).toEqual({ ok: true, changed: true }); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(identity)]).toBe(raw);
    act(() => { result.current.commands.undo(); });
    act(() => { result.current.commands.redo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(identity)]).toBe(raw);
  });

  it('copies a translated stored formula and restores exact contents through undo and redo', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 4 });
    const workbook = workbookWithSheets([sheet]);
    const raw = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const source = cellIdentityAt(sheet.content, 'B1')!;
    const target = cellIdentityAt(sheet.content, 'C1')!;
    const clipboard = { ok: true as const, value: { kind: 'internal' as const,
      grid: { rows: [[raw]], rowCount: 1, columnCount: 1 },
      source: { sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 1 }, cells: [[{ identity: source, raw }]] } } };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));

    act(() => { expect(result.current.commands.pasteStoredCells(sheet.id, 'C1', clipboard)).toEqual({ ok: true, changed: true }); });
    const copied = result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(target)]!;
    expect(projectStoredFormula(copied, result.current.workbook, sheet.id).text).toBe('=@B[1]+@Missing!A[0]');
    expect(copied).toContain(sheet.content.columns[1]);
    expect(copied.split('+')[1]).toBe(raw.split('+')[1]);
    act(() => { result.current.commands.undo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(target)]).toBeUndefined();
    act(() => { result.current.commands.redo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(target)]).toBe(copied);
  });

  it('retains stored formula content through undo and redo', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const raw = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const cell = { sheetId: sheet.id, rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => { result.current.commands.writeStoredCells([{ ...cell, raw }]); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(cell)]).toBe(raw);
    act(() => { result.current.commands.undo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(cell)]).toBeUndefined();
    act(() => { result.current.commands.redo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(cell)]).toBe(raw);
  });
});
