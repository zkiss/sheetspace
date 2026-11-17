import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { openCellInput, prepareCellInputMode } from './cellInputPreparation';

const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 });
const workbook = workbookWithSheets([sheet]);
const prepare = (text: string, mode: Parameters<typeof prepareCellInputMode>[1]) => prepareCellInputMode(text, mode, workbook, sheet.id);

describe('cell input modes', () => {
  it.each(['hello', '03/04/2026', '  hello\n"world"  '])('preserves Auto and Text provenance for %s', (text) => {
    for (const mode of ['auto', 'text'] as const) {
      const result = prepare(text, mode);
      expect(result.ok).toBe(true);
      if (result.ok) expect(openCellInput(result.raw, workbook, sheet.id)).toEqual({ text, mode });
    }
  });
  it.each(['"hello"', '@date:bad', '@datetime:bad', '@date:2024-02-29'])('escapes untrusted storage spelling %s', (text) => {
    const result = prepare(text, 'auto');
    expect(result.ok).toBe(true);
    if (result.ok) expect(openCellInput(result.raw, workbook, sheet.id)).toEqual({ text, mode: 'text' });
  });
  it.each([
    ['2024/02/29', 'auto', '@date:2024-02-29'],
    ['2024-02-29T12:34:56.123400000', 'datetime', '@datetime:2024-02-29 12:34:56.123400000'],
    ['03/04/2026', 'auto', '03/04/2026'],
    ['2024-02-29', 'text', '"2024-02-29"'],
    ['=1+2', 'text', '"=1+2"'],
    ['@date:2024-02-29', 'auto', '"@date:2024-02-29"'],
    ['', 'date', ''],
  ] as const)('prepares %s as %s', (text, mode, raw) => {
    expect(prepare(text, mode)).toEqual({ ok: true, raw });
  });

  it.each([
    ['2023-02-29', 'auto'], ['03/04/2026', 'date'], ['2024-02-29 12:30', 'date'],
    ['2024-02-29T12:30Z', 'datetime'], ['2024-02-29T12:30+01:00', 'datetime'],
    ['2024-02-29 12:30:00.1234567890', 'datetime'],
  ] as const)('rejects %s in %s with a corrective message', (text, mode) => {
    expect(prepare(text, mode)).toMatchObject({ ok: false, message: expect.stringContaining('YYYY-MM-DD') });
  });

  it('opens typed and literal values without exposing storage', () => {
    expect(openCellInput('@datetime:2024-02-29 12:30:01.001000000', workbook, sheet.id))
      .toEqual({ text: '2024-02-29 12:30:01.001000000', mode: 'datetime' });
    expect(openCellInput('"2024-02-29"', workbook, sheet.id)).toEqual({ text: '2024-02-29', mode: 'text' });
    expect(openCellInput('"=1+2"', workbook, sheet.id)).toEqual({ text: '=1+2', mode: 'text' });
    expect(openCellInput('"42"', workbook, sheet.id)).toEqual({ text: '42', mode: 'text' });
    expect(openCellInput('"hello"', workbook, sheet.id)).toEqual({ text: 'hello', mode: 'text' });
    expect(openCellInput('42', workbook, sheet.id)).toEqual({ text: '42', mode: 'auto' });
  });
});
