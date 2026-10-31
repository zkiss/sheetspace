import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithLegacyFormulaFixtures, workbookWithSheets } from '@test-support/workbookFactories';
import { workbookErrors } from './workbookErrors';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { calculationProjection } from '@workbook/read/calculationProjection';

describe('workbook errors', () => {
  it('collects typed errors across sheets in workbook order with current names and stable identities', () => {
    const first = sheetDocument({ id: 'a', name: "Bob's sheet", rowCount: 50 });
    first.columnNames = { [first.content.columns[1]]: 'Net profit' };
    const second = sheetDocument({ id: 'b', name: 'Other' });
    const workbook = workbookWithSheets([first, second]);
    const rows = workbookErrors(workbook, {
      a: { B40: { kind: 'error', error: '#DIV/0!', display: '#DIV/0!' }, A1: { kind: 'text', value: '#REF!', display: '#REF!' }, Z99: { kind: 'error', error: '#REF!', display: '#REF!' } },
      b: { A1: { kind: 'error', error: '#REF!', display: '#REF!' } },
    });
    expect(rows.map((row) => row.reference)).toEqual(["@'Bob''s sheet'!'Net profit'[40]", '@Other!A[1]']);
    expect(rows[0]).toMatchObject({ code: '#DIV/0!', text: 'Division by zero', cell: { rowId: first.content.rows[39], columnId: first.content.columns[1] } });
    const reordered = { ...first, name: 'Renamed', content: { ...first.content, rows: [...first.content.rows].reverse() } };
    const updated = workbookErrors(workbookWithSheets([reordered]), { a: { B11: { kind: 'error', error: '#DIV/0!', display: '#DIV/0!' } } });
    expect(updated[0].key).toBe(rows[0].key);
    expect(updated[0].reference).toBe("@Renamed!'Net profit'[11]");
    expect(workbookErrors(workbook, {})).toEqual([]);
  });

  it('includes calculated model errors from generated cells', () => {
    const sheet = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 2, columnCount: 2, cells: { A1: '1', A2: '2' } });
    const workbook = { ...workbookWithSheets([sheet]), dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'input', name: 'Input', kind: 'manual' as const, type: 'float' as const }, { id: 'total', name: 'Total', kind: 'calculated' as const, type: 'float' as const, formula: '=1/0' }] } } };
    const bound = bindSheetToModel(workbook, 'bound', 'model', () => 'new-column');
    expect(bound.ok).toBe(true);
    if (!bound.ok) throw new Error('Could not bind model');
    const results = new FormulaCalculation().updateStored(calculationProjection(bound.value), bound.value, { kind: 'structure' });
    expect(workbookErrors(bound.value, results).map((error) => error.reference)).toEqual(['@Bound!Total[1]', '@Bound!Total[2]']);
  });

  it('tracks identities through inserted, reordered and deleted rows and columns using fresh evaluations', () => {
    const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 3, columnCount: 3, cells: { B2: '=1/0', C3: '=1/0' } });
    const original = workbookWithLegacyFormulaFixtures([sheet]);
    const evaluate = (workbook: typeof original) => workbookErrors(workbook, new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }));
    const before = evaluate(original);
    const changed = structuredClone(original);
    const content = changed.documents.s.content;
    content.rows = ['inserted-row', ...content.rows.slice(1)];
    content.columns = [content.columns[2], 'inserted-column', content.columns[1]];
    const moved = evaluate(changed);
    expect(moved.map((error) => [error.key, error.reference])).toEqual([[before[0].key, '@Sheet!C[2]'], [before[1].key, '@Sheet!A[3]']]);
    content.rows = content.rows.filter((id) => id !== before[0].cell.rowId);
    content.columns = content.columns.filter((id) => id !== before[1].cell.columnId);
    expect(evaluate(changed)).toEqual([]);
    expect(evaluate(original).map((error) => error.key)).toEqual(before.map((error) => error.key));
  });

  it('refreshes after correction and restores the same identity on undo and removes it on redo', () => {
    const original = workbookWithLegacyFormulaFixtures([sheetDocument({ id: 's', name: 'Sheet', cells: { A1: '=1/0' } })]);
    const corrected = structuredClone(original);
    const key = Object.keys(corrected.documents.s.content.cells)[0];
    corrected.documents.s.content.cells[key] = '42';
    const evaluate = (workbook: typeof original) => workbookErrors(workbook, new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }));
    const error = evaluate(original)[0];
    expect(evaluate(corrected)).toEqual([]);
    expect(evaluate(original)[0].key).toBe(error.key);
    expect(evaluate(corrected)).toEqual([]);
  });
});
