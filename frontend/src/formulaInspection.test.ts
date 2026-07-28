import { describe, expect, it } from 'vitest';
import { inspectFormula } from './formulaInspection';
import { createSheet, type Sheet, type Workbook } from './workbook';

function sheet(id: string, name: string, cells: Record<string, string> = {}): Sheet {
  const result = createSheet({ id, name });
  if (!result.ok) {
    throw new Error(`Failed to create test sheet ${name}`);
  }
  return { ...result.value, cells };
}

function workbook(sheets: Sheet[]): Workbook {
  return { version: 1, sheets };
}

describe('formula inspection', () => {
  it('preserves raw formula spelling and exposes repeated same-sheet cells and ranges', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');
    const result = inspectFormula('= sUm(A1, A1:B2) + A1', workbook([inputs]), inputs);

    expect(result?.raw).toBe('= sUm(A1, A1:B2) + A1');
    expect(result?.parts.map((part) => part.text).join('')).toBe(result?.raw);
    expect(result?.references).toHaveLength(3);
    expect(result?.references.map((reference) => reference.text)).toEqual(['A1', 'A1:B2', 'A1']);
    expect(result?.references.map((reference) => reference.target)).toEqual([
      {
        kind: 'cell',
        sheetId: 'sheet-inputs',
        address: { columnIndex: 0, rowIndex: 0 },
      },
      {
        kind: 'range',
        sheetId: 'sheet-inputs',
        range: {
          start: { columnIndex: 0, rowIndex: 0 },
          end: { columnIndex: 1, rowIndex: 1 },
        },
      },
      {
        kind: 'cell',
        sheetId: 'sheet-inputs',
        address: { columnIndex: 0, rowIndex: 0 },
      },
    ]);
    expect(result?.references.every((reference) => reference.navigable)).toBe(true);
  });

  it('renders current quoted sheet names while retaining canonical ids and translated spans', () => {
    const outputs = sheet('sheet-outputs', 'Outputs');
    const source = sheet('sheet-source', "Owner's Plan");
    const canonicalRaw = '=SUM(sheet-source!A1, sheet-source!B2:C3)';
    const initial = inspectFormula(canonicalRaw, workbook([outputs, source]), outputs);
    const renamedSource = { ...source, name: 'Sales Q1' };
    const renamed = inspectFormula(canonicalRaw, workbook([outputs, renamedSource]), outputs);

    expect(initial?.raw).toBe("=SUM('Owner''s Plan'!A1, 'Owner''s Plan'!B2:C3)");
    expect(initial?.references.map((reference) => reference.text)).toEqual([
      "'Owner''s Plan'!A1",
      "'Owner''s Plan'!B2:C3",
    ]);
    expect(renamed?.raw).toBe("=SUM('Sales Q1'!A1, 'Sales Q1'!B2:C3)");
    expect(renamed?.references.map((reference) => reference.target.sheetId)).toEqual([
      'sheet-source',
      'sheet-source',
    ]);
    for (const reference of renamed?.references ?? []) {
      expect(renamed?.raw.slice(reference.displaySpan.start, reference.displaySpan.end))
        .toBe(reference.text);
      expect(canonicalRaw.slice(reference.sourceSpan.start, reference.sourceSpan.end))
        .toMatch(/^sheet-source!/);
    }
  });

  it('marks deleted-sheet and out-of-bounds targets broken without discarding identity', () => {
    const outputs = sheet('sheet-outputs', 'Outputs');
    const missing = inspectFormula(
      '=sheet-deleted!A1',
      workbook([outputs]),
      outputs,
    );
    const outOfBounds = inspectFormula(
      '=A21 + K1',
      workbook([outputs]),
      outputs,
    );

    expect(missing?.raw).toBe('=#REF!A1');
    expect(missing?.references[0]).toMatchObject({
      text: '#REF!A1',
      target: { kind: 'cell', sheetId: 'sheet-deleted' },
      broken: true,
      navigable: false,
    });
    expect(outOfBounds?.references.map((reference) => ({
      text: reference.text,
      broken: reference.broken,
      navigable: reference.navigable,
    }))).toEqual([
      { text: 'A21', broken: true, navigable: false },
      { text: 'K1', broken: true, navigable: false },
    ]);
  });

  it('keeps references inspectable in formulas with evaluation errors', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');

    expect(inspectFormula('=1 / A1', workbook([inputs]), inputs)?.references[0].text).toBe('A1');
    expect(inspectFormula('=UNKNOWN(A1)', workbook([inputs]), inputs)?.references[0].text).toBe('A1');
  });

  it('degrades safely for non-formulas and keeps valid malformed-formula references inspectable', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');
    const model = workbook([inputs]);

    expect(inspectFormula('A1', model, inputs)).toBeUndefined();
    const malformed = inspectFormula('=SUM(A1,)', model, inputs);
    expect(malformed?.raw).toBe('=SUM(A1,)');
    expect(malformed?.references).toMatchObject([{
      text: 'A1',
      sourceSpan: { start: 5, end: 7 },
      displaySpan: { start: 5, end: 7 },
    }]);
    expect(malformed?.parts.map((part) => part.text).join('')).toBe(malformed?.raw);
  });

  it('inspects and translates references after an earlier syntax error', () => {
    const outputs = sheet('sheet-outputs', 'Outputs');
    const source = sheet('sheet-source', 'Renamed Source');
    const result = inspectFormula(
      '=SUM(A1,) + sheet-source!B2 + #REF!C3',
      workbook([outputs, source]),
      outputs,
    );

    expect(result?.raw).toBe("=SUM(A1,) + 'Renamed Source'!B2 + #REF!C3");
    expect(result?.references.map((reference) => ({
      text: reference.text,
      sheetId: reference.target.sheetId,
      broken: reference.broken,
    }))).toEqual([
      { text: 'A1', sheetId: 'sheet-outputs', broken: false },
      { text: "'Renamed Source'!B2", sheetId: 'sheet-source', broken: false },
      { text: '#REF!C3', sheetId: '#REF', broken: true },
    ]);
  });
});
