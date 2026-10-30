import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { prepareCellInput } from './cellInputPreparation';

const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
const workbook = workbookWithSheets([sheet]);

describe('fresh cell input preparation', () => {
  it('treats even a complete stored formula spelling as fresh formula text', () => {
    const stored = prepareCellInput('=@A[1]', workbook, sheet.id);
    const prepared = prepareCellInput(stored, workbook, sheet.id);
    expect(projectStoredFormula(prepared, workbook, sheet.id).text).toBe(stored);
  });

  it('preserves malformed canonical-looking input', () => {
    const text = '=@foo-1[bad]+3';
    expect(projectStoredFormula(prepareCellInput(text, workbook, sheet.id), workbook, sheet.id).text).toBe(text);
  });

  it('validates persisted formulas and preserves their bytes for an unchanged draft', () => {
    const original = prepareCellInput('=@A[1]', workbook, sheet.id);
    expect(prepareCellInput('=@A[1]', workbook, sheet.id, original)).toBe(original);
    expect(() => prepareCellInput('=2', workbook, sheet.id, '=~{bad}')).toThrow('Invalid stored formula');
  });

  it('encodes text while preserving typed scalars and blank input', () => {
    expect(prepareCellInput('hello', workbook, sheet.id)).toBe('"hello"');
    expect(prepareCellInput('"hello"', workbook, sheet.id)).toBe('"""hello"""');
    expect(prepareCellInput('42', workbook, sheet.id)).toBe('42');
    expect(prepareCellInput('TRUE', workbook, sheet.id)).toBe('TRUE');
    expect(prepareCellInput('', workbook, sheet.id)).toBe('');
  });
});
