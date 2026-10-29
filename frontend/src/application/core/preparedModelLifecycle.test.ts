import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { calculatedProperty, declaration, freshColumns, manualProperty, modelWorkbook } from '@test-support/modelLifecycleFixtures';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { modelFormulaDeclaration } from '@workbook/formula/preparedModelTemplate';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { bindPreparedSheet, refreshPreparedInstances, replacePreparedDeclaration, unbindPreparedSheet, type PreparedLifecycle } from './preparedModelLifecycle';

function success(result: ReturnType<typeof bindPreparedSheet>): PreparedLifecycle {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('prepared model lifecycle', () => {
  it('binds mixed declarations, preserves instances across insertion and renames, and re-prepares changed text', () => {
    const model = declaration([manualProperty('input', 'Input'), calculatedProperty('result', '=@A[$1]+@Missing!A[1]+@bad[', 'Result')]);
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2, cells: { A1: '3', A2: '7' } });
    const bound = success(bindPreparedSheet({ workbook: modelWorkbook(model, [sheet]), bindings: {} }, 'sheet', model.id, freshColumns()));
    const template = bound.bindings.sheet.result;
    expect(modelFormulaDeclaration(template)).toBe(model.columns[1].formula);
    const current = bound.workbook.documents.sheet;
    const reordered = { ...current, content: { ...current.content, rows: ['new', ...current.content.rows.slice().reverse()] } };
    const refreshed = refreshPreparedInstances({ ...bound, workbook: { ...bound.workbook, documents: { sheet: reordered } } }, bound.workbook);
    for (const [key, value] of Object.entries(current.content.cells)) expect(refreshed.workbook.documents.sheet.content.cells[key]).toBe(value);
    expect(refreshed.workbook.documents.sheet.content.cells[cellIdentityKey({ rowId: 'new', columnId: current.content.columns[1] })]).toBeDefined();
    const renamed = success(replacePreparedDeclaration(refreshed, { ...model, name: 'Renamed' }, freshColumns()));
    expect(renamed.bindings.sheet.result).toEqual(template);
    const changed = success(replacePreparedDeclaration(renamed, { ...model, columns: [model.columns[0], calculatedProperty('result', '=@A[1]*3', 'Result')] }, freshColumns()));
    expect(modelFormulaDeclaration(changed.bindings.sheet.result)).toBe('=@A[1]*3');
  });

  it('creates templates with zero rows, materializes appended rows, and freezes stored calculations', () => {
    const model = declaration([manualProperty('input', 'Input'), calculatedProperty('result', '=@A[1]*2', 'Result')]);
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 0, columnCount: 2 });
    const bound = success(bindPreparedSheet({ workbook: modelWorkbook(model, [sheet]), bindings: {} }, 'sheet', model.id, freshColumns()));
    const current = bound.workbook.documents.sheet;
    const input = cellIdentityKey({ rowId: 'row', columnId: current.content.columns[0] });
    const output = cellIdentityKey({ rowId: 'row', columnId: current.content.columns[1] });
    const appended = { ...current, content: { ...current.content, rows: ['row'], cells: { [input]: '5' } } };
    const refreshed = refreshPreparedInstances({ ...bound, workbook: { ...bound.workbook, documents: { sheet: appended } } }, bound.workbook);
    expect(refreshed.workbook.documents.sheet.content.cells[output]).toBeDefined();
    const unbound = success(unbindPreparedSheet(refreshed, 'sheet'));
    expect(unbound.workbook.documents.sheet.content.cells).toEqual({ [input]: '5', [output]: '10' });
  });

  it('retains deleted target identity through replacement and declaration rename', () => {
    const model = declaration([calculatedProperty('result', '=@Source!A[1]', 'Result')]);
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '4' } });
    const output = sheetDocument({ id: 'sheet', name: 'Output', rowCount: 1, columnCount: 1 });
    const bound = success(bindPreparedSheet({ workbook: modelWorkbook(model, [source, output]), bindings: {} }, 'sheet', model.id, freshColumns()));
    const replacement = sheetDocument({ id: 'replacement', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '9' } });
    const changed = { ...bound, workbook: { ...bound.workbook, documents: { sheet: bound.workbook.documents.sheet, replacement } } };
    const renamed = success(replacePreparedDeclaration(changed, { ...model, columns: [calculatedProperty('result', '=@Source!A[1]', 'Renamed')] }, freshColumns()));
    expect(renamed.bindings.sheet.result).toEqual(bound.bindings.sheet.result);
    expect(new FormulaCalculation().updateStored(calculationProjection(renamed.workbook), renamed.workbook, { kind: 'structure' }).sheet.A1).toMatchObject({ display: '#REF!' });
  });

  it('materializes relative and anchored range recipes for each output row', () => {
    const model = declaration([manualProperty('input', 'Input'), calculatedProperty('result', '=SUM(@A[$1]:A[1])', 'Result')]);
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 2, cells: { A1: '3', A2: '7' } });
    const bound = success(bindPreparedSheet({ workbook: modelWorkbook(model, [sheet]), bindings: {} }, 'sheet', model.id, freshColumns()));
    const result = new FormulaCalculation().updateStored(calculationProjection(bound.workbook), bound.workbook, { kind: 'structure' });
    expect(result.sheet.B1).toMatchObject({ value: 3 });
    expect(result.sheet.B2).toMatchObject({ value: 10 });
  });

  it('freezes calculated-to-manual conversion without changing unrelated stored content', () => {
    const model = declaration([manualProperty('input', 'Input'), calculatedProperty('result', '=@A[1]*2', 'Result')]);
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '5' } });
    const bound = success(bindPreparedSheet({ workbook: modelWorkbook(model, [sheet]), bindings: {} }, 'sheet', model.id, freshColumns()));
    const converted = success(replacePreparedDeclaration(bound, { ...model, columns: [model.columns[0], manualProperty('result', 'Result')] }, freshColumns()));
    expect(Object.values(converted.workbook.documents.sheet.content.cells)).toEqual(['5', '10']);
    expect(converted.bindings.sheet).toEqual({});
  });
});
