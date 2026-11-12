import { expect } from 'vitest';
import type { DataModel, Workbook } from '@workbook/core/model';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { instantiateModelFormula } from '@workbook/formula/modelTemplate';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { appendModelEntry } from '@application/core/modelRowAppend';
import { settleSorting } from '@application/core/settleSorting';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { sheetDocument, workbookWithSheets } from './workbookFactories';

export function calculatedDeletionScenario() {
  const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2, cells: { A1: '9', A2: '5' } });
  const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 2, columnCount: 2, cells: { A1: '2', A2: '1' } });
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 5, columnCount: 1, cells: { A1: '10', A2: '20', A3: '30' } });
  const model: DataModel = { id: 'model', name: 'Model', columns: [
    { id: 'input', name: 'Input', kind: 'manual', type: 'float' },
    { id: 'output', name: 'Output', kind: 'calculated', type: 'float', formula: '=@Source!A[1]*2' },
  ] };
  const bound = bindSheetToModel({ ...workbookWithSheets([sheet, other, source]), dataModels: { model } }, 'sheet', 'model', () => 'unused');
  if (!bound.ok) throw new Error(bound.reason);
  const rowId = 'tail-record';
  const atTail = appendModelEntry(bound.value, 'sheet', 'model', rowId, { input: '2' });
  expect(atTail.documents.sheet!.content.rows.slice(-1)).toEqual([rowId]);
  const formulaKey = cellIdentityKey({ rowId, columnId: sheet.content.columns[1]! });
  const formula = atTail.documents.sheet!.content.cells[formulaKey]!;
  expect(formula).toContain('source:row:3');
  const sorted = settle({ ...atTail, documents: { ...atTail.documents, sheet: { ...atTail.documents.sheet!,
    sorting: [{ columnId: sheet.content.columns[0]!, direction: 'ascending' }],
  } } });
  expect(sorted.documents.sheet!.content.rows[0]).toBe(rowId);
  expect(instantiateModelFormula(sorted.documents.sheet!.modelFormulaBindings!.output!, sorted, 0, '=@Source!A[1]*2', 'sheet')).not.toBe(formula);
  const admissionAfter = structuredClone(sorted);
  const second = appendModelEntry(sorted, 'sheet', 'model', 'later-record', { input: '7' });
  const target = second.documents.sheet!;
  const initial: Workbook = { ...second, documents: { ...second.documents, sheet: { ...target,
    sorting: [{ columnId: sheet.content.columns[0]!, direction: 'descending' }],
    content: { ...target.content, cells: { ...target.content.cells, [cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! })]: '17' } },
    presentation: { ...target.presentation, rowHeights: { [rowId]: 48 }, formatOverrides: { rows: {}, columns: {}, cells: { [formulaKey]: { fontWeight: 'bold' } } } },
  }, other: { ...other, sorting: [{ columnId: other.content.columns[1]!, direction: 'ascending' }], content: { ...other.content, cells: { ...other.content.cells,
    [cellIdentityKey({ rowId: other.content.rows[0]!, columnId: other.content.columns[1]! })]: prepareUserFormula('=@A[#1]', second, 'other'),
    [cellIdentityKey({ rowId: other.content.rows[1]!, columnId: other.content.columns[1]! })]: prepareUserFormula('=@A[#2]', second, 'other'),
  } } } } };
  expect(initial).not.toEqual(admissionAfter);
  expect(initial.documents.sheet!.content.cells[formulaKey]).toBe(formula);
  return { initial, admissionAfter, rowId, formulaKey, formula };
}

export function settle(workbook: Workbook) {
  return settleSorting(workbook, new FormulaCalculation(), { kind: 'structure' }).workbook;
}
