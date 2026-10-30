import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from '@grid/cellInteraction';
import { positionedSheet, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useCellEditing } from '@grid/useCellEditing';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';

function renderCellEditing(sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 })) {
  const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
  const workbook = workbookWithSheets([sheet]);
  return {
    commands,
    sheet,
    ...renderHook(() => useCellEditing({ commands, workbook })),
  };
}


describe('useCellEditing edit persistence', () => {
    it('discards a changed draft on cancellation without writing or changing the saved content', () => {
      const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { B1: '2' } });
      const { commands, result } = renderCellEditing(sheet);
      const target = cellTargetAt(sheet, 'B1')!;
      act(() => result.current.startEditingCell(target));
      act(() => result.current.updateEditingCellValue('draft text'));
      act(() => result.current.cancelActiveEdit());
      expect(result.current.editingCell).toBeNull();
      expect(result.current.activeCell).toEqual(target);
      expect(commands.updateCellContent).not.toHaveBeenCalled();
      expect(commands.writeCells).not.toHaveBeenCalled();
      act(() => result.current.startEditingCell(target));
      expect(result.current.editingCell?.draft).toBe('2');
    });

    it.each(['rows', 'columns'] as const)('suspends text, formula and unchanged drafts before selecting %s', (mode) => {
      for (const [raw, draft] of [['', 'Region'], ['', '=SUM(@B[1]:B[2])'], ['', ''], ['Region', 'Region'], ['=SUM(@B[1]:B[2])', '=SUM(@B[1]:B[2])']]) {
        const input = sheetDocument({ id: 'header-drafts', name: 'Header drafts', cells: { A1: raw } });
        const { commands, result, sheet, unmount } = renderCellEditing(input);
        const a1 = cellTargetAt(sheet, 'A1')!;
        const b1 = cellTargetAt(sheet, 'B1')!;
        act(() => result.current.startEditingCell(a1, draft));
        const session = result.current.editingCell!;
        act(() => result.current.selectAxis(mode, b1, false));
        expect(commands.updateCellContent).not.toHaveBeenCalled();
        expect(result.current.editingCell).toBeNull();
        expect(result.current.selectionRange).toEqual({ mode, anchor: b1, extent: b1 });
        act(() => result.current.commitActiveEdit(session));
        expect(commands.updateCellContent).not.toHaveBeenCalled();
        expect(result.current.selectionRange).toEqual({ mode, anchor: b1, extent: b1 });
        unmount();
      }
    });

    it.each([
      ['text', 'Region'],
      ['numeric-looking text', '42.50'],
      ['formula-looking text', '=SUM(@B[1]:B[2])'],
    ])('commits %s without changing the raw draft', (_label, draft) => {
      const { commands, result, sheet } = renderCellEditing();
      const target = cellTargetAt(sheet, 'A1')!;

      act(() => {
        result.current.startEditingCell(target);
        result.current.updateEditingCellValue(draft);
      });
      act(() => result.current.commitActiveEdit());

      expect(commands.updateCellContent).toHaveBeenCalledOnce();
      expect(commands.updateCellContent).toHaveBeenCalledWith(sheet.id, 'A1', draft);
      expect(result.current.editingCell).toBeNull();
    });

    it('keeps a rejected draft recoverable for an unchanged retry', () => {
      const { commands, result, sheet } = renderCellEditing();
      const target = cellTargetAt(sheet, 'A1')!;
      commands.updateCellContent.mockReturnValueOnce({ ok: false, reason: 'pending-model-transition' }).mockReturnValueOnce({ ok: true, changed: true });

      act(() => {
        result.current.startEditingCell(target);
        result.current.updateEditingCellValue('retry me');
      });
      act(() => result.current.commitActiveEdit());
      expect(result.current.editingCell?.draft).toBe('retry me');

      act(() => result.current.commitActiveEdit());
      expect(commands.updateCellContent).toHaveBeenCalledTimes(2);
      expect(commands.updateCellContent).toHaveBeenLastCalledWith(sheet.id, 'A1', 'retry me');
      expect(result.current.editingCell).toBeNull();
    });

    it('opens canonical formula content as user-facing raw text and skips an unchanged commit', () => {
      const inputs = sheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
      const outputWithoutFormula = sheetDocument({ id: 'sheet-output', name: 'Output' });
      const initialWorkbook = workbookWithSheets([inputs, outputWithoutFormula]);
      const storedFormula = prepareUserFormula("=@'Inputs'!A[1]", initialWorkbook, outputWithoutFormula.id);
      const output = sheetDocument({
        id: outputWithoutFormula.id,
        name: outputWithoutFormula.name,
        cells: { A1: storedFormula },
      });
      const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
      const workbook = workbookWithSheets([inputs, output]);
      const { result } = renderHook(() => useCellEditing({ commands, workbook }));
      const target = cellTargetAt(output, 'A1')!;

      act(() => result.current.startEditingCell(target));

      expect(result.current.editingCell).toMatchObject({ target, draft: '=@Inputs!A[1]' });

      act(() => result.current.commitActiveEdit());

      expect(commands.updateCellContent).not.toHaveBeenCalled();
      expect(result.current.editingCell).toBeNull();
    });

    it.each([
      ['text', 'Remove me'],
      ['numeric-looking text', '123'],
      ['formula', '=SUM(@A[2]:A[3])'],
    ])('clears existing %s when an empty edit is committed', (_label, raw) => {
      const initial = sheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
      const content = raw.startsWith('=') ? prepareUserFormula(raw, workbookWithSheets([initial]), initial.id) : raw;
      const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: { A1: content } });
      const { commands, result } = renderCellEditing(sheet);
      const target = cellTargetAt(sheet, 'A1')!;

      act(() => {
        result.current.startEditingCell(target);
        result.current.updateEditingCellValue('');
      });
      act(() => result.current.commitActiveEdit());

      expect(commands.updateCellContent).toHaveBeenCalledOnce();
      expect(commands.updateCellContent).toHaveBeenCalledWith(sheet.id, 'A1', '');
    });

    it.each([
      ['missing content', {}],
      ['stored empty content', { A1: '' }],
    ])('does not persist an empty commit over %s', (_label, cells) => {
      const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells });
      const { commands, result } = renderCellEditing(sheet);
      const target = cellTargetAt(sheet, 'A1')!;

      act(() => result.current.startEditingCell(target));
      act(() => result.current.commitActiveEdit());

      expect(commands.updateCellContent).not.toHaveBeenCalled();
    });

    it.each([
      ['stored content', { A1: 'Remove me' }, 1],
      ['an empty cell', {}, 0],
    ])('clears %s directly and requests focus without entering edit mode', (_label, cells, expectedCalls) => {
      const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells });
      const { commands, result } = renderCellEditing(sheet);
      const target = cellTargetAt(sheet, 'A1')!;

      act(() => result.current.clearCellContent(target));

      expect(commands.writeCells).toHaveBeenCalledTimes(expectedCalls);
      if (expectedCalls) {
        expect(commands.writeCells).toHaveBeenCalledWith([{ sheetId: sheet.id, rowId: sheet.content.rows[0], columnId: sheet.content.columns[0], raw: '' }]);
      }
      expect(result.current.activeCell).toEqual(target);
      expect(result.current.editingCell).toBeNull();
      expect(result.current.keyboardFocusRequest).toMatchObject({ target });
    });

    it('clears a reversed rectangular selection with one batch and retains that selection', () => {
      const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: {
        A1: 'left', B1: '=@A[1]', B2: 'bottom', C2: 'outside',
      } });
      const { commands, result } = renderCellEditing(sheet);
      const b2 = cellTargetAt(sheet, 'B2')!;
      const a1 = cellTargetAt(sheet, 'A1')!;

      act(() => result.current.selectCell(b2));
      act(() => result.current.extendSelection(a1));
      act(() => result.current.clearCellContent(a1));

      expect(commands.writeCells).toHaveBeenCalledOnce();
      expect(commands.writeCells).toHaveBeenCalledWith(expect.arrayContaining([
        { sheetId: sheet.id, rowId: sheet.content.rows[0], columnId: sheet.content.columns[0], raw: '' },
        { sheetId: sheet.id, rowId: sheet.content.rows[0], columnId: sheet.content.columns[1], raw: '' },
        { sheetId: sheet.id, rowId: sheet.content.rows[1], columnId: sheet.content.columns[1], raw: '' },
      ]));
      expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: b2, extent: a1 });
    });

    it('clears populated cells in a selected whole column with one batch', () => {
      const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: { B1: 'top', B2: '=@A[1]', C2: 'outside' } });
      const { commands, result } = renderCellEditing(sheet);
      const b1 = cellTargetAt(sheet, 'B1')!;
      const b2 = cellTargetAt(sheet, 'B2')!;

      act(() => result.current.selectAxis('columns', b1, false));
      act(() => result.current.selectAxis('columns', b2, true));
      act(() => result.current.clearCellContent(b2));

      expect(commands.writeCells).toHaveBeenCalledOnce();
      expect(commands.writeCells).toHaveBeenCalledWith([
        { sheetId: sheet.id, rowId: sheet.content.rows[0], columnId: sheet.content.columns[1], raw: '' },
        { sheetId: sheet.id, rowId: sheet.content.rows[1], columnId: sheet.content.columns[1], raw: '' },
      ]);
    });

    it('clears populated cells in a selected whole row with one batch', () => {
      const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: { A2: 'left', B2: '=@A[1]', B1: 'outside' } });
      const { commands, result } = renderCellEditing(sheet);
      const a2 = cellTargetAt(sheet, 'A2')!;
      const b2 = cellTargetAt(sheet, 'B2')!;

      act(() => result.current.selectAxis('rows', a2, false));
      act(() => result.current.selectAxis('rows', b2, true));
      act(() => result.current.clearCellContent(b2));

      expect(commands.writeCells).toHaveBeenCalledWith([
        { sheetId: sheet.id, rowId: sheet.content.rows[1], columnId: sheet.content.columns[0], raw: '' },
        { sheetId: sheet.id, rowId: sheet.content.rows[1], columnId: sheet.content.columns[1], raw: '' },
      ]);
    });
});
