import { describe, expect, it } from 'vitest';
import { FormulaCalculation } from './formulaCalculation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { commitCellRawContent } from '@workbook/mutations/operations';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { CustomFunction, Workbook } from '@workbook/core/model';
import { setCustomFunction } from './customFunctions';

const fn = (name: string, body: string): CustomFunction => ({ name, body, parameters: [] });
const number = (value: number) => ({ kind: 'number', value });

describe('function calculation dependencies', () => {
  it('retains committed body row identity after reordering', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '2', A2: '9', B1: '=value()' } });
    const result = setCustomFunction(workbookWithSheets([sheet]), fn('value', '=@A[1]'));
    if (!result.ok) throw new Error(result.error);
    const calculation = new FormulaCalculation();
    expect(calculation.update(calculationProjection(result.workbook), { kind: 'structure' }).first.B1).toMatchObject(number(2));
    const reordered = { ...sheet, content: { ...sheet.content, rows: [sheet.content.rows[1], sheet.content.rows[0], ...sheet.content.rows.slice(2)] } };
    const workbook = { ...result.workbook, documents: { first: reordered } };
    expect(calculation.update(calculationProjection(workbook), { kind: 'structure' }).first.B2).toMatchObject(number(2));
  });

  it('tracks nested bound dependencies after a row moves and reports its deletion', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '2', A2: '9', B2: '=outer()', C2: '=@B[2]+1' } });
    let workbook = workbookWithSheets([sheet]);
    workbook = commitCellRawContent(workbook, 'first', 'C2', '=@B[2]+1');
    for (const definition of [fn('inner', '=@A[1]'), fn('outer', '=inner()')]) {
      const result = setCustomFunction(workbook, definition);
      if (!result.ok) throw new Error(result.error);
      workbook = result.workbook;
    }
    const calculation = new FormulaCalculation();
    expect(calculation.update(calculationProjection(workbook), { kind: 'structure' }).first.C2).toMatchObject(number(3));
    const committedSheet = workbook.documents.first;
    const reordered = { ...committedSheet, content: { ...committedSheet.content, rows: [sheet.content.rows[1], sheet.content.rows[0], ...sheet.content.rows.slice(2)] } };
    workbook = { ...workbook, documents: { first: reordered } };
    expect(calculation.update(calculationProjection(workbook), { kind: 'structure' }).first.C1).toMatchObject(number(3));
    workbook = commitCellRawContent(workbook, 'first', 'A2', '5');
    expect(calculation.update(calculationProjection(workbook), { kind: 'cells', cells: [{ sheetId: 'first', key: 'A2' }] }).first.C1).toMatchObject(number(6));
    const current = workbook.documents.first;
    workbook = { ...workbook, documents: { first: { ...current, content: { ...current.content, rows: current.content.rows.filter((id) => id !== sheet.content.rows[0]) } } } };
    expect(calculation.update(calculationProjection(workbook), { kind: 'structure' }).first.B1).toMatchObject({ error: '#REF!' });
  });
  it('recalculates transitive body references and downstream callers after source edits', () => {
    let workbook: Workbook = { ...workbookWithSheets([sheetDocument({ id: 'first', name: 'First', cells: { A1: '2', B1: '=outer()', C1: '=@B[1]+1' } }), sheetDocument({ id: 'second', name: 'Second', cells: { A1: '5' } })]), functions: [fn('outer', '=inner()'), fn('inner', '=@A[1]+@Second!A[1]')] };
    const calculation = new FormulaCalculation();
    expect(calculation.update(calculationProjection(workbook), { kind: 'structure' }).first.C1).toMatchObject(number(8));
    workbook = commitCellRawContent(workbook, 'second', 'A1', '9');
    expect(calculation.update(calculationProjection(workbook), { kind: 'cells', cells: [{ sheetId: 'second', key: 'A1' }] }).first.C1).toMatchObject(number(12));
  });

  it('invalidates cached values for definition creation, correction, rename and deletion, including forks', () => {
    const source = workbookWithSheets([sheetDocument({ id: 'first', name: 'First', cells: { A1: '=foo()', B1: '=@A[1]+1' } })]);
    const calculation = new FormulaCalculation();
    const update = (functions: CustomFunction[]) => calculation.update(calculationProjection({ ...source, functions }), { kind: 'none' }).first;
    expect(update([]).A1).toMatchObject({ error: '#NAME!' });
    expect(update([fn('foo', '=SUM(')]).A1).toMatchObject({ error: '#PARSE!' });
    expect(update([fn('foo', '=4')]).B1).toMatchObject(number(5));
    const fork = calculation.fork();
    expect(update([fn('bar', '=4')]).A1).toMatchObject({ error: '#NAME!' });
    expect(fork.update(calculationProjection({ ...source, functions: [fn('foo', '=6')] }), { kind: 'none' }).first.B1).toMatchObject(number(7));
    expect(update([]).A1).toMatchObject({ error: '#NAME!' });
  });

  it('detects structural cycles inside bodies without blocking lazy recursion', () => {
    const workbook = { ...workbookWithSheets([sheetDocument({ id: 'first', name: 'First', cells: { A1: '=cycle()', B1: '=safe()' } })]), functions: [fn('cycle', '=@A[1]'), fn('safe', '=IF(FALSE,safe(),7)')] };
    const result = new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' }).first;
    expect(result.A1).toMatchObject({ error: '#CYCLE!' });
    expect(result.B1).toMatchObject(number(7));
  });

  it('tracks argument references and supplies definitions to stored calculations', () => {
    let workbook: Workbook = { ...workbookWithSheets([sheetDocument({ id: 'first', name: 'First', cells: { A1: '2', B1: '=identity(@A[1])' } })]), functions: [{ name: 'identity', body: '=@x', parameters: [{ name: 'x', type: 'int' }] }] };
    workbook = commitCellRawContent(workbook, 'first', 'B1', '=identity(@A[1])');
    const calculation = new FormulaCalculation();
    const projection = () => ({ sheets: calculationProjection(workbook).sheets });
    expect(calculation.updateStored(projection(), workbook, { kind: 'structure' }).first.B1).toMatchObject(number(2));
    workbook = commitCellRawContent(workbook, 'first', 'A1', '3');
    expect(calculation.updateStored(projection(), workbook, { kind: 'cells', cells: [{ sheetId: 'first', key: 'A1' }] }).first.B1).toMatchObject(number(3));
  });

  it('recalculates order-sensitive ranges in nested bodies on row reorder', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '1', A2: '2', A3: '4', B1: '=outer()' } });
    const workbook = { ...workbookWithSheets([sheet]), functions: [fn('outer', '=inner()'), fn('inner', '=SUM(@A[1]:A[2])')] };
    const calculation = new FormulaCalculation();
    expect(calculation.update(calculationProjection(workbook), { kind: 'structure' }).first.B1).toMatchObject(number(3));
    const reordered = { ...sheet, content: { ...sheet.content, rows: [sheet.content.rows[2], sheet.content.rows[1], sheet.content.rows[0], ...sheet.content.rows.slice(3)] } };
    const next = { ...workbook, documents: { ...workbook.documents, first: reordered } };
    expect(calculation.update(calculationProjection(next), { kind: 'structure' }).first.B3).toMatchObject(number(6));
  });
});

