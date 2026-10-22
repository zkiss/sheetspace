import { describe, expect, it } from 'vitest';
import { inspectFormula, navigableReferencesAtCaret } from '@reference-navigation/formulaInspection';
import { cellAddressOf, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { commitCellRawContent } from '@workbook/mutations/operations';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const sheet = (id: string, name: string, cells: Record<string, string> = {}) =>
  sheetDocument({ id, name, cells });
const workbook = workbookWithSheets;

describe('formula inspection', () => {
  it('preserves raw formula spelling and exposes repeated same-sheet cells and ranges', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');
    const result = inspectFormula('= sUm(@A[1], @A[1]:B[2]) + @A[1]', workbook([inputs]), inputs);

    expect(result?.raw).toBe('= sUm(@A[1], @A[1]:B[2]) + @A[1]');
    expect(result?.parts.map((part) => part.text).join('')).toBe(result?.raw);
    expect(result?.references).toHaveLength(3);
    expect(result?.references.map((reference) => reference.text)).toEqual(['@A[1]', '@A[1]:B[2]', '@A[1]']);
    expect(result?.references.map((reference) => reference.target)).toEqual([
      {
        kind: 'cell',
        sheetId: 'sheet-inputs',
        identity: { rowId: 'sheet-inputs:row:1', columnId: 'sheet-inputs:column:1' },
      },
      {
        kind: 'range',
        sheetId: 'sheet-inputs',
        range: {
          start: { rowId: 'sheet-inputs:row:1', columnId: 'sheet-inputs:column:1' },
          end: { rowId: 'sheet-inputs:row:2', columnId: 'sheet-inputs:column:2' },
        },
      },
      {
        kind: 'cell',
        sheetId: 'sheet-inputs',
        identity: { rowId: 'sheet-inputs:row:1', columnId: 'sheet-inputs:column:1' },
      },
    ]);
    expect(result?.references.every((reference) => reference.navigable)).toBe(true);
  });

  it('falls back to every navigable draft reference when the caret is outside a reference span', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');
    const draft = '=@A[1] + @B[1]';
    const inspection = inspectFormula(draft, workbook([inputs]), inputs);

    expect(navigableReferencesAtCaret(inspection, draft.indexOf('+'))
      .map((reference) => reference.text)).toEqual(['@A[1]', '@B[1]']);
  });

  it('returns every navigable reference when a draft has no caret position', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');
    const inspection = inspectFormula('=@A[1] + @B[1]', workbook([inputs]), inputs);

    expect(navigableReferencesAtCaret(inspection, undefined)
      .map((reference) => reference.text)).toEqual(['@A[1]', '@B[1]']);
  });

  it('keeps navigation identity stable when row order changes', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');
    const target = inspectFormula('=@A[1]', workbook([inputs]), inputs)?.references[0].target;
    const reordered = {
      ...inputs,
      content: {
        ...inputs.content,
        rows: [inputs.content.rows[1], inputs.content.rows[0], ...inputs.content.rows.slice(2)],
      },
    };

    expect(target?.kind).toBe('cell');
    if (target?.kind !== 'cell' || !target.identity) return;
    expect(cellAddressOf(reordered.content, target.identity)).toEqual({ rowIndex: 1, columnIndex: 0 });
  });

  it('projects persisted canonical references at their reordered A1 position', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');
    let model = workbook([inputs]);
    model = commitCellRawContent(model, inputs.id, 'B1', '=@A[1]');
    const original = model.documents[inputs.id]!;
    const reordered = {
      ...original,
      content: { ...original.content, columns: [original.content.columns[1]!, original.content.columns[0]!, ...original.content.columns.slice(2)] },
    };
    model = workbook([reordered]);

    const result = inspectFormula(reordered.content.cells[cellIdentityKey({
      rowId: original.content.rows[0]!, columnId: original.content.columns[1]!,
    })]!, model, reordered);
    expect(result?.raw).toBe('=@B[1]');
    expect(result?.references[0].target).toEqual({
      kind: 'cell', sheetId: inputs.id,
      identity: { rowId: original.content.rows[0], columnId: original.content.columns[0] },
    });
  });

  it('renders current quoted sheet names while retaining canonical ids and translated spans', () => {
    const outputs = sheet('sheet-outputs', 'Outputs');
    const source = sheet('sheet-source', "Owner's Plan");
    const canonicalRaw = '=SUM(@sheet-source!A[1], @sheet-source!B[2]:C[3])';
    const initial = inspectFormula(canonicalRaw, workbook([outputs, source]), outputs);
    const renamedSource = { ...source, name: 'Sales Q1' };
    const renamed = inspectFormula(canonicalRaw, workbook([outputs, renamedSource]), outputs);

    expect(initial?.raw).toBe("=SUM(@'Owner''s Plan'!A[1], @'Owner''s Plan'!B[2]:C[3])");
    expect(initial?.references.map((reference) => reference.text)).toEqual([
      "@'Owner''s Plan'!A[1]",
      "@'Owner''s Plan'!B[2]:C[3]",
    ]);
    expect(renamed?.raw).toBe("=SUM(@'Sales Q1'!A[1], @'Sales Q1'!B[2]:C[3])");
    expect(renamed?.references.map((reference) => reference.target.sheetId)).toEqual([
      'sheet-source',
      'sheet-source',
    ]);
    for (const reference of renamed?.references ?? []) {
      expect(renamed?.raw.slice(reference.displaySpan.start, reference.displaySpan.end))
        .toBe(reference.text);
      expect(canonicalRaw.slice(reference.sourceSpan.start, reference.sourceSpan.end))
        .toMatch(/^@sheet-source!/);
    }
  });

  it('marks deleted-sheet and out-of-bounds targets broken without discarding identity', () => {
    const outputs = sheet('sheet-outputs', 'Outputs');
    const missing = inspectFormula(
      '=@sheet-deleted!A[1]',
      workbook([outputs]),
      outputs,
    );
    const outOfBounds = inspectFormula(
      '=@A[21] + @K[1]',
      workbook([outputs]),
      outputs,
    );

    expect(missing?.raw).toBe('=@#REF!A[1]');
    expect(missing?.references[0]).toMatchObject({
      text: '@#REF!A[1]',
      target: { kind: 'cell', sheetId: 'sheet-deleted' },
      broken: true,
      navigable: false,
    });
    expect(missing?.diagnostics).toEqual([{
      kind: 'reference', code: '#REF!', sourceSpan: { start: 1, end: 20 },
    }]);
    expect(outOfBounds?.references.map((reference) => ({
      text: reference.text,
      broken: reference.broken,
      navigable: reference.navigable,
    }))).toEqual([
      { text: '@A[21]', broken: true, navigable: false },
      { text: '@K[1]', broken: true, navigable: false },
    ]);
    expect(outOfBounds?.diagnostics).toEqual([
      { kind: 'reference', code: '#REF!', sourceSpan: { start: 1, end: 7 } },
      { kind: 'reference', code: '#REF!', sourceSpan: { start: 10, end: 15 } },
    ]);
  });

  it('keeps broken canonical references inspectable after their target is deleted', () => {
    const outputs = sheet('sheet-outputs', 'Outputs');
    const missingSheet = inspectFormula(
      '=@sheet-deleted!sheet-deleted:column:1[sheet-deleted:row:1]',
      workbook([outputs]),
      outputs,
    );
    const deletedAxis = inspectFormula(
      '=@sheet-outputs:column:1[sheet-outputs:row:deleted]',
      workbook([outputs]),
      outputs,
    );

    for (const result of [missingSheet, deletedAxis]) {
      expect(result?.raw).toBe('=#REF!');
      expect(result?.parts.map((part) => part.text).join('')).toBe(result?.raw);
      expect(result?.references[0]).toMatchObject({
        text: '#REF!',
        displaySpan: { start: 1, end: 6 },
        broken: true,
        navigable: false,
      });
    }
    expect(missingSheet?.references[0]?.target).toEqual({
      kind: 'cell',
      sheetId: 'sheet-deleted',
      identity: { columnId: 'sheet-deleted:column:1', rowId: 'sheet-deleted:row:1' },
    });
    expect(deletedAxis?.references[0]?.target).toEqual({
      kind: 'cell',
      sheetId: outputs.id,
      identity: { columnId: 'sheet-outputs:column:1', rowId: 'sheet-outputs:row:deleted' },
    });
  });

  it('keeps references inspectable in formulas with evaluation errors', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');

    expect(inspectFormula('=1 / @A[1]', workbook([inputs]), inputs)?.references[0].text).toBe('@A[1]');
    expect(inspectFormula('=UNKNOWN(@A[1])', workbook([inputs]), inputs)?.references[0].text).toBe('@A[1]');
  });

  it('degrades safely for non-formulas and keeps valid malformed-formula references inspectable', () => {
    const inputs = sheet('sheet-inputs', 'Inputs');
    const model = workbook([inputs]);

    expect(inspectFormula('A1', model, inputs)).toBeUndefined();
    expect(inspectFormula('@A[1]', model, inputs)).toBeUndefined();
    const malformed = inspectFormula('=SUM(@A[1],)', model, inputs);
    expect(malformed?.raw).toBe('=SUM(@A[1],)');
    expect(malformed?.references).toMatchObject([{
      text: '@A[1]',
      sourceSpan: { start: 5, end: 10 },
      displaySpan: { start: 5, end: 10 },
    }]);
    expect(malformed?.parts.map((part) => part.text).join('')).toBe(malformed?.raw);
  });

  it('inspects and translates references after an earlier syntax error', () => {
    const outputs = sheet('sheet-outputs', 'Outputs');
    const source = sheet('sheet-source', 'Renamed Source');
    const result = inspectFormula(
      '=SUM(@A[1],) + @sheet-source!B[2] + @#REF!C[3]',
      workbook([outputs, source]),
      outputs,
    );

    expect(result?.raw).toBe("=SUM(@A[1],) + @'Renamed Source'!B[2] + @#REF!C[3]");
    expect(result?.references.map((reference) => ({
      text: reference.text,
      sheetId: reference.target.sheetId,
      broken: reference.broken,
    }))).toEqual([
      { text: '@A[1]', sheetId: 'sheet-outputs', broken: false },
      { text: "@'Renamed Source'!B[2]", sheetId: 'sheet-source', broken: false },
      { text: '@#REF!C[3]', sheetId: '#REF', broken: true },
    ]);
  });

  it('inspects persisted named ranges by stable identity and marks replaced properties broken', () => {
    let model = namedBoundWorkbook();
    model = commitCellRawContent(model, 'sheet-budget', 'D1', "=SUM(@'Revenue'[1]:'Cost'[2])");
    const sheet = model.documents['sheet-budget']!;
    const canonical = sheet.content.cells[cellIdentityKey({
      rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[3]!,
    })]!;

    expect(inspectFormula(canonical, model, sheet)?.references[0]).toMatchObject({
      target: {
        kind: 'range', sheetId: sheet.id,
        range: {
          start: { rowId: sheet.content.rows[0], columnId: sheet.content.columns[0] },
          end: { rowId: sheet.content.rows[1], columnId: sheet.content.columns[1] },
        },
      },
      broken: false,
      navigable: true,
    });

    model = {
      ...model,
      dataModels: {
        budget: {
          ...model.dataModels!.budget!,
          columns: [
            { id: 'replacement-revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const },
            ...model.dataModels!.budget!.columns.slice(1),
          ],
        },
      },
    };
    const broken = inspectFormula(canonical, model, model.documents['sheet-budget']!)?.references[0];
    expect(broken).toMatchObject({
      target: {
        kind: 'range', sheetId: 'sheet-budget',
        range: {
          start: { rowId: sheet.content.rows[0], columnId: sheet.content.columns[0] },
          end: { rowId: sheet.content.rows[1], columnId: sheet.content.columns[1] },
        },
      },
      broken: true,
      navigable: false,
    });
    expect(inspectFormula(canonical, model, model.documents['sheet-budget']!)?.diagnostics).toEqual([
      { kind: 'reference', code: '#REF!', sourceSpan: broken?.sourceSpan },
    ]);
  });

  it('reports semantic diagnostics for missing named properties and rows without losing adjacent targets', () => {
    const model = namedBoundWorkbook();
    const sheet = model.documents['sheet-budget']!;
    const result = inspectFormula("=@'Missing'[1] + @'Revenue'[21] + @'Cost'[1]", model, sheet);

    expect(result?.references.map((reference) => reference.text)).toEqual([
      "@'Missing'[1]", "@'Revenue'[21]", "@'Cost'[1]",
    ]);
    expect(result?.references).toHaveLength(3);
    expect(result?.references.slice(0, 2)).toMatchObject([
      { target: { kind: 'cell' }, broken: true, navigable: false },
      { target: { kind: 'cell' }, broken: true, navigable: false },
    ]);
    expect(result?.references[2]).toMatchObject({
      target: { kind: 'cell', sheetId: sheet.id, identity: { columnId: sheet.content.columns[1], rowId: sheet.content.rows[0] } },
      broken: false,
      navigable: true,
    });
    expect(result?.diagnostics).toEqual([
      { kind: 'reference', code: '#REF!', sourceSpan: result?.references[0].sourceSpan },
      { kind: 'reference', code: '#REF!', sourceSpan: result?.references[1].sourceSpan },
    ]);
  });

});

function namedBoundWorkbook(): Workbook {
  const budget = {
    ...sheetDocument({ id: 'sheet-budget', name: 'Budget', cells: { A1: '2', A2: '3', B1: '4', B2: '5' } }),
    modelId: 'budget',
    modelColumnBindings: { revenue: 'sheet-budget:column:1', cost: 'sheet-budget:column:2' },
  };
  return {
    ...workbookWithSheets([budget]),
    dataModels: {
      budget: {
        id: 'budget', name: 'Budget', columns: [
          { id: 'revenue', name: 'Revenue', kind: 'manual' as const, type: 'float' as const },
          { id: 'cost', name: 'Cost', kind: 'manual' as const, type: 'float' as const },
        ],
      },
    },
  };
}
