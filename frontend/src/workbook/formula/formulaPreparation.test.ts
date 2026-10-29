import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { Workbook } from '../core/model';
import { prepareUserFormula } from './formulaPreparation';
import { decodeStoredFormula, encodeStoredFormula, type FormulaOccurrence } from './storedFormula';

const sheet = sheetDocument({ id: 'inputs-id', name: 'Inputs', rowCount: 2, columnCount: 2 });
const workbook = workbookWithSheets([sheet]);
const slotTargets = (occurrence: FormulaOccurrence) => occurrence.slots.map(({ targetIds }) => targetIds);

function modeledWorkbook(): Workbook {
  return {
    ...workbook,
    documents: { [sheet.id]: { ...sheet, modelId: 'model', modelColumnBindings: { cost: sheet.content.columns[1] } } },
    dataModels: { model: { id: 'model', name: 'Model', columns: [{ id: 'cost', name: 'Cost', kind: 'manual', type: 'float' }] } },
  };
}

describe('fresh formula preparation', () => {
  it('preserves one exact text and binds independent complete references in invalid expressions', () => {
    const text = '=@Inputs!A[1]+@Missing!B[2]+@A[0]+???+@B[2]';

    const stored = decodeStoredFormula(prepareUserFormula(text, workbook, sheet.id));

    expect(stored.text).toBe(text);
    expect(stored.occurrences.map(slotTargets)).toEqual([
      [[sheet.id], [sheet.content.columns[0]], [sheet.content.rows[0]]],
      [[], [], []],
      [[sheet.id], [sheet.content.columns[1]], [sheet.content.rows[1]]],
    ]);
    expect(stored.occurrences.map(({ guard }) => text.slice(guard.start, guard.end))).toEqual(['@Inputs!A[1]', '@Missing!B[2]', '@B[2]']);
  });

  it('resolves explicit names without a current sheet, never sheet ID spelling', () => {
    const text = '=@Inputs!A[1]+@inputs-id!A[1]+@A[1]';

    const stored = decodeStoredFormula(prepareUserFormula(text, workbook));

    expect(stored.occurrences.map(slotTargets)).toEqual([
      [[sheet.id], [sheet.content.columns[0]], [sheet.content.rows[0]]],
      [[], [], []], [[], [], []],
    ]);
  });

  it('retains independently resolved axes when the other axis is outside the grid', () => {
    const stored = decodeStoredFormula(prepareUserFormula('=@A[3]+@C[1]', workbook, sheet.id));

    expect(stored.occurrences.map(slotTargets)).toEqual([
      [[sheet.id], [sheet.content.columns[0]], []],
      [[sheet.id], [], [sheet.content.rows[0]]],
    ]);
  });

  it('captures original range endpoint order, separate anchors and component origins', () => {
    const text = '=@Inputs!$B[$2]:A[1]';

    const stored = decodeStoredFormula(prepareUserFormula(text, workbook, sheet.id));

    expect(stored.occurrences[0].endpoints).toEqual([
      { id: 'e0', columnSlotId: 'c0', rowSlotId: 'r0', anchors: { column: true, row: true } },
      { id: 'e1', columnSlotId: 'c1', rowSlotId: 'r1', anchors: { column: false, row: false } },
    ]);
    expect(stored.occurrences[0].origins.filter(({ slotId }) => slotId !== null).map(({ start, end, slotId }) => [slotId, text.slice(start, end)])).toEqual([
      ['sheet', 'Inputs'], ['c0', 'B'], ['r0', '2'], ['c1', 'A'], ['r1', '1'],
    ]);
    expect(encodeStoredFormula(stored)).toBe(prepareUserFormula(text, workbook, sheet.id));
  });

  it('records property and column identity together, including a known property with an absent row', () => {
    const stored = decodeStoredFormula(prepareUserFormula("=@Cost[2]+@'Cost'[3]+@'Missing'[1]+@Cost", modeledWorkbook(), sheet.id));

    expect(stored.occurrences.map(slotTargets)).toEqual([
      [[sheet.id], ['cost', sheet.content.columns[1]], [sheet.content.rows[1]]],
      [[sheet.id], ['cost', sheet.content.columns[1]], []],
      [[sheet.id], [], [sheet.content.rows[0]]],
      [[sheet.id], ['cost', sheet.content.columns[1]], [sheet.content.rows[0]]],
    ]);
    expect(stored.occurrences[3].origins.at(-1)).toMatchObject({ start: 40, end: 40, slotId: 'r0' });
  });

  it.each(['missing-model', 'missing-binding', 'deleted-column'])('does not manufacture a target for a %s property', (scenario) => {
    const modeled = modeledWorkbook();
    const document = modeled.documents[sheet.id];
    if (scenario === 'missing-model') delete modeled.dataModels;
    if (scenario === 'missing-binding') delete document.modelColumnBindings;
    if (scenario === 'deleted-column') document.content = { ...document.content, columns: [] };

    const stored = decodeStoredFormula(prepareUserFormula("=@'Cost'[1]", modeled, sheet.id));

    expect(slotTargets(stored.occurrences[0])).toEqual([[sheet.id], [], [sheet.content.rows[0]]]);
  });

  it.each(['=@foo-1[bad]+3', '=~F1["=@Inputs!A[1]",[]]', '="@Inputs!A[1]"'])('preserves literal internal-looking or quoted input: %s', (text) => {
    const stored = decodeStoredFormula(prepareUserFormula(text, workbook, sheet.id));

    expect(stored).toEqual({ text, occurrences: [] });
  });

  it('retains unknown current-sheet context as unresolved and rejects nonformula API misuse', () => {
    const stored = decodeStoredFormula(prepareUserFormula('=@A[1]', workbook, 'missing-sheet'));

    expect(slotTargets(stored.occurrences[0])).toEqual([[], [], []]);
    expect(() => prepareUserFormula('text', workbook)).toThrow('Invalid stored formula');
  });
});
