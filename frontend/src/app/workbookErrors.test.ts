import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
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
});
