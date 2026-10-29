import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { decodeStoredFormula } from '@workbook/formula/storedFormula';
import { prepareCellInput } from './cellInputPreparation';

const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
const workbook = workbookWithSheets([sheet]);

describe('fresh cell input preparation', () => {
  it('treats even a complete stored formula spelling as fresh formula text', () => {
    const envelope = prepareCellInput('=@A[1]', workbook, sheet.id);
    const prepared = decodeStoredFormula(prepareCellInput(envelope, workbook, sheet.id));
    expect(prepared.text).toBe(envelope);
  });

  it('preserves malformed canonical-looking input', () => {
    const text = '=@foo-1[bad]+3';
    expect(decodeStoredFormula(prepareCellInput(text, workbook, sheet.id)).text).toBe(text);
  });

  it('encodes text while preserving typed scalars and blank input', () => {
    expect(prepareCellInput('hello', workbook, sheet.id)).toBe('"hello"');
    expect(prepareCellInput('"hello"', workbook, sheet.id)).toBe('"""hello"""');
    expect(prepareCellInput('42', workbook, sheet.id)).toBe('42');
    expect(prepareCellInput('TRUE', workbook, sheet.id)).toBe('TRUE');
    expect(prepareCellInput('', workbook, sheet.id)).toBe('');
  });
});
