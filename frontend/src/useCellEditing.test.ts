import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from './cellInteraction';
import { positionedSheet, sheetDocument, workbookWithSheets } from './test/workbookFactories';
import { useCellEditing } from './useCellEditing';
import { formulaRawForStorage } from './workbook';

function renderCellEditing(sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 })) {
  const commands = { updateCellContent: vi.fn() };
  const workbook = workbookWithSheets([sheet]);
  return {
    commands,
    sheet,
    ...renderHook(() => useCellEditing({ commands, workbook })),
  };
}

describe('useCellEditing', () => {
  it('clears local interaction state when deleted sheet disappears from workbook', () => {
    const commands = { updateCellContent: vi.fn() };
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const target = cellTargetAt(sheet, 'A1')!;
    const { rerender, result } = renderHook(
      ({ workbook }) => useCellEditing({ commands, workbook }),
      { initialProps: { workbook: workbookWithSheets([sheet]) } },
    );

    act(() => {
      result.current.selectCell(target);
      result.current.startEditingCell(target, 'draft value');
    });

    rerender({ workbook: workbookWithSheets([]) });

    expect(result.current.activeCell).toBeNull();
    expect(result.current.keyboardFocusRequest).toBeNull();
    expect(result.current.editingCell).toBeNull();
  });

  describe('edit persistence', () => {
    it.each([
      ['text', 'Region'],
      ['numeric-looking text', '42.50'],
      ['formula-looking text', '=SUM(B1:B2)'],
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

    it('opens canonical formula content as user-facing raw text and skips an unchanged commit', () => {
      const inputs = sheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
      const outputWithoutFormula = sheetDocument({ id: 'sheet-output', name: 'Output' });
      const initialWorkbook = workbookWithSheets([inputs, outputWithoutFormula]);
      const storedFormula = formulaRawForStorage("='Inputs'!A1", initialWorkbook, outputWithoutFormula.id);
      const output = sheetDocument({
        id: outputWithoutFormula.id,
        name: outputWithoutFormula.name,
        cells: { A1: storedFormula },
      });
      const commands = { updateCellContent: vi.fn() };
      const workbook = workbookWithSheets([inputs, output]);
      const { result } = renderHook(() => useCellEditing({ commands, workbook }));
      const target = cellTargetAt(output, 'A1')!;

      act(() => result.current.startEditingCell(target));

      expect(result.current.editingCell).toEqual({ target, draft: '=Inputs!A1' });

      act(() => result.current.commitActiveEdit());

      expect(commands.updateCellContent).not.toHaveBeenCalled();
      expect(result.current.editingCell).toBeNull();
    });

    it.each([
      ['text', 'Remove me'],
      ['numeric-looking text', '123'],
      ['formula', '=SUM(A2:A3)'],
    ])('clears existing %s when an empty edit is committed', (_label, raw) => {
      const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: { A1: raw } });
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

      expect(commands.updateCellContent).toHaveBeenCalledTimes(expectedCalls);
      if (expectedCalls) {
        expect(commands.updateCellContent).toHaveBeenCalledWith(sheet.id, 'A1', '');
      }
      expect(result.current.activeCell).toEqual(target);
      expect(result.current.editingCell).toBeNull();
      expect(result.current.keyboardFocusRequest).toMatchObject({ target });
    });
  });

  describe('commit navigation', () => {
    it('commits with Tab and selects the adjacent cell to the right', () => {
      const { commands, result, sheet } = renderCellEditing();
      const a1 = cellTargetAt(sheet, 'A1')!;
      const b1 = cellTargetAt(sheet, 'B1')!;
      const session = { target: a1, draft: 'Region' };

      act(() => {
        result.current.startEditingCell(a1, session.draft);
        result.current.commitEditAndNavigate(session, 'tab');
      });

      expect(commands.updateCellContent).toHaveBeenCalledWith(sheet.id, 'A1', session.draft);
      expect(result.current.activeCell).toEqual(b1);
      expect(result.current.editingCell).toBeNull();
      expect(result.current.keyboardFocusRequest).toMatchObject({ target: b1 });
    });

    it('commits with Enter and selects the adjacent cell below in the same column', () => {
      const { commands, result, sheet } = renderCellEditing();
      const b1 = cellTargetAt(sheet, 'B1')!;
      const b2 = cellTargetAt(sheet, 'B2')!;
      const session = { target: b1, draft: 'Value' };

      act(() => result.current.commitEditAndNavigate(session, 'enter'));

      expect(commands.updateCellContent).toHaveBeenCalledWith(sheet.id, 'B1', session.draft);
      expect(result.current.activeCell).toEqual(b2);
      expect(result.current.keyboardFocusRequest).toMatchObject({ target: b2 });
    });

    it('returns to the tab-run origin column on Enter after tabbing through edits', () => {
      const { commands, result, sheet } = renderCellEditing();
      const a1 = cellTargetAt(sheet, 'A1')!;
      const b1 = cellTargetAt(sheet, 'B1')!;
      const a2 = cellTargetAt(sheet, 'A2')!;

      act(() => result.current.commitEditAndNavigate({ target: a1, draft: 'First' }, 'tab'));
      expect(result.current.activeCell).toEqual(b1);

      act(() => result.current.commitEditAndNavigate({ target: b1, draft: 'Second' }, 'enter'));

      expect(commands.updateCellContent).toHaveBeenNthCalledWith(1, sheet.id, 'A1', 'First');
      expect(commands.updateCellContent).toHaveBeenNthCalledWith(2, sheet.id, 'B1', 'Second');
      expect(result.current.activeCell).toEqual(a2);
      expect(result.current.keyboardFocusRequest).toMatchObject({ target: a2 });
    });
  });
});
