import { describe, expect, it } from 'vitest';
import {
  cellRawContent,
  parseNamedA1Address,
  parseNamedA1Range,
  sheetsInOrder,
  tabularCellsByA1,
} from '@workbook/read/queries';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('workbook read queries', () => {
  const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 2, columnCount: 2, cells: { A1: 'one' } });
  const output = sheetDocument({ id: 'output', name: 'Output Sheet', rowCount: 2, columnCount: 2 });
  const workbook = workbookWithSheets([inputs, output]);

  it('reads cell content only for extant coordinates and reuses A1 projections', () => {
    expect(cellRawContent(inputs, 'A1')).toBe('one');
    expect(cellRawContent(inputs, 'C3')).toBeUndefined();

    const danglingIdentity = 'missing-row\u0000missing-column';
    const malformedContent = {
      ...inputs.content,
      cells: { ...inputs.content.cells, [danglingIdentity]: 'discarded' },
    };
    const first = tabularCellsByA1(malformedContent);

    expect(first).toEqual({ A1: 'one' });
    expect(tabularCellsByA1(malformedContent)).toBe(first);
  });

  it('preserves manifest order while skipping missing sheet documents', () => {
    const missingMiddle = {
      ...workbook,
      manifest: { ...workbook.manifest, sheetIds: ['output', 'gone', 'inputs'] },
    };

    expect(sheetsInOrder(missingMiddle)).toEqual([output, inputs]);
  });

  it('parses named cell and range references across explicit, quoted, and default sheets', () => {
    expect(parseNamedA1Address(' A2 ', workbook, inputs)).toEqual({
      ok: true,
      value: { rowIndex: 1, columnIndex: 0, sheetName: undefined },
    });
    expect(parseNamedA1Address("'Output Sheet'!B1", workbook)).toEqual({
      ok: true,
      value: { rowIndex: 0, columnIndex: 1, sheetName: 'Output Sheet' },
    });
    expect(parseNamedA1Range('Inputs!A1:B2', workbook)).toEqual({
      ok: true,
      value: {
        start: { rowIndex: 0, columnIndex: 0 },
        end: { rowIndex: 1, columnIndex: 1 },
        sheetName: 'Inputs',
      },
    });
  });

  it.each([
    ['A1', 'unknown-sheet'],
    ['!A1', 'invalid-format'],
    ['Inputs!', 'invalid-format'],
    ["'!A1", 'invalid-format'],
    ['Missing!A1', 'unknown-sheet'],
    ['Inputs!C1:C1', 'out-of-bounds'],
  ] as const)('reports %s reference failures', (reference, reason) => {
    expect(parseNamedA1Range(reference, workbook)).toEqual({ ok: false, reason });
  });
});
