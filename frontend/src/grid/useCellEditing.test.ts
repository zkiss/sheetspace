import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from '@grid/cellInteraction';
import { positionedSheet, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useCellEditing } from '@grid/useCellEditing';
import { formulaRawForStorage } from '@workbook/formula/reference';

function renderCellEditing(sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 })) {
  const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
  const workbook = workbookWithSheets([sheet]);
  return {
    commands,
    sheet,
    ...renderHook(() => useCellEditing({ commands, workbook })),
  };
}

describe('useCellEditing', () => {
  it('keeps focus with the extent through repeated Shift-arrow extension and reversal', () => {
    const { result, sheet } = renderCellEditing();
    const b1 = cellTargetAt(sheet, 'B1')!;
    const c1 = cellTargetAt(sheet, 'C1')!;
    const d1 = cellTargetAt(sheet, 'D1')!;
    const a1 = {
      sheetId: sheet.id,
      cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! },
    };

    act(() => result.current.selectCell(b1));
    act(() => result.current.navigateCell(b1, 'right', true));
    expect(result.current.activeCell).toEqual(c1);
    expect(result.current.keyboardFocusRequest).toMatchObject({ id: 1, target: c1 });

    act(() => result.current.navigateCell(c1, 'right', true));
    expect(result.current.activeCell).toEqual(d1);
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: b1, extent: d1 });
    expect(result.current.keyboardFocusRequest).toMatchObject({ id: 2, target: d1 });

    act(() => result.current.navigateCell(d1, 'left', true));
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: b1, extent: c1 });

    act(() => result.current.navigateCell(c1, 'left', true));
    act(() => result.current.navigateCell(b1, 'left', true));
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: b1, extent: a1 });
    expect(result.current.keyboardFocusRequest).toMatchObject({ id: 5, target: a1 });
  });

  it('clears local interaction state when deleted sheet disappears from workbook', () => {
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
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

  it('ignores editing, clearing, and navigation requests for a missing sheet', () => {
    const { commands, result } = renderCellEditing();
    const missing = { sheetId: 'missing', cell: { rowId: 'row-1', columnId: 'column-1' } };

    act(() => {
      result.current.startEditingCell(missing);
      result.current.clearCellContent(missing);
      result.current.navigateCell(missing, 'right');
    });

    expect(result.current.editingCell).toBeNull();
    expect(commands.updateCellContent).not.toHaveBeenCalled();
    expect(commands.writeCells).not.toHaveBeenCalled();
  });

  it('does not navigate or write from a stale cell identity in an existing sheet', () => {
    const { commands, result, sheet } = renderCellEditing();
    const stale = { sheetId: sheet.id, cell: { rowId: 'removed-row', columnId: 'removed-column' } };

    act(() => {
      result.current.navigateCell(stale, 'right');
      result.current.clearCellContent(stale);
    });

    expect(result.current.activeCell).toEqual(stale);
    expect(result.current.keyboardFocusRequest).toMatchObject({ target: stale });
    expect(commands.writeCells).not.toHaveBeenCalled();
  });

  it('abandons a pending edit when its sheet disappears before the commit', () => {
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const target = cellTargetAt(sheet, 'A1')!;
    const { rerender, result } = renderHook(
      ({ workbook }) => useCellEditing({ commands, workbook }),
      { initialProps: { workbook: workbookWithSheets([sheet]) } },
    );

    act(() => result.current.startEditingCell(target, 'draft'));
    const session = result.current.editingCell!;
    rerender({ workbook: workbookWithSheets([]) });
    act(() => result.current.commitActiveEdit(session));

    expect(commands.updateCellContent).not.toHaveBeenCalled();
    expect(result.current.editingCell).toBeNull();
  });

  it('keeps selection on the edge cell while keyboard navigation requests focus', () => {
    const { result, sheet } = renderCellEditing();
    const a1 = {
      sheetId: sheet.id,
      cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! },
    };

    act(() => {
      result.current.selectCell(a1);
      result.current.navigateCell(a1, 'left');
      result.current.navigateCell(a1, 'up', true);
    });

    expect(result.current.activeCell).toEqual(a1);
    expect(result.current.keyboardFocusRequest).toMatchObject({ target: a1 });
  });

  it('extends keyboard jumps without issuing any content command', () => {
    const populated = sheetDocument({ id: 'navigation', name: 'Navigation', cells: { A1: 'first', B1: '=A1', C1: 'last' } });
    const { commands, result } = renderCellEditing(populated);
    const a1 = cellTargetAt(populated, 'A1')!;
    const c1 = cellTargetAt(populated, 'C1')!;

    act(() => result.current.selectCell(a1));
    let claimed = false;
    act(() => { claimed = result.current.navigateKeyboardCell(a1, { key: 'ArrowRight', command: true, shift: true }); });

    expect(claimed).toBe(true);
    expect(result.current.activeCell).toEqual(c1);
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: a1, extent: c1 });
    expect(result.current.keyboardFocusRequest).toMatchObject({ target: c1 });
    expect(commands.updateCellContent).not.toHaveBeenCalled();
    expect(commands.writeCells).not.toHaveBeenCalled();
  });

  it('keeps a rectangular range through repeated forward and reverse traversal', () => {
    const { result, sheet } = renderCellEditing();
    const a1 = cellTargetAt(sheet, 'A1')!;
    const c2 = cellTargetAt(sheet, 'C2')!;
    const b1 = cellTargetAt(sheet, 'B1')!;
    const c1 = cellTargetAt(sheet, 'C1')!;
    const a2 = cellTargetAt(sheet, 'A2')!;
    const b2 = cellTargetAt(sheet, 'B2')!;

    act(() => result.current.selectCell(a1));
    act(() => result.current.extendSelection(c2));
    act(() => result.current.navigateKeyboardCell(a1, { key: 'Tab' }));
    expect(result.current.activeCell).toEqual(b1);
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: a1, extent: c2 });

    act(() => result.current.navigateKeyboardCell(b1, { key: 'Tab' }));
    expect(result.current.activeCell).toEqual(c1);
    act(() => result.current.navigateKeyboardCell(c1, { key: 'Tab' }));
    expect(result.current.activeCell).toEqual(a2);
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: a1, extent: c2 });

    act(() => result.current.navigateKeyboardCell(a2, { key: 'Tab', shift: true }));
    expect(result.current.activeCell).toEqual(c1);
    act(() => result.current.navigateKeyboardCell(c1, { key: 'Tab' }));
    expect(result.current.activeCell).toEqual(a2);
    act(() => result.current.navigateKeyboardCell(a2, { key: 'Tab' }));
    expect(result.current.activeCell).toEqual(b2);
    act(() => result.current.navigateKeyboardCell(b2, { key: 'Tab' }));
    expect(result.current.activeCell).toEqual(c2);
    act(() => result.current.navigateKeyboardCell(c2, { key: 'Tab' }));
    expect(result.current.activeCell).toEqual(a1);
    act(() => result.current.navigateKeyboardCell(a1, { key: 'Tab', shift: true }));
    expect(result.current.activeCell).toEqual(c2);
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: a1, extent: c2 });
  });

  it.each([
    ['rows', 'Tab', 'B2', 'A2'],
    ['columns', 'Enter', 'B2', 'B1'],
  ] as const)('collapses a whole-%s selection to a cell when Shift+%s traverses', (mode, key, from, expected) => {
    const { result, sheet } = renderCellEditing();
    const start = cellTargetAt(sheet, from)!;
    const destination = cellTargetAt(sheet, expected)!;

    act(() => result.current.selectAxis(mode, start, false));
    act(() => result.current.navigateKeyboardCell(start, { key, shift: true }));

    expect(result.current.activeCell).toEqual(destination);
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: destination, extent: destination });
    expect(result.current.keyboardFocusRequest).toMatchObject({ target: destination });
  });

  it('does not claim unsupported Alt keyboard navigation', () => {
    const { result, sheet } = renderCellEditing();
    const a1 = cellTargetAt(sheet, 'A1')!;
    act(() => result.current.selectCell(a1));

    expect(result.current.navigateKeyboardCell(a1, { key: 'Home', alt: true })).toBe(false);
    expect(result.current.activeCell).toEqual(a1);
  });

  describe('edit persistence', () => {
    it.each(['rows', 'columns'] as const)('settles text, formula and unchanged drafts before selecting %s', (mode) => {
      for (const [raw, draft] of [['', 'Region'], ['', '=SUM(B1:B2)'], ['', ''], ['Region', 'Region'], ['=SUM(B1:B2)', '=SUM(B1:B2)']]) {
        const input = sheetDocument({ id: 'header-drafts', name: 'Header drafts', cells: { A1: raw } });
        const { commands, result, sheet, unmount } = renderCellEditing(input);
        const a1 = cellTargetAt(sheet, 'A1')!;
        const b1 = cellTargetAt(sheet, 'B1')!;
        act(() => result.current.startEditingCell(a1, draft));
        const session = result.current.editingCell!;
        act(() => result.current.selectAxis(mode, b1, false));
        const writes = draft === raw ? 0 : 1;
        expect(commands.updateCellContent).toHaveBeenCalledTimes(writes);
        if (writes) expect(commands.updateCellContent).toHaveBeenCalledWith(sheet.id, 'A1', draft);
        expect(result.current.editingCell).toBeNull();
        expect(result.current.selectionRange).toEqual({ mode, anchor: b1, extent: b1 });
        act(() => result.current.commitActiveEdit(session));
        expect(commands.updateCellContent).toHaveBeenCalledTimes(writes);
        expect(result.current.selectionRange).toEqual({ mode, anchor: b1, extent: b1 });
        unmount();
      }
    });

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
      const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
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
        A1: 'left', B1: '=A1', B2: 'bottom', C2: 'outside',
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
      const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: { B1: 'top', B2: '=A1', C2: 'outside' } });
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
      const sheet = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: { A2: 'left', B2: '=A1', B1: 'outside' } });
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

    it('commits but does not navigate when the edited cell is removed before navigation', () => {
      const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
      const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
      const a1 = cellTargetAt(sheet, 'A1')!;
      const { rerender, result } = renderHook(
        ({ workbook }) => useCellEditing({ commands, workbook }),
        { initialProps: { workbook: workbookWithSheets([sheet]) } },
      );
      const session = { target: a1, draft: 'draft' };

      rerender({ workbook: workbookWithSheets([]) });
      act(() => result.current.commitEditAndNavigate(session, 'tab'));

      expect(commands.updateCellContent).not.toHaveBeenCalled();
      expect(result.current.activeCell).toBeNull();
      expect(result.current.editingCell).toBeNull();
    });

    it('uses the edited column when the tab-run origin column was removed', () => {
      const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
      const original = sheetDocument({ id: 'sheet-inputs', name: 'Inputs' });
      const a1 = cellTargetAt(original, 'A1')!;
      const b1 = cellTargetAt(original, 'B1')!;
      const revised = {
        ...original,
        content: { ...original.content, columns: original.content.columns.slice(1) },
      };
      const { rerender, result } = renderHook(
        ({ workbook }) => useCellEditing({ commands, workbook }),
        { initialProps: { workbook: workbookWithSheets([original]) } },
      );

      act(() => result.current.commitEditAndNavigate({ target: a1, draft: 'first' }, 'tab'));
      rerender({ workbook: workbookWithSheets([revised]) });
      act(() => result.current.commitEditAndNavigate({ target: b1, draft: 'second' }, 'enter'));

      expect(result.current.activeCell).toEqual({
        sheetId: revised.id,
        cell: { rowId: revised.content.rows[1], columnId: revised.content.columns[0] },
      });
    });
  });
});
