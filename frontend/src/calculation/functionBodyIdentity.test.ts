import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { reconcileFunctionBodyBinding, setCustomFunction } from './customFunctions';
import { analyzeFunctionBody } from '@workbook/formula/functionBodyAnalysis';
import { FormulaCalculation } from './formulaCalculation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import type { CustomFunction, Workbook } from '@workbook/core/model';

const definition = (body: string): CustomFunction => ({ name: 'value', parameters: [], body });
function save(workbook: Workbook, body: string, previousName?: string): Workbook {
  const result = setCustomFunction(workbook, definition(body), previousName);
  if (!result.ok) throw new Error(result.error);
  return result.workbook;
}

describe('committed function body identities', () => {
  it('reconciles long editable bodies for multiple caller sheets without losing middle identities', () => {
    const first = sheetDocument({ id: 'first', name: 'First', cells: { A1: '2', A2: '9' } });
    const second = sheetDocument({ id: 'second', name: 'Second', cells: { A1: '3', A2: '8' } });
    const padding = 'x'.repeat(50000);
    let workbook = save(workbookWithSheets([first, second]), `=1+${padding}+@A[1]+${padding}+1`);
    const bindings = workbook.functions![0].bodyBindings!;
    workbook = { ...workbook, documents: Object.fromEntries(Object.entries(workbook.documents).map(([id, sheet]) => [id, { ...sheet, content: { ...sheet.content, rows: [sheet.content.rows[1], sheet.content.rows[0], ...sheet.content.rows.slice(2)] } }])) };
    workbook = save(workbook, `=2+${padding}+@A[1]+${padding}+2`, 'value');
    for (const id of ['first', 'second']) {
      const oldRef = bindings[id].match(/@[a-zA-Z0-9:]+/);
      expect(oldRef).not.toBeNull();
      expect(workbook.functions![0].bodyBindings![id]).toContain(oldRef![0]);
    }
  });
  it('preserves a moved middle reference across disjoint edits in both live and replay binding paths', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '1', A2: '10', B1: '2', B2: '20', C1: '3', C2: '30', D1: '=value()' } });
    let workbook = save(workbookWithSheets([sheet]), '=@A[1]+@B[1]+@C[1]');
    const previous = workbook.functions![0];
    const reordered = { ...sheet, content: { ...sheet.content, rows: [sheet.content.rows[1], sheet.content.rows[0], ...sheet.content.rows.slice(2)] } };
    workbook = { ...workbook, documents: { first: reordered } };
    const next = definition('=@A[2]+@B[1]+@C[2]');
    const replay = reconcileFunctionBodyBinding(workbook, 'first', previous, previous.bodyBindings!.first, next);
    workbook = save(workbook, next.body, 'value');
    expect(replay).toBe(workbook.functions![0].bodyBindings!.first);
    expect(new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' }).first.D2).toMatchObject({ kind: 'number', value: 6 });
  });
  it('preserves unchanged references through a body edit and binds deliberate replacements anew', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '2', A2: '9', B1: '=value()' } });
    let workbook = save(workbookWithSheets([sheet]), '=@A[1]+1');
    const reordered = { ...sheet, content: { ...sheet.content, rows: [sheet.content.rows[1], sheet.content.rows[0], ...sheet.content.rows.slice(2)] } };
    workbook = { ...workbook, documents: { first: reordered } };
    workbook = save(workbook, '=@A[1]+2', 'value');
    const calculation = new FormulaCalculation();
    expect(calculation.update(calculationProjection(workbook), { kind: 'structure' }).first.B2).toMatchObject({ kind: 'number', value: 4 });
    workbook = save(workbook, '=@A[2]+2', 'value');
    expect(calculation.update(calculationProjection(workbook), { kind: 'none' }).first.B2).toMatchObject({ kind: 'number', value: 4 });
    workbook = save(workbook, '=@A[1]+2', 'value');
    expect(calculation.update(calculationProjection(workbook), { kind: 'none' }).first.B2).toMatchObject({ kind: 'number', value: 11 });
  });

  it('uses committed sheet identity for diagnostics after rename, reuse and deletion', () => {
    const first = sheetDocument({ id: 'first', name: 'First', cells: { A1: '=value()' } });
    const target = sheetDocument({ id: 'target', name: 'Target', cells: { A1: '3' } });
    let workbook = save(workbookWithSheets([first, target]), '=@Target!A[1]');
    const replacement = sheetDocument({ id: 'replacement', name: 'Target', cells: { A1: '8' } });
    workbook = { ...workbook, documents: { first, target: { ...target, name: 'Renamed' }, replacement } };
    const analysis = () => analyzeFunctionBody(workbook.functions![0], workbook, 'first');
    expect(analysis().diagnostics).toEqual([]);
    expect(new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' }).first.A1).toMatchObject({ kind: 'number', value: 3 });
    workbook = save(workbook, '=@Target!A[1]+1', 'value');
    expect(new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' }).first.A1).toMatchObject({ kind: 'number', value: 4 });
    workbook = { ...workbook, documents: { first, replacement } };
    expect(analysis().diagnostics).toContainEqual(expect.objectContaining({ code: '#REF!' }));
    expect(new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' }).first.A1).toMatchObject({ error: '#REF!' });
  });

  it('retains column and row identity through reordering and rejects deleted targets', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '3', B1: '7', C1: '=value()' } });
    let workbook = save(workbookWithSheets([sheet]), '=@A[1]');
    const reordered = { ...sheet, content: { ...sheet.content, columns: [sheet.content.columns[1], sheet.content.columns[0], ...sheet.content.columns.slice(2)] } };
    workbook = { ...workbook, documents: { first: reordered } };
    const calculate = () => new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' }).first.C1;
    expect(calculate()).toMatchObject({ kind: 'number', value: 3 });
    workbook = { ...workbook, documents: { first: { ...reordered, content: { ...reordered.content, columns: reordered.content.columns.filter((id) => id !== sheet.content.columns[0]) } } } };
    expect(analyzeFunctionBody(workbook.functions![0], workbook, 'first').diagnostics).toContainEqual(expect.objectContaining({ code: '#REF!' }));
    expect(new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' }).first.B1).toMatchObject({ error: '#REF!' });
  });

  it('does not rebind missing committed sheet bindings and can correct malformed bodies', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '=value()', B1: '5' } });
    let workbook = save(workbookWithSheets([sheet]), '=SUM(');
    workbook = save(workbook, '=@B[1]', 'value');
    expect(new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' }).first.A1).toMatchObject({ kind: 'number', value: 5 });
    workbook = { ...workbook, functions: [{ ...workbook.functions![0], bodyBindings: {} }] };
    expect(new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' }).first.A1).toMatchObject({ error: '#REF!' });
  });
});
