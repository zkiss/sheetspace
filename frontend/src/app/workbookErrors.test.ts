import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithLegacyFormulaFixtures, workbookWithSheets } from '@test-support/workbookFactories';
import { errorTrace, workbookErrors } from './workbookErrors';
import { formulaDiagnostic, type FormulaDiagnostic } from '@calculation/formulaValue';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { formulaRawForDisplay, formulaReferenceTokens } from '@workbook/formula/reference';

describe('workbook errors', () => {
  it('shares a bounded graph for layered converging cycle dependencies and projects every edge', () => {
    const cells: Record<string, string> = { A1: '=@A[1]' };
    for (let row = 2; row <= 22; row++) {
      cells[`A${row}`] = `=@A[${row - 1}]+@B[${row - 1}]`;
      cells[`B${row}`] = `=@A[${row - 1}]+@B[${row - 1}]`;
    }
    cells.B1 = '=@A[1]';
    const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 22, columnCount: 2, cells });
    const workbook = workbookWithSheets([sheet]);
    const snapshot = new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' });
    const root = formulaDiagnostic(snapshot.s.A22)!;
    const graph = root.structural!.graph;
    expect(formulaDiagnostic(snapshot.s.B22)!.structural!.graph).toBe(graph);
    expect(graph.nodes.size).toBe(44);
    const edges = [...graph.nodes.values()].reduce((sum, node) => sum + node.dependencies.length, 0);
    expect(edges).toBe(86);
    const lines = errorTrace(workbook, root);
    expect(lines.length).toBeLessThanOrEqual(edges + 1);
    expect(lines.some((line) => line.message.startsWith('Already shown:') && line.target)).toBe(true);
    expect(lines.some((line) => line.message.startsWith('Cycle reference:') && line.target)).toBe(true);
  });

  it('projects dense cycles from every root with navigable cycle and shared references', () => {
    const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 4, columnCount: 1, cells: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`A${i + 1}`, '=SUM(@A[1]:A[4])'])) });
    const workbook = workbookWithSheets([sheet]);
    const snapshot = new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' });
    const diagnostics = Object.values(snapshot.s).map((value) => formulaDiagnostic(value)!);
    const graph = diagnostics[0].structural!.graph;
    expect(graph.nodes.size).toBe(4);
    expect([...graph.nodes.values()].reduce((sum, node) => sum + node.dependencies.length, 0)).toBe(16);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.structural!.graph).toBe(graph);
      const lines = errorTrace(workbook, diagnostic);
      expect(lines).toHaveLength(17);
      expect(new Set(lines.map((line) => line.target?.cell.rowId)).size).toBe(4);
      expect(lines.some((line) => line.message.startsWith('Cycle reference:'))).toBe(true);
      expect(lines.every((line) => line.target)).toBe(true);
    }
  });

  it('projects shared evaluated causes and long chains iteratively', () => {
    const sheet = sheetDocument({ id: 's', name: 'Sheet' });
    const workbook = workbookWithSheets([sheet]);
    const leaf: FormulaDiagnostic = { message: 'leaf', causes: [] };
    const branch: FormulaDiagnostic = { message: 'branch', causes: [leaf] };
    const shared: FormulaDiagnostic = { message: 'root', causes: [branch, branch] };
    expect(errorTrace(workbook, shared).map((line) => line.message)).toEqual(['root', 'branch', 'leaf', 'Already shown: branch']);
    let chain = leaf;
    for (let i = 0; i < 10000; i++) chain = { message: 'step', causes: [chain] };
    expect(errorTrace(workbook, chain)).toHaveLength(10001);
  });

  it('retains old cycle graphs in snapshots and forks after correction', () => {
    const sheet = sheetDocument({ id: 's', name: 'Sheet', cells: { A1: '=@B[1]', B1: '=@A[1]' } });
    const workbook = workbookWithSheets([sheet]);
    const calculation = new FormulaCalculation();
    const original = calculation.update(calculationProjection(workbook), { kind: 'structure' });
    const fork = calculation.fork();
    const diagnostic = formulaDiagnostic(original.s.A1)!;
    const before = errorTrace(workbook, diagnostic);
    const corrected = structuredClone(workbook);
    const key = Object.keys(corrected.documents.s.content.cells)[0];
    corrected.documents.s.content.cells[key] = '1';
    const next = calculation.update(calculationProjection(corrected), { kind: 'structure' });
    expect(next.s.B1.kind).not.toBe('error');
    expect(errorTrace(workbook, formulaDiagnostic(original.s.A1)!)).toEqual(before);
    expect(formulaDiagnostic(fork.update(calculationProjection(workbook), { kind: 'none' }).s.A1)!.structural!.graph).toBe(diagnostic.structural!.graph);
  });
  it('disambiguates positional labels from named columns and round trips references', () => {
    const sheet = sheetDocument({ id: 's', name: 'Sheet', columnCount: 2 });
    sheet.columnNames = { [sheet.content.columns[1]]: 'A' };
    const workbook = workbookWithSheets([sheet]);
    const errors = workbookErrors(workbook, { s: { A1: { kind: 'error', error: '#REF!', display: '#REF!' }, B1: { kind: 'error', error: '#REF!', display: '#REF!' } } });
    expect(errors.map((error) => error.reference)).toEqual(['@Sheet!%A[1]', '@Sheet!A[1]']);
    for (const error of errors) {
      const stored = prepareUserFormula(`=${error.reference}`, workbook, 's');
      expect(formulaReferenceTokens(stored)[0].endpoints[0]).toMatchObject({ kind: 'canonical', coordinate: error.cell });
      expect(formulaRawForDisplay(stored, workbook, 's')).toBe(`=${error.reference}`);
    }
  });
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

  it('disambiguates positional references from model property names', () => {
    const sheet = sheetDocument({ id: 'bound', name: 'Bound', rowCount: 1, columnCount: 2, cells: { A1: '1' } });
    const workbook = { ...workbookWithSheets([sheet]), dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'input', name: 'Input', kind: 'manual' as const, type: 'float' as const }, { id: 'other', name: 'A', kind: 'manual' as const, type: 'float' as const }] } } };
    const bound = bindSheetToModel(workbook, 'bound', 'model', () => 'new-column');
    if (!bound.ok) throw new Error('Could not bind model');
    // An unbound third column can coexist with the model's named columns.
    bound.value.documents.bound.content.columns.unshift('extra-column');
    const [error] = workbookErrors(bound.value, { bound: { A1: { kind: 'error', error: '#REF!', display: '#REF!' } } });
    expect(error.reference).toBe('@Bound!%A[1]');
    expect(formulaReferenceTokens(prepareUserFormula(`=${error.reference}`, bound.value, 'bound'))[0].endpoints[0]).toMatchObject({ kind: 'canonical', coordinate: error.cell });
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
