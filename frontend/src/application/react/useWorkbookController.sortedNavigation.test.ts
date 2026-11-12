import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { cellAddressOf, cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { inspectStoredFormula } from '../../reference-navigation/formulaInspection';
import { useReferenceNavigation } from '../../reference-navigation/useReferenceNavigation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

it('inspects and navigates a stable reference at its final position after a sorted edit and replay', () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 2, cells: { A1: '1', A2: '2' } });
  const target = cellIdentityAt(sheet.content, 'A1')!;
  const formulaCell = cellIdentityAt(sheet.content, 'B1')!;
  const initial = workbookWithSheets([{ ...sheet, sorting: [{ columnId: sheet.content.columns[0]!, direction: 'ascending' }] }]);
  const formula = prepareUserFormula('=@A[1]', initial, sheet.id);
  const document = initial.documents.s!;
  const workbook = { ...initial, documents: { ...initial.documents, s: { ...document, content: { ...document.content, cells: { ...document.content.cells, [cellIdentityKey(formulaCell)]: formula } } } } };
  const select = vi.fn();
  const { result } = renderHook(() => {
    const controller = useWorkbookController({ initialWorkbook: workbook });
    const navigation = useReferenceNavigation({ workbook: controller.workbook, onSelectReferenceTarget: select, navigateToTarget: () => () => {} });
    return { controller, navigation };
  });

  function expectReferenceAt(rowIndex: number) {
    const current = result.current.controller.workbook;
    const currentSheet = current.documents.s!;
    expect(currentSheet.content.cells[cellIdentityKey(formulaCell)]).toBe(formula);
    const inspection = inspectStoredFormula(formula, current, currentSheet)!;
    expect(inspection.raw).toBe(`=@A[${rowIndex + 1}]`);
    const reference = inspection.references[0]!;
    expect(reference.target).toEqual({ kind: 'cell', sheetId: 's', identity: target });
    act(() => { expect(result.current.navigation.navigateReference(reference)).toBe(true); });
    const selected = select.mock.lastCall![0];
    expect(selected).toEqual({ kind: 'cell', target: { sheetId: 's', cell: target } });
    expect(cellAddressOf(currentSheet.content, selected.target.cell)).toEqual({ columnIndex: 0, rowIndex });
  }

  expectReferenceAt(0);
  act(() => { result.current.controller.commands.updateCellContent('s', 'A1', '5'); });
  expectReferenceAt(1);
  act(() => result.current.controller.commands.undo());
  expectReferenceAt(0);
  act(() => result.current.controller.commands.redo());
  expectReferenceAt(1);
});
