import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { ModelColumnType, Workbook } from '@workbook/core/model';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { FormulaEvaluator } from './formulaEvaluator';
import { validRecordValues } from './recordValidation';

function records(type: ModelColumnType = 'int'): Workbook {
  const sheet = sheetDocument({ id: 'records', name: 'Records', rowCount: 3, columnCount: 2,
    cells: { A1: '2', A2: '4', B1: 'text', B2: 'TRUE' } });
  sheet.modelId = 'model';
  sheet.modelColumnBindings = { value: sheet.content.columns[0] };
  return { ...workbookWithSheets([sheet]), dataModels: { model: { id: 'model', name: 'Model', columns: [
    { id: 'value', name: 'Value', kind: 'manual', type },
  ] } } };
}

function valid(raw: string, type: ModelColumnType = 'int', workbook = records(type)): boolean {
  return validRecordValues(workbook, 'records', { value: raw.startsWith('=') ? prepareUserFormula(raw, workbook, 'records') : raw });
}

describe('detached record value validation with the shared formula engine', () => {
  it.each([
    ['int', '', true], ['int', '1e2', true], ['int', '1.5', false], ['int', '"1"', false],
    ['float', '1.5', true], ['float', '1e999', false], ['boolean', ' true ', true],
    ['boolean', '"true"', false], ['string', '"12"', true], ['string', '12', false],
    ['string', 'TRUE', false], ['string', ' ', true],
    ['int', '=1+2*3', true], ['int', '=-(1+2)/3', true], ['int', '=1/2', false],
    ['float', '=1/2', true], ['string', '="text"', true], ['string', '=""', true],
    ['boolean', '=1<2', true], ['boolean', '="x"="x"', true], ['int', '=TRUE', false],
    ['int', '=', false], ['int', '=1+', false], ['int', '=1/0', false], ['int', '=1e999', false],
    ['int', '=1+"2"', false], ['int', '=-TRUE', false], ['boolean', '=TRUE=1', false],
    ['int', '=UNKNOWN(1)', false], ['int', '=ABS()', false], ['int', '=ABS(1,2)', false],
    ['int', '=SQRT(-1)', false], ['int', '=SUM()', true], ['int', '=AVERAGE()', false],
    ['int', '=ABS(-2)+SQRT(4)', true], ['int', '=MIN(3,1)+MAX(2,4)', true],
    ['int', '=AVERAGE(2,4)', true], ['int', '=COUNT(2,"x",TRUE)', true], ['int', '=COUNTA(2,"",TRUE)', true],
    ['int', '=IF(TRUE,2,1/0)', true], ['int', '=IF(FALSE,1/0,2)', true],
    ['int', '=IFERROR(1/0,2)', false], ['int', '=IFERROR("text",2)', false],
    ['boolean', '=AND(TRUE,NOT(FALSE))', true], ['boolean', '=OR(TRUE,1/0)', true],
    ['int', '=SUM(@A[1]:A[3])', true], ['int', '=AVERAGE(@A[1]:A[3])', true],
    ['int', '=SUM(@B[1]:B[3])', true], ['int', '=@A[1]:A[3]', false],
    ['int', '=COUNTIF(@A[1]:A[3],">2")', true], ['int', '=SUMIF(@A[1]:A[3],">2")', true],
    ['int', '=AVERAGEIF(@A[1]:A[3],">2")', false], ['int', '=SUMIFS(@A[1]:A[3],@A[1]:A[3],">2")', false],
    ['int', '=COUNTIFS(@A[1]:A[3],">2")', false], ['int', '=AVERAGEIFS(@A[1]:A[3],@A[1]:A[3],">2")', false],
    ['int', '=@Value[1]', true], ['int', '=SUM(@Value[1]:Value[3])', true],
    ['int', '=@A[4]', false], ['int', '=@missing!A[1]', false], ['int', '=@A[3]', true],
  ] as const)('validates %s content %j as %s', (type, content, expected) => {
    expect(valid(content, type)).toBe(expected);
  });

  it('rejects malformed opaque content and noncanonical stored input rather than treating it as user text', () => {
    const workbook = records();
    for (const content of ['=~{not-hex}', '=~{1234', '=@A[1]', '=~{0041}+1']) {
      expect(validRecordValues(workbook, 'records', { value: content })).toBe(false);
    }
  });

  it('does not resolve opaque text or execute JavaScript source', () => {
    expect(valid('=globalThis.process.exit()', 'int')).toBe(false);
    expect(valid('="@A[1]"', 'string')).toBe(true);
  });

  it('validates only traversed dependencies, including typed transitive cells and cycles', () => {
    const workbook = records();
    const sheet = workbook.documents.records;
    const coordinate = (row: number) => cellIdentityKey({ rowId: sheet.content.rows[row], columnId: sheet.content.columns[0] });
    sheet.content.cells[coordinate(0)] = prepareUserFormula('=@A[2]*2', workbook, sheet.id);
    expect(valid('=@A[1]', 'int', workbook)).toBe(true);
    sheet.content.cells[coordinate(1)] = 'wrong type';
    expect(valid('=@A[1]', 'int', workbook)).toBe(false);
    expect(valid('=IF(TRUE,2,@A[1])', 'int', workbook)).toBe(true);
    sheet.content.cells[coordinate(1)] = prepareUserFormula('=@A[1]', workbook, sheet.id);
    expect(valid('=@A[1]', 'int', workbook)).toBe(false);
    expect(valid('=2', 'int', workbook)).toBe(true);
    sheet.content.cells[coordinate(1)] = '=~{invalid}';
    expect(valid('=@A[1]', 'int', workbook)).toBe(false);
  });

  it('preserves committed range membership and does not expose any submitted field as a target', () => {
    const workbook = records();
    const before = structuredClone(workbook);
    expect(valid('=SUM(@Value[1]:Value[3])', 'int', workbook)).toBe(true);
    expect(valid('=@Value[4]', 'int', workbook)).toBe(false);
    expect(valid('=SUM(@Value[1]:Value[4])', 'int', workbook)).toBe(false);
    expect(workbook).toEqual(before);
    workbook.documents.records.content.rows = [];
    workbook.documents.records.content.cells = {};
    expect(valid('=@A[1]', 'int', workbook)).toBe(false);
    expect(valid('=SUM()', 'int', workbook)).toBe(true);
  });

  it('follows cross-sheet canonical identities and validates named property identity', () => {
    const workbook = records();
    const source = sheetDocument({ id: 'source', name: 'Source', cells: { A1: '=2+3' } });
    workbook.documents.source = source;
    workbook.manifest.sheetIds.push(source.id);
    expect(valid('=@Source!A[1]', 'int', workbook)).toBe(true);
    const named = prepareUserFormula('=@Value[1]', workbook, 'records');
    workbook.documents.records.modelColumnBindings = {};
    expect(validRecordValues(workbook, 'records', { value: named })).toBe(false);
    delete workbook.documents.source;
    expect(valid('=@Source!A[1]', 'int', workbook)).toBe(false);
  });

  it('rejects absent model, extra and missing fields', () => {
    const workbook = records();
    expect(validRecordValues(workbook, 'records', {})).toBe(false);
    expect(validRecordValues(workbook, 'records', { other: '1' })).toBe(false);
    expect(validRecordValues(workbook, 'records', { value: '1', other: '2' })).toBe(false);
    expect(validRecordValues(workbook, 'missing', {})).toBe(false);
    delete workbook.dataModels;
    expect(validRecordValues(workbook, 'records', { value: '1' })).toBe(false);
    delete workbook.documents.records.modelId;
    expect(validRecordValues(workbook, 'records', { value: '1' })).toBe(false);
  });

  it('evaluates existing calculated properties with their declared types, but never accepts calculated draft writes', () => {
    const workbook = records();
    const sheet = workbook.documents.records;
    sheet.modelColumnBindings = { ...sheet.modelColumnBindings, output: sheet.content.columns[1] };
    workbook.dataModels = { model: { ...workbook.dataModels!.model, columns: [
      ...workbook.dataModels!.model.columns,
      { id: 'output', name: 'Output', kind: 'calculated', type: 'int', formula: '=@Value*2' },
    ] } };
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[1] });
    sheet.content.cells[key] = prepareUserFormula('=@Value[1]*2', workbook, 'records');
    expect(valid('=@Output[1]', 'int', workbook)).toBe(true);
    expect(validRecordValues(workbook, 'records', { value: '1', output: '2' })).toBe(false);
    sheet.content.cells[key] = '=1.5';
    expect(valid('=@Output[1]', 'int', workbook)).toBe(false);
  });

  it('never substitutes a submitted value for any existing record cell', () => {
    const workbook = records();
    const sheet = workbook.documents.records;
    sheet.modelColumnBindings = { ...sheet.modelColumnBindings, other: sheet.content.columns[1] };
    workbook.dataModels = { model: { ...workbook.dataModels!.model, columns: [
      ...workbook.dataModels!.model.columns, { id: 'other', name: 'Other', kind: 'manual', type: 'int' },
    ] } };
    const referencingCommittedText = prepareUserFormula('=@Other[1]', workbook, sheet.id);
    expect(validRecordValues(workbook, sheet.id, { value: referencingCommittedText, other: '2' })).toBe(false);
  });

  it('evaluates detached content without requiring a synthetic cell even through the default parser', () => {
    const evaluator = new FormulaEvaluator(calculationProjection(records()));
    expect(evaluator.evaluateExpressionContent('plain', 'records')).toEqual({ kind: 'error', error: '#PARSE!' });
    expect(evaluator.evaluateExpressionContent('=1', 'missing')).toEqual({ kind: 'error', error: '#REF!' });
    expect(evaluator.evaluateExpressionContent('=1', 'records')).toEqual({ kind: 'number', value: 1 });
  });
});
