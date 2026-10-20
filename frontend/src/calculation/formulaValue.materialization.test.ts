import { describe, expect, it } from 'vitest';
import { encodeCellTextLiteral, decodeCellTextLiteral } from '@workbook/core/cellLiteral';
import { formulaRawForStorage } from '@workbook/formula/reference';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { FormulaCalculation } from './formulaCalculation';
import { classifyCellValue, displayFormulaValue, displayRawCellValue, materializeFormulaValue, type FormulaScalarValue } from './formulaValue';

describe('ordinary materialized formula results', () => {
  it.each(['=1+2', '001.50', 'TRUE', 'false', '', "'text", '\u001eSheetspace:text:"nested"', ' a\n"b"\u0000 '])('round-trips exact text %j without interpreting it', (text) => {
    const raw = materializeFormulaValue({ kind: 'text', value: text });

    expect(raw.startsWith('=')).toBe(false);
    expect(classifyCellValue(raw)).toEqual({ kind: 'text', value: text });
    expect(displayRawCellValue(raw).display).toBe(text);
    expect(decodeCellTextLiteral(raw)).toBe(text);
    expect(JSON.parse(JSON.stringify(raw))).toBe(raw);
  });

  it.each<FormulaScalarValue>([
    { kind: 'number', value: Math.PI }, { kind: 'number', value: -0 },
    { kind: 'number', value: Number.MIN_VALUE }, { kind: 'number', value: Number.MAX_VALUE },
    { kind: 'boolean', value: true }, { kind: 'boolean', value: false }, { kind: 'blank' },
  ])('preserves underlying scalar $kind independently of formatting', (value) => {
    const formatted = displayFormulaValue(value, { kind: 'percent', precision: 0 });
    const raw = materializeFormulaValue(formatted);

    expect(classifyCellValue(raw)).toEqual(value);
  });

  it('freezes visible error codes as text rather than active errors', () => {
    const raw = materializeFormulaValue({ kind: 'error', error: '#DIV/0!' });

    expect(classifyCellValue(raw)).toEqual({ kind: 'text', value: '#DIV/0!' });
  });

  it('does not execute frozen text after storage canonicalization, reload or recalculation', () => {
    const frozen = materializeFormulaValue({ kind: 'text', value: '=@B[1]+1' });
    const sheet = sheetDocument({ id: 'one', name: 'One', cells: { A1: frozen, B1: '4', C1: '=@A[1]' } });
    const workbook = JSON.parse(JSON.stringify(workbookWithSheets([sheet])));
    expect(formulaRawForStorage(frozen, workbook, 'one')).toBe(frozen);
    const result = new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' });

    expect(result.one.A1).toBeUndefined();
    expect(result.one.C1).toEqual({ kind: 'text', value: '=@B[1]+1', display: '=@B[1]+1' });
  });

  it('leaves ordinary inputs and malformed reserved envelopes unchanged', () => {
    for (const raw of ['ordinary', '\u001eSheetspace:text:not-json', '\u001eSheetspace:text:4']) {
      expect(decodeCellTextLiteral(raw)).toBeUndefined();
      expect(classifyCellValue(raw)).toEqual({ kind: 'text', value: raw });
    }
    expect(classifyCellValue("'001")).toEqual({ kind: 'text', value: "'001" });
    expect(classifyCellValue('001')).toEqual({ kind: 'number', value: 1 });
    expect(classifyCellValue('true')).toEqual({ kind: 'boolean', value: true });
    expect(encodeCellTextLiteral('=1')).not.toContain('="');
  });
});