it('tracks nested named and positional references across insertion, rename, reuse and deletion', () => {
  const source = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 2, cells: { A1: '2', A2: '9', B1: '40' } });
  const output = sheetDocument({ id: 'o', name: 'Output', cells: { A1: '=outer()', B1: '=@A[1]+1' } });
  let workbook = workbookWithSheets([{ ...source, columnNames: { 's:column:1': 'Price' } }, output]);
  workbook = commitCellRawContent(workbook, 'o', 'B1', '=@A[1]+1');
  for (const definition of [fn('inner', '=@Source!Price[1]+@Source!Price[#1]'), fn('outer', '=inner()')]) {
    const result = setCustomFunction(workbook, definition);
    if (!result.ok) throw new Error(result.error);
    workbook = result.workbook;
  }
  const calculation = new FormulaCalculation();
  const update = () => calculation.update(calculationProjection(workbook), { kind: 'structure' }).o;
  expect(update().B1).toMatchObject(number(5));
  const current = workbook.documents.s;
  workbook = { ...workbook, documents: { ...workbook.documents, s: { ...current, columnNames: { 's:column:1': 'Cost', 's:column:2': 'Price' }, content: { ...current.content, rows: ['s:inserted', ...current.content.rows] } } } };
  workbook = commitCellRawContent(workbook, 's', 'A1', '7');
  expect(update().B1).toMatchObject(number(10));
  workbook = commitCellRawContent(workbook, 's', 'A2', '5');
  expect(calculation.update(calculationProjection(workbook), { kind: 'cells', cells: [{ sheetId: 's', key: 'A2' }] }).o.B1).toMatchObject(number(13));
  const renamed = workbook.documents.s;
  workbook = { ...workbook, documents: { ...workbook.documents, s: { ...renamed, content: { ...renamed.content, columns: renamed.content.columns.slice(1) } } } };
  expect(update().A1).toMatchObject({ error: '#REF!' });
});
