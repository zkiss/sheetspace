import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from '@grid/cellInteraction';
import { positionedSheet, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useCellEditing } from '@grid/useCellEditing';
import { encodeCellTextLiteral } from '@workbook/core/cellLiteral';

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
  it.each(['=1+2', '123', 'TRUE', '', '\u001eSheetspace:text:"nested"'])('edits frozen text %j without exposing storage quoting or executing an unchanged draft', (text) => {
    const sheet = sheetDocument({ id: 'literal', name: 'Literal', cells: { A1: encodeCellTextLiteral(text) } });
    const { result, commands } = renderCellEditing(sheet);
    act(() => result.current.startEditingCell(cellTargetAt(sheet, 'A1')!));
    expect(result.current.editingCell?.draft).toBe(text);
    act(() => result.current.commitActiveEdit());
    expect(commands.updateCellContent).not.toHaveBeenCalled();
  });

  it('replaces a suspended cell draft when typing deliberately starts a new edit', () => {
    const { result, sheet } = renderCellEditing();
    const a1 = cellTargetAt(sheet, 'A1')!;

    act(() => {
      result.current.startEditingCell(a1, 'suspended draft');
      result.current.navigateCell(a1, 'right');
      result.current.startEditingCell(a1, 'x');
    });

    expect(result.current.editingCell).toMatchObject({ target: a1, draft: 'x' });
  });

  it('restores complete stable ranges and clears selections whose identities disappeared', () => {
    const { result, sheet } = renderCellEditing();
    const a1 = cellTargetAt(sheet, 'A1')!;
    const b2 = cellTargetAt(sheet, 'B2')!;
    const savedRange = { mode: 'rows' as const, anchor: a1, extent: b2 };

    act(() => { expect(result.current.restoreSelection(savedRange)).toBe(true); });
    expect(result.current.selectionRange).toEqual(savedRange);

    const missing = { ...savedRange, extent: { ...b2, cell: { ...b2.cell, rowId: 'deleted-row' } } };
    act(() => { expect(result.current.restoreSelection(missing)).toBe(false); });
    expect(result.current.selectionRange).toBeNull();
  });

  it('transfers an active direct draft and its view to a fresh rich-panel session', () => {
    const { result, sheet } = renderCellEditing();
    const a1 = cellTargetAt(sheet, 'A1')!;

    act(() => {
      result.current.startEditingCell(a1, 'direct draft');
      result.current.updateEditingCellView({ start: 2, end: 8 }, 24);
      result.current.startEditingCell(a1);
    });

    expect(result.current.editingCell).toMatchObject({ target: a1, draft: 'direct draft', selection: { start: 2, end: 8 }, scrollTop: 24 });
  });

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
    const populated = sheetDocument({ id: 'navigation', name: 'Navigation', cells: { A1: 'first', B1: '=@A[1]', C1: 'last' } });
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


  describe('commit navigation', () => {
    it('ignores all callbacks from an older session reopened for the same target', () => {
      const { commands, result, sheet } = renderCellEditing();
      const a1 = cellTargetAt(sheet, 'A1')!;

      act(() => result.current.startEditingCell(a1, 'older draft'));
      const olderSession = result.current.editingCell!;
      act(() => result.current.startEditingCell(a1, 'newer draft'));
      const newerSession = result.current.editingCell!;

      act(() => {
        result.current.commitActiveEdit(olderSession);
        result.current.suspendActiveEdit(olderSession);
        result.current.commitEditAndNavigate(olderSession, 'tab');
      });

      expect(commands.updateCellContent).not.toHaveBeenCalled();
      expect(result.current.editingCell).toEqual(newerSession);
      expect(result.current.activeCell).toEqual(a1);
    });

    it.each([
      ['Tab', { key: 'Tab' as const, shift: true }, 'A2'],
      ['Enter', { key: 'Enter' as const, shift: true }, 'B1'],
    ])('commits with Shift+%s without expanding a single-cell selection', (_key, request, expectedKey) => {
      const { commands, result, sheet } = renderCellEditing();
      const b2 = cellTargetAt(sheet, 'B2')!;
      const expected = cellTargetAt(sheet, expectedKey)!;
      act(() => result.current.selectCell(b2));
      act(() => result.current.startEditingCell(b2, 'revised'));
      const session = result.current.editingCell!;
      act(() => result.current.commitEditAndNavigate(session, request));

      expect(commands.updateCellContent).toHaveBeenCalledWith(sheet.id, 'B2', session.draft);
      expect(result.current.activeCell).toEqual(expected);
      expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: expected, extent: expected });
    });

    it('preserves a settled pointer range through editing and Tab traversal', () => {
      const { commands, result, sheet } = renderCellEditing();
      const a1 = cellTargetAt(sheet, 'A1')!;
      const c1 = cellTargetAt(sheet, 'C1')!;
      const owner = Symbol('pointer');

      act(() => result.current.selectCell(a1, { owner, start: true }));
      act(() => result.current.extendSelection(c1, { owner }));
      act(() => result.current.settleSelectionGesture(owner));
      act(() => result.current.startEditingCell(c1, 'pointer draft'));
      act(() => result.current.commitEditAndNavigate(result.current.editingCell!, 'tab'));

      expect(commands.updateCellContent).toHaveBeenCalledWith(sheet.id, 'C1', 'pointer draft');
      expect(result.current.activeCell).toEqual(a1);
      expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: a1, extent: c1 });
    });

    it('commits with Tab and selects the adjacent cell to the right', () => {
      const { commands, result, sheet } = renderCellEditing();
      const a1 = cellTargetAt(sheet, 'A1')!;
      const b1 = cellTargetAt(sheet, 'B1')!;
      act(() => result.current.startEditingCell(a1, 'Region'));
      const session = result.current.editingCell!;
      act(() => result.current.commitEditAndNavigate(session, 'tab'));

      expect(commands.updateCellContent).toHaveBeenCalledWith(sheet.id, 'A1', session.draft);
      expect(result.current.activeCell).toEqual(b1);
      expect(result.current.editingCell).toBeNull();
      expect(result.current.keyboardFocusRequest).toMatchObject({ target: b1 });
    });

    it('commits with Enter and selects the adjacent cell below in the same column', () => {
      const { commands, result, sheet } = renderCellEditing();
      const b1 = cellTargetAt(sheet, 'B1')!;
      const b2 = cellTargetAt(sheet, 'B2')!;
      act(() => result.current.startEditingCell(b1, 'Value'));
      const session = result.current.editingCell!;
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

      act(() => result.current.startEditingCell(a1, 'First'));
      act(() => result.current.commitEditAndNavigate(result.current.editingCell!, 'tab'));
      expect(result.current.activeCell).toEqual(b1);

      act(() => result.current.startEditingCell(b1, 'Second'));
      act(() => result.current.commitEditAndNavigate(result.current.editingCell!, 'enter'));

      expect(commands.updateCellContent).toHaveBeenNthCalledWith(1, sheet.id, 'A1', 'First');
      expect(commands.updateCellContent).toHaveBeenNthCalledWith(2, sheet.id, 'B1', 'Second');
      expect(result.current.activeCell).toEqual(a2);
      expect(result.current.keyboardFocusRequest).toMatchObject({ target: a2 });
    });

    it('does not write from a stale editor after its target is removed', () => {
      const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
      const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
      const a1 = cellTargetAt(sheet, 'A1')!;
      const { rerender, result } = renderHook(
        ({ workbook }) => useCellEditing({ commands, workbook }),
        { initialProps: { workbook: workbookWithSheets([sheet]) } },
      );
      act(() => result.current.startEditingCell(a1, 'draft'));
      const session = result.current.editingCell!;

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

      act(() => result.current.startEditingCell(a1, 'first'));
      act(() => result.current.commitEditAndNavigate(result.current.editingCell!, 'tab'));
      rerender({ workbook: workbookWithSheets([revised]) });
      act(() => result.current.startEditingCell(b1, 'second'));
      act(() => result.current.commitEditAndNavigate(result.current.editingCell!, 'enter'));

      expect(result.current.activeCell).toEqual({
        sheetId: revised.id,
        cell: { rowId: revised.content.rows[1], columnId: revised.content.columns[0] },
      });
    });
  });
});
