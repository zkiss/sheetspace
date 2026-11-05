import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { decodeWorkbookBundle, encodeWorkbookBundle } from '@infrastructure/persistence/workbookApi';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { cellRawContent } from '@workbook/read/queries';
import { useWorkbookController } from './useWorkbookController';

it('retains positional recipes through history and transport reload', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1, cells: { A1: '1', A2: '2', A3: '4' } });
  const output = sheetDocument({ id: 'o', name: 'Output', rowCount: 1, columnCount: 5 });
  const mounted = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([source, output]) }));
  act(() => {
    mounted.result.current.commands.updateCellContent('o', 'A1', '=@Source!A[1]');
    mounted.result.current.commands.updateCellContent('o', 'B1', '=@Source!A[#$1]');
    mounted.result.current.commands.updateCellContent('o', 'C1', '=SUM(@Source!A[1]:A[#2])');
    mounted.result.current.commands.updateCellContent('o', 'D1', '=@B[1]+1');
    mounted.result.current.commands.updateCellContent('o', 'E1', '=@Source!A[#9]');
  });
  const calculation = new FormulaCalculation();
  const values = () => {
    const workbook = mounted.result.current.workbook;
    return calculation.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o;
  };
  expect(values()).toMatchObject({ A1: { value: 1 }, B1: { value: 1 }, C1: { value: 3 }, D1: { value: 2 }, E1: { display: '#REF!' } });
  const stored = cellRawContent(mounted.result.current.workbook.documents.o!, 'E1');
  act(() => mounted.result.current.commands.shiftAxis('s', 'row', [source.content.rows[0]!], 1));
  expect(values()).toMatchObject({ A1: { value: 1 }, B1: { value: 2 }, C1: { value: 1 }, D1: { value: 3 } });
  act(() => mounted.result.current.commands.undo());
  expect(values()).toMatchObject({ B1: { value: 1 }, C1: { value: 3 }, D1: { value: 2 } });
  act(() => mounted.result.current.commands.redo());
  expect(values()).toMatchObject({ B1: { value: 2 }, C1: { value: 1 }, D1: { value: 3 } });
  const loaded = decodeWorkbookBundle(encodeWorkbookBundle(mounted.result.current.workbook));
  expect(cellRawContent(loaded.documents.o!, 'E1')).toBe(stored);
  mounted.unmount();
  const reloaded = renderHook(() => useWorkbookController({ initialWorkbook: loaded }));
  act(() => reloaded.result.current.commands.shiftAxis('s', 'row', [source.content.rows[1]!], 1));
  const workbook = reloaded.result.current.workbook;
  expect(new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }).o)
    .toMatchObject({ A1: { value: 1 }, B1: { value: 1 }, D1: { value: 2 }, E1: { display: '#REF!' } });
  expect(cellRawContent(workbook.documents.o!, 'E1')).toBe(stored);
});
