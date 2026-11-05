import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cellTargetAt } from '@grid/cellInteraction';
import { useCellEditing } from '@grid/useCellEditing';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('selection settlement ownership', () => {
  it('advances only the initiating lease across attributed pruning', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2 });
    const before = workbookWithSheets([sheet]);
    const after = workbookWithSheets([{ ...sheet, content: { ...sheet.content, rows: sheet.content.rows.slice(1) } }]);
    let current = before;
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result, rerender } = renderHook(({ workbook }) => useCellEditing({ commands, workbook, currentWorkbook: () => current }), { initialProps: { workbook: before } });
    act(() => result.current.selectCell(cellTargetAt(sheet, 'A1')!));
    const token = result.current.beginSelectionSettlement();
    const revision = result.current.interactionRevision();
    act(() => {
      current = after;
      result.current.reconcileSelectionPublication(token, before, after);
    });
    expect(result.current.interactionRevision()).toBeGreaterThan(revision);
    expect(result.current.ownsSelectionSettlement(token)).toBe(true);
    rerender({ workbook: after });
    expect(result.current.ownsSelectionSettlement(token)).toBe(true);
    act(() => result.current.selectCell(cellTargetAt(sheet, 'B2')!));
    expect(result.current.ownsSelectionSettlement(token)).toBe(false);
  });

  it('does not revive superseded or cancelled leases', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const old = result.current.beginSelectionSettlement();
    const current = result.current.beginSelectionSettlement();
    act(() => result.current.reconcileSelectionPublication(old, workbook, workbook));
    expect(result.current.ownsSelectionSettlement(old)).toBe(false);
    expect(result.current.ownsSelectionSettlement(current)).toBe(true);
    result.current.cancelSelectionSettlement(current);
    expect(result.current.ownsSelectionSettlement(current)).toBe(false);
  });

  it('does not forgive an unrendered unrelated pruning when attributing a later publication', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2 });
    const before = workbookWithSheets([sheet]);
    const unrelated = workbookWithSheets([{ ...sheet, content: { ...sheet.content, rows: sheet.content.rows.slice(1) } }]);
    let current = before;
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result } = renderHook(() => useCellEditing({ commands, workbook: before, currentWorkbook: () => current }));
    act(() => result.current.selectCell(cellTargetAt(sheet, 'A1')!));
    const token = result.current.beginSelectionSettlement();
    current = unrelated;
    act(() => result.current.reconcileSelectionPublication(token, unrelated, unrelated));
    expect(result.current.ownsSelectionSettlement(token)).toBe(false);
  });

  it('does not revive a lease after selection moves away and back', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const first = cellTargetAt(sheet, 'A1')!;
    act(() => result.current.selectCell(first));
    const token = result.current.beginSelectionSettlement();
    act(() => {
      result.current.selectCell(cellTargetAt(sheet, 'B2')!);
      result.current.selectCell(first);
      result.current.reconcileSelectionPublication(token, workbook, workbook);
    });
    expect(result.current.ownsSelectionSettlement(token)).toBe(false);
  });

  it('restores a selection against the live rollback before the rollback renders', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2 });
    const before = workbookWithSheets([sheet]);
    const after = workbookWithSheets([{ ...sheet, content: { ...sheet.content, rows: [] } }]);
    let current = before;
    const commands = { updateCellContent: vi.fn(), writeCells: vi.fn() };
    const { result, rerender } = renderHook(({ workbook }) => useCellEditing({ commands, workbook, currentWorkbook: () => current }), { initialProps: { workbook: before } });
    act(() => result.current.selectCell(cellTargetAt(sheet, 'A1')!));
    const selection = result.current.selectionRange;
    current = after;
    rerender({ workbook: after });
    expect(result.current.selectionRange).toBeNull();
    current = before;
    act(() => { expect(result.current.restoreSelection(selection)).toBe(true); });
    expect(result.current.selectionRange).toEqual(selection);
  });
});
